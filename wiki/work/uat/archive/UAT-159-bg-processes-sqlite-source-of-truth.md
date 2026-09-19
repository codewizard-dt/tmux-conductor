---
id: UAT-159
aliases: [UAT-159]
title: "UAT: Make SQLite the sole source of truth for bg-process definitions and links"
status: passed
task: TASK-159
created: 2026-09-13
updated: 2026-09-13
---

# UAT-159 — UAT: Make SQLite the sole source of truth for bg-process definitions and links

implements::[[TASK-159]]

> **Source task**: [[TASK-159]]
> **Generated**: 2026-09-13

---

## Prerequisites

- [ ] `host-server` is running and reachable at `http://127.0.0.1:8788` (the repo's `BACKEND_PORT` default), e.g. via `make dev` or `npm run dev`
- [ ] A tmux session matching `conductor.conf`'s `SESSION_NAME` (default `conductor`) is alive — check with `tmux has-session -t conductor`
- [ ] `sqlite3` CLI is available to inspect `./data/conductor.db` directly
- [ ] At least one agent exists in the DB (`GET /api/agents` returns a non-empty array) to use as the `linkedAgent` in UAT-API-002 — capture its `name` field before running that test
- [ ] No bg process named `uat159probe` or `uat159probe2` already exists (these tests create and delete them) — `curl -sS http://127.0.0.1:8788/api/status | jq '.bgProcesses'` should not list them beforehand

---

## Test Cases

### UAT-API-001: POST /bg-processes writes the definition to SQLite, not conductor.conf
- **Endpoint**: `POST /api/bg-processes`
- **Description**: Verifies the TASK-159 rewire — creating a bg process via the dashboard/API route persists it through `createBgProcess(db, ...)` (SQLite) instead of `appendBgProcessToConf` (the old conf writer, now deleted). This is the core split-brain fix: `scripts/lib/db.sh`'s `load_bg()` (used by `conductor.sh`/`spawn.sh`) only ever read SQLite, so a conf-only write was invisible to it.
- **Steps**:
  1. Confirm `conductor.conf`'s `BG_PROCESSES=( )` block is empty (or note its current contents) before running the command.
  2. Run the curl command below as-is.
  3. Confirm the response is `201` with `ok: true` and the echoed `bg` object.
  4. Run `sqlite3 ./data/conductor.db "SELECT name, workdir, launch_cmd, linked_agent_id FROM bg_processes WHERE name='uat159probe';"` — expect exactly one row: `uat159probe|/Users/davidtaylor/Repositories/tmux-conductor|sleep 300|` (empty/NULL `linked_agent_id`).
  5. Re-open `conductor.conf` and confirm its `BG_PROCESSES=( )` block is **byte-for-byte unchanged** from step 1 — proves the route no longer writes the conf file.
- **Command**:
  ```bash
  curl -sS -X POST 'http://127.0.0.1:8788/api/bg-processes' -H 'Content-Type: application/json' -d '{"name":"uat159probe","workdir":"/Users/davidtaylor/Repositories/tmux-conductor","launchCmd":"sleep 300"}'
  ```
- **Expected Result**: `HTTP 201`, body `{"ok":true,"bg":{"name":"uat159probe","workdir":"/Users/davidtaylor/Repositories/tmux-conductor","launchCmd":"sleep 300","linkedAgent":null}}`. SQLite gains the row; `conductor.conf` is untouched. A tmux window named `uat159probe` is created in the session (verify with `tmux list-windows -t conductor | grep uat159probe`).
- **Repeatable Unit Test**: Not applicable: no Fastify route-test harness exists in this repo (per TASK-159's Approach notes, which explicitly avoid introducing one) — this route's behavior can only be exercised live. DB-layer persistence for `createBgProcess` is already covered by `host-server/db.test.ts`'s `'TASK-159: createBgProcess, listBgProcesses, deleteBgProcess provide full CRUD...'` test (lines 105-145).
- [x] Pass <!-- 2026-09-13 -->

### UAT-API-002: POST /bg-processes resolves linkedAgent name to the numeric FK
- **Endpoint**: `POST /api/bg-processes`
- **Description**: Verifies `linkedAgent` (an agent *name* in the request) resolves via `listAgents(db).find(a => a.name === linkedAgent)` and is persisted as `linked_agent_id` (numeric FK) on the `bg_processes` row — the link write path that used to go through `addBgLink`/conf.
- **Steps**:
  1. Get a live agent name: `curl -sS http://127.0.0.1:8788/api/agents | jq -r '.[0].name'` — substitute it for `<AGENT_NAME>` below.
  2. Run the curl command below (with `<AGENT_NAME>` substituted).
  3. Confirm the response `bg.linkedAgent` echoes `<AGENT_NAME>`.
  4. Run `sqlite3 ./data/conductor.db "SELECT b.linked_agent_id, a.name FROM bg_processes b JOIN agents a ON a.id = b.linked_agent_id WHERE b.name='uat159probe2';"` — expect one row whose `name` matches `<AGENT_NAME>`.
  5. Clean up: `curl -sS -X DELETE http://127.0.0.1:8788/api/bg-processes/uat159probe2`.
- **Command**:
  ```bash
  curl -sS -X POST 'http://127.0.0.1:8788/api/bg-processes' -H 'Content-Type: application/json' -d '{"name":"uat159probe2","workdir":"/Users/davidtaylor/Repositories/tmux-conductor","launchCmd":"sleep 300","linkedAgent":"<AGENT_NAME>"}'
  ```
- **Expected Result**: `HTTP 201`, body's `bg.linkedAgent` equals `<AGENT_NAME>`; the SQLite row's `linked_agent_id` is that agent's numeric `id`.
- **Repeatable Unit Test**: Not applicable: no Fastify route-test harness exists in this repo. The underlying `createBgProcess(db, { linkedAgentId })` persistence is already covered by `host-server/db.test.ts`'s TASK-159 test (case (d), lines 123-127).
- [x] Pass <!-- 2026-09-13 -->

### UAT-EDGE-001: POST /bg-processes with an unresolvable linkedAgent returns 400
- **Scenario**: `linkedAgent` is a non-empty string that does not match any agent's `name` in `listAgents(db)`.
- **Steps**: Run the curl command below (no such agent named `does-not-exist` should exist).
- **Command**:
  ```bash
  curl -sS -X POST 'http://127.0.0.1:8788/api/bg-processes' -H 'Content-Type: application/json' -d '{"name":"uat159probe3","workdir":"/tmp","launchCmd":"echo hi","linkedAgent":"does-not-exist"}'
  ```
- **Expected Result**: `HTTP 400`, body `{"error":"linkedAgent 'does-not-exist' not found"}`. No row is written to `bg_processes` for `uat159probe3` (confirm with `sqlite3 ./data/conductor.db "SELECT count(*) FROM bg_processes WHERE name='uat159probe3';"` → `0`), and no tmux window is created.
- **Repeatable Unit Test**: Not applicable: no Fastify route-test harness exists in this repo; behavior only observable via a live HTTP request.
- [x] Pass <!-- 2026-09-13 -->

### UAT-EDGE-002: POST /bg-processes with a duplicate name returns 409
- **Scenario**: A bg process with the given `name` already exists in `bg_processes` (checked via `listBgProcesses(db).some(...)`, replacing the old `conf.bgProcesses.some(...)` check).
- **Steps**:
  1. Ensure `uat159probe` still exists from UAT-API-001 (do not run its cleanup yet), or create it first with the UAT-API-001 command.
  2. Run the curl command below, reusing the same `name`.
- **Command**:
  ```bash
  curl -sS -X POST 'http://127.0.0.1:8788/api/bg-processes' -H 'Content-Type: application/json' -d '{"name":"uat159probe","workdir":"/tmp","launchCmd":"echo hi"}'
  ```
- **Expected Result**: `HTTP 409`, body `{"error":"bg process 'uat159probe' already defined"}`.
- **Repeatable Unit Test**: Not applicable: no Fastify route-test harness exists in this repo; behavior only observable via a live HTTP request.
- [x] Pass <!-- 2026-09-13 -->

### UAT-API-003: DELETE /bg-processes/:name removes the SQLite row, tmux window, and state file
- **Endpoint**: `DELETE /api/bg-processes/:name`
- **Description**: Verifies the DB-backed existence check (`listBgProcesses(db).find(...)`) and that `deleteBgProcess(db, entry.id)` — not the old `removeBgProcessFromConf` + `removeBgLink` conf-write pair — is what removes the definition (and, transitively via the `ON DELETE SET NULL`/row-deletion, any link).
- **Steps**:
  1. Ensure `uat159probe` exists (create it with the UAT-API-001 command if not already present).
  2. Run the curl command below.
  3. Confirm `sqlite3 ./data/conductor.db "SELECT count(*) FROM bg_processes WHERE name='uat159probe';"` returns `0`.
  4. Confirm `tmux list-windows -t conductor | grep uat159probe` returns nothing (window killed).
  5. Confirm `./logs/state/bg-uat159probe.state` no longer exists (if it was ever written).
- **Command**:
  ```bash
  curl -sS -X DELETE 'http://127.0.0.1:8788/api/bg-processes/uat159probe'
  ```
- **Expected Result**: `HTTP 200`, body `{"ok":true,"removed":"uat159probe"}`. SQLite row, tmux window, and state file are all gone.
- **Repeatable Unit Test**: Not applicable: no Fastify route-test harness exists in this repo. `deleteBgProcess`'s row-removal (and its FK `ON DELETE SET NULL` interaction with a linked agent) is already covered by `host-server/db.test.ts`'s TASK-159 test (cases (f)-(g), lines 134-145).
- [x] Pass <!-- 2026-09-13 -->

### UAT-EDGE-003: DELETE /bg-processes/:name for a non-existent name returns 404
- **Scenario**: `listBgProcesses(db).find((b) => b.name === name)` finds no match.
- **Steps**: Run the curl command below against a name guaranteed not to exist.
- **Command**:
  ```bash
  curl -sS -X DELETE 'http://127.0.0.1:8788/api/bg-processes/uat159-does-not-exist'
  ```
- **Expected Result**: `HTTP 404`, body `{"error":"bg process 'uat159-does-not-exist' not found"}`.
- **Repeatable Unit Test**: Not applicable: no Fastify route-test harness exists in this repo; behavior only observable via a live HTTP request.
- [x] Pass <!-- 2026-09-13 -->

### UAT-INTEGRATION-001: GET /status's bgProcesses array reflects dashboard-created/deleted processes without conf-cache staleness
- **Endpoint**: `GET /api/status` (its `bgProcesses` field, built by `buildBgStatuses`)
- **Description**: Verifies `buildBgStatuses` now sources its list from `listBgProcesses(db)` and resolves `linkedAgent` via `listAgents(db)` rather than destructuring `conf.bgProcesses`/`conf.agentBgLinks` — so a dashboard-created bg process shows up without needing `clearConfCache()` or a conf re-read. `GET /status` is served from a periodically-refreshed snapshot (`STATUS_POLL_MS`, `2000` ms in this repo's `conductor.conf`), so allow up to one poll interval for the array to update — this is normal snapshot-refresh latency, not conf staleness.
- **Steps**:
  1. Run the create command from UAT-API-001 (or confirm `uat159probe` already exists).
  2. Wait ~3 seconds (one `STATUS_POLL_MS` cycle plus margin).
  3. Run the curl command below and confirm the `uat159probe` entry is present with `windowPresent: true`.
  4. Run the delete command from UAT-API-003.
  5. Wait ~3 seconds, re-run the same curl command, and confirm `uat159probe` is now absent from the array.
- **Command**:
  ```bash
  curl -sS 'http://127.0.0.1:8788/api/status' | jq '.bgProcesses'
  ```
- **Expected Result**: After step 3, the array contains an object with `name: "uat159probe"`, `windowPresent: true`, `linkedAgent: null`, and `logPath`/`statePath` under this repo's `logs/`/`logs/state/` dirs. After step 5, the array no longer contains an entry named `uat159probe`.
- **Repeatable Unit Test**: Not applicable: requires a live host-server, tmux session, and its periodic status-snapshot loop — not expressible as a unit test without standing up the Fastify app and tmux, which the task explicitly avoids introducing.
- [x] Pass <!-- 2026-09-13 -->

### UAT-MANUAL-001: A dashboard-created, linked bg process is picked up by conductor.sh/spawn.sh on the next run
- **Scenario**: The concrete, previously-broken behavior this task fixes — a bg process created via `POST /bg-processes` (with a `linkedAgent`) now lands in SQLite, so `scripts/lib/db.sh`'s `load_bg()` (called by `conductor.sh`/`spawn.sh`) picks it up on the next session start, and the linked agent's pane receives `CONDUCTOR_BG_NAME`/`CONDUCTOR_BG_LOG`/`CONDUCTOR_BG_STATE` env vars at spawn time.
- **Steps**:
  1. **Caution**: this test restarts the tmux conductor session — do not run it against a session with agents mid-task without warning whoever owns it. Prefer a scratch/dev session if available.
  2. Create a bg process linked to a real agent name via the UAT-API-002 command (do not delete it afterward).
  3. Tear down and re-run `conductor.sh` (or `spawn.sh`), or otherwise trigger a fresh spawn of the linked agent's window, per `scripts/README.md`.
  4. In the linked agent's pane, run `tmux send-keys -t conductor:<agent-window> 'env | grep CONDUCTOR_BG' Enter` and capture the pane (`tmux capture-pane -t conductor:<agent-window> -p`).
  5. Confirm all three vars are present and point at the right paths: `CONDUCTOR_BG_NAME=uat159probe2`, `CONDUCTOR_BG_LOG=<LOG_DIR>/bg-uat159probe2.log`, `CONDUCTOR_BG_STATE=<STATE_DIR>/bg-uat159probe2.state`.
  6. Clean up: delete the bg process via the UAT-API-003-style DELETE command.
- **Expected Result**: The linked agent's pane env contains the three `CONDUCTOR_BG_*` vars pointing at the dashboard-created bg process — proving the definition/link created purely through the API is now live-visible to the bash spawn path, closing the split-brain.
- **Repeatable Unit Test**: Not applicable: requires a real tmux session restart and pane inspection; inherently a live/manual verification per the task's own Step 6.
- [FAIL: auto-judge: manual test requires human verification] <!-- 2026-09-13 -->

### UAT-API-004: DELETE /bg-processes/:name/window closes the window for a DB-registered bg process
- **Endpoint**: `DELETE /api/bg-processes/:name/window`
- **Description**: Verifies TASK-159 Step 2's lookup-source swap for this handler — `listBgProcesses(db).find((b) => b.name === name)` (replacing `conf.bgProcesses.find(...)`) resolves an entry that exists only in SQLite (never written to `conductor.conf`). Does not touch the `bg_processes` row itself, only the tmux window and state file (`host-server/index.ts:1923-1943`).
- **Steps**:
  1. Create `uat159probewin` via the UAT-API-001-style POST command (`name: "uat159probewin"`), which also creates its initial tmux window.
  2. Run the curl command below.
  3. Confirm `tmux list-windows -t conductor | grep uat159probewin` returns nothing (window killed).
  4. Confirm the SQLite row still exists: `sqlite3 ./data/conductor.db "SELECT count(*) FROM bg_processes WHERE name='uat159probewin';"` → `1` (closing the window does not delete the definition).
- **Command**:
  ```bash
  curl -sS -X DELETE 'http://127.0.0.1:8788/api/bg-processes/uat159probewin/window'
  ```
- **Expected Result**: `HTTP 200`, body `{"ok":true,"closed":"uat159probewin"}`. Tmux window gone; `bg_processes` row for `uat159probewin` unchanged/still present.
- **Repeatable Unit Test**: Not applicable: no Fastify route-test harness exists in this repo (per TASK-159's Approach notes), and this handler's effect (tmux `kill-window`, state-file unlink) requires a live tmux session — not expressible as a unit test.
- [x] Pass <!-- 2026-09-13 -->

### UAT-API-005: POST /bg-processes/:name/window recreates the window for a DB-registered bg process whose window was closed
- **Endpoint**: `POST /api/bg-processes/:name/window`
- **Description**: Verifies TASK-159 Step 2's lookup-source swap for this handler — the same DB-backed `listBgProcesses(db).find(...)` resolves the entry so the window can be recreated (`host-server/index.ts:1895-1917`). Chained after UAT-API-004 so the window is guaranteed absent beforehand.
- **Steps**:
  1. Run immediately after UAT-API-004 (window for `uat159probewin` is closed but the row exists).
  2. Run the curl command below.
  3. Confirm `tmux list-windows -t conductor | grep uat159probewin` shows the window again.
  4. Clean up: `curl -sS -X DELETE 'http://127.0.0.1:8788/api/bg-processes/uat159probewin'` (full delete, removing the SQLite row and window).
- **Command**:
  ```bash
  curl -sS -X POST 'http://127.0.0.1:8788/api/bg-processes/uat159probewin/window'
  ```
- **Expected Result**: `HTTP 201`, body `{"ok":true,"bg":{"name":"uat159probewin","workdir":"/Users/davidtaylor/Repositories/tmux-conductor","launchCmd":"sleep 300"}}` (note: no `linkedAgent` field — this handler's response shape omits it, unlike `POST /bg-processes`). Tmux window recreated.
- **Repeatable Unit Test**: Not applicable: no Fastify route-test harness exists in this repo; requires a live tmux session to observe window (re)creation.
- [x] Pass <!-- 2026-09-13 -->

### UAT-EDGE-004: POST /bg-processes/:name/window for a non-existent bg process name returns 404
- **Scenario**: `listBgProcesses(db).find((b) => b.name === name)` finds no match — proves the 404 path is DB-backed, not conf-backed (a name that was never in `conductor.conf` either way, but critically also never in SQLite).
- **Steps**: Run the curl command below against a name guaranteed not to exist in `bg_processes`.
- **Command**:
  ```bash
  curl -sS -X POST 'http://127.0.0.1:8788/api/bg-processes/uat159-does-not-exist/window'
  ```
- **Expected Result**: `HTTP 404`, body `{"error":"bg process 'uat159-does-not-exist' not found"}`.
- **Repeatable Unit Test**: Not applicable: no Fastify route-test harness exists in this repo; behavior only observable via a live HTTP request.
- [x] Pass <!-- 2026-09-13 -->

---

## Gaps

- None at initial generation — every planned case's contract (status codes, response bodies, DB effects, and the async status-snapshot timing) was verified against the running `host-server` (port 8788) and the live `./data/conductor.db` during generation, and against the current `host-server/index.ts`/`db.ts`/`db.test.ts` source.
- **2026-09-13 addendum**: the original generation omitted coverage for TASK-159 Step 2 (`POST`/`DELETE /bg-processes/:name/window`, which also had their lookup swapped from `conf.bgProcesses.find(...)` to `listBgProcesses(db).find(...)`). Appended UAT-API-004, UAT-API-005, and UAT-EDGE-004 to close that gap; their contracts were read directly from `host-server/index.ts:1895-1943`. These three are unexecuted (`[ ] Pass`) — run `/uat-walk` or `/uat-auto` to complete them; the file's overall `status` remains `pending` until they are.
