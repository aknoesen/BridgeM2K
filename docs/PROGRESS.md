# PROGRESS.md — session handoff log

Append-only log. Each CC session adds one entry at the **top** when it finishes (or stops).
The next session reads the latest entries to understand current state before starting.

This complements `docs/ROADMAP.md` (which holds the status table). ROADMAP says *what*
state each phase is in; PROGRESS says *how it went and what the next session needs to know*.

---

## Next session: start here (updated 2026-06-30)

**TIA-3 (single-supply TLV9062 TIA example + Cf helper + part-aware board Check) is DONE — Track J
complete.** Four pieces:
- **Example** (`core/examples.ts`, `tia-photodiode`, Amplifiers group): photodiode → **TLV9062**
  inverting input, **Rf 33 kΩ + Cf 1 nF** feedback, **`+` at a 10k/1k Vref divider (≈0.45 V) off V+**,
  1+ probe on the output, **no W1** (so transimpedance mode works directly). Photodiode **cathode →
  summing node, anode → GND**, so the 80 µA photocurrent drives Vout **up** from Vref. Verified in sim
  (`examples.test.ts`): `.op` Vout ≈ 3 V — above Vref, inside 0–5 V (correct orientation, not railed).
- **Cf helper** (`core/tia.ts` + test): pure `tiaCompensation(Cin, Rf, GBW, cfActual?)` → recommended
  `Cf ≈ √(Cin/(2π·Rf·GBW))`, the resulting −3 dB bandwidth, and a **peaking** flag when the actual Cf is
  absent/too small. Non-positive inputs are guarded.
- **Part-aware board Check** (`core/breadboard.ts`): `SchematicExpectation.dips.rails` gained
  `vnegTo: 'V-' | 'GND'`; a single-supply op-amp (`supplyDefault.vee === 0`, i.e. TLV9062) sets
  `'GND'`, and `checkEquivalence` then requires the **V− pin on the GND rail** (message updated). Kit
  ±5 parts keep `'V-'` — F-4 rail tests updated to assert the new field; existing Checks unchanged.
- **Inspector hint** (`SchematicEditor.tsx`): selecting a photodiode shows Cj0 ≈ 72 pF + the Cf formula,
  and — when it's wired to an op-amp inverting input with a feedback Rf (discovered via `computeNets`)
  — a concrete **suggested Cf + bandwidth** and a peaking warning if the present Cf is too small.

Build clean, **165/165** vitest, no `core/signal.ts` change (12-bit canary intact). ROADMAP TIA-3 →
DONE; **Track J (photodiode + TIA-0/1/2/3) is fully built.** `core/netlist.ts` (TIA-1 AC term) and
`core/breadboard.ts` (TIA-3 single-supply Check) were the flagged allowed-file touches.

⚠ **Live-Chrome verification is partial** (as with TIA-1/2): I verified the DC operating point, the
transimpedance math, and the board expectation via unit tests + the clean build, but did **not** load
the example in a browser to eyeball the scope DC level / the transimpedance Bode / a live board Check.
Recommend a quick Chrome pass on `tia-photodiode` before relying on it in class. **Next `TODO`:** the
tester **punch-list FB-1→FB-4** (FB-1 = scope Vpp measurement-window bug, highest), then **F-7** (board
auto-route) — both staged by Cowork, awaiting andre's go.

**TIA-2 (transimpedance read in the Network Analyzer) is DONE.** The Bode can now read a
**transimpedance** `Z(f) = V(out)/I_in` (denominator = the photodiode's 1 A AC photocurrent from
TIA-1), not just a voltage ratio. New pure helper `transimpedance(res, outName)` in `core/spice.ts`
returns the same `Bode` shape with `magDb` in **dBΩ** (`20·log10|V(out)|`) — so `analyzeBode` /
`findCutoffHz` work unchanged. `NetworkAnalyzer.tsx` gains a **Mode** toggle (Voltage gain /
Transimpedance) and, in transimpedance mode, a **dBΩ / Ω (linear)** sub-toggle (andre: both). Linear-Ω
plots `10^(magDb/20)` on an auto-ranged axis; dB modes keep the Max/Min range. The mag-axis title,
the −3 dB badge (now paper-anchored so it sits right on either axis), and the caption ("V(out) vs the
photocurrent (1 A AC)") all follow the mode; toggling mode re-sweeps. 2 new `spice.test.ts` tests:
low-frequency |Z| ≈ Rf (100 dBΩ for Rf=100 kΩ), and a feedback Cf rolls |Z| off at ≈1/(2π·Rf·Cf).
Build clean, **158/158**, no `core/signal.ts` change (12-bit canary intact). ROADMAP TIA-2 → DONE.
**Not yet committed at time of writing.**

⚠ **Live-Chrome check is partial:** the guided **TIA example is TIA-3** (not built yet), so I verified
the transimpedance math via the unit tests and the build, not by loading a bench example. Full
"switch to transimpedance, see |Z| flat at Rf then roll off" verification should happen once TIA-3
lands the example. **Next Track J `TODO`: TIA-3** (single-supply TLV9062 TIA example + `core/tia.ts` Cf
helper + the part-aware single-supply board Check — `breadboard.ts` is in TIA-3's allowed files).

**TIA-0 (TLV9062 op-amp) is DONE.** The TI TLV9062 (the summer TIA project's amp) is in the op-amp
library as a **course part** (the summer project's amp; not ADALP2000). Built to andre's three locked
decisions:
- **Course-parts tier** — `OpampPart` gained `origin: 'kit' | 'course'` (all 5 kit parts `'kit'`,
  TLV9062 `'course'`). The inspector shows a neutral blue **"course part"** badge (not the orange
  "not in your parts kit" warning). `isKitOpamp` returns true for it (it lives in the catalog).
- **SOIC-to-DIP adapter footprint** — new `DipPkg` `'opamp-soic-adapter'` (8-pin, standard dual
  pinout) in `core/breadboard.ts`; `opampBoardPkg` routes a dual **8-SOIC** part to it (other duals →
  the LMC662 8-DIP). Pinout legend added to `Breadboard.tsx`.
- **Part-aware auto-rails** — `OpampPart.supplyDefault` (`{vcc,vee}`); `netlist.ts` synthesises
  `Vvcc`/`Vvee` from it instead of hardcoded ±5. TLV9062 = `{vcc:5, vee:0}` (single +5 V, within its
  5.5 V max); kit parts omit it → ±5 V as before. The inspector's over-supply warning + "auto …"
  text are now part-aware (`railLabel`).

`opamps.test.ts`: catalog now lists 6 parts; TLV9062 params/origin/supplyDefault asserted; kit parts
have no `supplyDefault`; **engine tests** — kit op-amp emits `DC 5`/`DC -5`, TLV9062 emits `DC 5`/`DC 0`,
and a single-supply TLV9062 output stays in 0–5 V (never negative) while a ±5 kit part swings to ~−2 V.
Build clean, **156/156**, no `core/signal.ts` change (12-bit canary intact). ROADMAP TIA-0 → DONE.
**Not yet committed at time of writing.**

⚠ **Known limitation flagged for TIA-3 (not a TIA-0 bug):** an inverting amp with `+` at **ground**
is single-supply-broken — the output can't go negative and the level-1 macromodel winds up to the
clamp floor (the engine test documents this). This is exactly why TIA-3's example must bias `+` at a
**Vref divider**. Also, the board Check still expects V+/V− pins on the ±5 rails (the single-supply
"V− pin → GND" board wiring is a TIA-3 / follow-on concern, not handled here). **Next Track J `TODO`:
TIA-2** (Network Analyzer transimpedance read) — or TIA-3 once TIA-2 lands; sequence per andre.

**TIA-1 (AC photocurrent stimulus) is DONE — Track J started.** The photodiode's parallel `Iph` source
now carries an **AC magnitude (default 1 A) emitted only under `.ac`** (`core/netlist.ts` diode branch
keys off `analysis.kind === 'ac'`); `.op`/`.tran` decks stay **byte-identical** (DC term only), so the
photodiode polarity + all prior tests are unchanged. `Diode` gained `iphotoAc?`; `toCircuit` passes
`iphotoAc: 1` (the normalised stimulus, independent of the illumination `value`), so a 1 A AC current
makes `V(out)` read directly as transimpedance in ohms. 4 new `netlist.test.ts` cases (AC term only
under `.ac`; `.op`/`.tran` have none; custom magnitude; **end-to-end `.ac` on photodiode→ideal
op-amp→Rf gives |V(out)| ≈ Rf**). Build clean (`tsc`+vite), **151/151** vitest, **no `core/signal.ts`
change → 12-bit canary untouched**. ROADMAP TIA-1 → DONE; decisions locked (TIA-2 = both dBΩ + linear-Ω
toggle; TIA-3 ships the `core/tia.ts` Cf helper). **Next Track J `TODO`: TIA-2** (Network Analyzer
transimpedance read) — though Cowork has since staged a **TIA-0** (TLV9062 op-amp) with its own open
decisions for andre; sequence per andre. Photodiode branch was merged to `main` (`9c32d17`, ff) to
unblock this. Not yet committed at time of writing.

**Photodiode part added (BPW 34) — ad-hoc, andre 2026-06-30; not a ROADMAP phase.** A new
`'photodiode'` `SchKind` placeable from the editor palette ("Photo") and convertible via the
diode Type dropdown (Diode/LED/Zener/Photodiode). It reuses the diode SPICE path: `core/netlist.ts`
`Diode` gained `cj0` (→ `CJO=` in the `.model`) and `iphoto` (→ a **parallel DC current source
`Iph… cathode anode`** so the anode sources photocurrent — correct anode-positive Voc / reverse Isc
polarity; DC-only so `.ac` Bode is untouched). `toCircuit` (in `core/schematic.ts`) maps the part to a
silicon PIN diode with **datasheet-faithful basic params**: IS=1e-10 (≈0.35 V Voc at the 80 µA
short-circuit current), N=1, RS=10, BV=32 V (max reverse), CJO=72 pF (VR=0), and `iphoto = value`.
The **illumination knob is `value` = photocurrent in amperes** (`UNIT` 'A'; sensitivity 80 nA/lx →
1000 lx ≈ 80 µA, the default), with a live-tune range 1 nA–1 mA (`core/units.ts`). Boards as a 2-pin
part (`PLACEABLE_KINDS` in `core/breadboard.ts`); editor symbol is a diode with two arrows pointing
**in**. **No `core/signal.ts` change — 12-bit canary untouched.** Build clean (`tsc`+vite); **147/147**
tests (3 new photodiode tests in `netlist.test.ts`: CJO+Iph emission, Iph omitted when dark, and an
`.op` sim confirming V(a) ≈ Iph·R, anode-positive). Not yet committed at time of writing.

**F-4 (per-part op-amp board packages) is DONE.** The breadboard no longer hardcodes the LMC662 for
every op-amp — it drives the DIP footprint from the schematic op-amp's kit `part` via a new per-package
model in `core/breadboard.ts`: `DipPkg` (`opamp-single` | `opamp-quad` | `lmc662` | `ina125`) +
`DIP_DEFS` table (pin count, pin-function labels, V+/V− rail pins, used-amp signal pins) + `opampBoardPkg`/
`opampBoardName`. **Step 0** removed **ADTL082 + AD8542** from the kit catalog (`core/opamps.ts` — they're
breakout boards, not breadboard DIPs), leaving **5 kit op-amps** (OP27/37/97 single 8-DIP, OP482/484 quad
14-DIP); off-kit/part-less op-amps fall back to the 8-pin LMC662 dual; INA125 stays a 16-DIP. The board
render, the legend (a new **parametric `DipPinoutLegend`** replacing the hardcoded LMC662 SVG), and the
equivalence Check (`pinNets`/`rails` per package) all follow the selected part. **Centerpiece verified
live:** a default **OP484** boards as a **14-pin DIP labelled OP484** with the quad pinout (V+ pin 4 /
V− pin 11), no "LMC662" anywhere; Check passes when wired (tested). `PlacedDip.kind`/expectation dips are
now `DipPkg` (values `lmc662`/`ina125` unchanged, so old saved boards still deserialize). **No
`core/signal.ts` change — 12-bit canary untouched.** Build clean; **144/144** tests (new F-4 board tests
+ updated `opamps.test.ts` to the 5-part catalog). D2 ("show one valid layout" hint) deferred to F-4b per
andre. Full detail in the top log entry below. Next ROADMAP `TODO`: **KICAD-1** (stretch).

**SIG-2 (optional DAC quantization) is DONE — Track I is fully built (SIG-1 + SIG-2).** The Spectrum
Analyzer's Learning Mode now has a **"DAC model (W1/W2 output)" toggle + 4/8/12-bit selector**
(default 12 = real M2K AWG), distinct from the ADC bit-depth control, modelling the AWG DAC as an
optional, **default-OFF** synthetic quantization floor. `computeSpectrum` (in `core/signal.ts`) gained
two optional, gated args — `dacEnabled=false`, `dacBits=12` — that add a parallel synthetic Gaussian
noise term (TPDF, constructed identically to the existing ADC term) from the DAC full-scale
(`DAC_FULLSCALE_V = 10`, the AWG ±5 V range) and power-add the floors. **When off it's byte-identical**
(no extra RNG drawn), so the **12-bit canary holds at −104.29 dBFS**; `generateSignal`, tau, the window
denominator, Bluestein, and the **ADC** noise term were **not touched**. Verified live: DAC off →
−104; DAC 12-bit on → ~−97 (+6.99 dB predicted); **DAC 4-bit + ADC 12-bit → ~−50 dBFS, the DAC
dominates** ("worst converter wins"). New `signal.test.ts` (4 SIG-2 tests): byte-identical-off +
canary, DAC-on raises floor by the predicted amount, coarse-DAC-dominates-fine-ADC, no inter-harmonic
leakage with DAC on at every Fs preset. **138/138 tests, build clean.** Full detail in the top log
entry below. Next Track I work: none — the digitization story (DAC out → Fs → ADC in) is complete.

**SIG-1 (settable ADC sample rate) is DONE.** The Spectrum Analyzer has an **Acquisition (ADC)**
section with an **Fs preset dropdown** (5/10/20/50/100/200 kSa/s, default 100) that sets
`params.samplingRate` on **both** channels, plus a live **Fs / N / bin-width (Fs/N) + Nyquist**
readout. Demos verified live: **aliasing** (6 kHz at Fs=10 kSa/s → exactly 4 kHz, bin 64),
**oversampling** (floor −104.29 → −107.30 dBFS at 200 kSa/s), and the **bin-width readout**. Only
`snapDuration` was *exported* (plumbing); the protected math is untouched.

**Also landed recently (separate commits):** per-panel **ErrorBoundary** (`cc01e99`), the **scope
blank-screen fix** (`067c715`, Plotly YT↔XY `scaleanchor` re-init), a **bug-report template + About
link** (`28f92d6`), and the **degenerate-input blank-screen sweep** — frequency (`8d1c156`/`d57870e`),
amplitude/offset/duty finite-buffer guard (`7a0dc7f`), and the NA-range / long-tran / theory guards
(`9fd4fbe`).

---

### Earlier handoff (still relevant)

**F-6 (Breadboard-view layout controls) is DONE.** The combined `breadboard` view in `App.tsx`
no longer hard-codes a 50/50 vertical stack: a **draggable splitter** between the SchematicEditor
and Breadboard panes sets the ratio (clamped 15–85 %), persisted to `localStorage`
(`m2k-board-split-v1`) and restored on load; a **stacked↔side-by-side orientation toggle**
(persisted `m2k-board-orient-v1`, stacked default) re-flows the same ratio onto the other axis for
wide monitors. Layout-only — both panes stay mounted, resize via `flex-basis` (no remount), and
`SchematicEditor`/`Breadboard` props/internals are untouched. New styles live in
`components/Instrument.css` (theme variables only). Verified live: drag changes + persists the
ratio, reload restores `firstPaneBasis: 70%`/`flexDirection: column`, orientation toggles with no
remount errors, no console errors; **12-bit Spectrum floor still −104.29 dBFS**. Next ROADMAP
`TODO` in order is **F-4** (stretch DIP footprints) then **KICAD-1**. Full detail in the top log
entry below.

**SCH-9 (kit op-amp library) is DONE.** A new pure/tested `core/opamps.ts` holds the verified
ADALP2000 op-amp catalog (`op27 op37 op97 op482 op484 adtl082 ad8542`) with `opampList()` /
`getOpamp()` / `isKitOpamp()` and `buildOpampSubckt()` — a pure ngspice **level-1 macromodel**
emitter (transconductance → dominant-pole RC matched to GBW → slew-current limit → output clamped
to `[vee+headroom, vcc-headroom]`, so non-RR parts clip short of the rails and RR parts swing to
them). The schematic op-amp inspector is now a **kit dropdown** (mirrors SCH-10): off-kit op-amps
(e.g. the legacy `lmc662`) still load/simulate, show a **"⚠ not in your parts kit"** badge + a
one-click **Swap to OP484**; per-part gotchas surface as warnings — **OP37** decompensated (closed-
loop gain < 5), **AD8542** single-supply (its 5.5 V max < the M2K's ±5 V / 10 V rails). All five
amp examples migrated to the kit **OP484** (rail-to-rail, no over-supply warning); names/blurbs
updated `(LMC662)` → `(OP484)`. The standalone `inverting-amp-LMC662.json` lab file is **kept
off-kit on purpose** as the warning demonstrator (parallel to `rlc-bandpass`). Next ROADMAP `TODO`
is **KICAD-1** (stretch: KiCad netlist import). Full detail in the top log entry below.

**Flags:** (1) two files were touched **outside** the SCH-9 allowed set, each minimal and
documented in the log entry: `core/schematic.ts` (the `toCircuit` seam, to pass `part` through —
parallel to SWEEP-1 touching `netlist.ts`) and `core/netlist.ts` op-amp **card section only** (the
directive/element structure is untouched). (2) `src/components/Quickstart.tsx` has an **uncommitted
SWEEP-1 leftover** (Curve Tracer walkthrough) stranded in the working tree — *not* part of SCH-9,
left unstaged; it should be committed separately under SWEEP-1. *(Resolved: committed as `6c77d53`.)*

**SCH-10 (passives as kit values) is DONE.** A new pure/tested `core/kit.ts` holds the verified
ADALP2000 catalogs (R/C/L/pots) with `kitValues` / `isKitValue` / `nearestKitValue` / `formatValue`;
the schematic inspector's passive Value field is now a **kit dropdown** with a back-compat "not in
your parts kit" badge + one-click **snap to nearest** (off-kit values are never mutated on load).
`examples.ts` was audited so every passive is a kit value, **except** `rlc-bandpass`, kept
deliberately off-kit (100 mH inductor > kit's 10 mH max) as the warning demonstrator. No
`potentiometer` schematic component exists, so the picker covers R/C/L only (the pot catalog is
carried in kit.ts for a future phase).

**SWEEP-1 (hardware-faithful curve tracer) is DONE.** A new **Curve Tracer** instrument
(`components/CurveTracer.tsx` + `core/curvetracer.ts`) traces BJT/MOSFET output-characteristic
families by N stepped `.tran` passes (W1 sweeps Vds/Vce, W2 steps Vgs / Vbb→Ib, current via a sense
resistor) — no `.dc`, no new ngspice element. Two examples (`nmos-curve-family`, `bjt-curve-family`)
load and auto-open the tracer. The level-1 MOSFET `KP` was tuned (criterion 5) for a clean family.
Both **SCH-8 and SWEEP-1 are complete**, closing the transistor/curve-tracer pair. Natural
follow-ons (ROADMAP): **SCH-9** (kit op-amp library) and **SCH-10** (passives as kit values), both
breadth phases. The optional SWEEP-1 W2-staircase / single-acquisition mode was **not** built (the N
stepped passes route fully satisfies the spec); it remains an optional enhancement. Full detail in
the top log entry below.

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

### 2026-06-28 — SIG-1 settable ADC sample rate — DONE

**By:** Claude Code session
**Commit:** <this commit>

**What I did:**
- `components/SpectrumAnalyzer.tsx`: new **Acquisition (ADC)** section with an Fs preset dropdown
  (`FS_PRESETS = [5,10,20,50,100,200] kSa/s`, default 100). Selecting a rate calls a `setFs` that
  sets `samplingRate` on **both** channels (acquisition is one global rate; the scope reads
  `params.samplingRate` and so follows). Live **Fs / N / bin-width (= Fs/N) / Nyquist** readout, with
  `N` from the same `snapDuration` the FFT uses. Added `params2.samplingRate` to the persistence/avg
  buffer-reset effect deps (buffers already reset on `params.samplingRate`).
- `core/signal.ts`: **exported `snapDuration`** (plumbing) so the readout and tests compute `N`
  identically to `generateSignal`. **No protected math touched** — tau, the periodic window
  denominator, Bluestein, and the synthetic-noise model are byte-for-byte unchanged.
- `core/signal.test.ts` (new, 4 tests): the 12-bit canary at 100 kSa/s (N=1600, floor ≈ −104.29, no
  inter-harmonic leakage); zero leakage at **every** preset (1 kHz sine lands on an exact bin); the
  documented alias pair (6 kHz @ 10 kSa/s → exact bin 64 = 4 kHz); and binWidth = Fs/N tracking Fs.
- Scope capture path: confirmed it already derives Fs from `params.samplingRate`
  (`Oscilloscope.tsx` caps its capture `fs` at it; App passes `params.samplingRate` as `circuitFs`),
  so it honours the new control with **no change** to `Oscilloscope.tsx`/`App.tsx`.

**Verification (Definition of Done):**
- build clean: yes (`tsc && vite build`).
- npm test: 119/119 green (115 prior + 4 new).
- 12-bit spectrum floor at −104 dBFS confirmed: **yes — −104.29 dBFS** live (read off the Plotly
  "Floor (12-bit)" trace, 100 kSa/s default), signal path untouched.
- math sanity (live): aliasing 6 kHz @ 10 kSa/s → marker reads exactly 4.000 kHz; oversampling
  200 kSa/s → floor −107.30 dBFS (≈ −3 dB processing gain over 100 kSa/s); readout N=3200, bin 62.5 Hz.
- no console errors.

**State for the next session:**
- Fs is now a first-class acquisition control on the Spectrum (and the scope follows). The bin-landing
  invariant holds because every preset keeps `Fs/f` an integer for the 1 kHz demo, and the shipped
  alias pair (5/3 ratio, numPeriods a multiple of 3) lands exactly — `snapDuration`'s math was NOT
  changed (no LCM extension needed).
- **SIG-2 is the next Track I phase** (optional, default-OFF DAC quantization) — do not start without
  an explicit ask; it must keep the ADC canary clean.

**Open questions / flags for andre:**
- All SIG-1 changes are within the spec's allowed set. `README.md` has a small unrelated uncommitted
  course-agnostic edit (not mine), left untouched for you.

---

### 2026-06-28 — F-6 Breadboard-view layout controls — DONE

**By:** Claude Code session
**Commit:** <this commit>

**What I did:**
- Replaced the fixed 50/50 vertical stack in `App.tsx` (the `'breadboard'` case) with a **resizable
  split**: a thin themed `.board-splitter` between the SchematicEditor and Breadboard panes. Dragging
  it (pointer events on the divider → window `pointermove`/`pointerup`) sets the split ratio from the
  pointer's position within the container, clamped to 0.15–0.85 so neither pane collapses. A `resize`
  event fires on release so size-aware children re-measure.
- **Persistence:** new state `boardSplit` (ratio) + `boardOrient` (`'stacked' | 'side'`) with
  loaders + `useEffect` writers, mirroring the existing circuit/board autosave pattern. Keys
  `m2k-board-split-v1` and `m2k-board-orient-v1`. Restored on load; defaults 0.5 / `stacked`.
- **Orientation toggle** in a new `.board-layout-bar` strip: stacked (default, column — keeps the
  Track F transfer metaphor) ↔ side-by-side (row, for wide monitors). The same ratio drives whichever
  axis is active (`flexDirection` + the first pane's `flex-basis`). A "Reset split" button restores
  50/50.
- New CSS in `components/Instrument.css` (`.board-layout-bar`, `.board-layout-label`,
  `.board-orient-btn`, `.board-split`, `.board-splitter`) — all colors from existing theme variables
  (`--bg-panel`, `--bg-display`, `--border`, `--accent-blue`, `--text-*`). No new variable needed.
- Layout only: both panes stay mounted; resize is `flex-basis`/`flexDirection`, never a remount.
  SchematicEditor/Breadboard props and internals are untouched.

**Verification (Definition of Done):**
- build clean: yes (`tsc && vite build`, zero errors, no `any`/`@ts-ignore`).
- no console errors: yes (checked in the live dev server, normal use + drag + toggle + reload).
- 12-bit spectrum floor at −104 dBFS confirmed: **yes — −104.29 dBFS** (default square/1 kHz, Hanning,
  12-bit; read straight off the Plotly "Floor (12-bit)" trace; SNR ≈ 74 dB). Signal path untouched
  (`git diff` shows only `App.tsx` + `Instrument.css` + docs), so the canary is structurally safe and
  was confirmed live anyway.
- math sanity: n/a — no `core/` logic added (pure layout). Live behaviour verified instead: drag set
  `m2k-board-split-v1` 0.5 → 0.7 and persisted; reload restored `firstPaneBasis: 70%` /
  `flexDirection: column`; orientation toggled stacked↔side-by-side with no remount errors.

**State for the next session:**
- The Board view is now user-resizable + re-orientable, with the choice remembered. Defaults are
  unchanged for any existing user (stacked 50/50 until they touch the controls).
- A small harness note: the Chrome-automation `left_click_drag` emits **mouse**, not **pointer**,
  events, so it did not exercise the splitter; the drag was verified by dispatching real
  `PointerEvent`s (and the persisted ratio). Real mouse/touch input fires `pointerdown` normally.

**Open questions / flags for andre:**
- None. All changes are inside the F-6 allowed-files set (`App.tsx`, `Instrument.css`,
  `ROADMAP.md`, `PROGRESS.md`, the F-6 spec). `core/signal.ts` and the instrument math were not
  touched.

---

### 2026-06-28 — SCH-9 kit op-amp library — DONE

**By:** Claude Code session
**Commit:** <this commit>

**What I did:**
- New `core/opamps.ts` (pure, no React/DOM/engine): `OpampKind` union + `KIT_OPAMPS` catalog for the
  7 verified ADALP2000 op-amps (`op27 op37 op97 op482 op484 adtl082 ad8542`) with datasheet params in
  SI base units (gbwHz, slewRate V/µs, vosTyp, supplyMin/Max, railToRailIn/Out, outputHeadroom,
  package, channels, count, note). Exposes `opampList()`, `getOpamp()`, `isKitOpamp()` (type guard),
  and `buildOpampSubckt(part)` — a pure string emitter for a level-1 macromodel (SAME fidelity tier as
  SWEEP-1's level-1 MOSFET cards): `Bg` transconductance (gm=1e-3) hard-limited to ±Imax →
  dominant-pole node (`Rp=Aol/gm`, `Cp=gm/2πgbw`, so `Imax=slew·Cp` sets the slew rate and the RC sets
  GBW) → `Bo` output clamp to `[V(vee)+headroom, V(vcc)-headroom]`. RR parts get ~0.02 V headroom;
  standard parts 1–2 V so they clip short of the rails.
- New `core/opamps.test.ts`: catalog params, `isKitOpamp` true/false, well-formed `.subckt … .ends`
  with a rail-referenced clamp, **plus an end-to-end engine run** — inverting gain −10 (0.2 V → ±2 V),
  and at 1 V drive (ideal ±10 V) the RR OP484 swings > 4.5 V while non-RR OP27 clips < 4.0 V (> 2 V,
  i.e. a real clipped swing) and OP484 beats OP27 by > 1 V. All 115 tests pass.
- `netlist.ts` (op-amp **card section only**, allowed): `OpAmp.part?: OpampKind`; when a kit `part` is
  set, emit an `X<id> inp inn vcc vee out <kind>` instance (synthesizing per-instance `Vvcc/Vvee` ±5 V
  sources when the 3-pin symbol has no wired rails — the auto ±5 V fallback) and one `.subckt` per used
  kind before the analysis directive; no kit `part` → unchanged legacy `opampLines` (the lmc662
  behavioural model). **The Analysis union and the directive/element structure are untouched.**
- Op-amp inspector (`SchematicEditor.tsx`): kit dropdown from `opampList()` (name + package); DEFAULT
  op-amp part is now `op484`. Off-kit op-amp → `__off` "LMC662 — not in kit" option + "⚠ not in your
  parts kit" badge + **Swap to OP484** button (mirrors SCH-10). Added `opampNoiseGain()` (reads
  resistors on the inN net via `computeNets` → 1+Rf/Rg; unity-follower → 1; feedback-only → ∞; null if
  unrecognised) to fire the **OP37 gain-< 5** warning; **AD8542 over-supply** warning when
  `10 > supplyMax`.
- `examples.ts`: all five amp examples migrated to `part: 'op484'`; names `(LMC662)` → `(OP484)`,
  blurbs now say "Kit OP484 (rail-to-rail) … Buildable on the breadboard as a DIP" (the breadboard
  maps any op-amp section to a generic 8-pin DIP footprint regardless of kit part, so "a DIP" avoids
  conflicting with the inspector's "14-DIP" label). `rlc-bandpass` stays the off-kit passive demo.

**Verification (Definition of Done):**
- build clean: yes (`tsc && vite build`).
- npm test: 115/115 green, incl. the new engine round-trip (gain + RR/non-RR clipping).
- 12-bit spectrum floor at −104 dBFS confirmed: yes — `core/signal.ts` and the FFT path are byte-for-
  byte untouched (`git diff src/core/signal.ts` empty), so the canary holds (last measured −104.29).
- math sanity (engine): inverting −10 → ±2.0 V exact; OP484 (RR) ±~5 V to the rail; OP27 (non-RR)
  clips ~±3 V (2 V headroom). Live in Chrome: dropdown shows all 7 kit parts with packages, part-info
  line renders, and the AD8542 single-supply over-supply warning fires. (OP37-gain-<5 and the off-kit
  badge/swap are build-validated conditionals structurally identical to the verified over-supply one;
  canvas component-selection via synthetic DOM events is unreliable while the sim/rAF loop runs — a
  known Chrome-automation limitation, not a code issue.)

**State for the next session:**
- Op-amps now follow the SCH-8/SCH-10 kit pattern: catalog + level-1 macromodel + kit-dropdown UI.
  A schematic op-amp carries an optional `part: OpampKind`; absent → legacy lmc662 model (off-kit).
- Decision (documented): the standalone `inverting-amp-LMC662.json` lab file is **kept off-kit on
  purpose** as the warning demonstrator. Every dropdown example is now kit (OP484); the only
  deliberate off-kit demos are `rlc-bandpass` (SCH-10) and that JSON.
- Out of scope per spec (deferred): AD8226 in-amp + LTC1541 (specialty phase); vendor SPICE-model
  import (optional enhancement).

**Open questions / flags for andre:**
- Two files touched outside the SCH-9 allowed set, each minimal: `core/schematic.ts` (the `toCircuit`
  seam — pass `part` through to the netlist Circuit; parallel to SWEEP-1 touching `netlist.ts`) and
  `core/netlist.ts` (op-amp model-card section only — the directive/element structure is untouched).
- `src/components/Quickstart.tsx` has an **uncommitted SWEEP-1 leftover** (Curve Tracer walkthrough)
  that was never staged in the SWEEP-1 commit. I left it **unstaged** (out of scope for SCH-9); it
  should be committed separately under SWEEP-1.

---

### 2026-06-28 — SCH-10 passives as ADALP2000 kit values — DONE

**By:** Claude Code session
**Commit:** uncommitted

**What I did:**
- `core/kit.ts` (new, pure/tested): the verified ADALP2000 catalogs as typed constants in SI base
  units — resistors (20 × 1/4 W, 1.1 Ω…5 MΩ), capacitors (13, 39 pF…220 µF), inductors (5 Coilcraft
  RFB0807, 1 µH…10 mH with part numbers), potentiometers (5/10/50 kΩ). Helpers: `kitValues(kind)`,
  `isKitValue(kind,value)` (0.5% relative tolerance), `nearestKitValue(kind,value)` (snap on LOG
  distance so cross-decade is correct), `formatValue(kind,value)` (single source of engineering-unit
  rendering; catalog labels are generated from it). The 6.2 Ω 10 W power resistor is exported
  separately (`POWER_RESISTOR`) and kept OUT of the pick list / isKitValue / nearestKitValue so a
  1/4 W resistor is never auto-snapped to it.
- `core/kit.test.ts` (new, 10 tests): catalog exactness (values/counts/part numbers), power-resistor
  exclusion, `isKitValue` member-vs-near-miss + tolerance band, `nearestKitValue` cross-decade snaps
  (1.2 kΩ→1 kΩ, 3 kΩ→2.2 kΩ, 1.3 kΩ→1.5 kΩ, 100 mH→10 mH), `formatValue` units (pF/nF/µF, Ω/kΩ/MΩ,
  µH/mH), and that every catalog label equals `formatValue`.
- `components/SchematicEditor.tsx` (the passive inspector): the R/C/L Value field is now a dropdown
  populated from `kitValues`. A loaded off-kit value is NOT mutated — it shows as a flagged
  `<value> — not in kit` option plus a "⚠ not in your parts kit" badge and a "Snap to <nearest>"
  button (snapshots for undo, then sets the kit value). LED/Zener/dcrail keep the free numeric input
  (not kit passives). The JSON data model is unchanged (still SI base units).
- `core/examples.ts`: audited every passive to a kit value — fixed `rc-lp`/`rc-hp` (1.6 kΩ→1.5 kΩ),
  `inv-amp` (Rf 22 kΩ→20 kΩ, renamed ×−2.2→×−2), `integrator` (Rf 22 kΩ→20 kΩ, ~70→~80 Hz corner),
  `diode-iv`/`zener-iv` sense R (220 Ω→470 Ω; sense voltage = Vin−Vf is independent of R, so the I-V
  curve is unchanged). Kept `rlc-bandpass` deliberately off-kit (100 mH inductor, above the kit's
  10 mH max) as the warning demonstrator and noted it in the blurb. The mounted
  `inverting-amp-LMC662.json` already complied (1 kΩ / 10 kΩ), unchanged.

**Verification (Definition of Done):**
- build clean: YES — `npm run build` (`tsc && vite build`) clean.
- tests: `npm test -- --run` → **110 passed** (9 files; +10 new kit tests).
- live app (dev server + Chrome): R1 (100 Ω) inspector shows the 20-value kit dropdown with "100 Ω"
  selected, no 6.2 Ω entry, no badge; loading `rlc-bandpass` flags L1 "⚠ not in your parts kit" with
  "Snap to 10 mH" → clicking it set L1 to 0.01 H, badge cleared, canvas relabelled "10mH"; `inv-amp`
  loaded with Rin 10 kΩ / Rf 20 kΩ; **no console errors**.
- 12-bit canary: confirmed in the running Spectrum Analyzer — floor line at **−104.29 dBFS**
  (identical to SWEEP-1). `core/signal.ts` and the FFT path were not touched.

**Files outside the suggested allowed set:** none beyond what the spec already listed. The "passive
inspector component" is `components/SchematicEditor.tsx` (it hosts the property panel) — within scope.

**State for the next session:**
- `formatValue` in `core/kit.ts` is now a second engineering-unit formatter alongside `fmtEng` in
  `core/units.ts`; kit labels use the former (with the "µ"/space/unit style the spec wanted), the
  canvas part labels still use `fmtEng`. Fine as-is; could be unified later if desired.
- The ROADMAP SCH-10 row also mentioned pot/thermistor/electrolytic *components* and a "nearest kit
  value" snap on free entry. Per the provided `SCH-10-spec.md` (value availability for R/C/L/pot
  only), this phase delivered the catalog + snap + kit picker. Adding actual potentiometer /
  thermistor / polarized-electrolytic schematic components needs `schematic.ts` (terminals, toCircuit,
  symbols) and is a separate phase, not done here. The pot catalog is ready in kit.ts for it.
- Next ROADMAP `TODO`: **KICAD-1** (stretch, KiCad netlist import).

**Open questions / flags for andre:**
- `rlc-bandpass` is intentionally the one off-kit example (100 mH inductor) so the "not in your parts
  kit" warning is demonstrable from a shipped example. Say if you'd rather make it kit-buildable
  (would change its Q/framing) or drop the example.

### 2026-06-28 — SWEEP-1 parametric curve tracer (W1 sweep + W2 step + scope XY) — DONE

**By:** Claude Code session
**Commit:** uncommitted

**What I did:**
- `core/curvetracer.ts` (new, pure/testable): `identifyTracer` (finds the BJT/MOSFET + W1 + W2 +
  emitter/source sense resistor in a `Circuit`), `buildTracerCircuit` (one stepped pass — W1 → a
  triangle ramp over the swept range, W2 → a constant DC step), `tracerAnalysis` (the `.tran`
  directive), and `extractCurve` (Vds/Vce = V(high)−V(sense); current = V(sense)/Rsense — the diode
  I-V sense-resistor trick). Runs entirely on the EXISTING `.tran` path; the `Analysis` union and
  `netlist.ts` analysis directives are unchanged (no `.dc`, no new element).
- `components/CurveTracer.tsx` (new instrument): own SPICE worker (mirrors NetworkAnalyzer), runs N
  stepped passes, overlays the labelled family with Plotly (dark theme, `displayModeBar:false`,
  `Plotly.react`), debounced auto-run; settings = Vds/Vce max, ramp time, and the step list
  (start/increment/count). Reads the active `drawn.circuit`; shows a "draw a transistor stage" hint
  when the circuit isn't traceable.
- `App.tsx`: nav button + `renderPanel` case `'curvetracer'`; examples with `tracer:true` open it
  (both the Quickstart `loadExample` path and the Circuit editor dropdown via a new `onOpenTracer`
  prop on `SchematicEditor`).
- `core/examples.ts`: `nmos-curve-family` (ZVN2110A, W2→gate, 10 Ω sense) and `bjt-curve-family`
  (2N3904, W2→100 kΩ base resistor→base, 100 Ω emitter sense) — both `tracer:true`. Added the
  `tracer?` field; re-framed `nmos-output-xy` Volts/div for the retuned model.
- `core/netlist.ts` (criterion 5): tuned the level-1 MOSFET kit cards — `ZVN2110A`/`ZVN3310A`/
  `ZVP2110A` from `KP=0.15/0.05` to **`KP=0.005 LAMBDA=0.02`**. KP=0.15 ran the device hard-on (drain
  to ~0, flat curves); KP≈5 mA/V² gives a textbook triode→saturation family at M2K scales. (Note:
  netlist.ts isn't in the SWEEP-1 allowed-files list, but criterion 5 explicitly mandates this model
  tuning and the user authorized it; only the model param strings changed — no analysis/element
  changes, so the "directives unchanged" constraint holds.)
- `core/curvetracer.test.ts` (new, 5 tests): identify MOSFET + BJT setups, assert W1=PULSE/W2=bare-DC
  in the built netlist, and an end-to-end engine run proving the MOSFET family is separated, rises
  with Vgs, and saturates.

**How the model was tuned:** ran the real `eecircuit-engine` headless in Node (the same engine the
tests use) to sweep KP and pick the value giving a clean, well-separated family at ±5 V / few-mA with
visible knees. Verified the exact `.tran` path (incl. the 49.9 Ω AWG output impedance + triangle
ramp) reproduces it before committing.

**Verification (Definition of Done):**
- build clean: YES — `npm run build` (`tsc && vite build`) clean.
- tests: `npm test -- --run` → **100 passed** (8 files; +5 new curve-tracer tests).
- live app (dev server + Chrome): loaded **MOSFET curve family** → Curve Tracer auto-opened and drew
  5 separated Id-vs-Vds curves (Vgs 2…4 V), triode→saturation, Y-axis 0–15.7 mA, **no console
  errors**; **BJT curve family** drew "NPN Ic-vs-Vce", 5 curves (Vbb 1…3 V), Ic≤2.79 mA.
- 12-bit canary: confirmed in the running Spectrum Analyzer — floor line at **−104.29 dBFS**, SNR ≈
  74 dB (12-bit), clean odd harmonics with no inter-harmonic leakage. `core/signal.ts` and the FFT
  path were not touched.

**State for the next session:**
- The Curve Tracer primitive (W1 sweep + W2 step + scope-XY-via-Rsense on the `.tran` path) is also
  the M1K/ALICE curve-tracer primitive, so it is groundwork for a future device twin.
- The optional bench-literal **W2-staircase / single-acquisition** mode (spec §"Engine path", option
  2) was deliberately not built — the N stepped-pass route meets every acceptance item. If wanted, it
  needs a staircase waveform on W2 + XY persistence.
- Model fidelity: the kit MOSFET cards are level-1 approximations tuned for clean teaching curves, not
  datasheet-exact; swap in manufacturer cards if higher fidelity is ever needed. BJT (2N3904) cards
  were already clean — only the MOSFETs were retuned.

**Open questions / flags for andre:**
- Curve Tracer identifies the device/sense-R/W1/W2 from the drawn circuit by topology (transistor +
  a resistor from source/emitter to ground + sources W1/W2). It works for the shipped examples and
  any circuit following that pattern; an unusual sense placement would read as "not traceable."

### 2026-06-28 — SCH-8 transistor parts — Breadboard TO-92 UI — DONE (SCH-8 complete)

**By:** Claude Code session
**Commit:** uncommitted

**What I did:**
- `components/Breadboard.tsx`: finished the one remaining SCH-8 slice — the TO-92 render +
  drag-placement UI, mirroring the existing DIP path:
  - New `placeTransistor` Tool variant + a placement handler in `onNode` (anchor on a `TO92_ROW`
    hole with two more columns to the right; rejects an out-of-range column with a hint).
  - SVG render of placed transistors: three leads from the leg holes up into a flat-front /
    rounded-back TO-92 package, each leg coloured by its live net (Practice/revealed) and tagged with
    its package-face leg label (BJT C-B-E, MOSFET D-G-S) via `to92Legend`; click-to-delete in Select.
  - "Place from schematic" chips now list `exp.transistors` ("(TO-92)"); the empty-state guard and
    `activeColor` net set both account for transistors; Clear and both `openLab` resets seed
    `transistors: []`; saved labs already round-trip `board.transistors` (whole-board serialize).
  - A "TO-92 pinout" side-panel legend (package-face order, with a "no supply pins" note) appears when
    the schematic has a transistor, alongside the existing LMC662/INA125 legends.
- No `core/` change this session — `breadboard.ts` already had `to92PinHoles`/`to92Legend`/
  `PlacedTransistor`/`BoardLayout.transistors`/`checkEquivalence` from the prior SCH-8 entry, so this
  was purely the component layer.

**Verification (Definition of Done):**
- build clean: YES — `npm run build` (`tsc && vite build`) clean on host, 40 modules transformed.
- tests: `npm test -- --run` → 95 passed (7 files). No new core logic, so no new test needed; the
  existing `breadboard.test.ts` transistor-equivalence coverage stands.
- 12-bit canary: `core/signal.ts` and the FFT path were NOT touched (only `Breadboard.tsx` + docs), so
  the spectrum floor is unaffected — canary holds by construction.

**State for the next session:**
- A BJT/MOSFET now transfers schematic → board: pick the chip, drop its left leg on a row-`b` hole,
  the three legs fill adjacent columns in schematic-terminal order, and Check maps them. SCH-8 is
  complete; **SWEEP-1** is the next phase.
- Inherited open item for SWEEP-1: the level-1 MOSFET `KP` / `nmos-output-xy` operating point still run
  the device hard-on, so the curve-tracer seed needs tuning when SWEEP-1 builds the family.

**Open questions / flags for andre:**
- TO-92 legs sit in one term row (`TO92_ROW = 'b'`), three adjacent isolated columns — a discrete
  transistor bridges three nets and (unlike a DIP) does not straddle the channel. Confirm that bank
  placement reads naturally on the board; trivial to move to another term row if preferred.

### 2026-06-28 — SCH-8 transistor parts (BJT/MOSFET) — PARTIAL (schematic/sim/parts done; board UI + host build pending)

**By:** Cowork session
**Commit:** uncommitted

**What I did:**
- `core/netlist.ts`: new `BJT` and `MOSFET` `Component` types + emission, mirroring the diode path.
  BJT → `Q<id> c b e QM<id>` + `.model QM<id> NPN|PNP(...)`; MOSFET → `M<id> d g s s MM<id>` (bulk
  tied to source for a discrete TO-92) + `.model MM<id> NMOS|PMOS(...)`. Added `TRANSISTOR_PARTS`
  (ADALP2000 kit: 2N3904/2N3903 NPN, 2N3906 PNP, ZVN2110A/ZVN3310A NMOS, ZVP2110A PMOS) as
  (type + ngspice `.model` body) pairs, plus generic fallback bodies.
- `core/schematic.ts`: `bjt`/`mosfet` `SchKind`, 3-terminal `baseTerminals` (c/b/e, d/g/s), a `part`
  field on `SchComponent`, and `toCircuit` mapping that resolves the part name → polarity/channel +
  model body.
- `components/SchematicEditor.tsx`: BJT/MOSFET palette tools, refdes Q/M, a default part on place, a
  Part dropdown in the Selected panel (filtered by kind), and the BJT/MOSFET symbol drawing
  (emitter/source arrow flips with NPN/PNP, N/P).
- `core/breadboard.ts`: TO-92 3-lead footprint core — `TO92_KINDS`, `to92PinHoles`, `to92Legend`,
  `PlacedTransistor`, `transistors` in `BoardLayout`/`SchematicExpectation`, and the `checkEquivalence`
  path (placement + per-leg net mapping). Legs sit in three adjacent columns of one bank.
- `core/examples.ts`: `nmos-output-xy` — a ZVN2110A with gate at V+, W1 sweeping the drain, scope XY
  through a sense resistor (one Vgs output curve; the SWEEP-1 seed).
- Tests: `netlist.test.ts` (BJT/MOSFET emission + an NMOS `.op` that confirms the cards run in
  ngspice), `schematic.test.ts` (toCircuit part resolution).

**Verification (Definition of Done):**
- build clean: YES on host — `npm run build` (`tsc && vite build`) passed, 40 modules transformed.
  (Note: the Cowork sandbox mount tears Edit-modified source files, so the build/tests were run on the
  host instead. The sandbox is unreliable for builds in this project — same class of issue as the
  SPICE-1 entry's "vite build could not run in the Linux sandbox".)
- tests: `npm test` — the new transistor netlist tests pass (BJT/MOSFET emission + an NMOS `.op` that
  runs in ngspice). Independent check also confirmed both `.model QM1 NPN(... BF=300 ...)` (2N3904) and
  `.model MM1 NMOS(VTO=1.5 KP=0.15 LAMBDA=0.01)` (ZVN2110A) parse and converge (v(drain)=0.0095 V,
  v(coll)=0.039 V, devices hard on).
- 12-bit canary: `core/signal.ts` was NOT touched, so the spectrum floor is unaffected.
- **Pre-existing test issues surfaced by the run (NOT from SCH-8) — both fixed:** (1) `schematic.test.ts`
  had a duplicate import (`moveComponentWithWires`/`attachedWireEnds`/`computeNets` declared at two
  import lines) present at HEAD; tolerated by the old esbuild transform, rejected by vite 8's oxc.
  Deduped so the file (and the new transistor toCircuit test) loads. (2) `breadboard.test.ts` had 3
  failing RC equivalence tests because `correctBoard` used the old ports-at-holes model with no
  jumpers, while F-5's `checkEquivalence` anchors on the fixed M2K terminals and ignores `board.ports`
  holes. Rewrote `correctBoard` (and the short/split tests) to jumper from the fixed terminals
  (`PORT_TERMINAL[...]`), matching how Breadboard.tsx wires them. These were red at HEAD too; now green.

**State for the next session:**
- SCH-8's schematic → toCircuit → netlist → sim path for transistors is complete and logic-verified;
  you can place a BJT/MOSFET, pick a kit part, and simulate. This is enough for SWEEP-1 to build on.
- Remaining SCH-8 slice: `components/Breadboard.tsx` rendering + drag-placement of the TO-92 (the
  `breadboard.ts` model already supports it; this is the UI half, mirroring the DIP render). Until that
  lands, SCH-8 is IN PROGRESS, not DONE.
- Model fidelity: the level-1 MOSFET params run "strong" (KP=0.15 pulls the drain near 0 when hard on),
  and BJT BF drives saturation easily. Fine electrically, but tune KP / example operating points on a
  host sim for clean-looking curves (the `nmos-output-xy` example especially).

**Open questions / flags for andre:**
- OK to finish the Breadboard.tsx TO-92 UI next session, then flip SCH-8 to DONE? Or split it out as a
  small F-phase like the DIP render was.
- The transistor `.model` cards are representative (standard 2N390x; level-1 MOSFET approximations).
  Swap in manufacturer cards if you want higher fidelity (the spec notes this).

### 2026-06-27 — Quickstart QS-3: "Draw your first circuit (supply rails)" — DONE

**By:** Cowork session (andre, for the EEC1 lab rewrite)
**Commit:** uncommitted

**What I did:** added an 8-step *draw-from-scratch* guided sequence to `Quickstart.tsx`, placed after
the single-ended/differential section and before the divider walkthrough. It walks: open editor →
place V+/V−/GND → place 1±/2± → wire single-ended (junction dots confirm) → set Power Supply → read
Voltmeter → rewire 1− to V− for differential → Export PNG. Anchor `id="draw-first-circuit"` added.

**Verification gate (the lab agent asked):**
- A bare rails+probes circuit (V+, V−, GND, four probe markers, **no load resistor**) was simulated
  via toCircuit → applySupplyRails → buildNetlist(`.op`) → ngspice. It **solves cleanly**: single-ended
  reads Ch1=+5, Ch2=−5; differential reads Ch1=+10 (V+−V−), Ch2=−5. The dcrail sources to ground
  define every node, so **no floating-node/singular-matrix issue and no bleeder resistor is needed.**
- Voltmeter Export PNG already prints title + per-channel labels — no change needed (confirmed).

**Correction vs the spec the agent sent:** step 7 ("make CH1 differential") cannot be a literal
"drag the 1− probe onto V−" — with auto-wire rubber-banding, the probe's wire to GND follows it and
would short GND to V−. The correct (and bench-accurate) move is delete the 1−→GND wire, then wire
1−→V−. The step is written that way.

**Notes:** kept the in-app copy general (no "Lab 1"/figure numbers) per the standing instruction; the
lab doc can point at it via the anchor or "open Quickstart → Draw your first circuit". tsc clean; no
core/signal.ts touched.

---

### 2026-06-27 — Export PNG on every instrument (gen/scope/spectrum/network/voltmeter) — DONE

**By:** Cowork session (andre)
**Commit:** uncommitted

**What I did:** added a top-header "Export PNG" button (same style as the circuit/board Save) to all
instruments, all routed through the shared native Save dialog (`savePngBlob`, now exported).
- `exportImage.ts`: added `exportPlotlyToPng(gd, filename)` (Plotly.toImage at 2x on the dark
  --bg-display, WYSIWYG) and `exportPlotlyPairToPng(gds, filename)` (stacks magnitude+phase into one
  PNG). Exposed `savePngBlob`. (`setBackground` is a real Plotly option missing from the typings →
  small `ToImgOpts` cast.)
- Buttons: SignalGenerator → `signal-generator.png`, Oscilloscope → `oscilloscope.png`,
  SpectrumAnalyzer → `spectrum.png`, NetworkAnalyzer → `bode.png` (mag+phase stacked).
- Voltmeter has no plot, so it draws its two readings onto a white canvas and saves `voltmeter.png`
  via `savePngBlob`.

**Verification (Definition of Done):**
- tsc --noEmit clean: yes. 12-bit floor untouched: yes.
- Background choice: instrument plots export on their own dark background (look like a scope screen);
  the schematic/board stay white paper figures. Voltmeter readout is white. (Flag if you want the
  plots on white too — needs a Plotly light-theme recolor, not just a bg swap.)

---

### 2026-06-27 — Fix: single view shows a half-width plot after leaving a split layout — DONE

**By:** Cowork session (andre)
**Commit:** uncommitted

**What I did:**
- Bug (andre): pick a Layouts preset (split), then go back to a single instrument → the plot only
  fills part of the panel. Cause: Plotly charts use `responsive: true`, which re-fits only on a
  window `resize` event. Switching layout resizes the container via React state with no resize event,
  so the chart keeps its old split-view width.
- Fix in `App.tsx`: a `useEffect` on `[active, presetId]` dispatches `window.dispatchEvent(new
  Event('resize'))` after a double rAF (so the new layout has painted). All responsive Plotly charts
  then re-fit. SVG views (schematic/board) already scale, so they were unaffected.

**Verification (Definition of Done):**
- tsc --noEmit clean: yes. 12-bit floor untouched: yes.
- Logic: covers every layout transition (single↔preset, preset↔preset) since both deps drive it.

---

### 2026-06-27 — EDIT-2: touch-connections auto-wire on move + junction dots — DONE

**By:** Cowork session (andre)
**Commit:** uncommitted

**What I did (chosen approach #1 of the design options):** make touch-to-connect safe and visible so
students never hit the silent-disconnect trap.
- `schematic.ts`: new `bridgeWiresForMove(s, movedIds, dgx, dgy)` — for each moved terminal whose old
  point also holds a *stationary* component terminal, emit a wire bridging that point to the new
  location. Called from `moveComponentWithWires`, `moveComponentsBy`, `moveSelectionBy`. Net effect:
  dragging a part rubber-bands any touch-connection into a real, visible wire instead of snapping it.
- `SchematicEditor.tsx`: junction dots — a filled dot wherever 2+ pins butt together or 3+ pins/wires
  meet, so "connected here" is always visible (standard schematic convention; teaches the node model).
- `Quickstart.tsx`: short note that a dot marks a connected node and that wires (or touching) connect,
  and dragging keeps the link.
- Tests: added a `schematic.test.ts` block (touch-connection preserved on drag; group bridge only to
  stationary terminals; zero-move adds nothing). Verified via tsx (4/4).

**Verification (Definition of Done):**
- tsc --noEmit clean: yes
- bridge logic tested; existing moveComponentsBy/moveSelectionBy tests still hold (no stationary
  foreign terminals in those → no spurious bridges): yes
- 12-bit floor untouched (no core/signal.ts): yes

**State for the next session:**
- Touch-connection is now a first-class, safe workflow: it shows a junction dot and survives moves.
  To disconnect, delete the bridging wire. Rotation (`rotateComponentWithWires`) does NOT yet bridge
  touch-connections — left as-is (rare; parts are usually rotated before wiring). Add later if needed.

---

### 2026-06-27 — Fix: examples broke connections when a part was dragged — DONE

**By:** Cowork session (andre)
**Commit:** uncommitted

**What I did:**
- Bug (andre): load the voltage divider, drag R2 → it disconnects; dragging R1 keeps its wires.
  Root cause: EDIT-1's move only carries *explicit* wire endpoints sitting on a moved part's
  terminals. Connections made by **coincidence** (two legs sharing a grid point with no wire) snap on
  move. R1 had wires on both legs; R2's links (R1.b↔R2.a, R2.b↔ground) were coincidence-only.
- Wrote a coincidence audit (`terminalsOf` + wire endpoints) and found the same fragile pattern in 8
  more examples (mostly a shunt leg sitting directly on the ground symbol; plus the rlc series L–C
  junction). Fixed every one by spreading the parts a slot apart and adding an explicit wire (moved
  the ground down a row, added "leg → ground" wires; relaid the divider and rlc-bandpass).
- Now every example connection is an explicit wire, so dragging any part keeps its connections.

**Verification (Definition of Done):**
- Coincidence audit: 0 fragile connections remain (was 9 examples).
- `computeNets` on the relaid divider and rlc-bandpass: nets unchanged (divider = V+/midpoint/gnd;
  rlc = series L-C-R, output across R). Electrically identical.
- tsc --noEmit clean: yes. 12-bit floor untouched: yes.

**State for the next session:**
- Authoring rule: never rely on two component terminals coinciding at one grid point — always join
  them with an explicit wire (and keep a 1-cell gap), or the connection breaks when a student drags
  the part. The audit script logic lives in this entry if it needs to be re-run.

---

### 2026-06-27 — Prelab image export: schematic + board → PNG — DONE

**By:** Cowork session (andre)
**Commit:** uncommitted

**What I did:**
- New `src/components/exportImage.ts`: `exportSvgToPng(svg, filename, scale=2)`. Clones the live SVG,
  inlines each element's *computed* paint (resolves the theme CSS variables to rgb; skips `url(...)`
  pattern/gradient refs so the grid-dot pattern still works), rasterizes at 2x on a canvas, downloads
  a **transparent** PNG. No dependencies; pure browser DOM/canvas.
- "Export PNG" button per view, both in the **top header** (parallel): SchematicEditor header
  (→ `schematic.png`) and Breadboard header next to Save/Open (→ `breadboard.png`), each using the
  component's `svgRef`. Errors surface in that view's status line.
- Decisions (andre): PNG, **white background with dark-ink remap** (`light: true`), one button per
  view. `light` inverts each paint colour's HSL lightness (bg #0d0d0d→#f2f2f2, text #d4d4d4→#2b2b2b,
  CH1 orange→darker orange, V+/V− red/blue→darker, etc.), drops the grid pattern, and fills the
  canvas white — a clean paper figure for Gradescope/Word. Captures full board via its viewBox;
  schematic via its rendered box (no viewBox).

**Verification (Definition of Done):**
- tsc --noEmit clean: yes
- Canvas is untainted (these SVGs reference no external images), so `toDataURL` succeeds: yes
- 12-bit floor untouched: yes (no core/signal.ts)

**State for the next session:**
- Single export util is reusable for any on-screen SVG (e.g. could add a scope/spectrum export later).
- Transparent means dark-theme light strokes can wash out on a white page; if students report that,
  flip the button to a dark or white baked background (one line: pre-fill the canvas before drawImage).

---

### 2026-06-27 — Polish: example naming, resistor lead spacing, supply-wire colour — DONE

**By:** Cowork session (andre)
**Commit:** uncommitted

**What I did:**
- `examples.ts`: made all op-amp examples name the chip consistently — integrator, differentiator,
  and summing now read "(LMC662)" (were "(op-amp)" / unlabelled) with blurbs matching inv/noninv
  ("LMC662 op-amp on ±5 V rails … 8-pin DIP"). They already used `kind: 'opamp'` (= LMC662).
- `Breadboard.tsx`: resistor placement now enforces a minimum lead span. A ¼ W axial resistor spans
  ~5 holes (0.5") and bends to ~4 at the tightest, so `MIN_RESISTOR_HOLES = 4`; placing the 2nd leg
  closer than that is rejected with a hint and the 1st leg stays pending. Span = Euclidean hole
  distance (handles channel-straddle and diagonals). Resistor-only (small film caps legitimately
  span 2 holes).
- `Breadboard.tsx`: `wireColor` now colours ANY jumper sitting on the V+/V−/GND net (via `supplyOf`),
  not just ones with an endpoint on a fixed terminal — so a jumper daisy-chained off a rail shows the
  rail's colour.

**Verification (Definition of Done):**
- tsc --noEmit clean: yes
- 12-bit floor untouched (no core/signal.ts): yes

**State for the next session:**
- `MIN_RESISTOR_HOLES` is the single knob for the spacing floor (currently 4; bump to 5 for the strict
  nominal). Rule is resistor-only; extend to other leaded parts by widening the `partKind` guard.

---

### 2026-06-27 — SCH-7b INA125 auxiliary-pin straps (Lab 8 Fig 1) — DONE

**By:** Cowork session (andre)
**Commit:** uncommitted

**What I did:**
- Read Lab 8 Fig 1 (`INA125_complete-1.png`) directly. Confirmed the datasheet-mandated chip wiring
  the real INA125 needs to function: SLEEP(2)→V+, VREFout(4)→VREF2.5(14), IAref(5)→GND,
  Sense(11)→Vo(10), VREFcom(12)→GND (plus V+/V− on the rails).
- `breadboard.ts`: added an optional `straps` field to the DIP expectation (pin → another pin or a
  supply rail, with a student-facing label). The INA125 expectation now emits those five straps;
  IAref moved off the schematic pinNets onto a strap (so the abstract symbol need not expose it).
  `checkEquivalence` verifies each strap after the rails check and returns a per-strap hint.
- `Breadboard.tsx`: INA125 pinout legend now splits **Signal** wiring from **Required strapping**
  (gold heading) and notes the Check enforces each one.
- Tests: added an INA125 strap block to `breadboard.test.ts` (full-strap pass + missing
  Sense/VREFout/SLEEP flags). Verified via standalone tsx run — 5/5 pass.
- Fixed a stale pin number in `docs/specs/ina125.md` (VREFCOM is pin 12, not 11) and documented the
  strap table.

**Verification (Definition of Done):**
- tsc --noEmit clean (rename-busted the mounted files first): yes
- vitest can't run in this sandbox (rolldown native binding missing) — ran the equivalence assertions
  via `npx tsx`: full strap ok; each missing strap flagged with the right message.
- 12-bit floor untouched (no `core/signal.ts` change): yes

**State for the next session:**
- Board Check now requires the full INA125 strapping, matching Lab 8 Prelab Deliverable #5 ("label/
  wire every pin"). The schematic symbol stays abstract (functional pins only); the physical-build
  realism lives on the board.
- The strap mechanism is generic — any future DIP can declare `straps` the same way.

**Open questions / flags for andre:**
- Bridge excitation: Fig 1 drives the Wheatstone bridge from the VREF2.5 node. The app models the
  source/divider abstractly, so the bridge itself isn't required on the board Check — only the chip
  straps. Say if you want a bridge-excitation example added.

---

### 2026-06-27 — SCH-7 INA125 instrumentation amp (only in-amp) — DONE

**By:** Cowork session (andre)
**Commit:** uncommitted

**What I did:**
- Replaced the package-less `inamp`/`inamp3` with a single real `ina125` kind (schematic.ts SchKind,
  baseTerminals: VIN+/VIN−/VO/RG×2/IAREF; ampCategory 'build'). toCircuit expands an INA125 into a
  **structural** 3-op-amp model reusing the op-amp + resistor emission: first-stage feedback 7.5 kΩ
  each + diff amp 10k/40k ⇒ G = 4 + 60 kΩ/R_G, with the external R_G across the RG pins. Verified in
  ngspice: G = 4 (open), 10 (10 kΩ), 50.15 (1.3 kΩ), 100 (625 Ω); the example sims at G=10 exactly.
- Editor: INA125 toolbar tool + symbol render + selected-panel note; dropped the in-amp sub-selector
  and `setSelInampType`. units.ts/DEFAULT_VALUE/REFDES updated.
- Breadboard: INA125 boards as a **16-pin DIP** (`dipCols('ina125')=8`); schematicExpectation maps its
  used pins to the datasheet pinout; Check requires V+ (pin1)/V− (pin3) on the rails (per-part `rails`
  indices, replacing the hardcoded LMC662 pins). DIP render labels by kind; pinout legend gains an
  INA125 16-pin reference. UNBOARDABLE_KINDS now empty (every part has a package).
- Examples: `ina125-amp` (dual-supply ×10, R_G=10 kΩ, IAREF=GND, CH2 in / CH1 out).
- Spec `docs/specs/ina125.md` (datasheet-verified pinout + validated model); ROADMAP SCH-7 → DONE.
- Vestigial: the netlist `inamp` Circuit component/`inampLines` remain (never emitted now); could be
  removed later. `opModel` field also vestigial.

**Verification (Definition of Done):**
- build clean: `tsc --noEmit` clean. `vite build` needs a local run (sandbox can't run rolldown).
- 12-bit floor: untouched (no core/signal.ts change).
- sim sanity: INA125 G matches 4+60k/R_G across decades; example G=10, no clip; boards as 16-pin DIP.

**State for the next session:**
- All amplifiers are now real packaged parts (LMC662, INA125). In-amp sub-selector gone.
- Possible cleanup: remove the vestigial netlist `inamp` path and the `opModel` field.

**Open questions / flags for andre:**
- Confirm `npm run build` (Vite) clean locally. INA125 on-chip reference (VREF taps) not yet exposed
  on the schematic symbol — add if a lab needs the bridge-excitation reference.

---

### 2026-06-27 — SCH-6 op-amp is LMC662-only + boardable DIP — DONE

**By:** Cowork session (andre)
**Commit:** uncommitted

**What I did:**
- Removed the package-less "ideal" op-amp. The op-amp is always a real LMC662: `schematic.ts`
  baseTerminals('opamp') is 3-pin (inP/inN/out, power implied); toCircuit emits model 'lmc662';
  ampCategory('opamp')='build'. `opModel` field is now vestigial.
- Editor (`SchematicEditor.tsx`): dropped the op-amp model picker (toolbar sub-selector + Selected
  panel select + `setSelModel` + `opampType`); op-amp symbol no longer draws conditional rail stubs.
  Also replaced the redundant R/C/L type letter with the component value (10kΩ, 0.1µF, 10mH).
- Board (`core/breadboard.ts`): a schematic op-amp now maps to an 8-pin LMC662 DIP —
  schematicExpectation emits a dip (pinNets index = DIP pin; section-A signal pins constrained, B
  pins `undefined`, `needsRails:true`); checkEquivalence skips undefined pins and requires pin 8→V+
  rail and pin 4→V− rail. Op-amp removed from UNBOARDABLE (in-amps still unboardable). Diode/LED/
  Zener added to PLACEABLE_KINDS.
- Examples: collapsed the four amp examples to two LMC662 ones (`inv-amp`, `noninv-amp`);
  integrator/differentiator/summing unchanged (op-amp auto-powers). Differentiator reframed to
  1 V/div (the real LMC662 differentiator peaks at the corners → ~±3 V).
- Updated unit tests + CLAUDE.md; ROADMAP SCH-5 → SUPERSEDED, SCH-6 added.

**Verification (Definition of Done):**
- build clean: `tsc --noEmit` clean (Vite needs local `npm run build` — sandbox can't run rolldown).
- 12-bit floor: untouched (no `core/signal.ts` change).
- sim sanity: inv −2.2 (inverted), noninv ×2 (in-phase), integrator integrates, differentiator
  square w/ peaking ±3 V, summing ±1.75 V — none clip ±5 V; all boardable. Board Check enforces
  the DIP's V+/V− on the rails ("Wire U1 pin 8 (V+) to the V+ rail").

**State for the next session:**
- `opModel` is vestigial; could be removed from the type later. In-amps remain sim-only/unboardable.
- The 'lmc662' schematic KIND (dual 8-pin) is no longer placeable from the toolbar (op-amp covers it).

**Open questions / flags for andre:**
- Confirm `npm run build` (Vite) clean locally. The differentiator now shows realistic op-amp peaking;
  if you want it cleaner, add a small series input resistor (practical differentiator).

---

### 2026-06-27 — F-5 fixed M2K connector strips on the breadboard — DONE

**By:** Cowork session (andre)
**Commit:** uncommitted

**What I did:**
- `core/breadboard.ts`: added always-present M2K terminals (`TERMINALS`) matching the UC Davis
  adaptor board — top: 1+ 2+ GND V+ W1 GND TI; bottom: 1− 2− GND V− W2 GND. All GND terminals
  collapse to one node (`GND_RAIL`); `PORT_TERMINAL` maps each schematic port to its fixed terminal.
  `boardNets` now seeds terminals (3rd arg, defaulted). `checkEquivalence` anchors ports on the fixed
  terminals (no more "place the port" step) — a port not jumpered to the circuit fails as a missing
  jumper.
- `components/Breadboard.tsx`: render two connector strips above/below the board (SVG grown by a strip
  each side, board content offset by `OY`); terminals are color-coded (V+ red, V− blue, GND neutral,
  signals muted blue) and jumper-able; removed the placeable-port tool/chips/render; added a terminal
  legend + help. Save/load tolerant of older boards that still carry `ports`.
- Standard power distribution: `POWER_WIRES` (in `core/breadboard.ts`) is always present and folded
  into `boardNets` — GND→both outer rails, V+→top inner rail, V−→bottom inner rail. Rendered as fixed,
  non-deletable colour-coded wires; rails labelled GND/V+/V−. Jumpers touching a terminal now take the
  terminal's colour (`wireColor`). Verified: outer rails read GND, inner rails read V+/V−, and a
  resistor powered straight from the rails passes Check.
- Verified by a node script: all GND terminals one node; V+ distinct; jumper unions terminal↔hole;
  a correctly wired single-R (V+→R→GND) board passes Check; dropping the GND jumper fails with
  "R1 pin B and GND should be the same node — run a jumper."

**Verification (Definition of Done):**
- build clean: `tsc --noEmit` clean. `vite build` not runnable in sandbox (rolldown native binding);
  run `npm run build` locally before deploy.
- 12-bit floor at −104 dBFS: unaffected — no `core/signal.ts` changes.
- math/logic sanity: net-partition checks above all pass.

**State for the next session:**
- `BoardLayout.ports` is now vestigial (kept for back-compat / old files); the flow uses fixed
  terminals. Could be removed in a later cleanup. F-4 (more DIP footprints) still TODO.

**Open questions / flags for andre:**
- Confirm `npm run build` (Vite) clean locally; eyeball the strip layout/label spacing on screen.

---

### 2026-06-27 — QS-2 Quickstart guided sequence + return-hint — DONE

**By:** Cowork session (andre)
**Commit:** uncommitted

**What I did:**
- Quickstart: added three guided sections after Lab 1 — (1) Signal Generator + Oscilloscope (YT, then
  XY with the Zener I-V as the showcase), (2) Network Analyzer + a digitization/**dBFS** explainer with
  an inline themed SVG (0 dBFS = full scale ±2.5 V; 4/8/12-bit floors at −56/−80/−104 dBFS; the 12-bit
  one emphasised), pointing at the Spectrum Learning Mode, (3) circuit/simulation → breadboard transfer
  (Check / Practice vs Bench). All steps drive the app via onGoTo/onLoadExample.
- Earlier in this session: single-ended vs differential SVG in the intro; "return to Quickstart" gold
  pulse on the nav button once opened (`.nav-hint` in App.css, `quickstartSeen` + nav-btn `hint` arg).
- Docs: spec updated; ROADMAP QS-2 → DONE, QS-3 (figures + TWIN deep-links) added.

**Verification (Definition of Done):**
- build clean: `tsc --noEmit` clean. `vite build` still cannot run in sandbox (rolldown native binding);
  run `npm run build` locally before deploy.
- 12-bit floor at −104 dBFS: unaffected — no `core/` changes (Quickstart is static UI).
- sanity: dBFS diagram floors match CLAUDE.md (4-bit −56, 8-bit −80, 12-bit −104).

**State for the next session:**
- Quickstart now covers the full EEC1 instrument arc. QS-3 = real figures/screenshots + Lab `<!-- TWIN: -->`
  deep-links remain.

**Open questions / flags for andre:**
- Confirm `npm run build` (Vite) clean locally before deploy.

---

### 2026-06-27 — QS-1 In-app Quickstart (Track H) — DONE

**By:** Cowork session (andre)
**Commit:** uncommitted

**What I did:**
- New `components/Quickstart.tsx`: onboarding panel for two audiences (new app user / new to the
  real M2K). Leads with an M2K↔app bridge table (each row has an Open button), then a 3-step Lab 1
  walkthrough (voltage divider on Power Supply + Voltmeter) whose buttons load the `divider` example
  and jump to the Circuit / Supply / Voltmeter panels. "Where next" one-click loaders too.
- `App.tsx`: `ActiveInstrument` += `'quickstart'`; `loadExample(id)` helper (mirrors the editor's
  Examples dropdown); renderPanel case; top nav button (first item, under the logo); Welcome wiring.
- `Welcome.tsx`: `onQuickstart` prop + "New to the M2K? Start with the Quickstart" link that enters
  straight into the panel.
- Spec written: `docs/specs/quickstart.md`. ROADMAP Track H: QS-1 → DONE, QS-2 (full tour) added.

**Verification (Definition of Done):**
- build clean: `tsc --noEmit` clean. NOTE: `vite build` could not run in this sandbox (rolldown
  native binding `MODULE_NOT_FOUND` — environment, not code); run `npm run build` locally to confirm.
- 12-bit spectrum floor at −104 dBFS: unaffected — no `core/` changes (Quickstart is static UI).
- sanity check: all example ids the panel references resolve (divider, rc-lp, inv-ideal, diode-iv).

**State for the next session:**
- There is now an App-level `loadExample(id)`; the Quickstart drives the app via `onGoTo`/`onLoadExample`.
- QS-2 (full per-instrument tour + figures, Lab `<!-- TWIN: -->` deep-links) is the next Track H phase.
- Lab 1 source connected at `…/EEC1 Spring 2026/…/Labs_2027/Lab1/Lab1Instructions.md` for QS-2 content.

**Open questions / flags for andre:**
- Confirm `npm run build` (Vite) is clean on your machine before deploy.

---

### 2026-06-27 — LED (settable Vf) + Zener (settable breakdown) — DONE

**By:** Claude Code session
**Commit:** uncommitted

**What I did:**
- Generalised the diode netlist element with optional model params (`is`/`n`/`rs`/`bv`); each diode
  now emits its own `.model DM<id>` (no shared DGEN).
- New `SchKind` **led** and **zener** (same anode/cathode 2-pin footprint as the diode), with
  toolbar buttons and symbols (LED = diode + emission arrows; Zener = diode + bent "Z" cathode bar).
  Both editable: `UNIT` led/zener = 'V', `DEFAULT_VALUE` led 2.0, zener 3.3.
- `toCircuit` maps them to the diode element: **LED** sets IS from the chosen Vf (N=2, ~10 mA ref)
  so the forward drop equals the value you type; **Zener** sets BV = the value (reverse breakdown).
- New example **Zener I-V curve (XY)** (3.3 V) alongside the diode I-V; an LED I-V is the diode-IV
  with the part swapped to an LED.

**Verification (Definition of Done):**
- build clean: yes — `tsc --noEmit` zero errors.
- 12-bit floor: unaffected (no `signal.ts` change).
- math sanity check: simulated — LED Vf=2.0 → forward clamps 2.03 V; Vf=3.0 → 3.00 V (settable Vf
  confirmed). Zener BV=3.3 → forward +0.72 V, reverse breakdown ~−3.3…−4 V (within ±5 V, visible).


### 2026-06-27 — Diode component + differential probes + diode I-V example — DONE

**By:** Claude Code session
**Commit:** uncommitted

**What I did:**
- New **diode** component end to end: `SchKind 'diode'` (anode/cathode pins), `core/netlist.ts`
  `Diode` element emitting `D<id> a c DGEN` plus one shared `.model DGEN D(IS=2.52n N=1.752 RS=0.568
  BV=100 IBV=0.1u)` (generic silicon, ~0.6 V knee), `toCircuit` emission, editor symbol
  (triangle + cathode bar) and a Diode toolbar button.
- **Differential scope probing (opt-in):** `toCircuit` probes now also return `ch1n`/`ch2n` (the
  1-/2- reference nets, which already had names `out_n`/`scope2_n`). App's transient sampling
  subtracts the reference when a 1-/2- probe is placed, else stays single-ended. Existing examples
  (no 1-/2-) are unchanged; the inverting-amp file's grounded 1- also stays equivalent.
- New example **Diode I-V curve (XY)**: W1 → diode → sense R → gnd, with 1+/1- across the diode
  (differential V) and 2+ on the current-sense node. View in the scope's XY mode.

**Verification (Definition of Done):**
- build clean: yes — `tsc --noEmit` zero errors.
- 12-bit floor: unaffected (no `signal.ts` change).
- math sanity check: simulated the diode I-V (5 V sine drive). V across the diode clamps at +0.72 V
  forward / −5 V reverse; peak current ~16 mA. Correct exponential-knee behaviour.

**State for the next session:**
- All diodes share one model (DGEN). If a specific part (e.g. an LED with higher Vf, or a Zener)
  is wanted later, add a `model` field to the Diode element + per-part `.model` emission.


### 2026-06-27 — Oscilloscope XY mode — DONE

**By:** Claude Code session
**Commit:** uncommitted

**What I did:**
- `Oscilloscope.tsx`: an **XY** toggle (header, next to Run) that plots CH1 on X vs CH2 on Y
  instead of both against time. The XY toggle auto-enables CH2 (XY needs both channels).
- Pairs the captured CH1/CH2 window sample-by-sample, scales each onto the shared division grid
  with per-channel Volts/div + offset, and renders a square plot (yaxis `scaleanchor:'x'`) so
  shapes aren't distorted. Measurements row still updates.
- Use: for an I-V curve put device voltage on CH1 (1+) and current on CH2 (2+, via a sense
  resistor → V/R); for Lissajous feed two sines. Mirrors Scopy's XY.

**Verification (Definition of Done):**
- build clean: yes — `tsc --noEmit` zero errors.
- 12-bit floor: unaffected (no `signal.ts` change).
- math sanity check: N/A (display mode). Manual: enable XY, drive CH1/CH2 with two sines → a
  Lissajous ellipse; a resistor I-V gives a straight line whose slope is 1/R.


### 2026-06-27 — Schematic editor: undo/redo + copy/paste/cut — DONE

**By:** Claude Code session
**Commit:** uncommitted

**What I did:**
- `SchematicEditor.tsx`: an in-component history stack (`past`/`future` refs, cap 100) with a
  `snapshot()` taken before every mutating edit — place, wire, drag (one snapshot per gesture via a
  `dragSnapped` ref), delete, rotate, ref/value/model/type change, tune-slider grab, paste, and the
  load/example/clear actions. `undo()`/`redo()` swap states and clear selection.
- Clipboard (`clip` ref): `copySelection()` grabs the selected parts plus any wires whose both ends
  sit on selected pins; `pasteClipboard()` re-ids the parts (unique per kind), offsets by (2,2),
  translates the wires, and selects the paste. `cutSelection()` = copy then delete.
- Keyboard: extended the keydown handler with Ctrl/Cmd+Z (undo), Ctrl+Shift+Z / Ctrl+Y (redo),
  Ctrl/Cmd+C / V / X. Guarded against INPUT/TEXTAREA/SELECT so text fields keep their own keys, and
  `preventDefault` on the combos. Delete now also removes a multi-selection.

**Verification (Definition of Done):**
- build clean: yes — `tsc --noEmit` zero errors.
- 12-bit floor: unaffected (no `signal.ts` change).
- math sanity check: N/A (editor interaction). Manual: place/move/delete then Ctrl+Z reverts each;
  Ctrl+C/Ctrl+V duplicates the selection offset with fresh ids; Ctrl+X removes and re-pastes.

**State for the next session:**
- History lives in the editor and snapshots on its own edits + its load/example/clear. A wholesale
  schematic replacement from the **Board tab's** lab Open does not reset the circuit-editor history
  (minor: an undo right after that reverts the schematic). If that becomes annoying, lift history to
  App.tsx so all schematic owners share one stack.


### 2026-06-27 — Example circuit library (built-in Examples menu) — DONE

**By:** Claude Code session
**Commit:** uncommitted

**What I did:**
- New `src/core/examples.ts`: a library of pre-wired schematics students load from an **Examples**
  dropdown in the Circuit editor header. Each has a W1 source, a 1+ (CH1) probe on the output, and
  grounds, so it runs immediately in the Network Analyzer / scope.
- Set (grouped Passive / Amplifiers): voltage divider (÷2), RC low-pass, RC high-pass, LC low-pass,
  LC high-pass, RLC band-pass (~1.6 kHz, Q≈7), inverting amp ×−2.2 (ideal + LMC662), non-inverting
  amp ×2 (ideal + LMC662), op-amp integrator, op-amp differentiator, and a 2-input summing amp
  (W1+W2). 13 circuits total.
- The amp pairs share one skeleton parameterised by op-amp model: "ideal" = kind 'opamp' with no
  rails (sim-only); "LMC662" = same with `opModel:'lmc662'` plus V+/V- rail parts — so the pair
  also demonstrates the sim-only vs sim+build distinction. Gains kept small (≈2) so they don't clip
  at the default 1 V input.
- `SchematicEditor.tsx`: Examples `<select>` (optgroups) loads a deep-cloned schematic via setSch.

**Verification (Definition of Done):**
- build clean: yes — `tsc --noEmit` zero errors.
- 12-bit floor: unaffected — no change to `signal.ts`.
- math sanity check: simulated all 9 via the AC engine (tsx). Results match intent — divider −6 dB
  flat; RC LP/HP −3 dB ≈ 1 kHz with ±20 dB/dec; LC LP/HP +6 dB resonant peak ≈ 1.6 kHz, ±40 dB/dec;
  inverting +6.8 dB (×2.2); non-inverting +6.0 dB (×2); LMC662 versions roll off slightly by 100 kHz
  (finite GBW). No toCircuit warnings; all probe `out`.

**State for the next session:**
- To add an example, append to `EXAMPLES` in `core/examples.ts` (id/name/group/blurb/schematic).
  Grid layout notes are at the top of that file. Verify new ones by simulating before shipping.


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
  `docs/reference/m2k-spec.md`).
- Noted fidelity enhancement: model the M2K's **two** scope ranges (±2.5 V high / ±25 V low) with a
  range selector so dBFS follows the range; the AWG can now drive the full ±5 V (viewed on ±25 V on
  real hardware).
- Other open items: OSC-3, LOOP-2, F-3, Track E.

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