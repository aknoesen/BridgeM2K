# SPEC — iio-emu / real-Scopy integration (Track G)

Goal: take full advantage of Analog Devices' **iio-emu** (the libiio/IIOD emulation server) so the
twin can (A) match AD's authoritative ADALM2000 device model exactly, and (B) drive **real,
unmodified Scopy** with a student's *simulated* circuit — AD's production software, no hardware,
showing a SPICE-simulated result.

Read `docs/CONVENTIONS.md` first. This is a **complementary native path**, not a replacement for
the browser twin. The browser app stays the zero-install student tool; this adds a lab/pro
deployment mode and an AD-facing showcase. Nothing here touches `core/signal.ts`.

---

## What iio-emu is (confirmed from the repo)

- A C++ **libiio/IIOD server**: libiio clients (notably **Scopy**) connect over TCP and believe a
  device is present. ADIBSD-licensed (permissive). Latest release v0.2.0 (Apr 2024).
- Two modes:
  - `adalm2000` — a compiled-in M2K context with device behaviour (`m2k_adc.cpp`, `m2k_dac.cpp`).
  - `generic <xml> "<dev>@<file>" ...` — builds a device from an XML context and **links each
    RX/TX channel to a file it streams from/to**. Generic TX is streaming-only (no cyclic buffers).
    A loopback is RX and TX linked to the same file.
- **Authoritative artifacts in the repo (this is the gold):**
  - `iiod/context/adalm2000/adalm2000.xml` (~53 KB) — the full M2K IIO context: devices, channels
    (W1/W2 DAC, scope ADC, etc.), attributes, scan-element formats and scales.
  - `iiod/context/adalm2000/devices/m2k_adc.cpp` / `m2k_dac.cpp` — the real ADC/DAC scaling and
    sample handling.
  - `tools/genxml.c` (`iio-emu_gen_xml`) — generates an iio-emu XML from a live device.

---

## Stage A — Fidelity alignment (browser, cheap, do first)

**Goal:** make the browser twin's numbers and names match AD's reference M2K model.

**Implement:**
- Extract from `adalm2000.xml` + `m2k_adc.cpp`/`m2k_dac.cpp`: sample rates, ADC bit depth and the
  real **codes↔volts scaling**, the ±full-scale range, channel ids/names (W1/W2, voltage0/1, scan
  formats like `le:s12/16>>0` etc.).
- Reconcile against the twin's constants (`CLAUDE.md` default params, ADC range ±2.5 V, 100 kSa/s,
  the M2K pin names already used by the breadboard/schematic). Adjust any that differ from AD's
  model; document the mapping.

**Acceptance:** a short table in PROGRESS mapping AD's M2K parameters → the twin's constants, with
any corrections applied. Build clean; 12-bit canary holds (only constants/labels change, never the
signal pipeline).

**Files:** `docs/reference/adalm2000.xml` (vendored copy), the twin's param/constant files, docs.

---

## Stage B — SPICE-in-the-loop with real Scopy (the AD demo)

**Goal:** real Scopy → student's drawn circuit (SPICE) → real Scopy, via iio-emu generic mode.

**Architecture:**
```
Scopy (Signal Gen)  --W1 DAC samples-->  [TX file]
                                            |  bridge: read TX, run ngspice through the
                                            v  drawn circuit's netlist, write result
Scopy (Oscilloscope) <--scope samples--  [RX file]
```
- Run `iio-emu generic adalm2000.xml "<dac_dev>@w1.bin" "<adc_dev>@scope.bin" ...`.
- A **bridge process** (Node reusing `core/netlist.ts`, or Python) watches the DAC TX file,
  decodes samples in the scan-element format, runs them through **ngspice** (native, same engine
  family as our WASM build) on the netlist `buildNetlist` produces for the current circuit, encodes
  the node voltages into the ADC RX file.
- De-risk in order: (1) plain loopback (TX file == RX file, prove Scopy sees its own W1 on the
  scope), (2) insert a trivial gain, (3) insert the real drawn-circuit netlist.

**Open questions to resolve during B (study `generic_rx_device.cpp`/`generic_tx_device.cpp` +
`m2k_adc/dac`):** exact sample/scan format (int16 LE, scale), buffer cadence/streaming sync, how
Scopy's buffer pull maps to file reads, and timing (this is file streaming, not real-time sim).

**Acceptance:** real Scopy, connected to local iio-emu, shows a square wave on W1 rounded by an RC
the student drew, on the scope. Document the exact command + bridge in PROGRESS.

**Note:** native, install-required (iio-emu + Scopy + bridge + ngspice). Likely its own multi-session
effort. This is the headline AD showcase.

---

## Stage C — Browser twin speaks IIO (long horizon, parked)

A libiio-over-WebSocket bridge so the browser app itself is an IIO endpoint real clients can read.
Ambitious; revisit only if there's a clear need after A/B.

---

## Sequencing

Stage A is cheap, browser-only, and immediately useful (credibility + correctness) — do it next.
Stage B is the showcase but native and heavier — schedule deliberately. Stage C is parked.
None of Track G touches `core/signal.ts`; the 12-bit canary holds throughout.

Reference: AD iio-emu — https://github.com/analogdevicesinc/iio-emu
