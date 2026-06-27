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
  | 'inamp' // ideal instrumentation amp (single VCVS); pins inP/inN/out/ref
  | 'inamp3' // 3-op-amp instrumentation amp (teaches the internal topology)
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
  opModel?: 'ideal' | 'lmc662' // for kind 'opamp': ideal VCVS or the LMC662 behavioural model
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
    case 'inamp':
    case 'inamp3':
      return [
        { name: 'inP', gx: 0, gy: 0 },
        { name: 'inN', gx: 0, gy: 2 },
        { name: 'out', gx: 6, gy: 1 },
        { name: 'ref', gx: 2, gy: 3 },
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

// ── Rubber-band wires (EDIT-1) ─────────────────────────────────────────────────
// When a component moves or rotates, wire endpoints sitting on its terminals follow, so
// connections stretch instead of breaking. Connectivity here is by coordinate coincidence,
// so a wire left behind would silently disconnect — these helpers keep it attached.

export type WireEndRef = { index: number; end: 1 | 2 }

// Wire endpoints currently coincident with any terminal of component `c`. Captured at drag
// start so the editor moves exactly these, never grabbing a wire it merely passes over.
export function attachedWireEnds(s: Schematic, c: SchComponent): WireEndRef[] {
  const terms = new Set(terminalsOf(c).map((t) => key(t.gx, t.gy)))
  const out: WireEndRef[] = []
  s.wires.forEach((w, index) => {
    if (terms.has(key(w.x1, w.y1))) out.push({ index, end: 1 })
    if (terms.has(key(w.x2, w.y2))) out.push({ index, end: 2 })
  })
  return out
}

// Move component `id` to (gx,gy), carrying the given attached wire endpoints by the same delta.
export function moveComponentWithWires(
  s: Schematic, id: string, gx: number, gy: number, attached: WireEndRef[],
): Schematic {
  const c = s.components.find((x) => x.id === id)
  if (!c) return s
  const dgx = gx - c.gx, dgy = gy - c.gy
  if (dgx === 0 && dgy === 0) return s
  const m = new Set(attached.map((a) => `${a.index}:${a.end}`))
  return {
    components: s.components.map((x) => (x.id === id ? { ...x, gx, gy } : x)),
    wires: s.wires.map((w, i) => {
      let nw = w
      if (m.has(`${i}:1`)) nw = { ...nw, x1: nw.x1 + dgx, y1: nw.y1 + dgy }
      if (m.has(`${i}:2`)) nw = { ...nw, x2: nw.x2 + dgx, y2: nw.y2 + dgy }
      return nw
    }),
  }
}

// Rotate component `id` one quarter-turn clockwise, carrying terminal-attached wire endpoints
// to the rotated terminal positions (matched by terminal index).
export function rotateComponentWithWires(s: Schematic, id: string): Schematic {
  const c = s.components.find((x) => x.id === id)
  if (!c) return s
  const oldT = terminalsOf(c)
  const nc = { ...c, rotation: (((c.rotation ?? 0) + 1) % 4) }
  const newT = terminalsOf(nc)
  const map = new Map<string, { gx: number; gy: number }>()
  oldT.forEach((t, i) => map.set(key(t.gx, t.gy), { gx: newT[i].gx, gy: newT[i].gy }))
  return {
    components: s.components.map((x) => (x.id === id ? nc : x)),
    wires: s.wires.map((w) => {
      let nw = w
      const a = map.get(key(w.x1, w.y1)); if (a) nw = { ...nw, x1: a.gx, y1: a.gy }
      const b = map.get(key(w.x2, w.y2)); if (b) nw = { ...nw, x2: b.gx, y2: b.gy }
      return nw
    }),
  }
}

export interface ToCircuitResult {
  circuit: Circuit
  warnings: string[]
  // SPICE node each scope input is wired to (WIRE-3 readback). undefined if the port is not
  // placed. ch1 = 1+ node, ch2 = 2+ node. Lets the scope show whatever node a probe sits on.
  probes: { ch1?: string; ch2?: string }
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
  let rc = 1, cc = 1, lc = 1, vc = 1, ec = 1, sc = 1, aw = 1, ic = 1
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
      // Generator output through the M2K AWG output impedance: an ideal source then a 49.9 Ohm
      // series resistor (R132 after the AD8000 buffer) into the wired node. Loading the generator
      // with a low resistance divides the amplitude down, exactly as on the bench. The source keeps
      // id W1/W2 so applyGeneratorParams stamps it. See docs/reference/m2k-spec.md.
      const outNet = rename(netOf(ts[0].gx, ts[0].gy))
      const srcNet = `w${aw}_src`
      comps.push({ kind: 'vsource', id: `W${aw}`, nodes: [srcNet, '0'], dc: 0, acMag: 1 })
      comps.push({ kind: 'resistor', id: `aout${aw}`, nodes: [srcNet, outNet], ohms: 49.9 })
      aw++
    } else if (c.kind === 'opamp') {
      comps.push({
        kind: 'opamp',
        id: String(ec++),
        model: c.opModel ?? 'ideal',
        nodes: {
          inP: rename(netOf(ts[0].gx, ts[0].gy)),
          inN: rename(netOf(ts[1].gx, ts[1].gy)),
          out: rename(netOf(ts[2].gx, ts[2].gy)),
        },
      })
    } else if (c.kind === 'inamp' || c.kind === 'inamp3') {
      // Friendly default: if REF is left unwired (only the in-amp touches that net), tie it to
      // ground so a beginner circuit still solves instead of going singular.
      const refRaw = netOf(ts[3].gx, ts[3].gy)
      const refNet = (termCount.get(refRaw) ?? 0) >= 2 ? rename(refRaw) : '0'
      comps.push({
        kind: 'inamp',
        id: String(ic++),
        model: c.kind === 'inamp3' ? 'threeopamp' : 'ideal',
        nodes: {
          inP: rename(netOf(ts[0].gx, ts[0].gy)),
          inN: rename(netOf(ts[1].gx, ts[1].gy)),
          out: rename(netOf(ts[2].gx, ts[2].gy)),
          ref: refNet,
        },
        gain: c.value ?? 10,
      })
    } else if (c.kind === 'dcrail' || c.kind === 'vplus' || c.kind === 'vminus') {
      const def = c.kind === 'vminus' ? -5 : 5
      comps.push({ kind: 'dcrail', id: `S${sc++}`, node: rename(netOf(ts[0].gx, ts[0].gy)), volts: c.value ?? def })
    }
    // ground / probe / scope1 (1+) / scope2 (2+) / adc1n (1-) / adc2n (2-) are markers.
  }
  if (groundNet) comps.push({ kind: 'ground', id: '0', node: '0' })

  const probes = {
    ch1: outNet ? rename(outNet) : undefined,
    ch2: scope2Net ? rename(scope2Net) : undefined,
  }
  return { circuit: { title, components: comps }, warnings, probes }
}
