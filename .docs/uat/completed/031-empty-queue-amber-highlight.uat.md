# UAT: Empty-queue Amber Highlight

> **Source task**: [`.docs/tasks/031-empty-queue-amber-highlight.md`](../tasks/031-empty-queue-amber-highlight.md)
> **Generated**: 2026-06-06

---

## Prerequisites

- [ ] The status API server (`scripts/dashboard/`) is running on `http://127.0.0.1:8788`
- [ ] The Astro dev server is running (`cd scripts/dashboard/ui && npm run dev`) or the built dashboard is accessible
- [ ] At least one agent is registered in the system with `state === 'idle'` and `queuedTasks === 0`
- [ ] The browser devtools (or a DOM snapshot tool) is available for inspecting rendered HTML

---

## API Tests

### UAT-API-001: `/status` returns `queuedTasks: 0` for idle agent with no tasks
- **Endpoint**: `GET /status`
- **Description**: Verify the status endpoint returns an agent with `state: "idle"` and `queuedTasks: 0`, which is the server-side precondition for the amber badge
- **Steps**:
  1. Ensure at least one agent is registered with no queued tasks
  2. Run the curl command below as-is
- **Command**:
  ```bash
  curl -sS 'http://127.0.0.1:8788/status' | jq '.agents[] | {name, state, queuedTasks}'
  ```
- **Expected Result**: At least one agent object where `state` is `"idle"` and `queuedTasks` is `0`
- [x] Pass <!-- 2026-06-06 -->

### UAT-API-002: Adding a task changes `queuedTasks` to 1
- **Endpoint**: `POST /queue/:agent`
- **Description**: Verify that enqueuing a task increments `queuedTasks`, which should cause the badge to leave the amber/empty state
- **Steps**:
  1. Pick an agent name from UAT-API-001 (e.g. `agent-1`)
  2. Run the curl command below, substituting `<agent-name>` with the real agent name
  3. Then re-run the GET from UAT-API-001 to confirm `queuedTasks` is now `1`
- **Command**:
  ```bash
  curl -sS -X POST 'http://127.0.0.1:8788/queue/agent-1' -H 'Content-Type: application/json' -d '{"task":"echo hello"}'
  ```
- **Expected Result**: `{"ok":true,"line":"agent-1: echo hello"}`; a subsequent `GET /status` shows `queuedTasks: 1` for `agent-1`
- [x] Pass <!-- 2026-06-06 test-authoring correction: "command" → "task" -->

---

## UI Tests

### UAT-UI-001: Amber badge renders for idle agent with no queued tasks
- **Page**: Dashboard — agents accordion list (the root page of the Astro UI)
- **Description**: Verify that an agent with `state: "idle"` and `queuedTasks === 0` shows an amber-colored status badge with text "no tasks"
- **Steps**:
  1. Open the dashboard in a browser (default: `http://localhost:4321` for Astro dev, or the built URL)
  2. Locate the accordion entry for an agent that has no queued tasks and is idle
  3. Inspect the status badge in the accordion header
  4. Confirm the badge text reads **"no tasks"**
  5. Confirm the badge has CSS classes `status-badge status-empty`
  6. Confirm the badge background color is amber (`#fef3c7`) and text color is `#92400e`
  7. Confirm the status dot inside the badge is amber (`#d97706`)
- **Expected Result**: Badge displays "no tasks" with amber/yellow styling matching `.status-empty` in `dashboard.css`
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-06 -->

### UAT-UI-002: Amber badge has accessibility attributes
- **Page**: Dashboard — agents accordion list
- **Description**: Verify the badge element carries `title="No queued tasks"` and `aria-label="No queued tasks"` for screen-reader/tooltip accessibility
- **Steps**:
  1. Open the dashboard in a browser
  2. Locate the status badge for an idle agent with no queued tasks
  3. In browser devtools, inspect the `<span class="status-badge status-empty">` element
  4. Confirm the element has `title="No queued tasks"`
  5. Confirm the element has `aria-label="No queued tasks"`
  6. Optionally: hover over the badge to see the native browser tooltip reading "No queued tasks"
- **Expected Result**: The badge span has both `title` and `aria-label` set to `"No queued tasks"`
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-06 -->

### UAT-UI-003: Badge updates from amber to active color when a task is added
- **Page**: Dashboard — agents accordion list
- **Description**: Verify the badge transitions away from amber within ~3 seconds when a task is enqueued (SSE live-update)
- **Steps**:
  1. Open the dashboard. Confirm an agent shows the amber "no tasks" badge
  2. In a separate terminal, enqueue a task for that agent:
     ```bash
     curl -sS -X POST 'http://127.0.0.1:8788/queue/agent-1' -H 'Content-Type: application/json' -d '{"command":"echo hello"}'
     ```
  3. Without refreshing the browser, wait up to 3 seconds and observe the badge
- **Expected Result**: Within 3 seconds, the badge changes from amber "no tasks" to the appropriate state color (green "idle" if the task has not yet been dispatched, or blue "busy" once dispatching begins). The amber color is gone.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-06 -->

### UAT-UI-004: Badge returns to amber when all tasks are cleared
- **Page**: Dashboard — agents accordion list
- **Description**: Verify the badge reverts to amber "no tasks" within ~3 seconds when an agent's queue is drained back to zero tasks
- **Steps**:
  1. Ensure an agent has `queuedTasks >= 1` and is showing a non-amber badge
  2. Delete or drain all tasks for that agent (via the task queue API or by letting the agent process them)
  3. Without refreshing the browser, wait up to 3 seconds and observe the badge
- **Expected Result**: Within 3 seconds of `queuedTasks` reaching `0` (and state remaining `idle`), the badge reverts to amber "no tasks" with CSS class `status-empty`
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-06 -->

---

## Edge Case Tests

### UAT-EDGE-001: Non-empty badge does not carry the "No queued tasks" tooltip
- **Scenario**: Agents with `queuedTasks > 0` (idle with tasks) or `state === 'busy'` must NOT have `title="No queued tasks"` — the attribute is exclusive to the `empty` status
- **Steps**:
  1. Locate an agent in the dashboard that has `queuedTasks > 0` or is `busy`
  2. Inspect its status badge in devtools
- **Expected Result**: The badge `<span>` does NOT have a `title` attribute (or its value is not "No queued tasks"). The `aria-label` is also absent or empty for non-empty statuses.
- [FAIL: auto-judge: manual test requires human verification] <!-- 2026-06-06 -->

### UAT-EDGE-002: CSS class `status-empty` is applied only for the empty state
- **Scenario**: The `status-empty` class (which drives the amber color) must not appear on badges for `busy`, `idle` (with tasks), `error`, or `unknown` agents
- **Steps**:
  1. Ensure the dashboard shows agents in multiple states (busy, idle with tasks, and empty)
  2. In devtools, inspect the badge for each non-empty agent
- **Expected Result**: No badge for a non-`empty` agent has the `status-empty` CSS class. Each badge carries exactly one `status-*` class matching its derived status.
- [FAIL: auto-judge: manual test requires human verification] <!-- 2026-06-06 -->

---

## Integration Tests

### UAT-INT-001: Full lifecycle — empty → busy → empty badge transitions via SSE
- **Components**: `AgentList.tsx` SSE subscription → `deriveStatus()` → `StatusBadge` → `dashboard.css`
- **Flow**: Agent starts idle/empty (amber) → task dispatched (badge goes busy/blue) → task completes, queue empties (badge returns amber)
- **Steps**:
  1. Open the dashboard. Confirm the target agent shows amber "no tasks" badge
  2. Enqueue and dispatch a task to the agent (or wait for the conductor to dispatch one):
     ```bash
     curl -sS -X POST 'http://127.0.0.1:8788/queue/agent-1' -H 'Content-Type: application/json' -d '{"command":"echo integration-test"}'
     ```
  3. Observe the badge change from amber to blue ("busy") as the agent starts work — no page refresh
  4. Once the agent finishes and its state returns to `idle` with `queuedTasks === 0`, observe the badge
- **Expected Result**: Badge progresses amber → blue (busy) → amber, entirely via SSE `agent-update` events with no manual page refresh. Each transition completes within 3 seconds of the server-side state change.
- [FAIL: auto-judge: manual test requires human verification] <!-- 2026-06-06 -->
