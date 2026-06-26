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
  | 'probe' // (legacy) marks the output node ('out') — same as 'scope1'
  | 'dcrail' // DC supply rail (power for active parts); value = volts
  // Breadboard ports (WIRE-1): instrument I/O placed and wired, named exactly like the M2K.
  | 'awg1' // W1 — DAC Analog Output 1 → net 'in'
  | 'awg2' // W2 — DAC Analog Output 2 → net 'in2'
  | 'scope1' // 1+ — ADC Analog Input 1 Positive → net 'out'
  | 'adc1n' // 1- — ADC Analog Input 1 Negative (Ch1 reference) → net 'out_n'
  | 'scope2' // 2+ — ADC Analog Input 2 Positive → net 'scope2'
  | 'adc2n' // 2- — ADC Analog Input 2 Negative (Ch2 reference) → net 'scope2_n'
  | 'vplus' // V+ — positive supply (0..+5 V)
  | 'vminus' // V- — negative supply (0..-5 V)

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
    case 'awg1':
    case 'awg2':
    case 'scope1':
    case 'scope2':
    case 'adc1n':
    case 'adc2n':
    case 'vplus':
    case 'vminus':
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

// Convert the schematic to a SPICE-2 Circuit. Net labelling: ground→'0', W1→'in', 1+→'out',
// 1-→'out_n', etc. Marker ports (ground / scope / probe) emit no SPICE device.
export function toCircuit(s: Schematic, title = 'Schematic'): ToCircuitResult {
  const nets = computeNets(s)
  const netOf = (gx: number, gy: number) => nets.get(key(gx, gy)) ?? `net_${gx}_${gy}`
  const warnings: string[] = []

  let groundNet: string | undefined
  let inNet: string | undefined
  let in2Net: string | undefined
  let outNet: string | undefined
  let outRefNet: string | undefined
  let scope2Net: string | undefined
  let scope2RefNet: string | undefined
  for (const c of s.components) {
    const net = netOf(terminalsOf(c)[0].gx, terminalsOf(c)[0].gy)
    if (c.kind === 'ground') groundNet = net
    else if (c.kind === 'probe' || c.kind === 'scope1') outNet = net
    else if (c.kind === 'adc1n') outRefNet = net
    else if (c.kind === 'scope2') scope2Net = net
    else if (c.kind === 'adc2n') scope2RefNet = net
    else if (c.kind === 'vsource' || c.kind === 'awg1') inNet = net
    else if (c.kind === 'awg2') in2Net = net
  }
  if (!groundNet) warnings.push('No ground — add a ground symbol.')
  if (!inNet) warnings.push('No source — add a W1 generator output.')
  if (!outNet) warnings.push('No output — add a Scope CH1 input probe.')

  // Connectivity checks: count real (non-marker) component terminals per net.
  const MARKERS = new Set<SchKind>(['ground', 'probe', 'scope1', 'scope2', 'adc1n', 'adc2n'])
  const termCount = new Map<string, number>()
  for (const c of s.components) {
    if (MARKERS.has(c.kind)) continue
    for (const t of terminalsOf(c)) {
      const nn = netOf(t.gx, t.gy)
      termCount.set(nn, (termCount.get(nn) ?? 0) + 1)
    }
  }
  if (inNet && (termCount.get(inNet) ?? 0) < 2) {
    warnings.push('W1 output (in) is not connected to the rest of the circuit.')
  }
  if (outNet && (termCount.get(outNet) ?? 0) < 1) {
    warnings.push('Scope CH1 (out) is not connected to any component.')
  }

  const rename = (net: string) =>
    net === groundNet ? '0'
      : net === inNet ? 'in'
      : net === in2Net ? 'in2'
      : net === outNet ? 'out'
      : net === outRefNet ? 'out_n'
      : net === scope2Net ? 'scope2'
      : net === scope2RefNet ? 'scope2_n'
      : net

  const comps: SpiceComponent[] = []
  let rc = 1, cc = 1, lc = 1, vc = 1, ec = 1, sc = 1, aw = 1
  for (const c of s.components) {
    const ts = terminalsOf(c)
    if (c.kind === 'resistor' || c.kind === 'capacitor' || c.kind === 'inductor' || c.kind === 'vsource') {
      const na = rename(netOf(ts[0].gx, ts[0].gy))
      const nb = rename(netOf(ts[1].gx, ts[1].gy))
      if (c.kind === 'resistor') comps.push({ kind: 'resistor', id: String(rc++), nodes: [na, nb], ohms: c.value ?? 1000 })
      else if (c.kind === 'capacitor') comps.push({ kind: 'capacitor', id: String(cc++), nodes: [na, nb], farads: c.value ?? 1e-9 })
      else if (c.kind === 'inductor') comps.push({ kind: 'inductor', id: String(lc++), nodes: [na, nb], henries: c.value ?? 1e-3 })
      else comps.push({ kind: 'vsource', id: String(vc++), nodes: [na, nb], dc: 0, acMag: 1 })
    } else if (c.kind === 'awg1' || c.kind === 'awg2') {
      // Generator output port: a V source from its node to ground (AC 1 for sweeps).
      comps.push({ kind: 'vsource', id: `W${aw++}`, nodes: [rename(netOf(ts[0].gx, ts[0].gy)), '0'], dc: 0, acMag: 1 })
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
    } else if (c.kind === 'dcrail' || c.kind === 'vplus' || c.kind === 'vminus') {
      const def = c.kind === 'vminus' ? -5 : 5
      comps.push({ kind: 'dcrail', id: `S${sc++}`, node: rename(netOf(ts[0].gx, ts[0].gy)), volts: c.value ?? def })
    }
    // ground / probe / scope1 (1+) / scope2 (2+) / adc1n (1-) / adc2n (2-) are markers.
  }
  if (groundNet) comps.push({ kind: 'ground', id: '0', node: '0' })

  return { circuit: { title, components: comps }, warnings }
}
