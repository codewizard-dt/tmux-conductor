---
id: TASK-008
title: "Add /api/schedules CRUD and the scheduler tick loop"
status: done
created: 2026-06-12
updated: 2026-06-12
depends_on: [TASK-003, TASK-004]
blocks: [TASK-014]
parallel_safe_with: [TASK-001, TASK-005, TASK-006, TASK-007]
uat: ""
tags: [backend, sqlite, routes, schedules, scheduler]
---

# TASK-008 — Add /api/schedules CRUD and the scheduler tick loop

## Objective

Implement the `/api/schedules` resource (full CRUD) and the backend scheduler tick loop that fires due schedules every 5 seconds. Each fired schedule appends or jumps a task into the queue (based on its `action` field), respects `skip_if_pending`, and broadcasts `schedule-fired` + `task-added` SSE events. Schedules can be scoped to an agent, a project, or global.

## Approach

The scheduler is a `setInterval` running in the backend process alongside the existing `pollAndDiff` loop. It calls `dueSchedules(db, now)` and `fireSchedule(db, schedule, now)` from `db.ts`. The tick interval is 5000ms. All schedule mutations are transactional in SQLite.

## Steps

### 1. Add GET/POST /api/schedules  <!-- agent: general-purpose -->

- [ ] Use Serena to locate the route registration area in `backend/index.ts`
- [ ] Add `GET /api/schedules`: `return listSchedules(db)`
- [ ] Add `POST /api/schedules`:
  - Body: `{name?, command, intervalSeconds, action?: 'append'|'jump', agentId?, projectId?, skipIfPending?}`
  - Validate: `intervalSeconds >= 5`; `agentId` and `projectId` cannot both be set
  - `createSchedule(db, data)`
  - Return `201` with the schedule row

### 2. Add PUT/DELETE /api/schedules/:id  <!-- agent: general-purpose -->

- [ ] Add `PUT /api/schedules/:id`:
  - Body: `Partial<Schedule>` — any updatable fields
  - `updateSchedule(db, id, data)`
  - Return `200`; 404 if not found
- [ ] Add `DELETE /api/schedules/:id`:
  - `deleteSchedule(db, id)` — FK CASCADE removes tasks sourced from this schedule
  - Return `204`

### 3. Add PATCH /api/schedules/:id/toggle (enable/disable)  <!-- agent: general-purpose -->

- [ ] Add `PATCH /api/schedules/:id/toggle`:
  - Flip `enabled` bit: `UPDATE schedules SET enabled = 1 - enabled WHERE id=?`
  - Return `200` with updated schedule row

### 4. Add scheduler tick loop  <!-- agent: general-purpose -->

- [ ] After `fastify.listen(...)` in `backend/index.ts`, add:
  ```ts
  setInterval(() => {
    const now = Math.floor(Date.now() / 1000);
    for (const s of dueSchedules(db, now)) {
      const task = fireSchedule(db, s, now);
      if (task) {
        broadcastSSE('schedule-fired', { scheduleId: s.id, name: s.name, command: s.command });
        broadcastSSE('task-added', task);
      }
    }
  }, 5000);
  ```
- [ ] Import `dueSchedules` and `fireSchedule` from `./db`
- [ ] Confirm `broadcastSSE` signature allows these new event types

### 5. Add schedule-fired to SSE event types  <!-- agent: general-purpose -->

- [ ] Add `schedule-fired` to the SSE event type union in `backend/index.ts` (if typed)
- [ ] Ensure the event payload type is defined: `{scheduleId: number, name: string|null, command: string}`

### 6. Static verification  <!-- agent: general-purpose -->

- [ ] Run `cd backend && npx tsc --noEmit` — no type errors
