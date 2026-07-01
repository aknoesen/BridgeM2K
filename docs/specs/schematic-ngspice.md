# SPEC — Schematic editor + NGSpice WASM (the circuit loop)

Goal: close the loop described in `CLAUDE.md` — **Signal Generator output → circuit →
Spectrum Analyzer / Oscilloscope input** — entirely in the browser, no hardware. A student
draws an RC filter, sets the cutoff, and sees the Bode curve emerge in the Network
Analyzer instrument; the same measurement they will later make on the bench.

Read `docs/CONVENTIONS.md` first. SPICE/netlist logic lives in `src/core/`, the editor UI in
`src/components/SchematicEditor.tsx`.

---

## Engine decision (made — do not re-litigate without sign-off)

**Use `eecircuit-engine`** (npm, MIT license) as the SPICE engine.

Why this one:
- It is ngspice compiled to WebAssembly with a clean, documented **TypeScript** API:
  `new Simulation()` → `await sim.start()` → `sim.setNetList(netlist)` → `await sim.runSim()`.
- **MIT-licensed** wrapper over BSD-licensed ngspice — both permissive, fine for an
  educational tool. (Underlying ngspice is modified-BSD.)
- Netlist input is **standard ngspice format**, so the schematic layer stays fully decoupled
  from the solver — exactly the architecture `CLAUDE.md` calls for.
- Supports the analyses we need: **transient** (`.tran`) for time-domain into the scope and
  **AC** (`.ac`) for the Bode plot in the Network Analyzer instrument.
- It is itself a Vite/TypeScript project, so it fits this toolchain.

Risk and mitigation:
- It is a **small project** (low stars, few maintainers). Mitigate by putting it behind our
  own `SpiceEngine` adapter interface (below) so it can be swapped for **tscircuit/ngspice**
  (MIT wrapper, also ngspice-WASM) or **ngspiceX** with no change to callers.
- WASM asset loading must respect the `/benchbridge/` base path (see CONVENTIONS §11).

Alternatives considered (keep as fallbacks, do not install now): `tscircuit/ngspice`,
`ngspiceX`, `danchitnis/ngspice`. All are ngspice-WASM; the adapter makes them
interchangeable.

---

## Phase SPICE-1 — Engine integration behind an adapter, in a Worker

**Goal:** prove ngspice WASM loads and runs a hardcoded netlist, off the main thread, in a
production build under the GitHub Pages base path. This de-risks the hardest unknown — do it
early (see ROADMAP sequence).

**Implement:**
- `npm install eecircuit-engine` (note it in PROGRESS).
- `src/core/spice.ts` — define the **adapter interface** and an `eecircuit-engine`-backed
  implementation:

```typescript
export interface SimResult {
  // parsed, engine-agnostic shape — NOT the raw engine output
  variables: string[]               // e.g. ['time', 'v(out)'] or ['frequency', 'v(out)']
  data: Float64Array[]              // column-major, one array per variable
  analysis: 'tran' | 'ac' | 'dc' | 'op'
}

export interface SpiceEngine {
  init(): Promise<void>
  run(netlist: string): Promise<SimResult>
  dispose(): void
}

export function createSpiceEngine(): SpiceEngine   // returns the eecircuit-engine impl
```

- Run the engine in a **Web Worker** so `runSim` never blocks rendering. The adapter's
  async methods hide the worker boundary from callers. (eecircuit-engine's API is already
  async; the worker is about keeping the heavy WASM call off the UI thread.)
- Parse the engine's raw result into the normalized `SimResult` (decouples the rest of the
  app from eecircuit's output format — essential for swappability).
- A throwaway dev affordance (a button or a temporary panel) that runs a hardcoded RC
  netlist and logs/plots the result, to prove the pipeline. Remove or gate it before
  later phases.

**Acceptance criteria:**
- A hardcoded RC low-pass `.ac` and `.tran` netlist runs and returns parsed data.
- **Works in `npm run build && npm run preview`**, not only `npm run dev` — confirm the
  `.wasm` loads under `/benchbridge/`. This is the real test of this phase; document it.
- UI stays responsive during `runSim` (worker confirmed).
- Build clean; spectrum regression canary holds.

**Files allowed:** `src/core/spice.ts` (new), a worker file (e.g. `src/core/spice.worker.ts`),
`package.json`/lockfile (the one dependency), `vite.config.ts` (only if worker/wasm config is
required — document any change), a temporary test affordance, docs.
**Files forbidden:** `core/signal.ts`, the existing instruments' math.

---

## Phase SPICE-2 — Circuit graph model + netlist generator

**Goal:** a typed circuit representation that produces correct ngspice netlists, independent
of any UI.

**Implement:**
- `src/core/netlist.ts`:
  - Types for a circuit graph: `Node` (named net, e.g. `in`, `out`, `0` for ground) and
    `Component` (discriminated union: resistor, capacitor, inductor, voltage source,
    op-amp, ground). Each component has an id, value(s), and the nets it connects.
  - `buildNetlist(circuit, analysis)` → ngspice netlist string. Supports `.tran` and `.ac`
    directives parameterized by the analysis settings (start/stop freq, points/decade for
    AC; step/stop for transient).
  - The input source maps to the **Signal Generator**: a `V` source whose amplitude/
    frequency/offset/waveshape come from `SignalParams` (sine → `SIN(...)`, for AC a `AC 1`
    source). Document the mapping.
- Minimal op-amp model: an ideal/VCVS-based subcircuit is enough for EEC1 (inverting amp,
  INA-style front end). Do not require students to supply transistor models.

- **Accommodate the bench instruments now (Track C) to avoid rework:**
  - Represent **DC supply rails** in the circuit graph (e.g. a `dcSource` / rail component, or
    reserved nets like `vcc`/`vee`) whose values are set by the Power Supply instrument
    (PSU-1). The op-amp model takes power-rail nets so it can later be powered/clipped; the
    simplest ideal VCVS may ignore them, but the nets must exist in the model.
  - Make `buildNetlist` support an **`.op`** (operating-point) and/or **`.dc`** analysis in
    addition to `.tran`/`.ac`, so the Voltmeter (DMM-1) can read a node's DC voltage. The
    engine + `SimResult` already carry `'op'`/`'dc'` analysis kinds.
  - Keep these as model capabilities only — no PSU/DMM UI in SPICE-2 (that is PSU-1/DMM-1).

**Acceptance criteria:**
- `buildNetlist` for a known RC low-pass produces a netlist that, fed to the SPICE-1 engine,
  yields the expected −3 dB point at `f = 1/(2πRC)` within tolerance. **Add a Vitest test**
  asserting the netlist string and (if practical) the simulated cutoff. (If no test harness
  exists yet, this phase may add Vitest as a dev dependency — note it.)
- Build clean; regression canary holds.

**Files allowed:** `src/core/netlist.ts` (new), test files, `package.json` (dev-only test
dep if added), docs.

---

## Design note — analysis-aware sources (WIRE-2)

A breadboard port has a role, but its SPICE source line depends on the analysis the instrument
runs. The SAME W1 port emits differently:

| Instrument | Analysis | W1 netlist line | Why |
|-----------|----------|-----------------|-----|
| Network Analyzer | `.ac` | `Vw1 in 0 AC 1` | transfer function V(out)/V(in) cancels amplitude; freq swept by `.ac` |
| Scope / Spectrum | `.tran` | `Vw1 in 0 SIN(off amp f)` / `PULSE(...)` | real Signal-Generator waveform drives the circuit in time |
| Voltmeter | `.op` / `.dc` | `Vw1 in 0 DC <level>` | static node voltages |

Implementation (WIRE-2):
1. Thread the Signal Generator params into `toCircuit(schematic, { w1, w2 })` so W1/W2 carry
   waveType/freq/amplitude/offset (W1 = generator 1, W2 = generator 2).
2. `buildNetlist(circuit, analysis)` switches each source line on `analysis.kind` (it already
   emits `AC 1` for `ac` and `SIN(...)` for `tran`; add `PULSE` for square + a DC branch).
3. Each instrument requests its analysis: Network Analyzer → `ac`; Scope/Spectrum → `tran`;
   Voltmeter → `op`. The instrument then reads the relevant node(s) from the result
   (1+ minus 1- for a differential ADC channel).

This is the seam that makes one drawn circuit serve every instrument correctly.

---

## Phase SCH-1 — Browser schematic editor MVP

**Goal:** a lightweight, first-year-friendly node-and-wire editor. **Not** KiCad.

**Implement:**
- `src/components/SchematicEditor.tsx` + nav entry + split/single layout integration.
- SVG-based canvas. Component palette: **Resistor, Capacitor, Inductor, Voltage source
  (= generator input), Op-amp, Ground.** Place by click/drag; move; delete.
- Wires connect component terminals; junctions create named nets. Auto-name nets, with the
  generator-input net and the output net specially labelled (`in`, `out`) so the loop phase
  can find them.
- Per-component value editing (R in Ω, C in F, etc.) via an inline field or a small
  inspector.
- Colors from CSS vars (`--node-color`, `--wire-color`, `--ch1-color` for the source).
- This phase is **editor only** — it does not have to simulate yet. It produces an
  in-memory circuit graph (the SPICE-2 model) on demand.

**Acceptance criteria:**
- A student can draw an RC low-pass (source → R → out node → C → ground) and the editor
  yields a valid circuit graph object.
- Place/move/delete/wire all work without console errors.
- Build clean; regression canary holds.

**Files allowed:** `SchematicEditor.tsx` (new), `App.tsx` (nav/layout),
`core/netlist.ts` (graph types only — share with SPICE-2), `index.css` (new vars),
`Instrument.css`, docs.

---

## Phase SCH-2 — Bind editor → graph → netlist

**Goal:** the editor's drawing becomes a runnable netlist.

**Implement:**
- Convert the editor's circuit graph to the `core/netlist.ts` model and call `buildNetlist`.
- Validate the circuit (has a ground, source connected, no dangling required terminals) and
  surface friendly errors ("circuit needs a ground", "output node not connected").
- A "Simulate" affordance that runs the netlist through the SPICE-1 engine and reports
  success/failure (full result display comes in LOOP-1).

**Acceptance criteria:**
- Drawing an RC filter and hitting Simulate runs without error and returns a `SimResult`.
- Validation catches a missing ground and a floating source.
- Build clean; regression canary holds.

**Files allowed:** `SchematicEditor.tsx`, `core/netlist.ts`, `core/spice.ts` (call site
only), docs.

---

## Phase NET-1 — Network Analyzer instrument (Scopy parity)

**Goal:** a dedicated Network Analyzer instrument that produces a Bode plot by sweeping the
circuit, mirroring Scopy's Network Analyzer.

**Implement:**
- `src/components/NetworkAnalyzer.tsx` + nav entry + single/split layout integration.
- Two stacked Plotly plots: magnitude (dB) and phase (deg) vs log-frequency x-axis.
- Controls (component-local): start/stop frequency, points-per-decade, magnitude min/max,
  phase min/max — defaults matching Scopy (mag -90..10 dB, phase -180..180 deg).
- Drives an `.ac` sweep through `core/netlist.ts` + the SPICE engine; computes
  `v(out)/v(in)` gain (dB) and phase (deg) from the complex `SimResult` columns (mag/phaseDeg
  are already precomputed by `normalizeResult`).
- Until SCH-2 provides a drawn circuit, NET-1 may sweep a hardcoded/default RC so the
  instrument is testable on its own; LOOP-1 swaps in the editor's circuit.

**Acceptance criteria:**
- A default RC low-pass shows the correct -3 dB rolloff at 1/(2*pi*R*C) on the magnitude
  plot and -45 deg at the cutoff on the phase plot (verify in PROGRESS).
- Build clean; spectrum regression canary holds.

**Files allowed:** `NetworkAnalyzer.tsx` (new), `App.tsx` (nav/layout), `core/netlist.ts`,
`core/spice.ts` (call site), `index.css`/`Instrument.css` (styling), docs.

## Phase LOOP-1 — Close the loop (headline feature)

**Goal:** generator → circuit → instruments. Draw a filter, see its Bode plot.

**Implement:**
- Wire the **Signal Generator** params into the circuit's input `V` source via the netlist
  mapping from SPICE-2.
- **AC mode → Bode plot in the Network Analyzer instrument.** DECISION (2026-06-26): to
  mimic Scopy, the Bode plot is its OWN instrument — the **Network Analyzer** — NOT a mode of
  the Spectrum Analyzer. In Scopy these are distinct: the Spectrum Analyzer is an FFT of a
  captured signal; the Network Analyzer sweeps sine waves and plots transfer-function gain +
  phase. Our ngspice `.ac` sweep is exactly a network-analyzer measurement. The Network
  Analyzer instrument is built in phase **NET-1**; LOOP-1 wires the drawn circuit into it.
  Render magnitude (dB) and phase (deg) vs log frequency, matching Scopy's Network Analyzer
  (default mag range -90..10 dB, phase -180..180 deg, start/stop frequency controls).
- **Transient mode → scope:** run `.tran`, and route `v(out)` to the Oscilloscope's **CH2**
  (`ChannelSource.kind = 'circuit-out'` from the channel bus). CH1 stays the generator input,
  so the student sees input vs output on one screen.
- A clear mode toggle (Transient / AC) somewhere sensible in the circuit/instrument UI.

**Acceptance criteria:**
- An RC low-pass drawn in the editor shows the correct −3 dB rolloff at `1/(2πRC)` in the
  Bode view (verify against the analytic value in PROGRESS).
- The scope shows input and filtered output simultaneously on CH1/CH2 in transient mode.
- Build clean; regression canary holds.

**Note — circuit-loop MVP is shippable here.** Deploy, record the commit hash, and revisit
the Lab 3 `<!-- TWIN: -->` prelab markers in `CLAUDE.md`.

**Files allowed:** `SchematicEditor.tsx`, `SpectrumAnalyzer.tsx` (add Bode mode),
`Oscilloscope.tsx` (consume `circuit-out`), `App.tsx` (channel source switch, mode state),
`core/spice.ts`, `core/netlist.ts`, docs.

---

## Phase LOOP-2 — Live tuning + analysis toggle + −3 dB cursor

**Goal:** make it feel parametric and instrument-like.

**Implement:**
- Drag/edit a component value (e.g. R or C) → debounced re-simulate → Bode/scope update live.
- Clean Transient/AC switch with remembered settings per mode.
- A −3 dB cursor/marker on the Bode plot reading the cutoff frequency, mirroring the
  Spectrum Analyzer's peak marker style — so the student reads cutoff directly.

**Acceptance criteria:**
- Changing C visibly shifts the cutoff in real time without UI jank (debounce + worker).
- −3 dB marker reads the correct cutoff for several R/C combinations.
- Build clean; regression canary holds.

**Files allowed:** `SchematicEditor.tsx`, `SpectrumAnalyzer.tsx`, `core/spice.ts`,
`core/netlist.ts`, docs.

---

## Phase PSU-1 — Power Supply instrument (Scopy parity)

**Goal:** a Power Supply instrument matching the M2K's two programmable rails.

**Implement:**
- `src/components/PowerSupply.tsx` + nav entry + layout integration.
- Two rails: **V+ (0..+5 V)** and **V- (0..-5 V)**, each with numeric + slider control and an
  enable toggle. **Tracking mode** (V- mirrors -V+) and **Independent mode**, matching Scopy.
- The rail values feed the circuit's DC supply nets (the `dcSource`/rail model from SPICE-2),
  so an op-amp drawn in the editor is powered from these rails.
- App-level state (rails are shared, like generator params), not component-local, since the
  circuit netlist consumes them.

**Acceptance criteria:**
- Setting V+ powers an op-amp circuit; output respects the rails (e.g. clips near them if the
  model supports it). Tracking mode keeps V- = -V+. Verify in PROGRESS.
- Build clean; spectrum regression canary holds.

**Files allowed:** `PowerSupply.tsx` (new), `App.tsx`, `core/netlist.ts`, `index.css`/`Instrument.css`, docs.

---

## Phase DMM-1 — Voltmeter instrument (Scopy parity)

**Goal:** a two-channel voltmeter matching the M2K DMM (AC/DC, ±25 V).

**Implement:**
- `src/components/Voltmeter.tsx` + nav entry + layout integration.
- Two channels, each: **DC** (operating-point node voltage via `.op`/`.dc`) or **AC** (RMS of
  a transient at the node), large numeric readout, ±25 V range, node/probe selector.
- Reads from the simulated circuit via `core/netlist.ts` + the SPICE engine.

**Acceptance criteria:**
- For a resistive divider with known rails, the DC reading matches the analytic node voltage
  within tolerance (verify in PROGRESS). AC mode reads correct RMS for a known sine.
- Build clean; spectrum regression canary holds.

**Files allowed:** `Voltmeter.tsx` (new), `App.tsx`, `core/netlist.ts`, `core/spice.ts` (call site), `index.css`/`Instrument.css`, docs.

---

## Phase KICAD-1 — (Stretch) KiCad netlist import

Defer until LOOP-1 is solid. Allow importing a KiCad-exported netlist, mapping it to the
`core/netlist.ts` graph, and simulating it — a "bring your KiCad schematic into the M2K
twin" path for later-course students. Out of scope until the core loop ships.

---

## Cross-phase design notes

- **Decoupling is the whole strategy.** UI → circuit graph → netlist string → `SpiceEngine`
  → normalized `SimResult` → instrument display. Each arrow is a clean boundary. Never let
  eecircuit-engine's raw types leak past `core/spice.ts`.
- **Worker + WASM + base path** are the three integration hazards. SPICE-1 exists to retire
  all three before any feature depends on them.
- **Keep circuits simple.** EEC1 needs RC/RL filters, an inverting amp, an INA front end —
  not a transistor-model library. Resist scope creep in the editor.
- **Match the teaching goal.** The twin shows the *ideal* response; the bench shows real
  deviation. The Bode/scope output should be clean and analytic so students learn the model
  first.
- **Units everywhere.** Show Ω, F, Hz, dB explicitly; accept engineering notation (1k, 10n,
  4.7u) in value fields.
