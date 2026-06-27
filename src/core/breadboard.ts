// Solderless breadboard model (Track F, phase F-1). No React, no rendering.
// The board imposes a fixed internal connectivity — each 5-hole terminal column is common, the
// two banks are split by the center channel, and each power rail runs the board's length. Nets
// are computed the same way as the schematic (union-find over hole coordinates), so a board
// layout can later be checked for electrical equivalence with a drawn circuit (F-2).
// See docs/specs/breadboard.md.

import { computeNets, terminalsOf, type Schematic, type SchKind } from './schematic'

export const COLS = 30
export const PITCH = 18   // px between adjacent holes
export const PAD = 22

export type Row = 'TP' | 'TN' | 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h' | 'i' | 'j' | 'BP' | 'BN'
export type HoleKind = 'railP' | 'railN' | 'term'

interface RowDef { row: Row; slot: number; kind: HoleKind; railGroup?: string }

// Row layout top → bottom. Slots 2, 8, 14 are intentional gaps (rail spacer + center channel).
const ROWS: RowDef[] = [
  { row: 'TP', slot: 0,  kind: 'railP', railGroup: 'RAIL_TP' },
  { row: 'TN', slot: 1,  kind: 'railN', railGroup: 'RAIL_TN' },
  { row: 'a',  slot: 3,  kind: 'term' },
  { row: 'b',  slot: 4,  kind: 'term' },
  { row: 'c',  slot: 5,  kind: 'term' },
  { row: 'd',  slot: 6,  kind: 'term' },
  { row: 'e',  slot: 7,  kind: 'term' },
  { row: 'f',  slot: 9,  kind: 'term' },
  { row: 'g',  slot: 10, kind: 'term' },
  { row: 'h',  slot: 11, kind: 'term' },
  { row: 'i',  slot: 12, kind: 'term' },
  { row: 'j',  slot: 13, kind: 'term' },
  { row: 'BP', slot: 15, kind: 'railP', railGroup: 'RAIL_BP' },
  { row: 'BN', slot: 16, kind: 'railN', railGroup: 'RAIL_BN' },
]
const TOP_BANK = new Set<Row>(['a', 'b', 'c', 'd', 'e'])
export const CHANNEL_SLOT = 8 // center-channel row slot (for rendering)
export const ROW_SLOTS = 17

export interface Hole {
  key: string
  col: number
  row: Row
  x: number
  y: number
  group: string   // internal-connection group (the net the board pre-wires this hole into)
  kind: HoleKind
}

export const holeKey = (row: Row, col: number): string => `${row}${col}`

export function buildHoles(cols = COLS): Hole[] {
  const holes: Hole[] = []
  for (const rd of ROWS) {
    for (let col = 1; col <= cols; col++) {
      const group = rd.railGroup ?? (TOP_BANK.has(rd.row) ? `T${col}` : `B${col}`)
      holes.push({
        key: holeKey(rd.row, col),
        col, row: rd.row,
        x: PAD + (col - 1) * PITCH,
        y: PAD + rd.slot * PITCH,
        group, kind: rd.kind,
      })
    }
  }
  return holes
}

export const boardWidth = (cols = COLS): number => PAD * 2 + (cols - 1) * PITCH
export const boardHeight = (): number => PAD * 2 + (ROW_SLOTS - 1) * PITCH

export interface Jumper { a: string; b: string } // hole keys

// Union-find over hole keys: seed by internal group, then union jumpers. Returns holeKey → net.
// (Component legs are added in F-2; legs do NOT union to each other — a 2-terminal part bridges
// two nets, it does not short them.)
export function boardNets(holes: Hole[], jumpers: Jumper[] = []): Map<string, string> {
  const parent = new Map<string, string>()
  const ensure = (k: string) => { if (!parent.has(k)) parent.set(k, k) }
  const find = (a: string): string => {
    let r = a
    while (parent.get(r) !== r) r = parent.get(r)!
    while (parent.get(a) !== r) { const n = parent.get(a)!; parent.set(a, r); a = n }
    return r
  }
  const union = (a: string, b: string) => {
    ensure(a); ensure(b)
    const ra = find(a), rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }

  const groupRep = new Map<string, string>()
  for (const h of holes) {
    ensure(h.key)
    const rep = groupRep.get(h.group)
    if (rep === undefined) groupRep.set(h.group, h.key)
    else union(h.key, rep)
  }
  for (const j of jumpers) union(j.a, j.b)

  const name = new Map<string, string>()
  let n = 0
  const out = new Map<string, string>()
  for (const k of parent.keys()) {
    const r = find(k)
    if (!name.has(r)) name.set(r, `bn${n++}`)
    out.set(k, name.get(r)!)
  }
  return out
}

// ── F-2: placed parts, ports, and the schematic-equivalence check ───────────────

// Canonical M2K port names, keyed by the schematic port kind. These anchor the board↔schematic
// mapping during the equivalence check.
export const PORT_NAME: Partial<Record<SchKind, string>> = {
  awg1: 'W1', awg2: 'W2', scope1: '1+', adc1n: '1-', scope2: '2+', adc2n: '2-',
  vplus: 'V+', vminus: 'V-', ground: 'GND',
}
// 2-pin parts a student places on the board (F-2). DIP parts (op-amp/in-amp) are F-3.
export const PLACEABLE_KINDS = new Set<SchKind>(['resistor', 'capacitor', 'inductor'])

// DIP/IC parts placed on the board (F-3). Unlike a 2-pin part, every pin is its own net and the
// body must straddle the center channel: pins sit in the two channel-adjacent term rows (e and f),
// so each pin lands in its own isolated terminal column.
export const DIP_KINDS = new Set<SchKind>(['lmc662'])
export const DIP_TOP_ROW: Row = 'e' // top-bank row adjacent to the channel
export const DIP_BOT_ROW: Row = 'f' // bottom-bank row adjacent to the channel

// Columns a DIP spans (pins split evenly across the two rows). LMC662 = 8 pins → 4 columns.
export function dipCols(kind: SchKind): number {
  return kind === 'lmc662' ? 4 : 0
}

// Hole keys for a DIP whose top-left pin sits at (DIP_TOP_ROW, col), ordered to match the schematic
// terminal order from terminalsOf (LMC662: OUTA,-A,+A,V-,+B,-B,OUTB,V+ = pins 1..8). Convention:
// pin 1 bottom-left, pins 1→n along the bottom row L→R, pins n+1→2n along the top row R→L
// (notch faces left). Returns null if the kind is not a DIP or it would overrun the board.
export function dipPinHoles(kind: SchKind, col: number): string[] | null {
  const n = dipCols(kind)
  if (n === 0 || col < 1 || col + n - 1 > COLS) return null
  const bottom: string[] = [], top: string[] = []
  for (let i = 0; i < n; i++) {
    bottom.push(holeKey(DIP_BOT_ROW, col + i)) // pins 1..n
    top.push(holeKey(DIP_TOP_ROW, col + i))
  }
  return [...bottom, ...top.reverse()] // top row R→L gives pins n+1..2n
}

export interface PlacedPart { id: string; kind: SchKind; value?: number; aHole: string; bHole: string }
export interface PlacedPort { port: string; hole: string }
// A placed DIP is anchored by its top-left pin column; pin holes derive via dipPinHoles().
export interface PlacedDip { id: string; kind: SchKind; col: number }
export interface BoardLayout { parts: PlacedPart[]; jumpers: Jumper[]; ports: PlacedPort[]; dips?: PlacedDip[] }

export const emptyBoard = (): BoardLayout => ({ parts: [], jumpers: [], ports: [], dips: [] })

// What the schematic expects on the board: its R/C/L parts (with each leg's net) and its ports.
export interface SchematicExpectation {
  parts: { id: string; kind: SchKind; a: string; b: string }[]
  dips: { id: string; kind: SchKind; pinNets: string[] }[]
  ports: { name: string; net: string }[]
}
export function schematicExpectation(s: Schematic): SchematicExpectation {
  const nets = computeNets(s)
  const netOf = (gx: number, gy: number) => nets.get(`${gx},${gy}`) ?? `x_${gx}_${gy}`
  const parts: SchematicExpectation['parts'] = []
  const dips: SchematicExpectation['dips'] = []
  const ports = new Map<string, string>()
  for (const c of s.components) {
    const ts = terminalsOf(c)
    if (PLACEABLE_KINDS.has(c.kind)) {
      parts.push({ id: c.id, kind: c.kind, a: netOf(ts[0].gx, ts[0].gy), b: netOf(ts[1].gx, ts[1].gy) })
    } else if (DIP_KINDS.has(c.kind)) {
      dips.push({ id: c.id, kind: c.kind, pinNets: ts.map((t) => netOf(t.gx, t.gy)) })
    } else {
      const name = PORT_NAME[c.kind]
      if (name && !ports.has(name)) ports.set(name, netOf(ts[0].gx, ts[0].gy))
    }
  }
  return { parts, dips, ports: [...ports].map(([name, net]) => ({ name, net })) }
}

export interface CheckResult { ok: boolean; message: string }

function pinLabel(pin: string): string {
  const dip = /^(.*)\.p(\d+)$/.exec(pin)
  if (dip) return `${dip[1]} pin ${dip[2]}`
  const m = /^(.*)\.([AB])$/.exec(pin)
  return m ? `${m[1]} pin ${m[2]}` : pin
}

// Compare the board's node partition to the schematic's. Equivalent iff two pins share a
// schematic net exactly when they share a board net (ports anchor the mapping). Returns the
// first problem found, with a student-friendly message.
export function checkEquivalence(s: Schematic, board: BoardLayout, holes: Hole[]): CheckResult {
  const exp = schematicExpectation(s)
  if (exp.parts.length === 0 && exp.dips.length === 0 && exp.ports.length === 0) {
    return { ok: false, message: 'Draw a circuit in the Circuit tab first.' }
  }
  const placedPart = new Map(board.parts.map((p) => [p.id, p]))
  const placedDip = new Map((board.dips ?? []).map((d) => [d.id, d]))
  const placedPort = new Map(board.ports.map((p) => [p.port, p]))

  for (const p of exp.parts) if (!placedPart.has(p.id)) return { ok: false, message: `Place ${p.id} on the board.` }
  for (const d of exp.dips) if (!placedDip.has(d.id)) return { ok: false, message: `Place ${d.id} on the board (straddle the channel).` }
  for (const p of exp.ports) if (!placedPort.has(p.name)) return { ok: false, message: `Place the ${p.name} connection on the board.` }

  const bnets = boardNets(holes, board.jumpers)
  const bn = (k: string) => bnets.get(k) ?? `?${k}`

  const schem = new Map<string, string>()
  const brd = new Map<string, string>()
  for (const p of exp.parts) {
    const pl = placedPart.get(p.id)!
    schem.set(`${p.id}.A`, p.a); brd.set(`${p.id}.A`, bn(pl.aHole))
    schem.set(`${p.id}.B`, p.b); brd.set(`${p.id}.B`, bn(pl.bHole))
  }
  for (const d of exp.dips) {
    const pl = placedDip.get(d.id)!
    const holesForDip = dipPinHoles(d.kind, pl.col) ?? []
    d.pinNets.forEach((net, k) => {
      schem.set(`${d.id}.p${k + 1}`, net)
      brd.set(`${d.id}.p${k + 1}`, bn(holesForDip[k] ?? `?${d.id}.${k}`))
    })
  }
  for (const p of exp.ports) {
    schem.set(p.name, p.net); brd.set(p.name, bn(placedPort.get(p.name)!.hole))
  }

  const pins = [...schem.keys()]
  for (let i = 0; i < pins.length; i++) {
    for (let j = i + 1; j < pins.length; j++) {
      const sameS = schem.get(pins[i]) === schem.get(pins[j])
      const sameB = brd.get(pins[i]) === brd.get(pins[j])
      if (sameS && !sameB) return { ok: false, message: `${pinLabel(pins[i])} and ${pinLabel(pins[j])} should be the same node — run a jumper.` }
      if (!sameS && sameB) return { ok: false, message: `${pinLabel(pins[i])} and ${pinLabel(pins[j])} are different nodes, but your board connects them.` }
    }
  }
  return { ok: true, message: '✓ Match — your board is electrically the schematic.' }
}
