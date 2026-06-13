---
id: UAT-007
title: "UAT: /api/projects CRUD and spawn-agent-for-project"
status: pending
task: TASK-007
created: 2026-06-12
updated: 2026-06-12
---

# UAT-007 — UAT: /api/projects CRUD and spawn-agent-for-project

implements::[[TASK-007]]

> **Source task**: [`wiki/work/tasks/TASK-007-projects-api.md`](../tasks/TASK-007-projects-api.md)
> **Generated**: 2026-06-12

---

## Prerequisites

- [ ] Backend is running on port 8788: `cd backend && npm run dev &` then `sleep 3`
- [ ] `data/conductor.db` exists (backend has started at least once)
- [ ] No project named `uat-test-project` already exists: `sqlite3 data/conductor.db "SELECT count(*) FROM projects WHERE name='uat-test-project';"`

---

## Test Cases

### UAT-API-001: GET /api/projects returns project array

- **Endpoint**: `GET /api/projects`
- **Description**: Verifies the projects endpoint returns a JSON array (empty or populated)
- **Command**:
  ```bash
  curl -sS 'http://localhost:8788/api/projects'
  ```
- **Expected Result**: HTTP 200. Response is a JSON array. Each element (if any) has at minimum `id` (integer), `name` (string), `workdir` (string), `defaultLaunchCmd` (string or null).
- [ ] Pass

---

### UAT-API-002: POST /api/projects — create a project

- **Endpoint**: `POST /api/projects`
- **Description**: Verifies a new project is created and returns the full project row with a stable ID
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8788/api/projects' -H 'Content-Type: application/json' -d '{"name":"uat-test-project","workdir":"/tmp","defaultLaunchCmd":"claude --dangerously-skip-permissions"}'
  ```
- **Expected Result**: HTTP 201. Response has `id` (integer ≥ 1), `name` (`"uat-test-project"`), `workdir` (`"/tmp"`), `defaultLaunchCmd` (`"claude --dangerously-skip-permissions"`). Record the `id` for subsequent tests.
- [ ] Pass

---

### UAT-API-003: POST /api/projects — 400 for invalid name

- **Endpoint**: `POST /api/projects`
- **Description**: Verifies name validation rejects strings that don't match `^[A-Za-z0-9_-]+$`
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8788/api/projects' -H 'Content-Type: application/json' -d '{"name":"bad name!","workdir":"/tmp"}'
  ```
- **Expected Result**: HTTP 400. Body: `{"error":"name is required and must match ^[A-Za-z0-9_-]+$"}`
- [ ] Pass

---

### UAT-API-004: POST /api/projects — 400 for non-absolute workdir

- **Endpoint**: `POST /api/projects`
- **Description**: Verifies workdir must be an absolute path (starts with `/`)
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8788/api/projects' -H 'Content-Type: application/json' -d '{"name":"valid-name","workdir":"relative/path"}'
  ```
- **Expected Result**: HTTP 400. Body: `{"error":"workdir is required and must be an absolute path (starts with /)"}`
- [ ] Pass

---

### UAT-API-005: PUT /api/projects/:id — update project fields

- **Endpoint**: `PUT /api/projects/:id`
- **Description**: Verifies a project's workdir can be updated; other fields remain unchanged
- **Steps**:
  1. Use the project `id` from UAT-API-002 (replace `PROJECT_ID`)
- **Command**:
  ```bash
  curl -sS -X PUT 'http://localhost:8788/api/projects/PROJECT_ID' -H 'Content-Type: application/json' -d '{"workdir":"/tmp/updated"}'
  ```
- **Expected Result**: HTTP 200. Response has `id` = PROJECT_ID, `workdir` = `"/tmp/updated"`, `name` still `"uat-test-project"` (unchanged field is preserved).
- [ ] Pass

---

### UAT-API-006: PUT /api/projects/:id — 404 for unknown project

- **Endpoint**: `PUT /api/projects/:id`
- **Description**: Verifies that updating a non-existent project returns 404
- **Command**:
  ```bash
  curl -sS -X PUT 'http://localhost:8788/api/projects/999999' -H 'Content-Type: application/json' -d '{"workdir":"/tmp"}'
  ```
- **Expected Result**: HTTP 404. Body: `{"error":"project 999999 not found"}`
- [ ] Pass

---

### UAT-API-007: DELETE /api/projects/:id — 409 when project has agents (no force)

- **Endpoint**: `DELETE /api/projects/:id`
- **Description**: Verifies the force-delete guard: deleting a project that has agents without `?force=1` is rejected
- **Steps**:
  1. Get the project id from UAT-API-002 and an agent id from the DB:
     ```bash
     sqlite3 data/conductor.db "SELECT id, name FROM agents LIMIT 1;"
     ```
  2. Assign the agent to the test project using a direct SQL update (since the UI agent-create flow requires a tmux session):
     ```bash
     sqlite3 data/conductor.db "UPDATE agents SET project_id=PROJECT_ID WHERE id=AGENT_ID;"
     ```
  3. Now attempt to delete the project without force (replace `PROJECT_ID`)
- **Command**:
  ```bash
  curl -sS -X DELETE 'http://localhost:8788/api/projects/PROJECT_ID'
  ```
- **Expected Result**: HTTP 409. Body contains an error message mentioning the agent count and instructing to use force.
- [ ] Pass

---

### UAT-API-008: DELETE /api/projects/:id — 204 with force=1

- **Endpoint**: `DELETE /api/projects/:id`
- **Description**: Verifies that `?force=1` allows deletion of a project that has agents; agents' project_id is nulled out
- **Steps**:
  1. Continue from UAT-API-007 (project still exists, agent still linked)
  2. Run the delete with force
- **Command**:
  ```bash
  curl -sS -X DELETE 'http://localhost:8788/api/projects/PROJECT_ID?force=1'
  ```
- **Expected Result**: HTTP 204. Empty body. Verify in DB:
  ```bash
  sqlite3 data/conductor.db "SELECT count(*) FROM projects WHERE id=PROJECT_ID; SELECT project_id FROM agents WHERE id=AGENT_ID;"
  ```
  First count should be `0` (project deleted). Agent's `project_id` should be `NULL` (FK ON DELETE SET NULL).
- [ ] Pass

---

### UAT-API-009: DELETE /api/projects/:id — 400 for non-numeric id

- **Endpoint**: `DELETE /api/projects/:id`
- **Description**: Verifies that a non-numeric id is rejected with 400
- **Command**:
  ```bash
  curl -sS -X DELETE 'http://localhost:8788/api/projects/not-a-number'
  ```
- **Expected Result**: HTTP 400. Body: `{"error":"invalid project id"}`
- [ ] Pass

---

### UAT-EDGE-001: POST /api/projects/:id/agents — auto-names agent from project (requires tmux session)

- **Scenario**: When spawning an agent for a project with no name override, `nextAgentName` generates the name automatically
- **Steps**:
  1. Ensure a conductor tmux session is running: `tmux has-session -t conductor`
  2. Create a fresh project:
     ```bash
     curl -sS -X POST 'http://localhost:8788/api/projects' -H 'Content-Type: application/json' -d '{"name":"uat-proj2","workdir":"/tmp","defaultLaunchCmd":"sleep 3600"}'
     ```
  3. Note the returned `id` (replace `PROJ_ID`), then spawn an agent with no name:
     ```bash
     curl -sS -X POST 'http://localhost:8788/api/projects/PROJ_ID/agents' -H 'Content-Type: application/json' -d '{}'
     ```
  4. Verify the agent was created with an auto-generated name:
     ```bash
     sqlite3 data/conductor.db "SELECT name, project_id FROM agents WHERE project_id=PROJ_ID;"
     ```
- **Expected Result**: HTTP 201. Agent row exists in DB with `project_id=PROJ_ID` and a name matching the pattern `uat-proj2-1` (project name + `-1`). A tmux window for that agent was opened in the conductor session.
- [ ] Pass

---

### UAT-EDGE-002: POST /api/projects/:id/agents — 404 for non-existent project

- **Scenario**: Spawning an agent for a project that doesn't exist returns 404
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8788/api/projects/999999/agents' -H 'Content-Type: application/json' -d '{}'
  ```
- **Expected Result**: HTTP 404. Body: `{"error":"project 999999 not found"}`
- [ ] Pass

---

### UAT-EDGE-003: DELETE empty project succeeds without force

- **Scenario**: A project with no agents can be deleted without `?force=1`
- **Steps**:
  1. Create a project:
     ```bash
     curl -sS -X POST 'http://localhost:8788/api/projects' -H 'Content-Type: application/json' -d '{"name":"uat-empty-project","workdir":"/tmp"}'
     ```
  2. Note the `id` (replace `EMPTY_ID`)
  3. Delete without force
- **Command**:
  ```bash
  curl -sS -X DELETE 'http://localhost:8788/api/projects/EMPTY_ID'
  ```
- **Expected Result**: HTTP 204. Empty body. Project row gone from DB.
- [ ] Pass
