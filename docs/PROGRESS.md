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

### 2026-06-27 — E-1: preset lab layouts (replace hardcoded split) — DONE

**By:** Claude Code session
**Commit:** uncommitted

**What I did:**
- Replaced the `LayoutMode = 'single' | 'split'` model (a hardcoded Signal Gen + Spectrum split,
  a leftover from the two-instrument era) with a `Preset` workspace model: an ordered list of
  panel ids + an arrangement hint (`single | row | grid`). Single-instrument view is a one-panel
  workspace; `presetId` null = single, else a multi-panel preset.
- Presets are **named by what they show, not by a lab** (the twin isn't course-specific), and live
  in a single **"Layouts" dropdown** in the nav (not a row of buttons): Generator + Spectrum,
  Generator + Scope, Circuit + Network (Bode), Circuit + Scope, Scope + Supply + Voltmeter.
  Picking "Single view" / any instrument button returns to one panel.
- `App.tsx` `<main>` now renders `panels.map(renderPanel)`; `renderPanel(id)` is a single switch
  that returns each instrument with its existing props and passes `compact` (where supported:
  scope/siggen/spectrum) when more than one panel is visible. CSS grid/flex via
  `.instrument-area.arrange-{single,row,grid}` in `App.css`.
- Selected workspace (`{active, presetId}`) persists to localStorage (`m2k-workspace-v1`) —
  geometry layer only; instrument settings stay component-local per CONVENTIONS §4.
- No new dependency (E-2/dockview deferred). Each panel keyed by id so switching presets reconciles
  with minimal remounts.

**Verification (Definition of Done):**
- build clean: yes — `tsc --noEmit` zero errors.
- 12-bit floor at −104 dBFS: holds — `signal.ts` untouched; the Spectrum panel still receives the
  default-params signal when no circuit is wired.
- math sanity check: N/A (layout-only; no `core/` logic added).

**State for the next session:**
- This is the E-1 stopping point the spec flags as possibly sufficient for the course. E-2 (true
  dockview docking + geometry workspace save/load) is the next layout phase if free docking is
  wanted; it needs the dependency sign-off noted in the spec.
- To add a preset, append to `PRESETS` in `App.tsx`. To add an instrument to a multi-panel preset,
  give it a `compact` prop if it needs to shrink gracefully.

**Open questions / flags for andre:**
- Bench preset packs 3 panels into a 2-col grid (voltmeter wraps to row 2). Fine, or prefer a row?

---

### 2026-06-26 — F-3: LMC662 DIP on the breadboard — DONE

**By:** Claude Code session
**Commit:** uncommitted

**What I did:**
- Added a generic DIP model to `core/breadboard.ts`: `DIP_KINDS` (lmc662), `dipCols(kind)`,
  `dipPinHoles(kind, col)` (8 holes straddling the channel-adjacent rows e/f; pin 1 bottom-left,
  1→n along row f L→R, n+1→2n along row e R→L, matching the schematic terminal order), and a
  `PlacedDip { id, kind, col }` stored on `BoardLayout.dips` (optional, so old saved boards load).
- `schematicExpectation` now emits `dips` with each pin's net; `checkEquivalence` treats every DIP
  pin as its own node (`U1.p1..p8`) in the board≟schematic partition compare, with a presence
  check ("Place U1 on the board (straddle the channel)") and a `.pN` pin label.
- `Breadboard.tsx`: a **(DIP)** chip in the palette, a `placeDip` tool — click a row-e hole and the
  8-pin chip drops across the channel (rejects non-straddling anchors with a hint). Renders the body
  + notch + per-pin net-coloured dots + label; included in Practice colouring, Clear, and delete.
- `App.tsx`: the schematic→board sync now keeps/drops DIPs by id alongside 2-pin parts.
- Save/Open on the board: a **"lab" bundle** (`{ kind:'m2k-lab', version:2, schematic, board,
  generators:{w1,w2} }`) saved to .json (native Save dialog + download fallback, mirroring SCH-3).
  Open restores the circuit, its board layout, AND the generator settings, so Check works
  immediately and a worked example / student submission travels as one file that runs at the right
  input level. `Breadboard` takes `setSchematic` + `generators`/`onLoadGenerators`. v1 files (no
  generators) still load. Note: the directory chooser is the browser's File System Access API
  (`showSavePicker`); when a managed browser disables it, it falls back to a download — not an app
  bug, a browser-policy constraint.
- Clip warning: App detects when the simulated output rides the supply rails (peak within 2% of a
  dcrail / PSU rail) and the Oscilloscope shows "⚠ output clipping at the rails". This catches the
  classic gotcha of feeding 1 V into a gain-10 amp (10 V wanted, ±5 V available). Pairs with the
  bundled generator settings so a loaded lab is pre-set to a non-clipping input.
- Each DIP pin lands in its own isolated terminal column (top/bottom banks are split by the
  channel), so the student must jumper from each pin to the rest of the circuit — exactly the bench
  reality.

**Verification (Definition of Done):**
- build clean: yes — `tsc --noEmit` zero errors.
- 12-bit spectrum floor at −104 dBFS: unaffected — no change to `signal.ts` or the FFT pipeline;
  Track F never touches signal math.
- math sanity check: 6 new `breadboard.test.ts` cases + a standalone tsx run, all pass — pin-hole
  order f5..e5; overrun→null; expectation has 1 dip/8 nets; unplaced→"Place U1"; lone placed DIP
  matches (all pins isolated); jumper across two pins flagged as a short.

**State for the next session:**
- Adding the op-amp / INA DIP footprints (F-4) is now just: add the kind to `DIP_KINDS` and give it
  a `dipCols` entry; the placement, render, and verification are kind-agnostic.
- `BoardLayout.dips` is optional — existing autosaved boards (localStorage `m2k-board-v1`) stay valid.

**Open questions / flags for andre:**
- DIP orientation is fixed (notch left, pin 1 bottom-left). Want a rotate/flip option later?

---

### 2026-06-26 — SCH-5: amplifier model picker (sim-only vs sim+build) — DONE

**By:** Claude Code session
**Commit:** uncommitted

**What I did:**
- Distinguished two part categories: *simulation-only* (ideal, no supplies needed) and
  *simulation+build* (real parts that need explicit V+/V- rails, e.g. LMC662). The netlist
  layer already supported this (ideal = bare VCVS, optional vpos/vneg); this phase surfaces it
  in the editor.
- `core/schematic.ts`: `baseTerminals(kind, opModel)` is now model-aware — an ideal op-amp
  exposes only inP/inN/out, the LMC662 model adds vpos/vneg. `terminalsOf` passes `c.opModel`.
  `toCircuit` op-amp emission guards the now-optional rail pins. New `ampCategory(c)` helper is
  the single source of truth for sim vs build.
- `SchematicEditor.tsx`: toolbar collapsed to **Op-amp / In-amp**. Selecting either reveals a
  **place-time type sub-selector** below the toolbar — Op-amp: Ideal / LMC662 / LMC662 DIP
  (the dual 8-pin chip is folded in here, no separate button); In-amp: Ideal / 3-op-amp. The
  chosen type is dropped on placement and a sim/build hint shows under the sub-selector. The
  Selected panel keeps a **Type** dropdown so an already-placed part can be converted, with a
  sim/build badge and a warning when a build part's V+/V- is left unwired. The op-amp symbol
  draws rail stubs only for the LMC662 model.
- Wires are coordinate-based (not pin-bound), so switching model/type never deletes wires;
  rails that disappear just leave their wire segments in place. No schema migration needed —
  old saved files (kind 'lmc662' DIP, 'inamp3') still load unchanged.
- Added 4 unit tests in `schematic.test.ts` (ideal pin set, LMC662 pin set, ideal netlist has
  no rails, `ampCategory` mapping).

**Verification (Definition of Done):**
- build clean: yes — `tsc --noEmit` reports zero errors.
- 12-bit spectrum floor at −104 dBFS confirmed: unaffected — no change to `signal.ts` or the
  FFT/noise pipeline; only the schematic editor and op-amp netlist emission were touched.
- math sanity check: standalone tsx run of the new logic, 10/10 assertions pass — ideal op-amp
  terminals = {inP,inN,out}; LMC662 = {inP,inN,out,vpos,vneg}; ideal netlist nodes.vpos/vneg
  undefined, model 'ideal'; ampCategory: opamp→sim, opamp+lmc662→build, lmc662→build,
  inamp/inamp3→sim, resistor→null. (Full vitest could not run in the sandbox: node_modules
  holds Windows-native rolldown bindings; the Linux binary is absent. Run `npm test` on Windows
  to confirm the suite.)

**State for the next session:**
- The amplifier "type" is driven by existing fields (`opModel` for op-amps, `kind` for
  in-amps); no new persisted field was added. `ampCategory()` is available for any future
  validation (e.g. blocking a sim if a build part is unpowered).
- INA125 (a real sim+build in-amp with supply pins) is not yet modeled — when added, give it
  rail terminals and return 'build' from `ampCategory`; the dropdown + badge will pick it up.

**Open questions / flags for andre:**
- Should an unpowered build part be a hard error (block simulation) rather than just a warning?

---

### 2026-06-26 — EDIT-2b: box-select (marquee) + move everything inside it — DONE

**By:** Claude Code session (in Cowork) · **Commit:** uncommitted (run `.\push.ps1`)

andre: shift-click was unreliable for him, and a first box-select left wires behind. Now:
- **Marquee:** in the Select tool, drag a box on empty canvas to select. A part is selected if **any
  of its pins** is in the box (forgiving for big parts like the DIP); **wire segments inside the box**
  are selected too (highlighted blue).
- `core/schematic.ts`: `moveSelectionBy(s, ids, wireEnds, ddx, ddy)` — group move that translates the
  selected components AND the boxed wire endpoints (loose segments included), keeping terminal-attached
  ends together. Group delete removes the boxed wires too.
- `core/schematic.test.ts` (+1): loose boxed wire moves whole; a wire from a selected part to outside
  stretches. **74 passed.** Build clean.

---

### 2026-06-26 — EDIT-2: multi-select + group drag in the schematic editor — DONE

**By:** Claude Code session (in Cowork)
**Commit:** uncommitted (run `.\push.ps1`)

**Why:** andre — parts placed too low/cramped can be hard to reposition; needed to grab several and
drag them together.

**What I did:**
- `core/schematic.ts`: `moveComponentsBy(s, ids, ddx, ddy)` — translates a SET of components by a
  delta, carrying wire endpoints sitting on any selected terminal (a wire between two selected parts
  translates whole; a wire to a non-selected part stretches).
- `SchematicEditor.tsx`: a `selSet` multi-selection. **Shift+click** toggles parts in/out of the
  selection; dragging any selected part moves the whole group (clamped at the top/left edge). Group
  delete, group highlight, and a one-line hint. Single-part drag/select unchanged.
- `core/schematic.test.ts` (+1): group translate moves internal wires whole and stretches links out.

**Verification:** build clean; **73 passed (72 prior + 1 group-move)**; 12-bit floor holds.

**State for the next session — still on andre's list:** Board DIP (F-3), schematic flip/mirror, and
Save-with-directory. Multi-select is shift-click only (no marquee box-select yet — easy follow-up).

---

### 2026-06-26 — LMC662-DIP: dual op-amp as an 8-pin DIP (schematic side) — DONE

**By:** Claude Code session (in Cowork)
**Commit:** uncommitted (run `.\push.ps1`)

**Why:** the LMC662 is a dual op-amp; andre wants it placed as the real 8-pin DIP (and used for the
example: one section used, one spare).

**What I did:**
- `core/schematic.ts`: new `lmc662` SchKind — an 8-pin DIP with the real pinout (1 OUTA, 2 −INA,
  3 +INA, 4 V−, 5 +INB, 6 −INB, 7 OUTB, 8 V+). `toCircuit` **expands it into two LMC662 op-amp
  sections (A, B) that share the V+ (pin 8) and V− (pin 4) rail nets**.
- `core/netlist.ts`: added 1 TΩ **input bleed** resistors to the LMC662 macromodel (realistic CMOS
  input impedance) so an UNUSED section's inputs don't float — the spare half of the dual is fine
  left unconnected.
- `SchematicEditor.tsx`: **LMC662** palette button + a DIP symbol (body, pin-1 notch, 8 labelled
  pins, refdes 'U').
- `core/schematic.test.ts` (+1): the DIP expands to two `lmc662` sections sharing one V+ and one V− net.
- Rebuilt `Mk2 Digital Twin/inverting-amp-LMC662.json` around the DIP: **section A** is the inverting
  ×10 amp (powered ±5 V, 1− to GND), **section B left unused**. Validated from the file: no warnings,
  two sections, ~20 dB inverting gain with the LMC662 rolloff.

**Verification:** build clean; **72 passed (71 prior + 1 dual DIP)**; 12-bit floor holds.

**State for the next session — remaining from andre's list:**
- **Board DIP (F-3):** the breadboard still can't place the 8-pin DIP (only 2-pin parts). This is the
  next piece — an IC footprint straddling the centre channel + checkEquivalence pin mapping.
- **Flip/mirror** in the schematic (about the vertical axis) alongside Rotate — not started.
- **Save with a directory/filename picker** (File System Access API + download fallback) — not started.
- The single generic `opamp` (ideal/lmc662 model) still exists for teaching; the DIP is the faithful part.

---

### 2026-06-26 — OPAMP-PWR: real V+/V− power pins (+ multi-ground fix) — DONE

**By:** Claude Code session (in Cowork)
**Commit:** uncommitted (run `.\push.ps1`)

**Why:** andre asked for a faithful op-amp — real power pins wired to the supply, and the scope's
1− tied to ground — so the twin matches the bench and the breadboard transfer.

**What I did:**
- `core/schematic.ts`: the op-amp is now a **5-pin part** — added `vpos`/`vneg` terminals; `toCircuit`
  maps them to nets and passes them to the OpAmp.
- `core/netlist.ts`: the LMC662 output now clips to the **actual wired rail voltages** `V(vpos)/V(vneg)`,
  with 1 TΩ bleed resistors so an unpowered op-amp (rails floating) sits **dead at 0 V**, like the bench.
  No power pins (a Circuit built directly in tests) → fixed ±5 V fallback. Ideal op-amp ties any wired
  rail to 0 (ignored functionally) so it never floats.
- **Multi-ground fix (real bug andre's circuit hit):** `toCircuit` tracked only the *last* ground symbol
  as node 0, so a second ground left the first one's net (e.g. the +input ground) floating. Now **every**
  ground symbol normalises to 0 (`groundNets` set). This is what let the 1−→GND probe and the +input
  ground coexist.
- `SchematicEditor.tsx`: op-amp symbol now draws red **V+** (top) and blue **V−** (bottom) power stubs.
- `core/spice.test.ts` (+2): output clips to the wired rails (±2.5 V), and an unpowered op-amp → 0 V.
  `core/schematic.test.ts` (+1): two grounds both map to 0 and the op-amp exposes V+/V− nets.
- Rebuilt `Mk2 Digital Twin/inverting-amp-LMC662.json`: +input grounded, **V+/V− wired to V+/V− supply
  pins**, output on Scope 1 (1+), **1− tied to GND** via a second ground. Validated end-to-end: no
  warnings, ~20 dB inverting gain with the LMC662 rolloff, and the output clips at the +5 V rail when
  overdriven.

**Verification:** build clean; **71 passed (68 prior + 2 clip/unpowered + 1 multi-ground)**; 12-bit floor holds.

**State for the next session:** op-amps are 5-pin and must be powered to work (unpowered → 0 V). Existing
op-amp circuits without power wired will now read 0 at the output — that's intended fidelity, but note it
when loading old saves. The clip rails follow whatever you wire (PSU or V+/V− ports). Not yet: rail values
auto-tracking the PSU in the Network Analyzer's own sweep (it uses the V+/V− port defaults ±5).

---

### 2026-06-26 — LMC662: add slew-rate limiting — DONE

**By:** Claude Code session (in Cowork)
**Commit:** uncommitted (run `.\push.ps1`)

**What I did:** reworked the LMC662 macromodel from a VCVS single-pole into a **transconductance**
form so all three datasheet dynamics come from one topology: a gm stage whose current is clamped at
±Imax drives the dominant-pole cap Cp. `Aol = gm·Rp`, `GBW = gm/(2π·Cp)`, and **`SR = Imax/Cp`** —
clamping the charge current is the slew limit. gm = 1 mA/V; emitted as `Bg` (clamped current) → Rp‖Cp →
`Bo` (rail clip). Prototyped the sign/values in the engine first (measured 1.100 V/µs on a follower).

- `core/netlist.ts`: new `opampLines` topology (Bg current source + Rp/Cp + Bo clip).
- `core/spice.test.ts` (+1): a 3 V/200 kHz unity follower is slew-limited; max |dV/dt| ≈ 1.1 V/µs.
  The bandwidth (≈140 kHz) and clipping (+5 V) tests still pass unchanged with the new topology.
- Updated `docs/reference/lmc662.md` (slew now modelled; topology + derivation).

**Verification:** build clean; **68 passed (67 prior + 1 slew)**; 12-bit floor holds (no signal path).

**State for the next session:** the LMC662 now reproduces gain, GBW, slew rate, and rail clipping. A
fast square through a ×N stage shows slew-limited edges on the scope. Remaining non-idealities (offset,
bias current, CMRR, noise, PSU-tracked rails) are still ideal — see the reference doc.

---

### 2026-06-26 — LMC662: behavioural op-amp model (course part) — DONE

**By:** Claude Code session (in Cowork)
**Commit:** uncommitted (run `.\push.ps1`)

**Why:** the LMC662 is the op-amp the EEC1 course uses; andre supplied the datasheet. Model it
behaviourally (andre chose GBW + rails) so a drawn circuit shows real bandwidth rolloff + output
clipping, not just the ideal VCVS.

**What I did:**
- `core/netlist.ts`: `OpAmp.model` ('ideal' | 'lmc662') + `supplyPos`/`supplyNeg`; `LMC662` constants
  (Aol 1.995e6 = 126 dB, GBW 1.4 MHz, slew 1.1 V/µs ref). New `opampLines`: ideal → one VCVS (unchanged);
  lmc662 → single-pole macromodel (E gain → Rp/Cp dominant pole at GBW/Aol ≈ 0.7 Hz) + a **B-source
  output clip** `V = max(vneg, min(vpos, V(pole)))` to the rails (default ±5 V).
- Confirmed the WASM engine (ngspice 45.2) supports B-source `max/min` before building on it.
- `core/spice.test.ts` (+3 engine tests): ×10 non-inverting amp bandwidth ≈140 kHz (GBW/gain) and
  passband ≈20 dB; ×10 of 2 V clips at +5 V; the ideal op-amp in the same circuit reaches ~20 V.
- `core/schematic.ts`: `SchComponent.opModel`; `toCircuit` passes `model` to the op-amp.
- `SchematicEditor.tsx`: a **Model** dropdown (Ideal / LMC662) in the Selected panel when an op-amp is
  picked, with a one-line note (GBW 1.4 MHz, rail clip ±5 V).
- `docs/reference/lmc662.md`: datasheet figures + the macromodel mapping + what's not modelled.

**Verification (Definition of Done):**
- build clean: yes. 12-bit floor: holds (no signal-path change).
- tests: **67 passed (64 prior + 3 LMC662)**.

**State for the next session:**
- Place an op-amp, set Model → LMC662: the Network Analyzer shows the closed-loop bandwidth rolloff and
  the scope shows the output clipping at the rails. Ideal stays the default.
- **Not yet:** slew rate (1.1 V/µs, needs a nonlinear limiter), input offset/bias, and rails tracking the
  PSU (clip rails are the component's supplyPos/Neg, default ±5 V; no per-op-amp supply field in the
  editor yet — edit defaults in code or extend the inspector). See `docs/reference/lmc662.md`.

---

### 2026-06-26 — OSC-4: holdoff + pulse/width trigger + single-shot polish — DONE

**By:** Claude Code session (in Cowork)
**Commit:** uncommitted (run `.\push.ps1`)

**What I did:**
- `core/trigger.ts`: `findEdgeTriggers` (all crossings), `applyHoldoff(triggers, holdoffSamples)`
  (keeps the first, drops any inside the holdoff window), and `findPulseTrigger(v, level, polarity,
  widthMode, widthSamples, startIndex)` — finds the first pulse (run above/below level) whose width
  meets `<`/`>` the threshold, interpolated. Pure, no React.
- `core/trigger.test.ts` (+7 tests): crossing list; holdoff suppression ([10,14,40,44] @20 → [10,40]);
  first-trigger-always-kept; pulse less-than finds the narrow pulse, greater-than the wide one,
  negative polarity, and null when nothing qualifies.
- `Oscilloscope.tsx`: trigger **Type** selector (Edge / Pulse). Edge mode adds a **Holdoff (ms)** control
  plus a live "edges in buffer: N → M after holdoff" readout (makes the suppression visible/teachable).
  Pulse mode adds **polarity / width-is (< or >) / width (ms)** and triggers only on a qualifying pulse.
  Single-shot polish: the re-arm button now shows "Armed — waiting…" vs "Re-arm".

**Verification (Definition of Done):**
- build clean: yes. 12-bit floor: holds (no signal-path change).
- tests: **64 passed (57 prior + 7 trigger)**.

**State for the next session:**
- Trigger system now at Scopy parity: edge + pulse/width, holdoff, auto/normal/single. Track A
  (Oscilloscope) is complete — OSC-1..5 all DONE.
- Holdoff in this single-buffer-per-frame twin is realised honestly: it filters the trigger list and
  the count readout shows the suppression; on a burst/narrow-duty wave it re-aligns to the first kept
  edge. It is a no-op on a plain wave whose period exceeds the holdoff (correct, matches real scopes).

---

### 2026-06-26 — SCOPE-CKT-LONG: long timebase through a drawn circuit — DONE

**By:** Claude Code session (in Cowork)
**Commit:** uncommitted (run `.\push.ps1`)

**Why:** SCOPE-LONG fixed long time/div for the direct-generator path only. Through a drawn circuit the
scope still used the App's fine 16 ms `.tran` buffer, so long windows on a circuit-routed channel showed
only a sliver. This closes that gap.

**What I did:**
- `Oscilloscope.tsx`: two new props — `circuitFs` (sample rate of the circuit buffers) and
  `onWindowSecChange` (the scope reports its window length each time it changes). The circuit-path branch
  of the capture memo now uses `circuitFs` for `srcFs`.
- `App.tsx`: a **second, scope-specific** transient effect. When a circuit is active and the scope window
  exceeds one generator span, it runs a separate coarser/longer `.tran` (settle a few periods, then cover
  window×2.2), resampled at a rate capped to ≤200k samples, and feeds it to the scope as `scopeSig1/2`
  with `scopeCircuitFs`. Short windows still reuse the existing fine `measured` buffer — the long sim only
  fires when needed. The original `circuitOut` effect (Spectrum Analyzer's fine 16 ms buffer) is unchanged,
  so the FFT path and its fidelity are untouched.

**Verification (Definition of Done):**
- build clean: yes. 12-bit floor: holds (the spectrum's circuit buffer + the no-circuit canary path are
  unchanged; the long sim is a separate buffer that only feeds the scope).
- tests: **57 passed** (component/App-level change; no new core math). Behaviour reasoned: e.g. a 1 Hz sine
  through an RC at 200 ms/div now runs a ~2 s `.tran` and the scope shows the filtered output across the
  full window; at 1 ms/div nothing changes (reuses the 16 ms buffer).

**State for the next session:**
- Long time/div now works for both the direct generator and a drawn circuit. Two transient effects exist
  by design: a fine short one (spectrum + short scope) and a coarse long one (scope only, on demand).
- Cost note: very long window × high drive frequency forces many `.tran` points; the step is capped at
  window×2.2/200k, so high-frequency detail coarsens on very long windows (the pedagogically sensible
  tradeoff — long timebase is for low-frequency viewing).

---

### 2026-06-26 — SCOPE-LONG: long timebase + synthesized capture buffer — DONE

**By:** Claude Code session (in Cowork)
**Commit:** uncommitted (run `.\push.ps1`)

**Why:** scope time/div maxed at 1 ms, and even adding longer options wouldn't help — the scope read
the App's fixed ~16 ms signal buffer, so a long window had nothing to show. andre wanted to display at
least a 1 Hz sine properly.

**What I did:**
- `Oscilloscope.tsx`: when viewing the generator directly (`circuitActive` false), the scope now
  **synthesizes its own capture buffer** sized to the timebase via `generateSignal({ ...params,
  samplingRate, duration: window×2.2 })`. Total samples capped at 200k (the synthetic rate drops for
  very long windows; the trace is downsampled for display anyway, and the trigger keeps sub-sample
  interpolation). Through a circuit (`circuitActive` true) it still uses the provided `.tran` samples.
- Time/div options extended **100 µs → 1 s** (10 s window). X-axis switches to **seconds** for windows
  ≥ 1 s; cursors, Δt/1·Δt and the window readout all follow the display unit.
- Signal Generator + scope CH2 frequency min lowered **10 Hz → 1 Hz** (step 1) so 1 Hz is settable.
- `App.tsx`: passes `circuitActive={drawnValid && circuitOut !== null}` to the scope.

**Verification (Definition of Done):**
- build clean: yes. 12-bit floor: holds (the Spectrum Analyzer path is untouched; the scope buffer is
  separate and only feeds the scope).
- tests: **57 passed** (no core math added; the change is component-level — sanity-checked numerically:
  1 Hz at 100 ms/div → 90 909 Sa/s buffer, window shows 1 full period; 1 Hz at 1 s/div → 10 periods;
  default 1 kHz at 1 ms/div unchanged at 100 kSa/s, 10 periods).

**State for the next session:**
- The scope is no longer tied to the 16 ms generator buffer — it scales its own capture to time/div.
- **Known limitation:** through a *drawn circuit*, the scope still uses the App's `.tran` buffer (sized
  to the generator grid), so very long time/div on a circuit-routed channel shows only the available
  span. Extending that means lengthening the App `.tran` stop/grid — deferred (separate from this ask).
- The synthetic scope rate is a display buffer, not the ADC-rate lesson (that stays in the Spectrum
  Analyzer), so dropping it for long windows is fine pedagogically.

---

### 2026-06-26 — BODE-GEN: topology-aware −3 dB readout (de-specialize the loop) — DONE

**By:** Claude Code session (in Cowork)
**Commit:** uncommitted (run `.\push.ps1`)

**Why:** andre flagged that the −3 dB / fc readout silently assumed an RC low-pass (it measured
3 dB down from the *DC* gain). For a high-pass it showed "—"; for a band-pass/notch it was
meaningless. The knobs were already general; the readout was the over-fit part.

**What I did:**
- `core/spice.ts`: `analyzeBode(freq, magDb): BodeFeature` — measures −3 dB relative to the **peak**
  gain and classifies by where the in-band region sits: low-pass / high-pass (1 cutoff), band-pass
  (2 edges + geometric center + bandwidth), band-stop/notch (2 edges flanking the dip), or flat /
  all-pass (no feature). All crossings interpolated in log-frequency. `findCutoffHz` kept for back-compat.
- `core/spice.test.ts` (+5 tests): synthetic LP/HP/BP/notch/flat magnitudes classify correctly and
  the edges/centers land within ~2–5 %.
- `NetworkAnalyzer.tsx`: replaced the low-pass-only `findCutoff` with `analyzeBode`. The plot now draws
  a dotted marker at *each* −3 dB crossing, the in-plot annotation reads "LP/HP fc ≈ …" or "BP/Notch
  f0 ≈ …", and the marker-table shows the shape label + the relevant freq(s) (BP also shows the band +
  BW). Flat responses read "no −3 dB feature" instead of a bogus number.

**Verification (Definition of Done):**
- build clean: yes. 12-bit floor: holds (signal path untouched).
- tests: **57 passed (52 prior + 5 analyzeBode)**.

**State for the next session:**
- The Network Analyzer is now a general filter explorer (LP/HP/BP/notch), not an RC-low-pass demo.
  Drag the tune knobs on any of those and the shape label + edges update live.
- `analyzeBode` is the canonical Bode-feature finder; prefer it over `findCutoffHz` for UI. Notch
  detection uses the deepest-dip heuristic — fine for single notches; a multi-notch response would
  report the deepest one.

---

### 2026-06-26 — NA-TUNE: tune knobs inside the Network Analyzer (LOOP-2 follow-on) — DONE

**By:** Claude Code session (in Cowork)
**Commit:** uncommitted (run `.\push.ps1`)

**Why:** the LOOP-2 tune slider lived in the Schematic Editor, but split view is hardcoded to
Signal Gen + Spectrum, so the slider and the Bode plot could never be on screen together (andre
flagged this). Chosen fix (option A): put the tuning knobs **inside the Network Analyzer**, next to
the curve, so "turn knob → watch fc move" happens in one panel with no layout juggling.

**What I did:**
- `core/units.ts` (new): single source of truth for `UNIT`, `TUNE_RANGE`, `fmtEng`, `parseEng`, and
  the log-slider mapping `tunePos`/`tuneValue` (+ `TUNE_STEPS`). No React.
- `core/units.test.ts` (new, 5 tests): eng-notation parse/format, slider position↔value round-trip
  (<1% in log space), clamping at the ends, monotonicity.
- `SchematicEditor.tsx`: removed its local copies of those helpers and imports them from `core/units`
  (the editor slider now uses `tunePos`/`tuneValue` too) — no behaviour change, just de-duplicated.
- `NetworkAnalyzer.tsx`: new `Tunable` type + `tunables?`/`onTune?` props; a **"Tune (live)"** section
  in the settings panel renders a log slider per R/C/L of the drawn circuit, labelled with refdes +
  current value. Dragging calls `onTune` → updates the schematic → `drawn` re-derives → the debounced
  AC sweep re-runs → the Bode curve + interpolated fc move live.
- `App.tsx`: derives `tunables` from the schematic's R/C/L and passes `onTune = tuneComponent`
  (updates a component's value by id). One source of truth (the schematic); the editor slider and the
  NA knobs both drive it and stay in sync.

**Verification (Definition of Done):**
- build clean: yes. 12-bit floor: holds (signal path untouched).
- tests: **52 passed (47 prior + 5 units)**.

**State for the next session:**
- Live tuning now works from inside the Network Analyzer — the headline RC moment is reachable in one
  panel. The editor slider still exists for editing on the schematic.
- The layout limitation remains (split view is still the fixed Signal Gen + Spectrum pair). If a
  side-by-side editor+Bode is wanted later, that is the Track E preset-layout work (option B).
- `core/units.ts` is now the home for unit/tune helpers; reuse it rather than re-defining.

---

### 2026-06-26 — LOOP-2: live tuning + interpolated −3 dB cursor — DONE

**By:** Claude Code session (in Cowork)
**Commit:** uncommitted (run `.\push.ps1`)

**What I did:**
- `core/spice.ts`: `findCutoffHz(freq, magDb)` — the −3 dB cutoff relative to the passband gain,
  **interpolated in log-frequency** so the reading is not quantized to the sweep grid. Returns null
  when the response never drops 3 dB.
- `core/spice.test.ts` (+3 engine-free tests): cutoff within 1% for fc ∈ {100, 1k, 15.915k, 100k};
  interpolation beats the nearest-grid-point at a coarse 5 pts/decade (fc=2371, between grid points);
  flat trace → null.
- `components/NetworkAnalyzer.tsx`: now uses the core `findCutoffHz` (replacing the local grid-point
  version), and the AC sweep effect is **debounced 250 ms** so dragging a value coalesces to one sweep
  after the last edit (no worker spam, no jank). The cutoff marker line + `fc ≈ …` annotation +
  marker-table readout from NET-1 stay, now reading the interpolated value.
- `components/SchematicEditor.tsx`: a **live-tune log slider** in the Selected panel for R/C/L
  (`TUNE_RANGE`: R 1 Ω–1 MΩ, C 1 pF–10 µF, L 1 µH–1 H). Dragging calls `setSelValueNum` → updates the
  schematic → `drawn` recomputes → both the transient feed (already debounced 250 ms in App) and the
  AC sweep (now debounced) re-run live. The numeric Value field is keyed on the value so it reflects
  the dragged number; exact entry via the field still works (commits on blur/Enter).

**Verification (Definition of Done):**
- build clean: yes (`tsc && vite build` ✓).
- 12-bit spectrum floor at −104 dBFS: holds — `core/signal.ts` and the spectrum path untouched.
- math sanity: findCutoffHz tests green. Full suite **47 passed (44 prior + 3 new)**.

**State for the next session:**
- Live tuning works end-to-end: drag R or C, watch the Bode cutoff (and the scope output) move, with
  the fc readout interpolated. The transient path was already debounced (App, 250 ms); LOOP-2 added the
  matching AC debounce + the slider + interpolation.
- **Spec deviation (intentional):** the spec's "Transient/AC toggle with remembered settings per mode"
  is **N/A under the LOOP-1 architecture decision** — Bode is its own instrument (Network Analyzer,
  always `.ac`) and time-domain is the Oscilloscope/Spectrum (always `.tran`), so there is no single
  panel that switches modes. Per-instrument settings already persist in component-local state. Recorded
  here rather than building a toggle that would contradict LOOP-1.
- `findCutoff` in NetworkAnalyzer is now a thin wrapper over the core fn; could be inlined later.

**Open questions / flags for andre:**
- The tune slider covers R/C/L (the filter components). dcrail/in-amp gain still use the numeric field
  only — say the word if you want sliders there too.
- Same sandbox sync caveat as the OSC-5 entry applies (build/tests run on a corrected mirror; your real
  files were edited directly and verified intact).

---

### 2026-06-26 — OSC-5: scope measurements + cursors — DONE

**By:** Claude Code session (in Cowork)
**Commit:** uncommitted (run `.\push.ps1`)

**What I did:**
- `core/scope.ts`: `measureTrace(v, dt)` → `ScopeMeasurements` { vpp, vmax, vmin, mean, vrms,
  freq, period, duty }. Amplitude stats are exact (single pass). Timing comes from interpolated
  mid-level crossings (same sub-sample technique as the trigger): period = mean spacing of rising
  crossings, freq = 1/period, duty = high-time over one period anchored on the first rising
  crossing. Timing fields are `null` when the window holds no full cycle (flat/DC), so no bogus
  frequency is reported.
- `core/scope.test.ts` (+4 tests, 7 total): 1 kHz/1 V sine → Vpp≈2, Vrms≈0.707, f≈1000, duty≈0.5;
  1 kHz/1 V 50% square (10 full periods) → Vpp=2, Vrms=1, mean=0, f=1000, duty=0.5; flat 0.5 V →
  null timing, mean 0.5; empty trace safe.
- `components/Oscilloscope.tsx`: a "Measure" settings section with two toggles. Measurements render
  as a `.marker-table` overlay (CH1 + CH2 rows: Vpp, Vrms, mean, f, duty), computed in the render
  effect over the **full-resolution** captured window (`signal.x.subarray(startIdx, startIdx+winSamples)`,
  dt = 1/Fs) — not the downsampled display trace, so freq/duty stay accurate. Cursors: two time
  (magenta) + two voltage (teal) lines as Plotly shapes, moved by range sliders; on-screen readout of
  Δt, 1/Δt, ΔV (ΔV scaled by CH1 volts/div). Two new local color consts CURSOR_T_COLOR/CURSOR_V_COLOR.

**Verification (Definition of Done):**
- build clean: yes (`tsc && vite build` ✓, no new any/ts-ignore)
- 12-bit spectrum floor at −104 dBFS confirmed: yes — `core/signal.ts` and the spectrum path are
  untouched; the canary holds by construction.
- math sanity check: measureTrace tests green. Sine Vrms 0.7071 vs A/√2=0.7071; square Vrms 1.000
  vs A=1.000; both f=1000.0 Hz; duty 0.500. Full suite: **44 passed (40 prior + 4 new)**.

**State for the next session:**
- The scope now has Scopy-style measurements + cursors. `measureTrace` is a reusable pure core fn
  (could feed a guided-discovery "measure the −3 dB bandwidth" prompt later).
- Cursors are slider-driven (stepped), per spec's "stepped acceptable, draggable preferred." A future
  polish could make them draggable via Plotly editable shapes + a `plotly_relayout` listener.
- ΔV references CH1 volts/div only; if a per-cursor channel target is wanted, add a small selector.

**Open questions / flags for andre:**
- Sandbox note (not a code issue): the bash mount served a **stale copy** of the repo this session
  (file-tool writes didn't appear in bash, and an earlier checksum-rsync from the stale mount briefly
  clobbered the build copy's `breadboard.ts`/`breadboard.test.ts`). Your real files were never
  affected — verified intact via the file tools — and the build/tests were run on a corrected copy.
  Flagging in case the cross-session sync needs a look.

---

### 2026-06-26 — OSC-3: scope edge trigger + capture-phase — DONE

**By:** Claude Code session (in Cowork)
**Commit:** uncommitted (run `.\push.ps1`)

**What I did:**
- `core/trigger.ts` (new, pure): `findEdgeTrigger(v, level, slope, startIndex)` (linear-interpolated
  sub-sample crossing, null if none) + `nextTriggerState(prev, found, mode)` reducer
  (Auto/Normal/Single → show triggered / free / hold + status string).
- `core/trigger.test.ts` (8 tests): rising/falling interpolated index, level-out-of-range → null,
  startIndex honoured, **phase-invariance** (a 0.5 V rising trigger on a 1 kHz sine lands at the same
  within-period phase for every capture offset), and the Auto/Normal/Single reducer.
- `components/Oscilloscope.tsx`: trigger controls (Source CH1/CH2, Mode Auto/Normal/Single, Slope,
  Level), a dotted **level marker** (`--trigger-color`) on the source channel's scaling, a centre
  alignment line + 50% pre-trigger when triggered, a status badge ("Trig'd"/"Auto"/"Ready"/"Stop"),
  a **Single Re-arm** button, and the **free-running capture-phase scroll** (the window advances each
  frame when Auto can't find a trigger, so an untriggered trace visibly scrolls and the trigger
  cancels it). `index.css`: added `--trigger-color`.

**Verification (Definition of Done):**
- build clean; **40/40 tests** (+8). canary holds — `signal.ts` untouched; trigger logic is scope-only.

**State for the next session:**
- Default (Auto, level 0, rising, CH1) locks a stable square; set the level beyond the signal to see
  the free-run scroll. The scope MVP is now shippable (ROADMAP milestone). OSC-4 (holdoff/pulse) and
  OSC-5 (measurements/cursors) remain. Also open: G-B, F-3.

### 2026-06-26 — AWG output impedance (49.9 Ω / R132) modeled — DONE

**By:** Claude Code session (in Cowork)
**Commit:** uncommitted (run `.\push.ps1`)

**What I did:**
- `core/schematic.ts` `toCircuit`: each W1/W2 (awg1/awg2) now emits an ideal source to an internal
  node plus a **49.9 Ω series resistor** (R132, after the AD8000 buffer) into the wired node. The
  source keeps id W1/W2 so `applyGeneratorParams` still stamps it. Loading the generator with a low
  resistance now visibly divides the amplitude — the bench reality behind "don't power from W1/W2."
- Fixed the two resistor-find tests to target the 1 kΩ DUT (not the new 49.9 Ω series R); added a
  test: a 49.9 Ω load on W1 → V(in) = 0.5 (2:1 divider). `docs/reference/m2k-spec.md` updated.

**Verification:** build clean; **32/32 tests**; canary holds (toCircuit only; `signal.ts` untouched).
The 49.9 Ω is upstream of the `in` node, so Bode V(out)/V(in) and the RC cutoff are unchanged for
high-impedance DUTs; it only matters when the generator is loaded.

### 2026-06-26 — PSU-2: live per-rail supply current + 50 mA limit — DONE

**By:** Claude Code session (in Cowork)
**Commit:** uncommitted (run `.\push.ps1`)

**What I did:**
- `core/spice.ts`: `sourceCurrent(r, sourceId)` reads a voltage-source branch current from an `.op`
  result (sign-flipped to "current delivered"). Test: a 5 V rail into 1 kΩ reads 5 mA.
- `components/PowerSupply.tsx`: now takes `circuit`/`w1`/`w2`, runs an `.op` (debounced) of the drawn
  circuit with the rails applied, sums `i(Vrail)` per rail, and shows **I = X mA / 50 mA** under each
  rail (red + warning when over the M2K's ~50 mA per-rail limit). Added a "power budget" note: the
  supplies are the regulated source; **W1/W2 are signal outputs, not a power source**.
- `App.tsx`: passes `circuit={drawn.circuit} w1={params} w2={params2}` to the Power Supply.
- `docs/reference/m2k-spec.md`: added the AWG output stage from the Rev C schematic (buffer =
  **AD8000YCPZ**, ×−11 gain, ≈ ±5.46 V, **49.9 Ω series → ~50 Ω output impedance**) and the supply
  ~50 mA/rail; logged "model AWG ~50 Ω output impedance" as a fidelity enhancement.

**Verification:** build clean; **31/31 tests**; canary holds (`signal.ts` untouched; PSU/Voltmeter
only).

**State for the next session:**
- Enhancement candidate: model W1/W2 with a 49.9 Ω series output resistance so loading the generator
  visibly divides the amplitude (makes "don't power from W1/W2" visible). Small toCircuit change.

### 2026-06-26 — G-A: fidelity alignment to ADI's M2K reference model — DONE

**By:** Claude Code session (in Cowork)
**Commit:** uncommitted (run `.\push.ps1`)

**What I did:**
- Pulled ADI's authoritative M2K parameters from the iio-emu source (`m2k_adc.cpp`, `m2k_dac.cpp`)
  and wrote `docs/reference/m2k-spec.md` with a reconciliation table (twin vs ADI).
- **Findings — the twin already matches the M2K high-gain config:** ADC 12-bit; ADC high-gain range
  ±2.5 V (the twin's `adcRangeV=5`, 0 dBFS = 2.5 V); 100 kSa/s is a real M2K rate; channel names
  W1/W2/1±/2± and supplies 0..±5 V all match.
- **One genuine correction:** the M2K AWG (W1/W2) output is **±5 V** (DAC `vlsb = 10/4095` → 10 Vpp),
  but the twin capped generation at ±2.5 V. Raised the generator **amplitude** cap to 5 V and the
  **offset** range to ±5 V in SignalGenerator, SpectrumAnalyzer, and Oscilloscope CH2.

**Verification (Definition of Done):**
- build clean; **30/30 tests**. 12-bit canary holds — defaults (amplitude 1 V, offset 0,
  `adcRangeV=5`) unchanged and `signal.ts` untouched.

**State for the next session:**
- The twin is now demonstrably faithful to ADI's reference M2K model (documented in
  `docs/reference/m2k-spec.md`), which backs the credibility claim in the Mark Thoren memo and
  `POSITIONING.md`.
- Noted fidelity enhancement: model the M2K's **two** scope ranges (±2.5 V high / ±25 V low) with a
  range selector so dBFS follows the range; the AWG can now drive the full ±5 V (viewed on ±25 V on
  real hardware).
- Remaining Track G: G-B (native real-Scopy bridge). Elsewhere: OSC-3, LOOP-2, F-3, Track E.

### 2026-06-26 — F-2: transfer schematic → breadboard + verification loop — DONE

**By:** Claude Code session (in Cowork) — on branch `track-f-breadboard`
**Commit:** uncommitted (run `.\push.ps1`)

**What I did:**
- `core/breadboard.ts`: `BoardLayout` (parts/jumpers/ports), `PORT_NAME`/`PLACEABLE_KINDS`,
  `schematicExpectation(s)` (the R/C/L parts + ports the schematic expects, each with its net),
  and **`checkEquivalence(schematic, board, holes)`** — the centerpiece: compares the board's node
  partition to the schematic's (ports anchor the mapping) and returns the first problem with a
  student-friendly message ("place C1", "R1 pin B and C1 pin A should be the same node", "… are
  different nodes but your board connects them").
- `components/Breadboard.tsx` (F-2): place the schematic's parts/ports by picking them from a
  checklist then clicking holes; jumper tool; Select-to-delete; **Check** button; Practice colours
  each wired node live (+ hover highlight), Bench hides nodes until Check.
- `App.tsx`: `board` state + localStorage autosave (`m2k-board-v1`); the Board tab now renders the
  **stacked** schematic-over-board view.
- Tests (5 new): correct RC transfer matches; missing part flagged; split output node flagged;
  accidental short flagged; a jumper re-joins a split → matches.

**Verification (Definition of Done):**
- build clean; **30/30 tests** (+5). canary: `signal.ts` untouched.
- Note: the Write tool truncated the large `Breadboard.tsx` on the outputs mount; rewrote it via a
  quoted bash heredoc straight to the mount (reliable for big files with backticks/${}).

**State for the next session:**
- The transfer-and-verify loop works: draw a circuit, drop its parts/ports on the board, jumper,
  Check. Practice/Bench modes both wired. F-3 (stretch): DIP/IC footprints (op-amp, INA) + an
  optional "show one valid layout" hint. Also still open: OSC-3, LOOP-2, Track E, KICAD-1.

### 2026-06-26 — F-1: breadboard model + SVG render + Practice net highlight — DONE

**By:** Claude Code session (in Cowork) — on branch `track-f-breadboard`
**Commit:** uncommitted (run `.\push.ps1`)

**What I did:**
- `core/breadboard.ts`: parametric board geometry (30 cols, two 5-row terminal banks split by the
  center channel, four power rails), internal-connection groups (`T<col>`/`B<col>`/`RAIL_*`), and
  `boardNets(holes, jumpers)` — union-find over hole keys (same engine idea as schematic
  `computeNets`). `buildHoles`, `holeKey`, `boardWidth/Height` exported for rendering.
- `core/breadboard.test.ts` (4 tests): a 5-hole column is common; the channel separates banks;
  a rail runs full length and +/- rails are distinct; a jumper unions two columns.
- `components/Breadboard.tsx`: parametric SVG board (holes, rail stripes, channel, row labels) with
  a **Practice/Bench** toggle. Practice lights up every hole on the node you hover (teaches "these
  5 are common / the rail is one net"); Bench hides the hint.
- `App.tsx`: "Board" nav tab → standalone Breadboard panel.

**Verification (Definition of Done):**
- build clean (`tsc && vite build`); **25/25 tests** (+4).
- canary: `signal.ts` untouched; breadboard is independent.

**State for the next session (F-2):**
- Standalone Board tab for now; the **stacked-under-schematic** view + **drag-from-schematic**
  parts, **jumper tool**, and the **equivalence Check** (board nets vs schematic nets, reusing
  `boardNets` + `toCircuit`) are F-2. `boardNets` already accepts jumpers (tested), so F-2 wires
  the UI for jumpers + placed legs and diffs the two net partitions.
- Geometry knobs: `COLS`, `PITCH`, `PAD`, `ROWS` in `core/breadboard.ts`.

### 2026-06-26 — Planning: Track F (breadboard layout) specced + prioritised NEXT — DONE (docs only)

**By:** Claude Code session (in Cowork) — project-director planning, no code
**Commit:** uncommitted (run `.\push.ps1`)

**What I did:**
- New spec `docs/specs/breadboard.md` for **Track F** — transfer a schematic onto a solderless
  breadboard, student makes the layout choices, twin verifies electrical equivalence.
- Locked decisions: **verification loop is the centerpiece** (reuse `computeNets` on both sides,
  per-connection feedback); **parametric SVG board** (not a photo); **Practice mode** (live net
  colouring) with a toggle to **Bench mode** (no hints → place from memory, then Check — the
  sneaky/graded mode); **drag from the schematic**; **stacked view** (board under schematic, not
  side-by-side); **2-pin parts first**, DIP/IC in F-3.
- Phases: F-1 board model + SVG render + net colouring; F-2 drag parts + jumpers + equivalence
  check; F-3 (stretch) DIPs + hint.
- ROADMAP: added Track F block, marked **NEXT** ahead of OSC-3/LOOP-2 per andre.

**Verification:** docs only; no build/test impact. `signal.ts` untouched.

**State for the next session:**
- **Take F-1 next.** It bridges the Lab 1/2 gap (ideal schematic → physical bench). Reuses the
  existing `computeNets` net engine; no new dependency. Still open after F: OSC-3, LOOP-2, Track E, KICAD-1.

### 2026-06-26 — Spectrum Analyzer: CH1 / CH2 / Both channel select — DONE

**By:** Claude Code session (in Cowork)
**Commit:** uncommitted (run `.\push.ps1`)

**Request:** spectrum should have CH1/CH2 like the scope and network analyzer.

**What I did:**
- `SpectrumAnalyzer.tsx`: added a Channels selector (CH1 / CH2 / Both) + props `params2`,
  `signal2`, `onParam2Change`.
  - Single channel (CH1 or CH2): the **full Learning Mode pipeline** (bit-depth noise floor,
    theory overlay, peak marker, persistence, average) runs on the selected channel's signal +
    params; trace colour orange/cyan; the Signal controls edit that channel.
  - Both: a clean dual live overlay (CH1 orange, CH2 cyan) against the shared noise floor;
    theory/persistence/average are single-channel concepts and are disabled in Both.
  - CH2/Both disable until a CH2 signal exists.
- `App.tsx`: passes `params2`, `signal2={measured2}`, `onParam2Change` to the Spectrum.

**Verification:** build clean; **21/21 tests**; `signal.ts` untouched. **Canary holds by
construction** — default channel is CH1 with the identical params/signal path as before, so the
12-bit Hanning floor is unchanged at −104 dBFS.

**State for the next session:**
- All three frequency/time instruments (Scope, Spectrum, Network Analyzer) are now CH1/CH2 aware
  and read their breadboard probes. Remaining TODO: OSC-3, LOOP-2, Track E, KICAD-1.

### 2026-06-26 — Network Analyzer: CH1 / CH2 / Both channel select — DONE

**By:** Claude Code session (in Cowork)
**Commit:** uncommitted (run `.\push.ps1`)

**Request:** like the scope's two channels, let the Network Analyzer plot CH1, CH2, or both.

**What I did:**
- `NetworkAnalyzer.tsx`: now takes `probes={ ch1?, ch2? }` (the SPICE node each scope probe is
  wired to). One `.ac` run yields a transfer function per probe vs the W1 input —
  `bode1 = V(ch1node)/V(in)` (ch1 defaults to `out`), `bode2 = V(ch2node)/V(in)` if a 2+ probe
  exists. A **Channels** selector (CH1 / CH2 / Both) overlays the traces in scope colours
  (CH1 orange, CH2 cyan), with a legend when both are shown. CH2/Both disable when no 2+ probe;
  the fc readout follows the selected channel.
- `App.tsx`: passes `probes={drawnValid ? drawn.probes : undefined}` to the Network Analyzer.

**Verification:** build clean (tsc + vite); **21/21 tests**; `signal.ts` untouched (canary holds).

**State for the next session:**
- Each probe drives its own Bode trace (relative to the W1 input), consistent with the WIRE-3
  scope fix where each probe reads its own node. Default-circuit case (no drawing) shows CH1 only.

### 2026-06-26 — EDIT-1: rubber-band wires (pulled ahead of OSC-3 at andre's request) — DONE

**By:** Claude Code session (in Cowork)
**Commit:** uncommitted (run `.\push.ps1`)

**What I did:**
- `core/schematic.ts`: pure helpers — `attachedWireEnds(s, c)` (wire endpoints sitting on a
  component's terminals), `moveComponentWithWires(s, id, gx, gy, attached)` (carry those ends by
  the move delta), `rotateComponentWithWires(s, id)` (carry ends to the rotated terminals by
  index), plus exported `WireEndRef`.
- `SchematicEditor.tsx`: drag captures attached ends at mousedown (`attachedWireEnds`) so it moves
  exactly those, never a wire it passes over; drag uses `moveComponentWithWires`; Rotate (button +
  `r` key) uses `rotateComponentWithWires`.
- Scope chosen per discussion: drag AND rotate, endpoints-only (straight wires, no auto-elbows),
  junctions stretch (the moved part's wire follows; others stay).

**Why it mattered (more than cosmetic):** connectivity is by coordinate coincidence, so a wire
left behind when a part moved was *silently disconnecting* the part. Rubber-banding fixes that
latent bug too.

**Verification (Definition of Done):**
- build clean; **21/21 tests** (+2: move carries attached ends & leaves fixed ends; rotate carries
  ends to rotated terminals and `computeNets` keeps them on one net).
- 12-bit canary: `signal.ts` untouched.

**State for the next session:**
- Remaining TODO: OSC-3 (triggers, fully specced incl. capture-phase), LOOP-2, Track E, KICAD-1.

### 2026-06-26 — Bugfix: scope CH2 (2+) now reads its wired node, not generator2 — DONE

**By:** Claude Code session (in Cowork)
**Commit:** uncommitted (run `.\push.ps1`)

**Symptom (andre):** with 2+ wired to the circuit input (a 1 kHz square), CH2 showed a sine.
**Cause:** WIRE-3 only routed 1+ (`out`) through the `.tran`; CH2 still displayed `generator2`,
whose default is a 2 kHz sine — so 2+ ignored its wiring.

**Fix:**
- `core/schematic.ts`: `ToCircuitResult` now returns `probes: { ch1?, ch2? }` — the SPICE node
  each scope input is wired to (`ch1` = 1+ node, `ch2` = 2+ node), via the same `rename()` used
  for the netlist (so 2+ on the input resolves to `'in'`, on its own node to `'scope2'`, etc.).
- `App.tsx`: the `.tran` effect now resamples BOTH probe nodes from the one run →
  `circuitOut` (CH1) and `circuitOut2` (CH2); `measured2 = drawnValid && circuitOut2 ?
  circuitOut2 : signal2` feeds the Oscilloscope CH2. CH1 path generalised to `probes.ch1 ?? 'out'`.
- Test: `schematic.test.ts` asserts 2+ on the W1 input maps to `probes.ch2 === 'in'` and 1+ to
  `'out'`.

**Verification:** build clean; **19/19 tests** pass; `signal.ts` untouched (canary holds).

**State for the next session:**
- Both scope channels now follow their breadboard wiring through a drawn circuit (single-ended,
  GND-referenced — matches the Voltmeter's simple case). A fully differential CH (subtract the
  1-/2- node) is a later refinement if a floating-reference circuit needs it.

### 2026-06-26 — Housekeeping (refdes numbering, manual Ref, remove SPICE dev) + OSC-3 spec — DONE

**By:** Claude Code session (in Cowork)
**Commit:** uncommitted (run `.\push.ps1`)

**What I did:**
- **Component numbering** (`SchematicEditor.tsx`): replaced the single shared `idSeq` counter
  with per-prefix refdes numbering. `REFDES` maps kinds to prefixes (R/C/L, U for op-amp+in-amp,
  V for vsource); `newId(kind, comps)` returns prefix + (max existing number with that prefix)+1,
  so R1,R2,C1,L1… number independently and deletions don't renumber the rest. Fixes the old bug
  where inductor and in-amp both numbered as "I".
- **Manual numbering**: the Selected panel now has an editable **Ref** field; `setSelId` renames
  the component (rejects duplicates with a status message, keeps the selection).
- **Removed the SPICE dev panel**: deleted `components/SpiceDevPanel.tsx` and all wiring in
  `App.tsx` (import, `SHOW_SPICE_DEV`, nav button, render branch, `'spice'` instrument type).
- **OSC-3 spec** (`docs/specs/oscilloscope.md`): folded in the **free-running capture-phase
  offset** (per-frame, derived from the tick — not random) as the mechanism that makes triggering
  observable/testable, plus a concrete `core/trigger.test.ts` plan: phase-invariance property,
  edge-search unit cases, analytic sine crossings, and a pure `nextTriggerState` mode reducer.
  **No OSC-3 code yet** — andre asked to hold the build.

**Verification (Definition of Done):**
- build clean: `tsc && vite build` green; **18/18 tests** still pass.
- 12-bit canary: `signal.ts` untouched; numbering/dev-panel changes don't touch the signal path.

**State for the next session:**
- OSC-3 is fully specced (incl. the capture-phase decision) and ready to build when andre is.
- Numbering is per-type now; existing saved circuits keep their old ids (mixed prefixes are
  cosmetic only — toCircuit assigns its own SPICE refdes regardless of schematic id).
- NOTE: mount truncated `oscilloscope.md`, `SchematicEditor.tsx`, `App.tsx` on Edit-tool writes;
  the spec was recovered from `git show HEAD:` (a stale `.git/index.lock` blocked `git restore` —
  left it untouched, used read-only `git show`). All rebuilt via Python + verified by build/tests.

**Open questions / flags for andre:**
- A stale `.git/index.lock` exists in the repo (a crashed/parallel git process). I did not remove
  it. If `git` complains, delete `.git/index.lock` manually.

### 2026-06-26 — WIRE-3 (closes LOOP-1): scope/spectrum read the wired node via .tran — DONE

**By:** Claude Code session (in Cowork)
**Commit:** uncommitted (run `.\push.ps1`)

**What I did:**
- `core/netlist.ts`: `WaveDrive` on `VSource` + `tranDriveSpec()` — transient sources now emit
  the real generator shape: SIN for sine, **PULSE** for square (duty-aware), triangle, sawtooth
  (matching `generateSignal` conventions). `applyGeneratorParams` stamps `wave` onto W1/W2.
- `core/spice.ts`: `sampleNodeTransient(result, node, tGrid)` — linear-interpolates a `.tran`
  node voltage onto a uniform time grid so the scope/spectrum (which assume uniform Fs) consume
  the circuit output like a generated waveform.
- `App.tsx`: a debounced (250 ms) effect runs a `.tran` of the drawn circuit driven by the
  generator, resamples `v(out)` (the 1+ node) onto the generator grid (captures the 2nd span so
  startup transients settle), and stores `circuitOut`. `measured = drawnValid && circuitOut ?
  circuitOut : signal` feeds the **Oscilloscope CH1 and Spectrum**; the Signal Generator panel
  still shows the raw generator. Engine runs in the existing worker; UI stays responsive.

**Verification (Definition of Done):**
- build clean: `tsc && vite build` green.
- **Tests: 18/18 pass** (+2: square→PULSE netlist line; RC low-pass passband≈2 Vpp vs stopband
  attenuated through the real `.tran` + resampler).
- 12-bit canary: `signal.ts` untouched; with no circuit drawn `measured === signal` (generator),
  so the Spectrum input is byte-identical to before → floor stays −104 dBFS by construction.

**State for the next session:**
- **LOOP-1 is complete** — draw an RC filter, wire W1 → R → node → C → GND and put 1+ on the
  node: the scope/spectrum show the filtered output; the Network Analyzer shows its Bode curve.
  This is the shippable circuit-loop MVP (CLAUDE.md headline). Consider deploying + revisiting the
  Lab 3 `<!-- TWIN: -->` prelab markers.
- Two-tier resolution is in App via `measured` (not the channel bus `circuit-out` case, which
  stays unused). Only CH1/1+ (`out`) is routed; 2+ (`scope2`) for CH2 is a later refinement.
- NOTE: mount truncated `netlist.ts`, `spice.ts`, `App.tsx`, `spice.test.ts` on Edit-tool writes
  again; all rebuilt via bash/Python and verified by full build + test run.

**Open questions / flags for andre:**
- Steady-state capture grabs the 2nd generator span; a very slow circuit (τ ≳ one span) would
  still show some settling. Fine for EEC1 RC/op-amp circuits; revisit if a slow integrator appears.
- Next obvious steps: OSC-3 (triggers), LOOP-2 (live tuning + −3 dB cursor), or EDIT-1 (rubber-band).

### 2026-06-26 — Instrumentation amplifier component (INA + INA3) + symbol cleanup — DONE

**By:** Claude Code session (in Cowork)
**Commit:** uncommitted (run `.\push.ps1`)

**What I did:**
- `core/netlist.ts`: new `InAmp` component (pins inP/inN/out/ref, `gain`). Two models — `ideal`
  (one VCVS: `E out ref inP inN gain`) and `threeopamp` (classic 3-op-amp built from ideal VCVS
  op-amps + matched 10k resistors, Rg sized to `G = 1 + 2R/Rg`). `inampLines()` namespaces
  internal nodes per instance.
- `core/schematic.ts`: SchKinds `inamp` / `inamp3`, 4 terminals, `toCircuit` mapping. Friendly
  default: an unwired REF is tied to ground so beginner circuits still solve.
- `SchematicEditor.tsx`: INA / INA3 palette tools, `V/V` gain unit, default gain 10, triangle
  symbol with +/−/out/REF pins.
- Earlier in the session (same file): inductor now draws a coil; resistor a zigzag; capacitor
  parallel plates (were all identical boxes). Save button now offers a real filename (native
  Save dialog + prompt fallback).
- Tests: ideal in-amp reads V(out)=1.0 for 0.1 V diff × gain 10; 3-op-amp reads 0.5 for 0.05 ×
  gain 10 — both via `.op` through ngspice.

**Verification (Definition of Done):**
- build clean: `tsc && vite build` green.
- **Tests: 16/16 pass** (was 14; +2 in-amp).
- 12-bit spectrum canary: `signal.ts` untouched; unaffected.

**State for the next session:**
- Active analog parts available now: ideal op-amp, ideal in-amp (project INA front end), and
  3-op-amp in-amp (lab on in-amp internals). All emit via VCVS, ignore power rails (ideal).
- NOTE: the mount truncated `netlist.ts`, `schematic.ts`, `SchematicEditor.tsx`, and
  `spice.test.ts` on Edit-tool writes again; all were rebuilt via bash/Python and verified by
  line count + full test run. Continue editing these large files via bash/Python, not the Edit tool.

**Open questions / flags for andre:**
- In-amp REF defaults to ground if unwired; if you want a mid-supply ref (Vref pin to a divider)
  that already works by wiring REF to the node.

### 2026-06-26 — Planning: Track E (docking/workspace) + EDIT-1 (rubber-band) — DONE (docs only)

**By:** Claude Code session (in Cowork) — project-director planning, no code
**Commit:** uncommitted (run `.\push.ps1`)

**What I did:**
- New spec `docs/specs/docking-workspace.md` for **Track E** — dockable panels + saveable
  workspaces. Three phases: **E-1** preset snap layouts (no new dep, generalizes the split view
  into lab-keyed multi-panel presets), **E-2** true docking via **dockview** + geometry-only
  workspace save/load, **E-3** optional full-config workspace (persist each instrument's local
  settings — the expensive tier that touches every component).
- Captured the **two-tier cost** decision: geometry save is cheap, instrument-config save is the
  real refactor (component-local state per CONVENTIONS §4 must be lifted). Director picks the tier.
- Engine call: **do not hand-roll docking**; adopt dockview behind a `Workbench.tsx` wrapper
  (swappable, mirrors the SpiceEngine adapter). New runtime dep → needs sign-off per CONVENTIONS §2.
- Added **EDIT-1** to Track D: rubber-band wires (wire endpoints follow a component when it is
  moved/rotated). Design noted in ROADMAP — pure `schematic.ts` helper + the `SchematicEditor`
  drag handler; `computeNets` preserves connectivity by construction.
- ROADMAP: added Track E block (E-1/E-2/E-3 TODO) and the EDIT-1 row (TODO).

**Verification (Definition of Done):**
- docs only; no build/test impact. signal.ts untouched; 12-bit canary unaffected.

**State for the next session:**
- Track E is specced but **deliberately not started** — finish the circuit-loop MVP (WIRE-3 /
  LOOP-1) on a stable instrument set first, then take E-1.
- EDIT-1 is a small self-contained editor win that can be slotted any time.

**Open questions / flags for andre:**
- Decide whether the course wants free docking (E-2/E-3) or whether E-1 presets are enough.
- E-2 requires approving **dockview** as a new runtime dependency.

### 2026-06-26 — PSU-1 Power Supply instrument — DONE

**By:** Claude Code session (in Cowork)
**Commit:** uncommitted (run `.\push.ps1`)

**What I did:**
- `core/netlist.ts`: `SupplySettings` + `applySupplyRails(circuit, psu)` — overrides every DC rail
  from the instrument (V+ pins = positive rails, V- = negative; disabled → 0 V). The V+/V- pins
  drawn on the breadboard now take their voltage from the Power Supply, like the real M2K.
- `components/PowerSupply.tsx` + App "Supply" nav: two rails — V+ (0..+5 V), V- (-5..0 V) — each
  with an enable, big readout, slider + numeric, and a **tracking** mode (V- = -V+).
- `Voltmeter.tsx`: takes the `psu` prop and applies the rails before `.op`, so it reads the live
  supply. Removed per-symbol voltage editing on V+/V- (the PSU owns it).
- App nav refactored to a small `navBtn` helper.

**Verification (Definition of Done):**
- build clean: `tsc && vite build` green.
- **Tests: 14/14 pass.** New: a V+ rail overridden to 3 V reads 3 V at the node via `.op`.
- 12-bit spectrum canary: signal.ts untouched; unaffected.

**State for the next session:**
- The full Lab-1 bench is live: Signal Gen, Scope (2ch), Spectrum, Network Analyzer, Voltmeter,
  **Power Supply**, Circuit editor (save/load). Lab 1 Parts 3–4 (set supplies, read with the
  voltmeter, single-ended + differential) are fully doable in the twin.
- Remaining: WIRE-3 (Scope/Spectrum read wired node via `.tran`), OSC-3..5 (triggers + measurements), LOOP-2.

**Open questions / flags for andre:**
- Runtime check (Lab 1 Part 3-4): Supply tab → set V+ = 3, V- = -1. Circuit tab → V+ → 1+, 1- → GND,
  add GND. Voltmeter → Ch1 ≈ 3 V. Toggle Supply tracking and watch V- follow -V+.

### 2026-06-26 — SCH-3 Save/Load circuit — DONE

**By:** Claude Code session (in Cowork)
**Commit:** uncommitted (run `.\push.ps1`)

**What I did:**
- `App.tsx`: localStorage autosave/restore of the drawn circuit (`m2k-circuit-v1`) — a refresh
  or cache-clear no longer loses work. `loadStoredSchematic()` lazy-inits state; an effect
  persists on every change.
- `SchematicEditor.tsx`: **Save** (download `m2k-circuit.json`) and **Open** (file picker → parse
  → load) in the editor header. `bumpIdSeq()` advances the id counter past loaded ids so new
  parts don't collide. Validates the file shape; status shows "loaded <name>".

**Verification (Definition of Done):**
- build clean: `tsc && vite build` green.
- Tests: 13/13 pass (no core math touched).
- 12-bit spectrum canary: signal.ts untouched; unaffected.

**State for the next session:**
- Circuits persist across refresh and can be shared/submitted as `.json`. Good for course use.
- Remaining major items: WIRE-3 (Scope/Spectrum read wired node via `.tran`), PSU-1 (Power
  Supply instrument), OSC-3..5 (triggers + measurements).

**Open questions / flags for andre:**
- Runtime check: draw something, Save → a `m2k-circuit.json` downloads; Clear; Open it back.
  Refresh the page → the last circuit is still there (autosave).

### 2026-06-26 — WIRE-2 analysis-aware sources + DMM-1 Voltmeter — DONE

**By:** Claude Code session (in Cowork)
**Commit:** uncommitted (run `.\push.ps1`)

**What I did:**
- `core/netlist.ts`: `applyGeneratorParams(circuit, w1, w2)` stamps the Signal Generator
  settings onto the W1/W2 sources (dc=offset, AC 1, SIN(offset,amp,freq)). `buildNetlist`
  already switches the emitted line by analysis (AC 1 for `.ac`, SIN for `.tran`, DC for `.op`),
  so the SAME drawn circuit now drives correctly under every instrument. (schematic.ts untouched.)
- `core/spice.ts`: `nodeVoltage` / `hasNode` / `differentialVoltage` read a real `.op`/`.dc`
  result.
- `components/Voltmeter.tsx` + App "Voltmeter" nav: M2K-style 2-channel DC voltmeter. Runs
  `.op` on the drawn circuit and shows Ch1 = V(1+)-V(1-), Ch2 = V(2+)-V(2-) — single-ended when
  the '-' input is on GND, differential otherwise. ±25 V / ±2.5 V ranges with Lab-1 resolution
  (20 mV / 2 mV).

**Verification (Definition of Done):**
- build clean: `tsc && vite build` green.
- **Tests: 13/13 pass.** New: a divider `.op` reads V(out)=2.5 V and a differential = 2.5 V.
- 12-bit spectrum canary: signal.ts untouched; unaffected.

**State for the next session:**
- Voltmeter is live and reads the wired ADC ports (Lab 1 Part 4: single-ended + differential
  supply measurements). Analysis-aware sourcing is proven end to end.
- Remaining (WIRE-3 / LOOP-1 scope half): make the **Scope/Spectrum** read their wired node via
  a `.tran` of the circuit (today they still read the generator directly), and add square→PULSE.

**Open questions / flags for andre:**
- Runtime check: Circuit tab — wire V+ → 1+, 1- → GND, add GND. Open Voltmeter → Ch1 ≈ +5 V.
  Make it differential by moving 1- to V- and watch Ch1 read the full span.

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