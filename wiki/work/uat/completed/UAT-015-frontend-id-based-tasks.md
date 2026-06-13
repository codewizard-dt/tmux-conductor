---
id: UAT-015
title: "UAT: Frontend ID-based tasks — lib/api helpers, TaskList per-row delete + jump-to-head, AddTaskForm/AgentList wiring"
status: passed
task: TASK-015
created: 2026-06-12
updated: 2026-06-12
---

# UAT-015 — UAT: Frontend ID-based tasks — lib/api helpers, TaskList per-row delete + jump-to-head, AddTaskForm/AgentList wiring

implements::[[TASK-015]]

> **Source task**: [`wiki/work/tasks/TASK-015-frontend-id-based-tasks.md`](../tasks/TASK-015-frontend-id-based-tasks.md)
> **Generated**: 2026-06-12

This task is a pure frontend React/TypeScript migration: the dashboard task UI moved from a legacy index-based `string[]` queue contract to an ID-based `Task[]` contract backed by the DB `/api/tasks` routes. The auto-runnable backbone is a strict `make typecheck` gate plus static-content assertions that the new types/helpers/controls exist exactly as specified. Live UI behaviors (delete removes the row, ↑ head moves to front, drag reorder persists) are captured as human/Playwright-verification tests because `/uat-auto` will not drive a browser.

All static-content tests below run from the **repo root** (`/Users/davidtaylor/Repositories/tmux-conductor`). They assert against the implementation files only; they do not require any server to be running.

---

## Prerequisites

- [ ] Repo root is the working directory: `/Users/davidtaylor/Repositories/tmux-conductor`
- [ ] Node.js >= 18 and frontend deps installed (`frontend/node_modules` present; run `cd frontend && npm install` if missing)
- [ ] For UI tests only: backend running on `http://localhost:8788` and frontend dev server on `http://localhost:4321` (e.g. `make dev`), with at least one agent defined in `conductor.conf` so a queue is rendered

---

## Test Cases

### UAT-STATIC-001: Frontend typecheck passes clean
- **Description**: The `string[] → Task[]` migration must leave the frontend type-clean. This is the primary automated gate for the task.
- **Steps**:
  1. From the repo root, run the command below.
  2. Confirm it exits 0 with no TypeScript errors.
- **Command**:
  ```bash
  make typecheck-frontend
  ```
- **Expected Result**: Exit code 0; `tsc --noEmit` in `frontend/` reports zero errors. (The combined `make typecheck` also runs the backend; this test isolates the frontend, which is what TASK-015 changed.)
- [x] Pass

### UAT-STATIC-002: Full typecheck (backend + frontend) passes clean
- **Description**: Confirms the change does not break the combined gate the task recorded as passing.
- **Steps**:
  1. From the repo root, run the command below.
  2. Confirm it exits 0.
- **Command**:
  ```bash
  make typecheck
  ```
- **Expected Result**: Exit code 0; both `backend` and `frontend` `tsc --noEmit` pass with zero errors.
- [x] Pass

### UAT-STATIC-003: `Task` interface exists in lib/api.ts with the exact DB-mirrored shape
- **Description**: `lib/api.ts` must export a `Task` interface mirroring `backend/db.ts` (`id, command, agentId, projectId, position, status, source, scheduleId, createdAt`).
- **Steps**:
  1. From the repo root, run the command below.
  2. Confirm every field name is present in the `Task` interface block.
- **Command**:
  ```bash
  grep -E "id|command|agentId|projectId|position|status|source|scheduleId|createdAt" frontend/src/lib/api.ts | grep -v "//"
  ```
- **Expected Result**: All nine field names appear (the interface declares `id`, `command`, `agentId`, `projectId`, `position`, `status: 'queued' | 'backlog'`, `source: 'manual' | 'schedule'`, `scheduleId`, `createdAt`). The `export interface Task {` line is present.
- [x] Pass

### UAT-STATIC-004: All four ID-based helpers are exported from lib/api.ts
- **Description**: `addTask`, `deleteTask`, `reorderTasks`, and `jumpTaskToHead` must all be exported async functions.
- **Steps**:
  1. From the repo root, run the command below.
  2. Confirm exactly four exported helper signatures are listed.
- **Command**:
  ```bash
  grep -nE "export async function (addTask|deleteTask|reorderTasks|jumpTaskToHead)" frontend/src/lib/api.ts
  ```
- **Expected Result**: Four matching lines — `addTask`, `deleteTask`, `reorderTasks`, `jumpTaskToHead`.
- [x] Pass

### UAT-STATIC-005: Helpers target the correct ID-based routes and HTTP methods
- **Description**: The helpers must hit the new `/api/tasks` routes, not the legacy `/queue/:agent/:index` paths. Verify each helper's method + path against the backend contract: `POST ${API_BASE}/tasks`, `DELETE ${API_BASE}/tasks/${id}`, `PUT ${API_BASE}/tasks/reorder`, `POST ${API_BASE}/tasks/${id}/jump-head`.
- **Steps**:
  1. From the repo root, run the command below.
  2. Confirm all four route templates appear.
- **Command**:
  ```bash
  grep -nE "API_BASE\}/tasks(/reorder|/\\\$\{id[^}]*\}(/jump-head)?)?" frontend/src/lib/api.ts
  ```
- **Expected Result**: Matches for `${API_BASE}/tasks` (POST in `addTask`), `${API_BASE}/tasks/${id.toString()}` (DELETE in `deleteTask`), `${API_BASE}/tasks/reorder` (PUT in `reorderTasks`), and `${API_BASE}/tasks/${id.toString()}/jump-head` (POST in `jumpTaskToHead`).
- [x] Pass

### UAT-STATIC-006: `addTask` distinguishes the 200 dispatched fast-path from the 201 Task response
- **Description**: Per the backend contract, `POST /tasks` returns `200 { dispatched: true }` on the idle-agent fast-path and `201 { ...Task }` otherwise. `addTask` must branch on status 200 to return `{ task: null, dispatched: true }` and otherwise parse the body as `Task`.
- **Steps**:
  1. From the repo root, run the command below.
  2. Confirm the 200 branch and the `dispatched` flag handling exist.
- **Command**:
  ```bash
  grep -nE "res.status === 200|dispatched: true|dispatched: false" frontend/src/lib/api.ts
  ```
- **Expected Result**: A `if (res.status === 200)` branch returning `{ task: null, dispatched: true }`, and a default return of `{ task, dispatched: false }`.
- [x] Pass

### UAT-STATIC-007: Legacy index-based task helpers are gone from lib/api.ts
- **Description**: The migration must remove (not retain) any legacy index-based task mutation paths from `api.ts`. There must be no `/queue/` references in the helpers file.
- **Steps**:
  1. From the repo root, run the command below.
  2. Confirm there is no output (no matches).
- **Command**:
  ```bash
  grep -nE "/queue/" frontend/src/lib/api.ts
  ```
- **Expected Result**: No output (exit code 1 from grep). The task-mutation helpers in `api.ts` use only ID-based `/tasks` routes.
- [x] Pass

### UAT-STATIC-008: TaskList renders `Task[]` keyed by `task.id` (not array index)
- **Description**: `TaskList.tsx` must type `tasks` as `Task[]`, key rows by `task.id`, and build the dnd id list and `SortableContext` from `String(task.id)`.
- **Steps**:
  1. From the repo root, run the command below.
  2. Confirm the `Task[]` prop type and `task.id` keying are present.
- **Command**:
  ```bash
  grep -nE "tasks: Task\[\]|key=\{task.id\}|String\(task.id\)|tasks.map\(\(task\)" frontend/src/components/TaskList.tsx
  ```
- **Expected Result**: Matches for `tasks: Task[]` (in `TaskListProps`), `key={task.id}`, `String(task.id)` (the `ids` array and `SortableContext`), and `tasks.map((task)` rendering. No reliance on array index as a key.
- [x] Pass

### UAT-STATIC-009: TaskList exposes a per-row delete control wired to `deleteTask(task.id)`
- **Description**: Each row must have a delete (`×`) control with an accessible label, and `handleDelete` must call `deleteTask(task.id)` with optimistic-filter-by-id and rollback.
- **Steps**:
  1. From the repo root, run the command below.
  2. Confirm the delete button, its `aria-label`, and the `deleteTask(task.id)` call all exist.
- **Command**:
  ```bash
  grep -nE "deleteTask\(task.id\)|aria-label=\{`Remove task|filter\(\(t\) => t.id !== task.id\)" frontend/src/components/TaskList.tsx
  ```
- **Expected Result**: A `deleteTask(task.id)` call inside `handleDelete`, an `aria-label={`Remove task: ${text}`}` on the `×` button, and an optimistic `tasks.filter((t) => t.id !== task.id)` update.
- [x] Pass

### UAT-STATIC-010: TaskList exposes a jump-to-head control wired to `jumpTaskToHead(task.id)`
- **Description**: Each row must have a `↑ head` control with an accessible label ("Move to front of queue"), calling the dedicated `jumpTaskToHead` route (not `addTask` with `placement:'head'`), with optimistic move-to-front and rollback.
- **Steps**:
  1. From the repo root, run the command below.
  2. Confirm the jump button text, label, and `jumpTaskToHead(task.id)` call exist.
- **Command**:
  ```bash
  grep -nE "jumpTaskToHead\(task.id\)|Move to front of queue|↑ head|\[task, ...tasks.filter" frontend/src/components/TaskList.tsx
  ```
- **Expected Result**: A `jumpTaskToHead(task.id)` call inside `handleJumpHead`, the `↑ head` button label, the `title`/`aria-label` containing "Move to front of queue", and the optimistic `[task, ...tasks.filter((t) => t.id !== task.id)]` reordering.
- [x] Pass

### UAT-STATIC-011: TaskList drag-reorder sends the task-id array (not positional indices)
- **Description**: `handleDragEnd` must call `reorderTasks` with `newTasks.map((t) => t.id)` — the actual task ids in the new order — matching the backend `{ ids: number[] }` contract.
- **Steps**:
  1. From the repo root, run the command below.
  2. Confirm the reorder call maps to `t.id`.
- **Command**:
  ```bash
  grep -nE "reorderTasks\(newTasks.map\(\(t\) => t.id\)\)" frontend/src/components/TaskList.tsx
  ```
- **Expected Result**: One match: `await reorderTasks(newTasks.map((t) => t.id));`.
- [x] Pass

### UAT-STATIC-012: TaskList preserves empty-state and error banner
- **Description**: The migration must keep the "No tasks in queue." empty state and the error banner for failed mutations.
- **Steps**:
  1. From the repo root, run the command below.
  2. Confirm both UI affordances are present.
- **Command**:
  ```bash
  grep -nE "No tasks in queue\.|setError\(`(Reorder|Delete|Move to front) failed" frontend/src/components/TaskList.tsx
  ```
- **Expected Result**: The `No tasks in queue.` empty-state string and at least the three failure-message `setError(...)` calls (reorder, delete, move-to-front) are present.
- [x] Pass

### UAT-STATIC-013: AddTaskForm posts via `addTask` and surfaces the returned `Task`
- **Description**: `AddTaskForm.tsx` must call `addTask(trimmed, { agentName })`, type `onAdded` as `(task: Task) => void`, keep the "Started immediately" flash on the dispatched fast-path (without calling `onAdded`), and call `onAdded(result.task)` only on the non-dispatched path.
- **Steps**:
  1. From the repo root, run the command below.
  2. Confirm the helper call, `onAdded(Task)` typing, and the dispatched/non-dispatched branch are all present.
- **Command**:
  ```bash
  grep -nE "addTask\(trimmed, \{ agentName \}\)|onAdded: \(task: Task\)|result.dispatched|onAdded\(result.task\)|Started immediately" frontend/src/components/AddTaskForm.tsx
  ```
- **Expected Result**: Matches for the `addTask(trimmed, { agentName })` call, the `onAdded: (task: Task) => void` prop type, the `if (result.dispatched)` branch with the "Started immediately" flash, and `onAdded(result.task)` on the non-dispatched path.
- [x] Pass

### UAT-STATIC-014: AgentList wires `Task[]` state and the `onAdded` Task push at BOTH render paths
- **Description**: `AgentList.tsx` has two render paths (accordion and detail). Both must declare `tasks` as `useState<Task[]>([])`, render `<TaskList ... onReorder={setTasks} />`, and push the returned `Task` in `onAdded`. The interface field `tasks: Task[]` must also be present.
- **Steps**:
  1. From the repo root, run the command below.
  2. Confirm there are **two** `useState<Task[]>` declarations and **two** `<AddTaskForm ... onAdded={(task) => { setTasks((prev) => [...prev, task]) }} />` wirings.
- **Command**:
  ```bash
  grep -cE "useState<Task\[\]>\(\[\]\)" frontend/src/components/AgentList.tsx
  ```
- **Expected Result**: Output is `2` (one per render path). A follow-up `grep -nE "onAdded=\{\(task\) => \{ setTasks\(\(prev\) => \[...prev, task\]\)" frontend/src/components/AgentList.tsx` should also show two matches and `grep -n "tasks: Task\[\]" frontend/src/components/AgentList.tsx` should show the interface field.
- [x] Pass

### UAT-STATIC-015: No legacy `tasks: string[]` task contract remains in the frontend
- **Description**: Sanity check that the old index-based `string[]` task contract is fully removed from the task UI components.
- **Steps**:
  1. From the repo root, run the command below.
  2. Confirm there is no output.
- **Command**:
  ```bash
  grep -rnE "tasks: string\[\]|onAdded: \(task: string\)" frontend/src/components
  ```
- **Expected Result**: No output (exit code 1). No component still types tasks as `string[]` or `onAdded` as a string callback.
- [x] Pass

---

### UAT-UI-001: Per-row delete removes the task from the queue (HUMAN/PLAYWRIGHT VERIFICATION)
> **Requires a human or Playwright run — `/uat-auto` will NOT execute this test.** Needs backend :8788 + frontend :4321 running with a real agent and at least one queued task.
- **Page**: `http://localhost:4321`
- **Description**: Clicking a row's `×` (Remove task) button calls `DELETE /api/tasks/:id`, optimistically removes the row, and the backend broadcasts `task-removed` so the row stays gone after the SSE snapshot reconciles.
- **Steps**:
  1. Ensure the target agent has at least two queued tasks (add via the "New task…" form if needed — pick an agent that is **busy** so the task queues rather than immediately dispatching).
  2. Expand the agent in the dashboard so the task list is visible.
  3. Click the `×` button on one row.
  4. Observe the row disappear; wait ~2s and confirm it does not reappear after the SSE snapshot.
- **Expected Result**: The clicked task row is removed from the list and stays removed; remaining tasks are unaffected. No error banner appears.
- [ ] Pass [FAIL: auto-judge: UI test requires human verification]

### UAT-UI-002: ↑ head button moves the task to the front of the queue (HUMAN/PLAYWRIGHT VERIFICATION)
> **Requires a human or Playwright run — `/uat-auto` will NOT execute this test.**
- **Page**: `http://localhost:4321`
- **Description**: Clicking a row's `↑ head` (Move to front of queue) button calls `POST /api/tasks/:id/jump-head`, optimistically moves the task to the top of the local list, and the backend persists the new head position (`task-moved` broadcast).
- **Steps**:
  1. Ensure the target (busy) agent has at least three queued tasks in a known order.
  2. Click the `↑ head` button on the **last** task in the list.
  3. Observe it jump to the top.
  4. Reload the page (or wait for the next SSE snapshot) and confirm the moved task is still first.
- **Expected Result**: The selected task moves to position 0 immediately and remains first after reload/snapshot — confirming the position was persisted server-side. No error banner appears.
- [ ] Pass [FAIL: auto-judge: UI test requires human verification]

### UAT-UI-003: Drag reorder persists across reload (HUMAN/PLAYWRIGHT VERIFICATION)
> **Requires a human or Playwright run — `/uat-auto` will NOT execute this test.**
- **Page**: `http://localhost:4321`
- **Description**: Dragging a task row to a new position calls `PUT /api/tasks/reorder` with the full `{ ids: number[] }` array in the new order; the backend reassigns positions so the order survives a reload.
- **Steps**:
  1. Ensure the target (busy) agent has at least three queued tasks.
  2. Grab a row by its `⠿` drag handle and drop it into a different position.
  3. Observe the list reflect the new order.
  4. Reload the page (or wait for the next SSE snapshot) and confirm the order is unchanged.
- **Expected Result**: The new drag order is applied immediately and persists after reload. If the request fails, the list rolls back to the original order and a "Reorder failed" banner appears.
- [ ] Pass [FAIL: auto-judge: UI test requires human verification]

### UAT-UI-004: Add task to a busy agent appends a row; add to an idle agent dispatches immediately (HUMAN/PLAYWRIGHT VERIFICATION)
> **Requires a human or Playwright run — `/uat-auto` will NOT execute this test.**
- **Page**: `http://localhost:4321`
- **Description**: Submitting the "New task…" form calls `POST /api/tasks`. For a busy agent (or one with a non-empty queue), the backend returns `201` with the `Task` and `AddTaskForm` calls `onAdded`, appending a new row. For an idle agent with an empty queue, the backend returns `200 { dispatched: true }`, the form shows the "Started immediately" flash for ~2s, and **no** row is appended.
- **Steps**:
  1. Pick a **busy** agent with at least one queued task; type a command into "New task…" and submit. Confirm a new row appears at the tail of that agent's list.
  2. Pick an **idle** agent with an empty queue; type a command and submit. Confirm the green "Started immediately" message appears for ~2s and no new queued row is added.
- **Expected Result**: Busy/non-empty path appends a `Task` row; idle/empty path shows "Started immediately" and adds no row. Empty/whitespace input is rejected (Add button disabled, no request sent).
- [ ] Pass [FAIL: auto-judge: UI test requires human verification]

---

## Notes

- **Auto-runnable backbone (15 tests):** UAT-STATIC-001 … UAT-STATIC-015 are self-contained, require no running server, and form the gate `/uat-auto` can judge.
- **Human/Playwright verification (4 tests):** UAT-UI-001 … UAT-UI-004 require the live dashboard (backend :8788 + frontend :4321) and a real agent; they are explicitly marked because `/uat-auto` does not drive a browser.
- The `grep` exit-code convention: tests that assert "no output" (UAT-STATIC-007, UAT-STATIC-015) pass when grep finds nothing (exit 1 = no match = clean).
