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
| OSC-3 | Edge trigger engine (source/level/slope, auto/normal/single) | OSC-2 | DONE |
| OSC-4 | Holdoff + pulse/width trigger + single-shot capture (parity) | OSC-3 | DONE |
| OSC-5 | Measurements panel + cursors (Vpp, Vrms, freq, period, duty) | OSC-3 | DONE |

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
| LOOP-1 | Close the loop: generator → circuit → Network Analyzer (AC Bode) + Scope CH2 (transient) | SCH-2, OSC-2, NET-1 | DONE |
| LOOP-2 | Live value tuning + transient/AC toggle + −3 dB cursor | LOOP-1 | DONE |
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
| PSU-1 | Power Supply instrument — 2 rails (0..+5 V / 0..-5 V), tracking + independent | SPICE-2 | DONE |
| PSU-2 | Live per-rail current via `.op` (sum `i(Vrail)`) vs the ~50 mA M2K limit; W1/W2-not-power note | PSU-1 | DONE |
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
| WIRE-3 | Scope/Spectrum read their wired node via `.tran`; non-sine PULSE drive | WIRE-2 | DONE |
| EDIT-1 | Rubber-band wires: endpoints follow a component when it is moved/rotated | SCH-1 | DONE |

Notes:
- WIRE-1 replaced the old "V src"/"Probe" palette items with **W1/W2** (gen outputs) and
  **Scope 1/Scope 2** (ADC inputs); `dcrail` relabelled **V+/V-**. The model keeps `vsource`/
  `probe` kinds for back-compat. The Network Analyzer still uses the `in`/`out` nets.
- WIRE-2 is where the standalone scope/spectrum actually read the node they are wired to
  (today they still read the generator directly). It also finishes LOOP-1's scope half.
- **EDIT-1 (rubber-band)** — today a wire is two fixed grid endpoints; moving a connected
  component leaves its wires behind. Make any wire endpoint that coincides with a component
  terminal **track that terminal** when the component is dragged or rotated, so the connection
  visibly stretches and stays attached. Design: on move/rotate, recompute the component's
  terminals (`terminalsOf` in `schematic.ts`); for each wire endpoint equal to an old terminal
  coord, snap it to the new coord in the same state update. Pure model helper in `schematic.ts`
  + the drag handler in `SchematicEditor.tsx`; nets are recomputed by the existing `computeNets`
  union-find, so connectivity is preserved by construction. Acceptance: drag an R wired on both
  pins → both wires follow; rotate it → endpoints move to the rotated terminals; `computeNets`
  reports the same nets. Endpoints-only for this phase (no mid-wire bends). Small self-contained
  editor UX win; schedule independently of WIRE-3/LOOP.

## Track E — Dockable panels + saveable workspaces

Spec: `docs/specs/docking-workspace.md`

| Phase | Title | Depends on | Status |
|-------|-------|-----------|--------|
| E-1 | Preset snap layouts (lab-keyed multi-panel, no new dependency) | OSC-2, NET-1 | TODO |
| E-2 | True dockable panels via docking lib (dockview) + geometry workspace save/load | E-1 | TODO |
| E-3 | Full-config workspace (persist each instrument's settings) — OPTIONAL | E-2 | TODO |

Notes:
- **Do not start mid-feature.** This refactors the `<main>` panel-mount block in `App.tsx`;
  land the circuit-loop MVP (WIRE-3 / LOOP-1) on a stable instrument set first.
- **Two-tier cost:** saving panel *geometry* is cheap (a docking lib serializes it; localStorage
  pattern already exists). Saving each instrument's *config* is expensive because much of it lives
  in component-local `useState` (per CONVENTIONS §4) and would have to be lifted — that is E-3 and
  touches every component. Decide per phase which tier is in scope.
- **Do not hand-roll docking.** E-2 adopts **dockview** (TS-native, layout JSON serialize)
  behind a `components/Workbench.tsx` wrapper (swappable, like the SpiceEngine adapter). This is a
  new core runtime dependency → CONVENTIONS §2 requires a PROGRESS note + director sign-off.
- **Pedagogy caution:** real Scopy has a fixed tool menu. Free docking can confuse first-years
  ("I lost my Spectrum panel"). E-1 presets may be the right stopping point for the course.
- None of Track E touches `core/signal.ts`; the 12-bit canary must hold throughout.

## Track F — Breadboard layout (schematic → bench transfer)  ← NEXT (andre, 2026-06-26)

Spec: `docs/specs/breadboard.md`

| Phase | Title | Depends on | Status |
|-------|-------|-----------|--------|
| F-1 | Breadboard model + parametric SVG render + Practice-mode net colouring | SCH-1 | DONE |
| F-2 | Drag 2-pin parts from schematic + jumpers + verification loop (board ≟ schematic) | F-1 | DONE |
| F-3 | (Stretch) DIP/IC footprints (op-amp, INA) + optional "show one valid layout" hint | F-2 | TODO |

Decisions (locked with andre, 2026-06-26):
- **Verification loop is the centerpiece** — Check tells the student if their board is electrically
  the schematic, with per-connection feedback. Reuses `computeNets` on both sides.
- **Parametric SVG board** (not a photo): regular geometry, exact hole coords, theme-able, no
  licensing/alignment.
- **Two modes:** *Practice* (live net colouring, default) and *Bench/Exam* (no hints; place from
  your own mental model, then Check — the "sneaky"/realistic mode + graded transfer).
- **Drag from the schematic** (parts keep id/value), **stacked view** (schematic on top, board
  below — NOT side-by-side), **2-pin parts first** (DIP in F-3).
- Prioritised **next** ahead of OSC-3/LOOP-2 at andre's direction — it bridges the Lab 1/2 gap
  (ideal schematic → physical bench). None of Track F touches `core/signal.ts`.

## Track G — iio-emu / real-Scopy integration (andre, 2026-06-26, post-AD meeting)

Spec: `docs/specs/iio-scopy.md`

| Phase | Title | Depends on | Status |
|-------|-------|-----------|--------|
| G-A | Fidelity alignment: match the twin's params/names to AD's `adalm2000.xml` + ADC/DAC source | — | DONE |
| G-B | SPICE-in-the-loop with **real Scopy** via iio-emu generic mode (bridge: TX file → ngspice → RX file) | G-A, SCH-2 | TODO |
| G-C | (Long horizon, parked) browser twin speaks IIO via a libiio-over-WebSocket bridge | G-B | TODO |

Notes:
- **Complementary native path, not a pivot.** The browser twin stays the zero-install student tool;
  Track G adds a lab/pro mode + the AD-facing showcase (real Scopy displaying a SPICE-simulated circuit).
- **G-A is cheap and browser-only** — pull AD's authoritative M2K numbers (sample rate, 12-bit
  scaling, ±range, channel names/scan formats) from `iiod/context/adalm2000/adalm2000.xml` +
  `m2k_adc.cpp`/`m2k_dac.cpp` and reconcile with the twin's constants. Do it next; high credibility.
- **G-B is the headline demo** but native/install-heavy (iio-emu + Scopy + a bridge running ngspice);
  schedule deliberately, de-risk with a plain loopback first.
- ADIBSD-licensed (permissive). None of Track G touches `core/signal.ts`.

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
