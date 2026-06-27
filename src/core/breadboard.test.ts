import { describe, it, expect } from 'vitest'
import { buildHoles, boardNets, holeKey } from './breadboard'

describe('breadboard nets (F-1)', () => {
  const holes = buildHoles()

  it('a 5-hole terminal column is internally common', () => {
    const nets = boardNets(holes)
    expect(nets.get('a1')).toBe(nets.get('e1'))   // whole column a..e of col 1
    expect(nets.get('a5')).toBe(nets.get('c5'))
  })

  it('the center channel keeps the two banks apart', () => {
    const nets = boardNets(holes)
    expect(nets.get('a1')).not.toBe(nets.get('f1')) // top bank vs bottom bank, same column
  })

  it('a power rail runs the full length and + / - rails are separate', () => {
    const nets = boardNets(holes)
    expect(nets.get('TP1')).toBe(nets.get('TP30'))
    expect(nets.get('TP1')).not.toBe(nets.get('TN1'))
    expect(nets.get('TP1')).not.toBe(nets.get('BP1')) // top + rail ≠ bottom + rail
  })

  it('adjacent columns are separate until a jumper unions them', () => {
    const plain = boardNets(holes)
    expect(plain.get('a1')).not.toBe(plain.get('a5'))
    const jumped = boardNets(holes, [{ a: holeKey('e', 1), b: holeKey('a', 5) }])
    expect(jumped.get('a1')).toBe(jumped.get('c5')) // col1 and col5 now one node
  })
})

import { checkEquivalence, type BoardLayout } from './breadboard'
import { type Schematic } from './schematic'

// W1 -> R1 -> (out) -> C1 -> GND ; 1+ probes the R-C node.
const rcSch: Schematic = {
  components: [
    { id: 'W1', kind: 'awg1', gx: 0, gy: 0 },
    { id: 'R1', kind: 'resistor', gx: 4, gy: 0, value: 1000 },
    { id: 'C1', kind: 'capacitor', gx: 6, gy: 0, value: 100e-9 },
    { id: 'G1', kind: 'ground', gx: 8, gy: 0 },
    { id: 'S1', kind: 'scope1', gx: 6, gy: 0 },
  ],
  wires: [{ x1: 0, y1: 0, x2: 4, y2: 0 }], // W1 -> R.a => 'in'
}

// Correct transfer: col1 = in (W1 + R1.a), col3 = out (R1.b + 1+ + C1.a), col5 = gnd (C1.b + GND).
function correctBoard(): BoardLayout {
  return {
    parts: [
      { id: 'R1', kind: 'resistor', aHole: 'b1', bHole: 'a3' },
      { id: 'C1', kind: 'capacitor', aHole: 'c3', bHole: 'a5' },
    ],
    jumpers: [],
    ports: [
      { port: 'W1', hole: 'a1' },
      { port: '1+', hole: 'b3' },
      { port: 'GND', hole: 'b5' },
    ],
  }
}

describe('breadboard equivalence (F-2)', () => {
  const holes = buildHoles()

  it('a correct transfer matches the schematic', () => {
    const r = checkEquivalence(rcSch, correctBoard(), holes)
    expect(r.ok).toBe(true)
  })

  it('reports a missing part', () => {
    const b = correctBoard(); b.parts = b.parts.filter((p) => p.id !== 'C1')
    expect(checkEquivalence(rcSch, b, holes).message).toContain('C1')
  })

  it('reports a split node (output not common)', () => {
    const b = correctBoard(); b.parts[1].aHole = 'a4' // C1.a moved to col4 ≠ col3 (out)
    const r = checkEquivalence(rcSch, b, holes)
    expect(r.ok).toBe(false)
    expect(r.message.toLowerCase()).toContain('same node')
  })

  it('reports an accidental short', () => {
    const b = correctBoard(); b.ports[2].hole = 'b3' // GND into col3 (= out) → shorts out to gnd
    const r = checkEquivalence(rcSch, b, holes)
    expect(r.ok).toBe(false)
    expect(r.message.toLowerCase()).toContain('different nodes')
  })

  it('a jumper can join two columns to fix a split', () => {
    const b = correctBoard(); b.parts[1].aHole = 'a4'           // out split into col3 and col4
    b.jumpers = [{ a: 'b4', b: 'd3' }]                          // jumper col4 <-> col3 re-joins out
    expect(checkEquivalence(rcSch, b, holes).ok).toBe(true)
  })
})

import { schematicExpectation, dipPinHoles } from './breadboard'

describe('breadboard DIP placement (F-3)', () => {
  const holes = buildHoles()
  const dipSch: Schematic = { components: [{ id: 'U1', kind: 'lmc662', gx: 10, gy: 4 }], wires: [] }

  it('dipPinHoles places 8 pins straddling rows e/f, pin 1 bottom-left', () => {
    expect(dipPinHoles('lmc662', 5)).toEqual(['f5', 'f6', 'f7', 'f8', 'e8', 'e7', 'e6', 'e5'])
  })

  it('rejects a DIP that overruns the board', () => {
    expect(dipPinHoles('lmc662', 28)).toBeNull() // 28..31 > 30 columns
  })

  it('the schematic expects the LMC662 as a DIP with 8 pin nets', () => {
    const exp = schematicExpectation(dipSch)
    expect(exp.dips).toHaveLength(1)
    expect(exp.dips[0].pinNets).toHaveLength(8)
  })

  it('reports a DIP that has not been placed', () => {
    const r = checkEquivalence(dipSch, { parts: [], jumpers: [], ports: [], dips: [] }, holes)
    expect(r.ok).toBe(false)
    expect(r.message).toContain('U1')
  })

  it('a placed lone DIP matches (every pin its own isolated column)', () => {
    const b: BoardLayout = { parts: [], jumpers: [], ports: [], dips: [{ id: 'U1', kind: 'lmc662', col: 5 }] }
    expect(checkEquivalence(dipSch, b, holes).ok).toBe(true)
  })

  it('a jumper shorting two DIP pins is flagged', () => {
    const b: BoardLayout = { parts: [], jumpers: [{ a: 'f5', b: 'f6' }], ports: [], dips: [{ id: 'U1', kind: 'lmc662', col: 5 }] }
    const r = checkEquivalence(dipSch, b, holes)
    expect(r.ok).toBe(false)
    expect(r.message.toLowerCase()).toContain('connects them')
  })
})
