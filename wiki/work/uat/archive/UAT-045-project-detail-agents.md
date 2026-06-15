---
id: UAT-045
title: "UAT: Show agents scoped to this project with a Spawn Agent button on the detail page"
status: passed
task: TASK-045
created: 2026-06-14
updated: 2026-06-14
---

# UAT-045 — UAT: Show agents scoped to this project with a Spawn Agent button on the detail page

implements::[[TASK-045]]

> **Source task**: [`wiki/work/tasks/TASK-045-project-detail-agents.md`](../tasks/TASK-045-project-detail-agents.md)
> **Generated**: 2026-06-14

---

## Prerequisites

- [ ] Host-server running on `http://localhost:8788` (`make dev` or `node host-server/index.ts`)
- [ ] Frontend dev server running on `http://localhost:4321`
- [ ] At least one project exists in the database (create via `POST /projects` or the Projects UI)
- [ ] Note the project `id` — used as `:id` in all tests below

---

## Test Cases

### UAT-API-001: GET /agents returns all agents including projectId field

- **Endpoint**: `GET http://localhost:8788/agents`
- **Description**: Verify that the agents list endpoint returns the `projectId` field needed for client-side filtering.
- **Steps**:
  1. Ensure host-server is running.
  2. Run the command below.
- **Command**:
  ```bash
  curl -sS 'http://localhost:8788/agents' | jq '.[0]'
  ```
- **Expected Result**: HTTP 200. Response is a JSON array. Each element has the shape `{id, name, workdir, launchCmd, projectId, createdAt}` where `projectId` is a number or `null`. If no agents exist, the empty array `[]` is acceptable.
- [FAIL: auto-judge: HTTP 404 — route GET:/agents not found; command URL missing /api/ prefix (actual endpoint is /api/agents)] <!-- 2026-06-14 -->

---

### UAT-API-002: POST /projects/:id/agents auto-names and creates a scoped agent

- **Endpoint**: `POST http://localhost:8788/projects/:id/agents`
- **Description**: Verify that spawning an agent auto-names it and returns a 201 with the new agent record including `projectId`.
- **Steps**:
  1. Replace `PROJECT_ID` below with a real project id from your database.
  2. Run the command.
- **Command**:
  ```bash
  curl -sS -X POST "http://localhost:8788/projects/${PROJECT_ID}/agents" -H 'Content-Type: application/json' -d '{}'
  ```
- **Expected Result**: HTTP 201. Response body: `{id: <number>, name: <string>, workdir: <string>, launchCmd: <string>, projectId: <PROJECT_ID>, createdAt: <string>}`. The `name` is auto-generated (e.g. `agent-1`). The returned `projectId` matches the `:id` used in the URL.
- [FAIL: auto-judge: HTTP 404 — route POST:/projects/2/agents not found; command URL missing /api/ prefix (actual endpoint is /api/projects/:id/agents)] <!-- 2026-06-14 -->

---

### UAT-API-003: POST /projects/:id/agents with an explicit name override

- **Endpoint**: `POST http://localhost:8788/projects/:id/agents`
- **Description**: Verify that an optional `name` body field overrides the auto-generated name.
- **Steps**:
  1. Replace `PROJECT_ID` below with a real project id.
  2. Run the command.
- **Command**:
  ```bash
  curl -sS -X POST "http://localhost:8788/projects/${PROJECT_ID}/agents" -H 'Content-Type: application/json' -d '{"name":"my-custom-agent"}'
  ```
- **Expected Result**: HTTP 201. Response body has `name: "my-custom-agent"` and `projectId` matching `PROJECT_ID`.
- [FAIL: auto-judge: HTTP 404 — route POST:/projects/2/agents not found; command URL missing /api/ prefix (actual endpoint is /api/projects/:id/agents)] <!-- 2026-06-14 -->

---

### UAT-EDGE-001: POST /projects/:id/agents with a non-existent project returns 404

- **Scenario**: Spawning an agent for a project id that does not exist.
- **Steps**:
  1. Run the command below (id `999999` is assumed non-existent).
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8788/projects/999999/agents' -H 'Content-Type: application/json' -d '{}'
  ```
- **Expected Result**: HTTP 404. Response body: `{"error": "project 999999 not found"}`.
- [FAIL: auto-judge: HTTP 404 but wrong reason — route POST:/projects/999999/agents not found (router-level 404, not app-level); command URL missing /api/ prefix] <!-- 2026-06-14 -->

---

### UAT-EDGE-002: POST /projects/:id/agents with a non-numeric id returns 400

- **Scenario**: Spawning an agent with a non-numeric route param (bad URL).
- **Steps**:
  1. Run the command below.
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8788/projects/abc/agents' -H 'Content-Type: application/json' -d '{}'
  ```
- **Expected Result**: HTTP 400. Response body: `{"error": "invalid project id"}`.
- [FAIL: auto-judge: HTTP 404 — route POST:/projects/abc/agents not found; command URL missing /api/ prefix] <!-- 2026-06-14 -->

---

### UAT-EDGE-003: POST /projects/:id/agents with an invalid name override returns 400

- **Scenario**: Providing a `name` that contains characters not matching `^[A-Za-z0-9_-]+$`.
- **Steps**:
  1. Replace `PROJECT_ID` with a valid project id.
  2. Run the command.
- **Command**:
  ```bash
  curl -sS -X POST "http://localhost:8788/projects/${PROJECT_ID}/agents" -H 'Content-Type: application/json' -d '{"name":"bad name!"}'
  ```
- **Expected Result**: HTTP 400. Response body: `{"error": "name must match ^[A-Za-z0-9_-]+$"}`.
- [FAIL: auto-judge: HTTP 404 — route POST:/projects/2/agents not found; command URL missing /api/ prefix] <!-- 2026-06-14 -->

---

### UAT-UI-001: Project detail page renders a scoped agents card

- **Page**: `http://localhost:4321/projects/:id` (use a real project id)
- **Description**: Verify that the Agents card renders below the header card on the project detail page, with the section label and an empty-state message when no agents are scoped to the project.
- **Steps**:
  1. Navigate to `http://localhost:4321/projects/:id` for a project that has **no** agents yet.
  2. Observe the page after loading completes.
- **Expected Result**: A card with the label "Agents" (10px uppercase semibold muted) is visible below the header card. The card contains the text "No agents yet. Spawn one to get started." A "Spawn agent" button is visible in the top-right of the card header row.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-14 -->

---

### UAT-UI-002: Agents scoped to the project appear in the card; unscoped agents are excluded

- **Page**: `http://localhost:4321/projects/:id`
- **Description**: Verify that only agents whose `projectId` matches the current project are shown; agents from other projects or without a project are excluded.
- **Steps**:
  1. Create (or confirm the existence of) at least one agent with `projectId` matching the project under test, and at least one agent with `projectId = null` or a different project id.
  2. Navigate to `http://localhost:4321/projects/:id`.
  3. Observe the agents card.
- **Expected Result**: Only agents scoped to this project appear in the list. Agents from other projects or with `projectId = null` are not shown. Each row shows the agent `name` in mono semibold and the `workdir` in mono muted.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-14 -->

---

### UAT-UI-003: Spawn agent button creates a new agent and updates the list without a page reload

- **Page**: `http://localhost:4321/projects/:id`
- **Description**: Verify the full spawn flow: button shows "Spawning…" during the request, and the new agent appears in the list after the request completes.
- **Steps**:
  1. Navigate to `http://localhost:4321/projects/:id`.
  2. Note how many agents are currently shown in the Agents card.
  3. Click "Spawn agent".
  4. Observe the button label while the request is in flight.
  5. Observe the list after the request completes.
- **Expected Result**: While the request is in flight the button label changes to "Spawning…" and the button is disabled. After the request completes the agents list is updated and shows one additional agent with an auto-generated name, without requiring a browser page reload. The button returns to "Spawn agent" and is re-enabled.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-14 -->

---

### UAT-UI-004: Spawn error message appears below the button on failure

- **Page**: `http://localhost:4321/projects/:id`
- **Description**: Verify that if the spawn request fails an error message appears below the button in red.
- **Steps**:
  1. Stop the host-server so requests will fail (`Ctrl+C` the server process).
  2. Navigate to `http://localhost:4321/projects/:id`.
  3. Click "Spawn agent".
  4. Observe the UI after the request fails.
  5. Restart the host-server when done.
- **Expected Result**: A red error message appears below the "Spawn agent" button (e.g. "Failed to spawn agent" or a network error string). The button returns to "Spawn agent" and is re-enabled. No crash or blank screen occurs.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-14 -->

---

### UAT-UI-005: Agent rows render name (mono semibold) and workdir (mono muted)

- **Page**: `http://localhost:4321/projects/:id` (with at least one scoped agent)
- **Description**: Verify the visual row format for each agent: name in monospace semibold, workdir in monospace muted.
- **Steps**:
  1. Ensure at least one agent exists that is scoped to this project (use UAT-API-002 to create one if needed).
  2. Navigate to `http://localhost:4321/projects/:id`.
  3. Observe the agent row(s) in the Agents card.
- **Expected Result**: Each agent row shows the agent's `name` in monospace semibold ink text, and the agent's `workdir` in monospace muted text, truncated if long. Rows have a rounded border and card-canvas background matching the project list row style.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-14 -->
