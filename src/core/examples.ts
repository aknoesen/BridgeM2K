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
import type { SignalParams } from './signal'

export interface Example {
  id: string
  name: string
  group: 'Passive' | 'Amplifiers'
  blurb: string
  schematic: Schematic
  // Optional generator presets applied on load — e.g. an I-V curve needs a triangle SWEEP, not the
  // default square; the summing amp needs both W1 and W2. Loading any example with a w1 resets the
  // generators (W2 back to default unless w2 is given) so there is no carryover from a prior example.
  w1?: SignalParams
  w2?: SignalParams
  // Optional scope mode applied on load: xy:true puts the oscilloscope in XY mode (I-V curves);
  // omitted/false loads in normal time (YT) mode.
  xy?: boolean
  // Optional scope Volts/div presets so an example frames its curve without manual scaling
  // (must be one of the scope's steps: 0.05, 0.1, 0.2, 0.5, 1, 2, 5).
  ch1Vdiv?: number
  ch2Vdiv?: number
}

// A clean sine generator preset (most examples just want a steady tone to frame on the scope).
const sine = (frequency: number, amplitude = 1): SignalParams =>
  ({ waveType: 'sine', frequency, amplitude, offset: 0, dutyCycle: 50, samplingRate: 100000, duration: 0.016 })

// --- shared amp skeletons (inverting / non-inverting) — always a real LMC662 with V+/V- rails -----

function invertingAmp(): Schematic {
  return {
    components: [
      { id: 'W1', kind: 'awg1', gx: 2, gy: 6 },
      { id: 'Rin', kind: 'resistor', gx: 4, gy: 6, value: 10000 },
      { id: 'U1', kind: 'opamp', gx: 10, gy: 4 },
      { id: 'Rf', kind: 'resistor', gx: 10, gy: 8, value: 22000 },
      { id: 'G1', kind: 'ground', gx: 8, gy: 4 },
      { id: 'P1', kind: 'scope1', gx: 16, gy: 5 },
      { id: 'P2', kind: 'scope2', gx: 2, gy: 8 },   // 2+ on the input (CH2 = drive)
    ],
    wires: [
      { x1: 2, y1: 6, x2: 4, y2: 6 },   // W1 -> Rin.a
      { x1: 2, y1: 6, x2: 2, y2: 8 },   // input -> 2+
      { x1: 6, y1: 6, x2: 10, y2: 6 },  // Rin.b -> inN (summing node)
      { x1: 10, y1: 4, x2: 8, y2: 4 },  // inP -> ground
      { x1: 10, y1: 6, x2: 10, y2: 8 }, // inN -> Rf.a
      { x1: 14, y1: 5, x2: 14, y2: 8 }, // out -> down
      { x1: 14, y1: 8, x2: 12, y2: 8 }, // -> Rf.b  (feedback)
      { x1: 14, y1: 5, x2: 16, y2: 5 }, // out -> 1+
    ],
  }
}

function nonInvertingAmp(): Schematic {
  return {
    components: [
      { id: 'W1', kind: 'awg1', gx: 6, gy: 4 },
      { id: 'U1', kind: 'opamp', gx: 10, gy: 4 },
      { id: 'Rf', kind: 'resistor', gx: 12, gy: 6, value: 10000 },
      { id: 'Rg', kind: 'resistor', gx: 10, gy: 6, rotation: 1, value: 10000 },
      { id: 'G1', kind: 'ground', gx: 10, gy: 8 },
      { id: 'P1', kind: 'scope1', gx: 16, gy: 5 },
      { id: 'P2', kind: 'scope2', gx: 6, gy: 2 },   // 2+ on the input (CH2 = drive)
    ],
    wires: [
      { x1: 6, y1: 4, x2: 10, y2: 4 },  // W1 -> inP
      { x1: 6, y1: 4, x2: 6, y2: 2 },   // input -> 2+
      { x1: 10, y1: 6, x2: 12, y2: 6 }, // inN -> Rf.a (Rg.a shares inN at 10,6)
      { x1: 14, y1: 6, x2: 14, y2: 5 }, // Rf.b -> out
      { x1: 14, y1: 5, x2: 16, y2: 5 }, // out -> 1+
    ],
  }
}

// --- the library ----------------------------------------------------------------------------

export const EXAMPLES: Example[] = [
  {
    id: 'divider', name: 'Voltage divider (÷2)', group: 'Passive',
    blurb: 'Two equal resistors halve the supply voltage. Lab-1 starter: the Power Supply V+ rail drives the divider — open the Voltmeter, where Channel 2 reads the applied V+ and Channel 1 reads the half-voltage midpoint. Change V+ on the Power Supply and watch both readings track.',
    // V+ rail (Power Supply, default +5 V) drives the divider; read it and the midpoint on the
    // Voltmeter. CH1 (scope1) = midpoint (2.5 V), CH2 (scope2) = applied V+ (5 V). 2 V/div frames both.
    ch1Vdiv: 2, ch2Vdiv: 2,
    schematic: {
      components: [
        { id: 'VP', kind: 'vplus', gx: 2, gy: 4 },
        { id: 'R1', kind: 'resistor', gx: 4, gy: 4, value: 10000 },
        { id: 'R2', kind: 'resistor', gx: 6, gy: 4, rotation: 1, value: 10000 },
        { id: 'G1', kind: 'ground', gx: 6, gy: 6 },
        { id: 'P1', kind: 'scope1', gx: 8, gy: 4 },   // 1+ on the midpoint
        { id: 'P2', kind: 'scope2', gx: 2, gy: 2 },   // 2+ on the applied V+
      ],
      wires: [
        { x1: 2, y1: 4, x2: 4, y2: 4 },   // V+ -> R1.a (applied)
        { x1: 2, y1: 4, x2: 2, y2: 2 },   // V+ -> 2+
        { x1: 6, y1: 4, x2: 8, y2: 4 },   // midpoint -> 1+
      ],
    },
  },
  {
    id: 'rc-lp', name: 'RC low-pass (~1 kHz)', group: 'Passive',
    blurb: 'Series R, shunt C. −3 dB near 1 kHz, −20 dB/decade.',
    w1: sine(1000), ch1Vdiv: 0.5,
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
    w1: sine(1000), ch1Vdiv: 0.5,
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
    w1: sine(500), ch1Vdiv: 0.5,
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
    w1: sine(5000), ch1Vdiv: 0.5,
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
    id: 'inv-amp', name: 'Inverting amp ×−2.2 (LMC662)', group: 'Amplifiers',
    blurb: 'LMC662 op-amp on ±5 V rails. Gain −Rf/Rin = −2.2 (CH2 in, CH1 out — note the inversion). Buildable on the breadboard as an 8-pin DIP.',
    w1: sine(1000), ch1Vdiv: 1, ch2Vdiv: 1,
    schematic: invertingAmp(),
  },
  {
    id: 'noninv-amp', name: 'Non-inverting amp ×2 (LMC662)', group: 'Amplifiers',
    blurb: 'LMC662 op-amp on ±5 V rails. Gain 1 + Rf/Rg = 2 (CH2 in, CH1 out — same phase, 2× taller). Buildable on the breadboard as an 8-pin DIP.',
    w1: sine(1000), ch1Vdiv: 1, ch2Vdiv: 1,
    schematic: nonInvertingAmp(),
  },
  {
    id: 'rlc-bandpass', name: 'RLC band-pass (~1.6 kHz)', group: 'Passive',
    blurb: 'Series L-C with output across R. Peaks at resonance (Q ≈ 7).',
    w1: sine(1600), ch1Vdiv: 0.2,
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
    id: 'integrator', name: 'Integrator (LMC662)', group: 'Amplifiers',
    blurb: 'LMC662 op-amp on ±5 V rails. Inverting integrator (Rf bounds DC gain, ~70 Hz corner). Drive well above the corner and a triangle integrates to a parabolic wave (CH2 in, CH1 out). Buildable on the breadboard as an 8-pin DIP.',
    // Drive at 1 kHz, ~14× above the ~70 Hz corner, so it integrates cleanly: output extrema land on
    // the input zero-crossings. (τ = RfCf = 2.2 ms stays under the sim window, so it settles with no
    // offset drift.) CH1 = output (~0.5 Vpp, 100 mV/div), CH2 = input (4 Vpp, 1 V/div).
    w1: { waveType: 'triangle', frequency: 1000, amplitude: 2, offset: 0, dutyCycle: 50, samplingRate: 100000, duration: 0.016 },
    ch1Vdiv: 0.1, ch2Vdiv: 1,
    schematic: {
      components: [
        { id: 'W1', kind: 'awg1', gx: 2, gy: 6 },
        { id: 'Rin', kind: 'resistor', gx: 4, gy: 6, value: 10000 },
        { id: 'U1', kind: 'opamp', gx: 10, gy: 4 },
        { id: 'Cf', kind: 'capacitor', gx: 10, gy: 8, value: 1e-7 },
        { id: 'Rf', kind: 'resistor', gx: 10, gy: 10, value: 22000 },
        { id: 'G1', kind: 'ground', gx: 8, gy: 4 },
        { id: 'P1', kind: 'scope1', gx: 16, gy: 5 },
        { id: 'P2', kind: 'scope2', gx: 2, gy: 8 },
      ],
      wires: [
        { x1: 2, y1: 6, x2: 4, y2: 6 },    // W1 -> Rin.a
        { x1: 2, y1: 6, x2: 2, y2: 8 },    // input -> 2+ (probe the drive)
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
    id: 'differentiator', name: 'Differentiator (LMC662)', group: 'Amplifiers',
    blurb: 'LMC662 op-amp on ±5 V rails. Inverting differentiator, +20 dB/decade (0 dB near 160 Hz): a triangle differentiates to a square (CH2 in, CH1 out). Buildable on the breadboard as an 8-pin DIP.',
    // Triangle in -> square out (derivative of constant slopes). With the real LMC662 the square has
    // some peaking at the corners (a practical differentiator), so the output runs a few volts.
    // CH1 = output (~±3 V, 1 V/div), CH2 = input (4 Vpp, 1 V/div).
    w1: { waveType: 'triangle', frequency: 200, amplitude: 2, offset: 0, dutyCycle: 50, samplingRate: 100000, duration: 0.016 },
    ch1Vdiv: 1, ch2Vdiv: 1,
    schematic: {
      components: [
        { id: 'W1', kind: 'awg1', gx: 2, gy: 6 },
        { id: 'Cin', kind: 'capacitor', gx: 4, gy: 6, value: 1e-7 },
        { id: 'U1', kind: 'opamp', gx: 10, gy: 4 },
        { id: 'Rf', kind: 'resistor', gx: 10, gy: 8, value: 10000 },
        { id: 'G1', kind: 'ground', gx: 8, gy: 4 },
        { id: 'P1', kind: 'scope1', gx: 16, gy: 5 },
        { id: 'P2', kind: 'scope2', gx: 2, gy: 8 },
      ],
      wires: [
        { x1: 2, y1: 6, x2: 4, y2: 6 },    // W1 -> Cin.a
        { x1: 2, y1: 6, x2: 2, y2: 8 },    // input -> 2+ (probe the drive)
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
    id: 'summing', name: 'Summing amp (LMC662)', group: 'Amplifiers',
    blurb: 'LMC662 op-amp on ±5 V rails. Inverting summer: out = −(W1 + W2). Both generators are preset (1 kHz + 2 kHz); the scope shows the composite sum, and you can see/edit W1 and W2 in the Signal Generator. Buildable on the breadboard as an 8-pin DIP.',
    w1: sine(1000), w2: sine(2000), ch1Vdiv: 0.5,
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
  {
    id: 'ina125-amp', name: 'INA125 in-amp ×10', group: 'Amplifiers',
    blurb: 'INA125 instrumentation amp, gain 10 set by R_G = 10 kΩ (G = 4 + 60 kΩ/R_G). A tiny differential input becomes a big output (CH2 in, CH1 out). Builds on the breadboard as a 16-pin DIP.',
    w1: sine(1000, 0.3), ch1Vdiv: 1, ch2Vdiv: 0.2,
    schematic: {
      components: [
        { id: 'W1', kind: 'awg1', gx: 2, gy: 4 },
        { id: 'U1', kind: 'ina125', gx: 8, gy: 4 },           // pins: VIN+ (8,4) VIN− (8,6) VO (15,5) RG (10,8)(12,8) IAREF (14,8)
        { id: 'RG', kind: 'resistor', gx: 10, gy: 10, value: 10000 }, // R_G, wired to the RG pins
        { id: 'G1', kind: 'ground', gx: 8, gy: 8 },           // VIN− to ground
        { id: 'G2', kind: 'ground', gx: 14, gy: 10 },         // IAREF to ground
        { id: 'P1', kind: 'scope1', gx: 17, gy: 5 },
        { id: 'P2', kind: 'scope2', gx: 2, gy: 2 },
      ],
      wires: [
        { x1: 2, y1: 4, x2: 8, y2: 4 },    // W1 -> VIN+
        { x1: 2, y1: 4, x2: 2, y2: 2 },    // input -> 2+
        { x1: 8, y1: 6, x2: 8, y2: 8 },    // VIN− -> ground
        { x1: 10, y1: 8, x2: 10, y2: 10 }, // RG pin 8 -> R_G.a
        { x1: 12, y1: 8, x2: 12, y2: 10 }, // RG pin 9 -> R_G.b
        { x1: 14, y1: 8, x2: 14, y2: 10 }, // IAREF -> ground
        { x1: 15, y1: 5, x2: 17, y2: 5 },  // VO -> 1+
      ],
    },
  },
  {
    id: 'diode-iv', name: 'Diode I-V curve (XY)', group: 'Passive',
    blurb: 'Switch the scope to XY mode to see the curve. CH1 (X) = voltage across the diode, CH2 (Y) = current (I·Rsense). W1 is preset to a triangle sweep.',
    w1: { waveType: 'triangle', frequency: 200, amplitude: 2, offset: 0, dutyCycle: 50, samplingRate: 100000, duration: 0.016 },
    xy: true, ch1Vdiv: 0.5, ch2Vdiv: 0.5,
    schematic: {
      components: [
        { id: 'W1', kind: 'awg1', gx: 2, gy: 4 },
        { id: 'D1', kind: 'diode', gx: 4, gy: 4 },               // anode (4,4) → cathode (6,4)
        { id: 'R1', kind: 'resistor', gx: 6, gy: 4, rotation: 1, value: 220 }, // sense R to ground
        { id: 'G1', kind: 'ground', gx: 6, gy: 6 },
        { id: 'S1', kind: 'scope1', gx: 4, gy: 2 },              // 1+ on the anode
        { id: 'A1', kind: 'adc1n', gx: 8, gy: 4 },               // 1- on the cathode → CH1 = V across diode
        { id: 'S2', kind: 'scope2', gx: 6, gy: 2 },              // 2+ on the cathode → CH2 = I·Rsense
      ],
      wires: [
        { x1: 2, y1: 4, x2: 4, y2: 4 },  // W1 -> anode
        { x1: 4, y1: 4, x2: 4, y2: 2 },  // anode -> 1+
        { x1: 6, y1: 4, x2: 8, y2: 4 },  // cathode -> 1-
        { x1: 6, y1: 4, x2: 6, y2: 2 },  // cathode -> 2+
      ],
    },
  },
  {
    id: 'zener-iv', name: 'Zener I-V curve (XY)', group: 'Passive',
    blurb: 'In XY mode you see the forward knee (~0.7 V) AND the reverse breakdown near −3.3 V. W1 is preset to a ±4 V triangle sweep; if the forward current runs off the top, set CH2 to a coarser Volts/div.',
    w1: { waveType: 'triangle', frequency: 200, amplitude: 4, offset: 0, dutyCycle: 50, samplingRate: 100000, duration: 0.016 },
    xy: true, ch1Vdiv: 2, ch2Vdiv: 1,
    schematic: {
      components: [
        { id: 'W1', kind: 'awg1', gx: 2, gy: 4 },
        { id: 'Z1', kind: 'zener', gx: 4, gy: 4, value: 3.3 },
        { id: 'R1', kind: 'resistor', gx: 6, gy: 4, rotation: 1, value: 220 },
        { id: 'G1', kind: 'ground', gx: 6, gy: 6 },
        { id: 'S1', kind: 'scope1', gx: 4, gy: 2 },   // 1+ anode
        { id: 'A1', kind: 'adc1n', gx: 8, gy: 4 },    // 1- cathode → CH1 = V across Zener
        { id: 'S2', kind: 'scope2', gx: 6, gy: 2 },   // 2+ cathode → CH2 = I·Rsense
      ],
      wires: [
        { x1: 2, y1: 4, x2: 4, y2: 4 },
        { x1: 4, y1: 4, x2: 4, y2: 2 },
        { x1: 6, y1: 4, x2: 8, y2: 4 },
        { x1: 6, y1: 4, x2: 6, y2: 2 },
      ],
    },
  },
]
