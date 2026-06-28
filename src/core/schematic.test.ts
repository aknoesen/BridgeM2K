import { describe, it, expect } from 'vitest'
import { Simulation } from 'eecircuit-engine'
import { Schematic, toCircuit, terminalsOf, ampCategory } from './schematic'
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
    const r = circuit.components.find((c) => c.kind === 'resistor' && (c as { ohms: number }).ohms === 1000)!
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
    const r = circuit.components.find((c) => c.kind === 'resistor' && (c as { ohms: number }).ohms === 1000)!
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

describe('scope probe mapping (WIRE-3)', () => {
  it('maps 1+ to its node and 2+ to the input it is wired to', () => {
    const sch: Schematic = {
      components: [
        { id: 'W1', kind: 'awg1', gx: 0, gy: 0 },
        { id: 'R1', kind: 'resistor', gx: 4, gy: 0, value: 1000 },
        { id: 'C1', kind: 'capacitor', gx: 6, gy: 0, value: 159.155e-9 },
        { id: 'G1', kind: 'ground', gx: 8, gy: 0 },
        { id: 'S1', kind: 'scope1', gx: 6, gy: 0 }, // 1+ on the R-C junction → 'out'
        { id: 'S2', kind: 'scope2', gx: 0, gy: 0 }, // 2+ on the W1 input node → 'in'
      ],
      wires: [{ x1: 0, y1: 0, x2: 4, y2: 0 }], // W1 → R.a → 'in'
    }
    const { warnings, probes } = toCircuit(sch)
    expect(warnings).toEqual([])
    expect(probes.ch1).toBe('out')
    expect(probes.ch2).toBe('in')
  })
})

import { attachedWireEnds, moveComponentWithWires, rotateComponentWithWires, computeNets } from './schematic'

describe('rubber-band wires (EDIT-1)', () => {
  it('moving a component carries attached wire endpoints by the same delta', () => {
    const s: Schematic = {
      components: [{ id: 'R1', kind: 'resistor', gx: 4, gy: 0, value: 1000 }],
      wires: [
        { x1: 2, y1: 0, x2: 4, y2: 0 }, // end2 on R.a (4,0)
        { x1: 6, y1: 0, x2: 8, y2: 0 }, // end1 on R.b (6,0)
      ],
    }
    const attached = attachedWireEnds(s, s.components[0])
    expect(attached).toEqual([{ index: 0, end: 2 }, { index: 1, end: 1 }])
    const moved = moveComponentWithWires(s, 'R1', 4, 3, attached) // drag down 3
    expect(moved.components[0]).toMatchObject({ gx: 4, gy: 3 })
    expect(moved.wires[0]).toEqual({ x1: 2, y1: 0, x2: 4, y2: 3 }) // attached end followed
    expect(moved.wires[1]).toEqual({ x1: 6, y1: 3, x2: 8, y2: 0 }) // fixed ends stayed put
  })

  it('rotating a component carries attached endpoints to the rotated terminals; stays connected', () => {
    const s: Schematic = {
      components: [{ id: 'R1', kind: 'resistor', gx: 4, gy: 4, rotation: 0 }],
      wires: [{ x1: 8, y1: 4, x2: 6, y2: 4 }], // end2 on R.b (6,4)
    }
    const r = rotateComponentWithWires(s, 'R1')
    // R.b rotates (6,4) → (4,6); the wire end follows so the connection is preserved
    expect(r.wires[0]).toEqual({ x1: 8, y1: 4, x2: 4, y2: 6 })
    const nets = computeNets(r)
    expect(nets.get('4,6')).toBe(nets.get('8,4'))
  })
})

import { nodeVoltage } from './spice'
import { applyGeneratorParams } from './netlist'

describe('AWG output impedance (49.9 Ohm, R132)', () => {
  it('loading W1 with 49.9 Ohm halves the amplitude', async () => {
    // W1 at (0,0); a 49.9 Ohm load from (0,0) to GND at (2,0). Series R132 (49.9) + load (49.9)
    // form a 2:1 divider, so V(in) = half the source.
    const sch: Schematic = {
      components: [
        { id: 'W1', kind: 'awg1', gx: 0, gy: 0 },
        { id: 'R1', kind: 'resistor', gx: 0, gy: 0, value: 49.9 },
        { id: 'G1', kind: 'ground', gx: 2, gy: 0 },
      ],
      wires: [],
    }
    const drawn = toCircuit(sch)
    const ckt = applyGeneratorParams(drawn.circuit, {
      waveType: 'sine', frequency: 1000, amplitude: 0, offset: 1, dutyCycle: 50,
      samplingRate: 100000, duration: 0.016,
    }, undefined)
    const sim = new Simulation()
    await sim.start()
    sim.setNetList(buildNetlist(ckt, { kind: 'op' }))
    const r = normalizeResult(await sim.runSim())
    expect(nodeVoltage(r, 'in')).toBeCloseTo(0.5, 2)
  }, 30000)
})

describe('multi-ground (toCircuit)', () => {
  it('every ground symbol normalises to 0', () => {
    const sch: Schematic = {
      components: [
        { id: 'U1', kind: 'opamp', gx: 6, gy: 2 }, // inP(6,2) inN(6,4) out(10,3)
        { id: 'G1', kind: 'ground', gx: 4, gy: 2 }, // wired to inP
        { id: 'G2', kind: 'ground', gx: 8, gy: 9 }, // a SECOND, separate ground
      ],
      wires: [{ x1: 6, y1: 2, x2: 4, y2: 2 }], // inP -> G1
    }
    const d = toCircuit(sch, 't')
    const op = d.circuit.components.find((c) => c.kind === 'opamp') as { nodes: { inP: string } }
    expect(op.nodes.inP).toBe('0') // grounded via G1 even though G2 is the last ground seen
  })
})

describe('op-amp is always a packaged LMC662', () => {
  it('op-amp schematic symbol exposes only inP/inN/out (power implied)', () => {
    const op = terminalsOf({ id: 'U1', kind: 'opamp', gx: 0, gy: 0 })
    expect(op.map((t) => t.name).sort()).toEqual(['inN', 'inP', 'out'])
  })

  it('op-amp netlist is the LMC662 model, auto-powered (no wired rails)', () => {
    const sch: Schematic = { components: [{ id: 'U1', kind: 'opamp', gx: 6, gy: 2 }], wires: [] }
    const op = toCircuit(sch, 't').circuit.components.find((c) => c.kind === 'opamp') as
      { model?: string; nodes: { vpos?: string; vneg?: string } }
    expect(op.model).toBe('lmc662')
    expect(op.nodes.vpos).toBeUndefined()
    expect(op.nodes.vneg).toBeUndefined()
  })

  it('every op-amp / amp is a buildable part', () => {
    expect(ampCategory({ id: 'a', kind: 'opamp', gx: 0, gy: 0 })).toBe('build')
    expect(ampCategory({ id: 'a', kind: 'lmc662', gx: 0, gy: 0 })).toBe('build')
    expect(ampCategory({ id: 'a', kind: 'inamp', gx: 0, gy: 0 })).toBe('sim')
    expect(ampCategory({ id: 'a', kind: 'inamp3', gx: 0, gy: 0 })).toBe('sim')
    expect(ampCategory({ id: 'a', kind: 'resistor', gx: 0, gy: 0 })).toBeNull()
  })
})

describe('LMC662 dual DIP (toCircuit)', () => {
  it('expands to two LMC662 sections sharing the V+/V- rails', () => {
    const sch: Schematic = {
      components: [
        { id: 'U1', kind: 'lmc662', gx: 10, gy: 4 },
        { id: 'G1', kind: 'ground', gx: 8, gy: 6 },
      ],
      wires: [{ x1: 10, y1: 6, x2: 8, y2: 6 }],
    }
    const d = toCircuit(sch, 'dip')
    const ops = d.circuit.components.filter((c) => c.kind === 'opamp') as
      Array<{ id: string; model?: string; nodes: { vpos?: string; vneg?: string } }>
    expect(ops.length).toBe(2)
    expect(ops.every((o) => o.model === 'lmc662')).toBe(true)
    expect(ops[0].nodes.vpos).toBe(ops[1].nodes.vpos)
    expect(ops[0].nodes.vneg).toBe(ops[1].nodes.vneg)
    expect(ops[0].nodes.vpos).not.toBe(ops[0].nodes.vneg)
  })
})

import { moveComponentsBy } from './schematic'
describe('moveComponentsBy (group drag)', () => {
  it('translates selected parts and their attached wire ends; stretches links to non-selected', () => {
    const s: Schematic = {
      components: [
        { id: 'R1', kind: 'resistor', gx: 2, gy: 2, value: 1 },
        { id: 'R2', kind: 'resistor', gx: 6, gy: 2, value: 1 },
      ],
      wires: [
        { x1: 4, y1: 2, x2: 6, y2: 2 }, // R1.b -> R2.a (both selected)
        { x1: 8, y1: 2, x2: 12, y2: 2 }, // R2.b -> external (only R2 selected)
      ],
    }
    const out = moveComponentsBy(s, new Set(['R1', 'R2']), 0, 3)
    expect(out.components.find((c) => c.id === 'R1')!.gy).toBe(5)
    expect(out.components.find((c) => c.id === 'R2')!.gy).toBe(5)
    expect(out.wires[0]).toEqual({ x1: 4, y1: 5, x2: 6, y2: 5 })
    expect(out.wires[1]).toEqual({ x1: 8, y1: 5, x2: 12, y2: 2 }) // stretched
  })
})

import { moveSelectionBy } from './schematic'
describe('moveSelectionBy (box group move incl. loose wires)', () => {
  it('moves listed wire ends (loose segments) and terminal-attached ends', () => {
    const s: Schematic = {
      components: [{ id: 'R1', kind: 'resistor', gx: 2, gy: 2, value: 1 }],
      wires: [
        { x1: 10, y1: 10, x2: 14, y2: 10 }, // loose wire, both ends boxed
        { x1: 2, y1: 2, x2: 5, y2: 2 }, // one end on R1.a, far end not boxed
      ],
    }
    const out = moveSelectionBy(s, new Set(['R1']), new Set(['0:1', '0:2']), 0, 3)
    expect(out.wires[0]).toEqual({ x1: 10, y1: 13, x2: 14, y2: 13 }) // loose wire moved whole
    expect(out.wires[1]).toEqual({ x1: 2, y1: 5, x2: 5, y2: 2 }) // R1 end follows, far end stays
    expect(out.components[0].gy).toBe(5)
  })
})
