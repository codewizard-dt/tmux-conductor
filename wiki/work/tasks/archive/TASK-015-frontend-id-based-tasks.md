---
id: TASK-015
title: "Update lib/api.ts types and TaskList/AddTaskForm to ID-based tasks with per-row delete and jump-to-head"
status: done
created: 2026-06-12
updated: 2026-06-12
depends_on: [TASK-006]
blocks: []
parallel_safe_with: [TASK-001, TASK-011, TASK-012]
uat: "../../uat/UAT-015-frontend-id-based-tasks.md"
tags: [frontend, react, api]
---

# TASK-015 — Update lib/api.ts types and TaskList/AddTaskForm to ID-based tasks with per-row delete and jump-to-head

## Objective

Migrate the dashboard task/queue UI from the legacy **index-based** queue endpoints to the new **ID-based** DB-backed `/api/tasks` routes that ROADMAP-001 added when the backend moved to SQLite.

Concretely:

1. Add a task `Task` TypeScript type plus fetch helpers to `frontend/src/lib/api.ts` covering the four ID-based routes: `POST /api/tasks`, `DELETE /api/tasks/:id`, `PUT /api/tasks/reorder`, and `POST /api/tasks/:id/jump-head`.
2. Rework `frontend/src/components/TaskList.tsx` to render `Task` objects (keyed by `task.id`, not array index) with a **per-row delete** (`DELETE /api/tasks/:id`) and a **jump-to-head** action (`POST /api/tasks/:id/jump-head`), keeping drag-reorder wired to `PUT /api/tasks/reorder` (sends `{ ids: number[] }`).
3. Rework `frontend/src/components/AddTaskForm.tsx` to `POST /api/tasks` with `{ command, agentName }` and surface the returned `Task` (or the `dispatched: true` fast-path) to its parent.

### Authoritative backend shapes (verified against backend/index.ts + backend/db.ts)

`Task` (from `mapTask` / the `Task` interface in `backend/db.ts`):

```ts
interface Task {
  id: number;
  command: string;
  agentId: number | null;
  projectId: number | null;
  position: number;
  status: 'queued' | 'backlog';
  source: 'manual' | 'schedule';
  scheduleId: number | null;
  createdAt: string;
}
```

Routes (all mounted under the `/api` prefix → `API_BASE` already ends in `/api`):

| Route | Body | Response | SSE event broadcast |
|-------|------|----------|---------------------|
| `POST /tasks` | `{ command: string; agentName?: string; projectId?: number; placement?: 'tail' \| 'head' }` | `201 { ...Task, dispatched: false }` normally; `200 { ok: true, dispatched: true }` on the idle-agent immediate-dispatch fast-path | `task-added` (the `Task`) — fast-path emits `snapshot` instead |
| `DELETE /tasks/:id` | — | `204` (no body) | `task-removed` `{ id }` |
| `PUT /tasks/reorder` | `{ ids: number[] }` (non-empty array of integers) | `{ ok: true }` | `queue-reordered` `{ ids }` |
| `POST /tasks/:id/jump-head` | — | `{ ok: true, id }` | `task-moved` `{ id }` |

DB position semantics (for understanding, no change needed): `addTask` places tail = `MAX(position)+1`, head = `MIN(position)-1`; `jumpTaskToHead` sets `position = MIN(position)-1` over `status='queued'` rows; `reorderTasks` reassigns the existing sorted position values to the supplied `ids` order. **Jump-to-head is its own route (`POST /tasks/:id/jump-head`), distinct from `POST /tasks` with `placement:'head'`** — use the dedicated route for the per-row action.

## Approach

Today `api.ts` has **no** task types or helpers at all — only `KeysPayload` / `sendAgentKeys` / `uploadAgentImage`. `TaskList.tsx` renders `tasks: string[]` keyed by **array index** and deletes/reorders via the legacy `/queue/:agent/:index` and `/queue/:agent/reorder` routes; `AddTaskForm.tsx` POSTs `{ task }` to `/queue/:agent` and reports a plain string upward. The parent `AgentList.tsx` holds `tasks` as `string[]` in component state and passes `onReorder={setTasks}` plus `onAdded` that pushes a string. This task flips that whole chain to `Task` objects keyed by `id`.

The legacy `/queue/:agent*` routes still exist in `backend/index.ts` — leave them untouched (other consumers / the monitor path may still reference them); this task only moves the **frontend task UI** onto the ID-based routes.

> **IMPORTANT — shared-file collision note.** `frontend/src/lib/api.ts` and the root layout component (`AgentList.tsx` and any shared layout) are **also edited by sibling ROADMAP-001 Phase 4 tasks** (projects, schedules, agent grouping). To avoid merge collisions in `lib/api.ts`, **confine all edits in this task to a single new "Tasks / queue" type+helper section** (the `Task` interface and the four task helpers). Do **not** touch the `API_BASE` constant, `KeysPayload`, `sendAgentKeys`, or `uploadAgentImage`, and do **not** add project/schedule/agent-grouping types — those belong to the sibling tasks. Append the task block; don't reorganize the file. Similarly, in `AgentList.tsx`, touch only the lines that wire `TaskList` / `AddTaskForm` and the `tasks` state (there are **two** render paths — accordion ~L405-410 and detail ~L661-665 — both must be updated consistently).

Live-edit caution: dev servers hot-reload (`vite` / `tsx watch`) and sibling agents may be editing `api.ts` / `AgentList.tsx` concurrently. Re-read each file immediately before editing and prefer Serena symbol-scoped edits / appends over wholesale rewrites.

SSE: live updates already flow over `GET /events`. Surfacing `task-added` / `task-removed` / `task-moved` / `queue-reordered` into the snapshot stream is the snapshot/SSE wiring concern of the parent component — this task only needs to optimistically update local state after each helper call (matching the existing optimistic pattern in `TaskList`/`AddTaskForm`); the SSE snapshot will reconcile.

## Steps

### 1. Add Task type + ID-based fetch helpers to lib/api.ts  <!-- agent: general-purpose --> <!-- Completed: 2026-06-12 -->

- [x] Use Serena `get_symbols_overview` on `frontend/src/lib/api.ts` to confirm current exports (`API_BASE`, `KeysPayload`, `sendAgentKeys`, `uploadAgentImage`) before editing.
- [x] **Append** a new "Tasks / queue" section (do not touch existing exports). Add the `Task` interface mirroring `backend/db.ts` exactly (`id, command, agentId, projectId, position, status, source, scheduleId, createdAt`).
- [x] Add helper `addTask(command: string, opts?: { agentName?: string; projectId?: number; placement?: 'tail' | 'head' }): Promise<{ task: Task | null; dispatched: boolean }>` — POST `${API_BASE}/tasks` with `{ command, ...opts }`. On `200 { dispatched: true }` return `{ task: null, dispatched: true }`; on `201` parse the body as `Task` and return `{ task, dispatched: false }`. Throw on non-OK using the existing `{ error?: string }` pattern.
- [x] Add helper `deleteTask(id: number): Promise<void>` — DELETE `${API_BASE}/tasks/${id}`; treat `204` as success; throw on non-OK.
- [x] Add helper `reorderTasks(ids: number[]): Promise<void>` — PUT `${API_BASE}/tasks/reorder` with `{ ids }`; throw on non-OK.
- [x] Add helper `jumpTaskToHead(id: number): Promise<void>` — POST `${API_BASE}/tasks/${id}/jump-head`; throw on non-OK.
- [x] Reuse the existing error-extraction idiom (`const body = await res.json().catch(() => ({})) as { error?: string }; throw new Error(body.error ?? \`HTTP ${res.status}\`)`).

### 2. Rework TaskList.tsx to ID-based Task rows + per-row delete + jump-to-head  <!-- agent: general-purpose --> <!-- Completed: 2026-06-12 -->

- [x] Read `frontend/src/components/TaskList.tsx`. Change `TaskListProps` from `tasks: string[]` to `tasks: Task[]` (import `Task` from `../lib/api`); change `onReorder` to operate on `Task[]`.
- [x] Key `SortableItem` and `SortableContext` by `String(task.id)` instead of the array index. Display `task.command` as the row text.
- [x] **Drag reorder:** in `handleDragEnd`, compute the new `Task[]` order via `arrayMove`, then call the `reorderTasks(ids)` helper with the **task id array** in the new order (not 0-based positional indices). Keep the optimistic update + rollback-on-error pattern.
- [x] **Per-row delete:** replace the index-based delete with `deleteTask(task.id)`; optimistically filter by `id`, roll back on error.
- [x] **Jump-to-head:** add a per-row action (e.g. a small "↑ head" button next to the delete `×`) that calls `jumpTaskToHead(task.id)`; optimistically move that task to the front of the local array, roll back on error. Add an accessible `aria-label` / `title` (e.g. "Move to front of queue").
- [x] Keep the empty-state ("No tasks in queue.") and the error banner.

### 3. Rework AddTaskForm.tsx to POST /api/tasks  <!-- agent: general-purpose --> <!-- Completed: 2026-06-12 -->

- [x] Read `frontend/src/components/AddTaskForm.tsx`. Change `onAdded` from `(task: string) => void` to `(task: Task) => void` (import `Task`).
- [x] Replace the `fetch('/queue/:agent', { task })` call with the `addTask(trimmed, { agentName })` helper from `lib/api.ts`.
- [x] On `{ dispatched: true }` keep the existing "Started immediately" flash (2s) and do **not** call `onAdded`. On `{ task, dispatched: false }` call `onAdded(task)` with the returned `Task`.
- [x] Preserve existing UX: trim/empty guard, submitting state, Enter-to-submit, error banner.

### 4. Update AgentList.tsx wiring (both render paths)  <!-- agent: general-purpose --> <!-- Completed: 2026-06-12 -->

- [x] Use Serena `search_for_pattern` to locate every `<TaskList` / `<AddTaskForm` usage and the `tasks` state in `frontend/src/components/AgentList.tsx` (there are two render paths, ~L405-410 and ~L661-665).
- [x] Change the `tasks` state type from `string[]` to `Task[]`. Update the initial value / wherever it is populated from the snapshot to carry `Task` objects (if the snapshot still provides strings, map/adapt at the boundary — keep this change minimal and local to the task wiring). _Note: backend `/queue/:agent` already returns `Task[]` (ROADMAP-001), so no boundary adaptation was needed — just the `QueueResponse.tasks` and two `useState` types._
- [x] `onReorder={setTasks}` stays (now `Task[]`). Update the `onAdded` callback to push the returned `Task` object: `onAdded={(task) => setTasks((prev) => [...prev, task])}`.
- [x] **Confine edits to the TaskList/AddTaskForm wiring + `tasks` state only** — do not touch sibling-owned project/schedule/grouping code in this file.

### 5. Typecheck verification (must be clean)  <!-- agent: general-purpose --> <!-- Completed: 2026-06-12 -->

- [x] From the repo root run `make typecheck` (if no such target exists, run the frontend check directly: `cd frontend && npx astro check` and `npx tsc --noEmit`, or the project's configured frontend typecheck script — inspect `frontend/package.json` `scripts` first via Serena/Read). _Ran `make typecheck` (= backend `tsc --noEmit` + frontend `tsc --noEmit`); passed clean, zero errors._
- [x] Resolve every type error introduced by the `string[] → Task[]` migration until the typecheck passes **clean** (zero errors). Record the exact command run and that it passed. _No errors to resolve — clean on first full run after step 4._
- [x] Sanity-check that no remaining frontend code references the old `tasks: string[]` task contract or the legacy `/queue/:agent/:index` / `/queue/:agent/reorder` paths for the task UI (Serena `search_for_pattern`). _Confirmed: no `tasks: string[]` residue; task-UI mutations are all ID-based (`deleteTask`/`reorderTasks`/`jumpTaskToHead`). Remaining `/queue/:agent` usages are the legitimate `Task[]`-returning read and an unrelated skill enqueue._
