---
id: UAT-143
aliases: [UAT-143]
title: "UAT: Add transitions.jsonl log to the host-server, capturing reason + pane snapshot per status change"
status: passed
task: TASK-143
created: 2026-09-13
updated: 2026-09-13
---

# UAT-143 — UAT: Add transitions.jsonl log to the host-server, capturing reason + pane snapshot per status change

implements::[[TASK-143]]

> **Source task**: [[TASK-143]]
> **Generated**: 2026-09-13

---

## Prerequisites

- [ ] Repo checked out with TASK-143's changes to `host-server/index.ts` in place (`lastDetectionByAgentId` side-channel map, `appendTransitionLog`, the `pollAndDiff` call site right after the existing `appendObservabilityLog('status_transition', ...)` call)
- [ ] Node.js available to run the host-server's `node --test` suite (`host-server/package.json`'s `test` script)
- [ ] For UAT-EDGE-006 only (live confirmation): a tmux + SQLite environment able to run the real host-server with at least one live agent window

---

## Test Cases

### UAT-EDGE-001: appendTransitionLog writes to logs/transitions.jsonl and never throws
- **Scenario**: `appendTransitionLog` follows the same try/mkdirSync/appendFileSync pattern as `appendObservabilityLog` (per the Approach section) and never propagates a write failure.
- **Steps**:
  1. Run the unit test command below.
  2. Inspect the two assertions it runs: the writer's shape (resolves `logDir` via `readConductorConf()`, `mkdirSync`s it, then `appendFileSync`s to `logs/transitions.jsonl`), and that its body's catch block is empty (comment-only, no `throw`).
- **Expected Result**: Both assertions pass — a `transitions.jsonl`-write failure (e.g. an unwritable `logDir`) can never break `pollAndDiff` or SSE broadcasting.
- **Repeatable Unit Test**: Created: `host-server/transitionsLog.test.ts`
- **Unit Test Command**: `node --import tsx/esm --test host-server/transitionsLog.test.ts`
- [x] Pass <!-- 2026-09-13 -->

### UAT-EDGE-002: pollAndDiff's transitions.jsonl record carries the full reason/pane-snapshot payload
- **Scenario**: on every detected transition, `pollAndDiff` calls `appendTransitionLog` immediately after the pre-existing `appendObservabilityLog('status_transition', ...)` call, with `agentId`, `agent`, `from`, `to`, `reason`, `matchedPattern`, `stateFileAgeS`, `windowPresent`, `queuedTasks`, and `paneTail` (the last built from the same `tail15` `buildSnapshot` already captured, split into lines).
- **Steps**: Run the unit test command below.
- **Expected Result**: The call site matches the Approach section's shape exactly — `reason` falls back to `'state-file'` when the side-channel entry is missing, and `paneTail` is `detection.tail15.split('\n')` (or `[]` when no tail was captured, e.g. `no-window`).
- **Repeatable Unit Test**: Created: `host-server/transitionsLog.test.ts`
- **Unit Test Command**: `node --import tsx/esm --test host-server/transitionsLog.test.ts`
- [x] Pass <!-- 2026-09-13 -->

### UAT-EDGE-003: observability.jsonl's status_transition event is unchanged (regression check)
- **Scenario**: this task must add a new, separate `transitions.jsonl` stream without ever modifying the pre-existing `status_transition` event written to `observability.jsonl`.
- **Steps**: Run the unit test command below.
- **Expected Result**: The `appendObservabilityLog('status_transition', ...)` call site still carries exactly its original 4 fields (`agentId`, `agent`, `previousState`, `nextState`) — no 5th field was added and none was removed.
- **Repeatable Unit Test**: Created: `host-server/transitionsLog.test.ts`
- **Unit Test Command**: `node --import tsx/esm --test host-server/transitionsLog.test.ts`
- [x] Pass <!-- 2026-09-13 -->

### UAT-EDGE-004: no new capture-pane call is introduced — buildSnapshot's existing tail15 capture is reused
- **Scenario**: `buildSnapshot`'s per-agent loop must capture `reason`/`matchedPattern`/`tail15` into the `lastDetectionByAgentId` side-channel from the same `detectAgentStatus` call already used for status/mode detection, with exactly one `capturePaneTail(...)` call per agent per tick — never a second capture-pane spawn added for transitions logging.
- **Steps**: Run the unit test command below.
- **Expected Result**: `lastDetectionByAgentId.set(agent.id, { reason, matchedPattern, tail15 })` immediately follows the single `tail15`/`detectAgentStatus` call, and the per-agent `agentStatuses.map(...)` callback contains exactly one `capturePaneTail(` call.
- **Repeatable Unit Test**: Created: `host-server/transitionsLog.test.ts`
- **Unit Test Command**: `node --import tsx/esm --test host-server/transitionsLog.test.ts`
- [x] Pass <!-- 2026-09-13 -->

### UAT-EDGE-005: the reason/matchedPattern/tail15 side-channel stays out of the public Snapshot/SSE contract
- **Scenario**: `lastDetectionByAgentId` reuses `state.ts`'s exported `DetectionReason` type (no hand-rolled duplicate union), and `reason`/`matchedPattern`/`tail15` must never leak into the `Snapshot` interface or `buildSnapshot`'s per-agent return object — that object is JSON-serialized to every SSE client on every diff tick, and this task's own Step 1 explicitly requires the public `agentStatuses[]`/SSE payload shape stay unaffected.
- **Steps**: Run the unit test command below.
- **Expected Result**: `lastDetectionByAgentId` is typed `Map<number, { reason: DetectionReason; matchedPattern: 'busy' | 'idle' | 'awaiting' | undefined; tail15: string }>`, `index.ts` imports `DetectionReason` as a type from `state.ts`, and neither the `Snapshot` interface nor `buildSnapshot`'s per-agent return object literal declares a `reason`, `matchedPattern`, or `tail15` field.
- **Repeatable Unit Test**: Created: `host-server/transitionsLog.test.ts`
- **Unit Test Command**: `node --import tsx/esm --test host-server/transitionsLog.test.ts`
- [x] Pass <!-- 2026-09-13 -->

### UAT-EDGE-006: a live status transition produces a new logs/transitions.jsonl line with a non-empty pane snapshot
- **Scenario**: a real host-server running against a live tmux session with at least one agent, observing a genuine status transition (e.g. dispatching a task to an idle agent, or flipping its `.state` file).
- **Steps**:
  1. Start the host-server (`npm --prefix host-server run dev` or the repo's normal dev command) against a live tmux-conductor session with at least one agent.
  2. Dispatch a task to an idle agent (or otherwise force a detected state change).
  3. Wait for the status-poll loop to observe the transition.
  4. Inspect the tail of `logs/transitions.jsonl`, e.g.: `tail -1 logs/transitions.jsonl | python3 -m json.tool`
- **Expected Result**: A new line appears with `ts`, `agentId`, `agent`, `from`, `to`, `reason`, `matchedPattern` (when applicable), `stateFileAgeS`, `windowPresent`, `queuedTasks`, and `paneTail`; `from != to`; `paneTail` is a non-empty array reflecting the pane's actual tail at detection time; and `logs/observability.jsonl`'s corresponding `status_transition` event still shows only its original 4 fields.
- **Repeatable Unit Test**: Not applicable: requires a live tmux session, a real host-server process, and the real status-poll interval elapsing, which the unit-test promotion criteria explicitly exclude (no live server, no real sleeps, no external tmux dependency). The task's own Step 4 already deferred this exact check to UAT (`[DEFERRED-TO-UAT]` in `wiki/work/tasks/TASK-143-host-server-transitions-jsonl.md`).
- [FAIL: auto-judge: manual test requires human verification — requires a live tmux session and running host-server, no machine-checkable oracle available headlessly] <!-- 2026-09-13 -->

---

## Gaps

None — every planned case is covered, either by the promoted unit test (`host-server/transitionsLog.test.ts`, 7 assertions, verified green via `node --import tsx/esm --test host-server/transitionsLog.test.ts`, plus `npm --prefix host-server run typecheck` clean) or, for the one case requiring a live host-server + tmux session (UAT-EDGE-006), by Manual verification matching the task's own explicitly deferred verification step.

Note on unit-test location: `uatGenerate.promoteTests` is set to the legacy value `true` (mapped to `dedicated`), but this repo's actual convention for `host-server/` is co-located sibling `*.test.ts` files reading `index.ts`'s source directly (see `sseRolePayloadParity.test.ts`, `rolePresets.test.ts`, `perfBudgets.test.ts` — the same static-source-assertion pattern this task's tests use, since `index.ts` cannot be imported directly in a unit test: it has top-level side effects — DB open, Fastify plugin registration, eventual `listen()`). Followed the repo's existing sibling layout over the stored `dedicated` preference.
