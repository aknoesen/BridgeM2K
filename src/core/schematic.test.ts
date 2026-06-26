import { describe, it, expect } from 'vitest'
import { Simulation } from 'eecircuit-engine'
import { Schematic, toCircuit } from './schematic'
import { buildNetlist } from './netlist'
import { normalizeResult, transferFunction } from './spice'

// V(0,0)+ —wire→ R(4,0); R.b(6,0)=C.a(6,0)=probe → out; C.b(8,0)=ground; V.b(2,0)—wire→ground
const rcSchematic: Schematic = {
  components: [
    { id: 'V1', kind: 'vsource', gx: 0, gy: 0 },
    { id: 'R1', kind: 'resistor', gx: 4, gy: 0, value: 1000 },
    { id: 'C1', kind: 'capacitor', gx: 6, gy: 0, value: 159.155e-9 },
    { id: 'G1', kind: 'ground', gx: 8, gy: 0 },
    { id: 'P1', kind: 'probe', gx: 6, gy: 0 },
  ],
  wires: [
    { x1: 0, y1: 0, x2: 4, y2: 0 }, // V+ to R.a → 'in'
    { x1: 2, y1: 0, x2: 8, y2: 0 }, // V- to ground → '0'
  ],
}

describe('schematic toCircuit', () => {
  it('converts an RC low-pass to the expected SPICE circuit', () => {
    const { circuit, warnings } = toCircuit(rcSchematic, 'RC')
    expect(warnings).toEqual([])
    const r = circuit.components.find((c) => c.kind === 'resistor')!
    const c = circuit.components.find((x) => x.kind === 'capacitor')!
    const v = circuit.components.find((x) => x.kind === 'vsource')!
    expect((r as any).nodes).toEqual(['in', 'out'])
    expect((c as any).nodes).toEqual(['out', '0'])
    expect((v as any).nodes).toEqual(['in', '0'])
  })

  it('simulates the converted circuit to -3 dB near 1 kHz', async () => {
    const { circuit } = toCircuit(rcSchematic, 'RC')
    const nl = buildNetlist(circuit, { kind: 'ac', sweep: 'dec', points: 50, fStart: 10, fStop: 1e6 })
    const sim = new Simulation()
    await sim.start()
    sim.setNetList(nl)
    const tf = transferFunction(normalizeResult(await sim.runSim()), 'out', 'in')
    let cutoff = NaN
    for (let i = 1; i < tf.magDb.length; i++) {
      if (tf.magDb[i - 1] >= -3 && tf.magDb[i] < -3) { cutoff = tf.freq[i]; break }
    }
    expect(cutoff).toBeGreaterThan(900)
    expect(cutoff).toBeLessThan(1100)
  }, 30000)
})

describe('schematic validation', () => {
  it('warns when ground is missing', () => {
    const noGround: Schematic = {
      components: [
        { id: 'V1', kind: 'vsource', gx: 0, gy: 0 },
        { id: 'R1', kind: 'resistor', gx: 4, gy: 0, value: 1000 },
        { id: 'P1', kind: 'probe', gx: 6, gy: 0 },
      ],
      wires: [{ x1: 0, y1: 0, x2: 4, y2: 0 }],
    }
    const { warnings } = toCircuit(noGround)
    expect(warnings.some((w) => w.toLowerCase().includes('ground'))).toBe(true)
  })

  it('warns when the source output is floating', () => {
    const floating: Schematic = {
      components: [
        { id: 'V1', kind: 'vsource', gx: 0, gy: 0 }, // + at (0,0), not wired anywhere
        { id: 'G1', kind: 'ground', gx: 2, gy: 0 },  // wired to V- at (2,0)
        { id: 'R1', kind: 'resistor', gx: 8, gy: 4, value: 1000 },
        { id: 'P1', kind: 'probe', gx: 8, gy: 4 },
      ],
      wires: [],
    }
    const { warnings } = toCircuit(floating)
    expect(warnings.some((w) => w.toLowerCase().includes('not connected'))).toBe(true)
  })
})

describe('breadboard ports (WIRE-1)', () => {
  it('W1 + Scope1 ports build the RC and simulate to ~1 kHz', async () => {
    const sch: Schematic = {
      components: [
        { id: 'W1', kind: 'awg1', gx: 0, gy: 0 },
        { id: 'R1', kind: 'resistor', gx: 4, gy: 0, value: 1000 },
        { id: 'C1', kind: 'capacitor', gx: 6, gy: 0, value: 159.155e-9 },
        { id: 'G1', kind: 'ground', gx: 8, gy: 0 },
        { id: 'P1', kind: 'scope1', gx: 6, gy: 0 },
      ],
      wires: [{ x1: 0, y1: 0, x2: 4, y2: 0 }], // W1 → R.a → 'in'
    }
    const { circuit, warnings } = toCircuit(sch)
    expect(warnings).toEqual([])
    const r = circuit.components.find((c) => c.kind === 'resistor')!
    expect((r as { nodes: string[] }).nodes).toEqual(['in', 'out'])

    const nl = buildNetlist(circuit, { kind: 'ac', sweep: 'dec', points: 50, fStart: 10, fStop: 1e6 })
    const sim = new Simulation()
    await sim.start()
    sim.setNetList(nl)
    const tf = transferFunction(normalizeResult(await sim.runSim()), 'out', 'in')
    let cutoff = NaN
    for (let i = 1; i < tf.magDb.length; i++) {
      if (tf.magDb[i - 1] >= -3 && tf.magDb[i] < -3) { cutoff = tf.freq[i]; break }
    }
    expect(cutoff).toBeGreaterThan(900)
    expect(cutoff).toBeLessThan(1100)
  }, 30000)
})
