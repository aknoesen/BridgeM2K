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
export function boardNets(holes: Hole[], jumpers: Jumper[] = [], terminals: Terminal[] = TERMINALS): Map<string, string> {
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
  // Fixed M2K terminals join the same graph; all GND terminals collapse to one node.
  for (const t of terminals) {
    ensure(t.key)
    const g = terminalGroup(t)
    const rep = groupRep.get(g)
    if (rep === undefined) groupRep.set(g, t.key)
    else union(t.key, rep)
  }
  for (const w of POWER_WIRES) union(w.a, w.b) // standard, always-present power distribution
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
// 2-pin parts a student places on the board (F-2): passives plus the 2-terminal semiconductors.
export const PLACEABLE_KINDS = new Set<SchKind>(['resistor', 'capacitor', 'inductor', 'diode', 'led', 'zener'])

// Kinds the board cannot lay out yet (multi-pin actives with no board footprint): the in-amps.
// (Op-amps now board as an LMC662 DIP.) A circuit with any of these can't be transferred, so the
// Board view says so rather than silently dropping them.
export const UNBOARDABLE_KINDS = new Set<SchKind>(['inamp', 'inamp3'])
export function unboardable(s: Schematic): { id: string; kind: SchKind }[] {
  return s.components.filter((c) => UNBOARDABLE_KINDS.has(c.kind)).map((c) => ({ id: c.id, kind: c.kind }))
}

// ── F-5: fixed M2K connector strips (always present) ─────────────────────────────
// Mirrors the UC Davis adaptor board's two 1×15 headers: the M2K signals come out on fixed
// terminals top and bottom, and the student jumpers from them into the breadboard. Each terminal
// is a fixed node in the net graph; ALL GND terminals share one node (the M2K ground). `port` ties
// a terminal to a schematic port for the equivalence check; TI (trigger-in) is unused in-course
// and carries no port. `color` drives the course wiring convention (red +V, blue −V, neutral GND).
export type TermColor = 'pos' | 'neg' | 'gnd' | 'signal'
export interface Terminal { key: string; name: string; port?: string; side: 'top' | 'bottom'; col: number; color: TermColor }
const GND_GROUP = 'GND_RAIL'

const TOP_DEF: { name: string; port?: string; color: TermColor }[] = [
  { name: '1+', port: '1+', color: 'signal' },
  { name: '2+', port: '2+', color: 'signal' },
  { name: 'GND', port: 'GND', color: 'gnd' },
  { name: 'V+', port: 'V+', color: 'pos' },
  { name: 'W1', port: 'W1', color: 'signal' },
  { name: 'GND', port: 'GND', color: 'gnd' },
  { name: 'TI', color: 'signal' },
]
const BOT_DEF: { name: string; port?: string; color: TermColor }[] = [
  { name: '1-', port: '1-', color: 'signal' },
  { name: '2-', port: '2-', color: 'signal' },
  { name: 'GND', port: 'GND', color: 'gnd' },
  { name: 'V-', port: 'V-', color: 'neg' },
  { name: 'W2', port: 'W2', color: 'signal' },
  { name: 'GND', port: 'GND', color: 'gnd' },
]

// Spread n terminals across the board with a 2-column margin each side, aligned to hole columns.
function spreadCols(n: number): number[] {
  const span = COLS - 4
  return Array.from({ length: n }, (_, i) => Math.round(3 + (span * i) / (n - 1)))
}

export const TERMINALS: Terminal[] = (() => {
  const out: Terminal[] = []
  spreadCols(TOP_DEF.length).forEach((col, i) => out.push({ key: `TT${i}`, ...TOP_DEF[i], side: 'top', col }))
  spreadCols(BOT_DEF.length).forEach((col, i) => out.push({ key: `TB${i}`, ...BOT_DEF[i], side: 'bottom', col }))
  return out
})()

// Net-seed group for a terminal (all GND terminals collapse to one node).
const terminalGroup = (t: Terminal): string => (t.color === 'gnd' ? GND_GROUP : `TERM_${t.key}`)

// port name → the terminal key that provides it (first match; GND resolves to the shared node).
export const PORT_TERMINAL: Record<string, string> = (() => {
  const m: Record<string, string> = {}
  for (const t of TERMINALS) if (t.port && !(t.port in m)) m[t.port] = t.key
  return m
})()

// Standard power distribution, always present (modelling the habit students should keep): GND to the
// two OUTER rails (top TP, bottom BN), V+ to the top INNER rail (TN), V− to the bottom INNER rail
// (BP). Each wire is coloured by its terminal. These are fixed (not user jumpers) so the rails are
// always powered and the convention is always visible.
export interface PowerWire { a: string; b: string; color: TermColor }
export const POWER_WIRES: PowerWire[] = (() => {
  const topGnd = TERMINALS.find((t) => t.side === 'top' && t.color === 'gnd')!
  const botGnd = TERMINALS.find((t) => t.side === 'bottom' && t.color === 'gnd')!
  const vp = TERMINALS.find((t) => t.port === 'V+')!
  const vn = TERMINALS.find((t) => t.port === 'V-')!
  return [
    { a: topGnd.key, b: holeKey('TP', topGnd.col), color: 'gnd' }, // GND → top outer rail
    { a: botGnd.key, b: holeKey('BN', botGnd.col), color: 'gnd' }, // GND → bottom outer rail
    { a: vp.key, b: holeKey('TN', vp.col), color: 'pos' },         // V+  → top inner rail
    { a: vn.key, b: holeKey('BP', vn.col), color: 'neg' },         // V−  → bottom inner rail
  ]
})()

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
  // pinNets is indexed by DIP pin (pin1 = index 0). `undefined` = an unused pin (no constraint).
  // needsRails: the part is powered, so the Check also requires its V+/V- pins on the supply rails.
  dips: { id: string; kind: SchKind; pinNets: (string | undefined)[]; needsRails?: boolean }[]
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
    } else if (c.kind === 'opamp') {
      // One LMC662 section on the schematic → an 8-pin DIP on the board. Map its signal pins to the
      // DIP pinout (1=OUTA,2=-A,3=+A,8=V+,4=V-); pins 5-7 (section B) are unused; V+/V- come via the
      // rails (needsRails), not the schematic.
      const byName = new Map(ts.map((t) => [t.name, netOf(t.gx, t.gy)]))
      const pinNets = [byName.get('out'), byName.get('inN'), byName.get('inP'), undefined, undefined, undefined, undefined, undefined]
      dips.push({ id: c.id, kind: 'lmc662', pinNets, needsRails: true })
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

  for (const p of exp.parts) if (!placedPart.has(p.id)) return { ok: false, message: `Place ${p.id} on the board.` }
  for (const d of exp.dips) if (!placedDip.has(d.id)) return { ok: false, message: `Place ${d.id} on the board (straddle the channel).` }
  // Ports are the always-present M2K terminals now; the student jumpers from them (no placement step).

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
      if (net === undefined) return // unused pin — no constraint
      schem.set(`${d.id}.p${k + 1}`, net)
      brd.set(`${d.id}.p${k + 1}`, bn(holesForDip[k] ?? `?${d.id}.${k}`))
    })
    // A powered part must have its supply pins on the rails (LMC662: pin 8 = V+, pin 4 = V−).
    if (d.needsRails) {
      if (bn(holesForDip[7] ?? '?') !== bn(PORT_TERMINAL['V+'])) return { ok: false, message: `Wire ${d.id} pin 8 (V+) to the V+ rail.` }
      if (bn(holesForDip[3] ?? '?') !== bn(PORT_TERMINAL['V-'])) return { ok: false, message: `Wire ${d.id} pin 4 (V−) to the V− rail.` }
    }
  }
  for (const p of exp.ports) {
    schem.set(p.name, p.net); brd.set(p.name, bn(PORT_TERMINAL[p.name] ?? `?${p.name}`))
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
