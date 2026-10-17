---
id: UAT-0180
aliases: [UAT-0180]
title: "UAT: Make queued-task text selectable and add a per-task 'scope to project' button"
status: pending
task: TASK-0180
created: 2026-09-19
updated: 2026-09-19
---

# UAT-0180 — UAT: Make queued-task text selectable and add a per-task 'scope to project' button

implements::[[TASK-0180]]

> **Source task**: [[TASK-0180]]
> **Generated**: 2026-09-19
> **Scope note**: generated with UI/manual-browser cases excluded per explicit user request. This file covers only automatable cases (unit-backed edge cases). The task's own Step 6 manual `make dev` walkthrough (drag-select/copy text, click `→ project`, confirm a second project agent sees the task, confirm no button for a project-less agent) is intentionally **not** reproduced here — it remains available via a human `/uat-walk` of the task file's own Step 6 note if ever wanted, but is out of scope for this UAT.

---

## Prerequisites

- [x] None — every case below runs against an in-memory (`:memory:`) SQLite DB or jsdom, with no live server, no real tmux window, and no mutation of this environment's real `data/conductor.db` or any real agent. Verified: neither Unit Test Command below references a live server or real DB path.

---

## Test Cases

### UAT-EDGE-001: `moveTaskToProject` re-scopes an agent-scoped queued task to its agent's project, keeps queue position, and the task becomes pickable by a second agent in the same project
- **Scenario**: The core behavior TASK-0180 adds — `host-server/db.ts::moveTaskToProject(db, id)` rewrites a queued, agent-scoped task's `agent_id`→`NULL`/`project_id`→the agent's project in one `UPDATE ... RETURNING *`, and the newly project-scoped row must then be visible to `listTasksForAgentId`/`popTask` for any other agent in the same project (not just the original agent).
- **Steps**: Covered directly by `host-server/db.test.ts`'s TASK-0180 test block — no live server required.
- **Expected Result**: `result.ok === true`; `result.task.projectId === project.id`; `result.task.agentId === null`; `result.task.position` unchanged from before the move. A second agent (`agentB`) in the same project sees the task via `listTasksForAgentId(db, agentB.id)`, and `popTask(db, agentB.name)` returns it with `kind: 'project'`.
- **Repeatable Unit Test**: Created: `host-server/db.test.ts` (TASK-0180 block, case a+b: happy path + sibling-agent pop)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test db.test.ts` — verified: 14/14 pass
- [x] Pass <!-- 2026-09-19 (auto): via unit test host-server/db.test.ts, 14/14 pass, "TASK-0180: moveTaskToProject rescopes an agent-scoped queued task to its agent's project, and the row is then poppable by a sibling agent" -->

### UAT-EDGE-002: An agent with no project cannot have its task scoped to a project
- **Scenario**: `moveTaskToProject` must refuse (not silently no-op or corrupt the row) when the task's agent has `project_id IS NULL`.
- **Steps**: Covered directly by `host-server/db.test.ts`'s TASK-0180 test block.
- **Expected Result**: `result.ok === false`, `result.reason === 'agent-has-no-project'`; the task row is unchanged (still agent-scoped, same `agent_id`).
- **Repeatable Unit Test**: Created: `host-server/db.test.ts` (TASK-0180 block, case c)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test db.test.ts` — verified: 14/14 pass
- [x] Pass <!-- 2026-09-19 (auto): via unit test host-server/db.test.ts, 14/14 pass, "TASK-0180: moveTaskToProject returns agent-has-no-project and leaves the row unchanged when the task's agent has no project" -->

### UAT-EDGE-003: A task that is already project-scoped (not agent-scoped) cannot be re-scoped again
- **Scenario**: `moveTaskToProject` must reject a task whose `agent_id` is already `NULL` — the operation only makes sense on an agent-scoped row.
- **Steps**: Covered directly by `host-server/db.test.ts`'s TASK-0180 test block.
- **Expected Result**: `result.ok === false`, `result.reason === 'not-agent-scoped'`.
- **Repeatable Unit Test**: Created: `host-server/db.test.ts` (TASK-0180 block, case d)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test db.test.ts` — verified: 14/14 pass
- [x] Pass <!-- 2026-09-19 (auto): via unit test host-server/db.test.ts, 14/14 pass, "TASK-0180: moveTaskToProject returns not-agent-scoped for a task already scoped to a project" -->

### UAT-EDGE-004: A non-`queued` task (e.g. already `done`) cannot be re-scoped
- **Scenario**: `moveTaskToProject` must reject a task whose `status` is not `'queued'`, preventing a completed/backlogged task from being silently rewritten.
- **Steps**: Covered directly by `host-server/db.test.ts`'s TASK-0180 test block.
- **Expected Result**: `result.ok === false`, `result.reason === 'not-queued'`.
- **Repeatable Unit Test**: Created: `host-server/db.test.ts` (TASK-0180 block, case e)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test db.test.ts` — verified: 14/14 pass
- [x] Pass <!-- 2026-09-19 (auto): via unit test host-server/db.test.ts, 14/14 pass, "TASK-0180: moveTaskToProject returns not-queued for a task that is already done" -->

### UAT-EDGE-005: An unknown task id returns `not-found`, not a crash or a silent no-op
- **Scenario**: `moveTaskToProject` must return a typed `not-found` result for a nonexistent id rather than throwing or returning an ambiguous falsy value.
- **Steps**: Covered directly by `host-server/db.test.ts`'s TASK-0180 test block.
- **Expected Result**: `result.ok === false`, `result.reason === 'not-found'`.
- **Repeatable Unit Test**: Created: `host-server/db.test.ts` (TASK-0180 block, case f)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test db.test.ts` — verified: 14/14 pass
- [x] Pass <!-- 2026-09-19 (auto): via unit test host-server/db.test.ts, 14/14 pass, "TASK-0180: moveTaskToProject returns not-found for an unknown task id" -->

### UAT-EDGE-006: `POST /tasks/:id/scope-project` maps each `moveTaskToProject` outcome to the correct HTTP status and error shape
- **Scenario**: The route (`host-server/index.ts:1002-1020`) must map `not-found` → `404 { error: 'task not found' }`, `not-queued`/`not-agent-scoped`/`agent-has-no-project` → `409` with the matching human-readable message, and success → `200 { ok: true, task }` plus an SSE `task-moved` broadcast.
- **Steps**: Would require a live Fastify request against this exact route.
- **Expected Result**: Status/body mapping exactly as coded (verified by direct source read during `/tackle`, not by an executed request).
- **Repeatable Unit Test**: Blocked: no Fastify route-level test harness exists anywhere in `host-server/*.test.ts` (confirmed twice via search during `/tackle`) — building one is out of this task's scope. Cannot be safely live-curl'd either: constructing a real fixture task would require creating a real agent via the live API, which spawns an actual tmux window/process in this shared, already-running conductor session — not an acceptable side effect for a generated test. `UAT-EDGE-001`–`005` above cover the exact same reason-to-outcome mapping one layer down (`moveTaskToProject`'s return value), which is the only part of this route with real branching logic; the route itself is thin, mechanical glue.
- [FAIL: auto-judge: manual test requires human verification — Blocked (no route-test harness; live curl would require spawning a real agent) is not unit-backed evidence] <!-- 2026-09-19 (auto) -->

### UAT-EDGE-007: Queued-task command text is selectable (no `select-none`, has `select-text`)
- **Scenario**: `TaskList.tsx`'s row `<li>` previously carried `select-none`, making the command text uncopyable. TASK-0180 removes it and adds `select-text` to the command `<span>` specifically.
- **Steps**: Covered directly by `frontend/src/components/TaskList.test.tsx` — renders a `SortableItem`/`TaskList` row and asserts on the rendered class lists (jsdom does not compute actual `user-select` CSS, so this is a class-name assertion, not a real text-selection simulation).
- **Expected Result**: The row's `<li>` class list does not contain `select-none`; the command `<span>` class list contains `select-text`.
- **Repeatable Unit Test**: Created: `frontend/src/components/TaskList.test.tsx` ("TaskList command text selectability" describe block)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/TaskList.test.tsx` — verified: 7/7 pass
- [x] Pass <!-- 2026-09-19 (auto): via unit test frontend/src/components/TaskList.test.tsx, 7/7 pass, "renders the command text as select-text, with no select-none ancestor" -->

### UAT-EDGE-008: The `→ project` button renders only for an agent-scoped task when a `projectId` is known, and is hidden otherwise
- **Scenario**: `SortableItem` must render the new button only when `!isProject && onScopeProject` — and `TaskList`/`ScopedTaskGroup` must only supply `onScopeProject` when `projectId != null && task.projectId == null` (agent-scoped task, project known).
- **Steps**: Covered directly by `frontend/src/components/TaskList.test.tsx` — three cases: `projectId={7}` on an agent-scoped task (button present), `projectId` omitted/`null` (button absent), task already project-scoped (button absent even with a known `projectId`).
- **Expected Result**: Button present only in the agent-scoped-task-with-known-project case; absent in the other two.
- **Repeatable Unit Test**: Created: `frontend/src/components/TaskList.test.tsx` ("→ project scope button" describe block, 3 render-condition cases)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/TaskList.test.tsx` — verified: 7/7 pass
- [x] Pass <!-- 2026-09-19 (auto): via unit test frontend/src/components/TaskList.test.tsx, 7/7 pass, covering the render/no-render cases (projectId provided, null, omitted, already project-scoped) -->

### UAT-EDGE-009: Clicking `→ project` optimistically re-scopes the row and calls the API
- **Scenario**: `ScopedTaskGroup.handleScopeProject` must call `onReorder` with the task optimistically updated (`agentId: null, projectId`) before the network call resolves, and call `scopeTaskToProject(task.id)`.
- **Steps**: Covered directly by `frontend/src/components/TaskList.test.tsx` — clicks the button with `scopeTaskToProject` mocked to resolve, asserts the call and the `onReorder` payload.
- **Expected Result**: `scopeTaskToProject` called with the clicked task's id; `onReorder` called with the task's `agentId: null` and `projectId: 7` (the fixture's project id).
- **Repeatable Unit Test**: Created: `frontend/src/components/TaskList.test.tsx` ("→ project scope button" describe block, click-success case)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/TaskList.test.tsx` — verified: 7/7 pass
- [x] Pass <!-- 2026-09-19 (auto): via unit test frontend/src/components/TaskList.test.tsx, 7/7 pass, "calls scopeTaskToProject and optimistically reorders on click" -->

### UAT-EDGE-010: A failed `scopeTaskToProject` call rolls back the optimistic update and surfaces an error message
- **Scenario**: On rejection, `handleScopeProject` must restore the pre-optimistic-update list via `onReorder(allTasks)` and call `onError` with a `Scope to project failed: ...` message that actually renders. This exact case exposed a real bug during `/tackle` (React 18 batched the rollback's `setError(null)` after the failure's `setError(msg)` when the two calls were issued in the wrong order, so the message never appeared) — fixed by reordering the two calls in `handleScopeProject`'s catch block.
- **Steps**: Covered directly by `frontend/src/components/TaskList.test.tsx` — mocks `scopeTaskToProject` to reject, clicks the button, waits for the rollback and the error text.
- **Expected Result**: `onReorder` is called a second time with the original (pre-optimistic) list; the `Scope to project failed: <message>` text renders in the DOM.
- **Repeatable Unit Test**: Created: `frontend/src/components/TaskList.test.tsx` ("→ project scope button" describe block, rejection/rollback case)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/TaskList.test.tsx` — verified: 7/7 pass
- [x] Pass <!-- 2026-09-19 (auto): via unit test frontend/src/components/TaskList.test.tsx, 7/7 pass, "rolls back to the original list and shows an error message when scopeTaskToProject rejects" -->

---

## Gaps

- **UAT-EDGE-006** (route-level status/error mapping) is `Blocked`, not `Pass`-eligible without a human/live check — see its own entry for why a route-test harness and a live curl were both ruled out for this generation pass.
- **UI/manual-browser cases intentionally excluded**, per explicit user request at generation time — not a research failure. The task's own Step 6 second checkbox (`make dev` walkthrough: drag-select/copy text, click-through to the project group, cross-agent visibility, no-button-when-no-project) covers real end-to-end behavior these unit-backed cases cannot fully substitute for, and remains available for a future `/uat-walk` if the user wants it later.
