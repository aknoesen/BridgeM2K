// Built-in example circuit library (loadable from the Schematic editor's Examples menu).
// Each schematic is pre-wired with a W1 source, a 1+ (scope CH1) probe on the output, grounds,
// and — for the LMC662 versions — V+/V- rails, so a student can load it and immediately run the
// Network Analyzer (Bode) or the scope. Component values are chosen for clean, readable plots and
// (for the amps) gains small enough not to clip at the default 1 V input.
//
// Grid notes: parts are 2 units long (a at (gx,gy), b at (gx+2,gy)); rotation:1 makes them vertical
// (b at (gx,gy+2)). Op-amp (kind 'opamp') pins unrotated at (gx,gy): inP (gx,gy), inN (gx,gy+2),
// out (gx+4,gy+1); with opModel 'lmc662' it also exposes vpos (gx+2,gy-1) and vneg (gx+2,gy+3).
import type { Schematic } from './schematic'

export interface Example {
  id: string
  name: string
  group: 'Passive' | 'Amplifiers'
  blurb: string
  schematic: Schematic
}

// --- shared amp skeletons (inverting / non-inverting), parameterised by op-amp model ---------

function invertingAmp(lmc662: boolean): Schematic {
  const comps: Schematic['components'] = [
    { id: 'W1', kind: 'awg1', gx: 2, gy: 6 },
    { id: 'Rin', kind: 'resistor', gx: 4, gy: 6, value: 10000 },
    { id: 'U1', kind: 'opamp', gx: 10, gy: 4, ...(lmc662 ? { opModel: 'lmc662' as const } : {}) },
    { id: 'Rf', kind: 'resistor', gx: 10, gy: 8, value: 22000 },
    { id: 'G1', kind: 'ground', gx: 8, gy: 4 },
    { id: 'P1', kind: 'scope1', gx: 16, gy: 5 },
  ]
  const wires: Schematic['wires'] = [
    { x1: 2, y1: 6, x2: 4, y2: 6 },   // W1 -> Rin.a
    { x1: 6, y1: 6, x2: 10, y2: 6 },  // Rin.b -> inN (summing node)
    { x1: 10, y1: 4, x2: 8, y2: 4 },  // inP -> ground
    { x1: 10, y1: 6, x2: 10, y2: 8 }, // inN -> Rf.a
    { x1: 14, y1: 5, x2: 14, y2: 8 }, // out -> down
    { x1: 14, y1: 8, x2: 12, y2: 8 }, // -> Rf.b  (feedback)
    { x1: 14, y1: 5, x2: 16, y2: 5 }, // out -> 1+
  ]
  if (lmc662) {
    comps.push({ id: 'VP', kind: 'vplus', gx: 12, gy: 1 }, { id: 'VN', kind: 'vminus', gx: 12, gy: 9 })
    wires.push({ x1: 12, y1: 1, x2: 12, y2: 3 }, { x1: 12, y1: 9, x2: 12, y2: 7 }) // V+ -> vpos, V- -> vneg
  }
  return { components: comps, wires }
}

function nonInvertingAmp(lmc662: boolean): Schematic {
  const comps: Schematic['components'] = [
    { id: 'W1', kind: 'awg1', gx: 6, gy: 4 },
    { id: 'U1', kind: 'opamp', gx: 10, gy: 4, ...(lmc662 ? { opModel: 'lmc662' as const } : {}) },
    { id: 'Rf', kind: 'resistor', gx: 12, gy: 6, value: 10000 },
    { id: 'Rg', kind: 'resistor', gx: 10, gy: 6, rotation: 1, value: 10000 },
    { id: 'G1', kind: 'ground', gx: 10, gy: 8 },
    { id: 'P1', kind: 'scope1', gx: 16, gy: 5 },
  ]
  const wires: Schematic['wires'] = [
    { x1: 6, y1: 4, x2: 10, y2: 4 },  // W1 -> inP
    { x1: 10, y1: 6, x2: 12, y2: 6 }, // inN -> Rf.a (Rg.a shares inN at 10,6)
    { x1: 14, y1: 6, x2: 14, y2: 5 }, // Rf.b -> out
    { x1: 14, y1: 5, x2: 16, y2: 5 }, // out -> 1+
  ]
  if (lmc662) {
    comps.push({ id: 'VP', kind: 'vplus', gx: 12, gy: 1 }, { id: 'VN', kind: 'vminus', gx: 12, gy: 9 })
    wires.push({ x1: 12, y1: 1, x2: 12, y2: 3 }, { x1: 12, y1: 9, x2: 12, y2: 7 })
  }
  return { components: comps, wires }
}

// --- the library ----------------------------------------------------------------------------

export const EXAMPLES: Example[] = [
  {
    id: 'divider', name: 'Voltage divider (÷2)', group: 'Passive',
    blurb: 'Two equal resistors → −6 dB, flat with frequency.',
    schematic: {
      components: [
        { id: 'W1', kind: 'awg1', gx: 2, gy: 4 },
        { id: 'R1', kind: 'resistor', gx: 4, gy: 4, value: 10000 },
        { id: 'R2', kind: 'resistor', gx: 6, gy: 4, rotation: 1, value: 10000 },
        { id: 'G1', kind: 'ground', gx: 6, gy: 6 },
        { id: 'P1', kind: 'scope1', gx: 8, gy: 4 },
      ],
      wires: [
        { x1: 2, y1: 4, x2: 4, y2: 4 },
        { x1: 6, y1: 4, x2: 8, y2: 4 },
      ],
    },
  },
  {
    id: 'rc-lp', name: 'RC low-pass (~1 kHz)', group: 'Passive',
    blurb: 'Series R, shunt C. −3 dB near 1 kHz, −20 dB/decade.',
    schematic: {
      components: [
        { id: 'W1', kind: 'awg1', gx: 2, gy: 4 },
        { id: 'R1', kind: 'resistor', gx: 4, gy: 4, value: 1600 },
        { id: 'C1', kind: 'capacitor', gx: 6, gy: 4, rotation: 1, value: 1e-7 },
        { id: 'G1', kind: 'ground', gx: 6, gy: 6 },
        { id: 'P1', kind: 'scope1', gx: 8, gy: 4 },
      ],
      wires: [
        { x1: 2, y1: 4, x2: 4, y2: 4 },
        { x1: 6, y1: 4, x2: 8, y2: 4 },
      ],
    },
  },
  {
    id: 'rc-hp', name: 'RC high-pass (~1 kHz)', group: 'Passive',
    blurb: 'Series C, shunt R. −3 dB near 1 kHz, +20 dB/decade below.',
    schematic: {
      components: [
        { id: 'W1', kind: 'awg1', gx: 2, gy: 4 },
        { id: 'C1', kind: 'capacitor', gx: 4, gy: 4, value: 1e-7 },
        { id: 'R1', kind: 'resistor', gx: 6, gy: 4, rotation: 1, value: 1600 },
        { id: 'G1', kind: 'ground', gx: 6, gy: 6 },
        { id: 'P1', kind: 'scope1', gx: 8, gy: 4 },
      ],
      wires: [
        { x1: 2, y1: 4, x2: 4, y2: 4 },
        { x1: 6, y1: 4, x2: 8, y2: 4 },
      ],
    },
  },
  {
    id: 'lc-lp', name: 'LC low-pass (~1.6 kHz)', group: 'Passive',
    blurb: 'Series L, shunt C. 2nd-order: resonant peak then −40 dB/decade.',
    schematic: {
      components: [
        { id: 'W1', kind: 'awg1', gx: 2, gy: 4 },
        { id: 'L1', kind: 'inductor', gx: 4, gy: 4, value: 1e-2 },
        { id: 'C1', kind: 'capacitor', gx: 6, gy: 4, rotation: 1, value: 1e-6 },
        { id: 'G1', kind: 'ground', gx: 6, gy: 6 },
        { id: 'P1', kind: 'scope1', gx: 8, gy: 4 },
      ],
      wires: [
        { x1: 2, y1: 4, x2: 4, y2: 4 },
        { x1: 6, y1: 4, x2: 8, y2: 4 },
      ],
    },
  },
  {
    id: 'lc-hp', name: 'LC high-pass (~1.6 kHz)', group: 'Passive',
    blurb: 'Series C, shunt L. 2nd-order high-pass with a resonant peak.',
    schematic: {
      components: [
        { id: 'W1', kind: 'awg1', gx: 2, gy: 4 },
        { id: 'C1', kind: 'capacitor', gx: 4, gy: 4, value: 1e-6 },
        { id: 'L1', kind: 'inductor', gx: 6, gy: 4, rotation: 1, value: 1e-2 },
        { id: 'G1', kind: 'ground', gx: 6, gy: 6 },
        { id: 'P1', kind: 'scope1', gx: 8, gy: 4 },
      ],
      wires: [
        { x1: 2, y1: 4, x2: 4, y2: 4 },
        { x1: 6, y1: 4, x2: 8, y2: 4 },
      ],
    },
  },
  {
    id: 'inv-ideal', name: 'Inverting amp ×−2.2 (ideal)', group: 'Amplifiers',
    blurb: 'Ideal op-amp (simulation only, no supplies). Gain −Rf/Rin = −2.2.',
    schematic: invertingAmp(false),
  },
  {
    id: 'inv-lmc662', name: 'Inverting amp ×−2.2 (LMC662)', group: 'Amplifiers',
    blurb: 'Real LMC662 (needs ±5 V rails). Same gain; shows bandwidth + clipping.',
    schematic: invertingAmp(true),
  },
  {
    id: 'noninv-ideal', name: 'Non-inverting amp ×2 (ideal)', group: 'Amplifiers',
    blurb: 'Ideal op-amp (simulation only). Gain 1 + Rf/Rg = 2.',
    schematic: nonInvertingAmp(false),
  },
  {
    id: 'noninv-lmc662', name: 'Non-inverting amp ×2 (LMC662)', group: 'Amplifiers',
    blurb: 'Real LMC662 (needs ±5 V rails). Same gain; shows bandwidth + clipping.',
    schematic: nonInvertingAmp(true),
  },
  {
    id: 'rlc-bandpass', name: 'RLC band-pass (~1.6 kHz)', group: 'Passive',
    blurb: 'Series L-C with output across R. Peaks at resonance (Q ≈ 7).',
    schematic: {
      components: [
        { id: 'W1', kind: 'awg1', gx: 2, gy: 4 },
        { id: 'L1', kind: 'inductor', gx: 4, gy: 4, value: 0.1 },
        { id: 'C1', kind: 'capacitor', gx: 6, gy: 4, value: 1e-7 },
        { id: 'R1', kind: 'resistor', gx: 8, gy: 4, rotation: 1, value: 100 },
        { id: 'G1', kind: 'ground', gx: 8, gy: 6 },
        { id: 'P1', kind: 'scope1', gx: 10, gy: 4 },
      ],
      wires: [
        { x1: 2, y1: 4, x2: 4, y2: 4 },   // W1 -> L.a
        { x1: 8, y1: 4, x2: 10, y2: 4 },  // node (across R) -> 1+
      ],
    },
  },
  {
    id: 'integrator', name: 'Integrator (op-amp)', group: 'Amplifiers',
    blurb: 'Inverting integrator (Rf bounds DC gain). −20 dB/decade above ~70 Hz.',
    schematic: {
      components: [
        { id: 'W1', kind: 'awg1', gx: 2, gy: 6 },
        { id: 'Rin', kind: 'resistor', gx: 4, gy: 6, value: 10000 },
        { id: 'U1', kind: 'opamp', gx: 10, gy: 4 },
        { id: 'Cf', kind: 'capacitor', gx: 10, gy: 8, value: 1e-7 },
        { id: 'Rf', kind: 'resistor', gx: 10, gy: 10, value: 22000 },
        { id: 'G1', kind: 'ground', gx: 8, gy: 4 },
        { id: 'P1', kind: 'scope1', gx: 16, gy: 5 },
      ],
      wires: [
        { x1: 2, y1: 6, x2: 4, y2: 6 },    // W1 -> Rin.a
        { x1: 6, y1: 6, x2: 10, y2: 6 },   // Rin.b -> inN
        { x1: 10, y1: 4, x2: 8, y2: 4 },   // inP -> ground
        { x1: 10, y1: 6, x2: 10, y2: 8 },  // inN -> Cf.a
        { x1: 10, y1: 8, x2: 10, y2: 10 }, // Cf.a -> Rf.a (parallel feedback)
        { x1: 12, y1: 8, x2: 12, y2: 10 }, // Cf.b -> Rf.b
        { x1: 14, y1: 5, x2: 14, y2: 8 },  // out -> down
        { x1: 14, y1: 8, x2: 12, y2: 8 },  // -> feedback (out side)
        { x1: 14, y1: 5, x2: 16, y2: 5 },  // out -> 1+
      ],
    },
  },
  {
    id: 'differentiator', name: 'Differentiator (op-amp)', group: 'Amplifiers',
    blurb: 'Inverting differentiator. +20 dB/decade (0 dB near 160 Hz).',
    schematic: {
      components: [
        { id: 'W1', kind: 'awg1', gx: 2, gy: 6 },
        { id: 'Cin', kind: 'capacitor', gx: 4, gy: 6, value: 1e-7 },
        { id: 'U1', kind: 'opamp', gx: 10, gy: 4 },
        { id: 'Rf', kind: 'resistor', gx: 10, gy: 8, value: 10000 },
        { id: 'G1', kind: 'ground', gx: 8, gy: 4 },
        { id: 'P1', kind: 'scope1', gx: 16, gy: 5 },
      ],
      wires: [
        { x1: 2, y1: 6, x2: 4, y2: 6 },    // W1 -> Cin.a
        { x1: 6, y1: 6, x2: 10, y2: 6 },   // Cin.b -> inN
        { x1: 10, y1: 4, x2: 8, y2: 4 },   // inP -> ground
        { x1: 10, y1: 6, x2: 10, y2: 8 },  // inN -> Rf.a
        { x1: 14, y1: 5, x2: 14, y2: 8 },  // out -> down
        { x1: 14, y1: 8, x2: 12, y2: 8 },  // -> Rf.b (feedback)
        { x1: 14, y1: 5, x2: 16, y2: 5 },  // out -> 1+
      ],
    },
  },
  {
    id: 'summing', name: 'Summing amp (W1 + W2)', group: 'Amplifiers',
    blurb: 'Inverting summer: out = −(W1 + W2). Drive both generators, see the sum on the scope.',
    schematic: {
      components: [
        { id: 'W1', kind: 'awg1', gx: 2, gy: 6 },
        { id: 'Ra', kind: 'resistor', gx: 6, gy: 6, value: 10000 },
        { id: 'W2', kind: 'awg2', gx: 2, gy: 8 },
        { id: 'Rb', kind: 'resistor', gx: 6, gy: 8, value: 10000 },
        { id: 'U1', kind: 'opamp', gx: 10, gy: 4 },
        { id: 'Rf', kind: 'resistor', gx: 10, gy: 10, value: 10000 },
        { id: 'G1', kind: 'ground', gx: 8, gy: 4 },
        { id: 'P1', kind: 'scope1', gx: 16, gy: 5 },
      ],
      wires: [
        { x1: 2, y1: 6, x2: 6, y2: 6 },    // W1 -> Ra.a
        { x1: 8, y1: 6, x2: 10, y2: 6 },   // Ra.b -> inN
        { x1: 2, y1: 8, x2: 6, y2: 8 },    // W2 -> Rb.a
        { x1: 8, y1: 8, x2: 8, y2: 6 },    // Rb.b -> summing node (Ra.b)
        { x1: 10, y1: 4, x2: 8, y2: 4 },   // inP -> ground
        { x1: 10, y1: 6, x2: 10, y2: 10 }, // inN -> Rf.a
        { x1: 14, y1: 5, x2: 14, y2: 10 }, // out -> down
        { x1: 14, y1: 10, x2: 12, y2: 10 },// -> Rf.b (feedback)
        { x1: 14, y1: 5, x2: 16, y2: 5 },  // out -> 1+
      ],
    },
  },
]
