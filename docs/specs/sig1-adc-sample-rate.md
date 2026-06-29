# SPEC — SIG-1: Settable ADC sample rate (Track I)

Read `docs/CONVENTIONS.md`, `CLAUDE.md` (esp. "Things NOT to change without understanding the
math"), and `docs/PROGRESS.md` first. This phase **modifies `core/signal.ts`** — the protected
signal path — so the 12-bit canary discipline is the whole point. Do SIG-1 only; SIG-2 (DAC
quantization) is a separate later phase that depends on this one.

Decisions locked with andre (2026-06-28): **preset dropdown** for Fs (not free entry), and all three
phenomena are in scope: **aliasing (sub-Nyquist), oversampling / processing gain, and a live
Fs / N / bin-width readout.**

---

## Goal

Make the **acquisition sample rate Fs** a user-settable control (today it is fixed at 100 kSa/s,
displayed but not changeable). Fs drives the Spectrum Analyzer (and the scope capture path, which
reads the same generated samples), so students can run three experiments:

1. **Aliasing** — take Fs below 2x the signal frequency and watch the component fold down to
   `|f − round(f/Fs)·Fs|`.
2. **Oversampling / processing gain** — raise Fs and see the per-bin noise floor drop and the bin
   width shrink (FFT processing gain ≈ 10·log10(N/2) over the full-band noise).
3. **Fs / N / bin-width readout** — show `bin width = Fs / N` and `N` (from the whole-periods snap)
   live, so the span-vs-resolution-vs-capture-length trade is visible.

## The invariant that protects the canary (read this twice)

`computeSpectrum` is leakage-free **only when every spectral component lands on an exact integer
bin.** With `snapDuration` (`N = round(numPeriods · Fs / f)`) the fundamental lands on bin
`numPeriods` **exactly** iff `numPeriods · Fs / f` is an integer — i.e. iff `Fs / f` is an integer
ratio with a denominator that divides `numPeriods`. The same holds for an aliased component: aliasing
maps a harmonic onto another bin, and that bin is still an integer **iff** the same ratio condition
holds.

Therefore:

- **Offer Fs presets that keep `Fs / f` an integer (or a simple ratio) for the documented demo
  signals.** Suggested set: **5, 10, 20, 50, 100, 200 kSa/s** (default **100**). For the default
  1 kHz signal every one of these gives an integer `Fs / f` → exact bins → zero leakage.
- For the **aliasing** demo (needs `Fs < 2f`), pick the demo's `f` so `Fs / f` stays a simple ratio
  (e.g. Fs = 10 kSa/s with f = 6 kHz → ratio 5/3, exact when `numPeriods` is a multiple of 3; or the
  cleanest case f = 4 kHz at Fs = 10 kSa/s, alias = 4 → 6 → folds to... verify and document the exact
  demo pair you ship). Whatever pair you choose, it must pass the leakage test below.
- If a chosen (Fs, f) does **not** land exactly, do **not** paper over it by changing the window,
  Bluestein, or the noise model. Either pick a different preset/`f`, or have `snapDuration` extend `N`
  to the least common multiple so the signal is exactly periodic. Document whichever you do.

## Implement

- Add an **Fs preset dropdown** in the Spectrum Analyzer controls (mirror the existing `freqMax`
  dropdown pattern). It sets `params.samplingRate` (already a `SignalParams` field owned by
  `App.tsx` and already threaded through `generateSignal` / `snapDuration` / `computeSpectrum`).
  Default stays 100 kSa/s.
- Add the **Fs / N / bin-width readout** near the dropdown (read `N` from the same `snapDuration`
  the FFT uses; `binWidth = Fs / N`).
- Ensure the **scope capture path** honors the same Fs (it reads the same generated samples; confirm
  the timebase/sample-count code uses `params.samplingRate` rather than a hardcoded 100 kSa/s).
- Clear the Spectrum's persistence/average buffers when Fs changes (same ref-reset pattern already
  used for bits/freqMax/windowType changes).
- **Do NOT touch** the protected internals: the `tau = ((i·f)/Fs) % 1` arithmetic, the periodic
  window denominator `N` (not `N−1`), the Bluestein FFT, or the synthetic-Gaussian-noise model.
  SIG-1 is plumbing + UI + bin-landing verification only.

## Acceptance criteria (Definition of Done, §7, plus phase-specific)

- **12-bit canary holds at the default 100 kSa/s**: square, 1 kHz, 16 ms, N = 1600, 12-bit / Hanning
  → noise floor ≈ **−104 dBFS**, no inter-harmonic leakage spikes. Any drift is a regression.
- **Zero inter-harmonic leakage at every offered preset** for the documented demo signal(s) — add a
  Vitest in `signal.test.ts` asserting that, between harmonics, the spectrum sits at/below the
  theoretical floor (no leakage spikes) at each preset Fs.
- **Aliasing is correct**: a sub-Nyquist (Fs, f) pair produces a peak at the predicted alias
  frequency `|f − round(f/Fs)·Fs|`, on an exact bin — assert the alias bin index in a test.
- **Bin-width readout** equals `Fs / N` and updates with Fs (and the displayed `N` matches the FFT's).
- `npm run build` clean (`tsc` zero errors, no `any` / `@ts-ignore`); no console errors.
- `docs/PROGRESS.md` appended; `docs/ROADMAP.md` SIG-1 flipped to DONE; one focused commit.

## Files: allowed / forbidden

**Allowed:** `src/core/signal.ts` (the `samplingRate`/`snapDuration` plumbing and, if needed, an
LCM extension of `N` — NOT the protected math), `src/core/signal.test.ts` (new tests),
`src/components/SpectrumAnalyzer.tsx` (Fs dropdown + readout + buffer reset), `src/App.tsx` (only if
the Fs control or scope-capture wiring needs it), `src/components/Oscilloscope.tsx` (only if its
capture path hardcodes 100 kSa/s), `docs/PROGRESS.md`, `docs/ROADMAP.md`, this spec.

**Forbidden / do not modify the behavior of:** the `tau` rational-phase arithmetic, `buildWindow`'s
periodic denominator, `bluesteinFFT`, and the synthetic-noise model in `computeSpectrum`
(`CLAUDE.md` "Things NOT to change"). If SIG-1 seems to require changing any of these, stop and flag
it in `PROGRESS.md`.

## Commit

`scope: SIG-1 settable ADC sample rate (Fs preset dropdown + aliasing/oversampling/bin-width)`
with the §8 body, including: `verification: build clean; 12-bit floor −104 dBFS at 100 kSa/s; zero
leakage at all presets; alias bin verified`.

---

## Notes for SIG-2 (next phase, do NOT build now)

SIG-2 adds **optional DAC quantization** on the generator (W1/W2, the M2K's 12-bit AWG), **default
OFF** so the ADC bit-depth Learning Mode stays clean. It builds on SIG-1's Fs control to complete the
"both ends quantize, sample rate is the knob between" story. Depends on SIG-1; keep it off by default
and re-verify the canary.
