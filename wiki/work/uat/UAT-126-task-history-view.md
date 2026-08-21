---
id: UAT-126
aliases: [UAT-126]
title: "UAT: Task history view — dashboard page reading completed tasks"
status: pending
task: TASK-126
created: 2026-08-21
updated: 2026-08-21
---

# UAT-126 — UAT: Task history view — dashboard page reading completed tasks

implements::[[TASK-126]]

> **Source task**: [[TASK-126]]
> **Generated**: 2026-08-21

---

## Prerequisites

- [ ] host-server running (`cd host-server && npm run dev`) on port 8788 (or `BACKEND_PORT`)
- [ ] frontend dev server running (`cd frontend && npm run dev`) on port 4321, proxying `/api` to the host-server — required for UAT-UI-001 only
- [ ] At least one `status='done'` task exists (dispatch a task via `POST /api/tasks` to an idle agent and let it be popped, which TASK-125's soft-delete pop flips to `status='done'` with `completed_at` set, instead of deleting the row) — otherwise the happy-path list is empty and the ordering/filter assertions can't be observed
- [ ] Know at least one live `agent_id` with a completed task, for UAT-API-002 (`GET /api/agents` lists ids)

---

## Test Cases

### UAT-API-001: GET /api/tasks/history returns completed tasks newest-first
- **Endpoint**: `GET /api/tasks/history`
- **Description**: Verifies the base contract of the new route in `host-server/index.ts` (registered inside the `/api`-prefixed block, backed by `listCompletedTasks` in `host-server/db.ts`): a bare `Task[]` JSON array of only `status='done'` rows, ordered by `completed_at` DESC.
- **Steps**:
  1. Ensure at least two tasks have been popped to `done` at different times (Prerequisites).
  2. Run the curl command below as-is.
  3. Inspect the returned array: every element's `status` is `"done"`, `completedAt` is non-null, and elements are sorted by `completedAt` descending (most recently completed first).
- **Command**:
  ```bash
  curl -sS 'http://localhost:8788/api/tasks/history'
  ```
- **Expected Result**: `200 OK`, body is a JSON array (not wrapped in `{tasks: [...]}`) of objects shaped `{id, command, agentId, projectId, position, status, source, scheduleId, createdAt, completedAt}`, every `status` is `"done"`, and the array is ordered by `completedAt` descending.
- [FAIL: auto-judge: prerequisite not satisfied — host-server not reachable on port 8788] <!-- 2026-08-21 -->
- **Repeatable Unit Test**: Created: `host-server/db.test.ts`
- **Unit Test Command**: `node --import tsx/esm --test host-server/db.test.ts`

### UAT-API-002: GET /api/tasks/history?agentId= scopes results to one agent
- **Endpoint**: `GET /api/tasks/history?agentId={id}`
- **Description**: Verifies the optional `agentId` query filter in the route handler (`host-server/index.ts`), which parses it as an integer and passes it through to `listCompletedTasks(db, { agentId })`.
- **Steps**:
  1. Substitute `{id}` below with a live agent id that has at least one completed task (`GET /api/agents`).
  2. Run the curl command below.
  3. Confirm every returned task's `agentId` equals the requested id.
- **Command**:
  ```bash
  curl -sS 'http://localhost:8788/api/tasks/history?agentId=1'
  ```
- **Expected Result**: `200 OK`, JSON array where every element has `"agentId": 1` (adjust the id to match the one substituted in the command) and `"status": "done"`.
- [FAIL: auto-judge: prerequisite not satisfied — host-server not reachable on port 8788] <!-- 2026-08-21 -->
- **Repeatable Unit Test**: Created: `host-server/db.test.ts`
- **Unit Test Command**: `node --import tsx/esm --test host-server/db.test.ts`

### UAT-API-003: GET /api/tasks/history?limit= caps the result count
- **Endpoint**: `GET /api/tasks/history?limit={n}`
- **Description**: Verifies the optional `limit` query filter caps the number of rows returned while preserving `completed_at` DESC order.
- **Steps**:
  1. Ensure at least two `done` tasks exist.
  2. Run the curl command below.
  3. Confirm exactly one element is returned, and that it is the most recently completed task.
- **Command**:
  ```bash
  curl -sS 'http://localhost:8788/api/tasks/history?limit=1'
  ```
- **Expected Result**: `200 OK`, JSON array with exactly 1 element, matching the newest `completedAt` value from UAT-API-001's full list.
- [FAIL: auto-judge: prerequisite not satisfied — host-server not reachable on port 8788] <!-- 2026-08-21 -->
- **Repeatable Unit Test**: Created: `host-server/db.test.ts`
- **Unit Test Command**: `node --import tsx/esm --test host-server/db.test.ts`

### UAT-EDGE-001: GET /api/tasks/history?limit= rejects a non-numeric value
- **Scenario**: `limit` query param that fails `parseInt`/`isNaN` validation (`host-server/index.ts`: `if (isNaN(n) || n <= 0) return reply.status(400).send({ error: 'limit must be a positive integer' })`).
- **Steps**: Run the curl command below with a non-numeric `limit`.
- **Command**:
  ```bash
  curl -sS 'http://localhost:8788/api/tasks/history?limit=abc'
  ```
- **Expected Result**: `400 Bad Request`, body `{"error":"limit must be a positive integer"}`.
- [FAIL: auto-judge: prerequisite not satisfied — host-server not reachable on port 8788] <!-- 2026-08-21 -->
- **Repeatable Unit Test**: Blocked: the validation branch lives inline in the unexported `api.get('/tasks/history', ...)` Fastify handler closure in `host-server/index.ts`, not extracted into a standalone pure function — importing `index.ts` directly to unit-test it has import-time side effects (`fastify.listen`, DB open, poll loops), the same non-injectable-entrypoint constraint UAT-119/UAT-120 already documented for this file.

### UAT-EDGE-002: GET /api/tasks/history?agentId= rejects a non-numeric value
- **Scenario**: `agentId` query param that fails `parseInt`/`isNaN` validation (`host-server/index.ts`: `if (isNaN(id)) return reply.status(400).send({ error: 'agentId must be an integer' })`).
- **Steps**: Run the curl command below with a non-numeric `agentId`.
- **Command**:
  ```bash
  curl -sS 'http://localhost:8788/api/tasks/history?agentId=abc'
  ```
- **Expected Result**: `400 Bad Request`, body `{"error":"agentId must be an integer"}`.
- [FAIL: auto-judge: prerequisite not satisfied — host-server not reachable on port 8788] <!-- 2026-08-21 -->
- **Repeatable Unit Test**: Blocked: same reason as UAT-EDGE-001 — the validation branch is inline in the unexported route handler closure in `host-server/index.ts`, not a standalone testable function.

### UAT-UI-001: /history route renders the completed-task list via dashboard navigation
- **Page**: `/history` (`frontend/src/pages/TaskHistoryPage.tsx`, routed in `frontend/src/App.tsx`)
- **Description**: Verifies the history view is reachable through discoverable dashboard navigation (not a hidden route) and renders one row per completed task with command, agent name, project name, and a formatted completion timestamp.
- **Steps**:
  1. Open the dashboard (`http://localhost:4321`) with at least one completed task present (Prerequisites).
  2. In the top nav bar (`frontend/src/components/NavBar.tsx`), click the **History** link (`<NavLink to="/history">History</NavLink>`, alongside **Agents** and **Projects**).
  3. Confirm the URL becomes `/history` and the page heading reads "Task History".
  4. For each completed task, confirm its row shows: the command text (monospace), `Agent: <agent name>` (or `#<id>` if the agent no longer resolves by name, or `—` if `agentId` is null), `Project: <project name>` (same fallback rules), and `Completed: <formatted timestamp>` (via the reused `formatSessionStart` helper).
  5. If no completed tasks exist, confirm the empty state "No completed tasks yet" renders instead of an empty list.
- **Expected Result**: The **History** nav link is visible without any extra discovery step, clicking it navigates to `/history`, and the page lists every completed task with command/agent/project/completion-time — or shows the empty-state message when there are none.
- [FAIL: auto-judge: prerequisite not satisfied — frontend dev server not reachable on port 4321] <!-- 2026-08-21 -->
- **Repeatable Unit Test**: Not applicable: real DOM/browser navigation and rendering verification, not deterministic business logic.

---
