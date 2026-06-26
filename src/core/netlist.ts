// Circuit graph model + ngspice netlist generator — no UI, no React.
// See docs/specs/schematic-ngspice.md (phase SPICE-2).
//
// Flow:  UI/editor → Circuit (this model) → buildNetlist() → ngspice string → SpiceEngine.
// This module is the only place that knows ngspice netlist syntax; the editor and
// instruments work in terms of the typed Circuit graph.

import type { SignalParams } from './signal'

// A net is a named node. '0' (and 'gnd'/'GND') are ground and are normalised to '0'.
export type Net = string

export interface Resistor {
  kind: 'resistor'
  id: string // refdes suffix, e.g. '1' -> R1
  nodes: [Net, Net]
  ohms: number
}
export interface Capacitor {
  kind: 'capacitor'
  id: string
  nodes: [Net, Net]
  farads: number
}
export interface Inductor {
  kind: 'inductor'
  id: string
  nodes: [Net, Net]
  henries: number
}

// Independent voltage source — typically the Signal Generator input.
// `dc` is the operating-point value; `acMag` is emitted for .ac sweeps (default 1);
// `sine` (offset, amplitude, freq) is emitted as SIN(...) for .tran.
export interface VSource {
  kind: 'vsource'
  id: string
  nodes: [Net, Net] // [positive, negative]
  dc?: number
  acMag?: number
  sine?: { offset: number; amplitude: number; freq: number }
}

// DC supply rail set by the Power Supply instrument (PSU-1). Referenced to ground.
export interface DCRail {
  kind: 'dcrail'
  id: string // e.g. 'pos' -> Vpos
  node: Net
  volts: number
}

// Ideal op-amp, emitted as a high-gain VCVS (E device). `vpos`/`vneg` rail nets are carried
// for future powered/clipping models; the ideal VCVS ignores them for now.
export interface OpAmp {
  kind: 'opamp'
  id: string // e.g. '1' -> E1
  nodes: { inP: Net; inN: Net; out: Net; vpos?: Net; vneg?: Net }
  gain?: number // open-loop gain (default 1e6)
}

// Ground marker — declares which net is ground. Emits no device line; the net is
// normalised to '0' everywhere.
export interface Ground {
  kind: 'ground'
  id: string
  node: Net
}

export type Component =
  | Resistor
  | Capacitor
  | Inductor
  | VSource
  | DCRail
  | OpAmp
  | Ground

export interface Circuit {
  title: string
  components: Component[]
}

export type Analysis =
  | { kind: 'tran'; step: number; stop: number; start?: number }
  | { kind: 'ac'; sweep: 'dec' | 'oct' | 'lin'; points: number; fStart: number; fStop: number }
  | { kind: 'op' }
  | { kind: 'dc'; source: string; start: number; stop: number; step: number }

// ── helpers ────────────────────────────────────────────────────────────────────

// Locale-independent number formatting ngspice accepts (plain or scientific).
function fmt(x: number): string {
  return Number.isFinite(x) ? String(x) : '0'
}

const GROUND_ALIASES = new Set(['0', 'gnd', 'GND', 'Gnd'])

function collectGroundNets(circuit: Circuit): Set<string> {
  const s = new Set<string>(GROUND_ALIASES)
  for (const c of circuit.components) if (c.kind === 'ground') s.add(c.node)
  return s
}

function vsourceSpec(v: VSource, analysis: Analysis): string {
  const parts: string[] = [`DC ${fmt(v.dc ?? 0)}`]
  if (analysis.kind === 'ac') parts.push(`AC ${fmt(v.acMag ?? 1)}`)
  if (v.sine && analysis.kind === 'tran') {
    parts.push(`SIN(${fmt(v.sine.offset)} ${fmt(v.sine.amplitude)} ${fmt(v.sine.freq)})`)
  }
  return parts.join(' ')
}

function analysisDirective(a: Analysis): string {
  switch (a.kind) {
    case 'tran':
      return `.tran ${fmt(a.step)} ${fmt(a.stop)}${a.start !== undefined ? ` ${fmt(a.start)}` : ''}`
    case 'ac':
      return `.ac ${a.sweep} ${fmt(a.points)} ${fmt(a.fStart)} ${fmt(a.fStop)}`
    case 'op':
      return '.op'
    case 'dc':
      return `.dc ${a.source} ${fmt(a.start)} ${fmt(a.stop)} ${fmt(a.step)}`
  }
}

// ── netlist generation ───────────────────────────────────────────────────────────

export function buildNetlist(circuit: Circuit, analysis: Analysis): string {
  const groundNets = collectGroundNets(circuit)
  const n = (net: Net): string => (groundNets.has(net) ? '0' : net)

  const lines: string[] = [circuit.title]
  for (const c of circuit.components) {
    switch (c.kind) {
      case 'resistor':
        lines.push(`R${c.id} ${n(c.nodes[0])} ${n(c.nodes[1])} ${fmt(c.ohms)}`)
        break
      case 'capacitor':
        lines.push(`C${c.id} ${n(c.nodes[0])} ${n(c.nodes[1])} ${fmt(c.farads)}`)
        break
      case 'inductor':
        lines.push(`L${c.id} ${n(c.nodes[0])} ${n(c.nodes[1])} ${fmt(c.henries)}`)
        break
      case 'vsource':
        lines.push(`V${c.id} ${n(c.nodes[0])} ${n(c.nodes[1])} ${vsourceSpec(c, analysis)}`)
        break
      case 'dcrail':
        lines.push(`V${c.id} ${n(c.node)} 0 DC ${fmt(c.volts)}`)
        break
      case 'opamp':
        lines.push(
          `E${c.id} ${n(c.nodes.out)} 0 ${n(c.nodes.inP)} ${n(c.nodes.inN)} ${fmt(c.gain ?? 1e6)}`,
        )
        break
      case 'ground':
        break // net normalisation only
    }
  }
  lines.push(analysisDirective(analysis))
  lines.push('.end')
  return lines.join('\n')
}

// ── SignalParams → source mapping ─────────────────────────────────────────────────
// Maps the Signal Generator params onto an input VSource. Sine maps to ngspice SIN(...)
// for transient; AC sweeps use AC 1. Non-sine transient drive (square/triangle/sawtooth
// via PULSE/PWL) is a later extension — the Network Analyzer uses AC sine anyway.
export function sineFromParams(p: SignalParams): { offset: number; amplitude: number; freq: number } {
  return { offset: p.offset, amplitude: p.amplitude, freq: p.frequency }
}

export function makeInputSource(id: string, pos: Net, neg: Net, p: SignalParams): VSource {
  return { kind: 'vsource', id, nodes: [pos, neg], dc: 0, acMag: 1, sine: sineFromParams(p) }
}

// WIRE-2: stamp the Signal Generator settings onto the W1/W2 source components so the same
// circuit drives correctly under any analysis (AC 1 for sweeps, SIN(...) for transient, the
// DC offset for operating point). See docs/specs/schematic-ngspice.md (analysis-aware sources).
export function applyGeneratorParams(circuit: Circuit, w1?: SignalParams, w2?: SignalParams): Circuit {
  return {
    ...circuit,
    components: circuit.components.map((c) => {
      if (c.kind !== 'vsource') return c
      const p = c.id === 'W1' ? w1 : c.id === 'W2' ? w2 : undefined
      if (!p) return c
      return { ...c, dc: p.offset, acMag: 1, sine: { offset: p.offset, amplitude: p.amplitude, freq: p.frequency } }
    }),
  }
}
