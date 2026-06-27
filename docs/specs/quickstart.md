# Spec — Track H / QS-1: In-app Quickstart

## Goal

An onboarding panel for two audiences at once:
- a first-time user of this app, and
- someone meeting the real ADALM2000 (M2K) for the first time.

The initial objective is the **bridge between the real M2K and this app**: make clear that each
panel mirrors a Scopy/M2K instrument, then walk one concrete measurement end to end.

## Scope (this phase)

1. **M2K ↔ app map.** Short intro (DAC outputs = supplies + W1/W2; ADC inputs = voltmeter + scope),
   then a table pairing each real instrument with its app panel, each row with an **Open** button.
   Includes the W1/W2-are-signal-not-power (≈50 Ω) caveat from Lab 1 (the twin models it).
2. **Lab 1 walkthrough — voltage divider on Power Supply + Voltmeter.** Three numbered steps with
   action buttons that drive the app: load the `divider` example and show the circuit; open the
   Power Supply (V+ = applied, default +5 V); open the Voltmeter (CH2 = applied ≈5 V, CH1 = midpoint
   ≈2.5 V). Note single-ended vs differential.
3. **Where next.** A few one-click loaders (RC low-pass → Network, inverting amp → Scope, diode I-V
   → Scope XY).

Out of scope here: a full per-instrument tour (future QS-2), screenshots/figures, video.

## Design

- `components/Quickstart.tsx` — static content; **touches no `core/` math**. Props:
  `onGoTo(id)` (switch panel) and `onLoadExample(id)` (load a built-in example).
- `App.tsx` — `ActiveInstrument` gains `'quickstart'`; a `loadExample(id)` helper (mirrors the
  Circuit editor's Examples dropdown: snapshot, swap schematic, reset both generators to
  defaults+presets, request scope XY/Volts-div); `renderPanel` case; a top nav button (under the
  logo, first item, so it is the most discoverable entry); Welcome wiring.
- `Welcome.tsx` — gains `onQuickstart` and a "New to the M2K? Start with the Quickstart" link that
  enters the app straight into the Quickstart panel.

Reuses the deterministic example library (each example presets generators + Volts/div and the
editor opens on the Select tool), so "load X, open Y, read Z" is reliable.

## Acceptance criteria

- Quickstart reachable from the nav and from the Welcome screen.
- Step buttons load the divider and navigate; Voltmeter then reads ≈5 V (applied) / ≈2.5 V (midpoint).
- `tsc` clean; 12-bit canary unaffected (no `core/` changes).

## Done in QS-1 follow-up

- Single-ended vs differential measurement: illustrated SVG section in the intro (measure one supply
  vs measure across both), placed before the Lab 1 walkthrough — students must get this subtlety early.
- "Return to Quickstart" affordance: once opened, the Quickstart nav button gold-pulses whenever the
  user is on another panel (its steps send you elsewhere), so the way back is always obvious
  (`.nav-hint` in `App.css`, `quickstartSeen` in `App.tsx`).

## QS-2 — guided instrument sequence (next, planned with andre 2026-06-27)

Continue the same load-then-look flow through the natural lab order after the Voltmeter:

1. **Signal Generator + Oscilloscope.** Drive W1, view it on the scope in normal **time-base (YT)**
   first. Then introduce **XY mode** — the **Zener I-V** example is the showcase (sweep, see the
   forward knee + reverse breakdown). Step buttons: load example, open scope, toggle YT→XY.
2. **Network Analyzer + digitization.** Explain what the user is presented with (mag/phase Bode
   sweep) AND the digitization story: the 12-bit ADC, and **what dBFS means** (decibels relative to
   full-scale: 0 dBFS = ADC full scale = ±2.5 V here; the noise floor sits ~−104 dBFS at 12-bit).
   Likely needs a small explanatory diagram of full-scale → dBFS and the quantization floor. Tie to
   the Spectrum Analyzer's Learning Mode (bit-depth comparison) which already teaches this.
3. **Circuit/simulation → board.** Explain the transfer: draw + simulate the circuit, then move it to
   the Breadboard view and use Check to verify the physical layout matches the schematic
   (Practice vs Bench modes). Bridges Lab 1/2 (ideal schematic → physical bench).

Out of scope still: video, screenshots of real Scopy. Keep diagrams as inline themed SVG.

- Also: hook Lab prelab `<!-- TWIN: -->` markers (see CLAUDE.md) to deep-link the relevant step.
