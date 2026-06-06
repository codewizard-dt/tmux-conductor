# UAT: Error State Detection + Red Highlight

> **Source task**: [`.docs/tasks/030-error-state-red-highlight.md`](../tasks/030-error-state-red-highlight.md)
> **Generated**: 2026-06-06

---

## Prerequisites

- [ ] Dashboard server is running: `node scripts/dashboard/server/index.js` (port 8788)
- [ ] UI dev server is running (or production build served): `cd scripts/dashboard/ui && npm run dev`
- [ ] At least one agent is registered in `conductor.conf` (e.g. `jobfinder`)
- [ ] `logs/state/` directory exists (created automatically when conductor runs, or `mkdir -p logs/state`)
- [ ] Browser is open on the dashboard UI (e.g. `http://localhost:4321`)

---

## API Tests

### UAT-API-001: GET /status returns `state: "error"` when state file contains "error"
- **Endpoint**: `GET /status`
- **Description**: Verify the server returns `state: "error"` verbatim when the agent's state file contains the string `error`. This confirms `readAgentState()` passes the new value through unchanged.
- **Steps**:
  1. Write `error` to an agent state file: `printf 'error' > logs/state/jobfinder.state`
  2. Run the curl command below
- **Command**:
  ```bash
  curl -sS 'http://127.0.0.1:8788/status' | jq '.agents[] | select(.name == "jobfinder") | .state'
  ```
- **Expected Result**: `"error"` (the `state` field for the agent is the string `"error"`)
- [x] Pass <!-- 2026-06-06 -->

### UAT-API-002: GET /status returns `state: "idle"` after state file is reset
- **Endpoint**: `GET /status`
- **Description**: Verify the server reflects state file changes immediately — writing `idle` clears the error state.
- **Steps**:
  1. Ensure `logs/state/jobfinder.state` still contains `error` from UAT-API-001
  2. Write `idle`: `printf 'idle' > logs/state/jobfinder.state`
  3. Run the curl command below
- **Command**:
  ```bash
  curl -sS 'http://127.0.0.1:8788/status' | jq '.agents[] | select(.name == "jobfinder") | .state'
  ```
- **Expected Result**: `"idle"` (state reverts to idle; red highlight should clear in UI)
- [x] Pass <!-- 2026-06-06 -->

---

## Hook Tests

### UAT-HOOK-001: `on-stop-failure.js` syntax check passes
- **Description**: Verify the hook file has no syntax errors after the change to write `'error'`.
- **Steps**:
  1. Run the command below from the repo root
- **Command**:
  ```bash
  node --check hooks/on-stop-failure.js && echo "PASS"
  ```
- **Expected Result**: Outputs `PASS` with exit code 0; no syntax errors reported
- [x] Pass <!-- 2026-06-06 -->

### UAT-HOOK-002: `on-stop-failure.js` writes `error` to state file
- **Description**: Verify the hook writes the string `error` (not `idle`) to the state file when invoked directly. Simulates what Claude Code's `StopFailure` lifecycle event does.
- **Steps**:
  1. Set the required environment variables and run the hook:
     ```bash
     mkdir -p ./tmp/hook-test-state
     CONDUCTOR_AGENT_NAME=testbot CONDUCTOR_STATE_DIR=./tmp/hook-test-state node hooks/on-stop-failure.js </dev/null
     ```
  2. Read back the state file: `cat ./tmp/hook-test-state/testbot.state`
- **Command**:
  ```bash
  mkdir -p ./tmp/hook-test-state && CONDUCTOR_AGENT_NAME=testbot CONDUCTOR_STATE_DIR=./tmp/hook-test-state node hooks/on-stop-failure.js </dev/null
  ```
- **Expected Result**: The file `./tmp/hook-test-state/testbot.state` contains exactly `error` (no trailing newline noise). Verify with: `cat ./tmp/hook-test-state/testbot.state` → output is `error`
- [x] Pass <!-- 2026-06-06 -->

---

## UI Tests

### UAT-UI-001: Agent accordion header shows red badge when state is `error`
- **Page**: Dashboard UI (e.g. `http://localhost:4321`)
- **Description**: Verify that when an agent's state file contains `error`, the `StatusBadge` component renders with the `status-error` CSS class, producing a red badge labeled "error" on the accordion header.
- **Steps**:
  1. Write `error` to the state file: `printf 'error' > logs/state/jobfinder.state`
  2. Wait up to 3 seconds for the SSE poll cycle (server polls every 2 seconds)
  3. Observe the `jobfinder` accordion header in the browser
- **Expected Result**: The `jobfinder` accordion header displays a badge with class `status-error`. The badge is visually red (background `#fee2e2`, text `#991b1b`, dot `#dc2626`) and labeled **"error"**. No green/gray badge is visible for this agent.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-06 -->

### UAT-UI-002: Red badge clears when state file is reset to `idle`
- **Page**: Dashboard UI
- **Description**: Verify the red highlight disappears within the next SSE poll cycle when the state file is overwritten with `idle`. Confirms the UI reacts to recovery automatically.
- **Steps**:
  1. Ensure `logs/state/jobfinder.state` still contains `error` from UAT-UI-001 (red badge is visible)
  2. Write `idle`: `printf 'idle' > logs/state/jobfinder.state`
  3. Wait up to 3 seconds for the SSE poll cycle
  4. Observe the `jobfinder` accordion header
- **Expected Result**: The red `status-error` badge is gone. The badge now shows either green "idle" (`status-idle`) or amber "no tasks" (`status-empty`) depending on the queue, confirming the `error` state has cleared.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-06 -->

### UAT-UI-003: Agent in `error` state does not show `idle` or `empty` badge
- **Page**: Dashboard UI
- **Description**: Verify that `deriveStatus()` correctly routes `state === 'error'` to the `error` branch — not to `idle` or `empty`.
- **Steps**:
  1. Write `error` to the state file: `printf 'error' > logs/state/jobfinder.state`
  2. Wait up to 3 seconds for SSE update
  3. Inspect the badge on the `jobfinder` accordion header
- **Expected Result**: The badge displays the text **"error"** (not "idle", "no tasks", or "unknown"). The badge CSS class is `status-error` (inspectable via browser DevTools → Elements panel).
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-06 -->

---

## Edge Case Tests

### UAT-EDGE-001: `busy` state overwrites `error` (recovery via new prompt)
- **Description**: Verify that writing `busy` to a state file that contained `error` causes the red badge to clear immediately on the next poll — confirming the recovery path works without any special UI action.
- **Steps**:
  1. Write `error`: `printf 'error' > logs/state/jobfinder.state`
  2. Wait up to 3 seconds — confirm red badge is visible
  3. Write `busy`: `printf 'busy' > logs/state/jobfinder.state`
  4. Wait up to 3 seconds for SSE update
- **Expected Result**: The red `status-error` badge is replaced by the blue `status-busy` badge labeled **"busy"**. No manual UI intervention required.
- [FAIL: auto-judge: manual test requires human verification] <!-- 2026-06-06 -->

### UAT-EDGE-002: Missing state file does not trigger red badge
- **Description**: Verify that a missing state file returns `unknown` from `readAgentState()` (falls through to the `default` branch in `deriveStatus()`), not `error`. Confirms `error` is only shown when the file explicitly contains the string `error`.
- **Steps**:
  1. Remove the state file: `rm -f logs/state/jobfinder.state`
  2. Run the status API check:
     ```bash
     curl -sS 'http://127.0.0.1:8788/status' | jq '.agents[] | select(.name == "jobfinder") | .state'
     ```
  3. Observe the dashboard badge
- **Command**:
  ```bash
  curl -sS 'http://127.0.0.1:8788/status' | jq '.agents[] | select(.name == "jobfinder") | .state'
  ```
- **Expected Result**: API returns `"unknown"`. The dashboard badge shows the gray "unknown" style (`status-unknown`), not the red `status-error` style.
- [FAIL: auto-judge: manual test requires human verification] <!-- 2026-06-06 -->

---

**UAT**: [`.docs/uat/030-error-state-red-highlight.uat.md`](../uat/030-error-state-red-highlight.uat.md)
