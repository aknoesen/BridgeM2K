# SPEC — Dockable panels + saveable workspaces (Track E)

Goal: let a student (or instructor) arrange several instrument panels on screen at once,
snap them into tidy layouts, and save/restore that arrangement, so the twin can present a
lab-appropriate bench (e.g. Signal Gen + Spectrum for Lab 3, Circuit + Network for Lab 5)
instead of one full-window instrument at a time.

Read `docs/CONVENTIONS.md` first. This is a **cross-cutting layout change** that rewrites
the `<main>` render block in `App.tsx`. It does not touch `core/signal.ts` — the 12-bit
canary must hold throughout.

---

## Why this is sequenced after the circuit-loop MVP (do not start mid-feature)

The instrument set is still growing (WIRE-3, OSC-3..5, LOOP-2). Docking is a refactor of how
panels are mounted; doing it while panels are still being added means re-doing it. Land the
circuit-loop MVP first, then do this on a stable set of instruments.

---

## The two-tier cost (decision the director makes before E-2)

There are two independent things a "workspace" can persist. They have very different costs.

| Layer | What it saves | Cost | Notes |
|-------|---------------|------|-------|
| **Geometry** | which panels are open, where, what size | low | a docking lib serializes this to JSON for free; localStorage pattern already exists (schematic autosave) |
| **Instrument config** | each instrument's settings (spectrum `bits`/`windowType`/`freqMax`, scope time/div + per-channel volts/div, persistence toggles, etc.) | high | much of this lives in **component-local `useState`** today; saving it forces lifting that state up or adding a `serialize()`/`restore()` contract per instrument — this touches every component |

CONVENTIONS §4 deliberately keeps view-only state component-local. Layer 2 partially reverses
that for the instruments whose settings we want to persist. **That is the real scope.** Decide
explicitly per phase which layer is in scope; do not let E-2 silently grow into a full state
refactor.

---

## Engine decision — adopt a serializable docking library, do not hand-roll

Hand-building drag targets, snap highlights, resize handles, and split ratios is a large pile
of fiddly edge-case code. Two libraries fit this stack (React 19 + TS + Vite) and both
serialize their layout to JSON, which makes the geometry layer of "save workspace" nearly free:

- **dockview** — TS-native, modern, panels-as-React-components, layout `toJSON()`/`fromJSON()`,
  active maintenance. Preferred default.
- **rc-dock** — docking + tab groups + float + maximize, `saveLayout()`/`loadLayout()` built in.
  Heavier UI, more "IDE", also fine.

Adding either is a **new core runtime dependency** → per CONVENTIONS §2 it requires a note in
PROGRESS and director sign-off before install. Keep it behind a thin wrapper component
(`components/Workbench.tsx`) so the lib can be swapped, mirroring the `SpiceEngine` adapter
pattern. golden-layout / FlexLayout are fallbacks; do not install now.

---

## Phase E-1 — Preset snap layouts (no new dependency)

**Goal:** deliver most of the pedagogical value cheaply by generalizing the existing
`single | split` mode into a small set of named, lab-keyed layouts. No drag-docking, no new
dependency.

**Why first:** real Scopy has a fixed tool menu, not free docking. For first-year students,
free-form docking invites "I lost my Spectrum panel" confusion. Presets give a curated bench
per lab with a fraction of the complexity, and they are a clean stepping stone to E-2.

**Implement:**
- Replace the `LayoutMode = 'single' | 'split'` enum with a `WorkspacePreset` model: an ordered
  list of visible panel ids plus an arrangement hint (e.g. `'single' | 'row' | 'col' | 'grid'`).
- A preset picker in the nav. Seed presets:
  - **Lab 3 — Spectrum:** Signal Gen + Spectrum (the current split view).
  - **Lab 5 — Circuit:** Circuit editor + Network Analyzer.
  - **Bench:** Scope + Power Supply + Voltmeter.
  - **Single:** any one instrument full-window (current default behavior).
- CSS grid in `instrument-area` drives the arrangement; panels render in `compact` mode when
  more than one is visible (the `compact` prop already exists on SignalGenerator/SpectrumAnalyzer
  — extend the others as needed).
- Persist the **selected preset id** to localStorage (geometry layer, trivial).

**Acceptance criteria:**
- Switching presets rearranges panels with no remount errors; each panel stays a pure function
  of its props + local state (CONVENTIONS §4).
- Build clean; **12-bit floor at −104 dBFS confirmed** in the Spectrum preset.
- No new runtime dependency.

**Files allowed:** `App.tsx`, `App.css`, the instrument components (only to accept `compact`),
docs. **Forbidden:** `core/signal.ts`, the instruments' math.

---

## Phase E-2 — True dockable panels via docking library (geometry workspace)

**Depends on:** E-1, director sign-off on the dependency.

**Goal:** free drag-to-dock, snap zones, and resizable splits, with the **panel arrangement**
saved and restored as a named workspace. Geometry layer only — instrument config still lives
component-local (Layer 2 is E-3, optional).

**Implement:**
- Install the chosen lib (dockview preferred). Note it in PROGRESS with the why.
- `components/Workbench.tsx` wraps the lib and maps panel ids → instrument components. App.tsx
  passes the same props it does today; the wrapper is the only thing that knows the lib's API.
- Drag to dock/split/tab; resize handles; snap to edges. (Lib-provided.)
- **Save / load workspace:** serialize the lib layout to JSON. Two surfaces:
  - autosave current layout to localStorage (survives reload), and
  - explicit Save/Open named workspace as a `.json` file, reusing the schematic Save/Open UX
    pattern in `SchematicEditor.tsx` for consistency.
- Verify the lib's CSS/assets resolve under the `/BridgeM2K/` base path (CONVENTIONS §11).

**Acceptance criteria:**
- Panels dock, snap, resize, and tab without console errors; UI stays responsive.
- A saved workspace round-trips: save → reload/clear → load restores the same arrangement.
- Build clean under `npm run build && npm run preview` (not just dev); **12-bit canary holds.**

**Files allowed:** `App.tsx`, new `components/Workbench.tsx`, `package.json`/lockfile (the one
dep), `vite.config.ts` (only if asset config needed — document it), docs.
**Forbidden:** `core/signal.ts`, the instruments' math.

---

## Phase E-3 — Full workspace config (instrument settings) — OPTIONAL, scope-gated

**Depends on:** E-2. **Do not start without an explicit decision that Layer 2 is wanted.**

**Goal:** a saved workspace also restores each instrument's settings, not just panel geometry.

**Implement:**
- Give each instrument a serializable settings contract: either lift its view state into a typed
  `settings` prop owned by App.tsx, or expose `serialize()`/`restore(json)`. Pick one pattern and
  apply it uniformly. This is the part that touches every component — budget for it.
- Fold instrument settings into the workspace JSON from E-2.

**Acceptance criteria:**
- Save a workspace with non-default instrument settings (e.g. Spectrum at 8-bit/Blackman, Scope
  at 1 ms/div), reload, load → settings come back exactly.
- Build clean; **12-bit canary holds** (lifting state must not perturb the default-params path).

**Files allowed:** all instrument components, `App.tsx`, docs.
**Forbidden:** `core/signal.ts`.

---

## Recommended order and shippability

1. **E-1** — presets. Ships real value immediately, no dependency, low risk. Possibly the
   stopping point if free docking proves to be more confusion than benefit for first-years.
2. **E-2** — true docking + geometry workspace. Adopt dockview; do not hand-roll.
3. **E-3** — full-config workspace. Only if the geometry-only save proves insufficient in use.

Decide E-1-vs-E-2-vs-E-3 from observed student/instructor need, not up front. E-1 alone may be
the right answer for the course.
