---
id: TASK-120
aliases: [TASK-120]
title: "Collapse monitor.sh's 15s dispatch loop into the host-server's 2s status-poll loop"
status: todo
created: 2026-08-15
updated: 2026-08-15
depends_on: []
blocks: [TASK-121, TASK-116]
parallel_safe_with: []
uat: ""
tags: [latency, dispatch, monitor, host-server, roadmap-017]
---

# TASK-120 — Collapse monitor.sh's 15s dispatch loop into the host-server's 2s status-poll loop

blocks::[[TASK-121]]
blocks::[[TASK-116]]

## Objective

Add an idle-transition-triggered dispatch path to the host-server's existing 2s status-poll loop (`pollAndDiff` in `host-server/index.ts`), so a queued task reaches the pane within one status-poll tick (~2s) of the agent going idle, instead of waiting for `monitor.sh`'s independent 15s `POLL_INTERVAL` loop. This task **adds** the new fast trigger; it does **not** remove `monitor.sh`'s existing dispatch block yet — that removal, and the double-dispatch-race hardening it requires, is TASK-121's job. Landing them separately keeps this task's diff small and lets TASK-121 verify the new path is safe before deleting the old one.

## CRITICAL constraint — do not break TASK-068's pre-dispatch checkpoint

`monitor.sh`'s dispatch block (`scripts/monitor.sh:436-451`) calls `checkpoint_agent "${AGENT_IDS[$name]}"` at line 443, immediately before `dispatch`, per TASK-068 (ROADMAP-007 Phase 3 — git-stash checkpoint before every dispatch, recorded in `agent_checkpoints`). **The new host-server dispatch path added by this task MUST call the equivalent checkpoint step too, or every task dispatched through the new fast path silently loses TASK-068's checkpoint feature.** The TypeScript twin of `checkpoint_agent` already exists and is already exercised by the host-server's *other* fast-dispatch path — `stashCheckpoint(worktreePath, ts)` (`host-server/git.ts:133`) + `insertCheckpoint(db, agentId, ts, stashRef)` (`host-server/db.ts:883`) — see the existing usage in the `POST /api/tasks` immediate-dispatch handler at `host-server/index.ts:850-861`. Reuse that exact pattern; do not skip it "because monitor.sh still checkpoints sometimes" — once TASK-121 removes `monitor.sh`'s block, this path becomes the *only* checkpoint site for queue-driven dispatch, so it must be correct from the moment this task lands, even while the old path is still running redundantly.

## Approach

**Where the trigger goes:** `pollAndDiff()` (`host-server/index.ts:2194-2270ish`) already diffs `current.agents` against `prevSnapshot.agents` every tick and detects state transitions at line 2227: `if (prev && prev.state !== agent.state) { ... }` (currently used only to bump `liveUpdateMetrics.statusTransitions` and log to `observability.jsonl`). Add a sibling check in the same per-agent loop: when `prev.state !== 'idle' && agent.state === 'idle'` (a genuine idle transition, not "was already idle"), the agent has queued tasks (`agent.queuedTasks > 0` is already computed on the snapshot), and dispatch is not currently paused (see the usage-limit note below) — pop and dispatch immediately.

**Reuse existing primitives, don't reinvent them:**
- **Task pop**: `popTask(db, agentName)` (`host-server/db.ts:666-685`) already exists — it's the exact SQL twin of bash's `pop_task_sql`/`pop_task` (scoped → project → global priority, `DELETE ... RETURNING`). **It is currently unreferenced anywhere in the codebase** (`find_referencing_symbols` on it returns nothing) — this task is what wires it up. Call it with the agent's `name` (not id — its signature takes `agentName: string`).
- **Mark busy**: write `'busy\n'` to `${stateDir}/${windowName}.state`, exactly as the existing fast-path handler already does at `host-server/index.ts:832-836`.
- **Checkpoint**: `stashCheckpoint` + `insertCheckpoint` per the CRITICAL constraint above.
- **Dispatch log**: append a `dispatch.jsonl` record shaped like the existing fast-path's `dispatchRecord` at `host-server/index.ts:838-849` (use `detection: 'idle-transition-poll'` instead of `'immediate-enqueue'` so the two trigger paths stay distinguishable in the log).
- **Send the command**: `sendTextToPane(conf.sessionName, win, cmdText)` (already imported from `./state.ts`).
- **/clear before project-scoped tasks**: `pop_task`'s SQL twin `popTask` returns a `kind: 'scoped' | 'project' | 'global'` — when `kind === 'project'`, send `/clear` before the task text, mirroring `scripts/monitor.sh:444-446`.

Factor this sequence (checkpoint → mark-busy → dispatch-log → optional `/clear` → send) into a single shared function (e.g. `dispatchTaskToAgent(db, conf, agent, task)`) and call it from **both** the existing `POST /api/tasks` fast-path handler (`host-server/index.ts:~824-865`) and the new idle-transition trigger in `pollAndDiff`. Do not duplicate the sequence a third time — the fast-path handler already has it inline; extracting it now avoids two independently-drifting copies before TASK-121 adds a third caller path's worth of edge cases.

**Usage-limit coordination (do not silently drop this either):** `monitor.sh`'s `check_usage()` (`scripts/monitor.sh:293-311`) runs `USAGE_CHECK_CMD` (a shell command, e.g. `claude usage | grep -qi "extra usage"`) before every dispatch and pauses that agent when it fails; when *all* agents are idle and usage-limited in the same tick, `monitor.sh` tears the whole session down (`scripts/monitor.sh:470-475`). This task's new host-server dispatch path must not bypass that pause — an agent whose usage is currently limited must not get dispatched just because it went idle. Do not re-implement `USAGE_CHECK_CMD` evaluation in TypeScript (it's an arbitrary user shell command per `conductor.conf`, and re-running it on every 2s tick for every agent would be wasteful). Instead: have `monitor.sh` continue running `check_usage()` on its own (now-purely-advisory-for-dispatch, still load-bearing for teardown) loop and write a small shared marker the host-server can check cheaply before dispatching — e.g. touch/remove `${STATE_DIR}/usage-limited` (fleet-wide, matching the existing fleet-wide `all_usage_hit` semantics) when `check_usage` fails/recovers. The host-server's new dispatch trigger checks for that file's presence and skips dispatch (leaving the task queued, agent idle) when present. Document this file's meaning with a comment in both `scripts/monitor.sh` and wherever the host-server reads it.

## Steps

### 1. Extract the shared dispatch sequence  <!-- agent: general-purpose -->

- [ ] In `host-server/index.ts`, factor the checkpoint → mark-busy → dispatch-log → optional-`/clear` → `sendTextToPane` sequence currently inline in the `POST /api/tasks` fast-path handler (`~824-865`) into a standalone function, e.g. `dispatchTaskToAgent(db: Database.Database, conf: ConductorConf, agent: Agent, cmdText: string, detection: string, opts?: { clearFirst?: boolean }): void`.
- [ ] Update the `POST /api/tasks` handler to call it with `detection: 'immediate-enqueue'`.
- [ ] Confirm `npx tsc --noEmit` in `host-server/` is still clean after the refactor before adding new behavior.

### 2. Add the usage-limit marker to monitor.sh  <!-- agent: general-purpose -->

- [ ] In `scripts/monitor.sh`, inside `check_usage()`'s caller (the per-agent loop, `~410-456`) or right after the aggregate `all_usage_hit` is finalized for the tick, write `${STATE_DIR}/usage-limited` (empty file, `touch`) when usage is hit and remove it (`rm -f`) when usage recovers. Keep this fleet-wide (matches the existing `all_usage_hit`/teardown semantics) rather than per-agent, to keep the check on the host-server side a single cheap `existsSync`.
- [ ] Add a one-line comment at the write/remove sites and at `all_usage_hit`'s declaration explaining the marker's purpose and that TASK-120 added it.

### 3. Add the idle-transition dispatch trigger to pollAndDiff  <!-- agent: general-purpose -->

- [ ] In `pollAndDiff()` (`host-server/index.ts:~2209-2263`), inside the existing per-agent diff loop, after the existing `if (prev && prev.state !== agent.state)` status-transition bookkeeping block, add: when `prev.state !== 'idle' && agent.state === 'idle' && agent.queuedTasks > 0 && !existsSync(path.join(conf.stateDir, 'usage-limited'))`, call `popTask(db, agent.name)`; if it returns a row, call the shared `dispatchTaskToAgent(...)` from Step 1 with `detection: 'idle-transition-poll'` and `clearFirst: task.kind === 'project'`.
- [ ] Guard against a missing/`no-window` agent (skip dispatch if `!agent.windowPresent`).
- [ ] `npx tsc --noEmit` in `host-server/` — zero errors.

### 4. Typecheck and smoke-check both paths  <!-- agent: general-purpose -->

- [ ] With `make dev` running, queue a task for an idle agent via `POST /api/tasks` and confirm it still dispatches immediately (existing fast path, now going through the shared function) — status 200, `dispatched: true`.
- [ ] Queue a task for a **busy** agent, then let it go idle naturally (or flip its state file to `idle` manually); confirm the task dispatches within one status-poll tick (`STATUS_POLL_MS`, default 2000ms in `conductor.conf`) without waiting for `monitor.sh`'s next 15s tick — check `dispatch.jsonl` for a `detection: "idle-transition-poll"` record with a `ts` within ~2-3s of the state file flipping to `idle`.
- [ ] Confirm a checkpoint row was recorded for that dispatch (`GET /api/agents/:id/checkpoints`) when the agent has a `worktree_path`.
- [ ] Leave `monitor.sh`'s own dispatch block (`scripts/monitor.sh:436-451`) untouched for now — TASK-121 removes it after verifying no double-dispatch occurs with both paths active.

## Acceptance Criteria

- [ ] `pollAndDiff`'s idle-transition detection triggers task pop + dispatch for an agent with queued tasks within one `STATUS_POLL_MS` tick of going idle.
- [ ] The new dispatch path calls `stashCheckpoint`/`insertCheckpoint` (or the shared function wrapping them) before every dispatch to a git-worktree agent — TASK-068's checkpoint feature is preserved, not silently dropped.
- [ ] An agent whose usage is limited (fleet-wide `usage-limited` marker present) is not dispatched by the new path even if it goes idle with queued tasks.
- [ ] The existing `POST /api/tasks` fast-path behavior is unchanged (still 200 + immediate dispatch for idle-agent-with-empty-queue).
- [ ] `monitor.sh`'s existing dispatch block is untouched by this task (TASK-121's scope).
- [ ] `npx tsc --noEmit` passes in `host-server/`; `bash -n scripts/monitor.sh` is clean.

## Dependencies

- **Coordinate with [TASK-068](TASK-068-pre-dispatch-checkpoint.md)** — do not regress its `checkpoint_agent`/`stashCheckpoint` pre-dispatch checkpoint; see the CRITICAL constraint above.
- **BLOCKS [TASK-121](TASK-121-remove-redundant-monitor-dispatch.md)** — TASK-121 removes `monitor.sh`'s now-redundant dispatch block once this task's new path is confirmed safe, and hardens the double-dispatch race.
- **Hot file**: `host-server/index.ts` is large and frequently edited by concurrent tasks in this repo. Re-read the target function immediately before editing; use Serena symbol-level edits, not whole-file rewrites.

### Roadmap

Implements ROADMAP-017 Phase 1, item "Collapse `monitor.sh`'s 15s `POLL_INTERVAL` dispatch loop into the host-server's existing 2s status-poll loop, triggering dispatch on the idle transition instead of running a second independent poll" — `wiki/work/roadmaps/ROADMAP-017-competitive-audit-followups.md`.
