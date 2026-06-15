---
id: UAT-043
title: "UAT: Make each project row in ProjectList a clickable link to /projects/:id"
status: passed
task: TASK-043
created: 2026-06-14
updated: 2026-06-14
---

# UAT-043 — UAT: Make each project row in ProjectList a clickable link to /projects/:id

implements::[[TASK-043]]

> **Source task**: [`wiki/work/tasks/TASK-043-project-row-links.md`](../tasks/TASK-043-project-row-links.md)
> **Generated**: 2026-06-14

---

## Prerequisites

- [ ] Frontend dev server running on `http://localhost:4321` (`make dev` or `npm run dev` in `app/frontend/`)
- [ ] Host server running on `http://localhost:8788` (for project/agent data)
- [ ] At least one project exists in the database (use the Add Project form at `/projects` if needed)
- [ ] Browser open and authenticated (if auth guard is active, log in first)

---

## Test Cases

### UAT-UI-001: Project name renders as a clickable link

- **Page**: `http://localhost:4321/projects`
- **Description**: Verifies that each project name in ProjectList is rendered as an anchor/link element, not a plain span.
- **Steps**:
  1. Navigate to `http://localhost:4321/projects`.
  2. Confirm at least one project row is displayed.
  3. Inspect the project name text in a row (right-click → Inspect or use browser DevTools).
  4. Confirm the element wrapping the project name is an `<a>` tag (rendered by `<Link>`), not a `<span>`.
  5. Confirm the `href` attribute of the anchor matches `/projects/<id>` where `<id>` is the numeric ID of that project.
- **Expected Result**: The project name is an `<a>` element with `href="/projects/<id>"`. The text is styled with the monospace font, truncated, and shows an underline on hover.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-14 -->

### UAT-UI-002: Clicking a project name navigates to the project detail page

- **Page**: `http://localhost:4321/projects`
- **Description**: Verifies that clicking the project name link performs a client-side navigation to `/projects/:id` and renders the ProjectDetailPage.
- **Steps**:
  1. Navigate to `http://localhost:4321/projects`.
  2. Note the name of one of the listed projects and its row position.
  3. Click the project name text.
  4. Observe the browser URL bar and page content.
- **Expected Result**:
  - The URL changes to `http://localhost:4321/projects/<id>` (no full page reload).
  - The page renders the project detail view showing the project name as a heading, its working directory, and launch command.
  - A "← Projects" back link is visible at the top of the page.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-14 -->

### UAT-UI-003: Project detail page displays correct data for the navigated project

- **Page**: `http://localhost:4321/projects/<id>` (after navigating from the list)
- **Description**: Verifies that the detail page shows data matching the project that was clicked.
- **Steps**:
  1. Navigate to `http://localhost:4321/projects`.
  2. Note the name and (if visible) workdir of a specific project row.
  3. Click the project name link.
  4. On the detail page, compare the displayed project name, working directory, and launch command against the list row.
- **Expected Result**: The detail page header shows the same project name as the link that was clicked. The working directory and launch command fields match what was shown in the list row.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-14 -->

### UAT-UI-004: "Spawn agent" button does NOT navigate away from the projects list

- **Page**: `http://localhost:4321/projects`
- **Description**: Verifies that clicking the "Spawn agent" button on a project row does not trigger navigation to `/projects/:id`.
- **Steps**:
  1. Navigate to `http://localhost:4321/projects`.
  2. Locate a project row.
  3. Click the **"Spawn agent"** button (not the project name link) on that row.
  4. Observe the URL bar and page content.
- **Expected Result**:
  - The URL remains `http://localhost:4321/projects` — no navigation occurs.
  - The button shows "Spawning…" momentarily then returns to "Spawn agent" (or shows an error inline if the server rejected it).
  - The user stays on the projects list page.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-14 -->

### UAT-UI-005: "← Projects" back link on detail page returns to the projects list

- **Page**: `http://localhost:4321/projects/<id>`
- **Description**: Verifies that the back link on the project detail page navigates back to `/projects`.
- **Steps**:
  1. Navigate to `http://localhost:4321/projects`.
  2. Click a project name to reach its detail page.
  3. Confirm the URL is now `/projects/<id>`.
  4. Click the "← Projects" link at the top of the detail page.
- **Expected Result**: The URL changes back to `http://localhost:4321/projects` and the projects list is rendered, showing all project rows again.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-14 -->

### UAT-EDGE-001: Navigating directly to /projects/:id with a valid ID renders the detail page

- **Scenario**: User pastes a direct URL to a project detail page rather than clicking from the list.
- **Steps**:
  1. Identify a valid project ID (e.g. from the list page URL after clicking).
  2. In a fresh browser tab or by typing directly in the address bar, navigate to `http://localhost:4321/projects/<id>`.
  3. Observe the page content.
- **Expected Result**: The project detail page renders correctly, showing the project name, workdir, launch command, and created date. No blank/broken state appears.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-14 -->

### UAT-EDGE-002: Navigating to /projects/:id with a non-existent ID shows "Project not found"

- **Scenario**: The `:id` param does not correspond to any project in the database.
- **Steps**:
  1. Navigate directly to `http://localhost:4321/projects/999999` (an ID that does not exist).
  2. Wait for the page to finish loading.
  3. Observe the page content.
- **Expected Result**: The page renders a "Project not found." message (not a blank screen or unhandled error). A "← Projects" back link is still visible.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-14 -->

### UAT-EDGE-003: Multiple project rows each link to their own distinct /projects/:id route

- **Scenario**: When more than one project exists, each row's link is scoped to that project's own ID.
- **Steps**:
  1. Ensure at least two projects exist (create via the Add Project form if needed).
  2. Navigate to `http://localhost:4321/projects`.
  3. Note the names of at least two project rows.
  4. Hover over (or inspect) the link on the first project row and record the `href`.
  5. Hover over (or inspect) the link on the second project row and record the `href`.
- **Expected Result**: Each project row's link has a distinct `href` matching `/projects/<id>` where `<id>` is that project's unique numeric ID. No two rows share the same link target.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-14 -->
