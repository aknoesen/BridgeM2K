# M2K Digital Twin

A browser-based digital twin of the [Analog Devices ADALM2000](https://www.analog.com/en/resources/evaluation-hardware-and-software/evaluation-boards-kits/adalm2000.html) (M2K) USB instrument, styled after the Scopy software interface.

Built for the EEC1 first-year ECE course at UC Davis. Students use it to explore ADC bit depth, spectral analysis, and signal properties in a parametric environment before (and alongside) working with real M2K hardware.

## What it does

**Signal Generator** — generates sine, square (variable duty cycle), triangle, and sawtooth waveforms with configurable frequency, amplitude, and DC offset.

**Spectrum Analyzer** — computes the single-sided amplitude spectrum in dBFS using a Bluestein N-point FFT (no zero-padding leakage), with:
- Five window functions: Hanning, Hamming, Blackman, Flat-top, Rectangle
- Running average and persistence display modes
- Peak marker with parabolic sub-bin frequency interpolation
- Theoretical harmonic overlay (Fourier series prediction)
- **Learning Mode ADC bit depth selector (4/8/12-bit)** — noise floor shifts ~24 dB per step, matching the 6 dB/bit rule; SNR shown from the Walden formula

**Split view** — Signal Generator and Spectrum Analyzer side by side.

## Pedagogical design

The twin teaches what is parametric and predictable (quantization noise, harmonic structure, effect of bit depth, window function trade-offs). Real hardware teaches what the twin cannot simulate (ground loops, thermal noise, cable effects, instrument quirks). The two reinforce each other.

## Running locally

```bash
npm install
npm run dev
```

Open `http://localhost:5173/BridgeM2K/`.

## Building

```bash
npm run build
```

Output goes to `dist/`. The app is fully static (no backend).

## Deploying to GitHub Pages

The Vite config sets `base: '/BridgeM2K/'` to match the GitHub Pages subdirectory. After building, push the `dist/` contents to the `gh-pages` branch, or use the `gh-pages` npm package:

```bash
npm install --save-dev gh-pages
npx gh-pages -d dist
```

## Tech stack

- React 19 + TypeScript + Vite 8
- [Plotly.js](https://plotly.com/javascript/) (`plotly.js-dist-min`) for all plots
- No backend, no build-time data fetching, no external API calls

## Signal math notes

The spectrum uses a Bluestein chirp-Z FFT rather than a zero-padded power-of-2 FFT. For a 1 kHz signal at 100 kSa/s / 16 ms (N = 1600), zero-padding to 2048 points places harmonics at non-integer bins, producing Hanning sidelobes at −30 to −50 dBFS that swamp the noise floor for 8-bit and 12-bit ADC depths. The N-point Bluestein FFT eliminates this entirely.

Quantization noise is synthetic (Gaussian, calibrated to TPDF variance) rather than computed by actual sample quantization. This produces the correct statistical appearance of a real ADC noise floor without the deterministic harmonic distortion products that actual quantization introduces.

See `CLAUDE.md` for full implementation details.

## License

For educational use. Contact [aknoesen@ucdavis.edu](mailto:aknoesen@ucdavis.edu) for other uses.
