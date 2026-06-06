# UAT: SSE Live State Stream

> **Source task**: [`.docs/tasks/025-sse-live-state-stream.md`](../../tasks/025-sse-live-state-stream.md)
> **Generated**: 2026-06-06

---

## Prerequisites

- [ ] Node.js installed (v18+, ESM support required)
- [ ] Dashboard server dependencies installed: `cd scripts/dashboard/server && npm install`
- [ ] `conductor.conf` present at repo root with at least one entry in `AGENTS` (default config is sufficient)
- [ ] State directory exists: `mkdir -p ./logs/state` (relative to repo root)
- [ ] Dashboard server is NOT already running on port 8788
- [ ] A scratch directory exists: `mkdir -p ./tmp/uat-025`

---

## Static Analysis

### UAT-STATIC-001: node --check passes on server entry point

- **Description**: Verify the server file has no syntax errors that would prevent Node from loading it.
- **Steps**:
  1. From the repo root, run the command below.
- **Command**:
  ```bash
  node --check scripts/dashboard/server/index.js
  ```
- **Expected Result**: Command exits with code 0 and produces no output (no syntax errors detected).
- [x] Pass <!-- 2026-06-06 -->

---

## API Tests

### UAT-API-001: GET /events responds with text/event-stream Content-Type

- **Endpoint**: `GET /events`
- **Description**: Verify the SSE endpoint sets the correct `Content-Type` header so browsers and EventSource clients know this is a streaming response.
- **Steps**:
  1. Start the dashboard server in the background: `cd scripts/dashboard/server && node index.js &`
  2. Wait 1 second for it to bind.
  3. Run the command below (fetches only headers, disconnects immediately).
- **Command**:
  ```bash
  curl -sS -I 'http://127.0.0.1:8788/events'
  ```
- **Expected Result**: Response headers include `content-type: text/event-stream` (case-insensitive). Also expect `cache-control: no-cache` and `connection: keep-alive`.
- [x] Pass <!-- 2026-06-06 -->

### UAT-API-002: GET /events sends ": connected" initial comment

- **Endpoint**: `GET /events`
- **Description**: Verify the server writes the `: connected\n\n` comment immediately upon connection, confirming the stream is live before any events are emitted.
- **Steps**:
  1. Ensure the dashboard server from UAT-API-001 is still running.
  2. Run the command below. `--max-time 2` causes curl to read the stream for 2 seconds then disconnect; the initial comment should arrive in well under that window.
- **Command**:
  ```bash
  curl -sS -N --max-time 2 'http://127.0.0.1:8788/events'
  ```
- **Expected Result**: Output contains `: connected` as the first non-empty line. The command may exit with curl error 28 (timeout) — that is expected and acceptable since the stream is intentionally kept open. The `: connected` text must appear in the output.
- [x] Pass <!-- 2026-06-06 -->

### UAT-API-003: State file change triggers agent-update event within 3 seconds

- **Endpoint**: `GET /events`
- **Description**: Verify the poll-and-diff loop detects a state file change and broadcasts an `agent-update` SSE event. The event must arrive within 3 seconds of the file write (poll interval is 2 s, so one tick is sufficient).
- **Steps**:
  1. Ensure the dashboard server is running.
  2. Determine the first agent name from `conductor.conf` — by default `jobfinder`. Adjust `AGENT` below if different.
  3. Ensure an initial state exists so the first poll snapshot is established: `echo idle > ./logs/state/jobfinder.state`
  4. Wait 3 seconds for the server to establish `prevSnapshot`.
  5. Open the SSE stream in the background, redirecting output to a temp file: `curl -sS -N 'http://127.0.0.1:8788/events' > ./tmp/uat-025/events.txt &`; note the PID.
  6. Wait 1 second for the connection to register.
  7. Write a new state to trigger a diff: `echo busy > ./logs/state/jobfinder.state`
  8. Wait 3 seconds for the next poll cycle to fire and broadcast.
  9. Kill the curl background job.
  10. Inspect the captured output: run the command below.
- **Command**:
  ```bash
  grep 'agent-update' ./tmp/uat-025/events.txt
  ```
- **Expected Result**: At least one line matching `event: agent-update` is present. The following `data:` line must contain a JSON object with `"name":"jobfinder"` and `"state":"busy"`.
- [x] Pass <!-- 2026-06-06 -->

### UAT-API-004: agent-update event data shape

- **Endpoint**: `GET /events`
- **Description**: Verify the `agent-update` event payload contains all four required fields: `name`, `state`, `queuedTasks`, and `windowPresent`.
- **Steps**:
  1. Use the `./tmp/uat-025/events.txt` file captured in UAT-API-003.
  2. Run the command below to extract and pretty-print the first `data:` line after an `agent-update` event.
- **Command**:
  ```bash
  grep '^data:' ./tmp/uat-025/events.txt | head -1 | sed 's/^data: //' | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8'); const o=JSON.parse(d); console.log(JSON.stringify({name:o.name,state:o.state,queuedTasks:o.queuedTasks,windowPresent:o.windowPresent},null,2))"
  ```
- **Expected Result**: JSON object printed with all four keys present: `name` (string), `state` (string — one of `"idle"`, `"busy"`, or `"unknown"`), `queuedTasks` (number), `windowPresent` (boolean). No key should be `undefined` or missing.
- [x] Pass <!-- 2026-06-06 -->

### UAT-API-005: Second state change triggers another agent-update event

- **Endpoint**: `GET /events`
- **Description**: Verify that writing `idle` back to the state file triggers a second `agent-update` event, confirming the loop continues diffing across multiple state transitions.
- **Steps**:
  1. Restart the background curl capture: `curl -sS -N 'http://127.0.0.1:8788/events' > ./tmp/uat-025/events2.txt &`
  2. Wait 1 second.
  3. Write `busy` to the state file: `echo busy > ./logs/state/jobfinder.state`
  4. Wait 3 seconds.
  5. Write `idle` back: `echo idle > ./logs/state/jobfinder.state`
  6. Wait 3 seconds.
  7. Kill the curl background job.
  8. Run the command below.
- **Command**:
  ```bash
  grep -c 'event: agent-update' ./tmp/uat-025/events2.txt
  ```
- **Expected Result**: Output is `2` — two separate `agent-update` events were received, one for the `busy` transition and one for the `idle` transition.
- [x] Pass <!-- 2026-06-06 -->

### UAT-API-006: Client disconnect is handled cleanly — server continues running

- **Endpoint**: `GET /events`
- **Description**: Verify that when a connected client disconnects, the server removes it from `sseClients` without crashing. Other endpoints must remain accessible after the disconnect.
- **Steps**:
  1. Ensure the dashboard server is still running.
  2. Open an SSE connection and immediately disconnect it (max-time 1 s).
- **Command**:
  ```bash
  curl -sS -N --max-time 1 'http://127.0.0.1:8788/events'; curl -sS 'http://127.0.0.1:8788/healthz'
  ```
- **Expected Result**: The first curl exits (with or without error 28 — both are fine). The second curl immediately returns `{"ok":true}`. The server must not crash between the two calls. If the second curl returns `{"ok":true}`, the server is healthy.
- [x] Pass <!-- 2026-06-06 -->

### UAT-API-007: Two simultaneous clients both receive the same events

- **Endpoint**: `GET /events`
- **Description**: Verify `broadcastSSE` writes to all entries in `sseClients`, so multiple concurrent subscribers each receive the same event.
- **Steps**:
  1. Ensure the dashboard server is running.
  2. Open two background curl clients:
     - `curl -sS -N 'http://127.0.0.1:8788/events' > ./tmp/uat-025/client-a.txt &`
     - `curl -sS -N 'http://127.0.0.1:8788/events' > ./tmp/uat-025/client-b.txt &`
  3. Wait 1 second for both connections to register.
  4. Write a state change: `echo busy > ./logs/state/jobfinder.state`
  5. Wait 3 seconds.
  6. Kill both background curl jobs.
  7. Run the commands below.
- **Command**:
  ```bash
  grep -c 'event: agent-update' ./tmp/uat-025/client-a.txt && grep -c 'event: agent-update' ./tmp/uat-025/client-b.txt
  ```
- **Expected Result**: Both greps print `1` (or more) — each client independently received the `agent-update` broadcast.
- [x] Pass <!-- 2026-06-06 -->

---

## Edge Case Tests

### UAT-EDGE-001: Heartbeat comment arrives within 16 seconds of connect

- **Scenario**: The server sends `": ping\n\n"` every 15 seconds to prevent proxy keepalive timeouts.
- **Steps**:
  1. Ensure the dashboard server is running.
  2. Open the SSE stream with a 20-second timeout.
- **Command**:
  ```bash
  curl -sS -N --max-time 20 'http://127.0.0.1:8788/events'
  ```
- **Expected Result**: Output contains at least one `: ping` line in addition to `: connected`. The `: ping` line must appear within 16 seconds of the `: connected` line.
- [x] Pass <!-- 2026-06-06 -->

### UAT-EDGE-002: Server handles write error to a closed client without crashing

- **Scenario**: If `reply.raw.write()` throws (because the underlying socket closed mid-write), the `broadcastSSE` function's `catch` block must delete the stale client from `sseClients` and continue. The server must not crash.
- **Steps**:
  1. Open an SSE connection: `curl -sS -N 'http://127.0.0.1:8788/events' > ./tmp/uat-025/edge2.txt &` and note the PID.
  2. Immediately kill the curl process at the OS level (SIGKILL to simulate abrupt socket close): `kill -9 <PID>`
  3. Wait 3 seconds for the next poll cycle.
  4. Trigger a state change to force a `broadcastSSE` call: `echo busy > ./logs/state/jobfinder.state`
  5. Wait 3 seconds.
  6. Verify the server is still responding.
- **Command**:
  ```bash
  curl -sS 'http://127.0.0.1:8788/healthz'
  ```
- **Expected Result**: `{"ok":true}` — the server is still running and healthy after attempting to write to a dead socket.
- [x] Pass <!-- 2026-06-06 -->

### UAT-EDGE-003: Missing state file results in "unknown" state (not crash)

- **Scenario**: If a state file does not exist, `readAgentState` returns `"unknown"` per its `catch {}` block. The SSE stream and server must continue operating normally.
- **Steps**:
  1. Ensure the dashboard server is running.
  2. Remove the state file if it exists: `rm -f ./logs/state/jobfinder.state`
  3. Wait 3 seconds for the poll loop to run.
  4. Verify the server is still healthy.
- **Command**:
  ```bash
  curl -sS 'http://127.0.0.1:8788/healthz'
  ```
- **Expected Result**: `{"ok":true}`. The server must not crash when a state file is absent.
- [x] Pass <!-- 2026-06-06 -->

---

## Cleanup

After all tests:
- [ ] Kill the background dashboard server: `pkill -f 'node index.js'` (or stop the process you started)
- [ ] Remove scratch files: `rm -rf ./tmp/uat-025`
