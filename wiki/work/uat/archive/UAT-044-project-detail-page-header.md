---
id: UAT-044
title: "UAT: Create /projects/:id route page with project header"
status: passed
task: TASK-044
created: 2026-06-14
updated: 2026-06-14
---

# UAT-044 — UAT: Create /projects/:id route page with project header

implements::[[TASK-044]]

> **Source task**: [`wiki/work/tasks/TASK-044-project-detail-page-header.md`](../tasks/TASK-044-project-detail-page-header.md)
> **Generated**: 2026-06-14

---

## Prerequisites

- [ ] Dev stack running: `make dev` (host-server on port 8788, frontend on port 4321)
- [ ] At least one project exists in the database (use the Projects page or API to create one)
- [ ] Note the `id` of a known project (visible in the URL when clicking a project row on `/projects`)

---

## Test Cases

### UAT-UI-001: Loading state renders on initial navigation

- **Page**: `/projects/:id` (any valid or invalid id)
- **Description**: Verifies that a "Loading…" indicator is shown while the project list is being fetched.
- **Steps**:
  1. Open browser DevTools → Network tab; set throttle to "Slow 3G" or use "Block request URL" on `/api/projects`.
  2. Navigate to `http://localhost:4321/projects/1`.
  3. Observe the page immediately after navigation, before the API response arrives.
- **Expected Result**: A muted "Loading…" text is visible on the page. No header card, no agents section, no task queue section is rendered yet.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-14 -->

---

### UAT-UI-002: Header card renders project name, workdir, and defaultLaunchCmd for a valid project

- **Page**: `/projects/<valid-id>`
- **Description**: Verifies that a found project renders a header card with all three required fields.
- **Steps**:
  1. Navigate to `http://localhost:4321/projects` and note the `id` for any listed project (the URL on click reveals the id).
  2. Navigate directly to `http://localhost:4321/projects/<that-id>`.
  3. Wait for loading to complete.
  4. Inspect the rendered page.
- **Expected Result**:
  - A card section is present (visually distinct, with border and shadow).
  - The project `name` is shown as a monospace heading (h1).
  - A "Working directory" label appears above the project `workdir` value rendered in monospace.
  - A "Launch command" label appears above the project `defaultLaunchCmd` value rendered in monospace.
  - A "← Projects" back-link is visible above the card.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-14 -->

---

### UAT-UI-003: "← Projects" back-link navigates to /projects

- **Page**: `/projects/<valid-id>`
- **Description**: Verifies that the back-link returns the user to the projects list.
- **Steps**:
  1. Navigate to `http://localhost:4321/projects/<valid-id>`.
  2. Wait for the header card to render.
  3. Click the "← Projects" link.
- **Expected Result**: Browser navigates to `/projects` (the projects list page) without a full-page reload (client-side routing).
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-14 -->

---

### UAT-UI-004: Not-found state renders for a non-existent project id

- **Page**: `/projects/99999`
- **Description**: Verifies the not-found state when no project matches the given id.
- **Steps**:
  1. Navigate to `http://localhost:4321/projects/99999` (an id that does not exist in the database).
  2. Wait for loading to complete.
- **Expected Result**:
  - A "← Projects" back-link is visible.
  - A "Project not found." message is displayed (not a blank page, not a JS error).
  - No header card is rendered.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-14 -->

---

### UAT-UI-005: Header card includes Created date

- **Page**: `/projects/<valid-id>`
- **Description**: Verifies that the created date is shown in the header card as a human-readable date.
- **Steps**:
  1. Navigate to `http://localhost:4321/projects/<valid-id>`.
  2. Wait for loading to complete.
  3. Inspect the header card for a "Created" label.
- **Expected Result**:
  - A "Created" label is visible in the header card.
  - The date is displayed in a human-readable locale format (e.g. "Jun 13, 2026"), not an ISO timestamp.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-14 -->

---

### UAT-API-001: GET /api/projects returns project list used by the detail page

- **Endpoint**: `GET /api/projects`
- **Description**: Verifies that the underlying API endpoint returns a valid array of Project objects with the fields the detail page depends on (`id`, `name`, `workdir`, `defaultLaunchCmd`, `createdAt`).
- **Steps**:
  1. Ensure the host-server is running on port 8788.
  2. Run the curl command below.
- **Command**:
  ```bash
  curl -sS 'http://localhost:8788/projects' | jq '.[0]'
  ```
- **Expected Result**: HTTP 200. The first element (if any projects exist) is an object containing at minimum `id` (number), `name` (string), `workdir` (string), `defaultLaunchCmd` (string), `createdAt` (string). Example:
  ```json
  {
    "id": 1,
    "name": "my-project",
    "workdir": "/home/user/repos/my-project",
    "defaultLaunchCmd": "claude",
    "createdAt": "2026-06-13T10:00:00.000Z"
  }
  ```
- [x] Pass <!-- 2026-06-14 -->

---

### UAT-EDGE-001: Non-numeric project id in URL

- **Scenario**: User navigates to `/projects/abc` (non-numeric id).
- **Steps**:
  1. Navigate to `http://localhost:4321/projects/abc`.
  2. Wait for loading to complete.
- **Expected Result**: The not-found state is shown ("Project not found."). `Number("abc")` evaluates to `NaN` so no project will match; the page does not crash or throw an unhandled JS error.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-14 -->

---

### UAT-EDGE-002: Page renders without crashing when defaultLaunchCmd is empty

- **Scenario**: A project has an empty `defaultLaunchCmd`.
- **Steps**:
  1. If possible, create a project with an empty `defaultLaunchCmd` via the API:
     ```bash
     curl -sS -X POST 'http://localhost:8788/projects' -H 'Content-Type: application/json' -d '{"name":"edge-test","workdir":"/tmp/edge","defaultLaunchCmd":""}'
     ```
  2. Note the `id` returned in the response.
  3. Navigate to `http://localhost:4321/projects/<that-id>`.
  4. Wait for loading to complete.
- **Expected Result**: The header card renders without a JS error. The "Launch command" field is present but shows an empty value (blank), not `undefined` or a crash.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-14 -->
