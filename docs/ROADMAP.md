# ROADMAP.md — master plan and live status

Single source of truth for what is built and what is next. Each CC session flips exactly
one phase's status and records details in `docs/PROGRESS.md`.

Status values: `TODO` · `IN PROGRESS` · `DONE` · `BLOCKED`.

Sessions take the **first `TODO` in order** unless andre directs otherwise. Phases are
ordered so each builds on the last. Dependencies are noted explicitly.

---

## Track A — Oscilloscope (full Scopy parity, two channels)

Spec: `docs/specs/oscilloscope.md`

| Phase | Title | Depends on | Status |
|-------|-------|-----------|--------|
| ARCH-1 | Channel bus in App.tsx (CH1/CH2 source abstraction) | — | DONE |
| OSC-1 | Oscilloscope panel scaffold + timebase + CH1 trace | ARCH-1 | DONE |
| OSC-2 | Second channel (CH2) + per-channel vertical controls | OSC-1 | DONE |
| OSC-3 | Edge trigger engine (source/level/slope, auto/normal/single) | OSC-2 | TODO |
| OSC-4 | Holdoff + pulse/width trigger + single-shot capture (parity) | OSC-3 | TODO |
| OSC-5 | Measurements panel + cursors (Vpp, Vrms, freq, period, duty) | OSC-3 | TODO |

## Track B — Schematic editor + NGSpice WASM (the circuit loop)

Spec: `docs/specs/schematic-ngspice.md`

| Phase | Title | Depends on | Status |
|-------|-------|-----------|--------|
| SPICE-1 | Integrate `eecircuit-engine` behind `SpiceEngine` adapter in a Worker | — | DONE |
| SPICE-2 | Circuit graph model + netlist generator (`core/netlist.ts`) | SPICE-1 | DONE |
| SCH-1 | Browser schematic editor MVP (place/wire R,C,L,V,opamp,gnd) | — | DONE |
| SCH-2 | Bind editor → circuit graph → netlist | SCH-1, SPICE-2 | DONE |
| SCH-3 | Save/Load circuit (download/open `.json` + localStorage autosave) | SCH-1 | DONE |
| NET-1 | Network Analyzer instrument (Bode mag+phase, sine-sweep via ngspice `.ac`) | SPICE-2 | DONE |
| LOOP-1 | Close the loop: generator → circuit → Network Analyzer (AC Bode) + Scope CH2 (transient) | SCH-2, OSC-2, NET-1 | IN PROGRESS |
| LOOP-2 | Live value tuning + transient/AC toggle + −3 dB cursor | LOOP-1 | TODO |
| KICAD-1 | (Stretch) KiCad netlist import | LOOP-1 | TODO |

Notes:
- **Track A and Track B can run in parallel** up to the point LOOP-1 needs both
  `OSC-2` (a second channel to show circuit output) and `SCH-2` (a netlist to simulate).
- `SPICE-1` and `SCH-1` have no dependency on each other and can be done in either order.
- ARCH-1 is small but unblocks the whole scope track; do it first.

---

## Track C — Bench instruments (Power Supply, Voltmeter)

Spec: `docs/specs/schematic-ngspice.md` (these instruments couple to the simulated circuit).

| Phase | Title | Depends on | Status |
|-------|-------|-----------|--------|
| PSU-1 | Power Supply instrument — 2 rails (0..+5 V / 0..-5 V), tracking + independent | SPICE-2 | TODO |
| DMM-1 | Voltmeter instrument — 2-channel AC/DC (±25 V), reads node V via `.op`/RMS | SPICE-2 | DONE |

Notes:
- These mirror real Scopy/M2K instruments (supplies 0..+5 V & 0..-5 V; voltmeter AC/DC ±25 V).
- **SPICE-2 must lay the groundwork** (see its spec): the circuit graph models DC supply
  rails so op-amps can be powered, and `buildNetlist` supports `.op`/`.dc` for the voltmeter.
- PSU rails become DC sources powering active parts (op-amp); the Voltmeter reads a node.
- Out of scope for now (digital, not needed for EEC1 analog labs): Logic Analyzer, Pattern
  Generator, Digital IO. Revisit only if a course need appears.

## Track D — Breadboard interconnect (wire sources ↔ detectors)

Decision (2026-06-26): the **Circuit editor is the breadboard / patch panel**. Instrument I/O
are placeable ports wired to the circuit, mirroring the M2K bench (W1/W2 DAC outputs → circuit
→ scope ADC inputs). **Two-tier resolution** preserves the existing signal pipeline: a scope
input wired straight to a generator reads the exact `generateSignal` output (all waveforms +
ADC noise); wired through a circuit it reads a SPICE `.tran` of that node.

| Phase | Title | Depends on | Status |
|-------|-------|-----------|--------|
| WIRE-1 | Breadboard ports in the schematic (W1/W2, Scope1/2) + toCircuit net mapping | SCH-1 | DONE |
| WIRE-2 | Instruments read from their wired node (direct fast path + `.tran`) | WIRE-1, OSC-2 | DONE |
| WIRE-3 | Scope/Spectrum read their wired node via `.tran`; non-sine PULSE drive | WIRE-2 | TODO |

Notes:
- WIRE-1 replaced the old "V src"/"Probe" palette items with **W1/W2** (gen outputs) and
  **Scope 1/Scope 2** (ADC inputs); `dcrail` relabelled **V+/V-**. The model keeps `vsource`/
  `probe` kinds for back-compat. The Network Analyzer still uses the `in`/`out` nets.
- WIRE-2 is where the standalone scope/spectrum actually read the node they are wired to
  (today they still read the generator directly). It also finishes LOOP-1's scope half.

## Recommended session sequence

A reasonable single-developer (single CC session per row) order:

1. ARCH-1 — channel bus
2. SPICE-1 — prove ngspice WASM loads and simulates (de-risks the hardest unknown early)
3. OSC-1 — scope scaffold + CH1
4. OSC-2 — CH2
5. SPICE-2 — netlist generator
6. OSC-3 — edge trigger
7. SCH-1 — schematic editor MVP
8. OSC-4 — trigger parity
9. SCH-2 — editor → netlist
10. OSC-5 — measurements/cursors
11. NET-1 — Network Analyzer instrument
12. LOOP-1 — close the loop + Bode
13. LOOP-2 — live tuning
14. PSU-1 / DMM-1 — Power Supply + Voltmeter (after SPICE-2; slot when active circuits arrive)
15. KICAD-1 — stretch

Rationale: SPICE-1 is sequenced second on purpose. It carries the most technical risk
(WASM under the GitHub Pages base path, Worker boundary). Proving it early means the
schematic and loop work later rests on a known-good foundation rather than discovering a
blocker at LOOP-1.

---

## Definition of "the MVP is shippable"

Two meaningful milestones to deploy:

- **Scope MVP shippable** after OSC-3 (a working triggered two-channel scope is genuinely
  useful for Lab 3, even before holdoff/pulse parity). Deploy, then continue to OSC-4/5.
- **Circuit-loop MVP shippable** after LOOP-1 (draw an RC filter, see the Bode curve in the
  Network Analyzer). This is the headline pedagogical payoff described in `CLAUDE.md`.

When a milestone deploys, note the deployed commit hash in `PROGRESS.md` and revisit the
Lab 3 prelab `<!-- TWIN: -->` markers referenced in `CLAUDE.md`.

---

## How to update this file

When you finish a phase, change its `Status` cell to `DONE`. If you are mid-phase and have
to stop, set `IN PROGRESS` and explain state in `PROGRESS.md`. If blocked, set `BLOCKED`
and write the blocker and what would unblock it. Never silently leave a phase you worked on
as `TODO`.
