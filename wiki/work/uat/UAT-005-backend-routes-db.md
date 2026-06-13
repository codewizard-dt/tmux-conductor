---
id: UAT-005
title: "UAT: DB-backed agent and bg-process routes with spawnAgentWindow helper"
status: pending
task: TASK-005
created: 2026-06-12
updated: 2026-06-12
---

# UAT-005 — UAT: DB-backed agent and bg-process routes with spawnAgentWindow helper

implements::[[TASK-005]]

> **Source task**: [`wiki/work/tasks/TASK-005-backend-routes-db.md`](../tasks/TASK-005-backend-routes-db.md)
> **Generated**: 2026-06-12

---

## Prerequisites

- [ ] `backend/` has working `node_modules/` (`npm install` run)
- [ ] `data/conductor.db` exists and has been seeded (start backend once: `cd backend && npm run dev`)
- [ ] Backend is running on port 8788: `cd backend && npm run dev &` then `sleep 3`
- [ ] `conductor.conf` has at least one agent entry (used as seed data)

---

## Test Cases

### UAT-API-001: GET /api/agents returns DB-backed agent array

- **Endpoint**: `GET /api/agents`
- **Description**: Verifies the new route returns agents sourced from SQLite, not from conductor.conf
- **Steps**:
  1. Ensure the backend is running
  2. Run the command below
- **Command**:
  ```bash
  curl -sS 'http://localhost:8788/api/agents'
  ```
- **Expected Result**: HTTP 200. Response is a JSON array where each element has at minimum `id`, `name`, `workdir`, `launchCmd` fields. The array is non-empty (agents were seeded from conductor.conf at first start).
- [ ] Pass

---

### UAT-API-002: GET /api/status agents are sourced from DB

- **Endpoint**: `GET /api/status`
- **Description**: Verifies that the `agents` array in the status snapshot comes from `listAgents(db)`, not `conf.agents`
- **Steps**:
  1. Ensure the backend is running
  2. Run the command below
- **Command**:
  ```bash
  curl -sS 'http://localhost:8788/api/status' | python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps([{'name':a['name'],'workdir':a['workdir']} for a in d['agents']]))"
  ```
- **Expected Result**: HTTP 200. Response has an `agents` key with an array; each agent object has `name`, `workdir`, `launchCmd` matching the DB-seeded values from conductor.conf.
- [ ] Pass

---

### UAT-API-003: POST /api/agents — validation rejects missing name

- **Endpoint**: `POST /api/agents`
- **Description**: Verifies the name validation guard (must be alphanumeric + `_-`)
- **Steps**:
  1. Ensure the backend is running
  2. Run the command below (name contains a space — invalid)
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8788/api/agents' -H 'Content-Type: application/json' -d '{"name":"bad name","workdir":"/tmp"}'
  ```
- **Expected Result**: HTTP 400. Body: `{"error":"name is required and must match ^[a-zA-Z0-9_-]+$"}`
- [ ] Pass

---

### UAT-API-004: POST /api/agents — validation rejects non-absolute workdir

- **Endpoint**: `POST /api/agents`
- **Description**: Verifies the workdir must be an absolute path (starts with `/`)
- **Steps**:
  1. Ensure the backend is running
  2. Run the command below (workdir is relative)
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8788/api/agents' -H 'Content-Type: application/json' -d '{"name":"test-agent","workdir":"relative/path"}'
  ```
- **Expected Result**: HTTP 400. Body: `{"error":"workdir is required and must be an absolute path (starts with /)"}`
- [ ] Pass

---

### UAT-API-005: POST /api/agents — 409 when no tmux session is running

- **Endpoint**: `POST /api/agents`
- **Description**: Verifies that attempting to spawn an agent when there is no conductor tmux session returns a descriptive 409
- **Steps**:
  1. Confirm no tmux session named "conductor" is running: `tmux has-session -t conductor 2>/dev/null && echo running || echo absent`
  2. If absent, proceed. If running, this test should be skipped (run it after teardown).
  3. Run the command below
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8788/api/agents' -H 'Content-Type: application/json' -d '{"name":"test-agent","workdir":"/tmp"}'
  ```
- **Expected Result**: HTTP 409. Body contains `"session not running"` and `"sessionAlive": false`.
- [ ] Pass

---

### UAT-API-006: DELETE /api/agents/:agent — 404 for unknown agent

- **Endpoint**: `DELETE /api/agents/:agent`
- **Description**: Verifies the DB lookup returns 404 when the agent name does not exist in SQLite
- **Steps**:
  1. Ensure the backend is running
  2. Run the command below (no agent named "does-not-exist" exists)
- **Command**:
  ```bash
  curl -sS -X DELETE 'http://localhost:8788/api/agents/does-not-exist'
  ```
- **Expected Result**: HTTP 404. Body: `{"error":"agent 'does-not-exist' not found"}`
- [ ] Pass

---

### UAT-API-007: POST /api/bg-processes — validation rejects invalid name

- **Endpoint**: `POST /api/bg-processes`
- **Description**: Verifies name validation for bg processes (same regex as agents)
- **Steps**:
  1. Ensure the backend is running
  2. Run the command below (name has invalid character)
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8788/api/bg-processes' -H 'Content-Type: application/json' -d '{"name":"bad name","workdir":"/tmp","launchCmd":"sleep 60"}'
  ```
- **Expected Result**: HTTP 400. Body: `{"error":"name is required and must match ^[a-zA-Z0-9_-]+$"}`
- [ ] Pass

---

### UAT-API-008: DELETE /api/bg-processes/:name — 404 for unknown bg process

- **Endpoint**: `DELETE /api/bg-processes/:name`
- **Description**: Verifies the DB lookup returns 404 when the bg process name does not exist in SQLite
- **Steps**:
  1. Ensure the backend is running
  2. Run the command below
- **Command**:
  ```bash
  curl -sS -X DELETE 'http://localhost:8788/api/bg-processes/nonexistent-bg'
  ```
- **Expected Result**: HTTP 404. Body: `{"error":"bg process 'nonexistent-bg' not found"}`
- [ ] Pass

---

### UAT-EDGE-001: POST /api/agents — agent is inserted into DB (requires tmux session)

- **Scenario**: When a valid agent is created, the DB row must persist across backend restarts
- **Steps**:
  1. Ensure a conductor tmux session is running: `tmux has-session -t conductor`
  2. Create a test agent:
     ```bash
     curl -sS -X POST 'http://localhost:8788/api/agents' -H 'Content-Type: application/json' -d '{"name":"uat-test-agent","workdir":"/tmp"}'
     ```
  3. Verify the agent row exists in SQLite:
     ```bash
     sqlite3 data/conductor.db "SELECT id, name, workdir FROM agents WHERE name='uat-test-agent';"
     ```
  4. Restart the backend and re-check the DB — the row must still be present
  5. Clean up:
     ```bash
     curl -sS -X DELETE 'http://localhost:8788/api/agents/uat-test-agent'
     ```
- **Expected Result**: Agent appears in the DB immediately after creation and persists across a restart. The DELETE removes it from the DB (confirmed by an empty query result after deletion).
- [ ] Pass

---

### UAT-EDGE-002: conf-splice functions no longer called (regression check)

- **Scenario**: The old `appendAgentToConf` / `removeAgentFromConf` functions must NOT be imported or called from `backend/index.ts` after TASK-005
- **Steps**:
  ```bash
  grep -n 'appendAgentToConf\|removeAgentFromConf\|appendBgProcessToConf\|removeBgProcessFromConf' backend/index.ts
  ```
- **Expected Result**: No output — none of the conf-splice functions are referenced in `index.ts`. (They may still exist in `config.ts` for Phase 5 cleanup.)
- [ ] Pass

---

### UAT-EDGE-003: GET /api/agents reflects seeded data without restarting

- **Scenario**: After backend restart with an existing DB, `GET /api/agents` must return the same agents as the DB without re-importing from conf
- **Steps**:
  1. Note current agent count:
     ```bash
     sqlite3 data/conductor.db "SELECT count(*) FROM agents;"
     ```
  2. Stop the backend, then restart it: `cd backend && npm run dev &`
  3. Wait 3 seconds, then:
     ```bash
     curl -sS 'http://localhost:8788/api/agents' | python3 -c "import sys,json; print(len(json.load(sys.stdin)))"
     ```
- **Expected Result**: The count from `GET /api/agents` matches the DB count from step 1. No duplicate agents were created.
- [ ] Pass
