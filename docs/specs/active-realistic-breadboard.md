# SPEC — Track L: Active + Realistic Breadboard ("Fritzing that runs")

Read `docs/CONVENTIONS.md`, `docs/specs/breadboard.md`, and `docs/specs/board-autoroute.md` (F-7) first.
**Board / UI + a read from the EXISTING sim — no `core/signal.ts` change** (12-bit canary untouched
throughout). This is the flagship: the interactive, realistic breadboard is the acquisition hook, the thing
that makes the sim-able labs come alive, and the honest *bridge to bench*. Builds on the shipped breadboard
(model + `checkEquivalence` + DIP/TO-92 footprints + F-5 terminal strips) and folds in **F-7 auto-route**.

**Key architectural fact (why "active" is tractable):** the board is Check-verified **equivalent to the
schematic**, and the schematic already runs through ngspice in `App.tsx`'s circuit loop. `core/spice.ts`
already reads a node's voltage from an `.op`/`.dc` result (~L302) and a source's branch current (~L350). So
the live values already exist — **"active" is mostly binding the existing sim state onto the board render via
the net↔node equivalence, not new simulation.**

Do one phase per session (CONVENTIONS). Phases:

---

## ARB-1 — Realistic part visuals (the "realistic")
Today parts render as basic SVG shapes (e.g. a resistor is a dark `<rect>`, `Breadboard.tsx` ~L53). Upgrade
to **realistic component bodies, scoped to the ADALP2000 kit** (do NOT build a generic thousands-part library):
- **Resistor:** beige/blue body with **color bands derived from the value** (E-series color code) — a teaching
  bonus (students read the bands). Leads bent to the existing hole span.
- **Capacitor:** ceramic disc vs electrolytic can (polarity stripe) per the part.
- **Diode / Zener / LED:** diode body with cathode band; **LED as a domed LED** (color) — reused as the live
  indicator in ARB-2.
- **DIP ICs:** black DIP body with a **pin-1 notch/dot** + label (reuse `DIP_DEFS`).
- **Transistor:** TO-92 half-moon body, legs to the 3 columns.
- **Jumpers:** coloured insulation, keeping the existing net/power colour convention.

**Scope:** pure rendering in `Breadboard.tsx` (+ a small part-visuals helper). The board **model**
(`breadboard.ts`) and `checkEquivalence` are **untouched**. No sim dependency.

**DoD:** parts read as real components; resistor bands match the value; DIP pin-1 shown; jumpers coloured;
the board still Checks identically; `npm run build` clean; no `core/signal.ts` / model / Check change.

---

## ARB-2 — Active / live board (the "active" leap)
Bind the **already-computed** sim state to the board so components behave **in place**. The board's nets map
to the schematic's nodes via the existing equivalence; overlay live values:
- **On-board node-voltage probe/readout:** hover or drop a probe on a hole/column → show that node's **live
  voltage** (from the schematic's `.op`/`.dc` result via `spice.ts`); optionally colour nodes by voltage.
- **Live component indicators — LED glow (marquee demo):** LED brightness ∝ its forward current → the
  **"Driving an LED with PWM/analog-PWM" labs work in sim** (see `docs/private/LAB-LIBRARY.md`). Derive the LED
  current from node V + the diode model (or an ngspice device current); low-PWM-freq flicker optional.
- **On-board DMM/probe** the student places on the board and reads live V (mirrors the bench).

**Needs (flag in PROGRESS):** a live operating-point evaluation of the board circuit (reuse the circuit-sim
loop; an `.op` or time-averaged `.tran` gives the DC state + device currents), and the **net↔node map** to
place values (from the equivalence check). **A sim READ path only — no `core/signal.ts`, no new analysis
structure.**

**DoD:** an LED on the board **glows/dims with current** (PWM-LED lab demonstrated in sim); the on-board probe
reads the **correct live node voltage** and **matches the scope** for the same node; build clean; **12-bit
canary confirmed unaffected** (no signal path change).

---

## ARB-3 — Auto-route (folds in F-7)
The three-state **manual / hint / auto** jumper control per `docs/specs/board-autoroute.md`. Build it as the
interaction layer of the realistic board (or, if F-7 already shipped, integrate/verify it here). Same DoD as
the F-7 spec; the `hint`/`auto` overlays should render in the ARB-1 realistic style.

---

## Out of scope / not changing
- **No `core/signal.ts`** and no FFT/window/noise-model change (canary is the standing invariant).
- **No PCB view**; **no generic thousands-part library** — realistic visuals are **kit-scoped**.
- `checkEquivalence` / `boardNets` semantics unchanged (ARB-1/2 render on top of them, don't alter them).
- No new ngspice `Analysis` directive structure (ARB-2 reuses `.op`/`.tran`/`.dc` reads).

## Files: allowed / forbidden
**Allowed:** `src/components/Breadboard.tsx` (rendering + active overlay), a new part-visuals helper,
`src/App.tsx` (wire the live sim state → board), `src/core/breadboard.ts` **only** if a net↔node map accessor
or a device-current helper is needed (flag in PROGRESS), read-only use of `core/spice.ts` node/current
readers, `docs/PROGRESS.md`, `docs/ROADMAP.md`, this spec (+ `board-autoroute.md` for ARB-3).
**Forbidden:** `core/signal.ts`; the protected FFT/window/noise math; changing `checkEquivalence`/`boardNets`
behaviour. If a phase seems to need any of these, stop and flag in PROGRESS.

## Sequencing
AFTER the shipped FB punch-list (done). **ARB-1 (visuals) → ARB-2 (active) → ARB-3 (auto-route/F-7).** Each is
its own phase + focused commit; each ships user-visible value on its own.
