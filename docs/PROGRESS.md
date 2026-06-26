# PROGRESS.md — session handoff log

Append-only log. Each CC session adds one entry at the **top** when it finishes (or stops).
The next session reads the latest entries to understand current state before starting.

This complements `docs/ROADMAP.md` (which holds the status table). ROADMAP says *what*
state each phase is in; PROGRESS says *how it went and what the next session needs to know*.

---

## Entry template (copy this, fill in, put newest on top)

```
### YYYY-MM-DD — <PHASE-ID> <title> — <DONE | PARTIAL | BLOCKED>

**By:** Claude Code session
**Commit:** <hash or "uncommitted">

**What I did:**
- ...

**Verification (Definition of Done):**
- build clean: yes/no
- 12-bit spectrum floor at −104 dBFS confirmed: yes/no
- math sanity check: <numbers — expected vs actual>

**State for the next session:**
- what is now true that wasn't before
- anything half-finished, any gotchas, any decisions made that future phases inherit

**Open questions / flags for andre:**
- ...
```

---

## Log

### 2026-06-26 — WIRE-1b Exact M2K pin nomenclature + colors — DONE

**By:** Claude Code session (in Cowork)
**Commit:** uncommitted (run `.\push.ps1`)

**Source of truth:** EEC1 Lab 1 + the adaptor-board silkscreen images. Top row `1+ 2+ ⏚ V+ W1 ⏚ TI`,
bottom row `1- 2- ⏚ V- W2 ⏚`. The twin's breadboard ports now match exactly.

**What I did:**
- `src/core/schematic.ts`: added the differential ADC terminals `adc1n` (1-) / `adc2n` (2-) and
  split supply into `vplus` (V+) / `vminus` (V-). `toCircuit` maps them: 1+→`out`, 1-→`out_n`,
  2+→`scope2`, 2-→`scope2_n`; V+/V- → DC rails (+5/-5 default). (Differential reading lands with
  the Voltmeter / WIRE-2.)
- `src/components/SchematicEditor.tsx`: palette is now W1, W2, 1+, 1-, 2+, 2-, V+, V-, GND;
  symbols + colors per the agreed scheme — **V+ red, V- blue, GND black (rendered light for
  contrast), W1/W2 yellow, 1± orange (Ch1), 2± cyan (Ch2)**; added an in-editor M2K pin legend
  so students map straight from the Lab 1 handout.

**Verification (Definition of Done):**
- build clean: `tsc && vite build` green (30 modules).
- Tests: 12/12 pass (W1+Scope1 RC still simulates to ~1 kHz).
- 12-bit spectrum canary: signal.ts untouched; unaffected.

**State for the next session:**
- The breadboard vocabulary is M2K-accurate. WIRE-2 still owed: instruments READ from their
  wired node (direct generateSignal fast path; SPICE .tran through a circuit), and differential
  ADC reading V(1+) - V(1-). Pairs naturally with DMM-1 (Voltmeter does single-ended + differential).

**Open questions / flags for andre:**
- ENVIRONMENT (recurring): the mount truncated `schematic.ts` AND `SchematicEditor.tsx` on
  Edit-tool writes this session; I rewrote both via reliable bash writes and verified
  tsc/build/tests. **Always run `npm run build` locally before committing these two files.**
- Color note: GND is the "black" wire but is drawn light-gray so it's visible on the near-black
  canvas. Say the word if you'd prefer a different GND rendering.

### 2026-06-26 — WIRE-1 Breadboard ports (schematic = patch panel) — DONE

**By:** Claude Code session (in Cowork)
**Commit:** uncommitted (run `.\push.ps1`)

**Decision:** the Circuit editor IS the breadboard. Instrument I/O are ports you place and wire,
mirroring the M2K bench. (See ROADMAP Track D.)

**What I did:**
- `src/core/schematic.ts`: new port kinds `awg1`/`awg2` (W1/W2 generator outputs) and
  `scope1`/`scope2` (Scope CH1/CH2 input probes). `toCircuit` maps them to nets
  (`awg1`→`in`, `awg2`→`in2`, `scope1`→`out`, `scope2`→`scope2`); AWG ports emit a V source to
  ground (AC 1). `vsource`/`probe` kept for back-compat. Connectivity warnings reworded.
- `src/components/SchematicEditor.tsx`: palette now W1/W2/Scope 1/Scope 2 + V+/V- (was V src/
  Probe/Supply); SVG symbols for the new ports (generator circles, CH1/CH2 probe diamonds).
- Test: W1+Scope1 RC schematic → engine → -3 dB ~1 kHz.

**Verification (Definition of Done):**
- build clean: `tsc && vite build` green (30 modules).
- Tests: 12/12 pass.
- 12-bit spectrum canary: signal.ts untouched; unaffected.

**State for the next session — WIRE-2 (important):**
- Today the standalone scope/spectrum STILL read the generator directly; the ports are wired
  vocabulary + netlist mapping only. WIRE-2 makes each scope/spectrum input read the VOLTAGE AT
  ITS WIRED NODE: direct fast path (`generateSignal`) when wired straight to a generator (keeps
  all waveforms + ADC noise), else a SPICE `.tran` of the node. This also completes LOOP-1's
  scope half (route the circuit transient into `channelInputs.circuitOut`).

**Open questions / flags for andre:**
- ENVIRONMENT: the mount truncated large files mid-write TWICE today (`SchematicEditor.tsx`,
  `schematic.ts`). I rebuilt the tails and verified line counts/builds. Recommend confirming
  `npm run build` locally after pulling. If this keeps happening, prefer smaller edits.
- Runtime check: open Circuit, place W1 + R + C + Gnd + Scope 1, wire them, press Simulate.

### 2026-06-26 — OSC-2 Second scope channel (CH2) — DONE

**By:** Claude Code session (in Cowork)
**Commit:** uncommitted (run `.\push.ps1`)

**What I did:**
- `App.tsx`: `setParams2` added; a `signal2` (CH2 = second generator) resolved each tick via the
  channel bus and passed to the scope; `onParams2Change` lets the scope edit CH2 freq/amplitude.
- `Oscilloscope.tsx`: CH2 support — enable toggle, per-channel Volts/div + Offset, compact CH2
  source (freq/amplitude). Switched the y-axis to a **graticule-division** scale (±4 div) so two
  channels with different Volts/div share one grid, matching Scopy. CH1 orange, CH2 cyan; header
  + readout show both. `--ch2-color` added to index.css.

**Verification (Definition of Done):**
- build clean: `tsc && vite build` green (30 modules; index.js ~4.84 MB).
- Tests: 11/11 pass (capture math unchanged; division mapping is display-only).
- 12-bit spectrum canary: signal.ts untouched; unaffected.

**State for the next session:**
- The scope is now two-channel. CH2's source is a second generator; the **circuit-output**
  source (`circuit-out`) for the full LOOP-1 scope half is still pending wiring (route a
  `.tran` of the drawn circuit into `channelInputs.circuitOut`, then let the scope select it
  for CH2). Consider finishing LOOP-1's scope half next, or proceed to Track C.
- Per andre: **PSU-1 (Power Supply)** and **DMM-1 (Voltmeter)** are queued next — do not skip.

**Open questions / flags for andre:**
- Runtime check: open Scope, tick "Enable CH2" — a cyan trace appears; adjust CH2 freq/Volts-div
  independently of CH1. Note the y-axis now reads in divisions (each channel scaled by its V/div).

### 2026-06-26 — LOOP-1 (Bode half) drawn circuit → Network Analyzer — IN PROGRESS

**By:** Claude Code session (in Cowork)
**Commit:** uncommitted (run `.\push.ps1`)

**What I did:**
- Lifted the schematic to `App` state (`schematic` + `setSchematic`); `SchematicEditor` is now
  controlled via props. App computes `toCircuit(schematic)` and passes the result to the
  Network Analyzer (`circuit` + `dutName`) ONLY when the drawing is valid (no warnings).
- The Network Analyzer now sweeps **your drawn circuit** and labels the DUT accordingly; it
  falls back to the built-in default RC when the drawing is empty/invalid.
- File-recovery note: a flaky mount write truncated `SchematicEditor.tsx` mid-file; I rebuilt
  the lost tail (closing tags + `renderSymbol`). Watch for this — verify file line counts after
  large edits to that file.

**Verification (Definition of Done):**
- build clean: `tsc && vite build` green (30 modules; index.js ~4.84 MB).
- Tests: 11/11 pass. The schematic test already covers drawn-RC → engine → -3 dB ≈ 1 kHz,
  which is exactly the LOOP-1 path (editor circuit → netlist → transferFunction).
- 12-bit spectrum canary: signal.ts untouched; unaffected.

**Why IN PROGRESS (not DONE):**
- The **Bode half is done** (draw a circuit → see its Bode in the Network Analyzer).
- The **scope/transient half** (input on CH1 vs circuit output on CH2 via `.tran` → `circuit-out`)
  still needs **OSC-2** (the second channel). `channelInputs.circuitOut` is still null.
- Flip LOOP-1 to DONE once OSC-2 lands and the transient output is routed to Scope CH2.

**Open questions / flags for andre:**
- Runtime check: draw V src → R → out(C→Gnd) + Probe on out in the Circuit tab, then open the
  Network tab — the Bode should reflect YOUR R/C values (change C and re-open to see fc move).
  An empty/invalid drawing shows the default RC.

### 2026-06-26 — SCH-2 Simulate + validation (plus SCH-1 polish) — DONE

**By:** Claude Code session (in Cowork)
**Commit:** uncommitted (run `.\push.ps1`)

**What I did:**
- `src/core/schematic.ts`: connectivity validation in `toCircuit` — flags a floating source
  (`in` net with <2 component terminals) and a floating output (`out` with no component
  terminal), on top of the existing no-ground / no-source / no-probe warnings.
- `src/components/SchematicEditor.tsx`: a **Simulate** button that builds the netlist from the
  drawing and runs it through the SPICE worker, reporting points + (-3 dB cutoff if it reads
  as a low-pass) or the engine error. Blocks with the validation message if the circuit is
  incomplete.
- SCH-1 polish in the same area: **DC supply rail** part (`dcrail` → SPICE `DCRail`, editable
  volts, default +5 V) and **op-amp +/- input labels**; rotate-after-place (click any part to
  select, then R / Rotate button).
- Tests: added missing-ground and floating-source validation cases.

**Verification (Definition of Done):**
- build clean: `tsc && vite build` green (30 modules; index.js ~4.84 MB; engine still in the
  worker chunk only).
- **Tests: 11/11 pass** (netlist 3, scope 3, bode 1, schematic 4). Validation tests confirm
  missing-ground and floating-source warnings.
- 12-bit spectrum canary: signal.ts untouched; unaffected.

**State for the next session:**
- The editor can now draw → validate → simulate a circuit end to end inside the Circuit panel.
- LOOP-1: lift the editor's `result.circuit` to App and pass it to `<NetworkAnalyzer circuit=…>`
  (the prop already exists) and to Scope CH2 (transient via `circuit-out`). Needs OSC-2 (CH2)
  for the scope side; the Bode side can land first.

**Open questions / flags for andre:**
- Runtime check: open Circuit, draw V src→R→out(C→Gnd) with a Probe on out, press Simulate;
  expect "OK — simulated N points · -3 dB ≈ 1.00 kHz".

### 2026-06-26 — SCH-1 Browser schematic editor — DONE

**By:** Claude Code session (in Cowork)
**Commit:** uncommitted (run `.\push.ps1`)

**What I did:**
- `src/core/schematic.ts`: schematic model (`SchComponent`, `Wire`, `terminalsOf`),
  `computeNets()` (union-find over grid points + wires), and `toCircuit()` → SPICE-2 `Circuit`
  with net labelling (ground→`0`, V-source `+`→`in`, probe→`out`) plus validation warnings.
- `src/components/SchematicEditor.tsx`: SVG grid editor. Palette (Select/Wire/R/C/L/V/Op-amp/
  Ground/Probe); click-to-place, drag-to-move, Delete/Clear, two-click wiring, value inspector
  with eng-notation parsing (1k, 159n). Live circuit validity readout from `toCircuit`.
- `App.tsx`: "Circuit" nav entry; `src/index.css`: `--node-color`, `--wire-color`.
- `src/core/schematic.test.ts`: hand-built RC schematic.

**Verification (Definition of Done):**
- build clean: `tsc && vite build` green (30 modules; index.js ~4.84 MB).
- **Tests: 9/9 pass** (netlist 3, scope 3, bode 1, schematic 2). Schematic test: a hand-drawn
  RC converts to R[in,out]/C[out,0]/V[in,0] and simulates to -3 dB in (900,1100) Hz.
- 12-bit spectrum canary: signal.ts untouched; unaffected.

**State for the next session:**
- `toCircuit(schematic)` is the seam for SCH-2: wire the editor's circuit into the Network
  Analyzer (`circuit` prop) and Scope CH2. The editor already computes a valid Circuit live.
- SCH-2 = "Simulate" action + friendlier validation surfacing; LOOP-1 = full generator→circuit
  →instruments wiring + transient to Scope CH2.

**Open questions / flags for andre:**
- Rotation supported (press R, or Rotate button; rotates the selected part, else the place
  angle). Still click-to-place; richer symbols can come later if wanted.
- Runtime visual check: open "Circuit", place V src + R + C + Ground + Probe, wire them, and
  confirm the "valid" readout. (Interactions are build-verified but need your eyes.)

### 2026-06-26 — NET-1 Network Analyzer (Bode) — DONE

**By:** Claude Code session (in Cowork)
**Commit:** uncommitted (run `.\push.ps1`)

**What I did:**
- `src/core/spice.ts`: added `transferFunction(result, out, in)` → `{freq, magDb, phaseDeg}`
  computing H = V(out)/V(in) (complex division) from a complex AC `SimResult`.
- `src/components/NetworkAnalyzer.tsx`: Scopy-style Bode instrument — stacked magnitude (dB)
  and phase (deg) plots vs log frequency. Controls: start/stop frequency, points/decade,
  magnitude min/max (defaults -90..10 dB; phase fixed -180..180, 45° ticks). Runs an `.ac`
  sweep through the SPICE worker on a default RC low-pass; marks the -3 dB cutoff.
- `App.tsx`: "Network" nav entry; renders in single view. Component accepts an optional
  `circuit` prop so LOOP-1 can feed the drawn circuit instead of the default RC.
- `src/core/spice.test.ts`: Vitest for the Bode math.

**Verification (Definition of Done):**
- build clean: `tsc && vite build` green (28 modules; index.js ~4.83 MB; engine still isolated
  to the 20 MB worker chunk).
- **Tests: 7/7 pass** (netlist 3, scope 3, bode 1). Bode test on the default RC: passband
  ~0 dB, -3 dB cutoff in (950, 1050) Hz, phase at 1 kHz in (-50, -40)° — i.e. ≈ -45°.
- 12-bit spectrum canary: signal.ts untouched; unaffected.

**State for the next session:**
- The Network Analyzer is a working Bode instrument over a default RC. LOOP-1 will pass the
  schematic-editor circuit in via the `circuit` prop and route transient output to Scope CH2.
- Remaining for the circuit loop: SCH-1 (editor), SCH-2 (editor→netlist), then LOOP-1.

**Open questions / flags for andre:**
- Runtime visual check: open the Network tab; expect a low-pass roll-off with the -3 dB
  marker near 1 kHz and phase passing -45° at the cutoff.

### 2026-06-26 — OSC-1 Oscilloscope panel (timebase + CH1) — DONE

**By:** Claude Code session (in Cowork)
**Commit:** uncommitted (run `.\push.ps1`)

**What I did:**
- `src/core/scope.ts`: added display helpers `captureWindow()` (horizontal slice of the CH1
  capture to a 10-div window, downsampled to <=2000 pts), `voltsAxisRange()`, and
  `SCOPE_H_DIVS`/`SCOPE_V_DIVS` (10x8 graticule).
- `src/components/Oscilloscope.tsx`: time-domain Plotly panel, CH1 trace in orange, with
  Time/div (100 µs..1 ms, 1-2-5), CH1 Volts/div (50 mV..1 V), vertical Offset, Run/Stop, and
  a readout. Gridlines align to divisions (xaxis dtick = time/div, yaxis dtick = volts/div).
- `App.tsx`: "Scope" nav entry; scope renders in single view (consumes CH1 from the bus).
- `src/core/scope.test.ts`: Vitest for the capture math.

**Verification (Definition of Done):**
- build clean: `tsc && vite build` green (26 modules; index.js ~4.82 MB).
- **Tests: scope 3/3 + netlist 3/3 pass.** captureWindow at 1 ms/div → 1000 pts over a 10 ms
  window; 1 kHz period (1 ms) spans exactly one division. Downsample caps at 2000 pts;
  voltsAxisRange(0.5)=[-2,2].
- 12-bit spectrum canary: signal.ts untouched; App still resolves CH1 identically — unaffected.

**OSC-1 scope decision (documented per spec):**
- The scope reads the existing CH1 capture (16 ms at default params), so Time/div is capped
  at 1 ms/div (10 ms window fits 16 ms). Wider time/div needs a scope-specific longer capture
  — deferred (a later phase can regenerate at the scope window or extend duration).
- Scope is single-view only for now; adding it to Split view is deferred (OSC-2 / layout
  refactor). Split still shows SignalGen + Spectrum.

**State for the next session:**
- OSC-2 enables CH2 (params2 already in the bus) + per-channel vertical controls + `--ch2-color`.
- Per ROADMAP sequence after OSC-1: OSC-2, then NET-1 (per andre: OSC-1 then NET-1).

**Open questions / flags for andre:**
- Runtime visual check: open the Scope tab, confirm the 1 kHz square shows ~1 period/division
  at 1 ms/div and scales with Volts/div.


### 2026-06-26 — SPICE-2 circuit graph + netlist generator — DONE

**By:** Claude Code session (in Cowork)
**Commit:** uncommitted (run `.\push.ps1`)

**What I did:**
- `src/core/netlist.ts`: typed `Circuit` graph (`Resistor`, `Capacitor`, `Inductor`,
  `VSource`, `DCRail`, `OpAmp`, `Ground`), `Analysis` union (`tran`/`ac`/`op`/`dc`), and
  `buildNetlist(circuit, analysis)` → ngspice string. Ground aliases (`0`/`gnd`/declared
  ground net) normalise to `0`. Op-amp emits an ideal high-gain VCVS (E device).
- Groundwork for Track C (per spec): `DCRail` represents Power Supply rails; op-amp carries
  `vpos`/`vneg` rail nets; `buildNetlist` supports `.op`/`.dc` for the Voltmeter.
- SignalParams→source mapping: `makeInputSource()` / `sineFromParams()` (sine→`SIN(...)`,
  AC sweeps use `AC 1`). Non-sine transient drive (PULSE/PWL) deferred.
- Added Vitest (`vitest@^4.1.9` devDep, `npm test` = `vitest run`); `src/core/netlist.test.ts`.
- tsconfig: excluded `*.test.ts(x)` from the production `tsc` (vitest typechecks/runs tests).
- Docs in this commit also add NET-1 (Network Analyzer) and Track C (PSU-1/DMM-1) and the
  SPICE-2 accommodation notes.

**Verification (Definition of Done):**
- build clean: `tsc && vite build` green in sandbox. netlist.ts is library-only (not imported
  by the app entry yet) so the bundle is unchanged.
- **Tests: 3/3 pass** (`vitest run`). Includes an engine integration test: the GENERATED RC
  netlist simulates to a -3 dB cutoff in (900, 1100) Hz and flat passband (310 ms).
- Netlist-string test asserts `V1 in 0 DC 0 AC 1`, `R1 in out 1000`, `C1 out 0 1.59155e-7`,
  `.ac dec 20 10 1000000`; ground-alias + `.op`/`.tran` directive tests pass.
- 12-bit spectrum canary: signal.ts untouched; unaffected.

**State for the next session:**
- `buildNetlist` + `Circuit` are ready for SCH-2 (editor → graph) and NET-1/LOOP-1.
- A test harness now exists; later phases should add tests in the same style.
- Per ROADMAP sequence, next is OSC-1 (scope) or SCH-1 (editor) or NET-1.

**Open questions / flags for andre:**
- Op-amp is an ideal VCVS (no rail clipping yet). Fine for EEC1 filters; revisit if a lab
  needs saturation behaviour.


### 2026-06-26 — SPICE-1 ngspice-WASM engine integration — DONE

**By:** Claude Code session (in Cowork)
**Commit:** uncommitted (run `.\push.ps1`)

**What I did:**
- Added dependency `eecircuit-engine@^1.7.0` (ngspice-WASM, MIT) to package.json.
- `src/core/spice.ts`: engine-agnostic `SpiceEngine` interface, `SimResult` shape
  (`columns` carry real values or complex re/im/mag/phaseDeg), `normalizeResult()` mapping
  the engine `ResultType` → `SimResult`, and a `WorkerSpiceEngine` that runs everything in
  a Web Worker. Only TYPES are imported from eecircuit-engine here (erased at compile), so
  the 20 MB engine never enters the main bundle.
- `src/core/spice.worker.ts`: hosts the `Simulation`, lazily `start()`s it once, runs
  netlists, posts back normalized results.
- `src/components/SpiceDevPanel.tsx`: throwaway dev panel (gated by `SHOW_SPICE_DEV` in
  App.tsx) that runs a hardcoded RC low-pass AC sweep and reads the -3 dB cutoff.
- App.tsx: gated "SPICE dev" nav entry.

**Verification (Definition of Done):**
- build clean: `tsc && vite build` green in the Linux sandbox copy.
- Engine correctness proven directly in Node: RC low-pass (R=1k, C=159.155n) gives DC gain
  -0.00 dB and **-3 dB cutoff = 1000.0 Hz** (= 1/2pi.R.C). Same code path the worker uses.
- Worker isolation confirmed: engine emitted as a SEPARATE `dist/assets/spice.worker-*.js`
  chunk (20 MB); main `index.js` unchanged at ~4.8 MB.
- Base path confirmed: worker referenced as `new URL('/m2k-scopy-web/assets/spice.worker-*.js',
  import.meta.url)`; NO standalone .wasm asset (inlined) — so the GitHub Pages base-path
  hazard is moot. Worker chunk loads lazily only when the SPICE panel mounts.
- 12-bit spectrum canary: signal.ts untouched; unaffected.

**Runtime check — CONFIRMED in browser (2026-06-26):** preview build, clicked SPICE dev -> Run RC sweep -> "done in 248 ms", -3 dB cutoff 1000.0 Hz, no console errors. Worker spawns and round-trips in-browser under the base path.

**(original check instructions, for reference):**
- `npm install` (to pull eecircuit-engine) then `npm run build && npm run preview`, open the
  served URL, click "SPICE dev" -> "Run RC sweep", confirm it prints cutoff ~1000 Hz with no
  console errors. This confirms the worker actually spawns in-browser under the base path.

**State for the next session:**
- A working, swappable SPICE engine exists behind `createSpiceEngine()`. SPICE-2 (netlist
  generator) and the circuit loop build on `SimResult`.
- `SHOW_SPICE_DEV`/SpiceDevPanel are throwaway — remove or replace at LOOP-1.
- Bundle size is large (20 MB worker). Acceptable for now; revisit if needed.


### 2026-06-26 — ARCH-1 Channel bus — DONE

**By:** Claude Code session (in Cowork)
**Commit:** uncommitted (run `.\push.ps1` to commit/push)

**What I did:**
- New `src/core/scope.ts`: `ChannelId`, `ChannelSource` (`generator` | `generator2` |
  `circuit-out`), `ScopeChannel`, `Samples`, `ChannelInputs`, `DEFAULT_CHANNELS`, and
  `resolveChannelSamples(channel, inputs)`.
- `src/App.tsx`: added `params2` (CH2 default: sine 2 kHz, 0.5 V, disabled), `channels`
  state from `DEFAULT_CHANNELS`, a memoized `channelInputs`, and `channelSignals` resolved
  via the bus. `signal` (CH1) now derives from `channelSignals.CH1` — byte-identical to the
  previous `generateSignal(params)` path, so the two existing instruments are unchanged.
- Nav icon glyphs converted to HTML entities (render identically) to avoid a file-sync
  issue with raw multibyte chars in this environment.
- Added `push.ps1` helper in repo root.

**Verification (Definition of Done):**
- build clean: `tsc --noEmit` exits 0. NOTE: full `vite build` could not run in the Linux
  sandbox (Windows-native 