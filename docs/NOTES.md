# NOTES.md — running backlog of observations and ideas

Informal jot list from demos and usage. Items here may graduate into ROADMAP phases. Newest on top.

---

## 2026-06-26

### iio-emu / real-Scopy integration → now Track G (spec written)
After the AD meeting: AD's **iio-emu** (libiio/IIOD emulation server, ADIBSD) can drive **real
Scopy** from files. The win: real Scopy → student's drawn circuit (ngspice via a bridge) → real
Scopy, using AD's own software, no hardware. Plus AD's `adalm2000.xml` is the authoritative M2K
device model to align our numbers to. Captured as **Track G** (`docs/specs/iio-scopy.md`): G-A
fidelity alignment (cheap, browser, next), G-B SPICE-in-the-loop with real Scopy (native showcase),
G-C browser-speaks-IIO (parked). Complementary native path, not a pivot.

### Two DACs — expose W2 as its own generator instrument
The real M2K has **two arbitrary-waveform outputs, W1 and W2** (two DACs). The twin currently
exposes only **W1** as a Signal Generator instrument (`params`). W2 exists in the model as the
second generator (`params2` / `generator2`) and as the schematic **W2 port** (awg2 → net `in2`,
stamped by `applyGeneratorParams`), but it is only editable indirectly through the Oscilloscope's
CH2 controls and the Spectrum's CH2 controls.

Idea: give W2 a first-class generator UI so it is independently controllable like the real bench.
Options:
- A second **Signal Generator** instrument (W2) in the nav, OR
- A **two-channel Signal Generator** panel (W1 + W2), matching how Scopy presents the AWG.

Plumbing already exists (`params2`, `applyGeneratorParams` handles `W2`), so this is mostly UI:
a generator panel bound to `params2` / `setParams2`, plus a nav entry. Low risk, no signal-math
change. Would let students drive a circuit with two independent sources (e.g. differential or
two-tone inputs).
