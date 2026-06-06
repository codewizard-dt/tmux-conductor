# UAT: Awaiting-Input Flash Icon

> **Source task**: [`.docs/tasks/032-awaiting-input-flash-icon.md`](../tasks/032-awaiting-input-flash-icon.md)
> **Generated**: 2026-06-06

---

## Prerequisites

- [ ] Working directory is `/Users/davidtaylor/Repositories/tmux-conductor`
- [ ] `./logs/state/` directory exists (created by monitor.sh on startup; create manually if needed: `mkdir -p ./logs/state`)
- [ ] Dashboard server is running on port 8788 (`cd scripts/dashboard/server && node index.js`)
- [ ] Dashboard UI is running (optional for API tests; required for UI tests): `cd scripts/dashboard/ui && npm run dev`
- [ ] `conductor.conf` is present in the repo root and defines at least one agent (e.g. `jobfinder`)

---

## Shell / Script Tests

### UAT-SHELL-001: `monitor.sh` passes bash syntax check

- **Description**: Verify `scripts/monitor.sh` contains no syntax errors after the awaiting-state logic was added.
- **Steps**:
  1. Run the command below from the repo root
- **Command**:
  ```bash
  bash -n scripts/monitor.sh
  ```
- **Expected Result**: exits 0 with no output
- [x] Pass <!-- 2026-06-06 -->

### UAT-SHELL-002: `conductor.conf` defines `AWAITING_PATTERN`

- **Description**: Verify the config variable is present and non-empty.
- **Steps**:
  1. Run the command below from the repo root
- **Command**:
  ```bash
  bash -c 'source ./conductor.conf; [[ -n "$AWAITING_PATTERN" ]] && echo "AWAITING_PATTERN=$AWAITING_PATTERN" || echo "MISSING"'
  ```
- **Expected Result**: prints `AWAITING_PATTERN=(\?$|\[Y/n\]|\[y/N\]|>$)` (exits 0)
- [x] Pass <!-- 2026-06-06 -->

### UAT-SHELL-003: Write `awaiting` state — API reflects the change

- **Description**: Writing `awaiting` to a state file causes the `/status` API to return `state: "awaiting"` for that agent within the server's next poll cycle (instant on demand — `/status` reads the file on every request).
- **Steps**:
  1. Ensure the `logs/state/` directory exists
  2. Run the write command:
     ```bash
     printf 'awaiting\n' > ./logs/state/jobfinder.state
     ```
  3. Immediately query the API (command below)
- **Command**:
  ```bash
  curl -sS 'http://127.0.0.1:8788/status' | jq '.agents[] | select(.name=="jobfinder") | {name, state}'
  ```
- **Expected Result**: `{"name": "jobfinder", "state": "awaiting"}`
- [x] Pass <!-- 2026-06-06 -->

### UAT-SHELL-004: Revert `busy` state — API reflects the change

- **Description**: Writing `busy` back clears the awaiting state; the API returns `state: "busy"` immediately.
- **Steps**:
  1. (Assumes UAT-SHELL-003 left state as `awaiting`)
  2. Run the write command:
     ```bash
     printf 'busy\n' > ./logs/state/jobfinder.state
     ```
  3. Immediately query the API
- **Command**:
  ```bash
  curl -sS 'http://127.0.0.1:8788/status' | jq '.agents[] | select(.name=="jobfinder") | {name, state}'
  ```
- **Expected Result**: `{"name": "jobfinder", "state": "busy"}`
- [x] Pass <!-- 2026-06-06 -->

---

## API Tests

### UAT-API-001: `/status` returns `awaiting` state in agent payload

- **Endpoint**: `GET /status`
- **Description**: Verify the status endpoint surfaces `state: "awaiting"` when the agent's state file contains `awaiting`.
- **Steps**:
  1. Write the awaiting state: `printf 'awaiting\n' > ./logs/state/jobfinder.state`
  2. Run the curl command below
- **Command**:
  ```bash
  curl -sS 'http://127.0.0.1:8788/status' | jq '.agents[] | select(.name=="jobfinder") | .state'
  ```
- **Expected Result**: `"awaiting"`
- [x] Pass <!-- 2026-06-06 -->

### UAT-API-002: `/status` full response shape includes agent with awaiting state

- **Endpoint**: `GET /status`
- **Description**: Full response structure is intact (`session`, `sessionAlive`, `agents[]`, `timestamp`) when one agent is in `awaiting` state.
- **Steps**:
  1. Ensure `./logs/state/jobfinder.state` contains `awaiting` (from UAT-API-001)
  2. Run the curl command below
- **Command**:
  ```bash
  curl -sS 'http://127.0.0.1:8788/status' | jq '{session, sessionAlive, timestamp, agent_states: [.agents[] | {name, state}]}'
  ```
- **Expected Result**: JSON object with `session` string, `sessionAlive` boolean, `timestamp` ISO string, and `agent_states` array containing an entry with `"name": "jobfinder"` and `"state": "awaiting"`
- [x] Pass <!-- 2026-06-06 -->

---

## UI Tests

### UAT-UI-001: Awaiting state renders flashing `!` icon on accordion header

- **Page**: `http://localhost:4321` (or whichever port Astro dev server uses)
- **Description**: When `jobfinder.state` contains `awaiting`, the agent's accordion header shows a flashing `!` icon with the `.flash` and `.awaiting-icon` CSS classes applied.
- **Steps**:
  1. Ensure `./logs/state/jobfinder.state` contains `awaiting`
  2. Open the dashboard UI in a browser
  3. Locate the `jobfinder` accordion row
  4. Inspect the accordion `<summary>` element
- **Expected Result**: A `<span>` with classes `flash awaiting-icon`, `aria-live="polite"`, `aria-label="Awaiting user input"`, and text content `!` is visible alongside the status badge. The `!` blinks (opacity cycles 1 → 0 → 1 with a 1 s animation).
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-06 -->

### UAT-UI-002: Awaiting badge renders with yellow colour scheme

- **Page**: `http://localhost:4321`
- **Description**: The status badge for an `awaiting` agent uses the `.status-awaiting` CSS class (yellow background, distinct from the amber `.status-empty`).
- **Steps**:
  1. Ensure `./logs/state/jobfinder.state` contains `awaiting`
  2. Open the dashboard UI
  3. Locate the `jobfinder` status badge
- **Expected Result**: The badge displays the text `awaiting` and uses the `.status-awaiting` class (background `#fef9c3`, text `#713f12`, dot `#ca8a04`). It is visually distinct from the amber `.status-empty` badge.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-06 -->

### UAT-UI-003: Flash icon disappears when state reverts to `busy`

- **Page**: `http://localhost:4321`
- **Description**: Writing `busy` to the state file causes the flashing `!` to disappear from the accordion header within 3 seconds (SSE push or next poll).
- **Steps**:
  1. Ensure `./logs/state/jobfinder.state` contains `awaiting` and the `!` icon is visible (from UAT-UI-001)
  2. Write busy: `printf 'busy\n' > ./logs/state/jobfinder.state`
  3. Wait up to 3 seconds, observe the accordion header
- **Expected Result**: The flashing `!` icon is no longer visible; the badge changes from `awaiting` to `busy` (blue).
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-06 -->

### UAT-UI-004: Flash icon has accessible ARIA attributes

- **Page**: `http://localhost:4321`
- **Description**: The flash `!` element must carry `aria-live="polite"` and `aria-label="Awaiting user input"` for screen-reader accessibility.
- **Steps**:
  1. Ensure `./logs/state/jobfinder.state` contains `awaiting`
  2. Open the dashboard UI
  3. Using browser DevTools, inspect the `<span class="flash awaiting-icon">` element
- **Expected Result**: The element has `aria-live="polite"` and `aria-label="Awaiting user input"` attributes set.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-06 -->

---

## Edge Case Tests

### UAT-EDGE-001: `AWAITING_PATTERN` matches lines ending with `?`

- **Description**: A pane last-line ending with `?` should satisfy the pattern regex used by `monitor.sh`.
- **Steps**:
  1. Source the conf and test the regex:
- **Command**:
  ```bash
  bash -c 'source ./conductor.conf; printf "Do you want to continue?\n" | grep -qE "$AWAITING_PATTERN" && echo MATCH || echo NO_MATCH'
  ```
- **Expected Result**: `MATCH`
- [x] Pass <!-- 2026-06-06 -->

### UAT-EDGE-002: `AWAITING_PATTERN` matches `[Y/n]` prompt

- **Command**:
  ```bash
  bash -c 'source ./conductor.conf; printf "Overwrite file? [Y/n]\n" | grep -qE "$AWAITING_PATTERN" && echo MATCH || echo NO_MATCH'
  ```
- **Expected Result**: `MATCH`
- [x] Pass <!-- 2026-06-06 -->

### UAT-EDGE-003: `AWAITING_PATTERN` matches `[y/N]` prompt

- **Command**:
  ```bash
  bash -c 'source ./conductor.conf; printf "Delete all records? [y/N]\n" | grep -qE "$AWAITING_PATTERN" && echo MATCH || echo NO_MATCH'
  ```
- **Expected Result**: `MATCH`
- [x] Pass <!-- 2026-06-06 -->

### UAT-EDGE-004: `AWAITING_PATTERN` matches line ending with `>`

- **Command**:
  ```bash
  bash -c 'source ./conductor.conf; printf "Enter value >\n" | grep -qE "$AWAITING_PATTERN" && echo MATCH || echo NO_MATCH'
  ```
- **Expected Result**: `MATCH`
- [x] Pass <!-- 2026-06-06 -->

### UAT-EDGE-005: `AWAITING_PATTERN` does NOT match a plain working line

- **Description**: A normal mid-task output line should not trigger the awaiting heuristic.
- **Command**:
  ```bash
  bash -c 'source ./conductor.conf; printf "Running tests...\n" | grep -qE "$AWAITING_PATTERN" && echo MATCH || echo NO_MATCH'
  ```
- **Expected Result**: `NO_MATCH`
- [x] Pass <!-- 2026-06-06 -->

### UAT-EDGE-006: State file with `awaiting` value is read correctly (no trailing whitespace issues)

- **Description**: `readAgentState` trims the file content; a state file written with a trailing newline still returns `"awaiting"`.
- **Steps**:
  1. Write state with newline: `printf 'awaiting\n' > ./logs/state/jobfinder.state`
  2. Query API
- **Command**:
  ```bash
  curl -sS 'http://127.0.0.1:8788/status' | jq '.agents[] | select(.name=="jobfinder") | .state'
  ```
- **Expected Result**: `"awaiting"` (not `"awaiting\n"` or `"awaiting "`)
- [x] Pass <!-- 2026-06-06 -->

---

## Integration Tests

### UAT-INT-001: State file change propagates to UI via SSE within 3 seconds

- **Components**: state file → dashboard server SSE poller → EventSource in AgentList.tsx → React state → DOM
- **Description**: An `awaiting` written to the state file triggers an `agent-update` SSE event that updates the UI without a page refresh.
- **Steps**:
  1. Open the dashboard UI in a browser and confirm `jobfinder` is showing `busy` or `idle`
  2. Write `awaiting` to the state file:
     ```bash
     printf 'awaiting\n' > ./logs/state/jobfinder.state
     ```
  3. Watch the `jobfinder` accordion header without refreshing the page
  4. Within 3 seconds, the badge should change to `awaiting` and the flashing `!` should appear
  5. Write `busy` back:
     ```bash
     printf 'busy\n' > ./logs/state/jobfinder.state
     ```
  6. Within 3 seconds, the `!` disappears and the badge returns to `busy`
- **Expected Result**: Both transitions (to `awaiting` and back to `busy`) complete within 3 seconds of writing the state file, with no page refresh required.
- [FAIL: auto-judge: manual test requires human verification] <!-- 2026-06-06 -->
