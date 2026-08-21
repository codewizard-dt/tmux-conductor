---
id: UAT-069
aliases: [UAT-069]
title: "UAT: Checkpoints list endpoint — GET /api/agents/:id/checkpoints"
status: passed
task: TASK-069
created: 2026-07-06
updated: 2026-07-06
---

# UAT-069 — UAT: Checkpoints list endpoint — GET /api/agents/:id/checkpoints

implements::[[TASK-069]]

> **Source task**: [[TASK-069]]
> **Generated**: 2026-07-06
> **Note**: The task title says `:agent`, but the implemented routes follow the codebase convention of numeric `:id` (matching every other `/agents/:id/*` route, e.g. `/agents/:id/usage`, `/agents/:id/base-branch`). Both `GET` and `POST /api/agents/:id/checkpoints` were implemented (POST is consumed by TASK-068's monitor.sh checkpoint writer).

---

## Prerequisites

- [x] Host-server running on `http://127.0.0.1:8788` (`make dev` or `npm --prefix host-server run dev`)
- [x] At least one agent exists in the DB. At generation time agent id `11` ("general", workdir `/Users/davidtaylor/Repositories/tmux-conductor`) qualifies — verify with `curl -sS http://127.0.0.1:8788/api/agents | jq '[.[] | {id, name}]'` and substitute the id in the commands below if it changed
- [x] `jq` installed

---

## Test Cases

### UAT-API-001: POST creates a checkpoint row
- **Endpoint**: `POST /api/agents/:id/checkpoints`
- **Description**: Creating a checkpoint with a valid `{ ts, stash_ref }` body returns 201 with the full `AgentCheckpoint` row (`insertCheckpoint` uses `RETURNING *`).
- **Steps**:
  1. Run the curl command below as-is
- **Command**:
  ```bash
  curl -sS -i -X POST 'http://127.0.0.1:8788/api/agents/11/checkpoints' -H 'Content-Type: application/json' -d '{"ts":1751800000000,"stash_ref":"stash@{0}"}'
  ```
- **Expected Result**: HTTP 201; body is `{"checkpoint":{"id":<int>,"agentId":11,"ts":1751800000000,"stashRef":"stash@{0}","createdAt":<int>}}`
- **Repeatable Unit Test**: Not applicable: Fastify route wiring is registered inline in `host-server/index.ts` with no injectable app export; the underlying `insertCheckpoint` DB helper already has a repeatable round-trip/ordering test in `host-server/db.migration.test.ts` (added under TASK-067)
- [x] Pass <!-- 2026-07-06 -->

### UAT-API-002: GET returns checkpoints ordered most-recent first
- **Endpoint**: `GET /api/agents/:id/checkpoints`
- **Description**: After inserting two checkpoints with different `ts` values, the list endpoint returns both, ordered by `ts DESC` (matching `listCheckpoints`'s `ORDER BY ts DESC`).
- **Steps**:
  1. Insert an earlier checkpoint:
     ```bash
     curl -sS -X POST 'http://127.0.0.1:8788/api/agents/11/checkpoints' -H 'Content-Type: application/json' -d '{"ts":1751800001000,"stash_ref":"stash@{1}"}'
     ```
  2. Insert a later checkpoint:
     ```bash
     curl -sS -X POST 'http://127.0.0.1:8788/api/agents/11/checkpoints' -H 'Content-Type: application/json' -d '{"ts":1751800002000,"stash_ref":"stash@{2}"}'
     ```
  3. Run the command below and confirm the first two entries are `stash@{2}` then `stash@{1}` (most-recent first)
- **Command**:
  ```bash
  curl -sS 'http://127.0.0.1:8788/api/agents/11/checkpoints' | jq '.checkpoints | map(.stashRef)'
  ```
- **Expected Result**: HTTP 200; the array's first element is `"stash@{2}"` and the element immediately after it is `"stash@{1}"` (ts-descending order), confirming the two just-inserted rows are adjacent and correctly ordered relative to each other
- **Repeatable Unit Test**: Not applicable: route-level integration over the live server; `listCheckpoints`'s `ORDER BY ts DESC` is already covered by a repeatable unit test in `host-server/db.migration.test.ts` (added under TASK-067)
- [x] Pass <!-- 2026-07-06 -->

### UAT-API-003: GET unknown agent id returns 404
- **Endpoint**: `GET /api/agents/:id/checkpoints`
- **Description**: A numeric id with no matching agent row returns 404 with an error body.
- **Steps**:
  1. Run the curl command below as-is (999999 must not be a real agent id)
- **Command**:
  ```bash
  curl -sS -i 'http://127.0.0.1:8788/api/agents/999999/checkpoints'
  ```
- **Expected Result**: HTTP 404 with body `{"error":"agent 999999 not found"}`
- **Repeatable Unit Test**: Not applicable: Fastify route wiring is registered inline with no injectable app export; verified against the live server only
- [x] Pass <!-- 2026-07-06 -->

### UAT-API-004: POST unknown agent id returns 404
- **Endpoint**: `POST /api/agents/:id/checkpoints`
- **Description**: A numeric id with no matching agent row returns 404 before any insert is attempted.
- **Steps**:
  1. Run the curl command below as-is (999999 must not be a real agent id)
- **Command**:
  ```bash
  curl -sS -i -X POST 'http://127.0.0.1:8788/api/agents/999999/checkpoints' -H 'Content-Type: application/json' -d '{"ts":1751800000000,"stash_ref":"stash@{0}"}'
  ```
- **Expected Result**: HTTP 404 with body `{"error":"agent 999999 not found"}`
- **Repeatable Unit Test**: Not applicable: Fastify route wiring is registered inline with no injectable app export; verified against the live server only
- [x] Pass <!-- 2026-07-06 -->

### UAT-EDGE-001: Non-numeric agent id returns 400
- **Scenario**: The `:id` param does not parse as an integer (`parseInt` → NaN) on the GET route.
- **Steps**:
  1. Run the command below as-is
     ```bash
     curl -sS -i 'http://127.0.0.1:8788/api/agents/abc/checkpoints'
     ```
- **Expected Result**: HTTP 400 with body `{"error":"invalid agent id"}`
- **Repeatable Unit Test**: Not applicable: param parsing lives inline in the route handler; verified against the live server only
- [x] Pass <!-- 2026-07-06 -->

### UAT-EDGE-002: POST with missing/invalid ts returns 400
- **Scenario**: The request body omits `ts` (or it is not a finite number), which must be rejected before any DB insert.
- **Steps**:
  1. Run the command below as-is
     ```bash
     curl -sS -i -X POST 'http://127.0.0.1:8788/api/agents/11/checkpoints' -H 'Content-Type: application/json' -d '{"stash_ref":"stash@{0}"}'
     ```
- **Expected Result**: HTTP 400 with body `{"error":"ts is required and must be a number"}`
- **Repeatable Unit Test**: Not applicable: inline body validation, verified against the live server only
- [x] Pass <!-- 2026-07-06 -->

### UAT-EDGE-003: POST with missing/empty stash_ref returns 400
- **Scenario**: The request body has a valid `ts` but omits `stash_ref` (or it is an empty/whitespace string), which must be rejected before any DB insert.
- **Steps**:
  1. Run the command below as-is
     ```bash
     curl -sS -i -X POST 'http://127.0.0.1:8788/api/agents/11/checkpoints' -H 'Content-Type: application/json' -d '{"ts":1751800000000,"stash_ref":"  "}'
     ```
- **Expected Result**: HTTP 400 with body `{"error":"stash_ref is required and must be a non-empty string"}`
- **Repeatable Unit Test**: Not applicable: inline body validation, verified against the live server only
- [x] Pass <!-- 2026-07-06 -->

---

## Coverage vs Acceptance Criteria

| Acceptance criterion | Covered by |
|---|---|
| `GET /api/agents/:agent/checkpoints` returns `{ checkpoints: [...] }` ordered by most-recent first | UAT-API-002 |
| `POST /api/agents/:agent/checkpoints` creates a checkpoint row and returns 201 | UAT-API-001 |
| Both routes return 404 for unknown agents | UAT-API-003, UAT-API-004 |
| `npx tsc --noEmit` passes in `host-server/` | Static gate — verified during /tackle (not re-tested here) |
| (implementation detail, not in original AC) Non-numeric id → 400 | UAT-EDGE-001 |
| (implementation detail, not in original AC) Malformed POST body → 400 | UAT-EDGE-002, UAT-EDGE-003 |
