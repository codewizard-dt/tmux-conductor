---
id: UAT-006
title: "UAT: ID-based /api/tasks routes and SSE events"
status: pending
task: TASK-006
created: 2026-06-12
updated: 2026-06-12
---

# UAT-006 — UAT: ID-based /api/tasks routes and SSE events

implements::[[TASK-006]]

> **Source task**: [`wiki/work/tasks/TASK-006-task-queue-routes.md`](../tasks/TASK-006-task-queue-routes.md)
> **Generated**: 2026-06-12

---

## Prerequisites

- [ ] Backend is running on port 8788: `cd backend && npm run dev &` then `sleep 3`
- [ ] `data/conductor.db` exists (backend has started at least once)
- [ ] At least one agent row exists in the DB (seeded from conductor.conf)

---

## Test Cases

### UAT-API-001: POST /api/tasks — create a global task

- **Endpoint**: `POST /api/tasks`
- **Description**: Verifies a global (unscoped) task is created and returns the task row with a stable ID
- **Steps**:
  1. Ensure the backend is running
  2. Run the command below
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8788/api/tasks' -H 'Content-Type: application/json' -d '{"command":"echo hello from uat"}'
  ```
- **Expected Result**: HTTP 201. Response is a JSON object with at minimum `id` (integer), `command` (`"echo hello from uat"`), `status` (`"queued"`). Record the `id` for subsequent tests.
- [ ] Pass

---

### UAT-API-002: POST /api/tasks — create agent-scoped task

- **Endpoint**: `POST /api/tasks`
- **Description**: Verifies a task scoped to an existing agent is created with the agent's ID
- **Steps**:
  1. Get an agent name from the DB: `sqlite3 data/conductor.db "SELECT name FROM agents LIMIT 1;"`
  2. Replace `AGENT_NAME` below with that name, then run the command
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8788/api/tasks' -H 'Content-Type: application/json' -d '{"command":"echo scoped task","agentName":"AGENT_NAME"}'
  ```
- **Expected Result**: HTTP 201. Response has `id`, `command` (`"echo scoped task"`), `agentId` matching the agent's DB id (not null).
- [ ] Pass

---

### UAT-API-003: POST /api/tasks — 400 for empty command

- **Endpoint**: `POST /api/tasks`
- **Description**: Verifies command validation rejects empty or whitespace-only values
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8788/api/tasks' -H 'Content-Type: application/json' -d '{"command":""}'
  ```
- **Expected Result**: HTTP 400. Body: `{"error":"command is required and must be a non-empty string"}`
- [ ] Pass

---

### UAT-API-004: POST /api/tasks — 400 for invalid placement

- **Endpoint**: `POST /api/tasks`
- **Description**: Verifies placement must be 'tail' or 'head'
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8788/api/tasks' -H 'Content-Type: application/json' -d '{"command":"echo test","placement":"middle"}'
  ```
- **Expected Result**: HTTP 400. Body: `{"error":"placement must be 'tail' or 'head'"}`
- [ ] Pass

---

### UAT-API-005: POST /api/tasks — 404 for unknown agentName

- **Endpoint**: `POST /api/tasks`
- **Description**: Verifies that providing an unknown agentName returns 404 instead of silently ignoring it
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8788/api/tasks' -H 'Content-Type: application/json' -d '{"command":"echo test","agentName":"agent-that-does-not-exist"}'
  ```
- **Expected Result**: HTTP 404. Body: `{"error":"agent 'agent-that-does-not-exist' not found"}`
- [ ] Pass

---

### UAT-API-006: DELETE /api/tasks/:id — delete a task by ID

- **Endpoint**: `DELETE /api/tasks/:id`
- **Description**: Verifies a task can be removed by its stable ID and returns 204
- **Steps**:
  1. Create a task to delete:
     ```bash
     curl -sS -X POST 'http://localhost:8788/api/tasks' -H 'Content-Type: application/json' -d '{"command":"task to delete"}'
     ```
  2. Note the `id` from the response
  3. Run the delete command (replace `ID` with the actual id)
- **Command**:
  ```bash
  curl -sS -X DELETE 'http://localhost:8788/api/tasks/ID'
  ```
- **Expected Result**: HTTP 204. Empty body. Confirm the task is gone:
  ```bash
  sqlite3 data/conductor.db "SELECT count(*) FROM tasks WHERE id=ID AND status='queued';"
  ```
  Result should be `0`.
- [ ] Pass

---

### UAT-API-007: DELETE /api/tasks/:id — 404 for invalid id

- **Endpoint**: `DELETE /api/tasks/:id`
- **Description**: Verifies that a non-numeric ID returns 404
- **Command**:
  ```bash
  curl -sS -X DELETE 'http://localhost:8788/api/tasks/not-a-number'
  ```
- **Expected Result**: HTTP 404. Body: `{"error":"invalid task id"}`
- [ ] Pass

---

### UAT-API-008: PUT /api/tasks/reorder — reorder tasks

- **Endpoint**: `PUT /api/tasks/reorder`
- **Description**: Verifies the reorder endpoint accepts an ordered array of IDs
- **Steps**:
  1. Create two tasks and note their IDs:
     ```bash
     curl -sS -X POST 'http://localhost:8788/api/tasks' -H 'Content-Type: application/json' -d '{"command":"first"}'
     curl -sS -X POST 'http://localhost:8788/api/tasks' -H 'Content-Type: application/json' -d '{"command":"second"}'
     ```
  2. Run the reorder command with the two IDs reversed (replace `ID2,ID1` with actual values)
- **Command**:
  ```bash
  curl -sS -X PUT 'http://localhost:8788/api/tasks/reorder' -H 'Content-Type: application/json' -d '{"ids":[ID2,ID1]}'
  ```
- **Expected Result**: HTTP 200. Body: `{"ok":true}`. Verify new order in DB:
  ```bash
  sqlite3 data/conductor.db "SELECT id, command, position FROM tasks WHERE status='queued' ORDER BY position;"
  ```
  ID2 should appear before ID1.
- [ ] Pass

---

### UAT-API-009: PUT /api/tasks/reorder — 400 for empty ids array

- **Endpoint**: `PUT /api/tasks/reorder`
- **Description**: Verifies that an empty ids array is rejected
- **Command**:
  ```bash
  curl -sS -X PUT 'http://localhost:8788/api/tasks/reorder' -H 'Content-Type: application/json' -d '{"ids":[]}'
  ```
- **Expected Result**: HTTP 400. Body: `{"error":"ids must be a non-empty array of integers"}`
- [ ] Pass

---

### UAT-API-010: POST /api/tasks/:id/jump-head — move task to front of queue

- **Endpoint**: `POST /api/tasks/:id/jump-head`
- **Description**: Verifies a task can be moved to the head (position 1) of the queue
- **Steps**:
  1. Create a task that will be at the tail (replace `ID` with its returned id)
  2. Run the jump-head command
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8788/api/tasks/ID/jump-head'
  ```
- **Expected Result**: HTTP 200. Body: `{"ok":true,"id":ID}`. Confirm the task is now first:
  ```bash
  sqlite3 data/conductor.db "SELECT id, position FROM tasks WHERE status='queued' ORDER BY position LIMIT 1;"
  ```
  The first row should have `id=ID` with the lowest position value.
- [ ] Pass

---

### UAT-API-011: GET /api/queue/:agent — returns Task objects not raw strings

- **Endpoint**: `GET /api/queue/:agent`
- **Description**: Verifies the updated queue endpoint returns structured Task objects instead of raw text lines
- **Steps**:
  1. Get an agent name: `sqlite3 data/conductor.db "SELECT name FROM agents LIMIT 1;"`
  2. Replace `AGENT_NAME` with that name
- **Command**:
  ```bash
  curl -sS 'http://localhost:8788/api/queue/AGENT_NAME'
  ```
- **Expected Result**: HTTP 200. Body: `{"agent":"AGENT_NAME","tasks":[...]}` where each task in the array is an object with at least `id`, `command` fields — not a plain string.
- [ ] Pass

---

### UAT-EDGE-001: Task created with placement='head' appears first in queue

- **Scenario**: Tasks added with `placement:'head'` must be positioned before all existing queued tasks
- **Steps**:
  1. Ensure at least one queued task exists (run UAT-API-001 first if needed)
  2. Add a head-placed task:
     ```bash
     curl -sS -X POST 'http://localhost:8788/api/tasks' -H 'Content-Type: application/json' -d '{"command":"HEAD TASK","placement":"head"}'
     ```
  3. Check the queue order:
     ```bash
     sqlite3 data/conductor.db "SELECT id, command, position FROM tasks WHERE status='queued' ORDER BY position LIMIT 3;"
     ```
- **Expected Result**: The "HEAD TASK" row appears first (lowest position value) among queued tasks.
- [ ] Pass

---

### UAT-EDGE-002: Deleted task's ID is no longer in the DB

- **Scenario**: After DELETE /api/tasks/:id, the task row must be gone (not just status-changed)
- **Steps**:
  1. Create a task and note its `id` (from UAT-API-001 or a fresh POST)
  2. Delete it: `curl -sS -X DELETE 'http://localhost:8788/api/tasks/ID'`
  3. Query:
     ```bash
     sqlite3 data/conductor.db "SELECT count(*) FROM tasks WHERE id=ID;"
     ```
- **Expected Result**: Count is `0` — the row is physically deleted, not soft-deleted.
- [ ] Pass
