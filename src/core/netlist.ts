// Circuit graph model + ngspice netlist generator — no UI, no React.
// See docs/specs/schematic-ngspice.md (phase SPICE-2). SCH-8 adds BJT/MOSFET parts.
//
// Flow:  UI/editor → Circuit (this model) → buildNetlist() → ngspice string → SpiceEngine.
// This module is the only place that knows ngspice netlist syntax; the editor and
// instruments work in terms of the typed Circuit graph.

import type { SignalParams, WaveType } from './signal'

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

// Full waveform drive for transient analysis (WIRE-3). Carries the Signal Generator's
// shape so the .tran source matches what the student set: sine → SIN(...), square/triangle/
// sawtooth → PULSE(...).
export interface WaveDrive {
  type: WaveType
  offset: number
  amplitude: number
  freq: number
  duty: number // % high, square only
}

// Independent voltage source — typically the Signal Generator input.
// `dc` is the operating-point value; `acMag` is emitted for .ac sweeps (default 1);
// `sine`/`wave` describe the .tran drive. `wave` (WIRE-3) supersedes `sine` and supports
// non-sine shapes; `sine` is kept for back-compat.
export interface VSource {
  kind: 'vsource'
  id: string
  nodes: [Net, Net] // [positive, negative]
  dc?: number
  acMag?: number
  sine?: { offset: number; amplitude: number; freq: number }
  wave?: WaveDrive
}

// DC supply rail set by the Power Supply instrument (PSU-1). Referenced to ground.
export interface DCRail {
  kind: 'dcrail'
  id: string // e.g. 'pos' -> Vpos
  node: Net
  volts: number
}

// Op-amp.
//  - 'ideal' (default): a single high-gain VCVS (E device) — infinite bandwidth, no clipping.
//  - 'lmc662': behavioural model of the TI LMC662 dual CMOS op-amp used in the EEC1 course
//    (datasheet: open-loop gain 126 dB, GBW 1.4 MHz, rail-to-rail output, slew 1.1 V/µs).
//    Implemented as a transconductance macromodel: a gm stage with a clamped current drives the
//    dominant-pole cap, giving open-loop gain 126 dB, GBW 1.4 MHz, slew rate 1.1 V/µs, plus a
//    B-source that clips the output to the supply rails. AC shows the bandwidth rolloff; transient
//    shows slew limiting and rail clipping. `supplyPos`/`supplyNeg` set the clip rails (default
//    ±5 V, the M2K supplies).
export interface OpAmp {
  kind: 'opamp'
  id: string // e.g. '1' -> E1
  model?: 'ideal' | 'lmc662'
  nodes: { inP: Net; inN: Net; out: Net; vpos?: Net; vneg?: Net }
  gain?: number // open-loop gain (default 1e6 for ideal; the LMC662 uses its datasheet 126 dB)
  supplyPos?: number // LMC662 positive rail for output clipping (default +5 V)
  supplyNeg?: number // LMC662 negative rail for output clipping (default −5 V)
}

// LMC662 datasheet constants (TI LMC662, behavioural model).
export const LMC662 = {
  aol: 1.995e6,   // 126 dB open-loop voltage gain
  gbw: 1.4e6,     // gain·bandwidth product, Hz
  slewVPerUs: 1.1, // not yet modelled; kept for reference
}

// Instrumentation amplifier. Two models, same 4 pins (inP, inN, out, ref):
//  - 'ideal': a single VCVS — V(out,ref) = gain·(V(inP)−V(inN)). Infinite input impedance
//    and CMRR. The right abstraction for a project INA front end.
//  - 'threeopamp': the textbook 3-op-amp topology built from ideal VCVS op-amps + matched
//    resistors, so a lab can see the internals and the gain law G = 1 + 2R/Rg.
export interface InAmp {
  kind: 'inamp'
  id: string
  model: 'ideal' | 'threeopamp'
  nodes: { inP: Net; inN: Net; out: Net; ref: Net }
  gain: number
}

// Ground marker — declares which net is ground. Emits no device line; the net is
// normalised to '0' everywhere.
export interface Ground {
  kind: 'ground'
  id: string
  node: Net
}

// Junction diode. nodes = [anode, cathode]. Each diode emits its own .model so an LED (higher Vf
// via a smaller IS) or a Zener (low reverse breakdown BV) can differ. Defaults = generic silicon.
export interface Diode {
  kind: 'diode'
  id: string
  nodes: [Net, Net]
  is?: number // saturation current (sets forward Vf)
  n?: number  // ideality factor
  rs?: number // series resistance
  bv?: number // reverse breakdown voltage (Zener)
}

// Bipolar junction transistor (SCH-8). nodes = [collector, base, emitter]; `polarity` sets the
// device line's .model type (NPN/PNP). Each BJT emits its own .model card (like Diode) so different
// kit parts (2N3904, 2N3906) differ. `model` is the raw ngspice .model parameter body; omit for a
// generic small-signal default.
export interface BJT {
  kind: 'bjt'
  id: string
  nodes: [Net, Net, Net] // [collector, base, emitter]
  polarity: 'npn' | 'pnp'
  model?: string // ngspice .model body, e.g. 'BF=300 IS=6.7f VAF=74'
}

// MOSFET (SCH-8). nodes = [drain, gate, source]; the bulk is tied to the source (discrete TO-92),
// so buildNetlist emits the 4th node = source. `channel` sets the .model type (NMOS/PMOS). Level-1
// model via the `model` body; omit for a generic enhancement default.
export interface MOSFET {
  kind: 'mosfet'
  id: string
  nodes: [Net, Net, Net] // [drain, gate, source]
  channel: 'nmos' | 'pmos'
  model?: string // ngspice .model body, e.g. 'VTO=2 KP=0.15 LAMBDA=0.01'
}

export type Component =
  | Resistor
  | Capacitor
  | Inductor
  | VSource
  | DCRail
  | OpAmp
  | InAmp
  | Ground
  | Diode
  | BJT
  | MOSFET

export interface Circuit {
  title: string
  components: Component[]
}

// ── ADALP2000 transistor kit (SCH-8) ─────────────────────────────────────────────
// The discrete transistors stocked in the ADALP2000 kit, each a (device type + ngspice .model
// body) pair so the on-screen part matches the part in the student's hand. Model bodies are
// representative cards (BJT: standard onsemi/Motorola small-signal; MOSFET: level-1 approximations
// matched to the datasheet threshold) and should be verified against the manufacturer model at
// implementation. The schematic stores only the part name; toCircuit resolves it here.
export type TransistorType = 'npn' | 'pnp' | 'nmos' | 'pmos'
export interface TransistorPart {
  type: TransistorType
  model: string
}

export const TRANSISTOR_PARTS: Record<string, TransistorPart> = {
  '2N3904': { type: 'npn', model: 'IS=6.734f BF=300 NF=1 VAF=74 IKF=66.78m ISE=6.734f NE=1.259 BR=0.7371 RC=1 CJC=3.638p CJE=4.493p TF=301.2p TR=239.5n' },
  '2N3903': { type: 'npn', model: 'IS=6.734f BF=200 NF=1 VAF=74 IKF=66.78m ISE=6.734f NE=1.259 BR=0.7371' },
  '2N3906': { type: 'pnp', model: 'IS=1.41f BF=180 NF=1 VAF=18.7 IKF=80m ISE=0 NE=1.5 BR=4.977 RC=2.5 CJC=9.728p CJE=8.063p TF=179.3p TR=33.42n' },
  // Level-1 KP/LAMBDA tuned (SWEEP-1, acceptance criterion 5) so a stepped family renders a clean,
  // well-separated triode→saturation set at M2K scales (±5 V, a few mA): KP=0.15 ran the device
  // hard-on (drain pulled to ~0, flat curves). KP≈5 mA/V², LAMBDA=0.02 gives a textbook output
  // characteristic on the .tran curve-tracer path. Validated against the live tracer (see PROGRESS).
  'ZVN2110A': { type: 'nmos', model: 'VTO=1.5 KP=0.005 LAMBDA=0.02' },
  'ZVN3310A': { type: 'nmos', model: 'VTO=2 KP=0.005 LAMBDA=0.02' },
  'ZVP2110A': { type: 'pmos', model: 'VTO=-1.5 KP=0.005 LAMBDA=0.02' },
}

// Generic fallback bodies when a part is unknown or unset (keeps an unspecified device simulating).
const DEFAULT_TRANSISTOR_MODEL: Record<TransistorType, string> = {
  npn: 'BF=100 IS=1e-14',
  pnp: 'BF=100 IS=1e-14',
  nmos: 'VTO=2 KP=0.1 LAMBDA=0.01',
  pmos: 'VTO=-2 KP=0.05 LAMBDA=0.01',
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

// Transient drive string for a waveform. SIN for sine; PULSE for square/triangle/sawtooth.
// Conventions match generateSignal (signal.ts): square swings offset±amplitude, high for
// duty fraction, starting high; triangle/sawtooth swing offset±amplitude over one period.
function tranDriveSpec(w: WaveDrive): string {
  const T = w.freq > 0 ? 1 / w.freq : 1
  const hi = w.offset + w.amplitude
  const lo = w.offset - w.amplitude
  const edge = T * 1e-3 // fast but finite edges keep ngspice converging
  switch (w.type) {
    case 'sine':
      return `SIN(${fmt(w.offset)} ${fmt(w.amplitude)} ${fmt(w.freq)})`
    case 'square': {
      const d = Math.min(0.999, Math.max(0.001, w.duty / 100))
      // rest high (V1), pulse low (V2) for the (1−duty) fraction → high for `duty` of the period
      return `PULSE(${fmt(hi)} ${fmt(lo)} 0 ${fmt(edge)} ${fmt(edge)} ${fmt((1 - d) * T)} ${fmt(T)})`
    }
    case 'triangle':
      return `PULSE(${fmt(lo)} ${fmt(hi)} 0 ${fmt(T / 2)} ${fmt(T / 2)} 0 ${fmt(T)})`
    case 'sawtooth':
      return `PULSE(${fmt(lo)} ${fmt(hi)} 0 ${fmt(T - edge)} ${fmt(edge)} 0 ${fmt(T)})`
  }
}

function vsourceSpec(v: VSource, analysis: Analysis): string {
  const parts: string[] = [`DC ${fmt(v.dc ?? 0)}`]
  if (analysis.kind === 'ac') parts.push(`AC ${fmt(v.acMag ?? 1)}`)
  if (analysis.kind === 'tran') {
    if (v.wave) parts.push(tranDriveSpec(v.wave))
    else if (v.sine) parts.push(`SIN(${fmt(v.sine.offset)} ${fmt(v.sine.amplitude)} ${fmt(v.sine.freq)})`)
  }
  return parts.join(' ')
}

// Instrumentation amplifier expansion. 'ideal' is one VCVS. 'threeopamp' is the classic
// 3-op-amp in-amp from ideal VCVS op-amps and matched resistors R, with the gain resistor Rg
// sized to hit the requested gain: G = 1 + 2R/Rg  →  Rg = 2R/(G−1). Internal nodes are
// namespaced per instance ("xi<id>_*") so multiple in-amps never collide.
function inampLines(c: InAmp, n: (net: Net) => string): string[] {
  const inP = n(c.nodes.inP), inN = n(c.nodes.inN), out = n(c.nodes.out), ref = n(c.nodes.ref)
  if (c.model === 'ideal') {
    return [`E_INA${c.id} ${out} ${ref} ${inP} ${inN} ${fmt(c.gain)}`]
  }
  const R = 10000          // matched bridge/feedback resistors
  const A = 1e6            // internal op-amp open-loop gain
  const G = Math.max(1, c.gain)
  const k = c.id
  const va = `xi${k}_a`, vb = `xi${k}_b`, n1 = `xi${k}_n1`, n2 = `xi${k}_n2`
  const im = `xi${k}_im`, ip = `xi${k}_ip`
  const L = [
    // input gain stage: two non-inverting op-amps coupled by Rg
    `E_INA${k}a ${va} 0 ${inP} ${n1} ${fmt(A)}`,
    `E_INA${k}b ${vb} 0 ${inN} ${n2} ${fmt(A)}`,
    `R_INA${k}f1 ${va} ${n1} ${fmt(R)}`,
    `R_INA${k}f2 ${vb} ${n2} ${fmt(R)}`,
    // unity difference amplifier: out = (va − vb) + ref
    `E_INA${k}c ${out} 0 ${ip} ${im} ${fmt(A)}`,
    `R_INA${k}i ${vb} ${im} ${fmt(R)}`,
    `R_INA${k}f ${out} ${im} ${fmt(R)}`,
    `R_INA${k}j ${va} ${ip} ${fmt(R)}`,
    `R_INA${k}g2 ${ip} ${ref} ${fmt(R)}`,
  ]
  if (G > 1) L.push(`R_INA${k}g ${n1} ${n2} ${fmt((2 * R) / (G - 1))}`)
  return L
}

// Op-amp emission. Ideal → one VCVS. LMC662 → transconductance macromodel + rail clip (see OpAmp).
// The op-amp may carry V+/V− power nets (vpos/vneg). When wired, the LMC662 output clips to the
// ACTUAL rail voltages V(vpos)/V(vneg); a 1 TΩ bleed ties any rail to 0 so an unpowered op-amp
// (rails left floating) sits dead at 0 V, just like the bench. When no power pins are present
// (e.g. a Circuit built directly in tests), it falls back to the fixed ±5 V default.
function opampLines(c: OpAmp, n: (net: Net) => string): string[] {
  const inP = n(c.nodes.inP), inN = n(c.nodes.inN), out = n(c.nodes.out)
  const vpos = c.nodes.vpos ? n(c.nodes.vpos) : undefined
  const vneg = c.nodes.vneg ? n(c.nodes.vneg) : undefined
  const bleed: string[] = []
  if (vpos) bleed.push(`Rvp${c.id} ${vpos} 0 1e12`)
  if (vneg) bleed.push(`Rvn${c.id} ${vneg} 0 1e12`)

  if ((c.model ?? 'ideal') === 'ideal') {
    return [`E${c.id} ${out} 0 ${inP} ${inN} ${fmt(c.gain ?? 1e6)}`, ...bleed]
  }
  // LMC662 macromodel: a transconductance stage (gm) drives the dominant-pole capacitor Cp.
  //   open-loop gain  Aol = gm·Rp           → Rp = Aol/gm
  //   gain·bandwidth  GBW = gm/(2π·Cp)      → Cp = gm/(2π·GBW)
  //   slew rate       SR  = Imax/Cp         → clamp the gm current at ±Imax = SR·Cp
  const gm = 1e-3
  const cp = gm / (2 * Math.PI * LMC662.gbw)
  const rp = LMC662.aol / gm
  const imax = LMC662.slewVPerUs * 1e6 * cp // SR in V/s × Cp
  const o = `xop${c.id}_o`
  const clipHi = vpos ? `V(${vpos})` : fmt(c.supplyPos ?? 5)
  const clipLo = vneg ? `V(${vneg})` : fmt(c.supplyNeg ?? -5)
  // 1 TΩ input bleeds: realistic CMOS input impedance, and they keep an UNUSED section's inputs
  // (e.g. the spare half of a dual) from floating. Negligible against any real source/feedback.
  return [
    `Bg${c.id} 0 ${o} I = max(${(-imax).toExponential(6)}, min(${imax.toExponential(6)}, ${gm}*(V(${inP})-V(${inN}))))`,
    `Rp${c.id} ${o} 0 ${fmt(rp)}`,                        // DC gain leg (gm·Rp = Aol)
    `Cp${c.id} ${o} 0 ${fmt(cp)}`,                        // dominant pole + slew integrator
    `Rip${c.id} ${inP} 0 1e12`,
    `Rim${c.id} ${inN} 0 1e12`,
    ...bleed,
    `Bo${c.id} ${out} 0 V = max(${clipLo}, min(${clipHi}, V(${o})))`, // output clip to the rails
  ]
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
        lines.push(...opampLines(c, n))
        break
      case 'inamp':
        lines.push(...inampLines(c, n))
        break
      case 'diode': {
        const is = (c.is ?? 2.52e-9).toExponential(4)
        const nn = c.n ?? 1.752, rs = c.rs ?? 0.568, bv = c.bv ?? 100
        const m = `DM${c.id}`
        lines.push(`D${c.id} ${n(c.nodes[0])} ${n(c.nodes[1])} ${m}`)
        lines.push(`.model ${m} D(IS=${is} N=${nn} RS=${rs} BV=${bv} IBV=0.1u)`)
        break
      }
      case 'bjt': {
        const type = c.polarity === 'pnp' ? 'PNP' : 'NPN'
        const body = c.model ?? DEFAULT_TRANSISTOR_MODEL[c.polarity]
        const m = `QM${c.id}`
        // Q<id> collector base emitter <model>
        lines.push(`Q${c.id} ${n(c.nodes[0])} ${n(c.nodes[1])} ${n(c.nodes[2])} ${m}`)
        lines.push(`.model ${m} ${type}(${body})`)
        break
      }
      case 'mosfet': {
        const type = c.channel === 'pmos' ? 'PMOS' : 'NMOS'
        const body = c.model ?? DEFAULT_TRANSISTOR_MODEL[c.channel]
        const m = `MM${c.id}`
        const d = n(c.nodes[0]), g = n(c.nodes[1]), s = n(c.nodes[2])
        // M<id> drain gate source bulk <model>; discrete TO-92 ties bulk to source.
        lines.push(`M${c.id} ${d} ${g} ${s} ${s} ${m}`)
        lines.push(`.model ${m} ${type}(${body})`)
        break
      }
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

// WIRE-2/WIRE-3: stamp the Signal Generator settings onto the W1/W2 source components so the
// same circuit drives correctly under any analysis (AC 1 for sweeps, SIN(...)/PULSE(...) for
// transient via `wave`, the DC offset for operating point). See docs/specs/schematic-ngspice.md.
export function applyGeneratorParams(circuit: Circuit, w1?: SignalParams, w2?: SignalParams): Circuit {
  return {
    ...circuit,
    components: circuit.components.map((c) => {
      if (c.kind !== 'vsource') return c
      const p = c.id === 'W1' ? w1 : c.id === 'W2' ? w2 : undefined
      if (!p) return c
      return {
        ...c,
        dc: p.offset,
        acMag: 1,
        sine: { offset: p.offset, amplitude: p.amplitude, freq: p.frequency },
        wave: { type: p.waveType, offset: p.offset, amplitude: p.amplitude, freq: p.frequency, duty: p.dutyCycle },
      }
    }),
  }
}

// PSU-1: the Power Supply instrument owns the rail voltages. V+ ports are positive DC rails,
// V- ports negative. `applySupplyRails` overrides every DC rail in the circuit from the
// instrument settings (disabled rail → 0 V), so the same drawn V+/V- pins reflect the supply.
export interface SupplySettings {
  plus: number        // 0..+5 V
  minus: number       // -5..0 V
  plusEnabled: boolean
  minusEnabled: boolean
}

export function applySupplyRails(circuit: Circuit, s: SupplySettings): Circuit {
  return {
    ...circuit,
    components: circuit.components.map((c) => {
      if (c.kind !== 'dcrail') return c
      const isPlus = c.volts >= 0
      const v = isPlus ? (s.plusEnabled ? s.plus : 0) : (s.minusEnabled ? s.minus : 0)
      return { ...c, volts: v }
    }),
  }
}
