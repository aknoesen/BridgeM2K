# SPEC — Breadboard layout + schematic-to-bench transfer (Track F)

Goal: let a student transfer a drawn schematic onto a **solderless breadboard** by making their
own layout choices — seating components and running jumpers — and have the twin verify the board
is *electrically the same circuit* as the schematic. This bridges the Lab 1/2 gap between the
ideal schematic and the physical bench.

Read `docs/CONVENTIONS.md` first. New net/verify logic lives in `src/core/`, the editor UI in a
new `src/components/Breadboard.tsx`. Does not touch `core/signal.ts` — the 12-bit canary holds.

---

## Decisions (made — do not re-litigate without sign-off)

- **The centerpiece is a verification loop, not the drag.** The tool's value is telling the
  student whether their physical wiring matches the schematic netlist. Everything else serves that.
- **Parametric SVG breadboard, not a photo.** A breadboard is perfectly regular (0.1" pitch,
  power-rail pairs, two 5-hole terminal banks split by a center channel). Generate it as SVG:
  crisp at any zoom, theme-able, exact hole coordinates, no photo licensing/alignment. (A photo
  skin is a possible later cosmetic, not needed.)
- **Two modes on the same board (the pedagogy in one switch):**
  - *Practice* (default): live net colouring as they wire; common holes share a colour. Training wheels.
  - *Bench/Exam*: no colouring, no hints — the student places from their own mental model of
    breadboard connectivity, then hits **Check**. Doubles as graded transfer. This is the "sneaky" mode.
- **Drag from the schematic**, not a blank parts bin, so each placed part keeps its identity
  (`R1`, value) and the verifier can match by name.
- **Stacked layout**: schematic on top, breadboard below (NOT side-by-side). Dragging a part
  downward from the schematic onto the board.
- **2-pin parts first** (R, C, L, jumpers). DIP/IC footprints (op-amp, INA) are a later phase.
- **Reuse the existing net engine.** A breadboard is just another way to define nets; feed its
  holes + internal connections + jumpers + component legs to `computeNets`.

---

## Breadboard model

A breadboard imposes a fixed internal connectivity that the student must respect:

- **Terminal strips:** two banks (rows `a–e` and `f–j`) of N columns. Each column of 5 holes in
  a bank is internally common. The two banks are separated by the **center channel** (not connected).
- **Power rails:** a `+` bus and a `–` bus along the top, and another pair along the bottom; each
  bus runs the length of the board. (Model rails as continuous for EEC1 to start; real boards often
  split mid-board — note it, add later if a lab needs it.)
- Start with a modest size (e.g. **30 columns**) — a full 63-column board is visually overwhelming
  for a first-year and adds nothing pedagogically.

Implementation: each hole has a grid coordinate. A pure function pre-unions holes into their
internal groups (each bank-column, each rail). `core/breadboard.ts` exposes the geometry + the
internal-connection groups so both rendering and net computation read one source of truth.

**M2K I/O:** the flywires (`W1 W2 1+ 1- 2+ 2- V+ V- GND`) are ports the student lands on a rail or
column, named and coloured exactly like the schematic's breadboard ports (mirrors Lab 1). They
anchor the verification (the schematic's `W1` net must equal the board's `W1` net).

---

## The verification (centerpiece)

Two circuits are equivalent when the **partition of pins into nets** matches on both sides.

1. Build the shared pin universe: every component pin (`R1.a`, `C1.b`, …) plus every named M2K
   port (`W1`, `GND`, `1+`, …).
2. Schematic side: from `toCircuit` / `computeNets`, map each pin → its schematic net.
3. Breadboard side: run `computeNets` over the board (internal groups + jumpers + component legs +
   ports) → map each pin → its breadboard net.
4. **Equivalent iff** two pins share a schematic net exactly when they share a breadboard net.
   Named ports anchor the mapping, so this also catches "wired, but to the wrong rail."

Feedback is precise and per-connection:
- a pin pair together in the schematic but not on the board → *"R1.b and C1.a should be the same
  node — run a jumper."*
- a pair together on the board but not in the schematic → *"you've shorted W1 and GND."*

This is a pure function in `core/breadboard.ts` (testable without React), diffing two
`computeNets` partitions.

---

## Phase F-1 — Breadboard model + SVG render + net colouring

**Implement:**
- `core/breadboard.ts`: board geometry (holes, bank columns, rails, channel), internal-connection
  groups, and a `boardNets(layout)` that runs `computeNets` over internal groups + jumpers +
  placed legs + ports.
- `components/Breadboard.tsx`: parametric SVG board (holes, rail stripes, channel, labels) under
  the schematic in a stacked view; nav entry. Place the M2K ports.
- **Practice-mode net colouring:** holes in the same net share a colour (live).
- Mode toggle Practice/Bench (Bench just disables colouring/hints for now; components come in F-2).

**Acceptance criteria:**
- The SVG board renders to scale with correct internal groups; hovering/colouring shows that a
  bank column of 5 is common and a rail runs the length.
- `boardNets` unit-tested: a jumper between two columns unions them; the channel keeps banks apart.
- Build clean; canary holds.

**Files:** `core/breadboard.ts` (+test), `components/Breadboard.tsx`, `App.tsx` (nav/stacked view),
`index.css`/`Instrument.css`, docs.

---

## Phase F-2 — Drag 2-pin parts + jumpers + verification loop

**Depends on:** F-1, SCH-1 (schematic provides the parts).

**Implement:**
- Drag a 2-pin component from the schematic onto the board; its legs seat in two holes (carry id +
  value). Move/delete placed parts.
- Jumper-wire tool (hole-to-hole), including to rails and ports.
- **Check** button → the equivalence diff from `core/breadboard.ts`; show match (green) or the
  specific offending connection. In Practice, also colour live; in Bench, only reveal on Check.

**Acceptance criteria:**
- Transferring the default RC (W1→R→node→C→GND, 1+/2+ on the right nodes) and wiring it correctly
  → Check reports equivalent; removing one jumper → Check names the broken node.
- Equivalence function unit-tested (match, missing connection, accidental short).
- Build clean; canary holds.

**Files:** `core/breadboard.ts` (+test), `components/Breadboard.tsx`, `App.tsx`, docs.

---

## Phase F-3 — (Stretch) DIP/IC footprints + optional hint

- DIP footprint straddling the center channel (op-amp, INA) with pin order; enforce "straddle the
  channel."
- Optional **"show one valid layout"** hint for stuck students (auto-place + auto-jumper one
  solution). Verify-only ships first; this is a stretch.

---

## Notes

- Out of scope for now: realistic rail splits, wire colour grading, photo skin.
- None of Track F touches `core/signal.ts`; the 12-bit canary must hold throughout.
- This is the schematic→bench transfer milestone: once F-2 ships, a student can draw a circuit,
  build it on the virtual board, and prove the two match before touching real hardware.
