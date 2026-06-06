# UAT: Add-task Form + Drag-to-Reorder

> **Source task**: [`.docs/tasks/028-add-task-drag-reorder.md`](../tasks/028-add-task-drag-reorder.md)
> **Generated**: 2026-06-06

---

## Prerequisites

- [ ] Dashboard server running on `http://127.0.0.1:8788` (`node scripts/dashboard/server/index.js` or via `docker-compose`)
- [ ] At least one agent registered in `conductor.conf` (e.g. `general-purpose`)
- [ ] `scripts/dashboard/ui/` dependencies installed (`npm install` in that directory)
- [ ] `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` present in `scripts/dashboard/ui/node_modules`

---

## API Tests

### UAT-API-001: POST /queue/:agent — add a task (happy path)
- **Endpoint**: `POST /queue/:agent`
- **Description**: Verify a task string is appended to the agent's queue and the response includes the stored line.
- **Steps**:
  1. Run the curl command below as-is (substituting a real agent name from `conductor.conf` for `general-purpose` if needed)
- **Command**:
  ```bash
  curl -sS -X POST 'http://127.0.0.1:8788/queue/general-purpose' -H 'Content-Type: application/json' -d '{"task":"write unit tests for dispatch.sh"}'
  ```
- **Expected Result**: `200 OK` with `{"ok":true,"line":"general-purpose: write unit tests for dispatch.sh"}`
- [x] Pass <!-- 2026-06-06 -->

### UAT-API-002: POST /queue/:agent — empty task rejected
- **Endpoint**: `POST /queue/:agent`
- **Description**: Verify that an empty or whitespace-only task string is rejected with 400.
- **Steps**:
  1. Run the curl command below as-is
- **Command**:
  ```bash
  curl -sS -X POST 'http://127.0.0.1:8788/queue/general-purpose' -H 'Content-Type: application/json' -d '{"task":"   "}'
  ```
- **Expected Result**: `400 Bad Request` with `{"error":"task is required and must be a non-empty string"}`
- [x] Pass <!-- 2026-06-06 -->

### UAT-API-003: POST /queue/:agent — missing task field rejected
- **Endpoint**: `POST /queue/:agent`
- **Description**: Verify that a request body with no `task` field is rejected with 400.
- **Steps**:
  1. Run the curl command below as-is
- **Command**:
  ```bash
  curl -sS -X POST 'http://127.0.0.1:8788/queue/general-purpose' -H 'Content-Type: application/json' -d '{}'
  ```
- **Expected Result**: `400 Bad Request` with `{"error":"task is required and must be a non-empty string"}`
- [x] Pass <!-- 2026-06-06 -->

### UAT-API-004: GET /queue/:agent — tasks visible after add
- **Endpoint**: `GET /queue/:agent`
- **Description**: Verify the queue contains the task added in UAT-API-001 (data created by that test).
- **Steps**:
  1. Ensure UAT-API-001 has been run first
  2. Run the curl command below as-is
- **Command**:
  ```bash
  curl -sS 'http://127.0.0.1:8788/queue/general-purpose'
  ```
- **Expected Result**: `200 OK` with `{"agent":"general-purpose","tasks":[...]}` where the `tasks` array contains `"write unit tests for dispatch.sh"` (the task added in UAT-API-001).
- [x] Pass <!-- 2026-06-06 -->

### UAT-API-005: POST /queue/:agent — add a second task for reorder testing
- **Endpoint**: `POST /queue/:agent`
- **Description**: Add a second task so the reorder endpoint has at least two items to work with.
- **Steps**:
  1. Run the curl command below as-is
- **Command**:
  ```bash
  curl -sS -X POST 'http://127.0.0.1:8788/queue/general-purpose' -H 'Content-Type: application/json' -d '{"task":"refactor monitor.sh loop"}'
  ```
- **Expected Result**: `200 OK` with `{"ok":true,"line":"general-purpose: refactor monitor.sh loop"}`
- [x] Pass <!-- 2026-06-06 -->

### UAT-API-006: PUT /queue/:agent/reorder — reorder two tasks (happy path)
- **Endpoint**: `PUT /queue/:agent/reorder`
- **Description**: Verify that sending `order: [1, 0]` swaps the two tasks and the server persists the new order.
- **Steps**:
  1. Ensure UAT-API-001 and UAT-API-005 have been run so the agent has exactly two tasks
  2. Run the curl command below as-is
- **Command**:
  ```bash
  curl -sS -X PUT 'http://127.0.0.1:8788/queue/general-purpose/reorder' -H 'Content-Type: application/json' -d '{"order":[1,0]}'
  ```
- **Expected Result**: `200 OK` with `{"ok":true}`
- [x] Pass <!-- 2026-06-06 -->

### UAT-API-007: GET /queue/:agent — confirm new order persisted
- **Endpoint**: `GET /queue/:agent`
- **Description**: Verify the queue reflects the swap done in UAT-API-006.
- **Steps**:
  1. Ensure UAT-API-006 has been run
  2. Run the curl command below as-is
- **Command**:
  ```bash
  curl -sS 'http://127.0.0.1:8788/queue/general-purpose'
  ```
- **Expected Result**: `200 OK` with `tasks` array where index 0 is `"refactor monitor.sh loop"` and index 1 is `"write unit tests for dispatch.sh"` (the order is reversed from UAT-API-004).
- [x] Pass <!-- 2026-06-06 -->

### UAT-API-008: PUT /queue/:agent/reorder — wrong-length order rejected
- **Endpoint**: `PUT /queue/:agent/reorder`
- **Description**: Verify that an `order` array shorter than the agent's task count is rejected with 400.
- **Steps**:
  1. Ensure the agent has at least 2 tasks (from UAT-API-001 + UAT-API-005)
  2. Run the curl command below as-is
- **Command**:
  ```bash
  curl -sS -X PUT 'http://127.0.0.1:8788/queue/general-purpose/reorder' -H 'Content-Type: application/json' -d '{"order":[0]}'
  ```
- **Expected Result**: `400 Bad Request` with an `error` field containing text like `"order must be an array of 2 valid indices"`
- [x] Pass <!-- 2026-06-06 -->

### UAT-API-009: PUT /queue/:agent/reorder — out-of-range index rejected
- **Endpoint**: `PUT /queue/:agent/reorder`
- **Description**: Verify that an `order` array containing an index >= task count is rejected with 400.
- **Steps**:
  1. Ensure the agent has exactly 2 tasks
  2. Run the curl command below as-is
- **Command**:
  ```bash
  curl -sS -X PUT 'http://127.0.0.1:8788/queue/general-purpose/reorder' -H 'Content-Type: application/json' -d '{"order":[0,99]}'
  ```
- **Expected Result**: `400 Bad Request` with an `error` field referencing the invalid index range.
- [x] Pass <!-- 2026-06-06 -->

---

## UI Tests

### UAT-UI-001: AddTaskForm renders inside agent accordion
- **Page**: `http://localhost:4321/` (Astro dev server)
- **Description**: Verify the AddTaskForm component is visible in the agent's accordion body after TASK-027+028 integration is complete. (Note: integration into AgentList.tsx is a post-028 step — this test applies once integration is done.)
- **Steps**:
  1. Start the Astro dev server: `npm run dev` in `scripts/dashboard/ui/`
  2. Open `http://localhost:4321/` in a browser
  3. Expand an agent accordion section
  4. Look for a text input with placeholder "New task…" and an "Add" button
- **Expected Result**: An input field labelled "New task…" and a blue "Add" button are visible in the accordion body.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-06 -->

### UAT-UI-002: AddTaskForm — add a task updates the list without page reload
- **Page**: `http://localhost:4321/`
- **Description**: Verify typing a task and clicking Add calls `POST /queue/:agent`, clears the input, and the new task appears without a full page reload.
- **Steps**:
  1. Expand an agent accordion section
  2. Type `"implement SSE reconnect"` in the input field
  3. Click the "Add" button (or press Enter)
  4. Observe the input field and the task list
- **Expected Result**: The input clears immediately after submission. The new task `"implement SSE reconnect"` appears in the task list. No full page reload occurs.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-06 -->

### UAT-UI-003: AddTaskForm — empty input keeps Add button disabled
- **Page**: `http://localhost:4321/`
- **Description**: Verify the "Add" button is disabled (or submission is blocked) when the input is empty or whitespace-only.
- **Steps**:
  1. Expand an agent accordion section
  2. Leave the task input empty (or type only spaces)
  3. Attempt to click the "Add" button or press Enter
- **Expected Result**: The "Add" button is visually disabled (opacity 0.5) and no POST request is sent.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-06 -->

### UAT-UI-004: AddTaskForm — server error displayed inline
- **Page**: `http://localhost:4321/`
- **Description**: Verify that when the server returns an error, an inline error message appears below the form.
- **Steps**:
  1. Stop the dashboard server so requests fail
  2. Expand an agent accordion section
  3. Type a task and click "Add"
  4. Observe the area below the form
- **Expected Result**: A red error message appears below the Add button (e.g., "Failed to fetch" or similar network error text). The input is not cleared.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-06 -->

### UAT-UI-005: TaskList — drag handle visible on each task item
- **Page**: `http://localhost:4321/`
- **Description**: Verify each task item in the list renders a drag handle icon (⠿).
- **Steps**:
  1. Ensure the agent has at least two tasks in its queue
  2. Expand the agent accordion section
- **Expected Result**: Each task row shows a ⠿ (braille dots / drag handle) icon to the left of the task text.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-06 -->

### UAT-UI-006: TaskList — drag reorder calls PUT and persists
- **Page**: `http://localhost:4321/`
- **Description**: Verify dragging a task item to a new position sends `PUT /queue/:agent/reorder` and the order persists after page reload.
- **Steps**:
  1. Ensure the agent has at least two tasks (e.g. task A at position 0, task B at position 1)
  2. Drag task B's handle above task A
  3. Release the drag
  4. Observe the list order
  5. Reload the page and re-open the accordion
- **Expected Result**: After the drag, task B appears at position 0 and task A at position 1. After reload, the new order is still shown (confirming server-side persistence).
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-06 -->

### UAT-UI-007: TaskList — empty queue shows "No tasks in queue."
- **Page**: `http://localhost:4321/`
- **Description**: Verify the empty-state message is shown when an agent has no queued tasks.
- **Steps**:
  1. Use an agent with an empty queue, or delete all tasks
  2. Expand that agent's accordion section
- **Expected Result**: The text "No tasks in queue." is displayed inside the accordion body (no crash, no blank space).
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-06 -->

---

## Edge Case Tests

### UAT-EDGE-001: AddTaskForm — whitespace-only task trimmed and rejected client-side
- **Scenario**: User types only spaces in the task input
- **Steps**:
  1. Type `"   "` (three spaces) in the task input
  2. The Add button should appear disabled (value.trim() === '' → disabled)
- **Expected Result**: Button remains disabled; no fetch call is made. This matches the `!value.trim()` check in `AddTaskForm.tsx`.
- [FAIL: auto-judge: manual test requires human verification] <!-- 2026-06-06 -->

### UAT-EDGE-002: TaskList — reorder failure rolls back to original order
- **Scenario**: Server returns an error for the reorder PUT (e.g., server stopped mid-drag)
- **Steps**:
  1. Stop the dashboard server after the page loads and tasks are displayed
  2. Drag a task to a new position
- **Expected Result**: The list optimistically reorders, then snaps back to the original order after the network failure, and a red inline error message appears above the list.
- [FAIL: auto-judge: manual test requires human verification] <!-- 2026-06-06 -->

### UAT-EDGE-003: TaskList — single task has drag handle but reorder is a no-op
- **Scenario**: Agent queue has exactly one task
- **Steps**:
  1. Ensure the agent has exactly one task
  2. Expand the accordion — observe drag handle presence
  3. Attempt to drag the item
- **Expected Result**: The drag handle (⠿) is still visible. Dragging the single item onto itself does nothing (no API call fired, as `active.id === over.id` guard prevents it).
- [FAIL: auto-judge: manual test requires human verification] <!-- 2026-06-06 -->

---

## Integration Tests

### UAT-INT-001: End-to-end add + reorder + persist flow
- **Components**: `AddTaskForm.tsx` → `POST /queue/:agent` → `TaskList.tsx` → `PUT /queue/:agent/reorder` → `GET /queue/:agent`
- **Flow**: Add two tasks via the UI form, then drag-reorder them, then confirm the new order is stored server-side.
- **Steps**:
  1. Open the dashboard at `http://localhost:4321/` with the server running
  2. Expand the `general-purpose` agent accordion
  3. Add task `"task-alpha"` via the form input; confirm it appears in the list
  4. Add task `"task-beta"` via the form input; confirm it appears below task-alpha
  5. Drag task-beta above task-alpha using the ⠿ handle
  6. Confirm the UI shows task-beta at position 0 and task-alpha at position 1
  7. Run: `curl -sS 'http://127.0.0.1:8788/queue/general-purpose'`
- **Expected Result**: The curl response shows `tasks[0]` = `"task-beta"` and `tasks[1]` = `"task-alpha"`, confirming the full round-trip: form → API add → drag → API reorder → persisted state.
- [FAIL: auto-judge: manual test requires human verification] <!-- 2026-06-06 -->
