---
id: UAT-011
title: "UAT: Immediate dispatch for tasks enqueued to an idle agent with an empty queue"
status: pending
task: TASK-011
created: 2026-06-12
updated: 2026-06-12
---

# UAT-011 — UAT: Immediate dispatch for tasks enqueued to an idle agent with an empty queue

implements::[[TASK-011]]

> **Source task**: [`wiki/work/tasks/TASK-011-immediate-dispatch.md`](../tasks/TASK-011-immediate-dispatch.md)
> **Generated**: 2026-06-12

---

## Prerequisites

- [ ] Backend running: `cd backend && npm run dev` (port 8788)
- [ ] Frontend running: `cd frontend && npm run dev` (port 4321)
- [ ] A conductor tmux session exists with at least one registered agent window (e.g. `make up` or `./scripts/conductor.sh`)
- [ ] At least one agent is in `idle` state (check `cat $STATE_DIR/<agent>.state` — must read `idle`)
- [ ] The agent's task queue is empty for that agent (DB: no queued tasks; verify with `GET /api/queue/<agent>`)
- [ ] Note the agent name (replace `<AGENT>` throughout), the `STATE_DIR` and `LOG_DIR` values from `conductor.conf`
- [ ] Have `jq` installed for JSON response inspection

---

## Test Cases

### UAT-API-001: Fast-path dispatches immediately via POST /api/queue/:agent when agent is idle with no tasks

- **Endpoint**: `POST /api/queue/:agent`
- **Description**: When the target agent is idle and has zero queued tasks, the task must be dispatched to the tmux pane immediately and never written to the queue — response is `{ ok: true, dispatched: true }`.
- **Steps**:
  1. Confirm agent `<AGENT>` is idle: `cat $STATE_DIR/<AGENT>.state` → must print `idle`
  2. Confirm queue is empty: `curl -sS 'http://localhost:8788/api/queue/<AGENT>' | jq '.tasks'` → must be `[]`
  3. Run the command below
  4. Observe the agent's tmux pane (e.g. `tmux attach -t conductor`)
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8788/api/queue/<AGENT>' -H 'Content-Type: application/json' -d '{"task":"echo hello-immediate"}'
  ```
- **Expected Result**:
  - HTTP 200
  - Body: `{"ok":true,"dispatched":true}`
  - The command `echo hello-immediate` appears in the agent's tmux pane within 1 second
  - `cat $STATE_DIR/<AGENT>.state` → `busy`
  - `tasks.txt` (or queue) does NOT contain `echo hello-immediate`
- [ ] Pass

---

### UAT-API-002: Fast-path dispatches immediately via POST /api/tasks when agent is idle with no DB tasks

- **Endpoint**: `POST /api/tasks`
- **Description**: The DB-backed route applies the same fast-path: idle agent + no queued tasks → immediate dispatch, response `{ ok: true, dispatched: true }`.
- **Steps**:
  1. Confirm agent `<AGENT>` is idle and DB queue is empty (same checks as UAT-API-001)
  2. Run the command below
  3. Observe the agent's tmux pane
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8788/api/tasks' -H 'Content-Type: application/json' -d '{"command":"echo db-immediate","agentName":"<AGENT>"}'
  ```
- **Expected Result**:
  - HTTP 200
  - Body: `{"ok":true,"dispatched":true}`
  - `echo db-immediate` appears in the agent's tmux pane within 1 second
  - `cat $STATE_DIR/<AGENT>.state` → `busy`
  - No task row created in the DB (`curl -sS 'http://localhost:8788/api/queue/<AGENT>' | jq '.tasks'` → still `[]` or unchanged)
- [ ] Pass

---

### UAT-API-003: dispatch.jsonl receives a record with detection="immediate-enqueue"

- **Endpoint**: `POST /api/queue/:agent` (or `/api/tasks`)
- **Description**: Every immediate dispatch must write a JSONL record to `$LOG_DIR/dispatch.jsonl` so `getActiveTask` and the dashboard can surface the active task.
- **Steps**:
  1. Ensure agent is idle and queue is empty
  2. Note the line count of `$LOG_DIR/dispatch.jsonl` before: `wc -l $LOG_DIR/dispatch.jsonl`
  3. Run the command below
  4. Read the last line of dispatch.jsonl
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8788/api/queue/<AGENT>' -H 'Content-Type: application/json' -d '{"task":"echo log-test"}'
  ```
- **Expected Result**:
  - dispatch.jsonl gains exactly one new line
  - Last line is valid JSON containing: `"detection":"immediate-enqueue"`, `"agent":"<AGENT>"`, `"command":"echo log-test"`, `"queue_remaining":0`, `"queue":"none"`
  - `ts` field is a valid ISO-8601 timestamp
- [ ] Pass

---

### UAT-API-004: Slow-path — task is queued (not dispatched) when agent is busy

- **Endpoint**: `POST /api/queue/:agent`
- **Description**: When the agent is busy (not idle), the task must be appended to the queue normally — `dispatched: false`, task lands in the queue.
- **Steps**:
  1. Ensure agent `<AGENT>` is busy: `echo -n busy > $STATE_DIR/<AGENT>.state`
  2. Run the command below
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8788/api/queue/<AGENT>' -H 'Content-Type: application/json' -d '{"task":"echo queued-while-busy"}'
  ```
- **Expected Result**:
  - HTTP 200
  - Body contains `"dispatched":false` and `"line":"<AGENT>: echo queued-while-busy"`
  - `curl -sS 'http://localhost:8788/api/queue/<AGENT>' | jq '.tasks'` → list includes `"echo queued-while-busy"`
  - State file remains `busy`
- [ ] Pass

---

### UAT-API-005: Slow-path — task is queued when agent is idle but already has pending tasks

- **Endpoint**: `POST /api/queue/:agent`
- **Description**: An idle agent with existing queued tasks must NOT get an immediate dispatch — task is appended to preserve queue order.
- **Steps**:
  1. Ensure agent `<AGENT>` is idle: `echo -n idle > $STATE_DIR/<AGENT>.state`
  2. Add an initial task to the queue so it's non-empty:
     `curl -sS -X POST 'http://localhost:8788/api/queue/<AGENT>' -H 'Content-Type: application/json' -d '{"task":"echo first-task"}'` (this may itself fast-dispatch — if so, make the agent busy first for step 2, then idle again after, and add a task by writing directly to tasks.txt or via the DB route with a busy agent)
  3. Confirm queue is non-empty: `curl -sS 'http://localhost:8788/api/queue/<AGENT>' | jq '.tasks | length'` → ≥ 1
  4. Run the command below
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8788/api/queue/<AGENT>' -H 'Content-Type: application/json' -d '{"task":"echo second-task"}'
  ```
- **Expected Result**:
  - Body contains `"dispatched":false`
  - Queue now has both tasks
  - `echo second-task` does NOT immediately appear in the agent's tmux pane
- [ ] Pass

---

### UAT-API-006: POST /api/tasks slow-path returns dispatched:false with task object

- **Endpoint**: `POST /api/tasks`
- **Description**: When the fast-path does not trigger (agent busy or has pending tasks), the DB-backed route returns `dispatched: false` alongside the created task object.
- **Steps**:
  1. Ensure agent `<AGENT>` is busy: `echo -n busy > $STATE_DIR/<AGENT>.state`
  2. Run the command below
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8788/api/tasks' -H 'Content-Type: application/json' -d '{"command":"echo slow-path-db","agentName":"<AGENT>"}'
  ```
- **Expected Result**:
  - HTTP 201
  - Body contains `"dispatched":false` and a `task` object with `id`, `command`, `status` fields
  - Task appears in `curl -sS 'http://localhost:8788/api/queue/<AGENT>' | jq '.tasks'`
- [ ] Pass

---

### UAT-API-007: POST /api/tasks with no agentName always uses slow-path (global task)

- **Endpoint**: `POST /api/tasks`
- **Description**: A task with no `agentName` cannot be fast-dispatched (no agent to check). It must always be queued regardless of agent states.
- **Steps**:
  1. Run the command below
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8788/api/tasks' -H 'Content-Type: application/json' -d '{"command":"echo global-task"}'
  ```
- **Expected Result**:
  - HTTP 201
  - Body contains `"dispatched":false` and a task object with no `agentId`
- [ ] Pass

---

### UAT-UI-001: "Started immediately" hint appears when task is fast-dispatched from the dashboard

- **Page**: `http://localhost:4321` — open an agent's task queue in the dashboard
- **Description**: When a task is fast-dispatched, `AddTaskForm` must skip adding the task to the queue display and instead show a brief green "Started immediately" label.
- **Steps**:
  1. Ensure agent `<AGENT>` is idle with an empty queue
  2. Open the dashboard and expand/open the agent's detail panel (click the agent row to open the modal)
  3. Find the "Add task" form at the bottom of the task list section
  4. Type `echo ui-test` and submit
  5. Observe the form area immediately after submission
- **Expected Result**:
  - A green label reading **"Started immediately"** appears below the form
  - The label disappears after approximately 2 seconds
  - The task queue display does NOT gain a new row for `echo ui-test`
  - The command `echo ui-test` appears in the agent's tmux pane within 1 second
- [ ] Pass

---

### UAT-UI-002: Task is added to queue display when agent is busy (slow path in UI)

- **Page**: `http://localhost:4321`
- **Description**: When the fast-path does not trigger, `onAdded` fires and the queue list updates normally — no "Started immediately" hint.
- **Steps**:
  1. Ensure agent `<AGENT>` is busy: `echo -n busy > $STATE_DIR/<AGENT>.state`
  2. Open the agent's detail panel in the dashboard
  3. Type `echo queued-ui-test` and submit
  4. Observe the task list and form area
- **Expected Result**:
  - The task `echo queued-ui-test` appears as a new row in the task queue list
  - No "Started immediately" label is shown
- [ ] Pass

---

### UAT-EDGE-001: No double-dispatch — monitor does not re-send an immediately-dispatched task

- **Scenario**: After an immediate dispatch, the monitor's next poll sees the agent as busy with an empty queue and does NOT dispatch again.
- **Steps**:
  1. Note `POLL_INTERVAL` from `conductor.conf` (typically 15 seconds)
  2. Ensure agent is idle with empty queue
  3. Dispatch a task via `POST /api/queue/<AGENT>` (fast-path)
  4. Wait for `POLL_INTERVAL + 5` seconds (e.g. 20 seconds)
  5. Check monitor log: `tail -20 $LOG_DIR/monitor.log` (or `$LOG_DIR/dispatch.jsonl`)
- **Expected Result**:
  - dispatch.jsonl shows exactly one `immediate-enqueue` record for this command
  - No second dispatch record for the same command appears
  - Monitor log shows "queue empty, no task" for the agent on the next poll (after the agent finishes and returns to idle)
- [ ] Pass

---

### UAT-EDGE-002: State file is written to "busy" before send-keys (no poll race)

- **Scenario**: The state file must be written to `busy` synchronously before `sendTextToPane` is called, so a monitor poll arriving between the two cannot see `idle` + non-empty queue and double-dispatch.
- **Steps**:
  1. Ensure agent is idle with empty queue
  2. Dispatch via `POST /api/queue/<AGENT>`
  3. Immediately (within milliseconds) check the state file:
     `cat $STATE_DIR/<AGENT>.state`
- **Expected Result**:
  - State file reads `busy` — it was written before send-keys was called
  - (This verifies the ordering guarantee; timing makes it hard to catch a race, but the implementation must write state before sending keys — observable by the state being `busy` immediately after the HTTP response returns)
- [ ] Pass
