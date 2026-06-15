---
id: UAT-023
title: "UAT: Delete dead conf-splice + legacy file-queue code from backend/config.ts and backend/state.ts"
status: passed
task: TASK-023
created: 2026-06-13
updated: 2026-06-13
run: 2026-06-13
---

# UAT-023 — UAT: Delete dead conf-splice + legacy file-queue code from backend/config.ts and backend/state.ts

implements::[[TASK-023]]

> **Source task**: [`wiki/work/tasks/TASK-023-remove-legacy-conf-queue-code-backend.md`](../tasks/TASK-023-remove-legacy-conf-queue-code-backend.md)
> **Generated**: 2026-06-13

---

## Prerequisites

- [ ] Backend dependencies installed: `cd backend && npm install`
- [ ] TypeScript installed in both packages: `npm install` run in `backend/` and `frontend/`
- [ ] Backend running for API tests: `cd backend && npx tsx index.ts` (or `make dev`) — port 8788

---

## Test Cases

### UAT-STATIC-001: TypeScript typecheck passes clean in both packages

- **Description**: `make typecheck` must exit 0 with no errors in backend/ and frontend/. Any leftover reference to a deleted symbol, orphaned destructure, or missing import would surface here.
- **Steps**:
  1. From the repo root, run the command below.
- **Command**:
  ```bash
  make typecheck
  ```
- **Expected Result**: Exit code 0. No TypeScript errors printed for either `backend/` or `frontend/`. The command runs `cd backend && npx tsc --noEmit` followed by `cd frontend && npx tsc --noEmit`.
- [x] Pass <!-- 2026-06-13 -->

---

### UAT-STATIC-002: Deleted symbols are absent from all backend code files

- **Description**: The six dead symbols — `appendAgentToConf`, `removeAgentFromConf`, `countQueuedTasks`, `readQueue`, `writeQueue`, `getAgentLines` — must have zero occurrences anywhere in `backend/`. Historical prose in `.docs/` is out of scope; only code files count.
- **Steps**:
  1. Run the grep command below against the `backend/` directory.
- **Command**:
  ```bash
  grep -rn --include='*.ts' 'appendAgentToConf\|removeAgentFromConf\|countQueuedTasks\|readQueue\|writeQueue\|getAgentLines' backend/
  ```
- **Expected Result**: No output (exit code 1 — grep found nothing). Zero matches across `backend/config.ts`, `backend/state.ts`, `backend/index.ts`, and any other `.ts` files under `backend/`.
- [x] Pass <!-- 2026-06-13 -->

---

### UAT-STATIC-003: Legacy mutating flat-file queue routes are absent from backend/index.ts

- **Description**: The three superseded write routes (`POST /queue/:agent`, `PUT /queue/:agent/reorder`, `DELETE /queue/:agent/:index`) must not be registered. These were backed by the deleted file-queue helpers and have been replaced by the DB-backed `/api/tasks` endpoints.
- **Steps**:
  1. Run the grep command below.
- **Command**:
  ```bash
  grep -n "api\.post.*'/queue/:agent'\|api\.put.*'/queue/:agent/reorder'\|api\.delete.*'/queue/:agent/:index'" backend/index.ts
  ```
- **Expected Result**: No output (exit code 1). None of the three route registrations exist in `backend/index.ts`.
- [x] Pass <!-- 2026-06-13 -->

---

### UAT-STATIC-004: Read-only GET /queue/:agent route is preserved

- **Description**: `GET /queue/:agent` was already DB-backed via `listTasksForAgent` before this task and must be kept. Only the three mutating variants were deleted.
- **Steps**:
  1. Run the grep command below.
- **Command**:
  ```bash
  grep -n "api\.get.*'/queue/:agent'" backend/index.ts
  ```
- **Expected Result**: Exactly one matching line. The route body must call `listTasksForAgent` (not any deleted file-queue function).
- [x] Pass <!-- 2026-06-13 -->

---

### UAT-STATIC-005: state.ts import in backend/index.ts no longer includes the four deleted functions

- **Description**: After the dead functions were removed from `backend/state.ts`, their names must also have been pruned from the import statement in `backend/index.ts`. Importing a non-existent export would fail `tsc`.
- **Steps**:
  1. Run the grep command below.
- **Command**:
  ```bash
  grep -n "from './state" backend/index.ts
  ```
- **Expected Result**: One line matching `from './state.ts'` (or `'./state'`). The import list must **not** contain `countQueuedTasks`, `readQueue`, `writeQueue`, or `getAgentLines`. It must still contain `detectAgentStatus`, `detectAgentMode`, `isTmuxWindowPresent`, `getActiveTask`, `capturePaneTail`, `capturePaneTailRaw`, `sendTextToPane`.
- [x] Pass <!-- 2026-06-13 -->

---

### UAT-STATIC-006: fsPromises import is removed from backend/state.ts

- **Description**: `import * as fsPromises from 'fs/promises'` was only used by the now-deleted `writeQueue` function. It must have been removed from `backend/state.ts` to keep the file clean of unused imports.
- **Steps**:
  1. Run the grep command below.
- **Command**:
  ```bash
  grep -n "fsPromises\|fs/promises" backend/state.ts
  ```
- **Expected Result**: No output (exit code 1). Zero occurrences of `fsPromises` or `fs/promises` in `backend/state.ts`.
- [x] Pass <!-- 2026-06-13 -->

---

### UAT-STATIC-007: config.ts import in backend/index.ts does not include appendAgentToConf or removeAgentFromConf

- **Description**: The two deleted conf-splice functions must not appear in the import from `./config.ts`. The live BG-process helpers (`appendBgProcessToConf`, `removeBgProcessFromConf`, `addBgLink`, `removeBgLink`) must still be present.
- **Steps**:
  1. Run the grep command below.
- **Command**:
  ```bash
  grep -n "from './config" backend/index.ts
  ```
- **Expected Result**: One matching line. The import must **not** contain `appendAgentToConf` or `removeAgentFromConf`. It must still contain `appendBgProcessToConf`, `removeBgProcessFromConf`, `addBgLink`, `removeBgLink`, `readConductorConf`, `DEFAULT_CONF_PATH`, `clearConfCache`.
- [x] Pass <!-- 2026-06-13 -->

---

### UAT-STATIC-008: BG-process conf-splice helpers are still present in backend/config.ts

- **Description**: `appendBgProcessToConf`, `removeBgProcessFromConf`, `addBgLink`, and `removeBgLink` were deliberately kept because the live `/bg-processes` routes still call them. They must not have been accidentally deleted.
- **Steps**:
  1. Run the grep command below.
- **Command**:
  ```bash
  grep -n "export.*function appendBgProcessToConf\|export.*function removeBgProcessFromConf\|export.*function addBgLink\|export.*function removeBgLink" backend/config.ts
  ```
- **Expected Result**: Exactly four matching lines — one for each of the four kept BG-process helper exports.
- [x] Pass <!-- 2026-06-13 -->

---

### UAT-API-001: GET /status response includes a numeric queuedTasks field (DB-backed)

- **Description**: `GET /status` builds agent status by calling `listTasksForAgent(db, agent.name).length`. The `queuedTasks` field in each agent entry must be a non-negative integer, confirming the caller was migrated off the deleted `countQueuedTasks` file-queue helper to the DB.
- **Steps**:
  1. Ensure the backend is running on port 8788.
  2. Run the curl command below.
- **Command**:
  ```bash
  curl -sS 'http://localhost:8788/status' | jq '[.agents[] | {name, queuedTasks, state}]'
  ```
- **Expected Result**: HTTP 200. The response is a JSON object with an `agents` array. Each element has a `queuedTasks` field whose value is a non-negative integer (not `null`, not a string, not missing). The field is present even when no tasks are queued (value `0`).
- [x] Pass <!-- 2026-06-13 -->

---

### UAT-API-002: POST /queue/:agent returns 404 (route deleted)

- **Description**: The legacy `POST /queue/:agent` flat-file write route must be gone. Fastify returns a 404 JSON error when no route is registered for that method+path.
- **Steps**:
  1. Ensure the backend is running on port 8788.
  2. Run the curl command below (substitute any agent name — even a nonexistent one; the route must not exist at all).
- **Command**:
  ```bash
  curl -sS -o /dev/null -w '%{http_code}' -X POST 'http://localhost:8788/queue/alpha' -H 'Content-Type: application/json' -d '{"task":"test"}'
  ```
- **Expected Result**: HTTP status code `404`. The route is not registered; Fastify's default not-found handler responds.
- [x] Pass <!-- 2026-06-13 -->

---

### UAT-API-003: PUT /queue/:agent/reorder returns 404 (route deleted)

- **Description**: The legacy `PUT /queue/:agent/reorder` route must be gone.
- **Steps**:
  1. Ensure the backend is running on port 8788.
  2. Run the curl command below.
- **Command**:
  ```bash
  curl -sS -o /dev/null -w '%{http_code}' -X PUT 'http://localhost:8788/queue/alpha/reorder' -H 'Content-Type: application/json' -d '{"order":[]}'
  ```
- **Expected Result**: HTTP status code `404`.
- [x] Pass <!-- 2026-06-13 -->

---

### UAT-API-004: DELETE /queue/:agent/:index returns 404 (route deleted)

- **Description**: The legacy `DELETE /queue/:agent/:index` route must be gone.
- **Steps**:
  1. Ensure the backend is running on port 8788.
  2. Run the curl command below.
- **Command**:
  ```bash
  curl -sS -o /dev/null -w '%{http_code}' -X DELETE 'http://localhost:8788/queue/alpha/0'
  ```
- **Expected Result**: HTTP status code `404`.
- [x] Pass <!-- 2026-06-13 -->

---

### UAT-API-005: GET /queue/:agent still returns a task list (DB-backed, route kept)

- **Description**: `GET /queue/:agent` was kept because it is already DB-backed via `listTasksForAgent`. It must continue to respond successfully, returning an object with `agent` and `tasks` fields.
- **Steps**:
  1. Ensure the backend is running on port 8788.
  2. Run the curl command below (substitute an agent name that exists in the DB, or use any name to confirm the response shape — the route delegates to `listTasksForAgent` which returns an empty array for unknown agents).
- **Command**:
  ```bash
  curl -sS 'http://localhost:8788/queue/alpha' | jq '{agent, taskCount: (.tasks | length)}'
  ```
- **Expected Result**: HTTP 200. Response contains `agent` (the queried name) and `tasks` (an array — may be empty). The `tasks` entries are Task objects (with `id`, `command`, `status` fields), not raw strings, confirming DB backing.
- [x] Pass <!-- 2026-06-13 -->

---

### UAT-EDGE-001: writeChain module-level variable is also absent from backend/state.ts

- **Description**: `let writeChain = Promise.resolve()` was a module-level variable used only by `writeQueue`. It must have been deleted together with `writeQueue`.
- **Steps**:
  1. Run the grep command below.
- **Command**:
  ```bash
  grep -n "writeChain\|Serialize concurrent writes" backend/state.ts
  ```
- **Expected Result**: No output (exit code 1). Neither the variable declaration nor its associated comment exists in `backend/state.ts`.
- [x] Pass <!-- 2026-06-13 -->

---

### UAT-EDGE-002: Live BG-process routes still function (no accidental deletion of their helpers)

- **Description**: The `/bg-processes` routes call `appendBgProcessToConf` / `removeBgProcessFromConf` / `addBgLink` / `removeBgLink`. A regression here would mean the wrong functions were deleted.
- **Steps**:
  1. Ensure the backend is running on port 8788.
  2. Run the curl command below.
- **Command**:
  ```bash
  curl -sS 'http://localhost:8788/status' | jq '{sessionExists, bgProcessCount: (.bgProcesses | length)}'
  ```
- **Expected Result**: HTTP 200. Response contains `sessionExists` (boolean) and `bgProcesses` (array — may be empty). No 500 error, which would indicate the conf-splice helpers were accidentally deleted and the route crashed on import.
- [x] Pass <!-- 2026-06-13 -->
