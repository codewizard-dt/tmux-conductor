---
id: UAT-120
aliases: [UAT-120]
title: "UAT: Collapse monitor.sh's 15s dispatch loop into the host-server's 2s status-poll loop"
status: passed
task: TASK-120
created: 2026-08-21
updated: 2026-09-02
---

# UAT-120 — UAT: Collapse monitor.sh's 15s dispatch loop into the host-server's 2s status-poll loop

implements::[[TASK-120]]

> **Source task**: [[TASK-120]]
> **Generated**: 2026-08-21

> **Note on unit-test scope**: `dispatchTaskToAgent` (`host-server/index.ts:468-515`) and the new idle-transition trigger inside `pollAndDiff` (`host-server/index.ts:~2352-2371`) are both unexported, module-private code inside `host-server/index.ts`, which has import-time side effects (opens the DB, sources `conductor.conf`, calls `fastify.listen`, starts every polling loop — no injectable app export). This is the same constraint UAT-119 documented for the same file. There is no way to unit-test either function's new logic in isolation without adding new test infrastructure (an exported/injectable app factory) that is out of this task's scope — every case below that exercises this task's new behavior is therefore a live integration check against a running host-server, not a unit test. `popTask`'s own soft-flip semantics predate this task (added by TASK-125, already unit-tested in `host-server/db.migration.test.ts`) and are not re-tested here since this task only wires an existing, already-tested function into a new caller.

---

## Prerequisites

- [ ] Host-server running on `http://localhost:8788` (`make dev` or `npm start` in `host-server/`). **This is a shared dev server in this repo** — coordinate before flipping any agent's state file, per the same caution UAT-119 documents.
- [ ] A conductor tmux session exists with at least one registered agent window that is currently `idle` with an empty queue, for UAT-API-001 (check `GET /api/status` → `agents[].state === "idle"` and `agents[].queuedTasks === 0`).
- [ ] An agent (can be the same one) whose state file you are cleared to flip directly at `$STATE_DIR/<window-name>.state` without disrupting another in-flight test, for UAT-INT-001 / UAT-EDGE-001 / UAT-EDGE-002. Prefer an agent with no `projectName` so its tmux window name equals its `name` field (`agentWindowName`, `host-server/db.ts:33-35`, returns `${projectName}-${name}` only when `projectName` is set).
- [ ] At least one agent with a non-null `worktreePath` for UAT-INT-002 — check `GET /api/agents` → `worktreePath` field (TASK-062 camelCase).
- [ ] `jq` installed.
- [ ] `STATE_DIR` (`./logs/state`) and `LOG_DIR` (`./logs`) from `conductor.conf` — defaults used throughout below; substitute if your local conf differs.
- [ ] Confirm `logs/state/usage-limited` does not already exist before starting: `test -f logs/state/usage-limited && echo EXISTS || echo ABSENT` should print `ABSENT` (UAT-EDGE-001 creates and removes this file — do not run it against a fleet that is genuinely usage-limited for real, since it would mask the real signal from `monitor.sh` for the duration of the test).

---

## Test Cases

### UAT-API-001: POST /api/tasks fast-path dispatch is unchanged after the dispatchTaskToAgent extraction
- **Endpoint**: `POST /api/tasks`
- **Description**: TASK-120 Step 1 factored the existing fast-path's inline checkpoint/mark-busy/log/send sequence into a shared `dispatchTaskToAgent` function. This case is the regression check that the fast path (idle agent, empty queue → immediate dispatch) still behaves identically: same response shape, same status code, and a `dispatch.jsonl` record with `detection: "immediate-enqueue"` (unchanged from before this task).
- **Steps**:
  1. Confirm the target agent is idle with an empty queue (see Prerequisites) and note its numeric `id` (`<AGENT_ID>`) from `GET /api/agents`.
  2. Note the current line count of `logs/dispatch.jsonl`: `wc -l < logs/dispatch.jsonl`.
  3. Run the command below, substituting `<AGENT_ID>`.
  4. Read the last line of `logs/dispatch.jsonl`.
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8788/api/tasks' -H 'Content-Type: application/json' -d '{"command":"echo uat120-fastpath","agentId":REPLACE_AGENT_ID}'
  ```
- **Expected Result**:
  - HTTP 200, body exactly `{"ok":true,"dispatched":true}`
  - `logs/dispatch.jsonl` gained exactly one new line; parsing it as JSON shows `detection == "immediate-enqueue"`, `command == "echo uat120-fastpath"`, `queue == "none"`, `queue_remaining == 0`
  - The command appears in the agent's tmux pane
  - The agent's state file reads `busy` immediately after the response returns
- **Repeatable Unit Test**: Not applicable: requires a live host-server process with a real tmux pane and DB — see the file-level note above on `host-server/index.ts`'s non-injectable entrypoint.
- [x] Pass <!-- 2026-08-22 -->

### UAT-INT-001: A queued task dispatches within one STATUS_POLL_MS tick of the agent going idle, via the new idle-transition trigger
- **Endpoint**: none directly — triggered internally by `pollAndDiff()`'s status-poll loop (`host-server/index.ts:~2352-2371`), default cadence `STATUS_POLL_MS=2000` (`conductor.conf`).
- **Description**: This is the task's core new behavior: a task queued while the agent is busy must dispatch automatically, without waiting for `monitor.sh`'s 15s loop, as soon as the agent's state transitions to idle — evidenced by a new `dispatch.jsonl` record with `detection: "idle-transition-poll"` landing within a couple of seconds of the state flip.
- **Steps**:
  1. Force the target agent busy: `echo -n busy > logs/state/<window-name>.state`.
  2. Queue a task for it via the slow path (agent is busy, so this must NOT fast-dispatch):
     ```bash
     curl -sS -X POST 'http://localhost:8788/api/tasks' -H 'Content-Type: application/json' -d '{"command":"echo uat120-idletrans","agentId":REPLACE_AGENT_ID}'
     ```
     Confirm the response body contains `"dispatched":false` and a `task` object (HTTP 201).
  3. Note the current line count of `logs/dispatch.jsonl`: `wc -l < logs/dispatch.jsonl`.
  4. Flip the agent's state file to idle and record the wall-clock time: `date -u +%s.%N && echo -n idle > logs/state/<window-name>.state`.
  5. Wait 3 seconds (`sleep 3`) to allow at least one `STATUS_POLL_MS` tick (default 2000ms) to observe the transition.
  6. Run the command below.
- **Command**:
  ```bash
  jq -c 'select(.detection=="idle-transition-poll" and .command=="echo uat120-idletrans")' logs/dispatch.jsonl
  ```
- **Expected Result**:
  - Prints exactly one matching JSON line (not empty)
  - Its `ts` field is within roughly 2-3 seconds of the timestamp recorded at Step 4 (well under `monitor.sh`'s 15s `POLL_INTERVAL`)
  - `agent` matches the window name, `queue` is `"none"`, `queue_remaining` is `0` (same record shape as the fast path, per the shared `dispatchTaskToAgent` function)
  - The command `echo uat120-idletrans` appears in the agent's tmux pane
  - The agent's state file reads `busy` again (marked busy by the dispatch, not left `idle`)
- **Repeatable Unit Test**: Blocked: the idle-transition condition (`prev.state !== 'idle' && agent.state === 'idle' && agent.queuedTasks > 0 && agent.windowPresent && !existsSync(...)`) is deterministic and would be cheap to unit-test in isolation, but it lives inline inside `pollAndDiff()`, which is unexported and only reachable by importing `host-server/index.ts` — an import that itself starts the real server (see file-level note above). Promoting this would require extracting the condition into an exported, injectable helper, which is new test infrastructure beyond this task's scope.
- [x] Pass <!-- 2026-08-22 -->

### UAT-INT-002: A checkpoint is recorded for a worktree agent dispatched via the idle-transition trigger
- **Endpoint**: `GET /api/agents/:id/checkpoints`
- **Description**: TASK-068's pre-dispatch checkpoint (`stashCheckpoint` + `insertCheckpoint`) must fire for every dispatch through the shared `dispatchTaskToAgent` function, including the new idle-transition path — this is the task's explicit CRITICAL constraint. This case confirms a worktree agent gains a new checkpoint row from an idle-transition dispatch, not just from the pre-existing fast path.
- **Steps**:
  1. Pick an agent with a non-null `worktreePath` (`GET /api/agents`, field `worktreePath`); note its `id` (`<AGENT_ID>`) and window name.
  2. Note the current checkpoint count: `curl -sS 'http://localhost:8788/api/agents/REPLACE_AGENT_ID/checkpoints' | jq '.checkpoints | length'`.
  3. Repeat UAT-INT-001's Steps 1-5 against this agent (force busy → queue a task → flip to idle → wait 3s), using a distinguishable command such as `echo uat120-checkpoint`.
  4. Run the command below.
- **Command**:
  ```bash
  curl -sS 'http://localhost:8788/api/agents/REPLACE_AGENT_ID/checkpoints' | jq '.checkpoints | length'
  ```
- **Expected Result**: The count returned is strictly greater than the count recorded in Step 2 (at least one new checkpoint row), and the newest checkpoint's `ts` is close to (within a few seconds of) the idle-transition dispatch time from Step 3.
- **Repeatable Unit Test**: Not applicable: requires a real git worktree, a live host-server, and a real tmux pane transition — same non-injectable-entrypoint constraint as UAT-INT-001. `stashCheckpoint`/`insertCheckpoint` themselves are already covered by existing tests in `host-server/git.test.ts` and `host-server/db.migration.test.ts` (`insertCheckpoint/listCheckpoints/getCheckpoint round-trip and ordering`) — this case is about the new *caller*, not the checkpoint primitives.
- [x] Pass <!-- 2026-08-22 -->

### UAT-EDGE-001: An agent whose usage is limited (fleet-wide usage-limited marker present) is not dispatched by the idle-transition trigger
- **Scenario**: The idle-transition condition in `pollAndDiff()` includes `!existsSync(path.join(conf.stateDir, 'usage-limited'))`. When `scripts/monitor.sh` (or, for this test, a manually-created marker file) indicates the fleet is usage-limited, an agent going idle with a queued task must NOT be dispatched by the new path — the task should stay queued.
- **Steps**:
  1. Confirm `logs/state/usage-limited` does not already exist (Prerequisites).
  2. Create the marker: `touch logs/state/usage-limited`.
  3. Force the target agent busy: `echo -n busy > logs/state/<window-name>.state`.
  4. Queue a task for it (slow path, same as UAT-INT-001 Step 2), using command `echo uat120-usagelimited`. Confirm `"dispatched":false`.
  5. Note the current line count of `logs/dispatch.jsonl`: `wc -l < logs/dispatch.jsonl`.
  6. Flip the agent's state file to idle: `echo -n idle > logs/state/<window-name>.state`.
  7. Wait 3 seconds (`sleep 3`).
  8. Run the command below.
  9. **Cleanup (always run, pass or fail)**: `rm -f logs/state/usage-limited`, then confirm the still-queued task eventually dispatches once the marker is gone (e.g. re-flip the state file busy→idle again, or leave it — the next real idle transition will pick it up).
- **Command**:
  ```bash
  jq -c 'select(.detection=="idle-transition-poll" and .command=="echo uat120-usagelimited")' logs/dispatch.jsonl
  ```
- **Expected Result**: Prints nothing (no matching line) — the task was never dispatched by the idle-transition trigger while the marker file was present. The task should still be visible as queued (not `dispatched`) for the agent, e.g. via `GET /api/status` → that agent's `queuedTasks >= 1` immediately after Step 7, before cleanup removes the marker.
- **Repeatable Unit Test**: Blocked: same reasoning as UAT-INT-001 — the `existsSync(...)` gate is deterministic but is embedded inline in the non-injectable `pollAndDiff()`.
- [x] Pass <!-- 2026-09-02 -->

### UAT-EDGE-002: A project-scoped task dispatched via the idle-transition trigger sends /clear before the command
- **Scenario**: `dispatchTaskToAgent`'s `opts.clearFirst` sends `/clear` to the pane before the task text. The idle-transition trigger passes `clearFirst: task.kind === 'project'` — a task popped via a `projectId` match (not a direct `agentId` match) must trigger a `/clear` first, mirroring `scripts/monitor.sh:447-449`'s existing behavior for the old dispatch path.
- **Steps**:
  1. Pick an agent that belongs to a project (`GET /api/agents` → non-null `projectId`/`projectName`); note its `id`, `projectId`, and window name (`${projectName}-${name}`).
  2. Force the agent busy: `echo -n busy > logs/state/<window-name>.state`.
  3. Queue a task scoped to the **project** (not the agent) so `popTask` classifies it `kind: 'project'`:
     ```bash
     curl -sS -X POST 'http://localhost:8788/api/tasks' -H 'Content-Type: application/json' -d '{"command":"echo uat120-clearfirst","projectId":REPLACE_PROJECT_ID}'
     ```
     Confirm `"dispatched":false`.
  4. Flip the agent's state file to idle: `echo -n idle > logs/state/<window-name>.state`.
  5. Wait 3 seconds, then capture the pane's recent history.
  6. Run the command below.
- **Command**:
  ```bash
  tmux capture-pane -t conductor:REPLACE_WINDOW_NAME -p -S -30
  ```
- **Expected Result**: The captured pane text shows the pane was cleared (Claude Code's `/clear` output, e.g. a fresh/empty conversation view or a "conversation cleared" style indicator, immediately followed by `echo uat120-clearfirst` running) — i.e. the `/clear` send visibly preceded the task command in the pane's own history, not the other way around. (Note: `dispatch.jsonl`'s record is written *before* the `/clear`/command sends in `dispatchTaskToAgent`'s own body order, so the log itself cannot be used to verify send ordering — this case must be checked against the live pane.)
- **Repeatable Unit Test**: Not applicable: requires a real tmux pane and a project-scoped agent; the `clearFirst` boolean itself is a one-line pass-through (`task.kind === 'project'`) with no independent logic to isolate — the thing worth verifying is that the pane actually receives `/clear` before the command, which only a live pane observation can show.
- [x] Pass <!-- 2026-08-22 -->

### UAT-STATIC-001: npx tsc --noEmit passes in host-server/
- **Scenario**: Task acceptance criterion — all of TASK-120's changes (`host-server/index.ts`) must typecheck cleanly.
- **Steps**: Run the command below as-is from `host-server/`.
- **Command**:
  ```bash
  npx tsc --noEmit
  ```
- **Expected Result**: No output, exit code 0. (Confirmed clean during `/tackle` execution of this task, after all three code steps combined.)
- **Repeatable Unit Test**: Not applicable: this is the static gate itself, not a case to further unit-test.
- [x] Pass <!-- 2026-08-21 -->

### UAT-STATIC-002: bash -n scripts/monitor.sh passes, and monitor.sh's own dispatch block is untouched by this task
- **Scenario**: Task acceptance criterion — `scripts/monitor.sh` must remain syntactically valid, and its pre-existing `checkpoint_agent` → `dispatch` block (TASK-121's scope to remove, not this task's) must be left intact.
- **Steps**: Run the command below as-is from the repo root.
- **Command**:
  ```bash
  bash -n scripts/monitor.sh
  ```
- **Expected Result**: No output, exit code 0 (`SYNTAX_OK` printed if you append `&& echo SYNTAX_OK`). Confirmed during `/tackle` execution: `git diff scripts/monitor.sh` showed exactly 13 additive lines across two locations (the `all_usage_hit` declaration comment and the new marker write/remove block after the per-agent loop) — the original `checkpoint_agent`/`dispatch` block, now at lines 443-450, was not touched, reordered, or deleted.
- **Repeatable Unit Test**: Not applicable: this is the static gate itself; there is no bats/shell-unit-test harness in this repo for `scripts/*.sh` (verified via `find_file`), matching the existing pattern where shell-script correctness is checked via `bash -n` plus live/UAT verification, not unit tests.
- [x] Pass <!-- 2026-08-21 -->

---

## Coverage vs Acceptance Criteria

| Acceptance criterion (from TASK-120) | Covered by |
|---|---|
| `pollAndDiff`'s idle-transition detection triggers task pop + dispatch for an agent with queued tasks within one `STATUS_POLL_MS` tick of going idle | UAT-INT-001 |
| The new dispatch path calls `stashCheckpoint`/`insertCheckpoint` before every dispatch to a git-worktree agent (TASK-068 preserved) | UAT-INT-002 |
| An agent whose usage is limited (fleet-wide `usage-limited` marker present) is not dispatched by the new path even if it goes idle with queued tasks | UAT-EDGE-001 |
| The existing `POST /api/tasks` fast-path behavior is unchanged | UAT-API-001 |
| `monitor.sh`'s existing dispatch block is untouched by this task (TASK-121's scope) | UAT-STATIC-002 |
| `npx tsc --noEmit` passes in `host-server/`; `bash -n scripts/monitor.sh` is clean | UAT-STATIC-001, UAT-STATIC-002 |

**Not a formal acceptance-criterion bullet but explicitly called out in the task's Approach section**: project-scoped tasks (`kind: 'project'`) must trigger `/clear` before the command, mirroring `monitor.sh`'s old behavior — covered by UAT-EDGE-002.

**Split**: 2 of 7 cases (the two static gates) are already machine-verified and checked off from `/tackle`'s own execution; the remaining 5 require a live host-server + tmux session and are left `pending` for a human `/uat-walk` or headless `/uat-auto` pass, since this generation was run without a live host-server available (`curl` to `http://localhost:8788` refused connection at generation time) and none of TASK-120's new logic is unit-test promotable (see the file-level note above on `host-server/index.ts`'s non-injectable entrypoint — the same constraint UAT-119 already documented for this file).
