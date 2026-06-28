import { describe, it, expect } from 'vitest'
import { Simulation } from 'eecircuit-engine'
import { buildNetlist, type Circuit } from './netlist'
import { normalizeResult } from './spice'
import { toCircuit } from './schematic'
import { EXAMPLES } from './examples'
import {
  identifyTracer, buildTracerCircuit, tracerAnalysis, extractCurve, type Curve,
} from './curvetracer'

// Id (mA) at the curve sample whose Vds is nearest `target`.
function idAt(c: Curve, target: number): number {
  let best = 0, bestErr = Infinity
  for (let k = 0; k < c.vx.length; k++) {
    const e = Math.abs(c.vx[k] - target)
    if (e < bestErr) { bestErr = e; best = c.i[k] * 1000 }
  }
  return best
}

const mosfetExample = () => EXAMPLES.find((e) => e.id === 'nmos-curve-family')!
const bjtExample = () => EXAMPLES.find((e) => e.id === 'bjt-curve-family')!

describe('identifyTracer', () => {
  it('recognises a MOSFET stage and its sense resistor', () => {
    const { circuit } = toCircuit(mosfetExample().schematic)
    const setup = identifyTracer(circuit)
    expect(setup).not.toBeNull()
    expect(setup!.device).toBe('mosfet')
    expect(setup!.sweptLabel).toBe('Vds')
    expect(setup!.currentLabel).toBe('Id')
    expect(setup!.rsenseOhms).toBe(10)
  })

  it('recognises a BJT stage (Ic-vs-Vce, emitter sense)', () => {
    const { circuit } = toCircuit(bjtExample().schematic)
    const setup = identifyTracer(circuit)
    expect(setup).not.toBeNull()
    expect(setup!.device).toBe('bjt')
    expect(setup!.sweptLabel).toBe('Vce')
    expect(setup!.rsenseOhms).toBe(100)
  })

  it('returns null when no transistor / W1 / W2 / sense resistor is present', () => {
    const rc: Circuit = {
      title: 't',
      components: [
        { kind: 'vsource', id: 'W1', nodes: ['in', '0'], dc: 0 },
        { kind: 'resistor', id: '1', nodes: ['in', 'out'], ohms: 1000 },
        { kind: 'ground', id: '0', node: '0' },
      ],
    }
    expect(identifyTracer(rc)).toBeNull()
  })
})

describe('buildTracerCircuit', () => {
  it('drives W1 with a triangle ramp and holds W2 at a constant DC step', () => {
    const { circuit } = toCircuit(mosfetExample().schematic)
    const ckt = buildTracerCircuit(circuit, { vMin: 0, vMax: 5, rampSec: 0.005, step: 3 })
    const nl = buildNetlist(ckt, tracerAnalysis(0.005))
    // W1 → triangle PULSE; W2 → a bare DC level (no SIN/PULSE).
    expect(nl).toMatch(/VW1 .*PULSE\(/)
    const w2 = nl.split('\n').find((l) => l.startsWith('VW2 '))!
    expect(w2).toContain('DC 3')
    expect(w2).not.toContain('PULSE')
    expect(w2).not.toContain('SIN')
    expect(nl).toContain('.tran')
  })
})

// End-to-end (criterion 1 & 5): the tuned model must render a clean, well-separated triode→
// saturation family at M2K scales. Runs the real ngspice engine, two stepped transient passes.
describe('MOSFET curve family (engine)', () => {
  it('traces separated curves that saturate, rising with Vgs', async () => {
    const { circuit } = toCircuit(mosfetExample().schematic)
    const setup = identifyTracer(circuit)!
    const sim = new Simulation()
    await sim.start()
    const trace = async (vgs: number): Promise<Curve> => {
      const ckt = buildTracerCircuit(circuit, { vMin: 0, vMax: 5, rampSec: 0.005, step: vgs })
      sim.setNetList(buildNetlist(ckt, tracerAnalysis(0.005)))
      const res = normalizeResult(await sim.runSim())
      const c = extractCurve(res, setup)
      expect(c).not.toBeNull()
      return c!
    }
    const lo = await trace(2.5)
    const hi = await trace(4)

    // Currents are positive and in the M2K few-mA range (not hard-on / not degenerate).
    const hiSat = idAt(hi, 4)
    const loSat = idAt(lo, 4)
    expect(loSat).toBeGreaterThan(0.5)
    expect(hiSat).toBeGreaterThan(loSat + 2)   // curves are well separated
    expect(hiSat).toBeLessThan(60)             // not pinned to a hard-on rail

    // Triode → saturation: Id rises strongly from low Vds to mid Vds, then flattens.
    const hiKnee = idAt(hi, 0.5)
    const hiMid = idAt(hi, 2)
    expect(hiMid).toBeGreaterThan(hiKnee)              // climbing through triode
    expect(idAt(hi, 4)).toBeGreaterThanOrEqual(hiMid * 0.9) // plateau (flat in saturation)
    expect(idAt(hi, 4) - hiMid).toBeLessThan(hiMid)   // and not still climbing steeply
  }, 60000)
})
