---
id: UAT-127
aliases: [UAT-127]
title: "UAT: Add vitest + React Testing Library test harness to frontend/"
status: passed
task: TASK-127
created: 2026-08-15
updated: 2026-08-15
---

# UAT-127 — UAT: Add vitest + React Testing Library test harness to frontend/

implements::[[TASK-127]]

> **Source task**: [[TASK-127]]
> **Generated**: 2026-08-15
> **Note**: Per team-lead's explicit brief, this UAT tests the **contract** — that the harness genuinely works end-to-end (runner executes, jsdom environment resolves, jest-dom matchers work, a real RTL `render()` test passes, the harness doesn't break `tsc`/`build`) — not TASK-127's specific implementation choices (dependency version numbers, exact config file layout). Every assertion below is machine-verifiable via a local shell command or a direct config-file read; there is no UI surface to this task, so there are no `UAT-UI-*` cases. All 5 cases were executed live at generation time.

---

## Prerequisites

- [ ] `frontend/` dependencies installed (`npm install` in `frontend/` or from repo root).
- [ ] Fixtures: none needed — every case below runs against the real `frontend/` tree as committed, no scratch files under `./tmp/` required.

---

## Test Cases

### UAT-STATIC-001: `npm test` runs the harness and exits 0 with a non-zero test count
- **Scenario**: The core contract of a test harness — it must actually execute and report a real, non-trivial number of passing tests, not just "no tests found" or a config-load crash. This is the assertion team-lead named first: "the harness genuinely executes."
- **Steps**:
  1. Run the command below as-is.
- **Command**:
  ```bash
  cd /Users/davidtaylor/Repositories/tmux-conductor/frontend && npm run test
  ```
- **Expected Result**: Exit code 0. Output includes a `Tests` summary line reporting more than 0 passing tests and 0 failing (verified live at generation time: 3 test files, 38 tests, 0 failed — an exact count is not asserted here since it will grow as more tests are added; only "runs, exits 0, non-zero count" is the contract under test).
- **Repeatable Unit Test**: Not applicable: this command *is* the thing under test — wrapping "does the test runner run" in a test the runner itself executes would be circular.
- [x] Pass <!-- 2026-08-15 -->

### UAT-STATIC-002: jsdom is the configured test environment, and jest-dom is wired via its vitest-specific entry point
- **Scenario**: Two distinct, both-necessary facts: (a) `frontend/vite.config.ts`'s `test` block sets `environment: 'jsdom'` (without it, `document`/`window` don't exist and every RTL test would crash immediately), and (b) `frontend/vitest.setup.ts` imports `@testing-library/jest-dom/vitest` specifically — **not** the bare `@testing-library/jest-dom` entry point, which requires `test.globals: true` (not set in this config) and throws `ReferenceError: expect is not defined` before any test loads. This exact bare-import mistake happened once already this session (a sibling agent had to fix it) — pinning the correct entry point here catches a regression to the wrong one.
- **Steps**:
  1. Read `frontend/vite.config.ts` and confirm the merged vitest config's `test.environment` value.
  2. Read `frontend/vitest.setup.ts` and confirm the exact import specifier.
- **Expected Result**: `vite.config.ts` sets `test: { environment: 'jsdom', setupFiles: ['./vitest.setup.ts'] }` (verified live: lines 22-27). `vitest.setup.ts`'s only import is `import '@testing-library/jest-dom/vitest'` (verified live: line 8) — not the bare `'@testing-library/jest-dom'` form.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` — every `toBeInTheDocument()`/RTL assertion in that file (and `LogTail.test.tsx`, `ConfirmDialog.test.tsx`) only passes if jsdom + jest-dom are correctly wired, so the existing suite is a live, continuously-re-run proof of this contract; a regression to the bare import or a non-jsdom environment would make every one of those assertions throw or fail, not just this UAT case. No new file needed — the existing suite already is the repeatable test for this.
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx` (re-resolved from the recorded whole-suite `npm run test` — its default reporter doesn't name individual files' cases, so a file-scoped run is the actual evidence for this file's claim)
- [x] Pass <!-- 2026-08-15 -->

### UAT-STATIC-003: `vitest.setup.ts` is included in `tsconfig.json`, so `tsc`/`npm run build` don't choke on jest-dom's type augmentation
- **Scenario**: `tsconfig.json`'s `include` array must list `vitest.setup.ts` (alongside `src` and `vite.config.ts`). Omitting it means `tsc` never sees jest-dom's global type augmentation, so every `toBeInTheDocument()`-style call across the whole `src/` tree fails `tsc --noEmit` and `npm run build` (which runs `tsc && vite build`) — this exact regression happened once already this session (caught and fixed by a sibling agent mid-work), so it's worth pinning explicitly rather than trusting it stays fixed.
- **Steps**:
  1. Run the command below as-is.
- **Command**:
  ```bash
  node -e "const fs=require('fs');const raw=fs.readFileSync('/Users/davidtaylor/Repositories/tmux-conductor/frontend/tsconfig.json','utf8');const stripped=raw.replace(/\/\/.*$/gm,'').replace(/\/\*[\s\S]*?\*\//g,'');const inc=JSON.parse(stripped).include||[];if(!inc.includes('vitest.setup.ts')){console.error('MISSING vitest.setup.ts in tsconfig include:',JSON.stringify(inc));process.exit(1);}console.log('OK vitest.setup.ts present:',JSON.stringify(inc));"
  ```
- **Expected Result**: Exit code 0, stdout `OK vitest.setup.ts present: ["src","vite.config.ts","vitest.setup.ts"]`. A missing entry produces exit code 1 and a `MISSING vitest.setup.ts in tsconfig include: [...]` message instead — verified genuinely negative at generation time (and re-verified during this auto-judge patch) by running this exact command against a scratch copy of `tsconfig.json` under `./tmp/` with `vitest.setup.ts` stripped from `include`: it printed the `MISSING` message and exited 1, then the scratch copy was discarded. The command strips `//` and `/* */` comments before parsing in case the file ever becomes JSONC (it's currently comment-free plain JSON, confirmed by this same read).
- **Repeatable Unit Test**: Not applicable: a single config-file field, not business logic — the **Command** above is the direct, reproducible, self-evaluating check (proven to fail on the negative case, not just pass on the positive one). UAT-STATIC-005's `tsc --noEmit`/`npm run build` remain a separate, complementary case — they prove the *consequence* (a missing entry breaks the compile), not that this specific entry is present for the right reason; kept distinct per instruction, not merged.
- [x] Pass <!-- 2026-08-15 -->

### UAT-STATIC-004: At least one genuine `@testing-library/react` `render()` test exists and passes
- **Scenario**: The entire point of adding React Testing Library (versus just a plain vitest runner) is proving components actually render correctly in jsdom — a suite of only plain-function assertions would prove the runner works but not the RTL/jsdom half. `frontend/src/components/AgentList.test.tsx` contains 3 real `render()` calls against `UsageBadge` (populated-usage case, null-usage case, and a zero-cost regression case), not a mock or a shallow stub.
- **Steps**:
  1. Search `frontend/src/components/*.test.tsx` for `render(` calls importing from `@testing-library/react`.
  2. Confirm at least one exists and that the file's tests pass (already exercised by UAT-STATIC-001's full-suite run).
- **Expected Result**: `AgentList.test.tsx` imports `render`/`screen` from `@testing-library/react` and calls `render(<UsageBadge ... />)` at 3 call sites (verified live at generation time: lines 187, 195, 216). `ConfirmDialog.test.tsx` (a separate task's coverage, TASK-123) independently contains further `render()` calls, corroborating the harness works for more than one component. All pass in the full-suite run.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx`'s `UsageBadge` `describe` block (3 tests, all using `render()`).
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx`
- [x] Pass <!-- 2026-08-15 -->

### UAT-STATIC-005: `npx tsc --noEmit` and `npm run build` remain clean with the harness installed
- **Scenario**: Adding a test harness (new devDependencies, a `test` block in `vite.config.ts`, a setup file, new `*.test.tsx` files sitting beside production components) must not interfere with the production TypeScript compile or the Vite build.
- **Steps**:
  1. Run both commands below.
- **Command**:
  ```bash
  cd /Users/davidtaylor/Repositories/tmux-conductor/frontend && npx tsc --noEmit
  ```
- **Expected Result**: Exits with no output and status 0. `npm run build` (`tsc && vite build`) also verified clean at generation time — modules transformed successfully, `dist/` contains only the production `index.html`/CSS/JS bundle (no test files or `vitest.setup.ts` content leaked in), only the pre-existing >500kB chunk-size advisory (not an error).
- **Repeatable Unit Test**: Not applicable: this command *is* the static gate itself, re-run verbatim; wrapping it in a unit test would just re-invoke the same compiler/bundler check.
- [x] Pass <!-- 2026-08-15 -->

---

## Coverage vs Acceptance Criteria

| Acceptance criterion | Covered by |
|---|---|
| `npm --prefix frontend test` runs vitest non-interactively and exits 0 with the proof tests passing | UAT-STATIC-001 |
| At least one proof test uses `@testing-library/react`'s `render()` against jsdom, not just a plain-function assertion | UAT-STATIC-004, environment precondition pinned by UAT-STATIC-002 |
| New test files sit as siblings of the module they test, not in a dedicated `__tests__`/`test/` directory | Verified by source inspection during generation (`AgentList.test.tsx`/`LogTail.test.tsx`/`ConfirmDialog.test.tsx` all sit beside their modules; no `__tests__`/`test/` directory exists anywhere under `frontend/src/`) — not a runtime behavior, so no separate UAT case, same precedent as prior static/layout concerns in this session's UATs |
| `formatTokens`, `formatCost`, `formatSessionStart`, `UsageBadge` (`AgentList.tsx`) and `formatChunkTs` (`LogTail.tsx`) are exported | Implied by UAT-STATIC-001/004 passing at all — every proof test imports these directly; a missing `export` would be a compile error, caught by UAT-STATIC-005 |
| `npx tsc --noEmit` and `npm run build` pass cleanly in `frontend/` | UAT-STATIC-005 |
| This task does not attempt to backfill the DOM-rendering UAT cases already on file for UAT-062/066/071/074/076/109/110 | Verified by source inspection — no new assertions were added to any of those UAT files' existing failing cases; out of scope for this UAT too |

---

## Notes

- **5 of 5 cases are machine-verifiable and were executed live at generation time — 0 human-only.** This task has no UI surface (it's test infrastructure), so unlike most `frontend/` UATs this session, nothing fails closed to `/uat-walk`.
- Two of the five cases (UAT-STATIC-002, UAT-STATIC-003) exist specifically because the exact failure mode they guard against — the bare `jest-dom` import and the missing `tsconfig.json` include entry — already happened once each this session and had to be fixed by a concurrent sibling agent mid-work. Pinning them here turns "a sibling caught it by luck" into a standing regression check.
- No new dedicated unit-test files were created for this UAT — every promotable assertion (UAT-STATIC-002, UAT-STATIC-004) points at the *existing* proof-test suite (`AgentList.test.tsx` et al.) as its own repeatable coverage, since the suite passing or failing IS the behavioral proof of the harness contract; writing a separate meta-test that asserts "the test suite works" would be circular. Deliberate versions/dependency numbers were **not** asserted anywhere, per instruction — they'll drift on any upgrade and would produce false failures; only the *capabilities* (jsdom resolves, jest-dom matchers work, RTL renders, the build stays clean) are pinned.
