import { describe, it, expect } from 'vitest'
import { Simulation } from 'eecircuit-engine'
import { normalizeResult, transferFunction } from './spice'
import { buildNetlist, type Circuit } from './netlist'

const rc: Circuit = {
  title: 'RC low-pass (NET-1 transferFunction test)',
  components: [
    { kind: 'vsource', id: '1', nodes: ['in', '0'], dc: 0, acMag: 1 },
    { kind: 'resistor', id: '1', nodes: ['in', 'out'], ohms: 1000 },
    { kind: 'capacitor', id: '1', nodes: ['out', '0'], farads: 159.155e-9 },
    { kind: 'ground', id: '0', node: '0' },
  ],
}

function lerpAt(freq: Float64Array, y: Float64Array, target: number): number {
  for (let i = 1; i < freq.length; i++) {
    if (freq[i - 1] <= target && freq[i] >= target) {
      const t = (target - freq[i - 1]) / (freq[i] - freq[i - 1])
      return y[i - 1] + t * (y[i] - y[i - 1])
    }
  }
  return NaN
}

describe('transferFunction (Bode)', () => {
  it('RC low-pass: 0 dB passband, -3 dB at ~1 kHz, -45° phase at cutoff', async () => {
    const nl = buildNetlist(rc, { kind: 'ac', sweep: 'dec', points: 100, fStart: 10, fStop: 1e6 })
    const sim = new Simulation()
    await sim.start()
    sim.setNetList(nl)
    const r = transferFunction(normalizeResult(await sim.runSim()), 'out', 'in')

    expect(r.magDb[0]).toBeGreaterThan(-0.2) // flat passband near 0 dB

    // -3 dB cutoff
    let cutoff = NaN
    for (let i = 1; i < r.magDb.length; i++) {
      if (r.magDb[i - 1] >= -3 && r.magDb[i] < -3) { cutoff = r.freq[i]; break }
    }
    expect(cutoff).toBeGreaterThan(950)
    expect(cutoff).toBeLessThan(1050)

    // phase at 1 kHz ≈ -45°
    const phaseAt1k = lerpAt(r.freq, r.phaseDeg, 1000)
    expect(phaseAt1k).toBeGreaterThan(-50)
    expect(phaseAt1k).toBeLessThan(-40)
  }, 30000)
})

import { nodeVoltage, hasNode, differentialVoltage } from './spice'
import { buildNetlist as buildNl } from './netlist'
import type { Circuit as Ckt } from './netlist'

describe('node voltage (.op) for the Voltmeter', () => {
  it('reads DC node voltages and a differential', async () => {
    // V1 in 0 DC 5 ; R1 in->out 1k ; R2 out->0 1k  → V(out)=2.5
    const ckt: Ckt = {
      title: 'divider',
      components: [
        { kind: 'vsource', id: '1', nodes: ['in', '0'], dc: 5 },
        { kind: 'resistor', id: '1', nodes: ['in', 'out'], ohms: 1000 },
        { kind: 'resistor', id: '2', nodes: ['out', '0'], ohms: 1000 },
        { kind: 'ground', id: '0', node: '0' },
      ],
    }
    const nl = buildNl(ckt, { kind: 'op' })
    const sim = new Simulation()
    await sim.start()
    sim.setNetList(nl)
    const r = normalizeResult(await sim.runSim())
    expect(nodeVoltage(r, 'out')).toBeCloseTo(2.5, 3)
    expect(nodeVoltage(r, 'in')).toBeCloseTo(5, 3)
    expect(nodeVoltage(r, '0')).toBe(0)
    expect(hasNode(r, 'out')).toBe(true)
    expect(hasNode(r, 'nope')).toBe(false)
    expect(differentialVoltage(r, 'in', 'out')).toBeCloseTo(2.5, 3)
  }, 30000)
})
