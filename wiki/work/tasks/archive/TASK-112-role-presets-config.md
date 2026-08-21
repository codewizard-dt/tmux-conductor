---
id: TASK-112
aliases: [TASK-112]
title: "Role presets — presets.json config with a per-role CLAUDE.md fragment"
status: done
created: 2026-08-15
updated: 2026-08-15
depends_on: []
blocks: [TASK-113]
parallel_safe_with: [TASK-111]
uat: "[[UAT-112]]"
tags: [backend, config, roles, roadmap-010]
---

# TASK-112 — Role presets — presets.json config with a per-role CLAUDE.md fragment

blocks::[[TASK-113]]

## Objective

Ship a `presets.json` config file that maps each of the seven role values (`generic`, `frontend`, `backend`, `qa`, `devops`, `security`, `architect` — the same enum TASK-111 adds to the `agents` table) to a CLAUDE.md-fragment string: role-specific guidance that TASK-113 will write into a newly-spawned agent's worktree `CLAUDE.md`. This task ships the data file and a small typed loader — it does not touch spawn logic (that's TASK-113) or any UI (TASK-114/115).

## Approach

Host-server has no precedent for a runtime-loaded JSON data file (`pricing.ts` is the closest analog — a static pricing table — but it's an inline TS constant, not JSON, since pricing changes ship with a deploy). The roadmap explicitly calls for a `presets.json` *file*, presumably so role fragments can be edited without a TS recompile, so honor that literally: a real `.json` file, not a TS constant.

- **Location**: `host-server/role-presets.json` — co-located with the TS modules that will read it (`config.ts` already reads `conductor.conf` from the repo root via a resolved path; this is server-side content data, so it belongs alongside the server code, not the repo-root tuning config).
- **Shape**: a flat object keyed by the exact 7 role strings, each value a markdown string (the CLAUDE.md fragment for that role):
  ```json
  {
    "generic": "...",
    "frontend": "...",
    "backend": "...",
    "qa": "...",
    "devops": "...",
    "security": "...",
    "architect": "..."
  }
  ```
- **Loader**: `host-server/rolePresets.ts`, a small typed module exporting:
  - `ROLE_VALUES` — the canonical 7-value tuple/array (single source of truth; TASK-111's API validation and this file's keys must never drift apart — consider having TASK-111's route import `ROLE_VALUES` from here once this lands, or note the duplication clearly if TASK-111 ships first and can't yet depend on this file).
  - `getRoleFragment(role: string): string` — reads `role-presets.json` (via `fs.readFileSync` + `JSON.parse`, resolved relative to `import.meta.url` the same way `config.ts` resolves `conductor.conf`, or a static `import` with the appropriate `tsconfig`/`resolveJsonModule` setting — check `host-server/tsconfig.json` for whether `resolveJsonModule` is already enabled before choosing), returns the fragment for a known role, and returns the `generic` fragment (never throws, never returns `undefined`) for an unrecognized role so a future role added to the DB enum without a matching preset never breaks spawn.
- **Content**: each fragment should be genuinely useful role guidance (a short paragraph — persona framing, what this role should prioritize/avoid, e.g. the `qa` fragment emphasizing test coverage and edge cases over shipping speed, the `security` fragment emphasizing threat modeling and never weakening auth), not a placeholder string like `"You are a frontend engineer."` — TASK-113 will concatenate this verbatim into the agent's `CLAUDE.md`, so it needs to read as real guidance from the first agent spawned with it.

## Steps

### 1. Create the presets data file  <!-- agent: general-purpose -->

- [x] Create `host-server/role-presets.json` with all 7 keys (`generic`, `frontend`, `backend`, `qa`, `devops`, `security`, `architect`), each a non-trivial markdown fragment (2-5 sentences) giving that role's persona and priorities, suitable for direct inclusion in a CLAUDE.md.
- [x] Check `host-server/tsconfig.json` for `resolveJsonModule`/`esModuleInterop` settings to decide whether the loader (Step 2) can `import` the JSON directly or must `fs.readFileSync` it.

<!-- Updated: 2026-08-15 — host-server/role-presets.json created with all 7 keys, each a concrete, role-differentiated 3-4 sentence fragment (drafted for genuine behavioral specificity, not placeholder filler; no references to reverted app/api/daemon tiers). tsconfig.json confirmed: esModuleInterop=false, no resolveJsonModule key, include=["*.ts"] only — so the loader must use fs.readFileSync + JSON.parse, not a static import. -->

### 2. Create the typed loader module  <!-- agent: general-purpose -->

- [x] Create `host-server/rolePresets.ts` exporting `ROLE_VALUES: readonly string[]` (the 7 canonical values, in the same order as TASK-111's SQLite `CHECK` constraint) and `getRoleFragment(role: string): string`.
- [x] `getRoleFragment` must never throw and must never return `undefined`/empty string — fall back to the `generic` fragment for any role not present in the JSON (defensive against future drift between the DB enum and this file).
- [x] Add a brief top-of-file comment cross-referencing TASK-111 (`host-server/db.ts`'s `CHECK` constraint) as the source of truth for the enum, so a future edit to one prompts checking the other.

<!-- Updated: 2026-08-15 — host-server/rolePresets.ts created: ROLE_VALUES tuple (order independently verified against host-server/db.ts:404's landed CHECK constraint — exact match), getRoleFragment reads role-presets.json via fs.readFileSync+JSON.parse (no static import — resolveJsonModule not enabled) inside a try/catch, degrades through 3 layers (requested role -> generic -> hardcoded string) so unknown role / missing key / malformed JSON / absent file all resolve without throwing. Satisfies noUncheckedIndexedAccess/noPropertyAccessFromIndexSignature via explicit typeof guards and bracket notation. db.ts/index.ts/tsconfig.json untouched (read-only reference to db.ts's landed CHECK constraint). tsc --noEmit: zero errors. -->

### 3. Unit test the loader  <!-- agent: general-purpose -->

- [x] Add `host-server/rolePresets.test.ts` (`node --test` convention, matching `host-server/git.test.ts`/`pricing.ts`'s sibling test style if one exists, else the plain `import { test } from 'node:test'` pattern used throughout `host-server/`): assert `getRoleFragment` returns a non-empty string for each of the 7 `ROLE_VALUES`, and returns the same string as `getRoleFragment('generic')` for an unrecognized role like `'nonexistent-role'`.

<!-- Updated: 2026-08-15 — host-server/rolePresets.test.ts created with 4 cases: all-7-roles non-empty, unknown-role==generic fallback, plus (per team-lead's explicit ask, beyond this step's own written text) absent-file and malformed-JSON never-throws coverage. Absent-file/malformed-JSON cases use a byte-identical scratch copy of rolePresets.ts's live source run via a spawned subprocess in a fresh ./tmp/ mkdtemp dir, cleaned up per-test in a finally block — the real host-server/role-presets.json and rolePresets.ts were never renamed/deleted/overwritten (confirmed via git status: both remain untracked/??  with empty diff). tsc --noEmit: zero errors. Test run: tests 4, pass 4, fail 0. -->

### 4. Typecheck  <!-- agent: general-purpose -->

- [x] Run `npx tsc --noEmit` in `host-server/` — zero errors. If JSON import required a `tsconfig.json` change (`resolveJsonModule`), confirm it doesn't regress any other compile target in the same `tsconfig.json` (check whether `host-server/tsconfig.json` is shared by anything else, e.g. `db.migration.test.ts`, before assuming the change is isolated).
- [x] Run `node --import tsx/esm --test host-server/rolePresets.test.ts` (or the equivalent scoped-file form matching this repo's `npm test` script, `host-server/package.json:9`) and confirm the new test passes.

<!-- Updated: 2026-08-15 — tsc --noEmit: zero errors, no tsconfig.json change made or needed. rolePresets.test.ts scoped run: 4/4 pass. Full host-server suite (npm test, no filter): 68/68 pass, 0 fail — count observed live at run time (moving target per concurrent sibling agents adding tests), not an expected/cached number. -->

## Acceptance Criteria

- [ ] `host-server/role-presets.json` exists with all 7 role keys, each a real, non-placeholder fragment.
- [ ] `getRoleFragment()` returns the correct fragment for each of the 7 roles and falls back to `generic` for anything else, never throwing.
- [ ] `npx tsc --noEmit` passes cleanly in `host-server/`.
- [ ] The new `rolePresets.test.ts` cases pass.

## Dependencies

None — independent of TASK-111 (disjoint files: this task only adds `host-server/role-presets.json` and `host-server/rolePresets.ts`, touching neither `db.ts` nor `index.ts`) and safe to build in parallel with it. TASK-113 (write the fragment into the worktree's CLAUDE.md at spawn) depends on this task's `getRoleFragment()` existing.

### Roadmap

Implements ROADMAP-010 Phase 3, item 2 ("Ship `presets.json` config file with a per-role CLAUDE.md fragment for each role value") — `wiki/work/roadmaps/ROADMAP-010-agent-observability-ux.md`.
