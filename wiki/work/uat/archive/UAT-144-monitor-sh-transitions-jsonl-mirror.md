---
id: UAT-144
aliases: [UAT-144]
title: "UAT: Mirror transitions.jsonl logging in monitor.sh's is_idle() for the hookless/regex-fallback path"
status: passed
task: TASK-144
created: 2026-09-13
updated: 2026-09-13
---

# UAT-144 — UAT: Mirror transitions.jsonl logging in monitor.sh's is_idle() for the hookless/regex-fallback path

implements::[[TASK-144]]

> **Source task**: [[TASK-144]]
> **Generated**: 2026-09-13

---

## Prerequisites

- [ ] Repo checked out with TASK-144's changes to `scripts/monitor.sh` in place (`PREV_TRANSITION_STATE` global, `emit_transition_jsonl`, the poll-loop call site around `scripts/monitor.sh:493-505`)
- [ ] `bash` and `python3` available (already required by `scripts/monitor.sh` for `emit_dispatch_jsonl`)
- [ ] For UAT-EDGE-006 only (live confirmation): a tmux + SQLite environment able to run `scripts/monitor.sh` for real, with at least one hookless/regex-fallback agent (no Claude Code hooks — e.g. Aider, Codex, or a plain shell agent driven by `IDLE_PATTERN`/`BUSY_PATTERN`)

---

## Test Cases

### UAT-EDGE-001: emit_transition_jsonl produces a correctly shaped record for a normal transition
- **Scenario**: `is_idle()` observes a transition (e.g. `busy` → `idle`) with a non-empty previous state, a non-empty `LAST_DETECTION`, and a numeric `LAST_STATE_AGE`.
- **Steps**:
  1. Run the unit test command below.
  2. Inspect the emitted JSONL record it asserts against.
- **Expected Result**: One record with `agent`, `from`, `to`, `reason`, `stateFileAgeS` (integer), `paneTail` (array of strings), and `ts` (UTC `YYYY-MM-DDTHH:MM:SSZ`) — the same field names TASK-143's host-server writer uses.
- **Repeatable Unit Test**: Created: `scripts/verify-transitions-jsonl-emit.sh`
- **Unit Test Command**: `bash scripts/verify-transitions-jsonl-emit.sh`
- [x] Pass <!-- 2026-09-13 -->

### UAT-EDGE-002: empty from/to/stateFileAgeS serialize as JSON null, never an empty string
- **Scenario**: an agent's first-ever observed value (empty `from`), a state with no `to` (e.g. clearing an unknown state file), and a missing `LAST_STATE_AGE` (e.g. the `pane-dead` detection path, which never sets an age).
- **Steps**: Run the unit test command below.
- **Expected Result**: `rec['from']`, `rec['to']`, and `rec['stateFileAgeS']` are JSON `null` (not `""`) whenever the corresponding bash value is empty; `reason` still reflects `LAST_DETECTION` (e.g. `pane-dead`).
- **Repeatable Unit Test**: Created: `scripts/verify-transitions-jsonl-emit.sh`
- **Unit Test Command**: `bash scripts/verify-transitions-jsonl-emit.sh`
- [x] Pass <!-- 2026-09-13 -->

### UAT-EDGE-003: the poll loop suppresses a transition record on an agent's first tick
- **Scenario**: `PREV_TRANSITION_STATE[$name]` is unset (the agent's very first tick since `monitor.sh` started) — there is nothing yet to diff against.
- **Steps**: Run the unit test command below.
- **Expected Result**: The poll-loop diff-guard (`scripts/monitor.sh:502`) evaluates false and `emit_transition_jsonl` is never called for that tick.
- **Repeatable Unit Test**: Created: `scripts/verify-transitions-jsonl-emit.sh`
- **Unit Test Command**: `bash scripts/verify-transitions-jsonl-emit.sh`
- [x] Pass <!-- 2026-09-13 -->

### UAT-EDGE-004: the poll loop emits exactly when the observed state changed since the previous tick
- **Scenario**: `PREV_TRANSITION_STATE[$name]` is set to a value different from this tick's `LAST_STATE_VALUE` — including the edge case where the previous value was set-but-empty (e.g. a prior `pane-dead` tick, where `LAST_STATE_VALUE` is legitimately `""`) and now differs from a non-empty current value, and the case where both previous and current are the same empty string (must not emit).
- **Steps**: Run the unit test command below.
- **Expected Result**: The guard fires (emits) only when the previous and current values differ, using `${PREV_TRANSITION_STATE[$name]+set}` to distinguish "never set" from "set to empty string" — an unchanged value (including empty == empty) never emits.
- **Repeatable Unit Test**: Created: `scripts/verify-transitions-jsonl-emit.sh`
- **Unit Test Command**: `bash scripts/verify-transitions-jsonl-emit.sh`
- [x] Pass <!-- 2026-09-13 -->

### UAT-EDGE-005: a transitions.jsonl write failure never aborts monitor.sh's loop
- **Scenario**: `TRANSITION_LOG` points at a path whose parent directory does not exist (simulating a disk/permissions issue).
- **Steps**: Run the unit test command below.
- **Expected Result**: `emit_transition_jsonl` swallows the write failure (matches the existing `>> "$TRANSITION_LOG" 2>/dev/null || true` convention in `emit_dispatch_jsonl`) and returns normally — the caller is never aborted, even under `set -euo pipefail`.
- **Repeatable Unit Test**: Created: `scripts/verify-transitions-jsonl-emit.sh`
- **Unit Test Command**: `bash scripts/verify-transitions-jsonl-emit.sh`
- [x] Pass <!-- 2026-09-13 -->

### UAT-EDGE-006: a live transition on a hookless/regex-fallback agent produces a new logs/transitions.jsonl line
- **Scenario**: a real tmux session with at least one agent driven by the regex-fallback path (no Claude Code hooks — Aider, Codex, or a plain shell agent), running the real `scripts/monitor.sh`.
- **Steps**:
  1. Start the conductor (or `bash scripts/monitor.sh` directly) against a live tmux session with at least one hookless/regex-fallback agent.
  2. Dispatch a task to that agent (or otherwise force its detected state to change — e.g. edit the pane content so `IDLE_PATTERN`/`BUSY_PATTERN` matching flips).
  3. Wait at least one `POLL_INTERVAL` tick.
  4. Inspect the tail of `logs/transitions.jsonl`, e.g.: `tail -1 logs/transitions.jsonl | python3 -m json.tool`
- **Expected Result**: A new line appears with `ts`, `agent`, `from`, `to`, `reason`, `stateFileAgeS`, `paneTail`; `from != to`; `paneTail` is a non-empty array reflecting the pane's actual tail at detection time.
- **Repeatable Unit Test**: Not applicable: requires a live tmux session and real `POLL_INTERVAL`-scale wall-clock waiting, which the unit-test promotion criteria explicitly exclude (no live session, no real sleeps). The task's own Step 3 already deferred this exact check to UAT (`[DEFERRED-TO-UAT]` in `wiki/work/tasks/TASK-144-monitor-sh-transitions-jsonl-mirror.md`).
- [FAIL: auto-judge: manual test requires human verification — requires a live tmux session, no machine-checkable oracle available headlessly] <!-- 2026-09-13 -->

### UAT-EDGE-007: dispatch.jsonl output is unchanged (regression check)
- **Scenario**: this task adds `emit_transition_jsonl` as a new sibling call site and must never modify `emit_dispatch_jsonl` itself or its output schema.
- **Steps**: Run the unit test command below.
- **Expected Result**: `emit_dispatch_jsonl`'s extracted body still contains its original field set (`state_age_s`, `pane_tail`, `queue_remaining`, writing to `DISPATCH_LOG`) and contains no reference to `TRANSITION_LOG`.
- **Repeatable Unit Test**: Created: `scripts/verify-transitions-jsonl-emit.sh`
- **Unit Test Command**: `bash scripts/verify-transitions-jsonl-emit.sh`
- [x] Pass <!-- 2026-09-13 -->

---

## Gaps

None — every planned case is covered, either by the promoted unit test (`scripts/verify-transitions-jsonl-emit.sh`, 10 assertions, verified green) or, for the one case requiring a live tmux session and real wall-clock ticks (UAT-EDGE-006), by Manual verification matching the task's own explicitly deferred verification step.
