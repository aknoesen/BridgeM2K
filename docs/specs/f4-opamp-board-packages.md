# SPEC — F-4: Per-part op-amp board packages (+ in-amp, + optional layout hint)

Read `docs/CONVENTIONS.md`, `CLAUDE.md`, and `docs/PROGRESS.md` first. Board/UI only — **does not
touch `core/signal.ts`** (12-bit canary unaffected). This supersedes the vague "remaining DIP
footprints (op-amp, INA)" wording of the ROADMAP F-4 row with the concrete, default-path bug below.

## The bug this fixes (default path is wrong)

After SCH-9 the schematic op-amp is a selectable ADALP2000 kit part (`c.part`, default **OP484**), but
the breadboard ignores `c.part` and **hardcodes the LMC662**: `breadboard.ts` pushes `kind: 'lmc662'`
(8-pin dual) for every `kind === 'opamp'`, and `Breadboard.tsx` hardcodes the name (`DIP_NAME.lmc662 =
'LMC662'`), the pin-function list (`LMC662_FN`), and the legend SVG text "LMC662". So adding an **OP484
(a 14-pin quad)** and going to the board shows an **8-pin "LMC662"** — wrong name, wrong pin count,
wrong pinout, on the most common path. The LMC662 is not even a kit part (it's the off-kit fallback).

## Package reality (from `core/opamps.ts` — already encoded)

| Parts | `package` | `channels` | Board footprint |
|-------|-----------|-----------|-----------------|
| OP27, OP37, OP97 | `8-DIP` | 1 (single) | 8-pin DIP, **single** op-amp pinout |
| OP482, OP484 | `14-DIP` | 4 (quad) | 14-pin DIP, **quad** pinout (use amp A) |
| ~~ADTL082, AD8542~~ | `BOB` | 2 | **REMOVED from the kit library** (breakout boards, not breadboard DIPs — andre 2026-06-28). Delete from the catalog; do not board. |
| LMC662 (off-kit fallback) | — | 2 (dual) | 8-pin DIP, **dual** pinout (today's behavior — keep) |
| INA125 (in-amp) | — | — | 16-pin DIP — **already boards; keep working** |

Standard pinouts (1-based; map the schematic's one used amp + rails, leave others unused):
- **Single 8-DIP:** 1 NULL, 2 −IN, 3 +IN, 4 V−, 5 NULL, 6 OUT, 7 V+, 8 NC → used: −IN2, +IN3, OUT6, V−4, V+7.
- **Dual 8-DIP (LMC662):** 1 OUTA, 2 −A, 3 +A, 4 V−, 5 +B, 6 −B, 7 OUTB, 8 V+ → used amp A: OUTA1, −A2, +A3, V−4, V+8 (today's mapping).
- **Quad 14-DIP:** 1 OUTA, 2 −A, 3 +A, 4 V+, 5 +B, 6 −B, 7 OUTB, 8 OUTC, 9 −C, 10 +C, 11 V−, 12 +D, 13 −D, 14 OUTD → used amp A: OUTA1, −A2, +A3, V+4, V−11.

The DIP geometry is already parametric (`dipCols` splits pins across two rows; 8→4 cols, 16→8), so a
14-pin DIP (→7 cols) needs only the pin data, not new geometry.

## DECISIONS

**D1 — BOB duals removed (decided, andre 2026-06-28).** ADTL082 and AD8542 ship as breakout boards, not
breadboard DIPs, so they are **dropped from the kit op-amp library entirely** rather than boarded. This
eliminates the BOB problem — every remaining kit op-amp is a DIP. Implementation Step 0 deletes them.

**D2 — "Show one valid layout" hint (the optional half of F-4).** A button that auto-places a known-good
board layout for the current schematic, as a learning aid. *Recommendation:* keep it **optional /
secondary** — the package correctness fix is the must; ship the hint only if it fits cleanly in the
same session, else split to F-4b.

## Implement

- **Step 0 — remove ADTL082 and AD8542 from the kit op-amp library.** Delete their entries from
  `OPAMP_CATALOG` (`core/opamps.ts`); they then vanish from the schematic picker (it lists the catalog).
  Verify no example uses them (`core/examples.ts` — amps default to OP484), update `opamps.test.ts`
  catalog assertions, and update the op-amp lists in `README.md` and `CLAUDE.md` to the **5 kit op-amps**
  (OP27, OP37, OP97, OP482, OP484). After this, every kit op-amp is a DIP.
- **Drive the board footprint from the selected part, not a hardcode.** Thread `c.part` (the kit op-amp
  id, already passed through `toCircuit`) into the board placement at `breadboard.ts` `kind === 'opamp'`.
  Look the part up in the `OPAMP_CATALOG` to get `package` + `channels` + `name`, and choose the
  footprint: single 8-DIP, quad 14-DIP, dual 8-DIP (LMC662 off-kit fallback when `!c.part`/non-kit), or
  BOB per D1.
- **Generalize the DIP model.** Replace the hardcoded `kind: 'lmc662'` push and the `lmc662`-keyed
  `DIP_KINDS` / `dipCols` / `DIP_NAME` / `DIP_FN` with a per-package definition (pin count, pinout
  labels, name, used-amp pin map, rail pins). Keep `lmc662` and `ina125` working as today; add `8-DIP
  single` and `14-DIP quad`. Prefer a small table keyed by package/part over scattered conditionals.
- **Legend/pinout panel (`Breadboard.tsx`)** must show the actual part's name and pinout (drive the
  SVG + section title from the chosen footprint, not the literal "LMC662").
- **Board Check** must map the used amp's signal pins + V+/V− to the correct pins of the actual package
  (extend the existing `pinNets` / `rails` mapping per footprint). INA125 strap checks stay intact.
- **Off-kit LMC662** still boards as the 8-pin dual (unchanged behavior for the off-kit fallback).

## Acceptance criteria (DoD §7 + phase-specific)

- **Default OP484 is correct (centerpiece):** load a default amplifier example (OP484), open the board →
  a **14-pin DIP labelled OP484** with the quad pinout, amp A's pins mapped, V+ pin 4 / V− pin 11; the
  board **Check passes** when correctly wired. No "LMC662" appears anywhere for an OP484.
- **Each package class boards + checks:** OP27/OP37/OP97 → 8-pin single DIP (correct single pinout);
  OP482/OP484 → 14-pin quad; off-kit LMC662 → 8-pin dual (unchanged); INA125 → 16-pin (unchanged).
- **ADTL082/AD8542 are gone:** not in the schematic picker, not in `OPAMP_CATALOG`, and no test or
  example references them; `README.md` / `CLAUDE.md` list the 5 remaining kit op-amps.
- Names/pinout legends match the selected part everywhere; no stale "LMC662" hardcodes remain for kit parts.
- `npm run build` clean; `npm test` green incl. updated/added board tests (the `breadboard.test.ts`
  "LMC662 as a DIP" test generalizes to per-part packages). **12-bit canary untouched** (no `core/signal.ts`).
- `docs/PROGRESS.md` appended; `docs/ROADMAP.md` F-4 → DONE; one focused commit.

## Files: allowed / forbidden

**Allowed:** `src/core/opamps.ts` (Step 0: delete the ADTL082 + AD8542 entries; optional package→pinout
helper), `src/core/opamps.test.ts` (catalog assertions), `src/core/examples.ts` (only if anything
references the removed parts — verify), `src/core/breadboard.ts` (per-package DIP model + part→footprint
lookup), `src/core/breadboard.test.ts`, `src/components/Breadboard.tsx` (legend/pinout/name per part),
`README.md` + `CLAUDE.md` (op-amp list → 5 parts), `docs/PROGRESS.md`, `docs/ROADMAP.md`, this spec.
**Forbidden:** `core/signal.ts` and the signal math; the netlist op-amp macromodel math (this phase is
board geometry + catalog membership, not simulation behavior).

## Commit

`breadboard: F-4 per-part op-amp board packages (8-DIP single / 14-DIP quad / dual; retire hardcoded
LMC662)` with the §8 body, incl. `verification: build clean; tests green; default OP484 boards as 14-pin
+ Check passes; canary untouched (no signal.ts change)`.
