# UAT: Add-Agent Form

> **Source task**: [`.docs/tasks/029-add-agent-form.md`](../tasks/029-add-agent-form.md)
> **Generated**: 2026-06-06

---

## Prerequisites

- [ ] Dashboard UI dev server running (`pnpm dev` inside `scripts/dashboard/ui/`)
- [ ] Dashboard API server running (`node index.js` inside `scripts/dashboard/server/`) on port 8788
- [ ] Browser accessible at `http://localhost:4321` (or the port shown by `pnpm dev`)

---

## API Tests

### UAT-API-001: POST /agents — happy path (no tmux session required for 409 branch)

- **Endpoint**: `POST /agents`
- **Description**: Verify the server accepts a valid payload and returns 201 with the echoed agent object. (If no tmux session is running, expect 409 "session not running".)
- **Steps**:
  1. Ensure the API server is running
  2. Run the curl command below as-is
- **Command**:
  ```bash
  curl -sS -X POST 'http://127.0.0.1:8788/agents' -H 'Content-Type: application/json' -d '{"name":"test-agent","workdir":"/tmp","launchCmd":"claude --dangerously-skip-permissions"}'
  ```
- **Expected Result**: `201 Created` with `{"ok":true,"agent":{"name":"test-agent","workdir":"/tmp","launchCmd":"claude --dangerously-skip-permissions"}}`. If no tmux session is active, `409` with `{"error":"session not running","sessionAlive":false}` is also acceptable — confirm 409 body shape matches spec.
- [x] Pass <!-- 2026-06-06 -->

### UAT-API-002: POST /agents — invalid name (spaces / uppercase)

- **Endpoint**: `POST /agents`
- **Description**: Verify name validation rejects values that don't match `^[a-z0-9_-]+$`
- **Steps**:
  1. Run the curl command below as-is
- **Command**:
  ```bash
  curl -sS -X POST 'http://127.0.0.1:8788/agents' -H 'Content-Type: application/json' -d '{"name":"Bad Agent","workdir":"/tmp"}'
  ```
- **Expected Result**: `400 Bad Request` with `{"error":"name is required and must match ^[a-z0-9_-]+$"}`
- [x] Pass <!-- 2026-06-06 -->

### UAT-API-003: POST /agents — missing name

- **Endpoint**: `POST /agents`
- **Description**: Verify name is required
- **Steps**:
  1. Run the curl command below as-is
- **Command**:
  ```bash
  curl -sS -X POST 'http://127.0.0.1:8788/agents' -H 'Content-Type: application/json' -d '{"workdir":"/tmp"}'
  ```
- **Expected Result**: `400 Bad Request` with `{"error":"name is required and must match ^[a-z0-9_-]+$"}`
- [x] Pass <!-- 2026-06-06 -->

### UAT-API-004: POST /agents — invalid workdir (relative path)

- **Endpoint**: `POST /agents`
- **Description**: Verify workdir validation rejects relative paths
- **Steps**:
  1. Run the curl command below as-is
- **Command**:
  ```bash
  curl -sS -X POST 'http://127.0.0.1:8788/agents' -H 'Content-Type: application/json' -d '{"name":"valid-name","workdir":"relative/path"}'
  ```
- **Expected Result**: `400 Bad Request` with `{"error":"workdir is required and must be an absolute path (starts with /)"}`
- [x] Pass <!-- 2026-06-06 -->

### UAT-API-005: POST /agents — missing workdir

- **Endpoint**: `POST /agents`
- **Description**: Verify workdir is required
- **Steps**:
  1. Run the curl command below as-is
- **Command**:
  ```bash
  curl -sS -X POST 'http://127.0.0.1:8788/agents' -H 'Content-Type: application/json' -d '{"name":"valid-name"}'
  ```
- **Expected Result**: `400 Bad Request` with `{"error":"workdir is required and must be an absolute path (starts with /)"}`
- [x] Pass <!-- 2026-06-06 -->

### UAT-API-006: POST /agents — 409 window already exists

- **Endpoint**: `POST /agents`
- **Description**: Verify a duplicate agent name returns the correct 409 error
- **Steps**:
  1. Requires a running tmux session with a window named `existing-agent`
  2. If such a session exists, run the curl command below; otherwise mark this test for human verification
- **Command**:
  ```bash
  curl -sS -X POST 'http://127.0.0.1:8788/agents' -H 'Content-Type: application/json' -d '{"name":"existing-agent","workdir":"/tmp"}'
  ```
- **Expected Result**: `409 Conflict` with `{"error":"window already exists"}`
- [FAIL: auto-judge: requires a running tmux session with existing-agent window — got 409 "session not running" instead] <!-- 2026-06-06 -->

### UAT-API-007: POST /agents — default launchCmd used when omitted

- **Endpoint**: `POST /agents`
- **Description**: Verify the server defaults `launchCmd` to `claude --dangerously-skip-permissions` when it is not provided
- **Steps**:
  1. Run the curl command below as-is (note: no `launchCmd` field in the body)
  2. If tmux session is running, expect 201; otherwise expect 409 "session not running" — in either case, if the server echoes the agent object, confirm `launchCmd` is the default
- **Command**:
  ```bash
  curl -sS -X POST 'http://127.0.0.1:8788/agents' -H 'Content-Type: application/json' -d '{"name":"default-cmd-agent","workdir":"/tmp"}'
  ```
- **Expected Result**: If 201, response body contains `"launchCmd":"claude --dangerously-skip-permissions"`. If 409 "session not running", the default is not observable — confirm via the 201 path when a session is running.
- [FAIL: auto-judge: no tmux session running; 409 path makes default launchCmd unobservable — requires human verification with active session] <!-- 2026-06-06 -->

---

## UI Tests

### UAT-UI-001: Form renders above the agent list

- **Page**: `http://localhost:4321/`
- **Description**: Verify `AddAgentForm` is rendered above `AgentList` on the dashboard page
- **Steps**:
  1. Open `http://localhost:4321/` in a browser
  2. Observe the page layout
- **Expected Result**: The "Add Agent" heading and form inputs ("Name", "Working Directory", "Spawn Agent" button) appear **above** the agent list section. The "Show advanced" toggle is visible below the Working Directory input.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-06 -->

### UAT-UI-002: Client-side validation — invalid name (no network request)

- **Page**: `http://localhost:4321/`
- **Description**: Verify that submitting a name with spaces or uppercase letters shows an inline error without making a network request
- **Steps**:
  1. Open `http://localhost:4321/`
  2. In the "Name" field, enter `Bad Agent` (contains a space and uppercase)
  3. In the "Working Directory" field, enter `/tmp`
  4. Click "Spawn Agent"
  5. Open browser DevTools → Network tab; confirm no POST to `/agents` is made
- **Expected Result**: The inline error message "Name must match ^[a-z0-9_-]+$ (lowercase letters, digits, hyphens, underscores)" appears. No network request is fired.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-06 -->

### UAT-UI-003: Client-side validation — relative working directory

- **Page**: `http://localhost:4321/`
- **Description**: Verify that a non-absolute workdir shows an inline error without a network request
- **Steps**:
  1. Open `http://localhost:4321/`
  2. In the "Name" field, enter `valid-name`
  3. In the "Working Directory" field, enter `relative/path`
  4. Click "Spawn Agent"
- **Expected Result**: The inline error "Working directory must be an absolute path (start with /)" appears. No network request is fired.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-06 -->

### UAT-UI-004: Success flow — form clears and shows "Agent spawned"

- **Page**: `http://localhost:4321/`
- **Description**: Verify the form clears and shows a brief success message on a 201 response
- **Steps**:
  1. Start a tmux session and ensure the API server recognizes it (so a 201 is returned)
  2. Open `http://localhost:4321/`
  3. Fill in "Name" with `test-ui-agent` and "Working Directory" with `/tmp`
  4. Click "Spawn Agent"
- **Expected Result**: The form fields clear, the button label returns to "Spawn Agent", and the green message "Agent spawned" appears briefly (disappears after ~4 seconds).
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-06 -->

### UAT-UI-005: 409 "session not running" shown inline

- **Page**: `http://localhost:4321/`
- **Description**: Verify that when no tmux session is running the server's error message is shown inline
- **Steps**:
  1. Ensure no conductor tmux session is active (API server returns 409 "session not running")
  2. Open `http://localhost:4321/`
  3. Fill in a valid Name (`my-agent`) and Working Directory (`/tmp`)
  4. Click "Spawn Agent"
- **Expected Result**: The inline error message "session not running" appears. The form inputs retain their values.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-06 -->

### UAT-UI-006: Advanced section toggle — Launch Command input

- **Page**: `http://localhost:4321/`
- **Description**: Verify the "Show advanced" toggle reveals a pre-filled Launch Command input
- **Steps**:
  1. Open `http://localhost:4321/`
  2. Confirm the Launch Command input is **not visible** by default
  3. Click "▸ Show advanced"
  4. Observe the newly revealed section
- **Expected Result**: After clicking, the button changes to "▾ Hide advanced" and a "Launch Command" input appears, pre-filled with `claude --dangerously-skip-permissions`.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-06 -->

### UAT-UI-007: "Spawn Agent" button is disabled while submitting

- **Page**: `http://localhost:4321/`
- **Description**: Verify the button shows "Spawning…" and is disabled during form submission to prevent double-submit
- **Steps**:
  1. Open `http://localhost:4321/`
  2. Fill in valid values (name `test-agent`, workdir `/tmp`)
  3. Click "Spawn Agent" and **immediately** observe the button
- **Expected Result**: The button label changes to "Spawning…" and the button is disabled until the server responds.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-06 -->

---

## Edge Case Tests

### UAT-EDGE-001: 409 "window already exists" shown inline

- **Scenario**: A conductor session is running and an agent with the submitted name already exists as a tmux window
- **Steps**:
  1. Ensure a conductor tmux session is running with a window named `dup-agent`
  2. Open `http://localhost:4321/`
  3. Enter `dup-agent` in the Name field and `/tmp` in the Working Directory field
  4. Click "Spawn Agent"
- **Expected Result**: The inline error "window already exists" appears. The form is not cleared.
- [FAIL: auto-judge: manual test requires human verification] <!-- 2026-06-06 -->

### UAT-EDGE-002: Network failure shows generic error

- **Scenario**: The API server is unreachable (network error, not an HTTP error)
- **Steps**:
  1. Stop the API server
  2. Open `http://localhost:4321/`
  3. Fill in valid values (name `test-agent`, workdir `/tmp`) and click "Spawn Agent"
- **Expected Result**: The inline error "Failed to spawn agent" appears. The form is not cleared.
- [FAIL: auto-judge: manual test requires human verification] <!-- 2026-06-06 -->

### UAT-EDGE-003: Name with only valid characters accepted

- **Scenario**: Borderline valid names — digits, underscores, hyphens, lowercase letters
- **Steps**:
  1. Open `http://localhost:4321/`
  2. Enter `agent_01-abc` in Name and `/tmp` in Working Directory
  3. Click "Spawn Agent"
- **Expected Result**: No client-side validation error is shown; the form proceeds to the network request (returning 201 or 409 depending on session state).
- [FAIL: auto-judge: manual test requires human verification] <!-- 2026-06-06 -->

---

## Integration Tests

### UAT-INT-001: New agent appears in AgentList after spawn (SSE live update)

- **Components**: `AddAgentForm` → `POST /agents` → tmux spawn → SSE poll-and-diff → `AgentList`
- **Flow**: User fills the form, submits, agent is spawned in tmux, the poll-and-diff loop detects the new window within 2 s and emits an `agent-update` SSE event, `AgentList` adds the new agent accordion item
- **Steps**:
  1. Ensure a conductor tmux session is running
  2. Open `http://localhost:4321/` in a browser
  3. Observe the current list of agents in `AgentList`
  4. Fill in the Add Agent form with Name `integration-test` and Working Directory `/tmp`
  5. Click "Spawn Agent"
  6. Wait up to 4 seconds
- **Expected Result**: The "Agent spawned" success message appears, the form clears, and within ~2 seconds the `AgentList` component shows a new entry for `integration-test` without a full page reload.
- [FAIL: auto-judge: manual test requires human verification] <!-- 2026-06-06 -->
