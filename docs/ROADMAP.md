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
| SCH-5 | Amplifier model picker: sim-only (ideal, no rails) vs sim+build (LMC662, rails) via Selected-panel Type dropdown | SCH-1 | SUPERSEDED |
| SCH-6 | Op-amp is LMC662-only (no package-less ideal): 3-pin schematic symbol, auto ±5 V in sim, boards as an 8-pin DIP whose V+/V− the Check requires on the rails. Replaces SCH-5's picker. | SCH-5, F-5 | DONE |
| SCH-7 | INA125 instrumentation amp as the only in-amp (dropped ideal/3-op-amp): structural model (external R_G sets G = 4 + 60 kΩ/R_G, validated G=10); boards as a 16-pin DIP with pinout legend; rail-power Check (V+ pin1 / V− pin3). See `docs/specs/ina125.md`. | SCH-6, F-5 | DONE |
| SCH-7b | INA125 auxiliary-pin straps from Lab 8 Fig 1: board Check enforces the datasheet-mandated chip wiring (SLEEP→V+, VREFout→VREF2.5, IAref→GND, Sense→Vo, VREFcom→GND) via a generic per-DIP `straps` mechanism; legend lists the required strapping. | SCH-7 | DONE |
| SCH-8 | **Transistor models** — BJT (NPN/PNP → ngspice `Q` + `.model`), JFET (N/P → `J`), MOSFET (N/P → `M`, level-1 or a part model). Adds a new 3-terminal discrete-symbol class to the schematic, a TO-92 / 3-lead breadboard footprint, and a part library matching the **ADALP2000 kit**: `2N3904`/`2N3903` (NPN), `2N3906` (PNP), `ZVN2110A`/`ZVN3310A` (N-MOSFET), `ZVP2110A` (P-MOSFET). For the later analog/electronics courses, **not EEC1**. Mirrors the diode path (SCH/diode). See `docs/specs/sch8-sweep1.md`. | SCH-1, SPICE-2 | DONE |
| SCH-9 | **Op-amp / amplifier library from the ADALP2000 kit.** Extend the op-amp from LMC662-only to a selectable set of the kit's parts, each a *behavioral macro of a real part* (GBW, slew, supply range, input type, rail-to-rail or not) with its own DIP footprint — **not** a package-less generic "ideal". Op-amps: `ADTL082` (JFET dual), `AD8542` (CMOS RRIO dual), `OP27`/`OP37` (precision bipolar; OP37 decompensated), `OP97` (precision µpower), `OP482`/`OP484` (JFET/RRIO quad). Selectable like the diode kinds. *Delivered:* `core/opamps.ts` catalog + level-1 macromodel (`buildOpampSubckt`); kit dropdown in the inspector with off-kit "not in your parts kit" badge + Swap-to-OP484; OP37-gain-<5 and AD8542-over-supply gotcha warnings; examples migrated to OP484. **`AD8226` (2nd in-amp) and `AD8561` (comparator) deferred to a later specialty phase**, with vendor SPICE-model import as an optional enhancement. | SCH-6, SCH-7 | DONE |
| SCH-10 | **Passives as pick-and-place kit values.** Today R/C/L take any value; add a quick-pick palette of the **ADALP2000 kit's stocked values** so students design with what they physically have. Keep free numeric entry, but add the palette and an optional "nearest kit value" snap/flag (a computed 3.7 kΩ flags to the stocked 4.7 kΩ). Also add the kit's **potentiometers** (5/10/50 kΩ), the **thermistor**, and a **polarized electrolytic** cap variant (the kit's ≥1 µF caps are polarized). Full value list + dielectric/polarity notes in `docs/specs/adalp2000-kit.md`. | SCH-1 | DONE |
| SWEEP-1 | (Enables SCH-8 showcase) **Parametric curve tracer (hardware-faithful).** Characteristic-curve families (MOSFET Id-Vds stepped by Vgs; BJT Ic-Vce stepped by Ib) by extending the existing single-curve I-V path (W1 sweep + scope XY through a sense resistor) with W2 stepping the controlling parameter. Runs on the existing `.tran` path — **not** a new analysis mode; W2 steps Ib through a base resistor so no current source is needed. Maps to a real M2K procedure and survives the G-D hardware seam (a sim-only `.dc` tracer would not). See `docs/specs/sch8-sweep1.md`. | SCH-8, OSC-5 | DONE |
| KICAD-1 | (Stretch) KiCad netlist import | LOOP-1 | TODO |

Notes:
- **Parts library should track the ADALP2000 kit** (SCH-8 / SCH-9). The physical analog parts kit
  that ships with the M2K is the authoritative list, so a student's on-screen parts match the parts
  in their hand. Active analog parts in the kit:
  op-amps ADTL082 / AD8542 / OP27 / OP37 / OP97 / OP482 / OP484, in-amps AD8226 (+ the INA125 from
  Lab 8), comparator AD8561, transistors 2N3904/2N3903/2N3906 + ZVN2110A/ZVN3310A/ZVP2110A, diodes
  1N914/1N4001 + Zeners (1N4735 etc.). The kit's existing diode/Zener parts already map onto the
  built diode/zener kinds. Specialized kit parts (AD584 ref, LT3080/LT3092 regulators, AD592, AD654,
  AD5626/AD7920, charge pumps, timers) are out of scope for the circuit twin. Full kit BOM (exact
  R/C/L values, polarity/dielectric notes, the actives list) lives in `docs/specs/adalp2000-kit.md`.
  Source: `wiki.analog.com/university/tools/adalp2000/parts-index`.
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
| E-1 | Preset snap layouts (lab-keyed multi-panel, no new dependency) | OSC-2, NET-1 | DONE |
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
| F-3 | DIP/IC footprints on the board — LMC662 8-pin DIP (generic DIP framework; op-amp/INA are a trivial follow-on) | F-2 | DONE |
| F-4 | **Per-part op-amp board packages** (promoted from stretch — real default-path bug). The board hardcodes the LMC662 8-pin DIP for every op-amp, so the default **OP484 (14-pin quad)** shows a wrong "LMC662" 8-pin part. Step 0: **remove ADTL082 + AD8542** (breakout boards, not breadboard DIPs — andre 2026-06-28), so every remaining kit op-amp is a DIP. Then drive the footprint from `c.part` + the `opamps.ts` catalog: 8-DIP single (OP27/37/97), 14-DIP quad (OP482/484), 8-DIP dual (off-kit LMC662); keep INA125 16-DIP. Optional: "show one valid layout" hint (D2 deferred to F-4b). Board/UI only, no `core/signal.ts`. See `docs/specs/f4-opamp-board-packages.md`. | F-3 | DONE |
| F-5 | Fixed M2K connector strips (top: 1+ 2+ GND V+ W1 GND TI; bottom: 1− 2− GND V− W2 GND), color-coded V+ red / V− blue / GND neutral, replacing placeable ports — jumper from them; Check anchors on the terminals. Standard power distribution pre-wired & always-present (GND→both outer rails, V+→top inner, V−→bottom inner), rails labelled; terminal jumpers carry the terminal's colour | F-2 | DONE |
| F-6 | **Breadboard-view layout controls.** The combined `breadboard` view stacks SchematicEditor + Breadboard 50/50 in one 100vh column and is cramped. Add a draggable horizontal splitter (remembered ratio, localStorage) and a stacked↔side-by-side orientation toggle for wide monitors. Keeps the stacked transfer metaphor as default; no new dependency; does not touch `core/signal.ts`. See `docs/specs/breadboard-view-layout.md`. | F-2 | DONE |

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

## Track H — Onboarding / in-app Quickstart  ← requested (andre, 2026-06-27)

Spec: `docs/specs/quickstart.md`

| Phase | Title | Depends on | Status |
|-------|-------|-----------|--------|
| QS-1 | In-app Quickstart panel (nav button + Welcome link): M2K↔app bridge + Lab 1 walkthrough (divider on Power Supply + Voltmeter), with step buttons that load examples and jump to instruments | examples.ts | DONE |
| QS-2 | Guided instrument sequence after the Voltmeter: Signal Gen + Scope (YT then XY, Zener I-V showcase) → Network Analyzer + digitization/dBFS explainer (with diagram) → circuit/sim → board transfer. See spec. | QS-1 | DONE |
| QS-3 | (Future) figures/screenshots; hook Lab prelab `<!-- TWIN: -->` markers to deep-link steps | QS-2 | TODO |

Notes:
- **Goal:** get a general (non-CC) user going. Open an example → see it framed → understand
  what each instrument shows. Lean on the now-deterministic examples (each presets its
  generators + Volts/div and resets the tool to Select), so the doc can say "load X, press Run,
  read Y" and it just works.
- **Suggested arc** (matches the actual EEC1 instrument-introduction order from Lab1Instructions.md
  §1.1: Power supply + Voltmeter = Lab 1, Spectrum = Lab 3, Scope + Function generator = Lab 4,
  Network analyzer = Lab 5): Voltage divider on the **Power Supply + Voltmeter** (Lab 1 worked
  example — set V+, read applied vs midpoint single-ended; mention the differential measurement
  too, per Lab 1 §4) → **Signal Generator (W1/W2) + Oscilloscope** → **Spectrum analyzer** →
  **Network analyzer** (RC/RL filters, Bode) → op-amp examples → I-V curves (XY) → breadboard transfer.
- **Start material (now connected):** andre's `Lab1Instructions.md` at
  `C:\Users\aknoesen\Documents\Knoesen\EEC1 Spring 2026\organize coursematerials\Labs_2027\Lab1\Lab1Instructions.md`.
  Good seeds for the intro: the ADC/DAC + 12-bit overview (§1.1), the instruments-by-lab table,
  and the Lab 1 power-supply/voltmeter procedure (§3–4). Note its W1/W2-are-signal-not-power
  caveat (49.9 Ω output) — the twin already models this.
- **Delivery:** a Markdown/HTML doc rendered in-app (a `Quickstart` panel like `About`, or a
  modal off the Welcome screen). Keep it course-agnostic enough for any first-time user, with the
  EEC1 lab arc as the worked example. None of this touches `core/signal.ts`.

## Track I — ADC/DAC fidelity & sampling control  ← planned (andre, 2026-06-28)

The twin currently models **ADC** quantization (synthetic Gaussian noise in `computeSpectrum`) but
the generator/**DAC** path is ideal, and the ADC sample rate is fixed at 100 kSa/s (displayed, not
settable). These two items close that gap so students can run sampling-rate and quantization
experiments. Both touch `core/signal.ts`, so the 12-bit canary must be re-verified after each.

| ID | Deliverable | Depends on | Status |
|----|-------------|-----------|--------|
| SIG-1 | **Settable ADC sample rate.** A user control for the acquisition Fs (drives the Spectrum and the scope capture path), enabling aliasing (sub-Nyquist), oversampling noise-reduction, and the Fs/N/bin-width relationship. Keep zero-leakage framing: `snapDuration` already rounds to whole periods, but verify exact harmonic-bin landing at each offered rate. Decisions: **preset dropdown** (5/10/20/50/100/200 kSa/s, default 100), all three demos in scope. See `docs/specs/sig1-adc-sample-rate.md`. | — | DONE |
| SIG-2 | **Optional DAC quantization** on the generator (W1/W2), modelling the M2K's 12-bit AWG DAC. **Default OFF** so the ADC bit-depth Learning Mode stays clean (an always-on DAC floor would muddy the ADC canary). When on, teaches "both ends quantize": DAC out, ADC in, sample rate the knob between. Spec: `docs/specs/sig2-dac-quantization.md`. Decisions locked: synthetic noise-floor model (NOT actual quantization, NOT touching `generateSignal`) added as a gated DAC term in `computeSpectrum`, in the Spectrum Analyzer next to the ADC selector; selectable 4/8/12 bits, default 12. | SIG-1 | DONE |

Notes:
- The pedagogical pairing: SIG-2 (DAC out) + ADC quantization (in) + SIG-1 (sample rate between) is a
  complete digitization story for EEC1's sampling/quantization labs.
- **Canary:** with no circuit and the default rate, the 12-bit ADC floor must still sit at −104 dBFS.
  SIG-2 must be verified OFF-by-default; SIG-1 must not reintroduce inter-harmonic leakage.

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
