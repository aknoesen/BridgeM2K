# CLAUDE.md — BridgeM2K

A React digital twin of the Analog Devices ADALM2000 (M2K) USB instrument, built for
the EEC1 first-year ECE course at UC Davis. Students interact with a browser-based
Scopy-style interface to explore ADC bit depth, spectral analysis, and signal properties
before (and alongside) touching the real hardware.

## Active development — read `docs/` before building new features

Planning for the in-progress features (Oscilloscope panel, Schematic editor + NGSpice WASM)
lives in `docs/`. **Any Claude Code session adding to those features must read, in order:**

1. `docs/CONVENTIONS.md` — the engineering contract (session protocol, style, Definition of Done)
2. `docs/ROADMAP.md` — phased plan + live status; take the first `TODO` phase
3. the relevant `docs/specs/*.md` — detailed phase spec with acceptance criteria
4. `docs/PROGRESS.md` — handoff log from prior sessions

Do one phase per session, verify against the Definition of Done, update `PROGRESS.md` and
`ROADMAP.md`, and commit. This CLAUDE.md remains the signal-math constitution below.

## Tech stack

| Layer | Choice |
|-------|--------|
| Framework | React 19 + TypeScript + Vite 8 |
| Plots | Plotly.js (`plotly.js-dist-min`) |
| Build | `tsc && vite build` |
| Deploy target | GitHub Pages at `/BridgeM2K/` (base set in `vite.config.ts`) |
| Dev server | `npm run dev` → `http://localhost:5173` (or 5174 if port taken) |

No state management library. All state lives in `App.tsx` (signal params, running/tick)
and component-local `useState` (bits, windowType, freqMax, etc.).

## File map

```
src/
  main.tsx                    — React root, StrictMode
  App.tsx                     — top-level state, animation loop, layout (single/split)
  App.css                     — nav panel + instrument-area layout
  index.css                   — Scopy dark theme CSS variables, shared controls
  core/
    signal.ts                 — ALL signal math (see below); no React
  components/
    SignalGenerator.tsx       — waveform display + controls
    SpectrumAnalyzer.tsx      — FFT display + Learning Mode controls
    Instrument.css            — shared instrument panel layout (display-area, settings-panel)
```

## Architecture

`App.tsx` owns `params` (SignalParams) and `signal` (Float64Arrays). A `requestAnimationFrame`
loop fires a `tick` counter ~10×/s (every 6 frames at 60 fps). `signal` is recomputed via
`useMemo` on each tick so the spectrum noise shimmers like a real instrument.

`signal` flows down to both instruments as a prop. `SpectrumAnalyzer` calls `computeSpectrum`
directly inside its `useEffect` — it does NOT cache the spectrum result, intentionally, so
each render gets a fresh noise realization.

`SignalGenerator` shows a downsampled time-domain trace (max 2000 points, 4 periods shown).

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

## Planned additions (not yet implemented)

1. **Oscilloscope panel** — time-domain with trigger controls, matches Scopy Oscilloscope
2. **Guided discovery sequences** — in-app structured prompts that walk students through
   Lab 3 spectrum analyzer exercises (find harmonic content, measure −3 dB bandwidth, etc.)
3. **Lab 3 prelab integration** — `<!-- TWIN: -->` markers in
   `C:\Users\aknoesen\Documents\Knoesen\EEC1 Spring 2026\organize coursematerials\Labs_2027\Lab3\Lab3Instructions_2027.md`
   are waiting for the twin MVP to be deployed before those prelab sections are finalized
4. **Oversampling control** — analogous to vertiam.github.io/adc-simulator/; shows noise
   reduction through faster sampling; maps to Lab 3 sampling rate discussion

## Future expansion: browser-native schematic + NGSpice WASM

The long-horizon goal is to close the loop between the signal generator and a circuit
simulator: Signal Generator output → circuit → Spectrum Analyzer input.

**Engine:** NGSpice compiled to WebAssembly. NGSpice is already the SPICE engine inside
KiCad, is open-source, and has been compiled to WASM (prior art exists). It takes standard
SPICE netlists, so the schematic layer is decoupled from the solver.

**Schematic entry:** A lightweight browser-native node-and-wire editor, NOT KiCad. EEC1
students are first-year; a full EDA suite introduces a separate install and steep UI
learning curve before they see a result. The circuits needed are simple (RC filter,
inverting amp, INA125 front end) — a minimal editor with R, C, L, voltage source, and
op-amp symbols is sufficient.

**KiCad netlist import** is a sensible stretch feature for later-course students who
already know KiCad — a "bring your KiCad schematic into the M2K twin" path. Defer until
the core browser editor + NGSpice WASM is working.

**Why this matters pedagogically:** Students draw the Lab 5 RC filter in the browser,
set the cutoff frequency, and immediately see the Bode plot emerge in the Spectrum
Analyzer — the same measurement they will make on the bench, but parametric and
zero-hardware-required. The twin teaches the ideal; hardware teaches the real deviation.

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
