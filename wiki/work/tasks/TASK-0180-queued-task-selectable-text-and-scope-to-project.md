---
id: TASK-0180
aliases: [TASK-0180]
title: "Make queued-task text selectable and add a per-task 'scope to project' button"
status: pending-uat
created: 2026-09-19
updated: 2026-09-19
depends_on: []
blocks: []
parallel_safe_with: [TASK-0179]
uat: "[[UAT-0180]]"
tags: [frontend, host-server, task-queue]
---

# TASK-0180 — Make queued-task text selectable and add a per-task 'scope to project' button

## Objective

Two changes to the Queued Tasks list in the agent detail view. (1) The command text of each queued task can't be selected because `TaskList.tsx`'s `SortableItem` `<li>` carries `select-none`; make the text selectable/copyable. (2) Each **agent-scoped** queued task gets a button that re-scopes it to the agent's project, so any agent in that project can pick it up instead of only the one it was queued for.

## Approach

**Selectable text.** Drop `select-none` from the `<li>` (`frontend/src/components/TaskList.tsx:34`) and add `select-text` to the command `<span>` (L43). Dragging is unaffected: `@dnd-kit`'s `listeners`/`attributes` are spread only on the `⠿` handle span (L37-42), and the `PointerSensor` has a 5px activation distance, so selecting text in the command span never starts a drag. The buttons keep their own cursor/hit areas.

**Scope switch — server-derived, no client-supplied project.** New `POST /tasks/:id/scope-project` (same style as the existing `POST /tasks/:id/jump-head`). The server loads the task, resolves the task's agent, and rewrites the row to `project_id = agent.project_id, agent_id = NULL`. This satisfies the schema's `CHECK (agent_id IS NULL OR project_id IS NULL)` (`host-server/db.ts:436`) — the two columns must be swapped in one `UPDATE`, never set independently. `position` is left untouched so the task keeps its place in the queue. Once `agent_id` is NULL and `project_id` is set, `listTasksForAgentId` and `popTask` already route it to every agent in the project (scoped rows first, then project rows, then global) — no dispatch-side change needed.

Error contract: `404` unknown task; `409` if the task is not `queued`, is not agent-scoped (already project/global), or its agent has no `project_id`. Success broadcasts SSE `task-moved`-style event (see Step 2) and returns `{ ok: true, task }`.

**Frontend.** `scopeTaskToProject(id)` in `frontend/src/lib/api.ts` (mirrors `jumpTaskToHead`). `TaskList` gains an optional `projectId?: number | null` prop, passed by `AgentList.tsx` (it already has `projectId` in scope for `AddTaskForm`, ~L960). `SortableItem` renders a `→ project` button only when the row is agent-scoped **and** `projectId != null` (hidden, not disabled, for agents with no project). Optimistic update + rollback on error, identical to `handleDelete`/`handleJumpHead`: replace the task in `allTasks` with `{ ...task, agentId: null, projectId }`; `ScopedTaskGroup`'s existing `isProject` split moves it into the project group automatically.

**Out of scope:** the reverse (project → agent) action; moving `backlog`/`done` tasks; `ProjectDetailPage` (it passes `agentName=""` and only ever shows project tasks, so no button renders there).

## Steps

### 1. DB helper + unit test  <!-- agent: general-purpose -->

- [x] Add `moveTaskToProject(db, id): { ok: true; task: Task } | { ok: false; reason: 'not-found' | 'not-queued' | 'not-agent-scoped' | 'agent-has-no-project' }` to `host-server/db.ts`, in the `// ─── Task queue ───` section next to `jumpTaskToHead` (~L841). Implementation notes:
  - `SELECT * FROM tasks WHERE id = ?` → map via `mapTask`; return `not-found` / `not-queued` (status ≠ `'queued'`) / `not-agent-scoped` (`agentId === null`).
  - `SELECT project_id FROM agents WHERE id = ?`; if `NULL` return `agent-has-no-project`.
  - Single statement: `UPDATE tasks SET project_id = ?, agent_id = NULL WHERE id = ? RETURNING *` (one statement so the CHECK constraint is never violated mid-way), map result via `mapTask`.
- [x] Add tests to `host-server/db.test.ts` (node:test, `openDb(':memory:')`, follow the TASK-126 test's `createAgent`/`createProject`/`addTask` fixture style). Cases: (a) agent in a project → task becomes `projectId = project.id`, `agentId = null`, same `position`; (b) `listTasksForAgentId` for a **second** agent in the same project now includes it, and `popTask(db, secondAgentName)` returns it with `kind: 'project'`; (c) agent with no project → `agent-has-no-project`, row unchanged; (d) already project-scoped → `not-agent-scoped`; (e) `status='done'` → `not-queued`; (f) unknown id → `not-found`.

<!-- Updated: 2026-09-19 -->
<!-- moveTaskToProject added to host-server/db.ts right after jumpTaskToHead (~L840-859, before popTask); a deleted-agent row (no matching agents row at all) is also treated as agent-has-no-project — not spelled out in the spec but consistent with its intent. 5 new test blocks added to host-server/db.test.ts covering all 6 spec cases (a-f); node --import tsx/esm --test db.test.ts: 14/14 pass (9 pre-existing + 5 new). tsc --noEmit clean (one destructuring-possibly-undefined error fixed along the way by switching to .find() + optional chaining). No dev server/runtime checks run, per this step's deferral to Step 6/UAT. -->

### 2. Route  <!-- agent: general-purpose -->

- [x] In `host-server/index.ts`, add `api.post<{ Params: { id: string } }>('/tasks/:id/scope-project', ...)` right after the `/tasks/:id/jump-head` route (~L1000). Parse id (`400`-style invalid handling matching the neighbouring routes — they return `404 { error: 'invalid task id' }`; match that), call `moveTaskToProject`, map `not-found → 404`, everything else → `409` with a human-readable `error`. On success `broadcastSSE('task-moved', { id })` (reuse the existing event — `AgentList.tsx:2076` already registers a no-op handler for it, so no new SSE wiring is needed) and reply `{ ok: true, task }`.
- [x] Import `moveTaskToProject` alongside the other `db.ts` imports at the top of `index.ts` (find the `jumpTaskToHead` import).
- [x] Add a route-level test if a `/tasks` route test harness exists under `host-server/*.test.ts` (none found for the neighbouring routes at planning time — if there is no harness, the Step 1 db tests are the coverage; do not build a new Fastify harness for this task).

<!-- Updated: 2026-09-19 -->
<!-- Route added at host-server/index.ts:1002-1020, right after jump-head (L992-1000). not-found -> 404 {error:'task not found'}; not-queued/not-agent-scoped/agent-has-no-project -> 409 with per-reason message. broadcastSSE('task-moved', {id}) reused (AgentList.tsx:2073 already has a no-op handler registered). moveTaskToProject imported at index.ts:13. No /tasks/* route-test harness exists (confirmed via search) so none was built, per the checkbox's own instruction -- Step 1's db.test.ts is the coverage. tsc --noEmit clean. No dev server/curl touched. -->

### 3. Frontend API client  <!-- agent: general-purpose -->

- [x] Add `export async function scopeTaskToProject(id: number): Promise<void>` to `frontend/src/lib/api.ts` directly after `jumpTaskToHead` (~L192): `POST ${API_BASE}/tasks/${id.toString()}/scope-project` via `apiFetch`, same `!res.ok` → `throw new Error(body.error ?? \`HTTP ${status}\`)` pattern.

<!-- Updated: 2026-09-19 -->
<!-- scopeTaskToProject added to frontend/src/lib/api.ts, directly after jumpTaskToHead (now L195-203), body mirrors it exactly (same apiFetch/API_BASE usage, same error-handling shape). tsc --noEmit clean. -->

### 4. TaskList: selectable text + scope button  <!-- agent: general-purpose -->

- [x] `frontend/src/components/TaskList.tsx`:
  - Remove `select-none` from the `<li>` className (L34); add `select-text` to the command `<span>` (L43).
  - Import `scopeTaskToProject`.
  - `TaskListProps`: add `projectId?: number | null`. `TaskList` destructures it and passes it to both `ScopedTaskGroup` instances (new `projectId` prop there too).
  - `SortableItemProps`: add `onScopeProject?: () => void`. Render, between the `project` badge and the `↑ head` button, `{!isProject && onScopeProject && (<button type="button" onClick={onScopeProject} title="Make this a project task so any agent in the project can pick it up" aria-label={\`Scope to project: ${text}\`} className="…same classes as the ↑ head button…">→ project</button>)}`.
  - `ScopedTaskGroup.handleScopeProject(task)`: guard `projectId == null` (return); `onReorder(allTasks.map(t => t.id === task.id ? { ...t, agentId: null, projectId } : t))`; `await scopeTaskToProject(task.id)`; on error `onError(\`Scope to project failed: ${msg}\`)` + `onReorder(allTasks)`. Pass `onScopeProject` to `SortableItem` only when `projectId != null && task.projectId == null`.
- [x] `frontend/src/components/AgentList.tsx` (~L959): `<TaskList agentName={agent.name} tasks={tasks} onReorder={setTasks} projectId={projectId} />` — a one-token edit; do **not** touch anything else in that file (TASK-0179 is editing other regions concurrently).

<!-- Updated: 2026-09-19 -->
<!-- TaskList.tsx: select-none removed from <li>, select-text added to command span. scopeTaskToProject imported. SortableItemProps/TaskListProps/ScopedTaskGroup's inline props type all use `| undefined` explicit optionals (exactOptionalPropertyTypes:true requires it). New "→ project" button classes copied verbatim from the ↑ head button. handleScopeProject implemented exactly per spec (optimistic update, rollback + onError on failure). AgentList.tsx: single-token projectId={projectId} prop added to the one <TaskList/> call site (~L961), nothing else touched, no conflicting concurrent edits observed there. tsc --noEmit clean. -->

### 5. Frontend tests  <!-- agent: general-purpose -->

- [x] Create `frontend/src/components/TaskList.test.tsx` (vitest + RTL, same harness/mocking style as `AgentList.test.tsx`; `vi.mock('../lib/api')` for `scopeTaskToProject`/`deleteTask`/`reorderTasks`/`jumpTaskToHead`). Cases: (a) the command text element does not have `select-none` in its ancestry / has `select-text` (assert on class names — jsdom doesn't compute `user-select`); (b) an agent-scoped task with `projectId={7}` renders the `→ project` button; (c) no button when the `projectId` prop is `null`/omitted; (d) no button on a task that is already project-scoped; (e) clicking calls `scopeTaskToProject(task.id)` and `onReorder` is called with the task's `agentId: null, projectId: 7`; (f) when `scopeTaskToProject` rejects, `onReorder` is called again with the original list and the `Scope to project failed:` message renders.
- [x] Extend the existing `'renders TaskList and AddTaskForm when the Queued Tasks tab is selected'` test in `AgentList.test.tsx` (~L2539) only if needed to keep it green — do not add new cases there.

<!-- Updated: 2026-09-19 -->
<!-- Created frontend/src/components/TaskList.test.tsx, 7/7 passing (cases a-f plus the render/no-button variants). AgentList.test.tsx needed no changes, 160/160 pass. Real bug found and fixed mid-step, scoped tightly: ScopedTaskGroup.handleScopeProject's catch block called onError(msg) then onReorder(allTasks); TaskList's onReorder wrapper does setError(null) before forwarding, so React 18 batched both setError calls in the same synchronous catch-block burst and the later (null) one always won -- the rollback error message never rendered. Fixed by swapping the call order (onReorder before onError) in handleScopeProject only; handleDelete/handleJumpHead/handleDragEnd (pre-existing, out of this task's scope) were left untouched despite sharing the same pattern. tsc --noEmit clean. -->

### 6. Verify  <!-- agent: general-purpose -->

- [x] `npm run typecheck` / lint for both `host-server` and `frontend` (use the repo's existing scripts — check `package.json`), run `host-server/db.test.ts` and `frontend/src/components/TaskList.test.tsx` + `AgentList.test.tsx`.
- [DEFERRED-TO-UAT] Manual check via `make dev`: in an agent's Queued Tasks tab, (1) drag-select part of a task's command text and copy it; (2) click `→ project` on an agent-scoped task → the row moves to the project group with the `project` badge; (3) confirm a second agent in the same project shows it in its queue (`GET /api/queue/:id`); (4) confirm an agent with no project shows no `→ project` button.

<!-- Updated: 2026-09-19 -->
<!-- host-server + frontend typecheck and lint both clean; db.test.ts 14/14, TaskList.test.tsx + AgentList.test.tsx 167/167. Found and fixed 5 host-server/db.test.ts lint errors (@typescript-eslint/no-unnecessary-condition / unnecessary optional chaining after assert.ok narrowing) in the TASK-0180 tests from step 1 -- scoped to that file only. Second checkbox is runtime/E2E (real dev server, real live agent queue); deferred to UAT per this project's tackle-vs-UAT convention, no dev server started, live host-server on :8788 untouched throughout this task. -->

## Notes

All 6 steps complete. Real bugs found and fixed mid-tackle, both tightly scoped to this task's own new code: (1) the rollback/error-ordering bug in `ScopedTaskGroup.handleScopeProject` (step 5), (2) 5 lint errors in the new `db.test.ts` cases (step 6). Neither touched pre-existing handlers/files beyond what TASK-0180 itself added.
