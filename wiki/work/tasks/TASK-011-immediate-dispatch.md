---
id: TASK-011
title: "Immediate dispatch for tasks enqueued to an idle agent with an empty queue"
status: in-progress
created: 2026-06-12
updated: 2026-06-12
depends_on: []
blocks: []
parallel_safe_with: [TASK-001, TASK-007, TASK-008, TASK-009, TASK-010]
uat: "../uat/UAT-011-immediate-dispatch.md"
tags: [backend, dispatch, frontend]
---

# TASK-011 — Immediate dispatch for tasks enqueued to an idle agent with an empty queue

## Objective

When a task is added for an agent that is currently `idle` and has no pending tasks, the backend dispatches it to the agent's tmux pane immediately instead of persisting it to the queue and waiting up to `POLL_INTERVAL` (15s default) for `monitor.sh`'s next poll tick. A brand-new task against an empty queue starts in under a second.

## Approach

**Backend fast-path on the task-add route.** Before persisting, the route checks `detectAgentStatus(conf, agent) === 'idle'` and that the agent has no pending tasks. If both hold, the task is **never persisted to the queue** — the backend marks the agent busy (state file, mirroring `monitor.sh`'s `mark_busy`), appends a `dispatch.jsonl` record (required: `getActiveTask` in `backend/state.ts` reads the last dispatch record to surface the active task in the dashboard), and sends the command using the same tmux plumbing as `POST /agents/:agent/keys` (`send-keys -l` for the literal text, `Enter` as a separate invocation — repo-wide convention). Because the task never lands in the queue, the monitor cannot double-dispatch it; the busy state-file write closes the remaining poll race the same way `mark_busy` does for monitor dispatches.

Rejected alternative: waking `monitor.sh` early via a signal/wake-file — adds IPC to the bash loop and still races the poll; the backend already has tested status-detection and send-keys plumbing.

**Migration state (TASK-006 landed):** the DB-backed `POST /api/tasks` route (backend/index.ts, `addTask(db, …)`) is the primary target; the legacy flat-file `POST /queue/:agent` route still coexists during the cutover. Apply the fast-path to the DB-backed route using `listTasksForAgent(db, agent)` as the pending-task check; if the legacy route is still wired to the dashboard at implementation time, apply the same guard there (pending-check via `getAgentLines`) so both entry points behave identically until the legacy route is deleted in Phase 5.

Edge case (documented, accepted): unscoped/global lines in the queue are not counted as "pending for this agent", so an immediate dispatch can jump ahead of a global task the monitor would have assigned to this agent on its next tick.

## Steps

### 1. Backend fast-path  <!-- agent: general-purpose -->

- [x] Add the fast-path to the DB-backed `api.post('/tasks')` route in `backend/index.ts` (before `addTask(db, …)`), using `listTasksForAgent(db, agent)` for the pending-task check; mirror the same guard in the legacy `api.post('/queue/:agent')` route (pending-check via `getAgentLines(readQueue(conf.taskQueue), agent)`) if it is still dashboard-wired at implementation time <!-- Completed: 2026-06-12 -->
- [x] Extract the literal-text send mechanism from `POST /agents/:agent/keys` into a shared helper (e.g. `sendTextToPane(sessionName, windowName, text)` in `backend/state.ts`): `tmux send-keys -t <session>:<window> -l <text>` then a separate `tmux send-keys … Enter` <!-- Completed: 2026-06-12 -->
- [x] In the add route, before persisting: read `conf`, compute the agent's pending tasks and `detectAgentStatus(conf, agent)`; fast-path condition = status `idle` AND zero pending tasks for the agent <!-- Completed: 2026-06-12 -->
- [x] Fast path: write `busy\n` to `${conf.stateDir}/${agent}.state` (mirror `monitor.sh` `mark_busy`, scripts/monitor.sh:353); append one JSONL record to `${conf.logDir}/dispatch.jsonl` matching the monitor's `emit_dispatch_jsonl` shape (`ts`, `agent`, `command`, `state`, `state_age_s`, `detection: "immediate-enqueue"`, `queue`, `queue_remaining: 0`, `pane_tail`) so `getActiveTask` and the dashboard pick it up; then send via the shared helper; respond `{ ok: true, dispatched: true }` and trigger the SSE snapshot refresh <!-- Completed: 2026-06-12 -->
- [x] Slow path: unchanged persist-and-respond behavior when the agent is busy/awaiting/stalled/exited or has pending tasks <!-- Completed: 2026-06-12 -->

### 2. Frontend response handling  <!-- agent: general-purpose -->

- [x] In `frontend/src/components/AddTaskForm.tsx` `handleSubmit`: parse the response body; when `dispatched: true`, skip `onAdded(trimmed)` (the task was never queued — it is already running) and show a brief "started immediately" success hint instead of silently clearing <!-- Completed: 2026-06-12 -->
- [x] Type the add-task response (`{ ok: boolean; line?: string; dispatched?: boolean }`) in `frontend/src/lib/api.ts` or locally in the form component, matching existing typing conventions <!-- Completed: 2026-06-12 -->

### 3. Verify  <!-- agent: general-purpose -->

- [DEFERRED-TO-UAT] With the conductor session and monitor running and an agent idle with an empty queue: add a task from the dashboard → command lands in the pane in <1s, state file flips to `busy`, `dispatch.jsonl` gains a `detection: "immediate-enqueue"` record, the queue store (tasks.txt or DB) is untouched, and the dashboard shows the task as active
- [DEFERRED-TO-UAT] Add a task while the agent is busy → appended to the queue exactly as before, dispatched by the monitor on idle
- [DEFERRED-TO-UAT] Add a task while the agent is idle but has pending scoped tasks → appended (no queue-jumping), monitor dispatches in order
- [DEFERRED-TO-UAT] Watch one full `POLL_INTERVAL` after an immediate dispatch → monitor logs "queue empty" for that agent (no double-dispatch)
