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
  sandbox (Windows-native `rolldown` binary in node_modules) — run `npm run build` on the
  host to confirm the bundle.
- 12-bit Hanning noise-floor formula recomputed = −104.29 dBFS (matches CLAUDE.md −104).
  `signal.ts` was not modified and CH1 samples are produced by the identical code path, so
  no spectral-leakage regression is possible from this change.
- math sanity check: noiseFloorDbfs(N=1600, bits=12, noiseBW=1.5) = −104.29 dBFS.

**State for the next session:**
- The channel bus exists but has no UI yet (intended). `channels.CH2` is disabled; `params2`
  has no setter yet. OSC-1/OSC-2 will add the Oscilloscope component, setters, and controls.
- `circuit-out` source resolves to `null` until LOOP-1 wires it.
- Next phase per ROADMAP sequence: **SPICE-1** (de-risk ngspice WASM) or **OSC-1** (scope
  scaffold) — both now unblocked.

**Open questions / flags for andre:**
- Confirm `npm run build` is green on Windows before pushing (sandbox could only run tsc).

### 2026-06-26 — Planning — DONE

**By:** project-director session (planning, no code)
**Commit:** docs only

**What I did:**
- Created the `docs/` planning set: `CONVENTIONS.md`, `ROADMAP.md`,
  `specs/oscilloscope.md`, `specs/schematic-ngspice.md`, this file.
- Selected the SPICE engine: **eecircuit-engine** (ngspice-WASM, MIT), behind a swappable
  `SpiceEngine` adapter. Fallbacks noted: tscircuit/ngspice, ngspiceX.
- Added a `docs/` pointer to `CLAUDE.md`.

**State for the next session:**
- No production code changed yet. Tracks A (oscilloscope) and B (schematic+SPICE) are fully
  specced and phased.
- **First phase to implement: ARCH-1** (channel bus). Recommended second: SPICE-1 (de-risk
  WASM early). See `ROADMAP.md` → "Recommended session sequence".
- Each phase lists allowed/forbidden files and acceptance criteria. Honor them.

**Open questions / flags for andre:**
- None blocking. Confirm whether the Bode plot should be a new mode inside the Spectrum
  Analyzer (recommended in LOOP-1) or a separate instrument — flagged for the LOOP-1 session.
