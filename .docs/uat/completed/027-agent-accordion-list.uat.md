# UAT: Agent Accordion List

> **Source task**: [`.docs/tasks/027-agent-accordion-list.md`](../tasks/027-agent-accordion-list.md)
> **Generated**: 2026-06-06

---

## Prerequisites

- [ ] Node.js ≥ 22.12 installed
- [ ] Dashboard server dependencies installed: `cd scripts/dashboard/server && npm install`
- [ ] Dashboard UI dependencies installed: `cd scripts/dashboard/ui && npm install`
- [ ] Dashboard server running on port 8788: `node scripts/dashboard/server/index.js` (run from repo root or inside `scripts/dashboard/server/`)
- [ ] Astro dev server running on port 4321: `npm run dev` inside `scripts/dashboard/ui/`
- [ ] `scripts/dashboard/server/conductor.conf` references at least one agent (the file is pre-populated with the repo's `conductor.conf` copy)
- [ ] Scratch directory exists: `mkdir -p ./tmp/uat-027`

---

## API Tests

### UAT-API-001: GET /status returns correct shape
- **Endpoint**: `GET http://127.0.0.1:8788/status`
- **Description**: Verify the `/status` endpoint returns the expected JSON shape with `session`, `sessionAlive`, `agents`, and `timestamp` fields.
- **Steps**:
  1. Ensure the dashboard server is running.
  2. Run the curl command below.
- **Command**:
  ```bash
  curl -sS 'http://127.0.0.1:8788/status' | jq '{session, sessionAlive, timestamp, agent_count: (.agents | length), first_agent: .agents[0]}'
  ```
- **Expected Result**: `200 OK` with a JSON body containing: `session` (string), `sessionAlive` (boolean), `timestamp` (ISO-8601 string), `agents` (array). Each element of `agents` has keys `name` (string), `state` (string), `windowPresent` (boolean), `queuedTasks` (integer ≥ 0).
- [x] Pass <!-- 2026-06-06 -->

### UAT-API-002: GET /status agent state values
- **Endpoint**: `GET http://127.0.0.1:8788/status`
- **Description**: Verify that the `state` field for each agent is one of `idle`, `busy`, `error`, or another string (never `null`/`undefined`). The `queuedTasks` field must be a non-negative integer.
- **Steps**:
  1. Run the curl command below.
- **Command**:
  ```bash
  curl -sS 'http://127.0.0.1:8788/status' | jq '.agents[] | {name, state, queuedTasks, windowPresent}'
  ```
- **Expected Result**: Each agent object printed by `jq` has `state` as a non-null string, `queuedTasks` as an integer ≥ 0, `windowPresent` as a boolean.
- [x] Pass <!-- 2026-06-06 -->

### UAT-API-003: GET /events returns SSE stream
- **Endpoint**: `GET http://127.0.0.1:8788/events`
- **Description**: Verify the `/events` endpoint opens an SSE connection and sends the initial `: connected` comment line.
- **Steps**:
  1. Run the curl command below (it will block; interrupt with Ctrl-C after the first line appears).
- **Command**:
  ```bash
  curl -sS -N 'http://127.0.0.1:8788/events'
  ```
- **Expected Result**: Response has `Content-Type: text/event-stream`. The first line received is `: connected` (SSE comment). Subsequent lines are `: ping` heartbeat comments every ~15 s, and `event: agent-update` or `event: session-update` lines whenever agent state changes.
- [x] Pass <!-- 2026-06-06 -->

---

## UI Tests

### UAT-UI-001: Dashboard page loads without error
- **Page**: `http://localhost:4321/`
- **Description**: Verify the Astro page renders the `AgentList` React component (no blank screen, no JS console errors).
- **Steps**:
  1. Open `http://localhost:4321/` in a browser.
  2. Open browser DevTools → Console tab.
  3. Wait up to 3 seconds for the page to fully load.
- **Expected Result**: Page title is "tmux Conductor Dashboard". The heading "tmux Conductor — Agents" is visible. No uncaught JS errors appear in the console. The old "Dashboard coming soon." placeholder text is absent.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-06 -->

### UAT-UI-002: Accordion renders one item per agent
- **Page**: `http://localhost:4321/`
- **Description**: Verify that one `<details>` accordion element is rendered for each agent returned by `GET /status`.
- **Steps**:
  1. Note the number of agents from `curl -sS 'http://127.0.0.1:8788/status' | jq '.agents | length'`.
  2. Open `http://localhost:4321/`.
  3. Count the number of accordion rows visible on the page.
- **Expected Result**: The number of accordion rows on the page equals the number of agents reported by `/status`. Each row's summary shows the agent name.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-06 -->

### UAT-UI-003: Status badge color for busy agent
- **Page**: `http://localhost:4321/`
- **Description**: Verify that an agent with `state === "busy"` receives the blue `.status-busy` badge.
- **Steps**:
  1. Write `busy` to the state file for an agent: `echo -n busy > <STATE_DIR>/<agent>.state` (check `conductor.conf` for `STATE_DIR` and agent name, e.g. `echo -n busy > /tmp/conductor-state/jobfinder.state`).
  2. Wait up to 3 seconds (SSE poll interval).
  3. Observe the badge next to that agent's name on `http://localhost:4321/`.
- **Expected Result**: The badge reads "busy" and has a blue background (CSS class `status-busy` is present on the badge element). The dot colour is `#2563eb`.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-06 -->

### UAT-UI-004: Status badge color for idle agent with tasks
- **Page**: `http://localhost:4321/`
- **Description**: Verify that an agent with `state === "idle"` and `queuedTasks > 0` receives the green `.status-idle` badge.
- **Steps**:
  1. Write `idle` to the agent state file (`echo -n idle > <STATE_DIR>/<agent>.state`).
  2. Add a queued task for the agent via `curl -sS -X POST 'http://127.0.0.1:8788/queue/<agent>' -H 'Content-Type: application/json' -d '{"task":"UAT test task"}'` (replace `<agent>` with the agent name).
  3. Wait up to 3 seconds, then observe the badge.
- **Expected Result**: The badge reads "idle" and has a green background (CSS class `status-idle`).
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-06 -->

### UAT-UI-005: Status badge color for idle agent with no tasks (amber)
- **Page**: `http://localhost:4321/`
- **Description**: Verify that an agent with `state === "idle"` and `queuedTasks === 0` receives the amber `.status-empty` badge.
- **Steps**:
  1. Write `idle` to the agent state file.
  2. Delete all queued tasks for the agent via the DELETE `/queue/:agent/:index` endpoint until `queuedTasks` is 0, OR use a fresh agent with no tasks.
  3. Wait up to 3 seconds, then observe the badge.
- **Expected Result**: The badge reads "no tasks" and has an amber background (CSS class `status-empty`).
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-06 -->

### UAT-UI-006: Accordion expand/collapse interaction
- **Page**: `http://localhost:4321/`
- **Description**: Verify that clicking an accordion summary toggles the task list body open and closed.
- **Steps**:
  1. Open `http://localhost:4321/`.
  2. Click the summary row of any agent.
  3. Observe whether the body section (showing "Queued tasks") is now visible.
  4. Click the same summary row again.
  5. Observe whether the body section is now hidden.
- **Expected Result**: First click: body opens and shows "Queued tasks (N)" heading and either task items or "No tasks in queue." text. Second click: body collapses and is hidden. No page reload occurs.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-06 -->

### UAT-UI-007: Session-not-running banner
- **Page**: `http://localhost:4321/`
- **Description**: Verify that when `sessionAlive` is `false` and `agents` is empty, a "Session not running" banner is displayed instead of the accordion list.
- **Steps**:
  1. This scenario is best tested with a mock or by temporarily patching the server response. Alternatively, confirm the behavior by inspecting the `AgentList.tsx` source logic directly.
  2. In `AgentList.tsx`, locate the conditional: `if (agents.length === 0 && !sessionAlive)`.
  3. Confirm it renders `<div className="session-banner">Session not running</div>`.
- **Expected Result**: The component renders a banner with text "Session not running" when the session is down and there are no agents to display. (Human verification of source code is acceptable here.)
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-06 -->

### UAT-UI-008: SSE agent-update merges into state without page reload
- **Page**: `http://localhost:4321/`
- **Description**: Verify that when an `agent-update` SSE event arrives, the badge updates in-place within 3 seconds without a full page reload.
- **Steps**:
  1. Open `http://localhost:4321/` and observe an agent currently showing one status.
  2. Change that agent's state file (`echo -n busy > <STATE_DIR>/<agent>.state` or toggle idle ↔ busy).
  3. Wait up to 3 seconds.
- **Expected Result**: The badge for that agent updates to reflect the new state within 3 seconds. The browser URL bar does not change and no page reload indicator appears. All other agent accordions remain unchanged.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-06 -->

---

## Edge Case Tests

### UAT-EDGE-001: AgentList handles server unavailable
- **Scenario**: Dashboard server is not running when the page loads.
- **Steps**:
  1. Stop the dashboard server.
  2. Open (or reload) `http://localhost:4321/`.
  3. Wait up to 5 seconds.
- **Expected Result**: The component does not crash or show a blank screen. It shows an error message beginning with "Failed to load status:" (derived from the `catch` handler in `AgentList.tsx`). The Astro page shell and heading "tmux Conductor — Agents" remain visible.
- [FAIL: auto-judge: manual test requires human verification] <!-- 2026-06-06 -->

### UAT-EDGE-002: getStatusColor helper covers all status values
- **Scenario**: The exported `getStatusColor` helper must return correct hex colors for all five status values.
- **Steps**:
  1. Open browser DevTools Console on `http://localhost:4321/`.
  2. The module is not directly importable from the console; instead verify via source inspection: read `scripts/dashboard/ui/src/components/AgentList.tsx` and confirm the `getStatusColor` switch arms.
- **Expected Result**: `getStatusColor('busy')` → `'#2563eb'`, `getStatusColor('idle')` → `'#16a34a'`, `getStatusColor('empty')` → `'#d97706'`, `getStatusColor('error')` → `'#dc2626'`, `getStatusColor('unknown')` → `'#9ca3af'`. These exact hex values must be present in the source.
- [x] Pass <!-- 2026-06-06 -->

### UAT-EDGE-003: CSS status classes exist in dashboard.css
- **Scenario**: The `.status-busy`, `.status-idle`, `.status-empty`, `.status-error`, `.status-unknown` CSS classes referenced by `AgentList.tsx` must be defined in `dashboard.css`.
- **Steps**:
  1. Read `scripts/dashboard/ui/src/styles/dashboard.css` and confirm all five `.status-*` classes are defined with appropriate `background` and `color` properties.
- **Expected Result**: All five classes (`.status-busy`, `.status-idle`, `.status-empty`, `.status-error`, `.status-unknown`) are present in `dashboard.css`. Each has at least a `background` property.
- [x] Pass <!-- 2026-06-06 -->

### UAT-EDGE-004: EventSource closes on component unmount
- **Scenario**: If the user navigates away (or the component unmounts), the SSE connection must be closed to prevent memory leaks.
- **Steps**:
  1. Verify via source inspection: read `scripts/dashboard/ui/src/components/AgentList.tsx` and confirm that the `useEffect` cleanup function calls `es.close()`.
- **Expected Result**: The `useEffect` in `AgentList` returns a cleanup function that calls `es.close()` on the `EventSource` instance.
- [x] Pass <!-- 2026-06-06 -->

---

## Integration Tests

### UAT-INT-001: Full flow — server state change reflected in browser badge
- **Components**: `scripts/dashboard/server/index.js` (poll-diff loop + SSE broadcast) ↔ `AgentList.tsx` (EventSource listener + React state merge)
- **Flow**: Agent state file changes on disk → server poll detects change → SSE `agent-update` broadcast → browser EventSource listener merges update → badge re-renders
- **Steps**:
  1. Open `http://localhost:4321/` with browser DevTools Network tab open (filter by "events").
  2. Confirm an active SSE connection to `http://127.0.0.1:8788/events` is shown.
  3. Write `busy` to the agent state file on disk.
  4. Observe the Network tab: within 2–3 seconds, a new SSE message line with `event: agent-update` should appear.
  5. Observe the dashboard: the badge for that agent updates to blue "busy".
  6. Write `idle` back to the state file.
  7. Observe within 2–3 seconds: badge updates to amber "no tasks" (or green "idle" if tasks are queued).
- **Expected Result**: State changes are reflected in the browser badge within 3 seconds of the on-disk state file change, with no page reload. The SSE stream in the Network tab shows corresponding `agent-update` events for each change.
- [FAIL: auto-judge: manual test requires human verification] <!-- 2026-06-06 -->

### UAT-INT-002: Build passes cleanly
- **Components**: Astro build pipeline, `AgentList.tsx`, `dashboard.css`
- **Flow**: `npm run build` compiles the Astro project including the new component and CSS import
- **Steps**:
  1. Run the command below from the `scripts/dashboard/ui/` directory.
- **Command**:
  ```bash
  cd scripts/dashboard/ui && npm run build
  ```
- **Expected Result**: Build completes with exit code 0. Output shows `✓ Completed` and `1 page(s) built`. No TypeScript errors, no missing module errors.
- [x] Pass <!-- 2026-06-06 -->
