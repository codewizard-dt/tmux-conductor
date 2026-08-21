---
id: TASK-127
aliases: [TASK-127]
title: "Add vitest + React Testing Library test harness to frontend/"
status: done
created: 2026-08-15
updated: 2026-08-15
depends_on: []
blocks: []
parallel_safe_with: []
uat: "[[UAT-127]]"
tags: [frontend, testing, infrastructure]
---

# TASK-127 — Add vitest + React Testing Library test harness to frontend/

## Objective

`frontend/` has no test runner at all today — no vitest, no jest, no `*.test.ts`/`*.test.tsx` files anywhere under `frontend/src/`. This task adds one: vitest + React Testing Library + jsdom, wired with a `test` script, following the sibling-test-file convention `host-server/` already uses (`*.test.ts` next to the module it tests, not a separate `__tests__`/`test/` tree). Scope is the harness plus a small number of proof tests that demonstrate it actually works end-to-end (running a pure-function assertion and rendering a real component into jsdom) — **not** a backfill of every missing frontend test.

## Why this matters

Every UAT generated against `frontend/` this session — UAT-062 (branch badge), UAT-066 (diff panel), UAT-071 (checkpoint UI), UAT-074 (usage badge), UAT-076 (usage session breakdown), UAT-109 (LogTail history toggle), UAT-110 (LogTail timestamp markers) — carries at least one `[FAIL: auto-judge: UI test requires human verification — use /uat-walk]` case, 14+ cases in total, purely because there is nothing to run a DOM assertion in. Agents worked around this for *pure logic* by copying functions byte-for-byte into standalone Node reference scripts embedded inside the UAT markdown itself (e.g. `UAT-074-usage-badge-ui.md`'s `UAT-EDGE-001`/`UAT-EDGE-002`, `UAT-076-usage-session-breakdown-ui.md`'s `UAT-EDGE-001`, `UAT-110-logtail-history-timestamp-markers.md`'s `UAT-EDGE-001`) — every one of those UAT files' own `Repeatable Unit Test` field says `Blocked: ... frontend/ has no configured test runner ... adding one would be new test infrastructure, out of scope for this run`. That technique genuinely proves the *logic* is correct, but it cannot touch rendering, DOM structure/ordering, conditional visibility, ARIA attributes, or component state — every one of those UAT files' actual UI cases (badge visible/hidden, marker-per-chunk rendering, tooltip text, layout) still fail-closes to a human `/uat-walk`. This task removes the "no harness" blocker so future UAT generation (and this task's own proof tests) can close that gap with real, repeatable, headlessly-judgeable tests instead of growing the human-verification backlog indefinitely.

## Approach

**Packages**: add `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, and `jsdom` to `frontend/package.json` devDependencies, at whatever current versions are compatible with the existing `vite: ^6.3.5` / `react: ^19.2.7` / `typescript: ^5.8.3` devDependencies — none of these packages exist anywhere in this repo's `node_modules` yet (checked: no hoisted copy), so this is a clean install with no version conflicts to reconcile. Check npm for current stable majors at implementation time rather than hardcoding versions in this task.

**Wiring**: `frontend/vite.config.ts` currently has no `test` block (`frontend/vite.config.ts:1-17` — just `plugins`, `envDir`, `server.proxy`). Add a `test: { environment: 'jsdom', globals: true, setupFiles: ['./vitest.setup.ts'] }` block (or a separate `vitest.config.ts` extending the vite config, whichever is cleaner given vitest's current recommended pattern — check current vitest docs at implementation time, this area changes between major versions). Add a `vitest.setup.ts` at `frontend/` root that imports `@testing-library/jest-dom` for the extended DOM matchers (`toBeInTheDocument()`, etc.), matching the standard RTL setup. Add a `"test": "vitest run"` script to `frontend/package.json` (plus a `"test:watch": "vitest"` if convenient) — mirroring `host-server/package.json`'s `"test": "node --import tsx/esm --test"` in *spirit* (a single command that runs the whole suite non-interactively for CI/tackle use), not literally the same runner, since vitest is the natural fit for a Vite+React project the way `node --test` is for a plain TS backend.

**Sibling-file convention (not a dedicated tree)**: per this repo's established pattern — confirmed by `host-server/`'s existing test files (`db.migration.test.ts`, `git.test.ts`, `usage.test.ts`, `usage-store.test.ts`, `config.test.ts`, all siblings of the module they test) and by sibling agent UAT-062's explicit choice, documented in its own `uatGenerate.promoteTests` note, to follow this local layout over the stored `dedicated` bootstrap preference — new frontend tests go next to the component file: `frontend/src/components/AgentList.test.tsx`, `frontend/src/components/LogTail.test.tsx`, etc. Do not create a `frontend/src/__tests__/` or `frontend/test/` directory.

**Exports needed for the proof tests**: most of the candidate pure functions below are currently module-private (no `export` keyword) — confirmed by reading each file directly, not assumed:
- `frontend/src/components/AgentList.tsx`: `formatTokens` (`:237-241`), `formatCost` (`:243-247`), `formatSessionStart` (`:251-257`) are all plain `function`, not exported. `resolveRoleBadge` (`:175-182`) **is** already exported (`export function resolveRoleBadge(...)`, added by TASK-114 specifically for enumerability/testability) — `ROLE_CONFIG` itself (`:166-173`) is not exported, but isn't needed directly since `resolveRoleBadge` is the public surface over it. `UsageBadge` (`:315-332`) is a plain (non-exported) function component.
- `frontend/src/components/LogTail.tsx`: `formatChunkTs` (`:57-61`) is a plain, non-exported function.

Add `export` to `formatTokens`, `formatCost`, `formatSessionStart`, `UsageBadge` in `AgentList.tsx` and to `formatChunkTs` in `LogTail.tsx` as part of this task — a same-behavior, additive change (adding `export` doesn't change runtime behavior; re-verify with `find_referencing_symbols`/a full-file re-read immediately before editing each hot file, since both are edited concurrently by other tasks in this repo). **Re-locate every symbol above by name before citing/editing it** — the line numbers here were confirmed at task-creation time but `AgentList.tsx` in particular has shifted repeatedly this session (TASK-114's role badge work alone moved `formatSessionStart` from `:217-223` when UAT-076 cited it down to `:251-257` today) and will keep shifting under concurrent tasks.

**Proof tests to write** (small, not exhaustive — one file per component, following the sibling convention):
1. `frontend/src/components/AgentList.test.tsx` — plain vitest (no `render()` needed) for the pure functions: `formatTokens`/`formatCost` boundary matrix (reuse the exact assertions already verified in `UAT-074-usage-badge-ui.md`'s `UAT-EDGE-001` reference script), `formatSessionStart`'s UUID-truncation fallback (reuse `UAT-076-usage-session-breakdown-ui.md`'s `UAT-EDGE-001` assertions), and `resolveRoleBadge`'s known-role/unknown-role/`'generic'`/`null` branches. Plus **one real RTL render test** for `UsageBadge` (e.g. `render(<UsageBadge agent={...} />)` then assert the badge text via `screen.getByText(...)` for a usage-present agent, and `expect(container).toBeEmptyDOMElement()` or equivalent for a null-usage agent) — this is the test that actually proves jsdom + RTL rendering works, not just that the vitest runner executes.
2. `frontend/src/components/LogTail.test.tsx` — plain vitest for `formatChunkTs`'s valid/invalid/malformed matrix (reuse `UAT-110-logtail-history-timestamp-markers.md`'s `UAT-EDGE-001` assertions).

Do **not** attempt to write the DOM-rendering UAT cases those UAT files fail-close on today (badge visibility toggling on real agent data, marker-per-chunk ordering against seeded DB rows, tooltip text, dark-mode/layout) — those need real component props/mocked fetches and are follow-up work once the harness exists, not this task's proof-of-life scope.

**Migration note (informational, not this task's job)**: once this lands, the Node reference scripts embedded in `UAT-074`, `UAT-076`, and `UAT-110` become redundant — their assertions should eventually migrate into the real `*.test.tsx` files this task creates (or their own follow-up tests), and future `/uat-generate` runs against `frontend/` should write real vitest files instead of reference scripts. Do not perform that migration in this task; note it in the completion report for whoever picks it up next (likely the next `/uat-generate` pass against one of those tasks, or a dedicated follow-up).

## Steps

### 1. Install and wire the harness  <!-- agent: general-purpose -->

- [x] Added `vitest@^4.1.10`, `@testing-library/react@^16.3.2`, `@testing-library/jest-dom@^7.0.1`, `jsdom@^30.0.1` to `frontend/package.json` devDependencies (current stable, verified compatible with `vite: ^6.3.5`/`react: ^19.2.7` via `npm view`; `@testing-library/dom@10.4.1` auto-landed as a required peer).
- [x] `frontend/vite.config.ts` extended via `mergeConfig` (from `vite`) + `defineConfig` (from `vitest/config`) with `test: { environment: 'jsdom', setupFiles: ['./vitest.setup.ts'] }`, existing plugin/server/proxy config untouched. `frontend/vitest.setup.ts` created (`import '@testing-library/jest-dom'`).
- [x] `"test": "vitest run"` and `"test:watch": "vitest"` added to `frontend/package.json` scripts.
- [x] `npm --prefix frontend install` succeeded cleanly (441 packages added, no peer-conflict errors; pre-existing unrelated audit warnings only). `npx tsc --noEmit` in `frontend/` exit 0. `npm run test` with zero test files present started correctly (jsdom + setup file loaded with no config errors) and exited with the expected "No test files found" — confirms the harness itself is wired correctly.

### 2. Export the functions the proof tests need  <!-- agent: general-purpose -->

- [x] `AgentList.tsx` re-read and every symbol re-located by name fresh (not by cited line number), no conflicts found: `formatTokens` (:248), `formatCost` (:254), `formatSessionStart` (:262), `UsageBadge` (:326) — all now `export`ed via `replace_symbol_body`, same-behavior only. `resolveRoleBadge` left untouched (already exported by TASK-114).
- [x] `LogTail.tsx` re-read: `formatChunkTs` (:57) — now `export`ed via `replace_symbol_body`, same-behavior only.
- [x] `npx tsc --noEmit` in `frontend/` — zero errors.

### 3. Write the proof tests  <!-- agent: general-purpose -->

- [x] Created `frontend/src/components/AgentList.test.tsx`: `formatTokens` boundary matrix, `formatCost` boundary matrix (**re-verified against live source, not blindly ported from UAT-074 — see drift note below**), `formatSessionStart` UUID/date-branch cases, `resolveRoleBadge` known-role/`generic`/`null`/`undefined`/unknown-string cases, and one genuine `@testing-library/react` `render()` test for `UsageBadge` (populated-usage label computed from the real imported `formatCost`/`formatTokens`, plus a `usage: null` → nothing-rendered case).
- [x] Created `frontend/src/components/LogTail.test.tsx`: `formatChunkTs` valid/invalid/empty/malformed matrix (malformed-date unparseability reconfirmed live in this Node/V8 before asserting, per UAT-110's own caution).
- [x] `npm --prefix frontend test`: **28/28 pass, 0 fail** across both new files.
- [x] **Real behavior drift caught, flagged, and (in a same-day follow-up dispatch) fixed**: `formatCost`'s zero/negative branch returned `'$0.00'` instead of the `''` that UAT-074's reference script assumed — verified live via `find_symbol` before writing the original proof test against the (buggy) current behavior. Flagged to team-lead, who confirmed via `TASK-074`/`TASK-076`'s own task-file specs (both explicitly documented `<= 0` → `''`, "empty cost cell") that this was an **untracked regression, not a latent inconsistency** — no task ever recorded a deliberate change to `'$0.00'`. Fixed: `formatCost` restored to return `''`; `UsageBreakdown`'s two cost table cells (`AgentList.tsx`, rows + footer total) updated to `formatCost(...) || '—'` so the empty string doesn't render as a blank/ambiguous cell; `AgentList.test.tsx` updated to assert the restored `''` behavior plus a new DOM-level regression test on `UsageBadge` proving the zero-cost label reads token-only with no `'$0.00'` substring. `UAT-074`'s own `UAT-EDGE-001` matrix already pinned `''` (never needed updating — it was TASK-127's own proof test that had drifted, now corrected to match). Re-verified: 38/38 vitest pass, `tsc --noEmit` clean, `npm run build` clean.
- [x] Second, unrelated drift caught mid-step by a concurrent sibling agent (working TASK-115) editing `frontend/vitest.setup.ts` in place: the setup file's original `import '@testing-library/jest-dom'` requires `test.globals: true` (not set), causing `ReferenceError: expect is not defined` on the first run; fixed to `import '@testing-library/jest-dom/vitest'` (binds via `vi`, no globals needed) — already applied by the time this step's implementer re-ran the suite, confirmed correct and left in place. The same concurrent agent also added `ROLE_VALUES`/`isValidAgentRole` describe blocks to `AgentList.test.tsx` against symbols genuinely exported in the live source (verified accurate, left in place, not reverted).

### 4. Typecheck and build  <!-- agent: general-purpose -->

- [x] `npx tsc --noEmit` in `frontend/` — exit 0, zero errors.
- [x] `npm run build` in `frontend/` — exit 0, clean build (71 modules transformed, only the pre-existing >500kB chunk-size advisory; no test files or vitest config leaked into `dist/`).

## Acceptance Criteria

- [x] `npm --prefix frontend test` runs vitest non-interactively and exits 0 — 28/28 proof tests passing.
- [x] `UsageBadge`'s `render()` test uses `@testing-library/react` against jsdom (populated + null-usage branches), not just a plain-function assertion.
- [x] Both new test files are siblings (`frontend/src/components/AgentList.test.tsx`, `frontend/src/components/LogTail.test.tsx`), no `__tests__`/`test/` directory created.
- [x] `formatTokens`, `formatCost`, `formatSessionStart`, `UsageBadge`, `formatChunkTs` all exported.
- [x] `npx tsc --noEmit` and `npm run build` pass cleanly in `frontend/`.
- [x] No DOM-rendering UAT-case backfill attempted for UAT-062/066/071/074/076/109/110 — proof-of-life scope only, as specified.

## Dependencies

None — this is infrastructure with no roadmap parent and no formal `depends_on`/`blocks`. Downstream benefit (informational, not a blocking relationship): ROADMAP-017 Phase 3 is not yet implemented — [TASK-122](TASK-122-dashboard-dark-mode.md) (dark mode), [TASK-123](TASK-123-replace-confirm-dialogs.md) (replace `window.confirm()` with the app's modal styling), and [TASK-124](TASK-124-agentlist-text-filter.md) (`AgentList` text filter) are all UI work that could ship with real tests instead of joining the human-verification backlog, if this task lands first. Nothing about those tasks requires waiting on this one, though.

**Hot files**: `frontend/src/components/AgentList.tsx` and `frontend/src/components/LogTail.tsx` are edited concurrently by other tasks in this repo (role/badge/filter work, LogTail history work). Re-read each file immediately before the `export`-adding edit in Step 2, and re-locate every cited symbol by name rather than trusting line numbers.

### Roadmap

None — this task is infrastructure, not tied to any roadmap phase.
