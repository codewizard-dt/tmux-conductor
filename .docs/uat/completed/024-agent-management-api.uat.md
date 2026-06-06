# UAT: Agent Management API

> **Source task**: [`.docs/tasks/completed/024-agent-management-api.md`](../../tasks/completed/024-agent-management-api.md)
> **Generated**: 2026-06-06

---

## Prerequisites

- [ ] Dashboard server is **not** running yet (tests control startup order)
- [ ] `conductor.conf` is present at the repo root with a valid `AGENTS=(...)` block
- [ ] `./tmp/uat-024/` directory exists: `mkdir -p ./tmp/uat-024`
- [ ] Make a backup of `conductor.conf` before running tests: `cp conductor.conf ./tmp/uat-024/conductor.conf.bak`
- [ ] No tmux session named `conductor` is running at test start (kill one if present: `tmux kill-session -t conductor`)

---

## Static Check Tests

### UAT-STATIC-001: `node --check` passes on server entry point
- **Description**: Verify `scripts/dashboard/server/index.js` has no syntax errors.
- **Steps**:
  1. Run the command below from the repo root.
- **Command**:
  ```bash
  node --check scripts/dashboard/server/index.js
  ```
- **Expected Result**: Exit code 0, no output (silent success). Any syntax error causes a non-zero exit and a descriptive message.
- [x] Pass <!-- 2026-06-06 -->

### UAT-STATIC-002: `node --check` passes on config module
- **Description**: Verify `scripts/dashboard/server/config.js` has no syntax errors.
- **Steps**:
  1. Run the command below from the repo root.
- **Command**:
  ```bash
  node --check scripts/dashboard/server/config.js
  ```
- **Expected Result**: Exit code 0, no output.
- [x] Pass <!-- 2026-06-06 -->

---

## API Tests

> For all API tests the server must be running. Start it once after completing the Static tests:
> ```bash
> node scripts/dashboard/server/index.js &
> ```
> Note the PID (`echo $!`) so you can stop it when done. The server listens on `http://127.0.0.1:8788`.

### UAT-API-001: POST /agents with no tmux session returns 409
- **Endpoint**: `POST /agents`
- **Description**: Verify that when no tmux session named `conductor` is running the endpoint returns 409 with `sessionAlive: false`. (No tmux session is running per prerequisites.)
- **Steps**:
  1. Confirm no `conductor` session exists: `tmux ls 2>&1 | grep conductor` should return nothing.
  2. Start the server if not already running (see note above).
  3. Run the curl command below.
- **Command**:
  ```bash
  curl -sS -X POST 'http://127.0.0.1:8788/agents' -H 'Content-Type: application/json' -d '{"name":"test-agent","workdir":"/tmp"}'
  ```
- **Expected Result**: HTTP `409 Conflict` with body `{"error":"session not running","sessionAlive":false}`.
- [x] Pass <!-- 2026-06-06 -->

### UAT-API-002: POST /agents with valid body creates window and returns 201
- **Endpoint**: `POST /agents`
- **Description**: With a live session running, a valid request creates a new tmux window and appends the entry to `conductor.conf`, returning 201.
- **Steps**:
  1. Start a tmux session: `tmux new-session -d -s conductor`
  2. Run the curl command below.
  3. Verify the window appeared: `tmux list-windows -t conductor | grep test-agent` should produce output.
  4. Verify `conductor.conf` now contains the new entry: `grep 'test-agent' conductor.conf` should show `"test-agent:/tmp/uat-024:claude --dangerously-skip-permissions"` (or similar).
- **Command**:
  ```bash
  curl -sS -X POST 'http://127.0.0.1:8788/agents' -H 'Content-Type: application/json' -d '{"name":"test-agent","workdir":"/tmp/uat-024","launchCmd":"echo hello"}'
  ```
- **Expected Result**: HTTP `201 Created` with body `{"ok":true,"agent":{"name":"test-agent","workdir":"/tmp/uat-024","launchCmd":"echo hello"}}`. New window `test-agent` is visible in the `conductor` session. `conductor.conf` AGENTS block contains `"test-agent:/tmp/uat-024:echo hello"`.
- [x] Pass <!-- 2026-06-06 -->

### UAT-API-003: POST /agents with default launchCmd
- **Endpoint**: `POST /agents`
- **Description**: When `launchCmd` is omitted the server defaults to `"claude --dangerously-skip-permissions"` and echoes it back in the response.
- **Steps**:
  1. The `conductor` session must still be running from UAT-API-002.
  2. Run the curl command below.
  3. Verify the response body contains `"launchCmd":"claude --dangerously-skip-permissions"`.
- **Command**:
  ```bash
  curl -sS -X POST 'http://127.0.0.1:8788/agents' -H 'Content-Type: application/json' -d '{"name":"default-cmd-agent","workdir":"/tmp/uat-024"}'
  ```
- **Expected Result**: HTTP `201 Created` with body `{"ok":true,"agent":{"name":"default-cmd-agent","workdir":"/tmp/uat-024","launchCmd":"claude --dangerously-skip-permissions"}}`.
- [x] Pass <!-- 2026-06-06 -->

### UAT-API-004: POST /agents with duplicate name returns 409
- **Endpoint**: `POST /agents`
- **Description**: Attempting to create a second agent with the same name as an already-running window returns 409.
- **Steps**:
  1. `test-agent` window was created in UAT-API-002; the `conductor` session must still be running.
  2. Run the curl command below (same name, different workdir).
- **Command**:
  ```bash
  curl -sS -X POST 'http://127.0.0.1:8788/agents' -H 'Content-Type: application/json' -d '{"name":"test-agent","workdir":"/usr/local"}'
  ```
- **Expected Result**: HTTP `409 Conflict` with body `{"error":"window already exists"}`.
- [x] Pass <!-- 2026-06-06 -->

### UAT-API-005: POST /agents with invalid name returns 400
- **Endpoint**: `POST /agents`
- **Description**: A name containing characters outside `[a-z0-9_-]` is rejected with 400.
- **Steps**:
  1. Run the curl command below (name contains uppercase and a space).
- **Command**:
  ```bash
  curl -sS -X POST 'http://127.0.0.1:8788/agents' -H 'Content-Type: application/json' -d '{"name":"Bad Agent!","workdir":"/tmp/uat-024"}'
  ```
- **Expected Result**: HTTP `400 Bad Request` with body `{"error":"name is required and must match ^[a-z0-9_-]+$"}`.
- [x] Pass <!-- 2026-06-06 -->

### UAT-API-006: POST /agents with missing name returns 400
- **Endpoint**: `POST /agents`
- **Description**: Omitting `name` entirely is treated as a validation failure.
- **Steps**:
  1. Run the curl command below.
- **Command**:
  ```bash
  curl -sS -X POST 'http://127.0.0.1:8788/agents' -H 'Content-Type: application/json' -d '{"workdir":"/tmp/uat-024"}'
  ```
- **Expected Result**: HTTP `400 Bad Request` with body `{"error":"name is required and must match ^[a-z0-9_-]+$"}`.
- [x] Pass <!-- 2026-06-06 -->

### UAT-API-007: POST /agents with relative workdir returns 400
- **Endpoint**: `POST /agents`
- **Description**: A `workdir` that does not start with `/` is rejected.
- **Steps**:
  1. Run the curl command below.
- **Command**:
  ```bash
  curl -sS -X POST 'http://127.0.0.1:8788/agents' -H 'Content-Type: application/json' -d '{"name":"rel-agent","workdir":"relative/path"}'
  ```
- **Expected Result**: HTTP `400 Bad Request` with body `{"error":"workdir is required and must be an absolute path (starts with /)"}`.
- [x] Pass <!-- 2026-06-06 -->

### UAT-API-008: POST /agents with missing workdir returns 400
- **Endpoint**: `POST /agents`
- **Description**: Omitting `workdir` entirely is treated as a validation failure.
- **Steps**:
  1. Run the curl command below.
- **Command**:
  ```bash
  curl -sS -X POST 'http://127.0.0.1:8788/agents' -H 'Content-Type: application/json' -d '{"name":"no-workdir-agent"}'
  ```
- **Expected Result**: HTTP `400 Bad Request` with body `{"error":"workdir is required and must be an absolute path (starts with /)"}`.
- [x] Pass <!-- 2026-06-06 -->

---

## Cleanup

After all tests pass, restore `conductor.conf` and kill the test session:

```bash
cp ./tmp/uat-024/conductor.conf.bak conductor.conf
tmux kill-session -t conductor
```

Also stop the dashboard server (use the PID captured at startup, or `pkill -f 'node scripts/dashboard/server/index.js'`).
