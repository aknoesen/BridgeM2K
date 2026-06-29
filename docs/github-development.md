# GitHub development & delivery — practices for BridgeM2K

How this repo ships, and the order we're hardening it in. BridgeM2K is a **live tool for ~300
students** (Render auto-deploy on push to `main`), so the priority is simple: **a broken build must
never reach students.** This doc is the plan of record; update it as items land.

## Current state (2026-06-28)

- **Deploy:** `.github/workflows/render-deploy.yml` triggers a Render deploy via the Render API on
  every push to `main`, reading `RENDER_API_KEY` from repo secrets (good — not hard-coded). Service ID
  is explicit in the workflow.
- **Build/test scripts exist** (`npm run build` = `tsc && vite build`; `npm test` = `vitest run`), but
  until now **nothing ran them automatically** before a deploy.
- Commits flow: Cowork (desktop) stages edits → Claude Code (host) runs build/tests per CONVENTIONS,
  commits, and pushes to `main` → Render deploys. `push.ps1` is the manual push path.
- The bug-report **issue template** (`.github/ISSUE_TEMPLATE/bug_report.md`) + an in-app "Report a bug"
  link already exist (shipped 2026-06-28).

## Priorities (reviewed 2026-06-28)

### Now — the only thing that protects students
1. **CI (build + test) on pull requests** — `.github/workflows/ci.yml`. Catches a TS error or broken
   test automatically. Matters extra here because the Cowork sandbox has served truncated files / bogus
   build output, so "the agent said it built" is not always trustworthy; CI on real infra is the backstop.
2. **Deploy-gating** — make the Render deploy depend on build+test passing, *inside* the deploy
   workflow (`deploy` job `needs: build-test`). This keeps the fast push-to-`main` flow (no PR ceremony)
   while guaranteeing a red build never deploys to students. This is the deliberate lighter alternative
   to full branch protection, chosen because the team is effectively solo + AI agents right now.

### Soon — not urgent
3. **Releases & tags** at quarter boundaries: `git tag -a v1.0.0 -m "Spring 2026"`, cut a GitHub
   Release. Lets a lab handout cite a fixed build and gives a one-line rollback. Adopt simple semver.
4. **Dependabot — alerts only, for now.** Turn on security alerts (Settings → Code security) for the
   React 19 / Vite 8 / Plotly / ngspice-WASM stack. **Hold the automated version-bump PRs** until CI +
   gating are in and trusted — bumps are exactly what can quietly break a live tool; add them later so
   each is auto-tested.

### Deferred / already handled
5. **Pull requests + branch protection** — the stronger model (main only receives PR'd, green code).
   **Deferred on purpose:** it reshapes CC's flow from commit-to-`main` into branch→PR→merge, which is
   real ceremony for a solo professor working through agents. **Adopt when Basheer/Anthony (or other
   humans) start actively committing** — that's when review and "main is sacred" earn their cost. If we
   adopt it, **update `CONVENTIONS.md` + `CLAUDE.md`** so CC commits via branches/PRs, and adjust the
   handoff flow.
6. **Issues / Projects** — bug-report template already shipped. A Projects board is optional; skip
   unless a quarter-long task board is wanted.
7. **Environments & secrets** — `RENDER_API_KEY` already used correctly. GitHub Environments (scoped
   secrets + approval rules) are the natural step only if a staging URL or the Pages mirror needs its
   own credentials. Not urgent.

## How the "now" pieces fit together

- `ci.yml` runs on **pull requests** → it's the status check we'd later mark "required" if/when we adopt
  branch protection (item 5).
- `render-deploy.yml` runs on **push to `main`**: a `build-test` job runs first, and the `deploy` job
  `needs: build-test`, so the Render API call only fires on green. No PRs required, no broken deploys.
- Net effect with both: students only ever get tested code, and the day humans start sending PRs, the
  PR check is already there to require.

## Release runbook (cut a tagged version at each quarter boundary)

Why: `main` moves continuously (every push redeploys the live site). A release **tag** freezes one
commit as a named version that never moves, so a quarter's students have a stable reference, a lab
handout can cite a fixed version, and you have a clean point to roll back to. Do this at the end of each
quarter (and optionally for any milestone build).

**Version numbers (simple semver `vMAJOR.MINOR.PATCH`):** start at **`v1.0.0`**. Bump the **patch**
(`v1.0.1`) for a bug-fix-only release, the **minor** (`v1.1.0`) when features were added, the **major**
(`v2.0.0`) only for a big rewrite. Put the quarter in the tag message, not the number.

**Steps (run on the host, from the repo root):**

1. **Confirm `main` is healthy:** latest push went green (CI / the deploy `build-test` gate passed) and
   the live site works. Only tag a known-good commit.
2. **Pull the latest `main`:** `git switch main && git pull`.
3. **Create an annotated tag** on the current commit:
   ```bash
   git tag -a v1.0.0 -m "Spring 2026"
   ```
4. **Push the tag** (tags are not pushed by normal `git push`):
   ```bash
   git push origin v1.0.0
   ```
5. **Cut a GitHub Release:** repo → **Releases** → **Draft a new release** → choose tag `v1.0.0` →
   title `v1.0.0 — Spring 2026` → a few lines of notes (headline changes that quarter) → **Publish**.
   (GitHub can auto-generate notes from commits/PRs as a starting point.)
6. **Record it:** note the tag + the deployed commit hash in `docs/PROGRESS.md` so the quarter↔build
   mapping is written down.

**Rollback (if a later change breaks the live site):** redeploy the known-good tagged commit rather than
reverting history. Either trigger a Render deploy of that commit, or `git revert` the bad commit on
`main` (which re-runs the gate and redeploys). Tags make "go back to `v1.0.0`" an exact, unambiguous
target instead of guessing a commit.

## Notes

- Both workflows use `npm ci` (needs `package-lock.json` committed — it is) and **Node 22** (Vite 8
  wants a current Node). Keep the Node version identical in `ci.yml` and `render-deploy.yml`; if the
  deploy gate built on an older Node than CI, the build could pass CI yet fail the gate (or vice versa).
- Don't chain the two workflows via `workflow_run`; gating lives *inside* the deploy workflow via
  `needs`, which is simpler and reliable.
