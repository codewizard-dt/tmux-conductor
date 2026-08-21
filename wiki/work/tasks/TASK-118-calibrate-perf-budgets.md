---
id: TASK-118
aliases: [TASK-118]
title: "Calibrate host-server/perfBudgets.ts regression thresholds from captured baseline data"
status: todo
created: 2026-08-15
updated: 2026-08-15
depends_on: [TASK-117]
blocks: []
parallel_safe_with: [TASK-120, TASK-121, TASK-116]
uat: ""
tags: [observability, perf-budgets, host-server, roadmap-017]
---

# TASK-118 — Calibrate host-server/perfBudgets.ts regression thresholds from captured baseline data

depends_on::[[TASK-117]]

## Objective

Replace the "intentionally conservative" placeholder values in `host-server/perfBudgets.ts` (`maxStatusTickMs: 1500`, `maxTerminalTickMs: 1500`, `maxFocusedTerminalTickMs: 150`, `maxCaptureCallsPerAgentPerStatusInterval: 1`, `maxDashboardSseConnections: 1`) with thresholds derived from TASK-117's captured real-usage data, and wire the two `startManagedLoop` call sites that currently hardcode matching-by-coincidence literals (`host-server/index.ts:2475-2476`, `warnAfterMs: 1500` for both the status-poll and terminal-poll loops) to import from `perfBudgets.ts` instead of duplicating the numbers by hand.

## Approach

**Read TASK-117's captured summary first** — this task cannot proceed without it; if the summary is missing or doesn't meet the representativeness bar TASK-117 defined, stop and either wait for it or re-run the capture rather than guessing numbers.

**Setting each budget from the data:**
- `maxStatusTickMs` / `maxTerminalTickMs`: use TASK-117's summary for the `statusTicks`/`terminalTicks` timing keys. Set the budget at a documented margin above the captured p95 (a common, defensible choice: `ceil(p95 * 1.5)`, rounded to a clean number) — the goal is "catch a real regression" not "catch normal variance", so the margin should comfortably clear p99 too; if it doesn't, either the margin or the underlying p95 needs a second look before committing.
- `maxFocusedTerminalTickMs`: same approach using the `focusedTerminalTicks` timing key. Note this budget is an order of magnitude tighter (150ms placeholder) than the other two (1500ms) — preserve that relative tightness unless the captured data clearly contradicts it (focused-terminal polling is deliberately high-frequency/low-latency per `conductor.conf`'s `FOCUSED_TERMINAL_POLL_MS` default of 250ms).
- `maxCaptureCallsPerAgentPerStatusInterval` and `maxDashboardSseConnections`: these aren't timing distributions — they're structural invariants (per `perfBudgets.ts`'s comment, "protect against obvious regressions"). Confirm from TASK-117's raw capture whether the invariant ever measured above the placeholder (e.g. more than 1 `tmuxOperations` capture-tail call per agent per status tick, or more than 1 concurrently connected dashboard SSE client) during real multi-agent usage; if the placeholder already holds true throughout the captured window, leave it as documentation of the invariant rather than inventing a new number with no basis — record that reasoning in the file's comment.
- Document the provenance directly in `perfBudgets.ts`'s header comment: replace "intentionally conservative until a representative local baseline is captured" with the capture window's dates, duration, sample count, and a pointer to TASK-117 (and this task) so a future reader knows where the numbers came from and how to recalibrate.

**Wire the duplicated literals to the single source of truth**: `host-server/index.ts:2475` (`startManagedLoop('status poll', ..., { warnAfterMs: 1500, ... })`) and `:2476` (`'tail poll'`, same `warnAfterMs: 1500`) currently hardcode `1500` independently of `perfBudgets.ts`'s `maxStatusTickMs`/`maxTerminalTickMs` — they happen to match today only because someone kept them in sync by hand. Import `LIVE_UPDATE_PERF_BUDGETS` from `./perfBudgets.ts` and reference `LIVE_UPDATE_PERF_BUDGETS.maxStatusTickMs`/`.maxTerminalTickMs`/`.maxFocusedTerminalTickMs` at those three `startManagedLoop` call sites (`host-server/index.ts:2475-2477`) instead of literals, so future recalibrations only require editing `perfBudgets.ts`.

**`scripts/test-host-performance.mjs` stays a source-presence smoke test** — it currently just greps `perfBudgets.ts`/`index.ts` for required identifier strings (`requiredBudgets` list at its top) rather than importing/enforcing the budgets at runtime. This task does not need to add runtime enforcement (out of scope — the roadmap item is calibration, not adding a new regression-check mechanism), but confirm `npm run perf:test` in `host-server/` (or `node ../scripts/test-host-performance.mjs` from `host-server/`) still passes after the edit, since it string-matches identifiers that must still appear verbatim in both files.

## Steps

### 1. Read TASK-117's captured summary and compute new budget values  <!-- agent: general-purpose -->

- [ ] Read the "Captured Baseline" section TASK-117 appended to `wiki/work/tasks/TASK-117-capture-perf-baseline-data.md` (p50/p95/p99/max per `timings` key, capture window metadata). If absent or below the representativeness bar TASK-117 defined, stop and escalate rather than proceeding with placeholder-derived guesses.
- [ ] Compute the five calibrated values per the Approach section above; write down the arithmetic (p95 value → margin multiplier → rounded result) so the choice is auditable, not just the final number.

### 2. Update perfBudgets.ts  <!-- agent: general-purpose -->

- [ ] Replace the five values in `LIVE_UPDATE_PERF_BUDGETS` (`host-server/perfBudgets.ts:8-13`) with the calibrated numbers from Step 1.
- [ ] Rewrite the file's header comment (`:1-6`) to document the capture window (dates, duration, sample count) and cite TASK-117/TASK-118 instead of the old "intentionally conservative ... until a representative local baseline is captured" language, which is no longer true once this lands.

### 3. Wire the startManagedLoop literals to perfBudgets.ts  <!-- agent: general-purpose -->

- [ ] Add `import { LIVE_UPDATE_PERF_BUDGETS } from './perfBudgets.ts';` to `host-server/index.ts` (near its other local imports).
- [ ] Replace the hardcoded `warnAfterMs: 1500` at the `'status poll'` loop (`host-server/index.ts:2475`) with `LIVE_UPDATE_PERF_BUDGETS.maxStatusTickMs`.
- [ ] Replace the hardcoded `warnAfterMs: 1500` at the `'tail poll'` loop (`:2476`) with `LIVE_UPDATE_PERF_BUDGETS.maxTerminalTickMs`.
- [ ] Replace the hardcoded `warnAfterMs: 150` at the `'focused tail poll'` loop (`:2477`) with `LIVE_UPDATE_PERF_BUDGETS.maxFocusedTerminalTickMs`.

### 4. Typecheck and verify the smoke test  <!-- agent: general-purpose -->

- [ ] `npx tsc --noEmit` in `host-server/` — zero errors.
- [ ] Run `node ../scripts/test-host-performance.mjs` from `host-server/` (or `npm run perf:test`) — confirm it still passes; if it fails on a missing identifier, check whether the edit accidentally removed a string it greps for (e.g. `maxStatusTickMs` must still appear literally in `perfBudgets.ts`).

## Acceptance Criteria

- [ ] All five `LIVE_UPDATE_PERF_BUDGETS` values are derived from TASK-117's captured data (each with documented provenance/arithmetic in the task or the file's comment), replacing the placeholder values.
- [ ] `perfBudgets.ts`'s header comment documents the capture window and cites TASK-117/TASK-118 instead of claiming the values are still placeholders.
- [ ] The three `startManagedLoop` call sites (`host-server/index.ts:2475-2477`) reference `LIVE_UPDATE_PERF_BUDGETS` instead of hardcoded literals.
- [ ] `npx tsc --noEmit` passes in `host-server/`; `scripts/test-host-performance.mjs` still passes.

## Dependencies

- **DEPENDS ON [TASK-117](TASK-117-capture-perf-baseline-data.md)** — needs its captured summary as the calibration input.

### Roadmap

Implements ROADMAP-017 Phase 2, item "Calibrate `host-server/perfBudgets.ts`'s regression thresholds from the captured data, replacing the current 'intentionally conservative' placeholder values" — `wiki/work/roadmaps/ROADMAP-017-competitive-audit-followups.md`.
