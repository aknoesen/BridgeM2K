# CLAUDE.md — BridgeM2K

A React digital twin of the Analog Devices ADALM2000 (M2K) USB instrument, built for the
EEC1 first-year ECE course at UC Davis. It is now a full Scopy-style bench: signal generator,
two-channel oscilloscope (with XY mode), spectrum analyzer, network analyzer (Bode), voltmeter,
power supply, a schematic editor with in-browser NGSpice (WASM) simulation, and a breadboard
transfer/verify view — plus an example-circuit library. The original pedagogy (ADC bit depth,
spectral analysis, quantization noise) lives on in the Spectrum Analyzer's Learning Mode.

**Scope — analog only.** This is an *analog* digital twin. It models the M2K's analog instruments
(scope, signal generator, spectrum/network analyzers, voltmeter, power supply). The M2K's **digital**
subsystems — the 16-channel logic analyzer, the pattern generator, and the digital I/O / bus
(SPI/I²C/UART) tooling — are **deliberately not implemented** (EEC1 uses only the analog bench). Do
not add digital-instrument features without an explicit decision to expand scope.

## Active development — read `docs/` before building new features

The instruments above are built. Planning, phase status, and per-phase specs live in `docs/`.
**Any Claude Code session adding a feature must read, in order:**

1. `docs/CONVENTIONS.md` — the engineering contract (session protocol, style, Definition of Done)
2. `docs/ROADMAP.md` — phased plan + live status; take the first `TODO` phase
3. the relevant `docs/specs/*.md` — detailed phase spec with acceptance criteria
4. `docs/PROGRESS.md` — handoff log from prior sessions
5. `docs/private/AGENT-HANDOFF.md` — the Cowork ⇄ Claude Code handoff log (see below)

Do one phase per session, verify against the Definition of Done, update `PROGRESS.md` and
`ROADMAP.md`, and commit. This CLAUDE.md remains the signal-math constitution below.

**Two-agent workflow.** A second Claude (the **Cowork** agent in andre's desktop app) also works on
this repo: it edits files on disk but **cannot commit** (its sandbox git is unreliable) and stages
specs, docs, and ready-to-build changes for Claude Code to verify, build, and commit on the host.
Check `docs/private/AGENT-HANDOFF.md` at session start for staged work and notes; append your results
and the commit hash there when done. If a file's working-tree state looks corrupted from Cowork's
view, trust the host: re-check with `git status` before assuming damage.

## Tech stack

| Layer | Choice |
|-------|--------|
| Framework | React 19 + TypeScript + Vite 8 |
| Plots | Plotly.js (`plotly.js-dist-min`) |
| SPICE | `eecircuit-engine` (ngspice → WASM) in a Web Worker — see `core/spice.ts` / `core/spice.worker.ts` |
| Build | `tsc && vite build` |
| Deploy | GitHub Pages at `/BridgeM2K/` (default base) or Render at `/` (sets `BASE_PATH=/`); base is `process.env.BASE_PATH \|\| '/BridgeM2K/'` |
| Dev server | `npm run dev` → `http://localhost:5173/BridgeM2K/` (or 5174 if port taken) |

No state-management library. Shared state (signal params, schematic, board, the shared
schematic undo/redo history, workspace/layout) lives in `App.tsx`; view-only state stays
component-local (scope bits/volts-div/trigger, spectrum window, editor selection, etc.).

## File map

```
src/
  main.tsx                    — React root, StrictMode
  App.tsx                     — top-level state, animation loop, channel bus, circuit-sim loop,
                                undo/redo history, Layouts presets, renderPanel()
  App.css                     — nav panel + instrument-area (preset arrange-row/grid) layout
  index.css                   — Scopy dark theme CSS variables, shared controls
  core/                       — pure logic, NO React
    signal.ts                 — ALL signal math (see below); protected
    scope.ts                  — channel bus + oscilloscope capture/timebase
    trigger.ts                — edge/pulse/holdoff trigger engine
    netlist.ts                — Circuit graph → ngspice netlist (R/C/L, diode, op-amp, in-amp, …)
    spice.ts / spice.worker.ts— SpiceEngine adapter; ngspice WASM in a Web Worker
    schematic.ts              — schematic model, terminals, computeNets, toCircuit, diode/amp helpers;
                                rubber-band move (moveComponentWithWires + bridgeWiresForMove: a
                                touch-connection becomes a real wire when a part is dragged)
    breadboard.ts             — solderless-board model, nets, schematic-equivalence check (incl.
                                INA125 reference/sense/sleep straps), DIP geometry
    units.ts                  — value units + tune ranges (shared with Network Analyzer)
    examples.ts               — built-in example-circuit library (schematic + optional W1/scope preset)
  components/
    SignalGenerator.tsx  SpectrumAnalyzer.tsx  Oscilloscope.tsx  NetworkAnalyzer.tsx
    Voltmeter.tsx  PowerSupply.tsx  SchematicEditor.tsx  Breadboard.tsx
    Quickstart.tsx (in-app onboarding doc)  Welcome.tsx (landing)  About.tsx (credits)
    exportImage.ts            — PNG export: SVG (schematic/board, white paper figure) + Plotly
                                instruments (dark), via the native Save dialog (savePngBlob)
    Instrument.css (shared panel layout)
docs/                         — CONVENTIONS.md, ROADMAP.md, PROGRESS.md, specs/*.md
```

## Architecture

`App.tsx` owns `params` (SignalParams) and `signal` (Float64Arrays). A `requestAnimationFrame`
loop fires a `tick` counter ~10×/s (every 6 frames at 60 fps). `signal` is recomputed via
`useMemo` on each tick so the spectrum noise shimmers like a real instrument.

`signal` flows down to both instruments as a prop. `SpectrumAnalyzer` calls `computeSpectrum`
directly inside its `useEffect` — it does NOT cache the spectrum result, intentionally, so
each render gets a fresh noise realization.

`SignalGenerator` shows a downsampled time-domain trace (max 2000 points, 4 periods shown).

**Circuit-simulation loop.** When a valid schematic is drawn, `App.tsx` runs `toCircuit` →
`buildNetlist` → the ngspice Web Worker (`.tran`/`.ac`) and feeds the result back into the scope
and spectrum: `measured`/`measured2` are the circuit's probe nodes when a circuit is active, else
the raw generator. CH1/CH2 can be **differential** (the 1−/2− probes set `ch1n`/`ch2n`, subtracted
in App's sampling — e.g. a clean diode I-V). The Network Analyzer sweeps the same circuit via `.ac`.
None of this perturbs the signal-math path below: with no circuit drawn, the Spectrum Analyzer still
sees the exact generator signal, so the 12-bit canary holds.

## Core signal math (`src/core/signal.ts`)

### `generateSignal(p)`

Generates ideal (unquantized) waveform samples.

**Critical: rational tau arithmetic.** Phase is computed as:
```typescript
const tau = ((i * p.frequency) / p.samplingRate) % 1
```
NOT `(2π × f × t) % 2π`. The 2π form accumulates floating-point error at transition
boundaries (e.g. `2π × 1000 × 0.009` ≠ `9 × 2π` in float64), producing ~12 wrong
samples per period of a 1 kHz square wave at 100 kSa/s. Those wrong samples create
spectral leakage at −47 dBFS that completely masks the 12-bit noise floor (~−100 dBFS).
Rational tau is exact at all integer multiples and eliminates this entirely.

**`snapDuration`** rounds `duration` to a whole number of signal periods:
```typescript
N = round(numPeriods × Fs / f₀)
```
This ensures the signal is exactly periodic in N samples — required for zero
inter-harmonic leakage with the Bluestein N-point FFT.

### `bluesteinFFT(xRe, xIm)` — Bluestein chirp-Z transform

Computes the exact N-point DFT for arbitrary N (no zero-padding).

**Why not `nextPow2` zero-padding?** At 1 kHz / 100 kSa/s / 16 ms (N=1600), the
fundamental lands on bin 16 exactly. With power-of-2 padding (N=2048), it lands at
bin 20.48, producing Hanning sidelobes at −30 to −50 dBFS between harmonics that
swamp the quantization noise floor for 8-bit and 12-bit ADCs. Bluestein eliminates
this entirely.

The chirp kernel FFT is cached per N in `bluesteinCache` (Map). Repeated calls at the
same N (10 fps × many seconds) skip the expensive precomputation.

### `buildWindow(N, type)`

Uses **periodic form** (denominator N, not N−1):
```typescript
const t = 2 * Math.PI * i / N
```
This makes the window exactly commensurate with the DFT period. For Hanning, the DFT
is the 3-tap kernel [N/2, −N/4, −N/4] with exactly zero at all other bins.
If you change to `2π × i / (N−1)`, you break the zero-leakage property.

### `computeSpectrum(x, Fs, bits, adcRangeV, windowType)`

Pipeline:
1. Remove DC mean
2. Apply window
3. Bluestein N-point FFT of ideal (unquantized) signal
4. Add synthetic Gaussian noise at each bin
5. Compute single-sided amplitude-corrected dBFS spectrum

**Synthetic quantization noise** (step 4) — do NOT replace with actual quantization:

Each bin receives complex Gaussian noise with per-component variance:
```
σ² = winPowerSum × lsb² / 8
```
where `winPowerSum = noiseBW × winSum² / N` and `lsb = adcRange / 2^bits`.

This is calibrated to TPDF (triangular probability density function) quantization noise
variance (lsb²/6 total, split into 2 components). The `noiseBW` values:

| Window | noiseBW |
|--------|---------|
| rectangle | 1.00 |
| hanning | 1.50 |
| hamming | 1.36 |
| blackman | 1.73 |
| flat-top | 3.77 |

Fresh Box-Muller Gaussian samples every call → noise shimmers each frame.

**Why synthetic instead of actual quantization?** Actual round/floor quantization
produces deterministic harmonic distortion products that look like signal peaks, not
noise. Synthetic Gaussian noise produces the correct statistical appearance of a real
ADC noise floor.

**Theoretical noise floor formula** (for the red dashed reference line):
```
noiseFloorDbfs = −10·log10(N) − bits·6.021 + 10·log10(2·noiseBW/3)
```

For N=1600, Hanning: 4-bit → −56 dBFS, 8-bit → −80 dBFS, 12-bit → −104 dBFS.

**SNR** uses the Walden formula: `6.02 × bits + 1.76` dB.

**dBFS reference:** 0 dBFS = ADC full-scale peak = `adcRangeV / 2` = 2.5 V (for ±2.5 V range).

### `theoreticalHarmonics(waveType, amplitude, frequency, dutyCycle, numHarmonics)`

Returns Fourier series peak amplitudes for overlay markers (green diamonds in the plot).
Square wave uses general duty-cycle formula: `(2A / nπ) × sin(nπD)`.

## Default signal parameters

```typescript
waveType: 'square', frequency: 1000 Hz, amplitude: 1 V, offset: 0 V,
dutyCycle: 50%, samplingRate: 100000 Sa/s, duration: 0.016 s
// → N = 1600, bin width = 62.5 Hz, 16 complete periods, zero leakage
```

ADC range: ±2.5 V (5 V total), matching real M2K hardware.

## SpectrumAnalyzer component details

State local to the component (not in App.tsx):
- `bits` — ADC bit depth for Learning Mode (4, 8, or 12)
- `windowType` — Hanning/Hamming/Blackman/Flat-top/Rectangle
- `freqMax` — display stop frequency (5/10/20/50 kHz)
- `persistence` — rolling fade buffer (last 20 frames, opacity decays as 0.78^age)
- `showAvg` — exponential moving average (alpha = 1/n, capped at n=60)
- `showTheory` — theoretical harmonic overlay

Persistence and average buffers are cleared (ref reset) whenever bits, freqMax,
windowType, frequency, waveType, dutyCycle, or samplingRate change.

Peak marker uses parabolic interpolation for sub-bin frequency accuracy.

## CSS theme

All colors are CSS custom properties in `src/index.css`:
- `--ch1-color: #f0a030` (orange) — matches real Scopy CH1
- `--accent-blue: #4a9eff`
- `--bg-display: #0d0d0d` (near-black plot background)
- `--bg-panel: #2a2a2a`

Learning Mode section title uses `--theory-color: #44dd88` (green) to visually
distinguish it from instrument controls.

## Deployment

```bash
npm run build          # outputs to dist/
# then copy dist/ to GitHub Pages branch, or use gh-pages
```

`vite.config.ts` has `base: '/BridgeM2K/'` — required for GitHub Pages subdirectory
deployment. Asset paths break if this is removed.

## Built since the original spec

The oscilloscope (incl. XY mode), the schematic editor + NGSpice-WASM simulation, the
generator → circuit → scope/Bode loop, the breadboard transfer/verify, and the example
library are all implemented — closing the original "Signal Generator → circuit → Spectrum/
Scope" goal. Diodes/LED/Zener, differential probes, undo/redo, copy/paste, and preset layouts
are in. The op-amp is a selectable **real part from the ADALP2000 kit** (OP27, OP37, OP97, OP482,
OP484 — each a behavioural macromodel; default OP484), never a package-less
"ideal" variant (see SCH-9 / `core/opamps.ts`). Its schematic symbol shows inP/inN/out with power
implied (auto ±5 V in sim); on the breadboard it boards as its real DIP package (F-4: single 8-pin
for OP27/37/97, quad 14-pin for OP482/484; the off-kit LMC662 fallback as an 8-pin dual) whose V+/V−
must be wired to the rails (the board Check enforces this). Off-kit op-amps still simulate but show a "not in your parts
kit" badge. Every part the twin offers is buildable; `docs/ROADMAP.md` is the phase-by-phase status
of record.

## Remaining / future ideas

1. **Guided discovery sequences** — in-app structured prompts walking students through lab
   exercises (find harmonic content, measure −3 dB bandwidth, etc.).
2. **Lab prelab integration** — `<!-- TWIN: -->` markers in the EEC1 lab instructions hook the
   twin into prelab sections.
3. **ADC/DAC fidelity & sampling control** (ROADMAP Track I) — a settable ADC sample rate (aliasing /
   oversampling / Fs-N-bin-width, the Lab 3 sampling-rate point) and an *optional, default-off* DAC
   quantization model on W1/W2 (the M2K's 12-bit AWG). Both touch `core/signal.ts`; re-verify the
   12-bit canary, and keep DAC quantization off by default so the ADC Learning Mode stays clean.
4. **KiCad netlist import** (ROADMAP `KICAD-1`).
5. **True dockable panels + saveable workspaces** (ROADMAP Track E, beyond the E-1 preset layouts).

## Things NOT to change without understanding the math

- **`tau = ((i * f) / Fs) % 1`** in `generateSignal` — changing this to 2π-based
  arithmetic reintroduces transition-boundary errors and breaks the 12-bit noise floor
- **Periodic window denominator N (not N−1)** in `buildWindow` — changing to N−1
  breaks exact zero-leakage at harmonic bins
- **`bluesteinFFT` instead of zero-padded FFT** — reverting to `nextPow2` padding
  produces −30 to −50 dBFS sidelobes that mask the 8-bit and 12-bit noise floors
- **Synthetic Gaussian noise** in `computeSpectrum` — replacing with actual
  `Math.round(x / lsb) * lsb` quantization produces harmonic distortion products
  that look like signal peaks and obscure the pedagogical bit-depth comparison
