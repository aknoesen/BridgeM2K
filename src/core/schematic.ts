// Schematic model + conversion to the SPICE-2 Circuit graph. No React, no rendering.
// See docs/specs/schematic-ngspice.md (SCH-1). The editor (SchematicEditor.tsx) drives this
// model; `toCircuit()` is the seam consumed by the Network Analyzer / scope loop (SCH-2/LOOP-1).

import type { Circuit, Component as SpiceComponent } from './netlist'

export type SchKind =
  | 'resistor'
  | 'capacitor'
  | 'inductor'
  | 'diode' // junction diode; terminal 'a' = anode, 'c' = cathode (bar end)
  | 'led' // LED; value = forward voltage Vf (V)
  | 'zener' // Zener diode; value = reverse breakdown voltage BV (V)
  | 'vsource' // generator input source; terminal 'a' = +, 'b' = -
  | 'opamp'
  | 'lmc662' // LMC662 dual op-amp as an 8-pin DIP (two LMC662 sections + V+/V- rails)
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
// `opModel` matters only for kind 'opamp': the ideal (simulation-only) op-amp is a bare
// VCVS with no supply pins, so it exposes inP/inN/out only. The LMC662 (simulation+build)
// model is a real part that needs power, so it also exposes the V+/V- rail pins.
export function baseTerminals(kind: SchKind, opModel?: 'ideal' | 'lmc662'): SchTerminal[] {
  switch (kind) {
    case 'resistor':
    case 'capacitor':
    case 'inductor':
    case 'vsource':
      return [
        { name: 'a', gx: 0, gy: 0 },
        { name: 'b', gx: 2, gy: 0 },
      ]
    case 'diode':
    case 'led':
    case 'zener':
      return [
        { name: 'a', gx: 0, gy: 0 }, // anode (triangle side)
        { name: 'c', gx: 2, gy: 0 }, // cathode (bar side)
      ]
    case 'opamp': {
      const pins: SchTerminal[] = [
        { name: 'inP', gx: 0, gy: 0 },
        { name: 'inN', gx: 0, gy: 2 },
        { name: 'out', gx: 4, gy: 1 },
      ]
      if (opModel === 'lmc662') {
        pins.push({ name: 'vpos', gx: 2, gy: -1 }) // V+ power pin (top)
        pins.push({ name: 'vneg', gx: 2, gy: 3 })  // V- power pin (bottom)
      }
      return pins
    }
    case 'lmc662':
      // 8-pin DIP, real pinout. Left side pins 1-4 top→bottom, right side pins 5-8 bottom→top.
      return [
        { name: 'outA', gx: 0, gy: 0 },   // 1: OUT A
        { name: 'inAneg', gx: 0, gy: 1 }, // 2: -IN A
        { name: 'inApos', gx: 0, gy: 2 }, // 3: +IN A
        { name: 'vneg', gx: 0, gy: 3 },   // 4: V-
        { name: 'inBpos', gx: 4, gy: 3 }, // 5: +IN B
        { name: 'inBneg', gx: 4, gy: 2 }, // 6: -IN B
        { name: 'outB', gx: 4, gy: 1 },   // 7: OUT B
        { name: 'vpos', gx: 4, gy: 0 },   // 8: V+
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
  return baseTerminals(c.kind, c.opModel).map((t) => {
    const [dx, dy] = rotateOffset(t.gx, t.gy, r)
    return { name: t.name, gx: c.gx + dx, gy: c.gy + dy }
  })
}

// Whether a part is a simulation-only model (ideal, no supplies needed) or a
// simulation+build part (a real device that needs explicit V+/V- rails, like the LMC662).
// Returns null for parts that are not amplifiers. Single source of truth for the editor badge.
export function ampCategory(c: SchComponent): 'sim' | 'build' | null {
  switch (c.kind) {
    case 'opamp': return c.opModel === 'lmc662' ? 'build' : 'sim'
    case 'lmc662': return 'build'
    case 'inamp':
    case 'inamp3': return 'sim'
    default: return null
  }
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

// Translate a SET of components by (ddx, ddy), carrying along any wire endpoint that sits on a
// selected component's terminal. A wire between two selected parts translates whole; a wire from a
// selected part to a non-selected one stretches. Used for multi-select group drag in the editor.
export function moveComponentsBy(s: Schematic, ids: Set<string>, ddx: number, ddy: number): Schematic {
  if ((ddx === 0 && ddy === 0) || ids.size === 0) return s
  const moved = new Set<string>()
  const selCoords = new Set<string>()
  for (const c of s.components) {
    if (!ids.has(c.id)) continue
    moved.add(c.id)
    for (const t of terminalsOf(c)) selCoords.add(key(t.gx, t.gy))
  }
  return {
    components: s.components.map((c) => (moved.has(c.id) ? { ...c, gx: c.gx + ddx, gy: c.gy + ddy } : c)),
    wires: s.wires.map((w) => {
      const e1 = selCoords.has(key(w.x1, w.y1))
      const e2 = selCoords.has(key(w.x2, w.y2))
      return {
        x1: e1 ? w.x1 + ddx : w.x1, y1: e1 ? w.y1 + ddy : w.y1,
        x2: e2 ? w.x2 + ddx : w.x2, y2: e2 ? w.y2 + ddy : w.y2,
      }
    }),
  }
}

// Group move for a box selection: translate the given component ids AND the given wire endpoints
// (refs "<index>:1" / "<index>:2") by (ddx, ddy). Wire endpoints also move if they sit on a
// selected component's terminal, so connections stay attached. This is the "move everything in the
// box" behaviour — components and the wire segments inside the box travel together.
export function moveSelectionBy(
  s: Schematic, ids: Set<string>, wireEnds: Set<string>, ddx: number, ddy: number,
): Schematic {
  if ((ddx === 0 && ddy === 0) || (ids.size === 0 && wireEnds.size === 0)) return s
  const moved = new Set<string>()
  const selCoords = new Set<string>()
  for (const c of s.components) {
    if (!ids.has(c.id)) continue
    moved.add(c.id)
    for (const t of terminalsOf(c)) selCoords.add(key(t.gx, t.gy))
  }
  return {
    components: s.components.map((c) => (moved.has(c.id) ? { ...c, gx: c.gx + ddx, gy: c.gy + ddy } : c)),
    wires: s.wires.map((w, i) => {
      const m1 = selCoords.has(key(w.x1, w.y1)) || wireEnds.has(`${i}:1`)
      const m2 = selCoords.has(key(w.x2, w.y2)) || wireEnds.has(`${i}:2`)
      return {
        x1: m1 ? w.x1 + ddx : w.x1, y1: m1 ? w.y1 + ddy : w.y1,
        x2: m2 ? w.x2 + ddx : w.x2, y2: m2 ? w.y2 + ddy : w.y2,
      }
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
  probes: { ch1?: string; ch1n?: string; ch2?: string; ch2n?: string }
}

// Convert the schematic to a SPICE-2 Circuit. Net labelling: ground→'0', W1→'in', 1+→'out',
// 1-→'out_n', etc. Marker ports (ground / scope / probe) emit no SPICE device.
export function toCircuit(s: Schematic, title = 'Schematic'): ToCircuitResult {
  const nets = computeNets(s)
  const netOf = (gx: number, gy: number) => nets.get(key(gx, gy)) ?? `net_${gx}_${gy}`
  const warnings: string[] = []

  const groundNets = new Set<string>() // every ground symbol's net normalises to '0'
  let inNet: string | undefined
  let in2Net: string | undefined
  let railNet: string | undefined // a DC supply rail (V+/V-) also counts as a source (DC labs)
  let outNet: string | undefined
  let outRefNet: string | undefined
  let scope2Net: string | undefined
  let scope2RefNet: string | undefined
  for (const c of s.components) {
    const net = netOf(terminalsOf(c)[0].gx, terminalsOf(c)[0].gy)
    if (c.kind === 'ground') groundNets.add(net)
    else if (c.kind === 'probe' || c.kind === 'scope1') outNet = net
    else if (c.kind === 'adc1n') outRefNet = net
    else if (c.kind === 'scope2') scope2Net = net
    else if (c.kind === 'adc2n') scope2RefNet = net
    else if (c.kind === 'vsource' || c.kind === 'awg1') inNet = net
    else if (c.kind === 'awg2') in2Net = net
    else if (c.kind === 'vplus' || c.kind === 'vminus' || c.kind === 'dcrail') railNet = net
  }
  if (groundNets.size === 0) warnings.push('No ground — add a ground symbol.')
  if (!inNet && !railNet) warnings.push('No source — add a W1 generator output or a V+ supply rail.')
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
    groundNets.has(net) ? '0'
      : net === inNet ? 'in'
      : net === in2Net ? 'in2'
      : net === outNet ? 'out'
      : net === outRefNet ? 'out_n'
      : net === scope2Net ? 'scope2'
      : net === scope2RefNet ? 'scope2_n'
      : net

  const comps: SpiceComponent[] = []
  let rc = 1, cc = 1, lc = 1, vc = 1, ec = 1, sc = 1, aw = 1, ic = 1, dd = 1
  for (const c of s.components) {
    const ts = terminalsOf(c)
    if (c.kind === 'resistor' || c.kind === 'capacitor' || c.kind === 'inductor' || c.kind === 'vsource') {
      const na = rename(netOf(ts[0].gx, ts[0].gy))
      const nb = rename(netOf(ts[1].gx, ts[1].gy))
      if (c.kind === 'resistor') comps.push({ kind: 'resistor', id: String(rc++), nodes: [na, nb], ohms: c.value ?? 1000 })
      else if (c.kind === 'capacitor') comps.push({ kind: 'capacitor', id: String(cc++), nodes: [na, nb], farads: c.value ?? 1e-9 })
      else if (c.kind === 'inductor') comps.push({ kind: 'inductor', id: String(lc++), nodes: [na, nb], henries: c.value ?? 1e-3 })
      else comps.push({ kind: 'vsource', id: String(vc++), nodes: [na, nb], dc: 0, acMag: 1 })
    } else if (c.kind === 'diode' || c.kind === 'led' || c.kind === 'zener') {
      const na = rename(netOf(ts[0].gx, ts[0].gy)), nk = rename(netOf(ts[1].gx, ts[1].gy))
      let p: { is?: number; n?: number; rs?: number; bv?: number } = {}
      if (c.kind === 'led') {
        // Set IS so the forward drop ≈ the chosen Vf (V) at ~10 mA, with LED-like ideality N=2.
        const vf = c.value ?? 2.0, N = 2.0, VT = 0.02585, Iref = 0.01
        p = { is: Iref / Math.exp(vf / (N * VT)), n: N, rs: 2, bv: 100 }
      } else if (c.kind === 'zener') {
        p = { bv: c.value ?? 3.3 } // silicon forward (~0.7 V); reverse breaks down at −BV
      }
      comps.push({ kind: 'diode', id: String(dd++), nodes: [na, nk], ...p })
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
      // Ideal op-amp has only inP/inN/out (ts[3]/ts[4] absent). LMC662 adds the rail pins.
      const tvpos = ts[3], tvneg = ts[4]
      comps.push({
        kind: 'opamp',
        id: String(ec++),
        model: c.opModel ?? 'ideal',
        nodes: {
          inP: rename(netOf(ts[0].gx, ts[0].gy)),
          inN: rename(netOf(ts[1].gx, ts[1].gy)),
          out: rename(netOf(ts[2].gx, ts[2].gy)),
          ...(tvpos ? { vpos: rename(netOf(tvpos.gx, tvpos.gy)) } : {}),
          ...(tvneg ? { vneg: rename(netOf(tvneg.gx, tvneg.gy)) } : {}),
        },
      })
    } else if (c.kind === 'lmc662') {
      // Dual DIP → two LMC662 op-amp sections (A, B) sharing the V+/V- rail pins.
      const net = (i: number) => rename(netOf(ts[i].gx, ts[i].gy))
      const vpos = net(7), vneg = net(3) // pin 8 = V+, pin 4 = V-
      const k = ec++
      comps.push({ kind: 'opamp', id: `${k}A`, model: 'lmc662', nodes: { inP: net(2), inN: net(1), out: net(0), vpos, vneg } })
      comps.push({ kind: 'opamp', id: `${k}B`, model: 'lmc662', nodes: { inP: net(4), inN: net(5), out: net(6), vpos, vneg } })
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
  if (groundNets.size > 0) comps.push({ kind: 'ground', id: '0', node: '0' })

  const probes = {
    ch1: outNet ? rename(outNet) : undefined,
    ch1n: outRefNet ? rename(outRefNet) : undefined,   // 1- reference (differential CH1)
    ch2: scope2Net ? rename(scope2Net) : undefined,
    ch2n: scope2RefNet ? rename(scope2RefNet) : undefined, // 2- reference (differential CH2)
  }
  return { circuit: { title, components: comps }, warnings, probes }
}
