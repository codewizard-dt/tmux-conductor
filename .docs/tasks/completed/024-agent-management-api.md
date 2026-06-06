# 024 — Agent Management API

> **Depends on**: [022-fastify-status-server](022-fastify-status-server.md)
> **Blocks**: none
> **Parallel-safe with**: [023-task-queue-crud-api](023-task-queue-crud-api.md)

## Objective

Add `POST /agents` to the Fastify server: accepts a new agent name + working directory, appends the entry to the `AGENTS=(...)` array in `conductor.conf`, and spawns a new tmux window into the live session.

## Approach

Editing a shell config file is inherently fragile with regex — instead, parse the `AGENTS=(` block line-by-line, find the closing `)`, and insert the new entry on the preceding line. The tmux spawn uses `child_process.execSync` to call `tmux new-window`. If no session is running, the endpoint returns a 409 with `sessionAlive: false`.

---

## Steps

### 1. Add conf writer to `scripts/dashboard/server/config.js`  <!-- agent: general-purpose -->

- [x] Export `appendAgentToConf(confPath, name, workdir, launchCmd)`:
  - Reads `confPath` as text
  - Finds the `AGENTS=(` block and its closing `)` by scanning lines
  - Inserts `  "<name>:<workdir>:<launchCmd>"` before the closing `)`
  - Writes the file back using `fs.writeFile` (no `sed`)
  - Throws if `AGENTS=(` block not found

### 2. Register `POST /agents` in `scripts/dashboard/server/index.js`  <!-- agent: general-purpose -->

- [x] Body schema: `{ "name": "string", "workdir": "string", "launchCmd"?: "string" }`
  - `launchCmd` defaults to `"claude --dangerously-skip-permissions"` if omitted
- [x] Validate: `name` must match `^[a-z0-9_-]+$`; `workdir` must be an absolute path (starts with `/`)
- [x] Check session alive: `tmux has-session -t <sessionName>` — if not found, return 409 `{ "error": "session not running", "sessionAlive": false }`
- [x] Call `appendAgentToConf(confPath, name, workdir, launchCmd)`
- [x] Spawn the tmux window:
  ```bash
  tmux new-window -t <SESSION_NAME> -n <name> -c <workdir>
  tmux send-keys -t <SESSION_NAME>:<name> "CONDUCTOR_AGENT_NAME='<name>' CONDUCTOR_STATE_DIR='<stateDir>' <launchCmd>" Enter
  ```
- [x] Return 201 `{ "ok": true, "agent": { "name", "workdir", "launchCmd" } }`
- [x] 400 on validation failures
- [x] 409 if a window named `<name>` already exists in the session

### 3. Verification  <!-- agent: general-purpose -->

- [x] With no tmux session: `POST /agents` with valid body → 409
- [x] Start a tmux session (`tmux new-session -d -s conductor`)
- [x] `POST /agents {"name":"test-agent","workdir":"/tmp"}` → 201, new window `test-agent` appears in session
- [x] `conductor.conf` now contains the new `test-agent` entry in `AGENTS=(...)`
- [x] Second `POST` with same name → 409
- [x] Clean up: `tmux kill-window -t conductor:test-agent`, remove test entry from conductor.conf

---
**UAT**: [`.docs/uat/pending/024-agent-management-api.uat.md`](../uat/pending/024-agent-management-api.uat.md)
