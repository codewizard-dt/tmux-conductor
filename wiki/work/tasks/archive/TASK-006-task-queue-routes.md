---
id: TASK-006
title: "Replace index-based queue endpoints with ID-based /api/tasks routes and SSE events"
status: done
created: 2026-06-12
updated: 2026-06-12
depends_on: [TASK-003, TASK-004]
blocks: [TASK-011]
parallel_safe_with: [TASK-001, TASK-005]
uat: "../uat/UAT-006-task-queue-routes.md"
tags: [backend, sqlite, routes, tasks, sse]
---

# TASK-006 — Replace index-based queue endpoints with ID-based /api/tasks routes and SSE events

## Objective

Replace the index-based queue API (`GET|POST /queue/:agent`, `DELETE /queue/:agent/:index`, `PUT /queue/:agent/reorder`) with a stable-ID API (`POST /api/tasks`, `DELETE /api/tasks/:id`, `PUT /api/tasks/reorder`, `POST /api/tasks/:id/jump-head`) backed by the SQLite `tasks` table. Also update `GET /api/queue/:agent` to return task objects with `{id, command, scope, position}`. Broadcast `task-added` and `task-removed` SSE events on every mutation so the frontend queue updates in real time.

## Approach

The old queue was a flat text file with index-based operations that raced against `monitor.sh`. The new queue is transactional SQLite with stable IDs. The reorder endpoint now accepts `{ids: number[]}` instead of `{from: number, to: number}` — safe with the DnD list.

## Steps

### 1. Add /api/tasks POST (add task)  <!-- agent: general-purpose -->

- [ ] Use Serena to locate the existing `POST /queue/:agent` handler in `backend/index.ts`
- [ ] Add new route `POST /api/tasks`:
  - Body: `{command: string, agentName?: string, projectId?: number, placement?: 'tail'|'head'}`
  - Resolve `agentId` from `agentName` if provided
  - Call `addTask(db, {command, agentId, projectId, placement})`
  - Broadcast SSE: `broadcastSSE('task-added', task)`
  - Return `201` with the task row
- [ ] Keep old `POST /queue/:agent` for backwards compatibility during transition (or alias it)

### 2. Add /api/tasks/:id DELETE  <!-- agent: general-purpose -->

- [ ] Add `DELETE /api/tasks/:id`:
  - Parse `id` as integer; 404 if not found
  - `deleteTask(db, id)`
  - Broadcast SSE: `broadcastSSE('task-removed', {id})`
  - Return `204`

### 3. Add /api/tasks/reorder PUT  <!-- agent: general-purpose -->

- [ ] Add `PUT /api/tasks/reorder`:
  - Body: `{ids: number[]}` — ordered list of task IDs
  - `reorderTasks(db, ids)`
  - Broadcast SSE: `broadcastSSE('queue-reordered', {ids})`
  - Return `200`

### 4. Add /api/tasks/:id/jump-head POST  <!-- agent: general-purpose -->

- [ ] Add `POST /api/tasks/:id/jump-head`:
  - `jumpTaskToHead(db, id)`
  - Broadcast SSE: `broadcastSSE('task-moved', {id})`
  - Return `200` with updated task row

### 5. Update GET /api/queue/:agent  <!-- agent: general-purpose -->

- [ ] Update `GET /queue/:agent` (or alias `GET /api/queue/:agent`) to:
  - Call `listTasksForAgent(db, agentName)` instead of the old `readQueue`
  - Return array of `{id, command, scope: 'scoped'|'project'|'global', position}` objects

### 6. SSE event types  <!-- agent: general-purpose -->

- [ ] Add `task-added`, `task-removed`, `queue-reordered`, `task-moved` to the SSE event type union (if typed) in `backend/index.ts`
- [ ] Verify `broadcastSSE` signature accepts these new event names

### 7. Static verification  <!-- agent: general-purpose -->

- [ ] Run `cd backend && npx tsc --noEmit` — no type errors
- [ ] Confirm old queue routes still compile (kept for transition) or have been cleanly removed
