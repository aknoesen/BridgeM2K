# BridgeM2K

A browser-based digital twin of the [Analog Devices ADALM2000](https://www.analog.com/en/resources/evaluation-hardware-and-software/evaluation-boards-kits/adalm2000.html) (M2K) USB instrument, styled after the Scopy software interface. Draw a circuit, measure it with a full bench of virtual instruments, and transfer it to a solderless breadboard — all in the browser, no hardware and nothing to install.

### ▶ Live app: https://bridgem2k.onrender.com

Built for the EEC1 first-year ECE course at UC Davis. The twin teaches the ideal and parametric side of measurement so students arrive at the real bench already fluent in the instruments.

> **Scope: this is an _analog_ digital twin.** It models the M2K's analog instruments — oscilloscope, signal generator, spectrum analyzer, network analyzer, voltmeter, and power supply. The M2K's **digital** subsystems — the 16-channel logic analyzer, the pattern generator, and the digital I/O / bus (SPI/I²C/UART) tools — are intentionally **out of scope and not implemented**. EEC1 uses only the analog bench, so the twin mirrors exactly that.

## Instruments

- **Signal Generator** — two channels (W1/W2): sine, square (variable duty cycle), triangle, sawtooth; configurable frequency, amplitude, DC offset.
- **Oscilloscope** — two channels with per-channel Volts/div and offset, edge and pulse/width triggers, holdoff, auto/normal/single modes, a measurements row (Vpp, Vrms, mean, frequency, duty), cursors, and an **XY mode** (CH1 vs CH2) for I-V curves and Lissajous figures. Channels can be differential (1+/1−).
- **Spectrum Analyzer** — single-sided amplitude spectrum in dBFS via a Bluestein N-point FFT (no zero-padding leakage), with five windows (Hanning, Hamming, Blackman, Flat-top, Rectangle), running average and persistence, a parabolic-interpolated peak marker, a theoretical harmonic overlay, and a **Learning Mode ADC bit-depth selector (4/8/12-bit)** (noise floor shifts ~6 dB/bit; SNR from the Walden formula).
- **Network Analyzer** — Bode magnitude + phase by sine-sweeping the drawn circuit through ngspice `.ac`, with a −3 dB cursor and live value tuning.
- **Voltmeter** and **Power Supply** — DC node measurements and ±5 V rails for powering active circuits.
- **Export PNG** — every instrument (and the schematic and breadboard) has an Export PNG button in its header, saved through the browser's native Save dialog (name + folder). Instrument plots export on their dark screen background; the schematic and breadboard export as clean white paper figures — ready to drop into a prelab or report.

## Circuit editor + simulation

- **Schematic editor** — place and wire R, C, L, diodes (plain / LED with settable Vf / Zener with settable breakdown), the **LMC662** op-amp (behavioural model; boards as an 8-pin DIP), the **INA125** instrumentation amp (boards as a 16-pin DIP), generator/scope/supply ports, and ground. Every active part is a real, packaged device — there is no package-less "ideal" op-amp or in-amp. Connections are marked with **junction dots**, and dragging a part rubber-bands its wires — a "touch" connection (two pins on one node) turns into a real wire when the part moves, so nothing silently disconnects. Includes a Selected-panel diode-kind picker, **undo/redo** (Ctrl+Z / Ctrl+Y), **copy/paste/cut** (Ctrl+C/V/X), box-select and group move, rotate, and **Save/Open** to `.json`.
- **SPICE simulation** — [ngspice compiled to WebAssembly](https://www.npmjs.com/package/eecircuit-engine) runs in a Web Worker, so the generator → circuit → scope/Bode loop is fully in-browser. The generator drives the circuit input; the scope and spectrum read the circuit output node.
- **Breadboard** — transfer a drawn schematic to a parametric solderless board (2-pin parts, the LMC662 8-pin DIP, and the INA125 16-pin DIP), run jumpers, and **Check** that the board is electrically equivalent to the schematic, with per-connection feedback (including the INA125's required reference/sense/sleep straps). The board mirrors the UC Davis adaptor board: fixed M2K connector strips with pre-wired, colour-coded power rails (V+ red, V− blue, GND neutral), and jumpers on a supply net take that rail's colour. Resistor legs enforce a realistic minimum hole spacing. Practice mode colours nets live; Bench mode hides them until Check. Save/Open a "lab" bundle (schematic + board + generator settings) as one file.

## Example library

An **Examples** menu in the Circuit editor loads ready-made circuits, each pre-wired with a source and probes and (where useful) a preset generator drive and scope mode:

- Passive: voltage divider, RC low/high-pass, LC low/high-pass, RLC band-pass, and **Diode** and **Zener I-V curves** (load straight into XY mode with a triangle sweep).
- Amplifiers: inverting, non-inverting, integrator, differentiator, and a two-input summing amp (all the **LMC662**), plus an **INA125** instrumentation-amp example (gain 10 set by an external R_G).

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

The build is fully static (`dist/`), no backend. The live site runs on **Render** via the included
`render.yaml` Blueprint (served at root, `BASE_PATH=/`); it also deploys to **GitHub Pages** at the
`/BridgeM2K/` subpath, the default base (`npx gh-pages -d dist`). The base path is
`process.env.BASE_PATH || '/BridgeM2K/'`; `render.yaml` holds the Render specifics.

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
