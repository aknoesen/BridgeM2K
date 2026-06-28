# Spec — SCH-8 (transistor parts) + SWEEP-1 (parametric curve tracer)

Two paired phases that open the upper-division analog curriculum (BJT/MOSFET biasing, amplifier
design, characteristic-curve families) on top of the existing schematic + ngspice core. They are a
single unit of value: SCH-8 alone gives placeable transistors with only a single I-V sweep; SWEEP-1
alone has nothing to sweep. Build SCH-8 first, then SWEEP-1, then deploy.

Read `docs/CONVENTIONS.md`, `CLAUDE.md`, and `docs/PROGRESS.md` first. Neither phase touches
`core/signal.ts`, so the 12-bit canary holds throughout (Definition of Done item 3).

Scope note: these parts serve the **later analog/electronics courses, not EEC1**. The kit alignment
(below) keeps a student's on-screen parts matching the physical ADALP2000 kit in their hand.

Related specs: `docs/specs/adalp2000-kit.md` (authoritative parts list), `docs/specs/schematic-ngspice.md`
(the circuit model SCH-8 extends), `docs/specs/ina125.md` (the most recent "real part, structural
model" precedent to mirror).

---

## The pattern to mirror: the diode path

SCH-8 is a parts-add that repeats a path already walked for diodes. Trace it before writing code:

- `core/schematic.ts`: the `'diode'` kind in `SchKind`, its `baseTerminals` case (anode `a`,
  cathode `c`), and its `toCircuit` mapping (the `c.kind === 'diode' || 'led' || 'zener'` branch
  that pushes a `{ kind: 'diode', ... }` Spice component).
- `core/netlist.ts`: the `Diode` interface in the `Component` union, and the `case 'diode'` in
  `buildNetlist` that emits a `D<id>` line plus its own per-device `.model DM<id> D(...)` card.
- `components/SchematicEditor.tsx`: the palette entry + symbol render for the diode.
- `core/examples.ts`: `diode-iv` / `zener-iv` (triangle W1 sweep + scope XY mode).

SCH-8 does the same for three-terminal discrete devices. The novel mechanism is the **third
terminal** and a **per-part `.model` card** with a device type (`NPN`/`PNP`/`NJF`/`PJF`/`NMOS`/`PMOS`).

---

## Phase SCH-8 — transistor parts (3-terminal discrete class)

### Device models (netlist layer)

Add a discrete transistor to `core/netlist.ts` as new `Component` members emitting standard ngspice
element + `.model` pairs, one model card per placed device (exactly like `Diode`):

| Device | Element line | Model card | Nodes (order) |
|--------|--------------|------------|---------------|
| BJT | `Q<id> nc nb ne QM<id>` | `.model QM<id> NPN(...)` / `PNP(...)` | collector, base, emitter |
| JFET | `J<id> nd ng ns JM<id>` | `.model JM<id> NJF(...)` / `PJF(...)` | drain, gate, source |
| MOSFET | `M<id> nd ng ns nb MM<id>` | `.model MM<id> NMOS(...)` / `PMOS(...)` | drain, gate, source, bulk |

MOSFET note: ngspice `M` needs four nodes. Discrete TO-92 MOSFETs tie **bulk to source**, so emit
`ns` for the bulk node (the schematic exposes three terminals; the netlist ties body to source).

Model cards: prefer the **manufacturer SPICE `.model` card** for each kit part, validated to parse in
the `eecircuit-engine` ngspice (WASM) build. If a vendor card fails to parse, fall back to a level-1
approximation matched to the datasheet's key numbers (BJT: `BF`, `IS`, `VAF`; MOSFET: `VTO`, `KP`,
`LAMBDA`) and note the substitution in PROGRESS. Default generic cards (used when no specific part is
chosen) are fine, same as the diode's generic-silicon default.

### Part library (kit alignment, per `adalp2000-kit.md`)

Ship only the kit's discrete transistors as named parts. The model *class* supports BJT/JFET/MOSFET,
but the stocked library is:

- BJT NPN: `2N3904`, `2N3903`. BJT PNP: `2N3906`.
- MOSFET N-channel: `ZVN2110A`, `ZVN3310A`. MOSFET P-channel: `ZVP2110A`.
- JFET: **none in the kit.** The `J` element/symbol exists in the model layer for completeness, but
  no JFET part is stocked. Do not add a JFET to the palette unless a course need appears.

### Schematic symbol + terminals (`schematic.ts`, `SchematicEditor.tsx`)

- Add the kinds to `SchKind` (e.g. `'bjt'`, `'mosfet'`, optionally `'jfet'`), each carrying a
  `polarity`/`channel` and a part id (the model selection), like the diode's `value`-driven variants.
- `baseTerminals`: three terminals with the standard discrete symbol geometry (BJT: base on the flat
  side, collector/emitter; MOSFET: gate, drain, source). Keep terminal names matching the table above
  so `toCircuit` maps them unambiguously.
- Draw the conventional symbols (BJT with emitter arrow showing NPN/PNP direction; MOSFET enhancement
  symbol with the arrow on the body). Selectable part like the diode kinds (a Selected-panel dropdown).

### Breadboard footprint (`breadboard.ts`)

Add a **TO-92 / 3-lead footprint** (three adjacent holes in a row, ~0.1 in pitch). Mirror the existing
DIP framework's mapping: the board Check maps the placed transistor's three pins to the schematic
device's terminals. No rail-power Check needed (a discrete transistor has no supply pins, unlike the
op-amp/INA DIPs). Add a small pinout legend (E-B-C or G-D-S, package-face order) in the side panel.

### Files — SCH-8

Allowed: `src/core/netlist.ts`, `src/core/schematic.ts`, `src/components/SchematicEditor.tsx`,
`src/core/breadboard.ts`, `src/core/examples.ts`, `src/index.css` (only if a new symbol color is
needed), `src/core/netlist.test.ts` / `src/core/schematic.test.ts` (sanity tests), and this spec +
`docs/PROGRESS.md` + `docs/ROADMAP.md`.

Forbidden: `src/core/signal.ts` (the canary), the spectrum/FFT path, anything in the signal pipeline.

### Acceptance — SCH-8

1. Place a 2N3904 with collector/base/emitter wired; a generated netlist contains a `Q` line and a
   matching `.model ... NPN(...)` card that ngspice accepts (no parse error).
2. Place a ZVN2110A; netlist contains an `M` line with bulk tied to source and a `NMOS` model card.
3. The breadboard accepts the part as a TO-92 footprint; Check maps its three pins to the schematic
   terminals and passes for a correct transfer, flags a swapped pin.
4. A minimal core test asserts the emitted element + model lines for one NPN and one NMOS part.
5. `tsc` clean, no console errors, 12-bit floor still at −104 dBFS (signal.ts untouched).

---

## Phase SWEEP-1 — parametric curve tracer (W1 sweep + W2 step + scope XY)

Decision (andre, 2026-06-28): build the curve tracer **hardware-faithful**, not as a simulation-native
`.dc` sweep. It extends the existing single-curve I-V path (`diode-iv`: W1 triangle sweep + scope XY
through a sense resistor) by adding W2 to step the controlling parameter.

Rationale: the result maps 1:1 onto a procedure a student can run on a real M2K, so the skill transfers
to the bench; it stays inside the M2K's actual capability (Scopy has no curve-tracer tool, but W1 sweep
+ W2 step + scope XY is a documented M2K technique); it is consistent with how the twin already traces a
single curve; and it survives the G-D "swappable backend" seam. A simulation-native `.dc` tracer can
never run on real silicon, so it would be permanently sim-only and break the ideal-to-bench transfer the
project is built on. The exact, noise-free `.dc` family is explicitly **not** built here; if ever wanted
it is an optional "ideal view," not the primary instrument.

### Method (the bench setup, reproduced)

- **W1** drives the device's swept terminal: Vds (MOSFET) or Vce (BJT). A ramp/triangle over the sweep
  range, exactly as `diode-iv` drives the diode today.
- **W2** sets the stepped parameter, holding each step value while W1 sweeps:
  - MOSFET: W2 = Vgs directly (a voltage). Both W1 and W2 are AWG voltage outputs, so this needs **no
    new primitive**.
  - BJT: W2 steps Ib through an external base resistor Rb, Ib ≈ (V(W2) − Vbe) / Rb, which is how you
    step base current on the bench. The hardware-faithful route therefore **eliminates the current
    source** the `.dc` approach would have required.
- **Scope XY** reads the curve: CH1 (X) = voltage across the device's swept terminals; CH2 (Y) = device
  current sensed as the voltage across a series **sense resistor** (I = V_sense / R_sense), same as the
  diode I-V example. The sense resistor is a real placed part, with the realistic scaling that implies.

### Engine path (existing analyses, no new mode)

This runs on the existing **`.tran`** path through the SPICE worker, the same one the scope/AWG loop
already uses. No `.dc`, no change to the `Analysis` union, no new ngspice element. Build the family one
of two equivalent ways (pick at implementation, document which in PROGRESS):

- **N stepped transient passes (simplest, build first):** for each W2 step value, run a `.tran` with W1
  sweeping and W2 held at that DC level, capture the XY trace, overlay all N. Maps to the manual
  curve-tracer procedure (set gate, sweep drain, record; bump gate, repeat). No new waveform,
  deterministic.
- **Single acquisition with a W2 staircase (most bench-literal, optional):** W1 = fast ramp, W2 = slow
  staircase (period = N ramps), scope XY with **persistence** accumulating the family in one run. Needs
  a staircase waveform option on W2 and XY persistence over the run. Closest to the automated bench setup.

### The Curve Tracer instrument

One instrument = one component file (CONVENTIONS section 3): add `src/components/CurveTracer.tsx`,
a nav entry, and the orchestration in `App.tsx`. It is a thin layer over the existing AWG + scope-XY
path, not a new analysis:

- Reads the active circuit via `toCircuit`; identifies the swept terminal, the stepped source (W2), and
  the sense resistor (user-selected, or inferred from the placed transistor + Rsense).
- Configures the W1 sweep range and the W2 step list, runs the transient pass(es), and renders the
  overlaid XY family with Plotly per CONVENTIONS section 5 (`Plotly.react`, dark theme,
  `displayModeBar: false`): X = swept terminal voltage (Vds/Vce), Y = current via Rsense (Id/Ic), one
  labelled trace per step. **Deterministic** plot; re-render only on circuit/range/step change, debounce
  live re-sim on value drag (section 10).
- View state stays component-local (section 4). Reuses the scope's XY rendering conventions so the
  family looks like what the student sees on a bench scope in XY mode.

Reading the device current is the same trick as the diode I-V: CH2 = the voltage across the series sense
resistor, divided by R_sense. No special ngspice current probe is required.

### Examples (`examples.ts`)

Add at least one curve-family example (e.g. "MOSFET output curves (ZVN2110A)") presetting the W1 Vds
sweep, the W2 = Vgs step list, and the sense resistor, opening the Curve Tracer, so the Quickstart can
say "load X, press Run, read the family." Keep the existing diode/Zener XY examples as-is.

### Files — SWEEP-1

Allowed: `src/components/CurveTracer.tsx` (new), `src/App.tsx` (nav + orchestration),
`src/core/examples.ts`, optionally the signal-gen / `src/core/scope.ts` path for a W2 staircase
waveform (only if the staircase mode is built), `src/index.css` (curve colors if needed),
`src/core/*.test.ts`, and docs. The `Analysis` union and `netlist.ts` analysis directives are **not**
changed (no `.dc`, no new element).

Forbidden: `src/core/signal.ts` and the signal/FFT pipeline.

### Acceptance — SWEEP-1

1. A MOSFET (ZVN2110A) example traces Id-vs-Vds as a family: W1 sweeps Vds, W2 steps Vgs over N values,
   scope XY through Rsense shows N labelled curves with the expected triode/saturation shape.
2. The family is produced via the existing `.tran` path (no `.dc`, no new ngspice element); the netlist
   analysis directives are unchanged from SCH-8.
3. A BJT family (Ic-vs-Vce stepped by Ib through a base resistor) renders, demonstrating the
   no-current-source approach, or is documented as a fast follow-on if time runs out.
4. One example loads and runs with a single button press; the workflow matches a procedure runnable on a
   real M2K (W1 sweep, W2 step, scope XY, sense resistor).
5. **Model fidelity (inherited tuning item from SCH-8) — in scope here, not optional.** The transistor
   models must render a *clean characteristic family* at M2K scales (±5 V, ~mA), not a degenerate set.
   SCH-8 shipped level-1 MOSFET approximations that run hard-on (the drain pulls to ~0, which flattens
   the curves). Tune them as part of SWEEP-1: adjust the level-1 `KP`/`VTO` (or swap in the
   manufacturer device model) so the stepped family shows distinct, separated triode→saturation curves,
   judged against the live Curve Tracer output. Re-verify the `nmos-output-xy` example reads sensibly
   after tuning. This is the right place for it because curve quality can only be judged once the tracer
   exists.
6. `tsc` clean, no console errors, 12-bit floor still at −104 dBFS.

---

## Sequencing and follow-ons

Build order is strict: SCH-8, then SWEEP-1, then deploy the pair (the curve tracer is the payoff and
needs the parts to exist). The Curve Tracer primitive is also the M1K/ALICE curve-tracer primitive, so
SWEEP-1 doubles as groundwork for a future device twin at no extra cost.

After this pair lands, the natural follow-ons are **SCH-9** (op-amp library from the kit) and
**SCH-10** (passives as kit values), both already on the roadmap. They are breadth, not new
capability, so they queue behind this pair rather than alongside it.

## Definition of Done (both phases)

Per CONVENTIONS section 7: `npm run build` clean (no `any`/`@ts-ignore`), no console errors, the
12-bit / Hanning spectrum floor still near −104 dBFS with no inter-harmonic leakage, a core sanity
test for any new `core/` logic, `PROGRESS.md` updated, the relevant `ROADMAP.md` row flipped, and one
focused commit per phase (`schematic: SCH-8 ...` and `spice: SWEEP-1 ...`).
