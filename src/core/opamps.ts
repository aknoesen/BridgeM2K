// ADALP2000 kit op-amp library (SCH-9). Pure, no React/DOM/SPICE engine.
//
// Hardware-faithful principle (as SCH-8/SCH-10): the op-amp dropdown offers only the op-amps that
// ship in the ADALP2000 kit, each backed by a level-1 SPICE macromodel so the twin behaves like the
// bench part — correct GBW-limited bandwidth, slew limiting, and rail-to-rail vs standard output
// clipping. `buildOpampSubckt` is a pure string emitter (fully testable without the engine).
//
// Fidelity tier = the same as SWEEP-1's level-1 MOSFET cards (NOT a Boyle/vendor model): a
// transconductance input stage into a dominant-pole RC matched to gbwHz, a current-limited node so
// large edges obey slewRate, and an output clamp to [vee+headroom, vcc-headroom]. The catalog
// params are in SI base units (slewRate kept in V/µs per the interface). Electrical params verified
// from datasheets — see docs/specs/SCH-9-spec.md.

// F-4: ADTL082 + AD8542 removed — they ship as breakout boards (BOB), not breadboard DIPs, so they
// are not part of the kit op-amp library the twin offers. Every remaining kit op-amp is a DIP.
export type OpampKind =
  | 'op27' | 'op37' | 'op97' | 'op482' | 'op484'

export interface OpampPart {
  kind: OpampKind
  name: string
  package: '8-DIP' | '14-DIP'
  channels: 1 | 2 | 4
  gbwHz: number
  slewRate: number        // V/µs
  vosTyp: number          // volts (catalog/display only; not injected into the level-1 model)
  supplyMin: number       // min TOTAL supply (V), dual = 2×rail
  supplyMax: number       // max TOTAL supply (V)
  railToRailIn: boolean
  railToRailOut: boolean
  outputHeadroom: number  // volts from each rail the output can reach (≈0 if RR out)
  count: number           // units in kit (future BOM)
  note?: string
}

export const KIT_OPAMPS: Record<OpampKind, OpampPart> = {
  op27: {
    kind: 'op27', name: 'OP27', package: '8-DIP', channels: 1, gbwHz: 8e6, slewRate: 2.8,
    vosTyp: 25e-6, supplyMin: 8, supplyMax: 36, railToRailIn: false, railToRailOut: false,
    outputHeadroom: 2.0, count: 2, note: 'Low-noise precision bipolar; output swings to ~2 V of each rail',
  },
  op37: {
    kind: 'op37', name: 'OP37', package: '8-DIP', channels: 1, gbwHz: 63e6, slewRate: 17,
    vosTyp: 25e-6, supplyMin: 8, supplyMax: 36, railToRailIn: false, railToRailOut: false,
    outputHeadroom: 2.0, count: 2, note: 'Decompensated OP27 — stable only at closed-loop gain ≥ 5',
  },
  op97: {
    kind: 'op97', name: 'OP97', package: '8-DIP', channels: 1, gbwHz: 0.9e6, slewRate: 0.2,
    vosTyp: 25e-6, supplyMin: 4.5, supplyMax: 40, railToRailIn: false, railToRailOut: false,
    outputHeadroom: 1.0, count: 2, note: 'Low-power high-precision; ultra-low input bias (~30 pA)',
  },
  op482: {
    kind: 'op482', name: 'OP482', package: '14-DIP', channels: 4, gbwHz: 4e6, slewRate: 9,
    vosTyp: 4e-3, supplyMin: 9, supplyMax: 36, railToRailIn: false, railToRailOut: false,
    outputHeadroom: 1.5, count: 2, note: 'High-speed JFET quad; output swings to ~1.5 V of each rail',
  },
  op484: {
    kind: 'op484', name: 'OP484', package: '14-DIP', channels: 4, gbwHz: 4e6, slewRate: 4,
    vosTyp: 65e-6, supplyMin: 3, supplyMax: 36, railToRailIn: true, railToRailOut: true,
    outputHeadroom: 0.02, count: 1, note: 'Precision rail-to-rail I/O; works to +1.5 V single supply',
  },
}

export function opampList(): OpampPart[] {
  return Object.values(KIT_OPAMPS)
}

export function getOpamp(kind: OpampKind): OpampPart {
  return KIT_OPAMPS[kind]
}

export function isKitOpamp(kind: string): kind is OpampKind {
  return Object.prototype.hasOwnProperty.call(KIT_OPAMPS, kind)
}

// Generic open-loop DC gain for the level-1 tier (120 dB). High enough that closed-loop gain is set
// by the feedback network to <0.01% for any practical kit configuration; per-part Aol isn't in the
// spec table and isn't needed at this fidelity.
const AOL = 1e6
const GM = 1e-3 // input transconductance (sets the integrator current; cancels out of the gains)

function num(x: number): string {
  return Number.isFinite(x) ? x.toExponential(6) : '0'
}

// Pure ngspice subcircuit for one op-amp, at the level-1 macromodel tier:
//   .subckt <kind> inp inn vcc vee out
//     gm·(inp−inn) current, slew-limited to ±Imax, into the dominant-pole node `no`
//     Rp·Cp set DC gain (gm·Rp = Aol) and the GBW pole (gm/2πCp = gbwHz)
//     output buffer clamps to [vee+headroom, vcc-headroom]
//   .ends
// Relations: Rp = Aol/gm, Cp = gm/(2π·gbw), Imax = slewRate·Cp (slewRate converted V/µs → V/s).
export function buildOpampSubckt(part: OpampPart): string {
  const rp = AOL / GM
  const cp = GM / (2 * Math.PI * part.gbwHz)
  const imax = part.slewRate * 1e6 * cp
  const hr = part.outputHeadroom
  return [
    `.subckt ${part.kind} inp inn vcc vee out`,
    // high input impedance bleeds so an unconnected input can't float the matrix
    `Rinp inp 0 1e12`,
    `Rinn inn 0 1e12`,
    // transconductance with hard slew current limit, driving the dominant-pole node
    `Bg 0 no I = max(${num(-imax)}, min(${num(imax)}, ${num(GM)}*(V(inp)-V(inn))))`,
    `Rp no 0 ${num(rp)}`,
    `Cp no 0 ${num(cp)}`,
    // output clamp: rails minus the part's headroom (≈0 for rail-to-rail parts)
    `Bo out 0 V = max(V(vee)+${num(hr)}, min(V(vcc)-${num(hr)}, V(no)))`,
    `.ends`,
  ].join('\n')
}
