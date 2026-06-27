# BridgeM2K

A browser-based digital twin of the [Analog Devices ADALM2000](https://www.analog.com/en/resources/evaluation-hardware-and-software/evaluation-boards-kits/adalm2000.html) (M2K) USB instrument, styled after the Scopy software interface. Draw a circuit, measure it with a full bench of virtual instruments, and transfer it to a solderless breadboard — all in the browser, no hardware and nothing to install.

Built for the EEC1 first-year ECE course at UC Davis. The twin teaches the ideal and parametric side of measurement so students arrive at the real bench already fluent in the instruments.

## Instruments

- **Signal Generator** — two channels (W1/W2): sine, square (variable duty cycle), triangle, sawtooth; configurable frequency, amplitude, DC offset.
- **Oscilloscope** — two channels with per-channel Volts/div and offset, edge and pulse/width triggers, holdoff, auto/normal/single modes, a measurements row (Vpp, Vrms, mean, frequency, duty), cursors, and an **XY mode** (CH1 vs CH2) for I-V curves and Lissajous figures. Channels can be differential (1+/1−).
- **Spectrum Analyzer** — single-sided amplitude spectrum in dBFS via a Bluestein N-point FFT (no zero-padding leakage), with five windows (Hanning, Hamming, Blackman, Flat-top, Rectangle), running average and persistence, a parabolic-interpolated peak marker, a theoretical harmonic overlay, and a **Learning Mode ADC bit-depth selector (4/8/12-bit)** (noise floor shifts ~6 dB/bit; SNR from the Walden formula).
- **Network Analyzer** — Bode magnitude + phase by sine-sweeping the drawn circuit through ngspice `.ac`, with a −3 dB cursor and live value tuning.
- **Voltmeter** and **Power Supply** — DC node measurements and ±5 V rails for powering active circuits.

## Circuit editor + simulation

- **Schematic editor** — place and wire R, C, L, diodes (plain / LED with settable Vf / Zener with settable breakdown), op-amps (ideal or LMC662 behavioural model), instrumentation amps, the LMC662 8-pin DIP, generator/scope/supply ports, and ground. Includes a Selected-panel type picker (op-amp model, in-amp type, diode kind), **undo/redo** (Ctrl+Z / Ctrl+Y), **copy/paste/cut** (Ctrl+C/V/X), box-select and group move, rotate, and **Save/Open** to `.json`.
- **SPICE simulation** — [ngspice compiled to WebAssembly](https://www.npmjs.com/package/eecircuit-engine) runs in a Web Worker, so the generator → circuit → scope/Bode loop is fully in-browser. The generator drives the circuit input; the scope and spectrum read the circuit output node.
- **Breadboard** — transfer a drawn schematic to a parametric solderless board (2-pin parts and the LMC662 DIP), run jumpers, and **Check** that the board is electrically equivalent to the schematic, with per-connection feedback. Practice mode colours nets live; Bench mode hides them until Check. Save/Open a "lab" bundle (schematic + board + generator settings) as one file.

## Example library

An **Examples** menu in the Circuit editor loads ready-made circuits, each pre-wired with a source and probes and (where useful) a preset generator drive and scope mode:

- Passive: voltage divider, RC low/high-pass, LC low/high-pass, RLC band-pass, and **Diode** and **Zener I-V curves** (load straight into XY mode with a triangle sweep).
- Amplifiers: inverting and non-inverting (ideal and LMC662), op-amp integrator, differentiator, and a two-input summing amp.

## Layouts

A **Layouts** dropdown arranges multiple instruments at once (Generator + Spectrum, Generator + Scope, Circuit + Network/Bode, Circuit + Scope, Scope + Supply + Voltmeter), or view any single instrument full-window.

## Running locally

```bash
npm install
npm run dev
```

Open the URL Vite prints (e.g. `http://localhost:5173/BridgeM2K/`). Run `npm test` for the core-math test suite.

## Building

```bash
npm run build
```

Output goes to `dist/`. The app is fully static (no backend).

## Deploying

**GitHub Pages** — the base path defaults to `/BridgeM2K/`. Build, then publish `dist/` to the `gh-pages` branch:

```bash
npx gh-pages -d dist
```

**Render** (served at the domain root) — `render.yaml` defines a static-site Blueprint. In the Render dashboard choose **New → Blueprint** (or **New → Static Site → Public Git Repository**) and point it at this repo. It builds with `npm install && npm run build`, publishes `dist`, sets `BASE_PATH=/` and `NODE_VERSION=22`, and rewrites `/*` → `/index.html`. The base is `process.env.BASE_PATH || '/BridgeM2K/'`, so Pages builds stay on the subpath while Render builds at root.

## Tech stack

- React 19 + TypeScript + Vite 8 (no state-management library; state lives in `App.tsx` and component-local hooks)
- [Plotly.js](https://plotly.com/javascript/) (`plotly.js-dist-min`) for all plots
- [eecircuit-engine](https://www.npmjs.com/package/eecircuit-engine) (ngspice WASM) for circuit simulation, in a Web Worker
- No backend, no build-time data fetching, no external API calls

## Signal math notes

The spectrum uses a Bluestein chirp-Z FFT rather than a zero-padded power-of-2 FFT. For a 1 kHz signal at 100 kSa/s / 16 ms (N = 1600), zero-padding to 2048 points places harmonics at non-integer bins, producing Hanning sidelobes at −30 to −50 dBFS that swamp the noise floor for 8-bit and 12-bit ADC depths. The N-point Bluestein FFT eliminates this entirely.

Quantization noise is synthetic (Gaussian, calibrated to TPDF variance) rather than computed by actual sample quantization, giving the correct statistical appearance of a real ADC noise floor without the deterministic harmonic distortion products that actual quantization introduces.

See `CLAUDE.md` for the signal-math constitution and `docs/` for the engineering conventions, roadmap, and per-phase specs.

## License

MIT. See `LICENSE`.
