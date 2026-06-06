# UAT: Task Queue CRUD API

> **Source task**: [`.docs/tasks/completed/023-task-queue-crud-api.md`](../../tasks/completed/023-task-queue-crud-api.md)
> **Generated**: 2026-06-06

---

## Prerequisites

- [ ] Working directory is the repo root: `/Users/davidtaylor/Repositories/tmux-conductor`
- [ ] Task 022 (Fastify status server) is complete — `scripts/dashboard/server/index.js` exists and `node_modules` are installed
- [ ] Create test fixtures directory: `mkdir -p ./tmp/uat-023`
- [ ] `node --version` outputs v18 or higher

---

## Syntax & Static Checks

### UAT-STATIC-001: server/state.js passes `node --check`
- **Description**: The updated `state.js` must parse without errors
- **Steps**:
  1. Run the command below from the repo root
- **Command**:
  ```bash
  node --check scripts/dashboard/server/state.js && echo "state.js OK"
  ```
- **Expected Result**: Prints `state.js OK` with no errors
- [x] Pass <!-- 2026-06-06 -->

### UAT-STATIC-002: server/index.js passes `node --check`
- **Description**: The updated `index.js` with queue routes must parse without errors
- **Steps**:
  1. Run the command below from the repo root
- **Command**:
  ```bash
  node --check scripts/dashboard/server/index.js && echo "index.js OK"
  ```
- **Expected Result**: Prints `index.js OK` with no errors
- [x] Pass <!-- 2026-06-06 -->

### UAT-STATIC-003: `readQueue` and `writeQueue` are exported from state.js
- **Description**: Both helper functions must be present as named exports
- **Steps**:
  1. Run the command below
- **Command**:
  ```bash
  grep -n 'export function readQueue\|export function writeQueue\|export.*readQueue\|export.*writeQueue' scripts/dashboard/server/state.js
  ```
- **Expected Result**: At least two matching lines — one for `readQueue` and one for `writeQueue`
- [x] Pass <!-- 2026-06-06 -->

### UAT-STATIC-004: `getAgentLines` is exported from state.js
- **Description**: The scoped-line resolver must be present as a named export
- **Steps**:
  1. Run the command below
- **Command**:
  ```bash
  grep -n 'export function getAgentLines\|export.*getAgentLines' scripts/dashboard/server/state.js
  ```
- **Expected Result**: At least one matching line
- [x] Pass <!-- 2026-06-06 -->

### UAT-STATIC-005: writeQueue uses a Promise chain mutex
- **Description**: Concurrent writes must be serialised via a `writeChain` variable (not `fs.writeFileSync`)
- **Steps**:
  1. Run the command below
- **Command**:
  ```bash
  grep -n 'writeChain' scripts/dashboard/server/state.js
  ```
- **Expected Result**: At least two lines — the `let writeChain = Promise.resolve()` initialisation and the `writeChain = writeChain.then(...)` assignment
- [x] Pass <!-- 2026-06-06 -->

### UAT-STATIC-006: All four queue routes are registered in index.js
- **Description**: `POST /queue`, `GET /queue`, `PUT /queue`, and `DELETE /queue` route registrations must be present
- **Steps**:
  1. Run the command below
- **Command**:
  ```bash
  grep -n "'/queue/" scripts/dashboard/server/index.js
  ```
- **Expected Result**: At least four lines — one for each of `POST`, `GET`, `PUT` (reorder), and `DELETE`
- [x] Pass <!-- 2026-06-06 -->

---

## Unit-level helper tests (no server required)

These tests exercise `state.js` helpers directly via Node one-liners.

### UAT-UNIT-001: `readQueue` returns empty array for missing file
- **Description**: `readQueue` must return `[]` when the target file does not exist
- **Steps**:
  1. Run the command below
- **Command**:
  ```bash
  node --input-type=module <<'EOF'
  import { readQueue } from './scripts/dashboard/server/state.js';
  const result = await readQueue('./tmp/uat-023/nonexistent-tasks.txt');
  console.assert(Array.isArray(result) && result.length === 0, 'expected []');
  console.log('readQueue missing file: OK');
  EOF
  ```
- **Expected Result**: Prints `readQueue missing file: OK`
- [x] Pass <!-- 2026-06-06 -->

### UAT-UNIT-002: `readQueue` parses non-empty file correctly
- **Description**: `readQueue` must split on newlines, filter blank lines, and return the trimmed array
- **Steps**:
  1. Run the command below
- **Command**:
  ```bash
  printf 'alpha: do thing\nbeta: other task\n\nglobal task\n' > ./tmp/uat-023/tasks.txt
  node --input-type=module <<'EOF'
  import { readQueue } from './scripts/dashboard/server/state.js';
  const result = await readQueue('./tmp/uat-023/tasks.txt');
  console.assert(result.length === 3, `expected 3 lines, got ${result.length}`);
  console.log('readQueue parse: OK');
  EOF
  ```
- **Expected Result**: Prints `readQueue parse: OK`
- [x] Pass <!-- 2026-06-06 -->

### UAT-UNIT-003: `getAgentLines` returns scoped and global lines, not foreign-scoped lines
- **Description**: For agent `alpha`, scoped lines (`alpha: ...`) and global lines (no `: ` prefix) must be returned; lines for `beta` must be excluded
- **Steps**:
  1. Run the command below (reuses `./tmp/uat-023/tasks.txt` from UAT-UNIT-002)
- **Command**:
  ```bash
  node --input-type=module <<'EOF'
  import { readQueue, getAgentLines } from './scripts/dashboard/server/state.js';
  const lines = await readQueue('./tmp/uat-023/tasks.txt');
  const { tasks } = getAgentLines(lines, 'alpha');
  console.assert(tasks.length === 2, `expected 2 tasks for alpha, got ${tasks.length}: ${JSON.stringify(tasks)}`);
  console.assert(tasks.includes('do thing'), 'missing scoped task');
  console.assert(tasks.includes('global task'), 'missing global task');
  console.log('getAgentLines scoping: OK');
  EOF
  ```
- **Expected Result**: Prints `getAgentLines scoping: OK`
- [x] Pass <!-- 2026-06-06 -->

### UAT-UNIT-004: `writeQueue` persists lines to disk
- **Description**: Writing an array of lines must produce a file with one line per entry and a trailing newline
- **Steps**:
  1. Run the command below
- **Command**:
  ```bash
  node --input-type=module <<'EOF'
  import { writeQueue, readQueue } from './scripts/dashboard/server/state.js';
  const path = './tmp/uat-023/write-test.txt';
  await writeQueue(path, ['alpha: task one', 'beta: task two']);
  const back = await readQueue(path);
  console.assert(back.length === 2, `expected 2 lines, got ${back.length}`);
  console.assert(back[0] === 'alpha: task one', `unexpected line: ${back[0]}`);
  console.log('writeQueue round-trip: OK');
  EOF
  ```
- **Expected Result**: Prints `writeQueue round-trip: OK`
- [x] Pass <!-- 2026-06-06 -->

---

## HTTP API Tests (live server)

Start the server once for the section below, and stop it after UAT-HTTP-007.

**Start server (run in a separate terminal or background):**
```bash
cp ./tmp/uat-023/tasks.txt ./tmp/uat-023/api-tasks.txt 2>/dev/null || true
CONDUCTOR_CONF=./conductor.conf TASK_QUEUE=./tmp/uat-023/api-tasks.txt BACKEND_PORT=8799 node scripts/dashboard/server/index.js &
SERVER_PID=$!
sleep 1   # allow Fastify to bind
```

> Replace `TASK_QUEUE=./tmp/uat-023/api-tasks.txt` with the env var name your implementation exposes for overriding the queue path. Adjust if the implementation reads `TASK_QUEUE` from `conductor.conf` only — in that case point `conductor.conf` at a temp file for isolation.

### UAT-HTTP-001: GET /healthz still responds after queue routes are added
- **Description**: Adding queue routes must not break the existing healthz endpoint
- **Steps**:
  1. Ensure server is running (see section header)
  2. Run the command below
- **Command**:
  ```bash
  curl -s http://127.0.0.1:8799/healthz
  ```
- **Expected Result**: `{"ok":true}`
- [x] Pass <!-- 2026-06-06 -->

### UAT-HTTP-002: POST /queue/:agent appends a scoped line to tasks.txt
- **Description**: A valid POST must write `<agent>: <task>` to the queue file and return `{ ok: true, line: "..." }`
- **Steps**:
  1. Ensure `./tmp/uat-023/api-tasks.txt` is empty or absent before this test
  2. Run the command below
- **Command**:
  ```bash
  curl -s -X POST http://127.0.0.1:8799/queue/jobfinder \
    -H 'Content-Type: application/json' \
    -d '{"task":"do the thing"}'
  ```
- **Expected Result**: JSON response containing `"ok":true` and `"line":"jobfinder: do the thing"`
- [x] Pass <!-- 2026-06-06 -->

### UAT-HTTP-003: POST /queue/:agent wrote the correct line to disk
- **Description**: The queue file on disk must contain the appended scoped line after UAT-HTTP-002
- **Steps**:
  1. Run the command below immediately after UAT-HTTP-002
- **Command**:
  ```bash
  grep 'jobfinder: do the thing' ./tmp/uat-023/api-tasks.txt && echo "line present on disk"
  ```
- **Expected Result**: Prints `line present on disk` (grep finds the line)
- [x] Pass <!-- 2026-06-06 -->

### UAT-HTTP-004: GET /queue/:agent returns the queued tasks
- **Description**: GET must return the task just appended by UAT-HTTP-002, without the `agentname: ` prefix
- **Steps**:
  1. Run the command below
- **Command**:
  ```bash
  curl -s http://127.0.0.1:8799/queue/jobfinder
  ```
- **Expected Result**: JSON with `"agent":"jobfinder"` and `"tasks":["do the thing"]`
- [x] Pass <!-- 2026-06-06 -->

### UAT-HTTP-005: GET /queue/:agent returns empty array for agent with no tasks
- **Description**: An agent with no scoped or global entries must return an empty `tasks` array (200, not 404)
- **Steps**:
  1. Run the command below
- **Command**:
  ```bash
  curl -s http://127.0.0.1:8799/queue/nonexistent-agent
  ```
- **Expected Result**: `{"agent":"nonexistent-agent","tasks":[]}` — HTTP 200
- [x] Pass <!-- 2026-06-06 -->

### UAT-HTTP-006: DELETE /queue/:agent/:index removes the task
- **Description**: DELETE at index 0 for `jobfinder` must remove the task added in UAT-HTTP-002
- **Steps**:
  1. Run the command below
- **Command**:
  ```bash
  curl -s -X DELETE http://127.0.0.1:8799/queue/jobfinder/0
  ```
- **Expected Result**: `{"ok":true}`
- [x] Pass <!-- 2026-06-06 -->

### UAT-HTTP-007: GET /queue/:agent returns empty array after DELETE
- **Description**: After deletion, the agent's task list must be empty
- **Steps**:
  1. Run the command below immediately after UAT-HTTP-006
- **Command**:
  ```bash
  curl -s http://127.0.0.1:8799/queue/jobfinder
  ```
- **Expected Result**: `{"agent":"jobfinder","tasks":[]}`
- [x] Pass <!-- 2026-06-06 -->

---

## Validation / Error Tests

### UAT-ERR-001: POST /queue/:agent with missing task field returns 400
- **Description**: Body without a `task` key must be rejected with HTTP 400
- **Steps**:
  1. Run the command below
- **Command**:
  ```bash
  curl -s -o /dev/null -w "%{http_code}" -X POST http://127.0.0.1:8799/queue/jobfinder \
    -H 'Content-Type: application/json' \
    -d '{}'
  ```
- **Expected Result**: `400`
- [x] Pass <!-- 2026-06-06 -->

### UAT-ERR-002: POST /queue/:agent with empty task string returns 400
- **Description**: A `task` value of `""` (empty string) must be rejected with HTTP 400
- **Steps**:
  1. Run the command below
- **Command**:
  ```bash
  curl -s -o /dev/null -w "%{http_code}" -X POST http://127.0.0.1:8799/queue/jobfinder \
    -H 'Content-Type: application/json' \
    -d '{"task":""}'
  ```
- **Expected Result**: `400`
- [x] Pass <!-- 2026-06-06 -->

### UAT-ERR-003: DELETE /queue/:agent/:index with out-of-range index returns 404
- **Description**: Deleting index 99 when the agent has 0 tasks must return HTTP 404
- **Steps**:
  1. Confirm jobfinder queue is empty (from UAT-HTTP-007), then run:
- **Command**:
  ```bash
  curl -s -o /dev/null -w "%{http_code}" -X DELETE http://127.0.0.1:8799/queue/jobfinder/99
  ```
- **Expected Result**: `404`
- [x] Pass <!-- 2026-06-06 -->

### UAT-ERR-004: PUT /queue/:agent/reorder with wrong index count returns 400
- **Description**: A reorder payload with more or fewer indices than the agent's current task count must be rejected with HTTP 400
- **Steps**:
  1. Seed two tasks for jobfinder:
     ```bash
     curl -s -X POST http://127.0.0.1:8799/queue/jobfinder -H 'Content-Type: application/json' -d '{"task":"first"}'
     curl -s -X POST http://127.0.0.1:8799/queue/jobfinder -H 'Content-Type: application/json' -d '{"task":"second"}'
     ```
  2. Send a reorder with the wrong number of indices (3 instead of 2):
- **Command**:
  ```bash
  curl -s -o /dev/null -w "%{http_code}" -X PUT http://127.0.0.1:8799/queue/jobfinder/reorder \
    -H 'Content-Type: application/json' \
    -d '{"order":[2,0,1]}'
  ```
- **Expected Result**: `400`
- [x] Pass <!-- 2026-06-06 -->

### UAT-ERR-005: PUT /queue/:agent/reorder with correct indices succeeds
- **Description**: A valid reorder (same indices, different order) must return 200 and reorder the tasks on disk
- **Steps**:
  1. Continue from UAT-ERR-004 (jobfinder has tasks `["first","second"]` at indices 0 and 1)
  2. Send a reorder swapping them:
- **Command**:
  ```bash
  curl -s -X PUT http://127.0.0.1:8799/queue/jobfinder/reorder \
    -H 'Content-Type: application/json' \
    -d '{"order":[1,0]}'
  ```
- **Expected Result**: `{"ok":true}` — HTTP 200; a subsequent `GET /queue/jobfinder` returns `["second","first"]`
- [x] Pass <!-- 2026-06-06 -->

---

## Concurrency Test

### UAT-CONC-001: Concurrent POST requests do not corrupt tasks.txt
- **Description**: Two simultaneous POST requests must each append their line without either being lost or the file being truncated
- **Steps**:
  1. Ensure the queue starts empty (or note current line count)
  2. Run the command below
- **Command**:
  ```bash
  curl -s -X POST http://127.0.0.1:8799/queue/agent-a \
    -H 'Content-Type: application/json' \
    -d '{"task":"concurrent-A"}' &
  curl -s -X POST http://127.0.0.1:8799/queue/agent-b \
    -H 'Content-Type: application/json' \
    -d '{"task":"concurrent-B"}' &
  wait
  grep -c 'concurrent-' ./tmp/uat-023/api-tasks.txt
  ```
- **Expected Result**: Both requests return `{"ok":true}` and the final grep count is `2` — both lines are present, no corruption
- [FAIL: auto-judge: manual test requires human verification — concurrency test with shell job control (&, wait) cannot be expressed as a single curl call] <!-- 2026-06-06 -->

---

## Cleanup

After all tests, stop the background server if still running:
```bash
kill $SERVER_PID 2>/dev/null || true
```
