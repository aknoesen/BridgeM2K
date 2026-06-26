// SPICE engine adapter — no UI. See docs/specs/schematic-ngspice.md (phase SPICE-1).
//
// eecircuit-engine (ngspice-WASM, MIT) is loaded ONLY inside the Web Worker
// (src/core/spice.worker.ts) so its ~20 MB inlined-WASM bundle never touches the main
// thread. This module exposes an engine-agnostic interface + result shape; nothing here
// imports eecircuit-engine at runtime — only its types, which are erased at compile time —
// so swapping the engine later means changing only the worker.

import type { ResultType } from 'eecircuit-engine'

export type AnalysisKind = 'tran' | 'ac' | 'dc' | 'op' | 'unknown'

export interface SimVariable {
  name: string
  type: 'voltage' | 'current' | 'time' | 'frequency' | 'notype'
}

export type SimColumn =
  | { kind: 'real'; values: Float64Array }
  | {
      kind: 'complex'
      re: Float64Array
      im: Float64Array
      mag: Float64Array
      phaseDeg: Float64Array
    }

export interface SimResult {
  analysis: AnalysisKind
  variables: SimVariable[] // parallel to `columns`
  columns: SimColumn[]
  numPoints: number
}

export interface SpiceEngine {
  // Run a netlist and resolve normalized results. Auto-initialises on first call.
  run(netlist: string): Promise<SimResult>
  // Tear down the worker.
  dispose(): void
}

// ── Normalisation: engine ResultType → engine-agnostic SimResult ───────────────
// Pure function, no engine value import. Runs inside the worker.
export function normalizeResult(raw: ResultType): SimResult {
  const variables: SimVariable[] = raw.data.map((d) => ({ name: d.name, type: d.type }))

  let columns: SimColumn[]
  if (raw.dataType === 'real') {
    columns = raw.data.map((d) => ({
      kind: 'real' as const,
      values: Float64Array.from(d.values),
    }))
  } else {
    columns = raw.data.map((d) => {
      const n = d.values.length
      const re = new Float64Array(n)
      const im = new Float64Array(n)
      const mag = new Float64Array(n)
      const phaseDeg = new Float64Array(n)
      for (let i = 0; i < n; i++) {
        const c = d.values[i]
        re[i] = c.real
        im[i] = c.img
        mag[i] = Math.hypot(c.real, c.img)
        phaseDeg[i] = Math.atan2(c.img, c.real) * (180 / Math.PI)
      }
      return { kind: 'complex' as const, re, im, mag, phaseDeg }
    })
  }

  const firstType = variables[0]?.type
  const analysis: AnalysisKind =
    firstType === 'time' ? 'tran' : firstType === 'frequency' ? 'ac' : 'unknown'

  return { analysis, variables, columns, numPoints: raw.numPoints }
}

// ── Worker-backed engine ───────────────────────────────────────────────────────

interface WorkerResponse {
  id: number
  ok: boolean
  result?: SimResult
  error?: string
}

class WorkerSpiceEngine implements SpiceEngine {
  private worker: Worker
  private nextId = 1
  private pending = new Map<
    number,
    { resolve: (r: SimResult) => void; reject: (e: Error) => void }
  >()

  constructor() {
    this.worker = new Worker(new URL('./spice.worker.ts', import.meta.url), {
      type: 'module',
    })
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const { id, ok, result, error } = e.data
      const p = this.pending.get(id)
      if (!p) return
      this.pending.delete(id)
      if (ok && result) p.resolve(result)
      else p.reject(new Error(error ?? 'SPICE worker error'))
    }
    this.worker.onerror = (e) => {
      for (const { reject } of this.pending.values()) reject(new Error(e.message))
      this.pending.clear()
    }
  }

  run(netlist: string): Promise<SimResult> {
    const id = this.nextId++
    return new Promise<SimResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.worker.postMessage({ id, netlist })
    })
  }

  dispose() {
    this.worker.terminate()
    this.pending.clear()
  }
}

export function createSpiceEngine(): SpiceEngine {
  return new WorkerSpiceEngine()
}

// ── Bode transfer function (NET-1) ─────────────────────────────────────────────
// Compute H(f) = V(out)/V(in) from a complex AC SimResult, as magnitude (dB) and phase
// (deg). Used by the Network Analyzer instrument. `outName`/`inName` are matched against
// variable names as `(name)` — e.g. 'out' matches 'v(out)'.

export interface Bode {
  freq: Float64Array
  magDb: Float64Array
  phaseDeg: Float64Array
}

export function transferFunction(r: SimResult, outName: string, inName: string): Bode {
  const fi = r.variables.findIndex((v) => v.type === 'frequency')
  const oi = r.variables.findIndex((v) => v.name.toLowerCase().includes(`(${outName.toLowerCase()})`))
  const ii = r.variables.findIndex((v) => v.name.toLowerCase().includes(`(${inName.toLowerCase()})`))
  const fcol = r.columns[fi]
  const ocol = r.columns[oi]
  const icol = r.columns[ii]
  if (
    !fcol || fcol.kind !== 'complex' ||
    !ocol || ocol.kind !== 'complex' ||
    !icol || icol.kind !== 'complex'
  ) {
    throw new Error('transferFunction requires a complex AC result with frequency, out and in')
  }
  const n = r.numPoints
  const freq = new Float64Array(n)
  const magDb = new Float64Array(n)
  const phaseDeg = new Float64Array(n)
  for (let k = 0; k < n; k++) {
    freq[k] = fcol.re[k]
    const denom = icol.re[k] * icol.re[k] + icol.im[k] * icol.im[k]
    const hre = (ocol.re[k] * icol.re[k] + ocol.im[k] * icol.im[k]) / denom
    const him = (ocol.im[k] * icol.re[k] - ocol.re[k] * icol.im[k]) / denom
    magDb[k] = 20 * Math.log10(Math.hypot(hre, him))
    phaseDeg[k] = Math.atan2(him, hre) * (180 / Math.PI)
  }
  return { freq, magDb, phaseDeg }
}

// ── Node voltage helpers (DMM-1 Voltmeter) ─────────────────────────────────────
// Read a single node's voltage from a real (.op/.dc) result. Ground / missing → 0.
export function nodeVoltage(r: SimResult, node: string): number {
  if (node === '0' || node.toLowerCase() === 'gnd') return 0
  const i = r.variables.findIndex((v) => v.name.toLowerCase() === `v(${node.toLowerCase()})`)
  if (i < 0) return 0
  const col = r.columns[i]
  return col.kind === 'real' ? col.values[0] : col.mag[0]
}

// True if the result actually contains this node (i.e. it is wired into the circuit).
export function hasNode(r: SimResult, node: string): boolean {
  return r.variables.some((v) => v.name.toLowerCase() === `v(${node.toLowerCase()})`)
}

// Differential reading V(pos) - V(neg). neg defaults to ground.
export function differentialVoltage(r: SimResult, pos: string, neg = '0'): number {
  return nodeVoltage(r, pos) - nodeVoltage(r, neg)
}
