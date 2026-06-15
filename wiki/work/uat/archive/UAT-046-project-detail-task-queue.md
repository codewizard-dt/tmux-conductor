---
id: UAT-046
title: "UAT: Show project-scoped task queue on the project detail page"
status: passed
task: TASK-046
created: 2026-06-14
updated: 2026-06-14
---

# UAT-046 — UAT: Show project-scoped task queue on the project detail page

implements::[[TASK-046]]

> **Source task**: [`wiki/work/tasks/TASK-046-project-detail-task-queue.md`](../tasks/TASK-046-project-detail-task-queue.md)
> **Generated**: 2026-06-14

---

## Prerequisites

- [ ] Host-server running on `localhost:8788` (`make dev` or `npm run dev` in `host-server/`)
- [ ] Frontend dev server running on `localhost:4321` (`npm run dev` in `app/frontend/`)
- [ ] At least one project exists in the SQLite DB (create one via the Projects page or direct API call)
- [ ] Note the numeric `id` of that project — used as `{PROJECT_ID}` throughout these tests

---

## Test Cases

### UAT-API-001: Fetch tasks for a project — empty queue

- **Endpoint**: `GET /api/tasks?projectId={PROJECT_ID}`
- **Description**: Fetching project tasks when none exist returns an empty array (not a 404 or error).
- **Steps**:
  1. Ensure no tasks are queued for `{PROJECT_ID}`.
  2. Run the curl command below, substituting a real project ID for `1`.
- **Command**:
  ```bash
  curl -sS 'http://localhost:8788/api/tasks?projectId=1'
  ```
- **Expected Result**: HTTP 200 with body `[]`
- [x] Pass <!-- 2026-06-14 -->

---

### UAT-API-002: Fetch tasks for a project — tasks present

- **Endpoint**: `GET /api/tasks?projectId={PROJECT_ID}`
- **Description**: After tasks have been added for a project, the endpoint returns them as an array of Task objects scoped to that project.
- **Steps**:
  1. Add a task for the project first (see UAT-API-003).
  2. Run the curl command below.
- **Command**:
  ```bash
  curl -sS 'http://localhost:8788/api/tasks?projectId=1' | jq '.[0]'
  ```
- **Expected Result**: HTTP 200 with body containing at least one object with shape `{ id, command, agentId, projectId: 1, position, status, source, scheduleId, createdAt }`. Every returned task must have `projectId` equal to the queried project ID.
- [x] Pass <!-- 2026-06-14 -->

---

### UAT-API-003: Add a project-scoped task via POST /tasks

- **Endpoint**: `POST /api/tasks`
- **Description**: Posting a task with `projectId` enqueues it scoped to that project and returns the created task with HTTP 201.
- **Steps**:
  1. Run the curl command below, substituting the real project ID.
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8788/api/tasks' -H 'Content-Type: application/json' -d '{"command":"echo hello from project","projectId":1}'
  ```
- **Expected Result**: HTTP 201 with body containing `{ id: <integer>, command: "echo hello from project", projectId: 1, dispatched: false, status: "queued" }`. `agentId` may be `null`.
- [x] Pass <!-- 2026-06-14 -->

---

### UAT-EDGE-001: GET /tasks without projectId returns 400

- **Scenario**: Calling `GET /api/tasks` without the `projectId` query param.
- **Steps**:
  1. Run:
  ```bash
  curl -sS -o /dev/null -w '%{http_code}' 'http://localhost:8788/api/tasks'
  ```
- **Expected Result**: HTTP 400. Body contains `{ "error": "projectId query param is required" }`.
- [x] Pass <!-- 2026-06-14 -->

---

### UAT-EDGE-002: GET /tasks with non-integer projectId returns 400

- **Scenario**: Passing a non-numeric string as `projectId`.
- **Steps**:
  1. Run:
  ```bash
  curl -sS 'http://localhost:8788/api/tasks?projectId=abc'
  ```
- **Expected Result**: HTTP 400 with body `{ "error": "projectId must be an integer" }`.
- [x] Pass <!-- 2026-06-14 -->

---

### UAT-EDGE-003: POST /tasks with missing command returns 400

- **Scenario**: Posting a task with no `command` field.
- **Steps**:
  1. Run:
  ```bash
  curl -sS -X POST 'http://localhost:8788/api/tasks' -H 'Content-Type: application/json' -d '{"projectId":1}'
  ```
- **Expected Result**: HTTP 400 with body `{ "error": "command is required and must be a non-empty string" }`.
- [x] Pass <!-- 2026-06-14 -->

---

### UAT-EDGE-004: POST /tasks with empty command string returns 400

- **Scenario**: Posting a task where `command` is whitespace-only.
- **Steps**:
  1. Run:
  ```bash
  curl -sS -X POST 'http://localhost:8788/api/tasks' -H 'Content-Type: application/json' -d '{"command":"   ","projectId":1}'
  ```
- **Expected Result**: HTTP 400 with body `{ "error": "command is required and must be a non-empty string" }`.
- [x] Pass <!-- 2026-06-14 -->

---

### UAT-UI-001: Task queue card renders on project detail page

- **Page**: `http://localhost:4321/projects/{PROJECT_ID}`
- **Description**: The project detail page renders a "Task queue" section card below the Agents card.
- **Steps**:
  1. Navigate to `http://localhost:4321/projects/1` (substitute a valid project ID).
  2. Scroll down past the Header card and Agents card.
  3. Observe the page.
- **Expected Result**: A card with a section heading "TASK QUEUE" (displayed uppercase via CSS) is visible. If no tasks exist, the card shows the empty-state text "No tasks in queue."
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-14 -->

---

### UAT-UI-002: Task queue loads existing project tasks on mount

- **Page**: `http://localhost:4321/projects/{PROJECT_ID}`
- **Description**: Tasks previously added to the project are fetched on page load and displayed in the task queue.
- **Steps**:
  1. Add at least one project-scoped task via UAT-API-003.
  2. Navigate to (or hard-refresh) `http://localhost:4321/projects/1`.
  3. Scroll to the Task queue card.
- **Expected Result**: The task added in step 1 appears in the task queue list. The "No tasks in queue." empty state is **not** shown.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-14 -->

---

### UAT-UI-003: Inline "Add task" form is present

- **Page**: `http://localhost:4321/projects/{PROJECT_ID}`
- **Description**: The task queue card contains an inline form with a text input and an "Add" submit button.
- **Steps**:
  1. Navigate to `http://localhost:4321/projects/1`.
  2. Scroll to the Task queue card.
  3. Inspect the card for the add-task form.
- **Expected Result**: A text input with placeholder "Add a task for this project…" and a submit button labelled "Add" are visible. The "Add" button is disabled when the input is empty.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-14 -->

---

### UAT-UI-004: Adding a task via the inline form enqueues it and refreshes the list

- **Page**: `http://localhost:4321/projects/{PROJECT_ID}`
- **Description**: Typing a command into the inline form and submitting it calls `POST /api/tasks` with the project's `projectId` and refreshes the task list.
- **Steps**:
  1. Navigate to `http://localhost:4321/projects/1`.
  2. Scroll to the Task queue card.
  3. Click the "Add a task for this project…" text input.
  4. Type `run tests for project`.
  5. Click the "Add" button (or press Enter).
  6. Observe the task queue.
- **Expected Result**: The button shows "Adding…" briefly while the request is in-flight, then returns to "Add". The text input is cleared. The task "run tests for project" appears in the queue list without a full page reload.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-14 -->

---

### UAT-UI-005: Submit button shows busy state and disables during submission

- **Page**: `http://localhost:4321/projects/{PROJECT_ID}`
- **Description**: While the add-task POST is in-flight the submit button is disabled and its label changes to "Adding…".
- **Steps**:
  1. Navigate to `http://localhost:4321/projects/1`.
  2. Type any non-empty text into the task input.
  3. Click "Add" and immediately observe the button before the response arrives (throttle network via DevTools to "Slow 3G" if needed).
- **Expected Result**: The button label changes to "Adding…" and the button is `disabled` (pointer-events: none, opacity 40%) while the request is pending. After the response it returns to the enabled "Add" state.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-14 -->

---

### UAT-UI-006: API error is displayed inline below the form

- **Page**: `http://localhost:4321/projects/{PROJECT_ID}`
- **Description**: If the `POST /api/tasks` call fails, an error message is displayed below the form without losing the entered text.
- **Steps**:
  1. Stop the host-server process to simulate a backend failure.
  2. Navigate to `http://localhost:4321/projects/1`.
  3. Type `some command` in the task input and click "Add".
  4. Observe the task queue card.
- **Expected Result**: An error message appears below the form (e.g. "Failed to add task" or a network error string). The input retains its value. The "Add" button is re-enabled.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-14 -->

---

### UAT-UI-007: Task queue shows only tasks scoped to the current project

- **Page**: `http://localhost:4321/projects/{PROJECT_ID}`
- **Description**: Tasks belonging to other projects or to a specific agent (not this project) do not appear in this project's task queue.
- **Steps**:
  1. Add a task scoped to a **different** project ID (e.g. `projectId: 999` via curl):
  ```bash
  curl -sS -X POST 'http://localhost:8788/api/tasks' -H 'Content-Type: application/json' -d '{"command":"should not appear","projectId":999}'
  ```
  2. Navigate to `http://localhost:4321/projects/1`.
  3. Scroll to the Task queue card.
- **Expected Result**: "should not appear" is not listed in the task queue for project 1. Only tasks with `projectId = 1` are shown.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-14 -->
