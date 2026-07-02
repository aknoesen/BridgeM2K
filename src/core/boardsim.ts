// ARB-2 "active board" sim-state extraction. Pure, no React — reads the circuit loop's EXISTING
// `.tran` result (SimResult) and produces the values the live breadboard displays:
//   • settledNodeVoltages — the DC (time-averaged) voltage of every node over the settled span,
//     what a bench DMM on that node would read. Powers the on-board hover probe.
//   • ledAverageCurrents — each LED's time-averaged forward current over the same span, which is
//     exactly the perceived-brightness quantity for a PWM-driven LED. Powers the LED glow.
// No new analysis is run (D2): both read the `.tran` App already computes. The LED current is
// derived, not simulated (D3): ngspice-WASM exposes node voltages (and V-source branch currents)
// only, so we reconstruct I from the read node voltages — through the exclusive series resistor
// when the usual lab topology provides one (exact, linear), else by inverting the LED's own diode
// model (the same IS/N/RS toCircuit emitted). See docs/private/FABLE-ARB2-BRIEF.md.

import type { SimResult } from './spice'
import type { Circuit, Component, Diode } from './netlist'
import type { Schematic } from './schematic'

const VT = 0.02585 // thermal voltage at room temp (matches toCircuit's LED Vf→IS calibration)

// Time column + a node's voltage series from a real-valued .tran result. Node '0' reads as 0 V.
function timeSeries(r: SimResult): Float64Array | null {
  const ti = r.variables.findIndex((v) => v.type === 'time')
  if (ti < 0) return null
  const col = r.columns[ti]
  return col.kind === 'real' ? col.values : null
}
function voltSeries(r: SimResult, node: string, n: number): Float64Array | null {
  if (node === '0' || node.toLowerCase() === 'gnd') return new Float64Array(n) // ground = 0 V
  const i = r.variables.findIndex((v) => v.name.toLowerCase() === `v(${node.toLowerCase()})`)
  if (i < 0) return null
  const col = r.columns[i]
  return col.kind === 'real' ? col.values : null
}

// Trapezoidal time-weighted average of y over t ≥ tStart. ngspice .tran steps are NON-uniform, so a
// plain sample mean would bias toward the densely-stepped fast edges; trapezoids weight by time.
export function timeAverage(t: ArrayLike<number>, y: ArrayLike<number>, tStart: number): number {
  let area = 0, span = 0
  for (let i = 1; i < t.length; i++) {
    const t0 = Math.max(t[i - 1], tStart), t1 = t[i]
    if (t1 <= tStart) continue
    const dt = t1 - t0
    if (dt <= 0) continue
    // linear interp of y at t0 when the segment straddles tStart
    const f = t[i] > t[i - 1] ? (t0 - t[i - 1]) / (t[i] - t[i - 1]) : 0
    const y0 = y[i - 1] + f * (y[i] - y[i - 1])
    area += ((y0 + y[i]) / 2) * dt
    span += dt
  }
  return span > 0 ? area / span : (y.length ? y[y.length - 1] : 0)
}

// The settled DC voltage of every node in the result (time-averaged over t ≥ tStart) — what a DMM
// reads. Keys are the ngspice node names, lowercase (matching boardNodeMap's values).
export function settledNodeVoltages(r: SimResult, tStart: number): Map<string, number> {
  const out = new Map<string, number>()
  const t = timeSeries(r)
  if (!t) return out
  r.variables.forEach((v, i) => {
    const m = /^v\((.+)\)$/.exec(v.name.toLowerCase())
    if (!m) return
    const col = r.columns[i]
    if (col.kind !== 'real') return
    out.set(m[1], timeAverage(t, col.values, tStart))
  })
  out.set('0', 0)
  return out
}

// ── LED identification (schematic id ↔ circuit diode) ───────────────────────────────────────────
// toCircuit emits exactly one circuit `diode` per diode-family schematic part, in schematic order,
// so zipping the two filtered lists pairs each board LED (schematic id) with its circuit diode
// (nodes + the IS/N/RS model toCircuit chose). Defaults mirror buildNetlist's diode defaults.
export interface LedSpec {
  id: string        // schematic id — matches the placed board part
  anode: string     // circuit node names (renamed)
  cathode: string
  is: number
  n: number
  rs: number
}

const DIODE_FAMILY = new Set(['diode', 'led', 'zener', 'photodiode'])

export function ledSpecs(s: Schematic, circuit: Circuit): LedSpec[] {
  const schDiodes = s.components.filter((c) => DIODE_FAMILY.has(c.kind))
  const cktDiodes = circuit.components.filter((c): c is Diode => c.kind === 'diode')
  const out: LedSpec[] = []
  for (let i = 0; i < Math.min(schDiodes.length, cktDiodes.length); i++) {
    if (schDiodes[i].kind !== 'led') continue // only LEDs glow
    const d = cktDiodes[i]
    out.push({
      id: schDiodes[i].id,
      anode: d.nodes[0], cathode: d.nodes[1],
      is: d.is ?? 2.52e-9, n: d.n ?? 1.752, rs: d.rs ?? 0.568,
    })
  }
  return out
}

// All device terminals attached to a circuit node — 2 means an exclusive two-terminal junction.
function nodeTerminalCount(circuit: Circuit, node: string): number {
  let count = 0
  const hit = (nd: string) => { if (nd === node) count++ }
  for (const c of circuit.components) {
    switch (c.kind) {
      case 'resistor': case 'capacitor': case 'inductor': case 'vsource': case 'diode':
      case 'bjt': case 'mosfet':
        for (const nd of c.nodes) hit(nd)
        break
      case 'dcrail': hit(c.node); break
      case 'opamp': case 'inamp':
        for (const nd of Object.values(c.nodes)) if (typeof nd === 'string') hit(nd)
        break
      case 'ground': break
    }
  }
  return count
}

// Invert the diode model for the forward current at junction+RS drop Vd: solve
//   Vd = N·VT·ln(i/IS + 1) + i·RS   (monotone in i)
// by bisection in log-safe form — the naive exponential overflows for Vd of a few volts.
export function diodeForwardCurrent(vd: number, is: number, n: number, rs: number): number {
  if (!(vd > 0)) return 0
  let lo = 0
  let hi = rs > 0 ? vd / rs : is * Math.expm1(Math.min(vd / (n * VT), 200))
  const g = (i: number) => n * VT * Math.log(i / is + 1) + i * rs - vd
  if (g(hi) < 0) return hi // numeric guard; shouldn't happen for rs > 0
  for (let k = 0; k < 80; k++) {
    const mid = (lo + hi) / 2
    if (g(mid) < 0) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

// Each LED's time-averaged FORWARD current over t ≥ tStart (reverse phases emit no light → clamp 0).
// Exclusive-series-resistor derivation when the node between LED and R is private to the two parts
// (I = V_R/R — exact and linear, so the average is the true average even under PWM); otherwise the
// diode-model inversion per timestep. Returns schematic-id → amps.
export function ledAverageCurrents(specs: LedSpec[], circuit: Circuit, r: SimResult, tStart: number): Map<string, number> {
  const out = new Map<string, number>()
  const t = timeSeries(r)
  if (!t) return out
  const nPts = t.length

  for (const led of specs) {
    const va = voltSeries(r, led.anode, nPts)
    const vk = voltSeries(r, led.cathode, nPts)
    if (!va || !vk) continue

    // Prefer a series resistor sharing a PRIVATE node with the LED (the standard lab topology).
    let series: { other: string; ohms: number; atAnode: boolean } | null = null
    for (const c of circuit.components) {
      if (c.kind !== 'resistor') continue
      const rc = c as Component & { nodes: [string, string]; ohms: number }
      for (const shared of [led.anode, led.cathode] as const) {
        if (shared === '0') continue // ground is a hub, never a private series node
        const idx = rc.nodes.indexOf(shared)
        if (idx < 0) continue
        if (nodeTerminalCount(circuit, shared) !== 2) continue
        series = { other: rc.nodes[1 - idx], ohms: rc.ohms, atAnode: shared === led.anode }
        break
      }
      if (series) break
    }

    const i = new Float64Array(nPts)
    if (series) {
      const vo = voltSeries(r, series.other, nPts)
      if (vo) {
        for (let k = 0; k < nPts; k++) {
          // current INTO the anode (from the resistor), or OUT of the cathode (into the resistor)
          const cur = series.atAnode ? (vo[k] - va[k]) / series.ohms : (vk[k] - vo[k]) / series.ohms
          i[k] = Math.max(0, cur)
        }
      }
    }
    if (!series) {
      for (let k = 0; k < nPts; k++) i[k] = diodeForwardCurrent(va[k] - vk[k], led.is, led.n, led.rs)
    }
    out.set(led.id, timeAverage(t, i, tStart))
  }
  return out
}
