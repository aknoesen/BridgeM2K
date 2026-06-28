// Curve tracer core (SWEEP-1) — pure logic, no React. Builds the hardware-faithful parametric
// curve tracer the same way a student would on a real M2K bench: W1 sweeps the device's swept
// terminal (Vds / Vce) while W2 holds the stepped control (Vgs, or Vbb→Ib through a base resistor)
// at a DC level; the device current is read as the voltage across a series sense resistor, exactly
// like the diode I-V example. The family is N stepped transient passes (set control, sweep, record;
// bump control, repeat). This runs on the EXISTING `.tran` path — no `.dc`, no new ngspice element.
//
// See docs/specs/sch8-sweep1.md (phase SWEEP-1). The component (CurveTracer.tsx) is a thin async
// orchestration layer over these pure functions; everything testable lives here.

import type { Circuit, Component, WaveDrive, Analysis } from './netlist'
import type { SimResult } from './spice'

const GROUND = new Set(['0', 'gnd', 'GND', 'Gnd'])

type Transistor = Extract<Component, { kind: 'mosfet' } | { kind: 'bjt' }>

// What the tracer needs to read a family off a circuit: which transistor, the swept-terminal "top"
// node (drain/collector) and the sense node (source/emitter) above the sense resistor, the sense
// resistance, and the axis/label vocabulary for the device class.
export interface TracerSetup {
  device: 'mosfet' | 'bjt'
  kindLabel: string    // 'NMOS' | 'PMOS' | 'NPN' | 'PNP'
  highNet: string      // drain / collector — the swept terminal's high side
  senseNet: string     // source / emitter — node above the sense resistor (I = V/Rsense)
  rsenseOhms: number
  sweptLabel: string   // 'Vds' | 'Vce' (X axis)
  currentLabel: string // 'Id' | 'Ic'  (Y axis)
  stepLabel: string    // 'Vgs' | 'Vbb' (the W2 voltage being stepped)
  defaultSteps: number[]
}

function groundSet(circuit: Circuit): Set<string> {
  const s = new Set(GROUND)
  for (const c of circuit.components) if (c.kind === 'ground') s.add(c.node)
  return s
}

// Identify a traceable transistor stage in a circuit, or null if it isn't one. Requires a BJT or
// MOSFET, a W1 source (the sweep), a W2 source (the step), and a sense resistor tying the device's
// source/emitter to ground. Mirrors the diode I-V topology with a third (controlled) terminal.
export function identifyTracer(circuit: Circuit): TracerSetup | null {
  const dev = circuit.components.find(
    (c): c is Transistor => c.kind === 'mosfet' || c.kind === 'bjt',
  )
  const hasW1 = circuit.components.some((c) => c.kind === 'vsource' && c.id === 'W1')
  const hasW2 = circuit.components.some((c) => c.kind === 'vsource' && c.id === 'W2')
  if (!dev || !hasW1 || !hasW2) return null

  const gnd = groundSet(circuit)
  const highNet = dev.nodes[0]   // drain / collector
  const senseNet = dev.nodes[2]  // source / emitter
  const rsense = circuit.components.find(
    (c): c is Extract<Component, { kind: 'resistor' }> =>
      c.kind === 'resistor' &&
      ((c.nodes[0] === senseNet && gnd.has(c.nodes[1])) ||
        (c.nodes[1] === senseNet && gnd.has(c.nodes[0]))),
  )
  if (!rsense) return null

  if (dev.kind === 'mosfet') {
    return {
      device: 'mosfet', kindLabel: dev.channel.toUpperCase(),
      highNet, senseNet, rsenseOhms: rsense.ohms,
      sweptLabel: 'Vds', currentLabel: 'Id', stepLabel: 'Vgs',
      defaultSteps: [2, 2.5, 3, 3.5, 4],
    }
  }
  return {
    device: 'bjt', kindLabel: dev.polarity.toUpperCase(),
    highNet, senseNet, rsenseOhms: rsense.ohms,
    sweptLabel: 'Vce', currentLabel: 'Ic', stepLabel: 'Vbb',
    defaultSteps: [1, 1.5, 2, 2.5, 3],
  }
}

export interface SweepOpts {
  vMin: number   // sweep start (V) for the swept terminal drive (W1)
  vMax: number   // sweep stop  (V)
  rampSec: number // time W1 takes to ramp vMin→vMax (one capture)
  step: number   // the W2 DC level held during this pass
}

// One stepped transient pass: W1 becomes a triangle that ramps vMin→vMax over rampSec (we capture
// only the rising half), W2 becomes a constant DC source at the step value. Every other component
// (including the AWG output impedance and the sense resistor) is untouched. Pure transform.
export function buildTracerCircuit(circuit: Circuit, o: SweepOpts): Circuit {
  const offset = (o.vMax + o.vMin) / 2
  const amplitude = (o.vMax - o.vMin) / 2
  // triangle period = 2·rampSec, so it rises over the first rampSec — the window we capture
  const wave: WaveDrive = { type: 'triangle', offset, amplitude, freq: 1 / (2 * o.rampSec), duty: 50 }
  return {
    ...circuit,
    components: circuit.components.map((c) => {
      if (c.kind !== 'vsource') return c
      if (c.id === 'W1') return { ...c, dc: offset, sine: undefined, wave }
      // W2 holds a DC level (no wave/sine) → vsourceSpec emits a constant "DC <step>".
      if (c.id === 'W2') return { ...c, dc: o.step, sine: undefined, wave: undefined }
      return c
    }),
  }
}

// The transient directive sized to one ramp: ~1500 points across the rising sweep.
export function tracerAnalysis(rampSec: number): Analysis {
  return { kind: 'tran', step: rampSec / 1500, stop: rampSec }
}

// A node's voltage time-series from a real (.tran) result. Ground → all zeros. null if absent.
function nodeSeries(res: SimResult, net: string, n: number): Float64Array | null {
  if (GROUND.has(net)) return new Float64Array(n)
  const i = res.variables.findIndex((v) => v.name.toLowerCase() === `v(${net.toLowerCase()})`)
  if (i < 0) return null
  const col = res.columns[i]
  return col.kind === 'real' ? col.values : null
}

// One traced curve: parametric (vx[k], i[k]) — X = swept-terminal voltage, i = device current (A).
export interface Curve { vx: number[]; i: number[] }

// Extract the (Vds/Vce, Id/Ic) curve from a transient result: X = V(high) − V(sense) across the
// device's swept terminals; current = V(sense)/Rsense, the diode-I-V sense-resistor trick. The raw
// non-uniform .tran samples are fine — an XY curve is parametric, not time-gridded.
export function extractCurve(res: SimResult, setup: TracerSetup): Curve | null {
  const high = nodeSeries(res, setup.highNet, res.numPoints)
  if (!high) return null
  const sense = nodeSeries(res, setup.senseNet, res.numPoints) ?? new Float64Array(high.length)
  const vx: number[] = [], i: number[] = []
  for (let k = 0; k < high.length; k++) {
    vx.push(high[k] - sense[k])
    i.push(sense[k] / setup.rsenseOhms)
  }
  return { vx, i }
}
