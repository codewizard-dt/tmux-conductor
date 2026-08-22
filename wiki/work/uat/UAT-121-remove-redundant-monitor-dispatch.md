---
id: UAT-121
aliases: [UAT-121]
title: "UAT: Remove monitor.sh's now-redundant dispatch block, reusing mark_busy to prevent double-dispatch races"
status: pending
task: TASK-121
created: 2026-08-21
updated: 2026-08-21
---

# UAT-121 — UAT: Remove monitor.sh's now-redundant dispatch block, reusing mark_busy to prevent double-dispatch races

implements::[[TASK-121]]

> **Source task**: [[TASK-121]]
> **Generated**: 2026-08-21

> **Note on unit-test scope**: This task's only code change is a deletion inside `scripts/monitor.sh`'s bash main loop (the `if pop_task ...; then ... else ... fi` block, formerly lines 439-455). No host-server (TypeScript) logic was added or changed. This repo has no bats/shell-unit-test harness for `scripts/*.sh` (confirmed via `find_file` — same finding UAT-120 documented for the same directory), so there is no unit-test framework to promote a shell-script deletion into. Every case below is either a static code/syntax check (runnable now, no live env needed) or a live integration/regression check against a running `conductor` tmux session + host-server (same non-injectable-entrypoint constraint UAT-119/UAT-120 documented for `host-server/index.ts`, plus the live-tmux requirement this task's own Step 1 explicitly calls for).

> **Note on `/tackle`'s deferred evidence**: `/tackle` marked this task's Step 1 (live double-dispatch race trials) and part of Step 3 (live usage-limited/teardown re-verification) `[DEFERRED-TO-UAT]`, backed instead by static code-reading evidence (recorded in the task file). The live cases below (UAT-INT-*, UAT-EDGE-*) are exactly those deferred trials, now formalized as UAT cases for a human `/uat-walk` or headless `/uat-auto` pass.

---

## Prerequisites

- [ ] Host-server running on `http://localhost:8788` (`make dev` or `npm start` in `host-server/`). **This is a shared dev server in this repo** — coordinate before flipping any agent's state file, per the same caution UAT-119/UAT-120 document.
- [ ] A conductor tmux session (`scripts/conductor.sh`) exists with at least one registered agent window.
- [ ] An agent whose state file you are cleared to flip directly at `$STATE_DIR/<window-name>.state` without disrupting another in-flight test (prefer an agent with no `projectName` so its tmux window name equals its `name` field — `agentWindowName`, `host-server/db.ts:33-35`).
- [ ] At least one agent with a non-null `worktreePath` for UAT-INT-003 (`GET /api/agents` → `worktreePath` field).
- [ ] `jq` installed.
- [ ] `STATE_DIR` (`./logs/state`) and `LOG_DIR` (`./logs`) from `conductor.conf` — defaults used throughout below; substitute if your local conf differs. `POLL_INTERVAL=15` (seconds) is `monitor.sh`'s tick cadence — several cases below wait past one tick.
- [ ] Confirm `logs/state/usage-limited` does not already exist before starting: `test -f logs/state/usage-limited && echo EXISTS || echo ABSENT` should print `ABSENT` (UAT-EDGE-001 creates and removes this file — do not run it against a fleet that is genuinely usage-limited for real).
- [ ] For UAT-INT-002 (host-server-down regression check): ability to stop the host-server process (`Ctrl-C` on `make dev`'s host-server, or `pkill -f "tsx.*host-server"`) and restart it afterward without disrupting other work — coordinate before doing this in a shared dev environment.

---

## Test Cases

### UAT-INT-001: A queued task dispatches exactly once via the sole surviving (host-server) idle-transition trigger — no monitor.sh double-dispatch
- **Endpoint**: none directly — triggered internally by the host-server's `pollAndDiff()` status-poll loop (`host-server/index.ts:2381-2396`, TASK-120), racing against `monitor.sh`'s now-dispatch-free 15s tick (TASK-121).
- **Description**: This is the task's core acceptance criterion: with `monitor.sh`'s redundant dispatch block deleted, the host-server's idle-transition trigger is the *only* thing that can dispatch. Confirms exactly one `dispatch.jsonl` record lands for the task, and that no second (bash-emitted) record ever appears even after monitor.sh has had a full tick to (not) act.
- **Steps**:
  1. Note the target agent's numeric `id` (`<AGENT_ID>`) and window name from `GET /api/agents`.
  2. Force the agent busy: `echo -n busy > logs/state/<window-name>.state`.
  3. Queue a task for it (slow path, agent busy):
     ```bash
     curl -sS -X POST 'http://localhost:8788/api/tasks' -H 'Content-Type: application/json' -d '{"command":"echo uat121-single","agentId":REPLACE_AGENT_ID}'
     ```
     Confirm the response body contains `"dispatched":false` (HTTP 201).
  4. Note the current line count of `logs/dispatch.jsonl`: `wc -l < logs/dispatch.jsonl`.
  5. Flip the agent's state file to idle: `echo -n idle > logs/state/<window-name>.state`.
  6. Wait 18 seconds (`sleep 18`) — longer than one full `POLL_INTERVAL` (15s) tick of `monitor.sh`, to give the (now dispatch-free) bash loop every opportunity to have acted if the deletion were incomplete.
  7. Run the command below.
- **Command**:
  ```bash
  jq -c 'select(.command=="echo uat121-single")' logs/dispatch.jsonl
  ```
- **Expected Result**: Exactly one matching JSON line, with `detection == "idle-transition-poll"` (the host-server's trigger). No second matching line ever appears, regardless of wait time — `monitor.sh` no longer has any code path that can emit one (its `emit_dispatch_jsonl` call sites were deleted). The command appears exactly once in the agent's tmux pane.
- **Repeatable Unit Test**: Not applicable — requires a live host-server, real tmux pane, and a real `monitor.sh` process running against the same `STATE_DIR`; there is no injectable entrypoint or shell-test harness to isolate this in.
- [x] Pass <!-- 2026-08-22 -->

### UAT-INT-002: With the host-server stopped, monitor.sh alone no longer dispatches a queued task on an idle transition
- **Endpoint**: none — this isolates `monitor.sh`'s bash loop by removing the host-server from the race entirely, proving the redundant path is truly gone rather than merely losing every race.
- **Description**: The strongest possible regression check for this task: before TASK-121, `monitor.sh` running alone (host-server down) would still dispatch a queued task within one 15s tick. After TASK-121's deletion, it must not — the task should sit queued indefinitely with only `monitor.sh` running.
- **Steps**:
  1. With `monitor.sh` still running (inside the `conductor` tmux session, or standalone via `scripts/monitor.sh`) and the host-server temporarily stopped, pick an agent and note its `id` and window name via a direct `sqlite3`/`GET /api/agents` snapshot taken *before* stopping the server (or use a previously-noted id).
  2. Queue a task for that agent directly via the SQL task queue (bypassing the host-server API, since it's down) — e.g. `scripts/add-task.sh` run with the agent's workdir, or an equivalent direct SQLite insert into the `tasks` table scoped to the agent, with command text `echo uat121-monitoronly`.
  3. Force the agent's state file busy, then idle, mirroring a real Stop-hook transition: `echo -n busy > logs/state/<window-name>.state`, wait 2s, then `echo -n idle > logs/state/<window-name>.state`.
  4. Wait 35 seconds (`sleep 35`) — more than two full `monitor.sh` ticks (`POLL_INTERVAL=15`), giving the bash loop every opportunity to dispatch if the deletion were incomplete or reverted.
  5. Run the command below.
  6. **Cleanup**: restart the host-server so the task can dispatch normally afterward, and confirm it does (the task should dispatch on the next host-server-observed idle transition, or immediately once `monitor.sh`'s next legitimate idle-transition-poll equivalent fires via the restarted host-server).
- **Command**:
  ```bash
  jq -c 'select(.command=="echo uat121-monitoronly")' logs/dispatch.jsonl
  ```
- **Expected Result**: Prints nothing — no dispatch record exists for the task while only `monitor.sh` was running, across 35+ seconds and 2+ ticks. The task remains queued in the `tasks` table for the agent throughout. This is the direct evidence that `monitor.sh`'s pop/dispatch code path no longer exists (not just that it loses races).
- **Repeatable Unit Test**: Not applicable — requires stopping a live process and observing absence of behavior over real wall-clock time against a real tmux pane; no harness in this repo can simulate that.
- [x] Pass <!-- 2026-08-22 -->

### UAT-INT-003: A checkpoint is still recorded via the sole surviving (host-server) dispatch path after monitor.sh's block is deleted
- **Endpoint**: `GET /api/agents/:id/checkpoints`
- **Description**: TASK-121's CRITICAL constraint — before deleting `monitor.sh`'s `checkpoint_agent` call, TASK-120's replacement path must already checkpoint on its own. This case re-verifies that end-to-end now that the redundant bash-side call site is actually gone (UAT-120's equivalent case verified this while both paths still coexisted).
- **Steps**:
  1. Pick an agent with a non-null `worktreePath` (`GET /api/agents` → `worktreePath`); note its `id` (`<AGENT_ID>`) and window name.
  2. Note the current checkpoint count: `curl -sS 'http://localhost:8788/api/agents/REPLACE_AGENT_ID/checkpoints' | jq '.checkpoints | length'`.
  3. Force the agent busy, queue a task via `POST /api/tasks` with `{"command":"echo uat121-checkpoint","agentId":REPLACE_AGENT_ID}` (confirm `"dispatched":false`), then flip the agent's state file to idle and wait 3 seconds.
  4. Run the command below.
- **Command**:
  ```bash
  curl -sS 'http://localhost:8788/api/agents/REPLACE_AGENT_ID/checkpoints' | jq '.checkpoints | length'
  ```
- **Expected Result**: The count returned is strictly greater than the count recorded in Step 2 (at least one new checkpoint row), with the newest checkpoint's `ts` close to the idle-transition dispatch time from Step 3.
- **Repeatable Unit Test**: Not applicable: requires a real git worktree, a live host-server, and a real tmux pane transition. `stashCheckpoint`/`insertCheckpoint` themselves are already covered by `host-server/git.test.ts` and `host-server/db.migration.test.ts` — this case is about the surviving *caller* remaining correct post-deletion, not the checkpoint primitives.
- [x] Pass <!-- 2026-08-22 -->

### UAT-EDGE-001: The fleet-wide usage-limited marker still gates dispatch correctly after monitor.sh's dispatch block is deleted
- **Scenario**: `monitor.sh`'s `all_usage_hit` bookkeeping and the `touch/rm "${STATE_DIR}/usage-limited"` marker write (both outside the deleted block, per Step 3 of the task) must still run every tick, and the host-server's idle-transition trigger must still honor that marker.
- **Steps**:
  1. Confirm `logs/state/usage-limited` does not already exist (Prerequisites).
  2. Create the marker: `touch logs/state/usage-limited`.
  3. Force the target agent busy, then queue a task via `POST /api/tasks` with command `echo uat121-usagelimited` (confirm `"dispatched":false`).
  4. Note the current line count of `logs/dispatch.jsonl`.
  5. Flip the agent's state file to idle, then wait 3 seconds.
  6. Run the command below.
  7. **Cleanup (always run)**: `rm -f logs/state/usage-limited`, then confirm the still-queued task dispatches once the marker is gone.
- **Command**:
  ```bash
  jq -c 'select(.command=="echo uat121-usagelimited")' logs/dispatch.jsonl
  ```
- **Expected Result**: Prints nothing while the marker is present — no dispatch occurred. The task remains visibly queued (`GET /api/status` → agent's `queuedTasks >= 1`) throughout Steps 5-6, before cleanup removes the marker.
- **Repeatable Unit Test**: Not applicable: `existsSync(...)` gate and the bash marker-write logic are both unchanged by this task and were already the subject of UAT-120's UAT-EDGE-001; this case only re-confirms no regression after the deletion, via a live check.
- [x] Pass <!-- 2026-08-22 -->

### UAT-EDGE-002: Fleet-wide "all agents idle + usage hit → teardown" still fires after monitor.sh's dispatch block is deleted
- **Scenario**: `scripts/monitor.sh`'s end-of-loop auto-teardown block (`if $all_usage_hit && $all_idle; then ... teardown.sh ...`, now at lines 483-488) is unrelated to and untouched by this task's deletion, but shares the same per-agent loop whose `all_idle`/`all_usage_hit` bookkeeping now runs without the dispatch block interleaved — worth a live re-run rather than code-reading alone.
- **Steps**:
  1. In a disposable/test conductor session (do NOT run this against a shared dev session — it tears the session down), ensure all registered agents are idle.
  2. Simulate a fleet-wide usage-limit hit, e.g. by temporarily pointing `USAGE_CHECK_CMD` (in a scratch `conductor.conf` copy used for this session) at a command that always exits non-zero, or by using the real usage-check command against an account already at its limit if available.
  3. Wait for one `monitor.sh` tick (15s+) with all agents idle and usage hit.
  4. Observe the `conductor` tmux session.
- **Expected Result**: `monitor.sh` logs "All agents idle + usage limit hit. Shutting down.", `teardown.sh` runs, and the tmux session is torn down — identical to pre-task behavior, since this code path is untouched by the deletion (only the earlier per-agent block, which sits before this end-of-loop check, was modified).
- **Repeatable Unit Test**: Not applicable: exercises real process teardown and a real tmux session lifecycle; no harness exists for this in the repo, and simulating it destroys the test session by design.
- [FAIL: auto-judge: prerequisite not satisfied — no disposable/test `conductor` tmux session available; the only running `conductor` session is the shared live one (6 real registered agents), and this case explicitly forbids running against a shared dev session since it tears the session down] <!-- 2026-08-22 -->

### UAT-STATIC-001: monitor.sh's pop/mark_busy/checkpoint_agent/dispatch call sites are gone from the main loop, and the script is still syntactically valid
- **Scenario**: Task acceptance criterion — `monitor.sh` no longer pops tasks or dispatches. Statically verifiable without any live environment.
- **Steps**: Run both commands below as-is from the repo root.
- **Command**:
  ```bash
  bash -n scripts/monitor.sh && grep -n 'pop_task "${AGENT_IDS\[$name\]}"\|mark_busy "$window_name"\|checkpoint_agent "${AGENT_IDS\[$name\]}"' scripts/monitor.sh; echo "grep_exit=$?"
  ```
- **Expected Result**: `bash -n` produces no output (exit 0). The `grep` finds zero matches (`grep_exit=1`, no lines printed) — confirming the main-loop call sites for `pop_task`, `mark_busy`, and `checkpoint_agent` (the sequence that used to dispatch a task) are gone. (The function *definitions* of `pop_task`/`mark_busy` and `checkpoint_agent`'s definition in `scripts/lib/db.sh` remain — this task intentionally leaves them defined as harmless dead code / for TASK-068's UAT to keep exercising directly.) Confirmed during `/tackle` execution: `bash -n` produced no output (exit 0); `grep` for the three call-site patterns matched zero lines (`grep_exit=1`).
- **Repeatable Unit Test**: Not applicable: this is the static gate itself; no bats/shell-unit-test harness exists in this repo for `scripts/*.sh` (verified via `find_file`), matching UAT-120's documented finding for the same directory.
- [x] Pass <!-- 2026-08-21 -->

### UAT-STATIC-002: check_usage()/usage-limited marker and the fleet-wide teardown block are byte-for-byte unchanged, and npx tsc --noEmit passes in host-server/
- **Scenario**: Task acceptance criteria — `monitor.sh` still runs `check_usage`, bg-process liveness checks, and the fleet-wide auto-teardown at its existing 15s `POLL_INTERVAL`; and `npx tsc --noEmit` passes cleanly (no host-server changes expected in this task).
- **Steps**: Run the command below as-is from `host-server/`.
- **Command**:
  ```bash
  npx tsc --noEmit
  ```
- **Expected Result**: No output, exit code 0. Confirmed during `/tackle` execution: no `host-server/*.ts` files were modified by this task (scope was `scripts/monitor.sh` only), and `check_usage()` (`scripts/monitor.sh:293-311`), the `touch/rm "${STATE_DIR}/usage-limited"` marker block (now `scripts/monitor.sh:445-452`), the bg-process liveness loop, and the end-of-loop auto-teardown block (now `scripts/monitor.sh:483-488`) were all confirmed unchanged and outside the deleted line range via direct code inspection.
- **Repeatable Unit Test**: Not applicable: this is the static gate itself, and there is no shell-unit-test harness to further isolate the unchanged bash blocks in.
- [x] Pass <!-- 2026-08-21 -->

---

## Coverage vs Acceptance Criteria

| Acceptance criterion (from TASK-121) | Covered by |
|---|---|
| `monitor.sh` no longer pops tasks or dispatches — that responsibility lives solely in the host-server's collapsed loop (TASK-120) | UAT-STATIC-001, UAT-INT-001, UAT-INT-002 |
| No double-dispatch is observed across trials before the deletion, and no regression is possible after it | UAT-INT-001 (post-deletion: exactly-one-dispatch check), UAT-INT-002 (monitor-alone-cannot-dispatch check) |
| `checkpoint_agent`'s TASK-068 feature is preserved end-to-end through the surviving (host-server) dispatch path | UAT-INT-003 |
| `monitor.sh` still runs `check_usage`, bg-process liveness checks, and the fleet-wide auto-teardown at its existing 15s `POLL_INTERVAL` | UAT-EDGE-001, UAT-EDGE-002, UAT-STATIC-002 |
| `bash -n scripts/monitor.sh` and `npx tsc --noEmit` (host-server) both pass cleanly | UAT-STATIC-001, UAT-STATIC-002 |

**Split**: 2 of 7 cases (the two static gates) are machine-verified and checked off already, confirmed during `/tackle` execution of this task (no live environment available at generation time — `curl` to `http://localhost:8788` refused connection, `tmux list-sessions` reported no server running). The remaining 5 cases require a live host-server + tmux `conductor` session and are left `pending` for a human `/uat-walk` or headless `/uat-auto` pass. None of this task's change (a pure bash-loop deletion, no new logic) is unit-test promotable — this repo has no shell-script test harness (same finding UAT-120 documented), and the task introduced no new TypeScript logic to promote either.
