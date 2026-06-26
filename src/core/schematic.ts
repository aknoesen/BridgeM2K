// Schematic model + conversion to the SPICE-2 Circuit graph. No React, no rendering.
// See docs/specs/schematic-ngspice.md (SCH-1). The editor (SchematicEditor.tsx) drives this
// model; `toCircuit()` is the seam consumed by the Network Analyzer / scope loop (SCH-2/LOOP-1).

import type { Circuit, Component as SpiceComponent } from './netlist'

export type SchKind =
  | 'resistor'
  | 'capacitor'
  | 'inductor'
  | 'vsource' // generator input source; terminal 'a' = +, 'b' = -
  | 'opamp'
  | 'ground'
  | 'probe' // marks the output node ('out')
  | 'dcrail' // DC supply rail (power for active parts); value = volts

export interface SchComponent {
  id: string
  kind: SchKind
  gx: number // grid position (grid units)
  gy: number
  rotation?: number // 0..3 → 0/90/180/270 degrees clockwise (default 0)
  value?: number // ohms / farads / henries (vsource uses AC 1)
}

export interface Wire {
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface Schematic {
  components: SchComponent[]
  wires: Wire[]
}

export interface SchTerminal {
  name: string
  gx: number
  gy: number
}

// Base terminal offsets per kind (grid units), unrotated (horizontal) orientation.
export function baseTerminals(kind: SchKind): SchTerminal[] {
  switch (kind) {
    case 'resistor':
    case 'capacitor':
    case 'inductor':
    case 'vsource':
      return [
        { name: 'a', gx: 0, gy: 0 },
        { name: 'b', gx: 2, gy: 0 },
      ]
    case 'opamp':
      return [
        { name: 'inP', gx: 0, gy: 0 },
        { name: 'inN', gx: 0, gy: 2 },
        { name: 'out', gx: 4, gy: 1 },
      ]
    case 'ground':
    case 'probe':
    case 'dcrail':
      return [{ name: 'p', gx: 0, gy: 0 }]
  }
}

// Rotate a grid offset by r quarter-turns clockwise (screen coords, y down).
export function rotateOffset(dx: number, dy: number, r: number): [number, number] {
  switch (((r % 4) + 4) % 4) {
    case 0: return [dx, dy]
    case 1: return [-dy, dx]
    case 2: return [-dx, -dy]
    default: return [dy, -dx]
  }
}

// Absolute (rotated) terminal grid positions for net computation and rendering.
export function terminalsOf(c: SchComponent): SchTerminal[] {
  const r = c.rotation ?? 0
  return baseTerminals(c.kind).map((t) => {
    const [dx, dy] = rotateOffset(t.gx, t.gy, r)
    return { name: t.name, gx: c.gx + dx, gy: c.gy + dy }
  })
}

const key = (x: number, y: number) => `${x},${y}`

// Union-find over coordinate keys. Points that coincide share a key (auto-connected);
// wires union their endpoints. Returns pointKey → netName.
export function computeNets(s: Schematic): Map<string, string> {
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

  for (const c of s.components) for (const t of terminalsOf(c)) ensure(key(t.gx, t.gy))
  for (const w of s.wires) union(key(w.x1, w.y1), key(w.x2, w.y2))

  const rootName = new Map<string, string>()
  let n = 0
  const out = new Map<string, string>()
  for (const k of parent.keys()) {
    const r = find(k)
    if (!rootName.has(r)) rootName.set(r, `net${n++}`)
    out.set(k, rootName.get(r)!)
  }
  return out
}

export interface ToCircuitResult {
  circuit: Circuit
  warnings: string[]
}

// Convert the schematic to a SPICE-2 Circuit. Net labelling: ground→'0', the V source '+'
// net→'in', the probe net→'out'. Ground/probe are markers and emit no SPICE device (a single
// `ground` marker is appended so buildNetlist normalises '0').
export function toCircuit(s: Schematic, title = 'Schematic'): ToCircuitResult {
  const nets = computeNets(s)
  const netOf = (gx: number, gy: number) => nets.get(key(gx, gy)) ?? `net_${gx}_${gy}`
  const warnings: string[] = []

  let groundNet: string | undefined
  let inNet: string | undefined
  let outNet: string | undefined
  for (const c of s.components) {
    const ts = terminalsOf(c)
    if (c.kind === 'ground') groundNet = netOf(ts[0].gx, ts[0].gy)
    if (c.kind === 'probe') outNet = netOf(ts[0].gx, ts[0].gy)
    if (c.kind === 'vsource') inNet = netOf(ts[0].gx, ts[0].gy)
  }
  if (!groundNet) warnings.push('No ground — add a ground symbol.')
  if (!inNet) warnings.push('No source — add a voltage source (generator input).')
  if (!outNet) warnings.push('No output probe — mark the output node.')

  // Connectivity checks: count real (non-marker) component terminals per net.
  const termCount = new Map<string, number>()
  for (const c of s.components) {
    if (c.kind === 'ground' || c.kind === 'probe') continue
    for (const t of terminalsOf(c)) {
      const n = netOf(t.gx, t.gy)
      termCount.set(n, (termCount.get(n) ?? 0) + 1)
    }
  }
  if (inNet && (termCount.get(inNet) ?? 0) < 2) {
    warnings.push('Source output (in) is not connected to the rest of the circuit.')
  }
  if (outNet && (termCount.get(outNet) ?? 0) < 1) {
    warnings.push('Output node (out) is not connected to any component.')
  }

  const rename = (net: string) =>
    net === groundNet ? '0' : net === inNet ? 'in' : net === outNet ? 'out' : net

  const comps: SpiceComponent[] = []
  let rc = 1, cc = 1, lc = 1, vc = 1, ec = 1, sc = 1
  for (const c of s.components) {
    const ts = terminalsOf(c)
    if (c.kind === 'resistor' || c.kind === 'capacitor' || c.kind === 'inductor' || c.kind === 'vsource') {
      const na = rename(netOf(ts[0].gx, ts[0].gy))
      const nb = rename(netOf(ts[1].gx, ts[1].gy))
      if (c.kind === 'resistor') comps.push({ kind: 'resistor', id: String(rc++), nodes: [na, nb], ohms: c.value ?? 1000 })
      else if (c.kind === 'capacitor') comps.push({ kind: 'capacitor', id: String(cc++), nodes: [na, nb], farads: c.value ?? 1e-9 })
      else if (c.kind === 'inductor') comps.push({ kind: 'inductor', id: String(lc++), nodes: [na, nb], henries: c.value ?? 1e-3 })
      else comps.push({ kind: 'vsource', id: String(vc++), nodes: [na, nb], dc: 0, acMag: 1 })
    } else if (c.kind === 'opamp') {
      comps.push({
        kind: 'opamp',
        id: String(ec++),
        nodes: {
          inP: rename(netOf(ts[0].gx, ts[0].gy)),
          inN: rename(netOf(ts[1].gx, ts[1].gy)),
          out: rename(netOf(ts[2].gx, ts[2].gy)),
        },
      })
    } else if (c.kind === 'dcrail') {
      comps.push({ kind: 'dcrail', id: `S${sc++}`, node: rename(netOf(ts[0].gx, ts[0].gy)), volts: c.value ?? 5 })
    }
  }
  if (groundNet) comps.push({ kind: 'ground', id: '0', node: '0' })

  return { circuit: { title, components: comps }, warnings }
}
