---
id: UAT-156
aliases: [UAT-156]
title: "UAT: bg_processes project_id scoping + GET /projects/:id/bg-processes"
status: passed
task: TASK-156
created: 2026-09-13
updated: 2026-09-13
---

# UAT-156 — UAT: bg_processes project_id scoping + GET /projects/:id/bg-processes

implements::[[TASK-156]]

> **Source task**: [`wiki/work/tasks/TASK-156-bg-processes-project-scoping.md`](../tasks/TASK-156-bg-processes-project-scoping.md)
> **Generated**: 2026-09-13

---

## Prerequisites

- [ ] Host-server is running on port 8788: `cd host-server && npm run dev &` (or `make dev`)
- [ ] `data/conductor.db` is at schema_version ≥ 9 (true once the host-server has started at least once since this task landed — `runMigrations` applies the v9 migration automatically)
- [ ] At least one project exists: `curl -sS http://localhost:8788/api/projects` — note an existing project's `id` (referred to below as `PROJECT_ID`)

---

## Test Cases

### UAT-API-001: GET /api/projects/:id/bg-processes returns only that project's bg processes

- **Endpoint**: `GET /api/projects/:id/bg-processes`
- **Description**: Verifies the new route filters `bg_processes` by `project_id` and returns the camelCase `BgProcess` shape (`listBgProcesses(db, { projectId })` → `mapBgProcess`)
- **Steps**:
  1. Seed two bg-process rows directly in the DB: one scoped to `PROJECT_ID`, one unscoped (replace `PROJECT_ID`):
     ```bash
     sqlite3 data/conductor.db "INSERT INTO bg_processes (name, workdir, launch_cmd, project_id) VALUES ('uat156-bg-scoped', '/tmp', 'sleep 3600', PROJECT_ID); INSERT INTO bg_processes (name, workdir, launch_cmd, project_id) VALUES ('uat156-bg-unscoped', '/tmp', 'sleep 3600', NULL);"
     ```
  2. Run the curl command below (replace `PROJECT_ID`).
- **Command**:
  ```bash
  curl -sS 'http://localhost:8788/api/projects/PROJECT_ID/bg-processes'
  ```
- **Expected Result**: HTTP 200. Response is a JSON array containing exactly one object named `uat156-bg-scoped` with `workdir: "/tmp"`, `launchCmd: "sleep 3600"`, `linkedAgentId: null`, `projectId: PROJECT_ID` (as a number). The array must NOT contain `uat156-bg-unscoped`.
- **Cleanup**: `sqlite3 data/conductor.db "DELETE FROM bg_processes WHERE name IN ('uat156-bg-scoped','uat156-bg-unscoped');"`
- **Repeatable Unit Test**: Not applicable: verifies Fastify HTTP route wiring (id parsing, project-existence check, JSON response shape) for a route added directly in `host-server/index.ts`; the repo has no fastify-inject route-level test harness (no `host-server/index.test.ts` exists) and building one is new infrastructure outside this task's scope. The underlying `listBgProcesses(db, { projectId })` filtering this route calls is already covered by `host-server/db.test.ts`'s `TASK-156: listBgProcesses(db, { projectId }) isolates rows per project...` test (see UAT-EDGE-002).
- [x] Pass <!-- 2026-09-13: live curl against http://localhost:8788/api/projects/1/bg-processes returned exactly [{"name":"uat156-bg-scoped","workdir":"/tmp","launchCmd":"sleep 3600","linkedAgentId":null,"projectId":1}], unscoped row excluded; test rows cleaned up after -->

---

### UAT-API-002: GET /api/projects/:id/bg-processes — 404 for non-existent project

- **Endpoint**: `GET /api/projects/:id/bg-processes`
- **Description**: Verifies the route 404s when the project id parses but no such project exists, mirroring `POST /api/projects/:id/agents`'s existing check
- **Command**:
  ```bash
  curl -sS 'http://localhost:8788/api/projects/999999/bg-processes'
  ```
- **Expected Result**: HTTP 404. Body: `{"error":"project 999999 not found"}`
- **Repeatable Unit Test**: Not applicable: verifies Fastify HTTP route wiring; no route-level test harness exists in this repo (see UAT-API-001's rationale).
- [x] Pass <!-- 2026-09-13: live curl returned HTTP 404, body {"error":"project 999999 not found"} — exact match -->

---

### UAT-API-003: GET /api/projects/:id/bg-processes — 400 for non-numeric id

- **Endpoint**: `GET /api/projects/:id/bg-processes`
- **Description**: Verifies the route validates `id` as an integer before querying, mirroring every other `/projects/:id/...` route
- **Command**:
  ```bash
  curl -sS 'http://localhost:8788/api/projects/not-a-number/bg-processes'
  ```
- **Expected Result**: HTTP 400. Body: `{"error":"invalid project id"}`
- **Repeatable Unit Test**: Not applicable: verifies Fastify HTTP route wiring; no route-level test harness exists in this repo (see UAT-API-001's rationale).
- [x] Pass <!-- 2026-09-13: live curl returned HTTP 400, body {"error":"invalid project id"} — exact match -->

---

### UAT-EDGE-001: v9 migration adds bg_processes.project_id and preserves existing rows

- **Scenario**: An existing pre-v9 DB (`bg_processes` with no `project_id` column) gains the column via a plain `ALTER TABLE` on `openDb`, without losing any existing row, and without a table rebuild
- **Steps**: Covered end-to-end by the repeatable unit test below, which builds a real pre-v9 fixture DB (schema_version 8, `bg_processes` lacking `project_id`), inserts a probe row, runs the real `openDb` migration path, and asserts the column now exists, the probe row survives with `project_id` NULL, and `schema_version >= 9`.
- **Expected Result**: Unit test passes (see command below).
- **Repeatable Unit Test**: Created: `host-server/db.migration.test.ts` (`existing pre-v9 DB gains bg_processes.project_id and preserves rows`)
- **Unit Test Command**: `node --import tsx/esm --test --test-name-pattern="existing pre-v9 DB gains bg_processes.project_id and preserves rows" host-server/db.migration.test.ts`
- [x] Pass <!-- 2026-09-13: 1 test ran, passed, exit 0 -->

---

### UAT-EDGE-002: createBgProcess/listBgProcesses round-trip projectId and isolate rows per project

- **Scenario**: `createBgProcess` persists an optional `projectId`, `mapBgProcess` round-trips it as `projectId` on read, `listBgProcesses(db, { projectId })` returns only that project's rows, and `listBgProcesses(db)` (no opts) stays unfiltered — unchanged from pre-task behavior
- **Steps**: Covered end-to-end by the repeatable unit tests below, which create bg processes scoped to two different projects plus one unscoped row, then assert per-project filtering and unfiltered listing both behave correctly.
- **Expected Result**: Unit tests pass (see command below).
- **Repeatable Unit Test**: Created: `host-server/db.test.ts` (`TASK-156: createBgProcess persists and round-trips projectId via mapBgProcess`, `TASK-156: listBgProcesses(db, { projectId }) isolates rows per project, and listBgProcesses(db) remains unfiltered`)
- **Unit Test Command**: `node --import tsx/esm --test --test-name-pattern="TASK-156" host-server/db.test.ts`
- [x] Pass <!-- 2026-09-13: 2 tests ran, both passed, exit 0 -->

---
