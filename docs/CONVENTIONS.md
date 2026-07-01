# CONVENTIONS.md — engineering contract for all Claude Code sessions

This is the style and architecture contract for `BenchBridge`. Every Claude Code
(CC) session that touches this repo must read this file, `CLAUDE.md`, the relevant
spec in `docs/specs/`, and `docs/PROGRESS.md` before writing code.

`CLAUDE.md` is the math/physics constitution (why the signal pipeline is built the way
it is). This file is the *how we build* contract. When they appear to conflict,
`CLAUDE.md` wins on signal math; this file wins on code structure.

---

## 1. Session protocol (the most important section)

Each CC session does **one phase** from a spec, end to end, then stops. A "phase" is
sized to be completable and verifiable in a single session.

Order of operations for every session:

1. Read `CLAUDE.md`, this file, the active spec under `docs/specs/`, and `docs/PROGRESS.md`.
2. In `docs/ROADMAP.md`, find the first phase whose status is `TODO`. That is your phase
   unless the user named a different one.
3. Re-read the phase's **Acceptance criteria** and its **Files: allowed / forbidden** list.
   Do not modify forbidden files. If the phase genuinely cannot be done without touching a
   forbidden file, stop and flag it in `PROGRESS.md` rather than editing it.
4. Implement only that phase.
5. Run the **Definition of Done** checklist (section 7). All items must pass.
6. Append a dated entry to `docs/PROGRESS.md` (template at the bottom of that file).
7. Flip the phase status in `docs/ROADMAP.md` from `TODO` to `DONE` (or `BLOCKED` with a reason).
8. Make a single focused git commit using the message convention in section 8.

Do not start the next phase in the same session unless the user explicitly asks. Smaller,
verified increments are the whole point of this structure.

---

## 2. Tech stack — do not introduce new core dependencies without sign-off

| Layer | Choice | Notes |
|-------|--------|-------|
| Framework | React 19 + TypeScript | Function components + hooks only. No class components. |
| Build | Vite 8 (`tsc && vite build`) | `tsc` must stay clean. |
| Plots | `plotly.js-dist-min` | Already a dependency. Use it for scope + Bode. Do not add a second plotting lib. |
| State | React `useState` / `useMemo` / `useRef` | No Redux/Zustand/Jotai. See section 4. |
| SPICE | `eecircuit-engine` (ngspice WASM, MIT) | Behind an adapter — see `docs/specs/schematic-ngspice.md`. |

Adding any other runtime dependency requires an explicit note in `PROGRESS.md` explaining
why, and should be raised with the project director (andre) first. Dev-only tooling
(e.g. a test runner) is lower-risk but still gets noted.

---

## 3. File and directory layout

```
src/
  main.tsx                  React root (do not change without reason)
  App.tsx                   Top-level state, layout, channel bus (section 4)
  App.css                   Nav + instrument-area layout
  index.css                 Theme CSS variables + shared control styles  ← all colors live here
  core/                     Pure math/logic, NO React imports
    signal.ts               Signal gen + FFT (protected — see CLAUDE.md)
    scope.ts                NEW: oscilloscope timebase/trigger math
    trigger.ts              NEW: trigger engine (may live inside scope.ts if small)
    spice.ts                NEW: SpiceEngine adapter interface + eecircuit-engine impl
    netlist.ts              NEW: Circuit graph → ngspice netlist string
  components/
    Instrument.css          Shared instrument panel layout
    SignalGenerator.tsx
    SpectrumAnalyzer.tsx
    Oscilloscope.tsx        NEW
    SchematicEditor.tsx     NEW (later)
docs/                       This planning set
```

Rules:

- **`core/` never imports React.** It is plain TypeScript with typed inputs/outputs
  (`Float64Array`, plain interfaces). This keeps the math unit-testable and is why the
  existing pipeline is trustworthy. New math goes in `core/`, not in components.
- One instrument = one component file in `src/components/`, following the existing
  `SignalGenerator` / `SpectrumAnalyzer` shape.
- Shared layout classes live in `components/Instrument.css`. Per-feature one-off styles
  may live in the component-adjacent CSS, but **colors always come from CSS variables in
  `index.css`** (section 6).

---

## 4. State architecture and the channel bus

Today `App.tsx` owns `params` (one `SignalParams`) and a derived `signal`, passed to both
instruments. The animation loop bumps a `tick` ~10×/s so noise shimmers.

Two channels and the future circuit loop need a small generalization. Introduce a
**channel bus** in `App.tsx` (this is itself a roadmap phase — see ROADMAP `ARCH-1`; do not
build it ad hoc):

```typescript
type ChannelId = 'CH1' | 'CH2'

interface ScopeChannel {
  id: ChannelId
  enabled: boolean
  source: ChannelSource     // where this channel's samples come from
  // view settings (volts/div, vertical offset, color) live in the component
}

type ChannelSource =
  | { kind: 'generator' }          // current SignalGenerator output
  | { kind: 'generator2' }         // a second independent generator (standalone two-channel)
  | { kind: 'circuit-out' }        // SPICE circuit output node (later)
```

Principles:

- **App.tsx owns shared signal data and params.** Instruments receive samples as props.
- **View-only state stays component-local** (volts/div, time/div, window type, trigger UI
  state, persistence buffers). This matches how `SpectrumAnalyzer` already keeps `bits`,
  `windowType`, `freqMax` locally.
- Components are **pure functions of their props + local view state.** No cross-component
  imperative coupling.
- The bus is the seam the circuit loop later plugs into: `CH2.source` flips from
  `generator2` to `circuit-out` without the Oscilloscope component changing.

Until `ARCH-1` lands, the Oscilloscope reads the existing single `signal` prop for CH1.

---

## 5. Plotly usage pattern

Follow `SpectrumAnalyzer.tsx` exactly:

- Render into a `<div ref={...} className="plotly-display">`.
- Drive Plotly from a `useEffect` keyed on the data + view settings. Use
  `Plotly.react(node, data, layout, config)` for updates (not `newPlot` on every frame).
- The spectrum intentionally does **not** memoize its result so noise shimmers each tick.
  The **oscilloscope time-domain trace is deterministic** for given params — it does not
  need per-tick re-randomization, but it must still re-render when the trigger re-arms or
  the signal/params change. Do not copy the shimmer behavior blindly.
- Keep Plotly `layout` consistent with the dark theme: `paper_bgcolor` / `plot_bgcolor`
  from the display background, gridlines low-contrast, fonts small (11–12px).
- Always pass `{ displayModeBar: false, responsive: true }` in config unless a phase
  explicitly needs the modebar.

---

## 6. Theme and CSS

All colors are CSS custom properties in `src/index.css`. Never hardcode a hex color in a
component or in `Instrument.css` — reference a variable. Existing variables include:

- `--ch1-color: #f0a030` (orange, Scopy CH1)
- `--accent-blue: #4a9eff`
- `--bg-display: #0d0d0d`
- `--bg-panel: #2a2a2a`
- `--theory-color: #44dd88` (green, Learning Mode)
- `--border`, `--text-primary`, `--text-secondary`, `--accent-orange`

New variables this roadmap will add (define them in `index.css` when first needed):

- `--ch2-color` — second scope channel. Use a Scopy-like blue/cyan, e.g. `#40c0e0`.
- `--trigger-color` — trigger level marker, e.g. `#dddd44` (yellow).
- `--node-color`, `--wire-color` — schematic editor.

If a phase needs a new color, add the variable in `index.css` in the same commit and
reference it. Keep the Scopy dark aesthetic: near-black displays, mid-gray panels,
saturated channel colors.

---

## 7. Definition of Done (every phase, no exceptions)

A phase is not done until **all** of these pass:

1. **`npm run build` is clean** — `tsc` reports zero errors and Vite builds. No `// @ts-ignore`
   or `any` added to make it pass. Strict typing holds.
2. **No console errors** in the dev server for the feature's normal use.
3. **Signal-math regression check** — the existing pedagogy still holds with default params
   (square, 1 kHz, 100 kSa/s, 16 ms). Specifically: open the Spectrum Analyzer at 12-bit /
   Hanning and confirm the noise floor still sits near **−104 dBFS** with no leakage spikes
   between harmonics. Any change that moves this is a regression — revert it. (This is the
   canary for accidentally breaking `tau`, the window denominator, Bluestein, or the
   synthetic-noise model. See `CLAUDE.md` "Things NOT to change".)
4. **Core math has a sanity check** — if the phase added logic to `core/`, it ships with at
   least a minimal verification (a Vitest test if the harness exists, otherwise a documented
   manual check in the PROGRESS entry with expected vs actual numbers).
5. **`docs/PROGRESS.md` updated** and **`docs/ROADMAP.md` status flipped.**
6. **One focused commit** (section 8).

---

## 8. Git commit convention

One commit per phase. Message format:

```
<area>: <phase id> <short imperative summary>

- what changed (1–4 bullets)
- verification: build clean, 12-bit floor at −104 dBFS confirmed
```

`<area>` ∈ `scope`, `spice`, `schematic`, `arch`, `docs`. Example:

```
scope: OSC-1 add Oscilloscope panel with timebase and CH1 trace

- new src/components/Oscilloscope.tsx + src/core/scope.ts
- nav entry + split-view wiring in App.tsx
- verification: build clean; spectrum 12-bit floor still −104 dBFS
```

Do not bundle unrelated changes. Do not commit `dist/`, `node_modules/`, or scratch files.

---

## 9. Coding style

- TypeScript strict. No `any`; prefer precise types and discriminated unions (the
  `ChannelSource` pattern above is the house style).
- Pure functions in `core/`; side-effect/UI logic in components.
- Keep functions small and named for what they compute. Comment the *why*, not the *what* —
  match the density of comments already in `signal.ts` for any non-obvious math.
- No premature abstraction. Two channels do not need a plugin system; a discriminated union
  and a couple of props are enough.
- Match existing formatting (2-space indent, single quotes, no semicolon-heavy style — mirror
  the current files).

---

## 10. Performance

- Per-frame work belongs in `core/` pure functions; components just render.
- The scope trigger search runs on each new frame — keep it O(N) over the capture buffer.
- **SPICE simulation must not block the main thread.** Run `eecircuit-engine` in a Web
  Worker (the adapter in `core/spice.ts` exposes an async API so the worker boundary is
  invisible to callers). Transient/AC sweeps can take tens of ms+.
- Debounce live re-simulation when a schematic component value is dragged.

---

## 11. Deployment constraint (easy to break)

`vite.config.ts` sets `base: '/benchbridge/'` for GitHub Pages. Any asset that is fetched
at runtime — **including the ngspice `.wasm` binary** — must resolve correctly under that
base path, not assume site root. When wiring up `eecircuit-engine`, verify the WASM loads
from a production `npm run build && npm run preview`, not just `npm run dev`. This is called
out again in the SPICE spec because it is the most likely integration failure.
