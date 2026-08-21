---
id: UAT-068
aliases: [UAT-068]
title: "UAT: Pre-dispatch checkpoint — git stash push before each task dispatch + record in agent_checkpoints"
status: passed
task: TASK-068
created: 2026-08-15
updated: 2026-08-15
---

# UAT-068 — UAT: Pre-dispatch checkpoint — git stash push before each task dispatch + record in agent_checkpoints

implements::[[TASK-068]]

> **Source task**: [[TASK-068]]
> **Generated**: 2026-08-15
> **Note**: TASK-068 wires the checkpoint into *two* independent dispatch paths — the host-server's immediate-dispatch fast path (`POST /api/tasks` when the target agent is idle with an empty queue, `host-server/index.ts:~824-861`, calling `stashCheckpoint`/`insertCheckpoint` from `git.ts`/`db.ts`) and `monitor.sh`'s poll-loop dispatch (`scripts/monitor.sh:441-443`, calling `checkpoint_agent` from `scripts/lib/db.sh:146-167`). Both are exercised below — three cases through the fast path (dirty / clean / no-worktree) and three through the monitor.sh loop (dirty / clean / no-worktree) — since they are separate implementations of the same stash-then-dispatch contract. Test agents use `launchCmd: "bash"` (no Claude Code hooks fire for a plain shell), so every case manually seeds the per-agent `.state` file to force `idle` and manually dirties/leaves-clean a tracked file in the worktree, giving deterministic control over the exact scenario under test.

---

## Prerequisites

- [ ] Host-server running on `http://127.0.0.1:8788` (`make dev` or `npm --prefix host-server run dev`)
- [ ] The conductor tmux session is running (`POST /api/agents` returns `409 { error: "session not running" }` otherwise). UAT-API-001/002 and UAT-EDGE-001 only need the session for agent spawn/dispatch and exercise the host-server fast path directly.
- [ ] `monitor.sh` actively polling inside that session (start via `scripts/conductor.sh`, not `make dev` alone, which only starts the host-server + frontend dev servers). Required for UAT-EDGE-002/003/004, which verify the `checkpoint_agent` bash function in the poll-loop dispatch path. `POLL_INTERVAL` is `15` in `conductor.conf` — allow ~20s after seeding `idle` for the next tick to pick the task up.
- [ ] `jq` and `git` installed
- [ ] A fixture git repo with one committed tracked file, created once and reused by every worktree-based case below (each agent gets its own `worktrees/<agent-id>/` off this same repo root, so cases don't collide):
  ```bash
  mkdir -p /Users/davidtaylor/Repositories/tmux-conductor/tmp/uat068-fixture
  cd /Users/davidtaylor/Repositories/tmux-conductor/tmp/uat068-fixture
  git init -b main -q
  echo "v1" > tracked.txt
  git add tracked.txt
  git -c user.email=uat@test.local -c user.name=UAT commit -q -m init
  cd /Users/davidtaylor/Repositories/tmux-conductor
  ```
- [ ] Cleanup after every test: `DELETE /api/agents/:id` for every throwaway agent (this also tears down its worktree per TASK-063) and `rm -f logs/state/<window-name>.state` for any state file written manually. Remove the fixture repo once all cases are done: `rm -rf tmp/uat068-fixture`.

---

## Test Cases

### UAT-API-001: Fast-path dispatch stashes a dirty worktree and records the checkpoint
- **Endpoint**: `POST /api/tasks` (host-server immediate-dispatch fast path)
- **Description**: Dispatching to an idle agent with an empty queue and a *dirty* tracked file in its worktree stashes the change before the command reaches the pane, and records the resolved stash SHA in `agent_checkpoints`.
- **Steps**:
  1. Create the agent against the fixture repo and capture its `id`/`worktreePath`:
     ```bash
     curl -sS -X POST 'http://127.0.0.1:8788/api/agents' -H 'Content-Type: application/json' -d '{"name":"uat068-fp-dirty","workdir":"/Users/davidtaylor/Repositories/tmux-conductor/tmp/uat068-fixture","launchCmd":"bash"}'
     ```
     Note `agent.id` (`$GID1`) and `agent.worktreePath` (`$WP1`) from the response.
  2. Dirty the tracked file inside the worktree:
     ```bash
     echo "v2 dirty" > "$WP1/tracked.txt"
     ```
  3. Force the agent idle (no hooks fire for a bare `bash` launch command, so the state file is never written otherwise):
     ```bash
     printf 'idle\n' > /Users/davidtaylor/Repositories/tmux-conductor/logs/state/uat068-fp-dirty.state
     ```
  4. Run the command below (this is the fast path: idle + no queued tasks for `$GID1`).
  5. Confirm the checkpoint and the stash:
     ```bash
     curl -sS "http://127.0.0.1:8788/api/agents/$GID1/checkpoints" | jq
     git -C "$WP1" stash list
     git -C "$WP1" status --porcelain
     ```
  6. Teardown:
     ```bash
     curl -sS -X DELETE "http://127.0.0.1:8788/api/agents/$GID1"
     rm -f /Users/davidtaylor/Repositories/tmux-conductor/logs/state/uat068-fp-dirty.state
     ```
- **Command**:
  ```bash
  curl -sS -i -X POST 'http://127.0.0.1:8788/api/tasks' -H 'Content-Type: application/json' -d '{"agentId":0,"command":"true"}'
  ```
  (replace `0` with `$GID1`)
- **Expected Result**: HTTP 200 `{"ok":true,"dispatched":true}`. `GET /api/agents/$GID1/checkpoints` returns exactly one entry with `agentId` equal to `$GID1`, an integer `ts`, and `stashRef` matching a 40-char git SHA (`^[0-9a-f]{40}$`). `git -C "$WP1" stash list` shows one `stash@{0}` entry whose message contains `conductor-checkpoint-<ts>` where `<ts>` matches the checkpoint's `ts`. `git -C "$WP1" status --porcelain` prints nothing — the dirty change was captured by the stash, not left in the worktree.
- **Repeatable Unit Test**: Not applicable: live-server integration over the Fastify route (registered inline in `host-server/index.ts` with no injectable app export) plus a real git worktree. The underlying `stashCheckpoint` helper it calls already has a repeatable unit test in `host-server/git.test.ts` (`stashCheckpoint stashes a dirty worktree and returns the resolved stash SHA`, added under TASK-070), and `insertCheckpoint`'s round-trip is covered in `host-server/db.migration.test.ts` (added under TASK-067). This case verifies only the wiring between them in the fast-path handler, which requires the live route.
- [x] Pass <!-- 2026-08-15 -->

### UAT-API-002: Fast-path dispatch to a non-worktree agent records no checkpoint
- **Endpoint**: `POST /api/tasks`
- **Description**: An idle agent whose `workdir` is outside any git repo has `worktree_path` NULL; dispatching to it must not run any git command and must not insert a checkpoint row, while still dispatching normally.
- **Steps**:
  1. Create the agent with a workdir that is guaranteed not to be a git work tree:
     ```bash
     curl -sS -X POST 'http://127.0.0.1:8788/api/agents' -H 'Content-Type: application/json' -d '{"name":"uat068-fp-nogit","workdir":"/tmp","launchCmd":"bash"}'
     ```
     Confirm the response's `agent.worktreePath` is `null`. Note `agent.id` (`$GID2`).
  2. Force the agent idle:
     ```bash
     printf 'idle\n' > /Users/davidtaylor/Repositories/tmux-conductor/logs/state/uat068-fp-nogit.state
     ```
  3. Run the command below.
  4. Confirm no checkpoint exists:
     ```bash
     curl -sS "http://127.0.0.1:8788/api/agents/$GID2/checkpoints" | jq '.checkpoints'
     ```
  5. Teardown:
     ```bash
     curl -sS -X DELETE "http://127.0.0.1:8788/api/agents/$GID2"
     rm -f /Users/davidtaylor/Repositories/tmux-conductor/logs/state/uat068-fp-nogit.state
     ```
- **Command**:
  ```bash
  curl -sS -i -X POST 'http://127.0.0.1:8788/api/tasks' -H 'Content-Type: application/json' -d '{"agentId":0,"command":"true"}'
  ```
  (replace `0` with `$GID2`)
- **Expected Result**: HTTP 200 `{"ok":true,"dispatched":true}` — dispatch succeeds exactly as it did before this task. `GET /api/agents/$GID2/checkpoints` returns `{"checkpoints":[]}`.
- **Repeatable Unit Test**: Not applicable: live-server integration; the `if (foundAgent.worktreePath)` guard being skipped for a NULL `worktree_path` is a one-line conditional in the route handler with no separately testable unit — verified here against the live server only.
- [x] Pass <!-- 2026-08-15 -->

### UAT-EDGE-001: Fast-path dispatch to a clean worktree logs a warning but does not block dispatch
- **Scenario**: The agent's worktree has a `worktree_path` but nothing to stash (freshly created worktree, untouched). `stashCheckpoint` must return `null` (per its existing unit test), the route must skip `insertCheckpoint`, and the dispatch must still proceed.
- **Steps**:
  1. Create a fresh worktree agent and leave its tracked file untouched:
     ```bash
     curl -sS -X POST 'http://127.0.0.1:8788/api/agents' -H 'Content-Type: application/json' -d '{"name":"uat068-fp-clean","workdir":"/Users/davidtaylor/Repositories/tmux-conductor/tmp/uat068-fixture","launchCmd":"bash"}'
     ```
     Note `agent.id` (`$GID3`) and `agent.worktreePath` (`$WP3`).
  2. Force the agent idle:
     ```bash
     printf 'idle\n' > /Users/davidtaylor/Repositories/tmux-conductor/logs/state/uat068-fp-clean.state
     ```
  3. Run the command below.
  4. Confirm no checkpoint and no stash entry:
     ```bash
     curl -sS "http://127.0.0.1:8788/api/agents/$GID3/checkpoints" | jq '.checkpoints'
     git -C "$WP3" stash list
     ```
  5. Check the host-server process's stdout for a line matching `no checkpoint recorded for agent $GID3 (clean worktree or git error)` (informational only — not required for pass/fail, the checkpoints-endpoint assertion above is the deterministic check).
  6. Teardown:
     ```bash
     curl -sS -X DELETE "http://127.0.0.1:8788/api/agents/$GID3"
     rm -f /Users/davidtaylor/Repositories/tmux-conductor/logs/state/uat068-fp-clean.state
     ```
- **Command**:
  ```bash
  curl -sS -i -X POST 'http://127.0.0.1:8788/api/tasks' -H 'Content-Type: application/json' -d '{"agentId":0,"command":"true"}'
  ```
  (replace `0` with `$GID3`)
- **Expected Result**: HTTP 200 `{"ok":true,"dispatched":true}`. `GET /api/agents/$GID3/checkpoints` returns `{"checkpoints":[]}`. `git -C "$WP3" stash list` is empty.
- **Repeatable Unit Test**: Not applicable: live-server integration. `stashCheckpoint`'s clean-worktree `null` return is already covered by `host-server/git.test.ts` (`stashCheckpoint returns null for a clean worktree (nothing to stash)`, added under TASK-070); this case additionally verifies the route neither blocks dispatch nor calls `insertCheckpoint` when that `null` comes back, which needs the live route.
- [x] Pass <!-- 2026-08-15 -->

### UAT-EDGE-002: monitor.sh dispatch loop stashes a dirty worktree via `checkpoint_agent`
- **Scenario**: A task queued (not fast-dispatched) for a git-worktree agent, picked up by `monitor.sh`'s poll loop once the agent goes idle. `checkpoint_agent` (`scripts/lib/db.sh:146-167`) must run before `dispatch`, stashing the dirty tracked file and inserting a row into `agent_checkpoints` via direct SQLite access (not the HTTP endpoint).
- **Steps**:
  1. Create the agent (a freshly spawned `bash` pane has no idle-pattern-matching tail, so it is *not* idle yet — the task below queues instead of fast-dispatching):
     ```bash
     curl -sS -X POST 'http://127.0.0.1:8788/api/agents' -H 'Content-Type: application/json' -d '{"name":"uat068-mon-dirty","workdir":"/Users/davidtaylor/Repositories/tmux-conductor/tmp/uat068-fixture","launchCmd":"bash"}'
     ```
     Note `agent.id` (`$GID4`) and `agent.worktreePath` (`$WP4`).
  2. Dirty the tracked file:
     ```bash
     echo "v2 dirty mon" > "$WP4/tracked.txt"
     ```
  3. Queue a task (do not force idle yet):
     ```bash
     curl -sS -X POST 'http://127.0.0.1:8788/api/tasks' -H 'Content-Type: application/json' -d '{"agentId":'"$GID4"',"command":"true"}'
     ```
     Confirm the response has `"dispatched":false` (HTTP 201) — proving this went through the general queue insert, not the fast path.
  4. Force the agent idle so the next `monitor.sh` tick dispatches it:
     ```bash
     printf 'idle\n' > /Users/davidtaylor/Repositories/tmux-conductor/logs/state/uat068-mon-dirty.state
     ```
  5. Wait ~20s for the next poll tick (`POLL_INTERVAL=15` in `conductor.conf`).
  6. Confirm the task was popped from the queue:
     ```bash
     curl -sS "http://127.0.0.1:8788/api/queue/$GID4" | jq '.tasks | length'
     ```
  7. Confirm the checkpoint and the stash:
     ```bash
     git -C "$WP4" stash list
     git -C "$WP4" status --porcelain
     ```
  8. Teardown:
     ```bash
     curl -sS -X DELETE "http://127.0.0.1:8788/api/agents/$GID4"
     rm -f /Users/davidtaylor/Repositories/tmux-conductor/logs/state/uat068-mon-dirty.state
     ```
- **Command**:
  ```bash
  curl -sS "http://127.0.0.1:8788/api/agents/0/checkpoints" | jq
  ```
  (replace `0` with `$GID4`, run after the wait in step 5)
- **Expected Result**: Step 3 response has `"dispatched":false`. After the poll tick: `GET /api/queue/$GID4` reports `0` queued tasks (the task was popped and dispatched). The checkpoints command returns exactly one entry with `agentId` equal to `$GID4`, an integer `ts`, and `stashRef` matching `^[0-9a-f]{40}$`. `git -C "$WP4" stash list` shows one entry whose message contains `conductor-checkpoint-<ts>` matching that `ts`. `git -C "$WP4" status --porcelain` prints nothing.
- **Repeatable Unit Test**: Not applicable: `checkpoint_agent` is a bash function that shells out to live `git`/`sqlite3` and reads real DB state; this repo has no bash test harness (no `bats`/`shunit2`) and none of the nearby scripts (`scripts/lib/db.sh`, `scripts/monitor.sh`) have one, so adding one is new infrastructure rather than an existing local pattern. The git-stash mechanics it relies on are already covered from the TypeScript side by `host-server/git.test.ts`'s `stashCheckpoint` tests (same underlying `git stash push`/`rev-parse` sequence); this case verifies the bash implementation and the poll-loop wiring specifically, which needs the live orchestrator.
- [x] Pass <!-- 2026-08-15 -->

### UAT-EDGE-003: monitor.sh dispatch loop skips git ops for a non-worktree agent
- **Scenario**: A queued task for an agent with no `worktree_path`, picked up by `monitor.sh`. `checkpoint_agent` must return immediately (its `worktree_path` guard) without running any git command, and dispatch must proceed normally.
- **Steps**:
  1. Create the agent with a non-git workdir:
     ```bash
     curl -sS -X POST 'http://127.0.0.1:8788/api/agents' -H 'Content-Type: application/json' -d '{"name":"uat068-mon-nogit","workdir":"/tmp","launchCmd":"bash"}'
     ```
     Confirm `agent.worktreePath` is `null`. Note `agent.id` (`$GID5`).
  2. Queue a task:
     ```bash
     curl -sS -X POST 'http://127.0.0.1:8788/api/tasks' -H 'Content-Type: application/json' -d '{"agentId":'"$GID5"',"command":"true"}'
     ```
     Confirm `"dispatched":false`.
  3. Force the agent idle:
     ```bash
     printf 'idle\n' > /Users/davidtaylor/Repositories/tmux-conductor/logs/state/uat068-mon-nogit.state
     ```
  4. Wait ~20s for the next poll tick.
  5. Confirm the task was popped:
     ```bash
     curl -sS "http://127.0.0.1:8788/api/queue/$GID5" | jq '.tasks | length'
     ```
  6. Teardown:
     ```bash
     curl -sS -X DELETE "http://127.0.0.1:8788/api/agents/$GID5"
     rm -f /Users/davidtaylor/Repositories/tmux-conductor/logs/state/uat068-mon-nogit.state
     ```
- **Command**:
  ```bash
  curl -sS "http://127.0.0.1:8788/api/agents/0/checkpoints" | jq '.checkpoints'
  ```
  (replace `0` with `$GID5`, run after the wait in step 4)
- **Expected Result**: `GET /api/queue/$GID5` reports `0` queued tasks after the poll tick (dispatch proceeded normally with no worktree). The checkpoints command returns `[]` — no row was inserted.
- **Repeatable Unit Test**: Not applicable: same bash-function/live-orchestrator constraint as UAT-EDGE-002; the early-return guard on an empty `worktree_path` (`scripts/lib/db.sh:150-152`) is a two-line conditional verified here against the live monitor loop.
- [x] Pass <!-- 2026-08-15 -->

### UAT-EDGE-004: monitor.sh dispatch loop on a clean worktree records no checkpoint but still dispatches
- **Scenario**: A queued task for a git-worktree agent whose worktree is clean (nothing to stash). `checkpoint_agent`'s `git stash push` must report "No local changes to save", causing the function to warn and return without inserting a row, and dispatch must still proceed.
- **Steps**:
  1. Create a fresh worktree agent and leave its tracked file untouched:
     ```bash
     curl -sS -X POST 'http://127.0.0.1:8788/api/agents' -H 'Content-Type: application/json' -d '{"name":"uat068-mon-clean","workdir":"/Users/davidtaylor/Repositories/tmux-conductor/tmp/uat068-fixture","launchCmd":"bash"}'
     ```
     Note `agent.id` (`$GID6`) and `agent.worktreePath` (`$WP6`).
  2. Queue a task:
     ```bash
     curl -sS -X POST 'http://127.0.0.1:8788/api/tasks' -H 'Content-Type: application/json' -d '{"agentId":'"$GID6"',"command":"true"}'
     ```
     Confirm `"dispatched":false`.
  3. Force the agent idle:
     ```bash
     printf 'idle\n' > /Users/davidtaylor/Repositories/tmux-conductor/logs/state/uat068-mon-clean.state
     ```
  4. Wait ~20s for the next poll tick.
  5. Confirm the task was popped and no stash was created:
     ```bash
     curl -sS "http://127.0.0.1:8788/api/queue/$GID6" | jq '.tasks | length'
     git -C "$WP6" stash list
     ```
  6. Teardown:
     ```bash
     curl -sS -X DELETE "http://127.0.0.1:8788/api/agents/$GID6"
     rm -f /Users/davidtaylor/Repositories/tmux-conductor/logs/state/uat068-mon-clean.state
     ```
- **Command**:
  ```bash
  curl -sS "http://127.0.0.1:8788/api/agents/0/checkpoints" | jq '.checkpoints'
  ```
  (replace `0` with `$GID6`, run after the wait in step 4)
- **Expected Result**: `GET /api/queue/$GID6` reports `0` queued tasks after the poll tick. The checkpoints command returns `[]`. `git -C "$WP6" stash list` is empty.
- **Repeatable Unit Test**: Not applicable: same bash-function/live-orchestrator constraint as UAT-EDGE-002; the "No local changes to save" string match (`scripts/lib/db.sh:154-157`) is exercised here against the live monitor loop and real git output.
- [x] Pass <!-- 2026-08-15 -->

---

## Coverage vs Acceptance Criteria

| Acceptance criterion | Covered by |
|---|---|
| Every task dispatch to a git-worktree agent creates a `git stash push -m "conductor-checkpoint-<ts>"` snapshot before the command is sent | UAT-API-001 (fast path), UAT-EDGE-002 (monitor.sh path) |
| The stash ref is recorded in `agent_checkpoints` with the correct `agent_id` and `ts` | UAT-API-001, UAT-EDGE-002 |
| Non-git agents (no `worktree_path`) dispatch without any git operations | UAT-API-002 (fast path), UAT-EDGE-003 (monitor.sh path) |
| A clean worktree (nothing to stash) logs a warning but does not block dispatch | UAT-EDGE-001 (fast path), UAT-EDGE-004 (monitor.sh path) |
| `npx tsc --noEmit` passes in `host-server/` | Static gate — verified during `/tackle` (not re-tested here) |

**Note on `uatGenerate.promoteTests`**: the stored preference (`true`) uses the legacy true/false grammar and was mapped to `dedicated` for this run. No test files were created under it because every case in this file requires a live host-server route, a live tmux/monitor.sh orchestrator, or both — none are unit-test-promotable per the Step 2.5 criteria. The git-stash mechanics both dispatch paths depend on are already covered by existing repeatable unit tests: `host-server/git.test.ts` (`stashCheckpoint`, added under TASK-070) and `host-server/db.migration.test.ts` (`insertCheckpoint`/`listCheckpoints`, added under TASK-067).
