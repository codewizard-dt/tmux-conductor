---
id: UAT-118
aliases: [UAT-118]
title: "UAT: Calibrate host-server/perfBudgets.ts regression thresholds from captured baseline data"
status: passed
task: TASK-118
created: 2026-09-02
updated: 2026-09-02
---

# UAT-118 — UAT: Calibrate host-server/perfBudgets.ts regression thresholds from captured baseline data

implements::[[TASK-118]]

> **Source task**: [[TASK-118]]
> **Generated**: 2026-09-02

---

## Prerequisites

- [ ] Repo checked out at the commit containing TASK-118's changes to `host-server/perfBudgets.ts` and `host-server/index.ts`.
- [ ] `host-server/` dependencies installed (`npm install` in `host-server/`) so `node --import tsx/esm --test` and `tsx` resolve.

---

## Test Cases

### UAT-UNIT-001: LIVE_UPDATE_PERF_BUDGETS holds the TASK-118-calibrated values
- **Description**: Verifies the five `LIVE_UPDATE_PERF_BUDGETS` values in `host-server/perfBudgets.ts` equal the numbers TASK-118 derived from TASK-117's captured baseline (`maxStatusTickMs: 150`, `maxTerminalTickMs: 50`, `maxFocusedTerminalTickMs: 15`, `maxCaptureCallsPerAgentPerStatusInterval: 1`, `maxDashboardSseConnections: 1`), replacing the old placeholder values (`1500`, `1500`, `150`, `1`, `1`).
- **Steps**:
  1. Open `host-server/perfBudgets.ts`.
  2. Confirm the `LIVE_UPDATE_PERF_BUDGETS` object's five values match the calibrated numbers above.
  3. Run the unit test command below.
- **Expected Result**: All five values match exactly; the unit test passes.
- **Repeatable Unit Test**: Created: `host-server/perfBudgets.test.ts`
- **Unit Test Command**: `node --import tsx/esm --test host-server/perfBudgets.test.ts`
- [x] Pass <!-- 2026-09-02 -->

### UAT-UNIT-002: perfBudgets.ts header comment documents the capture window and cites TASK-117/TASK-118
- **Description**: Verifies `perfBudgets.ts`'s leading comment no longer claims the values are "intentionally conservative until a representative local baseline is captured," and instead documents the TASK-117 capture window (dates, sample count) and points to TASK-117/TASK-118 for provenance.
- **Steps**:
  1. Open `host-server/perfBudgets.ts` and read the header comment.
  2. Confirm the old placeholder phrase is absent.
  3. Confirm the comment cites TASK-117, TASK-118, the 708-sample count, and the capture window start timestamp `2026-09-02T05:10:04Z`.
  4. Run the unit test command below.
- **Expected Result**: The old placeholder language is gone; the capture-window provenance and task citations are present; the unit test passes.
- **Repeatable Unit Test**: Created: `host-server/perfBudgets.test.ts`
- **Unit Test Command**: `node --import tsx/esm --test host-server/perfBudgets.test.ts`
- [x] Pass <!-- 2026-09-02 -->

### UAT-UNIT-003: maxFocusedTerminalTickMs stays tighter than maxTerminalTickMs, which stays tighter than maxStatusTickMs
- **Description**: The task's Approach section calls for preserving `maxFocusedTerminalTickMs`'s relative tightness (an order of magnitude tighter than the other two budgets) unless the captured data clearly contradicted it. Verifies the ordering invariant `maxFocusedTerminalTickMs < maxTerminalTickMs < maxStatusTickMs` holds, not just that the absolute numbers look reasonable in isolation.
- **Steps**:
  1. Open `host-server/perfBudgets.ts`.
  2. Confirm `15 < 50 < 150` for the three timing budgets.
  3. Run the unit test command below.
- **Expected Result**: The ordering invariant holds; the unit test passes.
- **Repeatable Unit Test**: Created: `host-server/perfBudgets.test.ts`
- **Unit Test Command**: `node --import tsx/esm --test host-server/perfBudgets.test.ts`
- [x] Pass <!-- 2026-09-02 -->

### UAT-UNIT-004: index.ts's status/tail/focused-tail poll loops reference LIVE_UPDATE_PERF_BUDGETS instead of hardcoded literals
- **Description**: Verifies `host-server/index.ts` imports `LIVE_UPDATE_PERF_BUDGETS` from `./perfBudgets.ts` and that the three `startManagedLoop` call sites for the status-poll, tail-poll, and focused-tail-poll loops (`index.ts:2667-2669`) reference `LIVE_UPDATE_PERF_BUDGETS.maxStatusTickMs` / `.maxTerminalTickMs` / `.maxFocusedTerminalTickMs` respectively, instead of hardcoding `warnAfterMs: 1500` / `1500` / `150` literals independently of `perfBudgets.ts`.
- **Steps**:
  1. Open `host-server/index.ts` and confirm the import `import { LIVE_UPDATE_PERF_BUDGETS } from './perfBudgets.ts';` is present.
  2. Locate the three `startManagedLoop('status poll', ...)`, `startManagedLoop('tail poll', ...)`, and `startManagedLoop('focused tail poll', ...)` call sites.
  3. Confirm each one's `warnAfterMs` references the matching `LIVE_UPDATE_PERF_BUDGETS` property, not a bare numeric literal.
  4. Run the unit test command below.
- **Expected Result**: The import is present; all three call sites reference `LIVE_UPDATE_PERF_BUDGETS` properties; none hardcodes `warnAfterMs: 1500` or `warnAfterMs: 150` as a bare literal; the unit test passes.
- **Repeatable Unit Test**: Created: `host-server/perfBudgets.test.ts`
- **Unit Test Command**: `node --import tsx/esm --test host-server/perfBudgets.test.ts`
- [x] Pass <!-- 2026-09-02 -->

### UAT-EDGE-001: scripts/test-host-performance.mjs smoke test still passes after the edit
- **Scenario**: `scripts/test-host-performance.mjs` string-matches a fixed list of required identifiers (`requiredBudgets`, `requiredMetrics`, timed-loop call strings, observability hooks) directly against the raw source of `perfBudgets.ts` and `index.ts`, rather than importing/enforcing the budgets at runtime. TASK-118's edits (renaming call-site literals to `LIVE_UPDATE_PERF_BUDGETS.*` references, rewriting the header comment) must not remove any identifier the smoke test still greps for verbatim — this task deliberately does not add runtime enforcement, so this text-presence contract is the only regression guard for the wiring.
- **Steps**:
  1. From `host-server/`, run `npm run perf:test` (equivalently `node ../scripts/test-host-performance.mjs`).
- **Expected Result**: The script exits 0 and prints `host performance checks passed`, with no `Missing performance budget:` / `Missing live-update metric:` / `Missing observability hook:` / loop-not-timed error.
- **Repeatable Unit Test**: Not applicable: this is itself a whole-repo smoke-test script invocation (spawns as a script, asserts via `throw`/exit code, not via the project's `node:test` runner) — the UAT case *is* the repeatable check; wrapping it in a second unit test would duplicate the existing smoke test rather than add coverage.
- [x] Pass <!-- 2026-09-02 -->

