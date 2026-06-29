# SCOPING — Breadboard view crowding (schematic + board)

Status: **scoping only, not an approved phase.** Drafted 2026-06-28 with andre. No code yet.
Decide direction, then promote the chosen option into a real phase spec / ROADMAP row.

This does **not** touch `core/signal.ts`; the 12-bit canary is unaffected by any option here.

---

## Problem

The `breadboard` view in `App.tsx` stacks two full instruments in one `100vh` flex column:
`SchematicEditor` on top, `Breadboard` below, each `.stacked-pane` getting ~50vh
(`App.tsx` case `'breadboard'`, ~lines 391-403). Both are dense, canvas-heavy panels that each
want most of the screen. Stacked at 50/50 they are cramped: the schematic loses working canvas
and the board is squeezed, which is the crowding andre flagged.

This is a **build-workflow** problem (drawing a circuit and transferring it to the board), not the
first-year measurement flow (gen/scope/spectrum), which the E-1 presets already serve well. So a
fix here can be opt-in for the build workflow without disturbing the curated student path.

Origin: the stacked (not side-by-side) layout was a deliberate Track F decision so students see
schematic-above / board-below as a transfer metaphor. The metaphor is good; the fixed 50/50 split
is what hurts on smaller screens.

---

## Options (cheapest to heaviest)

### Option 1 — Targeted fix inside the breadboard view (no new dependency)

Keep the single combined view; change only how the two panes share space. Variants, not mutually
exclusive:

- **Splitter:** a draggable horizontal divider between the two `.stacked-pane`s so the user sets
  the ratio (and it persists to localStorage like the schematic autosave). Smallest change.
- **Tab toggle:** Schematic | Board tabs, one full-height at a time, preserving the transfer
  metaphor via a quick switch. Best for small screens; loses the at-a-glance side-by-side compare.
- **Orientation toggle:** stacked (default, keeps the metaphor) vs side-by-side for wide monitors.
- **Collapse:** a chevron to temporarily minimize one pane to a header strip.

Likely best combo: **splitter + remembered ratio**, plus an **orientation toggle** for wide
monitors. Preserves the Track F metaphor, directly fixes the squeeze, ships in one session, no
dependency, no `core/signal.ts`.

Cost: low. Risk: low. Files: `App.tsx` (the `'breadboard'` case), `App.css`/`Instrument.css`,
maybe a tiny `useState` + localStorage key. No new dependency.

### Option 2 — E-2 true docking (dockview), breadboard as docked groups

Adopt dockview (already the Track E preferred lib). Schematic and Board become dockable panels the
user can tab, float, resize, and **pop out into a separate native window** (dockview popout groups
render via React portal, so the panel stays in the one React tree and keeps shared state). The
popout is the safe way to get the "board on a second monitor" feel without separate webpages.

Cost: high. New **core runtime dependency** → CONVENTIONS §2 note + director sign-off before
install. Rewrites the `<main>` render block in `App.tsx`. The breadboard's special combined case
has to be re-expressed in the generic docking model. Pedagogy caution (spec): free docking can
confuse first-years, so keep presets the default and docking the advanced surface.

Verify before committing: dockview popout support on this version, and that its CSS/assets resolve
under the `/BridgeM2K/` base path (CONVENTIONS §11).

### Option 3 — Separate webpages / windows (NOT recommended as a first move)

Truly separate pages fight the architecture: `App.tsx` is a single React tree owning `params`,
`signal`, `schematic`, `board`, the shared undo/redo history, and it runs the rAF animation loop
and the circuit-sim loop. A separate page is a separate JS context with no shared state, so this
needs cross-window state sync (BroadcastChannel / SharedWorker / shared store) and re-hosting the
sim loop. Large change, real risk. The legitimate goal behind it (a board window on a second
monitor) is better met by Option 2's popout group.

---

## Recommendation

Two reasonable paths depending on appetite:

1. **Option 1 now.** Stops the pain this session with a splitter + remembered ratio + orientation
   toggle, no dependency, no risk to the canary. Likely sufficient for the course.
2. **Option 1 now, Option 2 later** only if a broader multi-instrument docking / multi-monitor need
   proves out in use. Don't take on the dockview dependency just to fix one cramped view.

Option 3 is parked.

---

## Open questions for andre

- Is the squeeze mainly on **small laptops**, or also on big monitors? (If small-only, the splitter
  + tab toggle is plainly enough; if you want board-on-second-monitor, that pushes toward Option 2
  popout.)
- Keep the stacked transfer metaphor as the **default**, with side-by-side as an option? (Assumed
  yes.)
- Should the chosen layout/ratio **persist** per user (localStorage), like the schematic autosave?
  (Assumed yes.)

---

## DECISION (andre, 2026-06-28)

Do **Option 1** as a Claude Code phase. Option 2 (E-2 dockview) and Option 3 (separate pages)
are parked. This is now phase **F-6** in `docs/ROADMAP.md` (status TODO). The section below is the
spec a CC session executes; the analysis above is context.

---

## Phase F-6 — Breadboard-view layout controls

**Depends on:** F-2 (the combined schematic+board view exists). No new dependency.

**Goal:** make the combined `breadboard` view usable on smaller screens by letting the user
re-divide the two panes and switch orientation, instead of a fixed 50/50 vertical stack.

**Implement:**

- **Draggable splitter.** Replace the fixed two-`.stacked-pane` split in `App.tsx` (the
  `'breadboard'` case, ~lines 391-403) with a resizable divider between SchematicEditor and
  Breadboard. Dragging it sets the split ratio. Keep it a thin, themed handle (color from a CSS
  variable in `index.css`, per CONVENTIONS §6 — reuse `--border` or add one).
- **Remembered ratio.** Persist the ratio to `localStorage` (new key, e.g. `m2k-board-split-v1`),
  mirroring the existing schematic-autosave persistence pattern. Restore on load; fall back to 50/50.
- **Orientation toggle.** A small control (in the view or nav) toggling **stacked** (default, keeps
  the Track F transfer metaphor) vs **side-by-side** (column) for wide monitors. Persist the choice
  (e.g. `m2k-board-orient-v1`). The same ratio state drives whichever axis is active.
- Keep both panes mounted and pure functions of their props; this is layout only. Do not lift any
  SchematicEditor/Breadboard internal state, and do not change their props.
- No mid-drag layout thrash: the panes already hold canvas-heavy children, so resize via flex-basis
  / grid-template percentages, not by remounting. Ensure Plotly-bearing children (if any) still get
  a resize signal if the existing code relies on one.

**Acceptance criteria:**

- The splitter drags smoothly; releasing keeps the ratio; reload restores it from localStorage.
- Orientation toggles stacked↔side-by-side with no remount errors; ratio persists per orientation
  use is acceptable (single shared ratio is fine for this phase).
- Default (first load, cleared storage) is the stacked 50/50 view — no behavior change for an
  existing user who never touches the controls.
- `npm run build` clean (`tsc` zero errors, no `any`/`@ts-ignore`); no console errors in normal use.
- **12-bit canary holds** at −104 dBFS (signal path untouched — confirm per DoD §7.3 regardless).
- `docs/PROGRESS.md` appended; `docs/ROADMAP.md` F-6 flipped to DONE; one focused commit
  (`docs`/`schematic` area per §8 — use the area that best fits; layout lives in `App.tsx`).

**Files: allowed** — `App.tsx` (the `'breadboard'` case + any small split state), `App.css` /
`components/Instrument.css` (splitter + orientation styles), `index.css` (only if a new color/
variable is needed), `docs/PROGRESS.md`, `docs/ROADMAP.md`, this spec.
**Files: forbidden** — `core/signal.ts` and the instruments' math; `SchematicEditor.tsx` /
`Breadboard.tsx` internals (no prop or state changes — this phase is purely the container layout).

---

## Parked (not this phase)

- **Option 2** is exactly **E-2** in `docs/ROADMAP.md`, with the breadboard combined view added to
  its acceptance set and the **popout-to-separate-window** requirement called out (the safe way to
  get the multi-monitor feel). Needs the CONVENTIONS §2 dependency sign-off first.
- **Option 3** (truly separate webpages) stays parked — it fights the single-React-tree state model.
