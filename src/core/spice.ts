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

// Transimpedance Z(f) = V(out)/I_in for a photodiode-driven TIA (TIA-2). The AC stimulus is the
// photodiode's photocurrent, normalised to 1 A (TIA-1's `iphotoAc`), so the denominator is unity and
// Z = V(out): magnitude in dBΩ (20·log10|V(out)|) and phase ∠V(out). Same `Bode` shape as
// transferFunction, so findCutoffHz / analyzeBode operate on `magDb` unchanged (it is now dBΩ, still a
// decibel scale). A linear-ohm axis is just 10^(magDb/20) at display time. `outName` matches '(out)'.
export function transimpedance(r: SimResult, outName: string): Bode {
  const fi = r.variables.findIndex((v) => v.type === 'frequency')
  const oi = r.variables.findIndex((v) => v.name.toLowerCase().includes(`(${outName.toLowerCase()})`))
  const fcol = r.columns[fi]
  const ocol = r.columns[oi]
  if (!fcol || fcol.kind !== 'complex' || !ocol || ocol.kind !== 'complex') {
    throw new Error('transimpedance requires a complex AC result with frequency and out')
  }
  const n = r.numPoints
  const freq = new Float64Array(n)
  const magDb = new Float64Array(n)
  const phaseDeg = new Float64Array(n)
  for (let k = 0; k < n; k++) {
    freq[k] = fcol.re[k]
    magDb[k] = 20 * Math.log10(Math.hypot(ocol.re[k], ocol.im[k]))
    phaseDeg[k] = Math.atan2(ocol.im[k], ocol.re[k]) * (180 / Math.PI)
  }
  return { freq, magDb, phaseDeg }
}

// −3 dB cutoff relative to the low-frequency (passband) gain, interpolated in
// log-frequency so the reading is not quantized to the sweep grid (LOOP-2). Returns
// the first frequency where the magnitude falls 3 dB below magDb[0], or null if the
// response never drops 3 dB across the swept range (e.g. a flat or rising trace).
export function findCutoffHz(freq: ArrayLike<number>, magDb: ArrayLike<number>): number | null {
  const n = magDb.length
  if (n < 2) return null
  const target = magDb[0] - 3
  for (let i = 1; i < n; i++) {
    if (magDb[i - 1] >= target && magDb[i] < target) {
      const lf0 = Math.log10(freq[i - 1])
      const lf1 = Math.log10(freq[i])
      const frac = (target - magDb[i - 1]) / (magDb[i] - magDb[i - 1]) // 0..1 between the two points
      return Math.pow(10, lf0 + frac * (lf1 - lf0))
    }
  }
  return null
}

// Log-interpolated frequency where magDb crosses `target` between samples i-1 and i.
function crossFreqLog(freq: ArrayLike<number>, magDb: ArrayLike<number>, i: number, target: number): number {
  const a = magDb[i - 1]
  const b = magDb[i]
  const lf0 = Math.log10(freq[i - 1])
  const lf1 = Math.log10(freq[i])
  if (b === a) return Math.pow(10, lf0)
  const frac = (target - a) / (b - a)
  return Math.pow(10, lf0 + frac * (lf1 - lf0))
}

export type FilterShape = 'lowpass' | 'highpass' | 'bandpass' | 'bandstop' | 'flat'

export interface BodeFeature {
  shape: FilterShape
  peakDb: number
  peakFreq: number
  // −3 dB crossing frequencies (ascending). LP/HP → 1; BP/notch → 2 (band edges); flat → 0.
  cutoffs: number[]
  center?: number     // geometric-mean band center (BP/notch)
  bandwidth?: number  // upper − lower edge (BP/notch)
}

// General −3 dB feature finder (NA-TUNE). Measures relative to the PEAK gain (not the DC gain),
// then classifies the response by where the in-band region (≥ peak − 3 dB) sits in the sweep:
//   one band touching the low end  → low-pass   (1 cutoff)
//   one band touching the high end → high-pass  (1 cutoff)
//   one band touching neither end  → band-pass  (2 edges, center, bandwidth)
//   two bands flanking a central dip → band-stop/notch (2 edges around the dip)
//   band spans the whole sweep      → flat / all-pass (no −3 dB feature)
// This makes the readout honest for any EEC1 filter rather than assuming an RC low-pass.
export function analyzeBode(freq: ArrayLike<number>, magDb: ArrayLike<number>): BodeFeature {
  const n = magDb.length
  let pk = 0
  for (let i = 1; i < n; i++) if (magDb[i] > magDb[pk]) pk = i
  const peakDb = n ? magDb[pk] : 0
  const peakFreq = n ? freq[pk] : 0
  if (n < 2) return { shape: 'flat', peakDb, peakFreq, cutoffs: [] }

  const target = peakDb - 3
  // Contiguous runs of samples that are within 3 dB of the peak (the in-band regions).
  const runs: [number, number][] = []
  let s = -1
  for (let i = 0; i < n; i++) {
    const above = magDb[i] >= target
    if (above && s < 0) s = i
    if (s >= 0 && (!above || i === n - 1)) {
      runs.push([s, above ? i : i - 1])
      s = -1
    }
  }
  const leftCross = (r: [number, number]) => (r[0] > 0 ? crossFreqLog(freq, magDb, r[0], target) : null)
  const rightCross = (r: [number, number]) => (r[1] < n - 1 ? crossFreqLog(freq, magDb, r[1] + 1, target) : null)

  if (runs.length <= 1) {
    const r = runs[0] ?? [0, n - 1]
    const lc = leftCross(r)
    const rc = rightCross(r)
    if (lc === null && rc === null) return { shape: 'flat', peakDb, peakFreq, cutoffs: [] }
    if (lc === null && rc !== null) return { shape: 'lowpass', peakDb, peakFreq, cutoffs: [rc] }
    if (lc !== null && rc === null) return { shape: 'highpass', peakDb, peakFreq, cutoffs: [lc] }
    const lo = lc as number, hi = rc as number
    return { shape: 'bandpass', peakDb, peakFreq, cutoffs: [lo, hi], center: Math.sqrt(lo * hi), bandwidth: hi - lo }
  }

  // ≥2 in-band runs: a notch sits between two pass regions. Use the runs flanking the deepest dip.
  let mn = 0
  for (let i = 1; i < n; i++) if (magDb[i] < magDb[mn]) mn = i
  let before: [number, number] | null = null
  let after: [number, number] | null = null
  for (const r of runs) {
    if (r[1] < mn) before = r
    if (r[0] > mn && !after) after = r
  }
  if (before && after) {
    const lo = rightCross(before) as number
    const hi = leftCross(after) as number
    return { shape: 'bandstop', peakDb, peakFreq, cutoffs: [lo, hi], center: Math.sqrt(lo * hi), bandwidth: hi - lo }
  }
  // Fallback: report the run containing the peak as a band-pass-like feature.
  const r = runs.find((rr) => pk >= rr[0] && pk <= rr[1]) ?? runs[0]
  const lo = leftCross(r) ?? freq[0]
  const hi = rightCross(r) ?? freq[n - 1]
  return { shape: 'bandpass', peakDb, peakFreq, cutoffs: [lo, hi], center: Math.sqrt(lo * hi), bandwidth: hi - lo }
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

// ── Transient node resampling (WIRE-3) ─────────────────────────────────────────
// ngspice .tran returns non-uniform time steps. Resample a node's voltage onto a uniform
// time grid (linear interpolation) so the scope/spectrum — which assume uniform sampling at
// the generator's Fs — can consume the circuit's output exactly like a generated waveform.
// Returns null if the result is not transient or the node is absent (caller falls back to
// the direct generator path). `tGrid` must be monotonically increasing.
export function sampleNodeTransient(r: SimResult, node: string, tGrid: Float64Array): Float64Array | null {
  const ti = r.variables.findIndex((v) => v.type === 'time')
  const ni = r.variables.findIndex((v) => v.name.toLowerCase() === `v(${node.toLowerCase()})`)
  if (ti < 0 || ni < 0) return null
  const tc = r.columns[ti], vc = r.columns[ni]
  if (tc.kind !== 'real' || vc.kind !== 'real') return null
  const time = tc.values, val = vc.values
  if (time.length === 0) return null
  const out = new Float64Array(tGrid.length)
  let j = 0
  for (let k = 0; k < tGrid.length; k++) {
    const tk = tGrid[k]
    while (j < time.length - 1 && time[j + 1] < tk) j++
    if (tk <= time[0]) out[k] = val[0]
    else if (tk >= time[time.length - 1]) out[k] = val[val.length - 1]
    else {
      const t0 = time[j], t1 = time[j + 1]
      out[k] = t1 > t0 ? val[j] + ((tk - t0) / (t1 - t0)) * (val[j + 1] - val[j]) : val[j]
    }
  }
  return out
}

// Branch current of a voltage source from an .op/.dc result, returned as the current the source
// DELIVERS to the circuit. ngspice reports the internal +→- current, which is the negative of the
// delivered current, so we flip the sign. Used by the Power Supply to show per-rail load current.
export function sourceCurrent(r: SimResult, sourceId: string): number {
  const name = `i(v${sourceId.toLowerCase()})`
  const i = r.variables.findIndex((v) => v.name.toLowerCase() === name)
  if (i < 0) return 0
  const col = r.columns[i]
  const raw = col.kind === 'real' ? col.values[0] : col.mag[0]
  return -raw
}
