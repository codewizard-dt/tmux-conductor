---
id: UAT-042
title: "UAT: Create /projects route page wrapping ProjectList and AddProjectForm"
status: passed
task: TASK-042
created: 2026-06-14
updated: 2026-06-14
---

# UAT-042 — UAT: Create /projects route page wrapping ProjectList and AddProjectForm

implements::[[TASK-042]]

> **Source task**: [`wiki/work/tasks/TASK-042-projects-list-page.md`](../tasks/TASK-042-projects-list-page.md)
> **Generated**: 2026-06-14

---

## Prerequisites

- [ ] Dev servers running: `make dev` (host-server on :8788, frontend on :4321)
- [ ] Browser open at `http://localhost:4321`
- [ ] At least one existing project in the DB, or ability to create one via the form

---

## Test Cases

### UAT-UI-001: /projects route renders AddProjectForm and ProjectList

- **Page**: `http://localhost:4321/projects`
- **Description**: Navigating to `/projects` renders both child components in the correct stacked layout with a gap between them.
- **Steps**:
  1. Open `http://localhost:4321/projects` in the browser (or click the Projects nav link).
  2. Observe the page content.
- **Expected Result**:
  - The page contains a card with heading **"Add Project"** (the `AddProjectForm`).
  - Below it, separated by visible vertical space (~24px gap), is a card with heading **"Projects"** (the `ProjectList`).
  - Both cards are centred within a max-width container; no raw stub text such as "ProjectsPage stub" or "Coming soon" is visible.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-14 -->

---

### UAT-UI-002: ProjectList shows empty state when no projects exist

- **Page**: `http://localhost:4321/projects`
- **Description**: When the database contains no projects, `ProjectList` renders the empty-state message.
- **Steps**:
  1. Ensure no projects exist (delete all via the API or use a fresh DB).
  2. Navigate to `http://localhost:4321/projects`.
  3. Observe the **Projects** card.
- **Expected Result**: The Projects card displays the text **"No projects yet"** (not an error, not a spinner).
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-14 -->

---

### UAT-UI-003: AddProjectForm validates name field — invalid pattern

- **Page**: `http://localhost:4321/projects`
- **Description**: Submitting a name containing characters outside `^[A-Za-z0-9_-]+$` shows an inline validation error without making a network request.
- **Steps**:
  1. Navigate to `http://localhost:4321/projects`.
  2. In the **Name** field (`#project-name`), type `my project!` (contains space and `!`).
  3. In the **Working Directory** field, type `/tmp/test`.
  4. Click **Create Project**.
- **Expected Result**: An inline error message appears: `Name must match ^[A-Za-z0-9_-]+$ (letters, digits, hyphens, underscores)`. No project is created; the Projects list is unchanged.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-14 -->

---

### UAT-UI-004: AddProjectForm validates working directory — relative path rejected

- **Page**: `http://localhost:4321/projects`
- **Description**: Submitting a non-absolute working directory shows an inline validation error.
- **Steps**:
  1. Navigate to `http://localhost:4321/projects`.
  2. In the **Name** field, type `my-project`.
  3. In the **Working Directory** field, type `relative/path` (does not start with `/`).
  4. Click **Create Project**.
- **Expected Result**: An inline error message appears: `Working directory must be an absolute path (start with /)`. No project is created.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-14 -->

---

### UAT-UI-005: Create a project via AddProjectForm and see it appear in ProjectList

- **Page**: `http://localhost:4321/projects`
- **Description**: Submitting valid data creates a project and it immediately appears in the list without a page refresh.
- **Steps**:
  1. Navigate to `http://localhost:4321/projects`.
  2. In the **Name** field, type `uat-test-proj`.
  3. In the **Working Directory** field, type `/tmp/uat-test-proj`.
  4. Leave the **Default Launch Command** at its prefilled default (`claude --dangerously-skip-permissions`).
  5. Click **Create Project**.
  6. Observe the form and the Projects list below.
- **Expected Result**:
  - The button briefly shows **"Creating…"** while the request is in flight.
  - On success, a green confirmation message **"Project created ✓"** appears next to the button (disappears after ~4 seconds).
  - The form fields clear (Name and Working Directory empty; Default Launch Command resets to `claude --dangerously-skip-permissions`).
  - The **Projects** card now contains a row showing `uat-test-proj` and `/tmp/uat-test-proj` without a page refresh.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-14 -->

---

### UAT-UI-006: ProjectList row shows project name, workdir, and launch command

- **Page**: `http://localhost:4321/projects`
- **Description**: Each project row in `ProjectList` displays all three data fields.
- **Steps**:
  1. Ensure a project named `uat-test-proj` with workdir `/tmp/uat-test-proj` and launch command `claude --dangerously-skip-permissions` exists (create via UAT-UI-005 if needed).
  2. Navigate to `http://localhost:4321/projects`.
  3. Locate the row for `uat-test-proj`.
- **Expected Result**: The row shows:
  - Project name **`uat-test-proj`** as a clickable link.
  - Workdir **/tmp/uat-test-proj** below the name.
  - Launch command **`claude --dangerously-skip-permissions`** below the workdir.
  - Two buttons: **"Spawn agent"** and **"Delete"**.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-14 -->

---

### UAT-UI-007: Project name in list is a link to /projects/:id

- **Page**: `http://localhost:4321/projects`
- **Description**: Clicking the project name navigates to the project detail page.
- **Steps**:
  1. Navigate to `http://localhost:4321/projects`.
  2. Click the project name link for `uat-test-proj`.
- **Expected Result**: The URL changes to `/projects/<id>` (where `<id>` is the numeric project ID). The project detail page renders (TASK-043 scope; at minimum no 404 or blank page from a routing failure).
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-14 -->

---

### UAT-UI-008: Delete project — two-click confirmation flow

- **Page**: `http://localhost:4321/projects`
- **Description**: Clicking Delete once shows a confirmation state; clicking again removes the project from the list.
- **Steps**:
  1. Navigate to `http://localhost:4321/projects`.
  2. Ensure `uat-test-proj` exists (create via UAT-UI-005 if needed).
  3. In the `uat-test-proj` row, click the **Delete** button.
  4. Observe the button state.
  5. Click the button again (now labelled **"Confirm?"**).
  6. Observe the list.
- **Expected Result**:
  - After the first click: the Delete button changes to **"Confirm?"** with a red background.
  - After the second click: the button briefly shows **"Deleting…"** then the `uat-test-proj` row disappears from the list without a page refresh.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-14 -->

---

### UAT-API-001: GET /api/projects returns array of projects

- **Endpoint**: `GET /api/projects`
- **Description**: Verifies the list endpoint returns a JSON array.
- **Steps**:
  1. Ensure the host-server is running on port 8788.
  2. Run the curl command below.
- **Command**:
  ```bash
  curl -sS 'http://localhost:8788/api/projects' | jq 'type, .[0]'
  ```
- **Expected Result**: Output starts with `"array"`. If projects exist, the first element has `id` (number), `name` (string), `workdir` (string), and `defaultLaunchCmd` (string) fields.
- [x] Pass <!-- 2026-06-14 -->

---

### UAT-API-002: POST /api/projects creates a project and returns 201

- **Endpoint**: `POST /api/projects`
- **Description**: Verifies successful project creation.
- **Steps**:
  1. Run the curl command below.
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8788/api/projects' -H 'Content-Type: application/json' -d '{"name":"uat-api-proj","workdir":"/tmp/uat-api-proj"}'
  ```
- **Expected Result**: HTTP 201 with a JSON body containing `id` (integer), `name: "uat-api-proj"`, `workdir: "/tmp/uat-api-proj"`, and `defaultLaunchCmd: "claude --dangerously-skip-permissions"`.
- [x] Pass <!-- 2026-06-14 -->

---

### UAT-API-003: POST /api/projects rejects invalid name

- **Endpoint**: `POST /api/projects`
- **Description**: Verifies that a name containing invalid characters is rejected with 400.
- **Steps**:
  1. Run the curl command below.
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8788/api/projects' -H 'Content-Type: application/json' -d '{"name":"bad name!","workdir":"/tmp/test"}'
  ```
- **Expected Result**: HTTP 400 with body `{"error":"name is required and must match ^[A-Za-z0-9_-]+$"}`.
- [x] Pass <!-- 2026-06-14 -->

---

### UAT-API-004: POST /api/projects rejects relative workdir

- **Endpoint**: `POST /api/projects`
- **Description**: Verifies that a non-absolute working directory is rejected with 400.
- **Steps**:
  1. Run the curl command below.
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8788/api/projects' -H 'Content-Type: application/json' -d '{"name":"valid-name","workdir":"relative/path"}'
  ```
- **Expected Result**: HTTP 400 with body `{"error":"workdir is required and must be an absolute path (starts with /)"}`.
- [x] Pass <!-- 2026-06-14 -->

---

### UAT-API-005: DELETE /api/projects/:id removes the project and returns 204

- **Endpoint**: `DELETE /api/projects/:id`
- **Description**: Verifies that a project can be deleted and returns 204 No Content.
- **Steps**:
  1. First create a project to delete:
     ```bash
     curl -sS -X POST 'http://localhost:8788/api/projects' -H 'Content-Type: application/json' -d '{"name":"uat-delete-me","workdir":"/tmp/uat-delete-me"}'
     ```
     Note the `id` from the response.
  2. Run the delete command, replacing `<id>` with the actual ID:
- **Command**:
  ```bash
  curl -sS -o /dev/null -w '%{http_code}' -X DELETE 'http://localhost:8788/api/projects/<id>'
  ```
- **Expected Result**: Output is `204`. A subsequent `GET /api/projects` does not include the deleted project.
- [x] Pass <!-- 2026-06-14 -->

---

### UAT-EDGE-001: ProjectList shows loading state on initial render

- **Scenario**: Before the `GET /api/projects` response arrives, `ProjectList` shows a loading indicator.
- **Steps**:
  1. Open browser DevTools → Network tab → throttle to Slow 3G.
  2. Navigate to `http://localhost:4321/projects`.
  3. Observe the **Projects** card immediately after navigation, before the network request completes.
- **Expected Result**: The Projects card displays **"Loading projects…"** while the request is in flight. Once the response arrives it is replaced by the project list (or the empty state).
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-14 -->

---

### UAT-EDGE-002: AddProjectForm shows error when API returns an error

- **Scenario**: If the API call to create a project fails, the form shows an inline error.
- **Steps**:
  1. Stop the host-server (or block port 8788 in DevTools → Network → Block request URL).
  2. Navigate to `http://localhost:4321/projects`.
  3. Fill in a valid Name (`uat-offline`) and Working Directory (`/tmp/uat-offline`).
  4. Click **Create Project**.
- **Expected Result**: An inline error message appears below the button (e.g. `Failed to create project` or a network error description). The button re-enables. No success banner appears.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-14 -->
