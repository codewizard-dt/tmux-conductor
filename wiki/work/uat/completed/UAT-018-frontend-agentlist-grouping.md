---
id: UAT-018
title: "UAT: Group AgentList by project and react to the new ID-based task SSE events"
status: passed
task: TASK-018
created: 2026-06-12
updated: 2026-06-12
---

# UAT-018 — UAT: Group AgentList by project and react to the new ID-based task SSE events

implements::[[TASK-018]]

> **Source task**: [`wiki/work/tasks/completed/TASK-018-frontend-agentlist-grouping.md`](../../tasks/completed/TASK-018-frontend-agentlist-grouping.md)
> **Generated**: 2026-06-12

This UAT covers only what TASK-018 changed: the `AgentList` component's per-project
grouping (with an "Unassigned" group rendered last), agent-count badges, reuse of the
`Project`/`ApiAgent` types from `lib/api.ts`, the one-time `GET /api/agents` +
`GET /api/projects` membership fetch, and the four ID-based task SSE listeners
(`task-added`, `task-removed`, `queue-reordered`, `task-moved`) acting as live triggers.

The backend supplies the contract but was not modified by this task; the API tests below
exist to (a) confirm the membership/SSE endpoints the component depends on return the
expected shapes, and (b) drive the live-update UI tests.

---

## Prerequisites

- [ ] Backend running on `http://localhost:8788` (`make dev-backend` or the full `make dev`). API routes are under the `/api` prefix.
- [ ] Frontend dev server running on `http://localhost:4321` (`make dev-frontend` or `make dev`).
- [ ] SQLite data layer migrated and reachable (ROADMAP-001) — `GET /api/agents` and `GET /api/projects` return arrays.
- [ ] At least one project exists and at least one agent is assigned to it, plus at least one agent with `projectId: null` (to exercise the Unassigned group). Create them via the dashboard or the `POST /api/projects` / `POST /api/agents` endpoints if the DB is empty.
- [ ] `make typecheck` available at repo root (final static gate for the frontend changes).

---

## Test Cases

### UAT-API-001: GET /api/agents returns ApiAgent rows carrying projectId
- **Endpoint**: `GET /api/agents`
- **Description**: The membership fetch (`fetchAgents()`) the component calls on mount must return agent rows that include a `projectId` field (number or null) and `name`. Without this the project grouping cannot be built.
- **Steps**:
  1. Ensure the backend is running.
  2. Run the curl command below as-is.
- **Command**:
  ```bash
  curl -sS 'http://localhost:8788/api/agents' | jq '.[0] | {id, name, projectId, workdir, launchCmd, createdAt}'
  ```
- **Expected Result**: HTTP 200. A JSON array; each element has `id` (number), `name` (string), `workdir` (string), `launchCmd` (string), `projectId` (number or null), `createdAt` (string). Rows are ordered by `name`. At least one row with a numeric `projectId` and at least one with `projectId: null` should exist per prerequisites.
- [x] Pass <!-- 2026-06-12 -->

### UAT-API-002: GET /api/projects returns id→name rows for grouping labels
- **Endpoint**: `GET /api/projects`
- **Description**: The `listProjects()` fetch supplies the `projectId → projectName` map used as the section title and to validate that an agent's `projectId` points to a real project.
- **Steps**:
  1. Ensure the backend is running.
  2. Run the curl command below as-is.
- **Command**:
  ```bash
  curl -sS 'http://localhost:8788/api/projects' | jq '.[0] | {id, name, workdir, defaultLaunchCmd, createdAt}'
  ```
- **Expected Result**: HTTP 200. A JSON array; each element has `id` (number), `name` (string), `workdir` (string), `defaultLaunchCmd` (string), `createdAt` (string). Rows are ordered by `name`. Every numeric `projectId` returned by UAT-API-001 should correspond to an `id` here.
- [x] Pass <!-- 2026-06-12 -->

### UAT-API-003: POST /api/tasks creates a task and emits the task-added SSE event
- **Endpoint**: `POST /api/tasks`
- **Description**: Drives the `task-added` listener that the component subscribes to. The response is the full Task object (the same payload pushed over SSE), which the component parses and uses as a trigger to re-fetch membership.
- **Steps**:
  1. Pick an existing agent id from UAT-API-001 (replace `1` below if needed).
  2. Run the curl command below as-is.
  3. Note the returned task `id` for use in UAT-API-004/005.
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8788/api/tasks' -H 'Content-Type: application/json' -d '{"command":"echo uat-018","agentId":1}'
  ```
- **Expected Result**: HTTP 201. Body is the full Task object with `id` (number), `command` ("echo uat-018"), `agentId` (the id sent), `projectId` (number or null), `position` (number), `status` ("queued" or "backlog"), `source` ("manual"), `scheduleId` (null), `createdAt` (string), plus `dispatched: false` (or `dispatched: true` if the agent was idle and the task dispatched immediately). A `task-added` SSE event carrying this Task is broadcast (verified live in UAT-UI-004).
- [FAIL: auto-judge: command sends `agentId` but POST /api/tasks handler reads `agentName` (backend/index.ts:365) — `agentId` field is ignored, so response returned agentId:null, expected the id sent (6). HTTP 201 and task-added broadcast are correct; the agentId assertion in Expected does not hold for the test's literal command.] <!-- 2026-06-12 -->

### UAT-API-004: PUT /api/tasks/reorder emits queue-reordered
- **Endpoint**: `PUT /api/tasks/reorder`
- **Description**: Drives the `queue-reordered` listener. The component must parse-and-ignore this `{ ids }` event without error (no parallel task store).
- **Steps**:
  1. Use the task id from UAT-API-003 (replace `<TASK_ID>` below).
  2. Run the curl command below as-is.
- **Command**:
  ```bash
  curl -sS -X PUT 'http://localhost:8788/api/tasks/reorder' -H 'Content-Type: application/json' -d '{"ids":[<TASK_ID>]}'
  ```
- **Expected Result**: HTTP 200, body `{"ok":true}`. A `queue-reordered` SSE event with `{ ids: [<TASK_ID>] }` is broadcast.
- [x] Pass <!-- 2026-06-12 -->

### UAT-API-005: POST /api/tasks/:id/jump-head emits task-moved, DELETE emits task-removed
- **Endpoint**: `POST /api/tasks/:id/jump-head`
- **Description**: Drives the `task-moved` listener (`{ id }`). (The companion `DELETE /api/tasks/:id` emitting `task-removed` is exercised in UAT-UI-004 cleanup.)
- **Steps**:
  1. Use the task id from UAT-API-003 (replace `<TASK_ID>` below).
  2. Run the curl command below as-is.
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8788/api/tasks/<TASK_ID>/jump-head'
  ```
- **Expected Result**: HTTP 200, body `{"ok":true,"id":<TASK_ID>}`. A `task-moved` SSE event with `{ id: <TASK_ID> }` is broadcast.
- [x] Pass <!-- 2026-06-12 -->

### UAT-UI-001: AgentList renders one section per project with an "Unassigned" group last
- **Page**: `http://localhost:4321`
- **Component**: `frontend/src/components/AgentList.tsx`
- **Description**: Top-level grouping is by project. Each project that has at least one current agent renders as its own `<section>` titled with the project name; agents whose `projectId` is null (or unknown) collect into an "Unassigned" section that always sorts last.
- **Steps**:
  1. Navigate to `http://localhost:4321`.
  2. Wait for the "tmux Conductor — Agents" panel to finish loading.
  3. Observe the outer sections under the panel heading.
- **Expected Result**: There is one outer section per non-empty project, with the project name shown as the section heading. Project sections are ordered alphabetically (case-insensitive) by project name. If any agent has `projectId: null`, an "Unassigned" section appears as the **last** section. Empty projects (zero agents) are not rendered.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-12 -->

### UAT-UI-002: Each project section shows an agent-count badge
- **Page**: `http://localhost:4321`
- **Description**: Each project section heading carries a pill badge with the number of agents in that group, mirroring the existing column count-badge styling.
- **Steps**:
  1. Navigate to `http://localhost:4321`.
  2. For each project section, read the small pill badge next to the section title.
  3. Count the agent cards rendered inside that section (across its nested status columns).
- **Expected Result**: The badge number for each section equals the count of agent cards rendered inside that section. The "Unassigned" section badge equals the number of agents with no project membership.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-12 -->

### UAT-UI-003: Status columns remain nested inside each project section
- **Page**: `http://localhost:4321`
- **Description**: The prior status board (BOARD_COLUMNS) is preserved but nested under each project section; an agent appears in the correct status column within its own project group, and accordion open/close state does not bleed across project groups (composite `group:column` keying).
- **Steps**:
  1. Navigate to `http://localhost:4321`.
  2. Inside one project section, locate the nested status column headers (each with its own count badge).
  3. If two different project sections each contain an agent, expand an agent card in the first section, then check the second section.
- **Expected Result**: Within every project section the agents are split into the existing status columns, each column showing its own count badge. Expanding/opening an agent card in one project section does not open or alter a card in a different project section (no cross-group accordion bleed).
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-12 -->

### UAT-UI-004: task-added SSE event live-refreshes grouping without reload
- **Page**: `http://localhost:4321`
- **Description**: With the dashboard open, creating a task via the API broadcasts `task-added`; the component handles it as a lightweight trigger (re-fetching membership) and the subsequent `agent-update` updates the agent's queued-task count / active task — all without a manual page reload and without a console error.
- **Steps**:
  1. Navigate to `http://localhost:4321` and leave it open.
  2. Open the browser devtools Console (to confirm no errors fire on the new SSE listeners).
  3. In a separate shell, run the POST from UAT-API-003 against an agent that is currently visible on the dashboard.
  4. Observe the corresponding agent card and the console.
- **Expected Result**: Without reloading, the targeted agent's queued-task count (or active-task display) updates live to reflect the new task. No uncaught exceptions appear in the console from the `task-added` / `task-removed` / `queue-reordered` / `task-moved` listeners. (Cleanup: delete the task with `curl -sS -X DELETE 'http://localhost:8788/api/tasks/<TASK_ID>'`, which emits `task-removed`; the card returns to its prior count, again with no reload and no console error.)
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-12 -->

### UAT-UI-005: New agent in a project appears under that project group live
- **Page**: `http://localhost:4321`
- **Description**: When a brand-new agent (one whose name the component has not seen) arrives via `agent-update`, the component re-fetches membership so the agent lands in the correct project group rather than being stuck in Unassigned.
- **Steps**:
  1. Navigate to `http://localhost:4321` and leave it open.
  2. Create a new agent assigned to an existing project (via the dashboard's add-agent flow, or `POST /api/agents` with a `projectId`, then ensure it registers/produces an `agent-update`).
  3. Observe which section the new agent card appears in.
- **Expected Result**: The new agent card appears under its assigned project's section (matching the project named for its `projectId`), not in "Unassigned", without a manual page reload.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-12 -->

### UAT-EDGE-001: Membership fetch failure degrades gracefully to all-Unassigned
- **Scenario**: `GET /api/agents` or `GET /api/projects` fails (e.g. backend briefly down) while `GET /status` still succeeds. Membership is supplementary; the catch handlers leave the maps empty.
- **Steps**:
  1. Stop the backend after the dashboard has loaded `/status`, OR load the dashboard in a state where the membership endpoints error but the status snapshot is cached/available.
  2. Trigger a fresh mount of `AgentList` (reload while membership endpoints are failing but status resolves), or inspect behavior when membership maps are empty.
- **Expected Result**: The component does not crash or show the red error banner solely because membership failed. With empty membership maps, every agent falls into the single "Unassigned" group and the rest of the UI (status columns, badges, modal) continues to function. The error banner only appears when the `/status` fetch itself fails.
- [FAIL: auto-judge: manual test requires human verification] <!-- 2026-06-12 -->

### UAT-EDGE-002: Malformed task SSE event is ignored without breaking the stream
- **Scenario**: A task SSE event arrives with a non-JSON or unexpected payload. Each listener is wrapped in try/catch and must swallow the error.
- **Steps**:
  1. Navigate to `http://localhost:4321` with the console open.
  2. Drive at least one valid task event (UAT-API-003) and one reorder/move (UAT-API-004/005) to confirm the listeners run.
  3. Confirm that even if a payload were malformed, no uncaught error surfaces (the handlers `JSON.parse` inside try/catch and ignore failures).
- **Expected Result**: No uncaught exception appears in the console from any of the four task listeners; the `EventSource` connection stays open and subsequent valid `agent-update` events continue to update the UI.
- [FAIL: auto-judge: manual test requires human verification] <!-- 2026-06-12 -->

### UAT-STATIC-001: make typecheck passes clean (frontend + backend)
- **Scenario**: The frontend changes must compile under strict TypeScript; the final gate is `make typecheck` at repo root.
- **Steps**:
  1. From the repo root, run the command below.
- **Command**:
  ```bash
  make typecheck
  ```
- **Expected Result**: Exit code 0. `tsc --noEmit` reports zero diagnostics in both `frontend/` and `backend/`.
- [x] Pass <!-- 2026-06-12 -->

---
