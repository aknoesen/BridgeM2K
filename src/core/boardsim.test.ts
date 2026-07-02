import { describe, it, expect } from 'vitest'
import { Simulation } from 'eecircuit-engine'
import { timeAverage, settledNodeVoltages, ledSpecs, ledAverageCurrents, diodeForwardCurrent } from './boardsim'
import { toCircuit } from './schematic'
import type { Schematic } from './schematic'
import { buildNetlist, type Circuit } from './netlist'
import { normalizeResult, type SimResult } from './spice'

// Minimal real-valued .tran result: a time column + one v(node) column per entry.
function simRes(time: number[], nodes: Record<string, number[]>): SimResult {
  return {
    analysis: 'tran',
    variables: [
      { name: 'time', type: 'time' },
      ...Object.keys(nodes).map((n) => ({ name: `v(${n})`, type: 'voltage' as const })),
    ],
    columns: [
      { kind: 'real', values: Float64Array.from(time) },
      ...Object.values(nodes).map((v) => ({ kind: 'real' as const, values: Float64Array.from(v) })),
    ],
    numPoints: time.length,
  }
}

describe('timeAverage (trapezoidal, t ≥ tStart)', () => {
  it('weights by segment duration, not by sample count', () => {
    // y=1 for 1 s then y=3 for 3 s → time average (1·1 + 3·3)/4 = 2.5; a sample mean would give 2.33
    expect(timeAverage([0, 1, 1, 4], [1, 1, 3, 3], 0)).toBeCloseTo(2.5, 9)
  })
  it('starts integrating at tStart (interpolating a straddling segment)', () => {
    // y ramps 0→4 over t 0→4; average over t≥2 is the ramp's mean on [2,4] = 3
    expect(timeAverage([0, 4], [0, 4], 2)).toBeCloseTo(3, 9)
  })
})

describe('settledNodeVoltages', () => {
  it('averages every v(node) column over the settled span and pins ground to 0', () => {
    const r = simRes([0, 1, 2], { out: [0, 2, 2], in: [5, 5, 5] })
    const m = settledNodeVoltages(r, 1) // settled span = t ≥ 1
    expect(m.get('out')).toBeCloseTo(2, 9)
    expect(m.get('in')).toBeCloseTo(5, 9)
    expect(m.get('0')).toBe(0)
  })
})

describe('ledSpecs (schematic LED ↔ circuit diode zip)', () => {
  it('pairs each schematic LED with its circuit diode nodes + model, skipping plain diodes', () => {
    const s: Schematic = {
      components: [
        { id: 'W1', kind: 'awg1', gx: 0, gy: 0 },
        { id: 'D1', kind: 'diode', gx: 2, gy: 0 },                       // plain diode — no glow
        { id: 'D2', kind: 'led', gx: 6, gy: 0, value: 2.0 },             // the LED
        { id: 'R1', kind: 'resistor', gx: 4, gy: 0, rotation: 1, value: 470 },
        { id: 'G1', kind: 'ground', gx: 8, gy: 0 },
        { id: 'P1', kind: 'scope1', gx: 2, gy: 0 },
      ],
      wires: [{ x1: 0, y1: 0, x2: 2, y2: 0 }, { x1: 4, y1: 0, x2: 6, y2: 0 }, { x1: 8, y1: 0, x2: 8, y2: 0 }],
    }
    const { circuit } = toCircuit(s)
    const specs = ledSpecs(s, circuit)
    expect(specs).toHaveLength(1)
    expect(specs[0].id).toBe('D2')
    expect(specs[0].n).toBe(2)          // toCircuit's LED ideality
    expect(specs[0].is).toBeGreaterThan(0)
    expect(specs[0].is).toBeLessThan(1e-12) // Vf 2 V ⇒ tiny IS
  })
})

describe('diodeForwardCurrent (model inversion)', () => {
  const IS = 0.01 / Math.exp(2.0 / (2 * 0.02585)) // toCircuit's LED: Vf 2 V at 10 mA, N=2
  it('round-trips the diode equation (Vd(i*) → i*)', () => {
    for (const iStar of [1e-4, 1e-3, 5e-3, 10e-3]) {
      const vd = 2 * 0.02585 * Math.log(iStar / IS + 1) + iStar * 2 // N·VT·ln(i/IS+1) + i·RS
      expect(diodeForwardCurrent(vd, IS, 2, 2)).toBeCloseTo(iStar, 6)
    }
  })
  it('reverse / zero bias → 0', () => {
    expect(diodeForwardCurrent(0, IS, 2, 2)).toBe(0)
    expect(diodeForwardCurrent(-3, IS, 2, 2)).toBe(0)
  })
})

describe('ledAverageCurrents', () => {
  // V1(in) → R 1k → (mid) → LED → 0 : the standard lab topology (exclusive series node 'mid').
  const seriesCkt: Circuit = {
    title: 't',
    components: [
      { kind: 'vsource', id: 'W1', nodes: ['in', '0'], dc: 0 },
      { kind: 'resistor', id: '1', nodes: ['in', 'mid'], ohms: 1000 },
      { kind: 'diode', id: '1', nodes: ['mid', '0'], is: 1e-20, n: 2, rs: 2 },
      { kind: 'ground', id: '0', node: '0' },
    ],
  }
  const spec = { id: 'D2', anode: 'mid', cathode: '0', is: 1e-20, n: 2, rs: 2 }

  it('derives I from the exclusive series resistor: I = (V(in)−V(mid))/R', () => {
    const r = simRes([0, 1, 2], { in: [5, 5, 5], mid: [2, 2, 2] })
    const m = ledAverageCurrents([spec], seriesCkt, r, 0)
    expect(m.get('D2')).toBeCloseTo(3e-3, 9) // (5−2)/1k
  })

  it('clamps reverse phases to 0 (PWM average = duty-weighted forward current)', () => {
    // half the window forward at 3 mA, half reversed (source at −5) → average 1.5 mA
    const r = simRes([0, 1, 1, 2], { in: [5, 5, -5, -5], mid: [2, 2, 0, 0] })
    const m = ledAverageCurrents([spec], seriesCkt, r, 0)
    expect(m.get('D2')).toBeCloseTo(1.5e-3, 6)
  })

  it('PWM-LED end-to-end (real ngspice): 50% duty through 470 Ω reads ~half the on-current', async () => {
    // The marquee ARB-2 demo: a 0/5 V 1 kHz square (analog PWM) through 470 Ω into an LED (Vf ≈ 2 V).
    // On-phase current ≈ (5−2−i·RS)/470 ≈ 6 mA; 50% duty → average ≈ 3 mA. Same .tran shape App runs.
    const IS = 0.01 / Math.exp(2.0 / (2 * 0.02585)) // toCircuit's LED Vf=2 V calibration
    const ckt: Circuit = {
      title: 'pwm led',
      components: [
        { kind: 'vsource', id: 'W1', nodes: ['in', '0'], dc: 0, wave: { type: 'square', offset: 2.5, amplitude: 2.5, freq: 1000, duty: 50 } },
        { kind: 'resistor', id: '1', nodes: ['in', 'mid'], ohms: 470 },
        { kind: 'diode', id: '1', nodes: ['mid', '0'], is: IS, n: 2, rs: 2, bv: 100 },
        { kind: 'ground', id: '0', node: '0' },
      ],
    }
    const sim = new Simulation()
    await sim.start()
    sim.setNetList(buildNetlist(ckt, { kind: 'tran', step: 2e-6, stop: 8e-3 }))
    const r = normalizeResult(await sim.runSim())
    const settle = 4e-3 // average the settled back half (4 whole periods)
    const iAvg = ledAverageCurrents([{ id: 'LED1', anode: 'mid', cathode: '0', is: IS, n: 2, rs: 2 }], ckt, r, settle).get('LED1')!
    expect(iAvg).toBeGreaterThan(2.4e-3) // ≈ 3 mA — half of the ~6 mA on-current
    expect(iAvg).toBeLessThan(3.8e-3)
    const v = settledNodeVoltages(r, settle)
    expect(v.get('in')).toBeGreaterThan(2.3)  // 0/5 V square averages ≈ 2.5 V (DMM reading)
    expect(v.get('in')).toBeLessThan(2.7)
    expect(v.get('mid')).toBeGreaterThan(0.5) // LED node: ~2 V half the time, ~0 the other half
    expect(v.get('mid')).toBeLessThan(1.6)
  }, 30000)

  it('falls back to the diode-model inversion when no exclusive series resistor exists', () => {
    // LED straight across the source (plus a second load on the same node → node not private)
    const ckt: Circuit = {
      title: 't',
      components: [
        { kind: 'vsource', id: 'W1', nodes: ['in', '0'], dc: 0 },
        { kind: 'resistor', id: '1', nodes: ['in', '0'], ohms: 1000 },
        { kind: 'diode', id: '1', nodes: ['in', '0'], is: 1e-20, n: 2, rs: 2 },
        { kind: 'ground', id: '0', node: '0' },
      ],
    }
    const s = { id: 'D2', anode: 'in', cathode: '0', is: 1e-20, n: 2, rs: 2 }
    const vd = 2 * 0.02585 * Math.log(5e-3 / 1e-20 + 1) + 5e-3 * 2 // Vd for exactly 5 mA
    const r = simRes([0, 1], { in: [vd, vd] })
    const m = ledAverageCurrents([s], ckt, r, 0)
    expect(m.get('D2')).toBeCloseTo(5e-3, 6)
  })
})
