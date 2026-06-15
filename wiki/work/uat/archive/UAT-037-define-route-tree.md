---
id: UAT-037
title: "UAT: Define route tree (/, /projects, /projects/:id) in App.tsx and create page stubs"
status: passed
task: "../tasks/TASK-037-define-route-tree.md"
created: 2026-06-13
updated: 2026-06-13
---

# UAT-037 — UAT: Define route tree (/, /projects, /projects/:id) in App.tsx and create page stubs

implements::[[TASK-037]]

> **Source task**: [`wiki/work/tasks/TASK-037-define-route-tree.md`](../tasks/TASK-037-define-route-tree.md)
> **Generated**: 2026-06-13

---

## Prerequisites

- [ ] The `app/frontend/` dev server is **not** required for static tests (UAT-STATIC-*).
- [ ] Start the frontend dev server for UI tests: `cd app/frontend && npm run dev` (default port 4321).
- [ ] The backend is **not** required for routing/navigation tests (pages do not call any API).

---

## Test Cases

---

### UAT-STATIC-001 — AgentsPage.tsx exists and imports AddAgentForm + AgentList

Confirm the new page file was created and correctly wraps the moved content.

```sh
grep -E 'AddAgentForm|AgentList' app/frontend/src/pages/AgentsPage.tsx
```

Expected: two matching lines — one for the `AddAgentForm` import, one for `AgentList` import (or combined on a single import line). Both component names must appear.

- [x] Pass <!-- 2026-06-13 -->

---

### UAT-STATIC-002 — AgentsPage renders components inside a max-width main container

The task specifies the `<main>` wrapper class as `mx-auto flex max-w-[1280px] flex-col gap-6 px-6 py-8`.

```sh
grep 'max-w-\[1280px\]' app/frontend/src/pages/AgentsPage.tsx
```

Expected: at least one matching line containing `max-w-[1280px]`.

- [x] Pass <!-- 2026-06-13 -->

---

### UAT-STATIC-003 — ProjectsPage.tsx exists

```sh
test -f app/frontend/src/pages/ProjectsPage.tsx && echo "present"
```

Expected: prints `present`.

- [x] Pass <!-- 2026-06-13 -->

---

### UAT-STATIC-004 — ProjectDetailPage.tsx exists

```sh
test -f app/frontend/src/pages/ProjectDetailPage.tsx && echo "present"
```

Expected: prints `present`.

- [x] Pass <!-- 2026-06-13 -->

---

### UAT-STATIC-005 — ProjectsPage renders a Placeholder component

```sh
grep 'Placeholder' app/frontend/src/pages/ProjectsPage.tsx
```

Expected: at least one line containing `Placeholder` (the import and/or JSX usage).

- [x] Pass <!-- 2026-06-13 -->

---

### UAT-STATIC-006 — ProjectDetailPage renders a Placeholder component

```sh
grep 'Placeholder' app/frontend/src/pages/ProjectDetailPage.tsx
```

Expected: at least one line containing `Placeholder`.

- [x] Pass <!-- 2026-06-13 -->

---

### UAT-STATIC-007 — App.tsx defines routes for /, /projects, and /projects/:id

The three routes must be present in App.tsx (inside the `Dashboard` component's `<Routes>` block).

```sh
grep -E "path=[\"']/[\"']|path=[\"']/projects[\"']|path=[\"']/projects/:id[\"']" app/frontend/src/App.tsx
```

Expected: three matching lines — one for `/`, one for `/projects`, one for `/projects/:id`.

- [x] Pass <!-- 2026-06-13 -->

---

### UAT-STATIC-008 — App.tsx mounts AgentsPage, ProjectsPage, and ProjectDetailPage

```sh
grep -E 'AgentsPage|ProjectsPage|ProjectDetailPage' app/frontend/src/App.tsx
```

Expected: at least three matching lines (one import per page, plus one JSX element reference each, or combined imports).

- [x] Pass <!-- 2026-06-13 -->

---

### UAT-STATIC-009 — App.tsx does NOT import AddAgentForm or AgentList directly

After extracting to AgentsPage, those imports must be removed from App.tsx.

```sh
grep -E 'AddAgentForm|AgentList' app/frontend/src/App.tsx
```

Expected: exit code 1 (grep finds no matches) and no output.

- [x] Pass <!-- 2026-06-13 -->

---

### UAT-STATIC-010 — App.tsx header is rendered outside Routes (persistent layout shell)

The persistent `<header>` must be a sibling of `<Routes>`, not nested inside a route element.

```sh
grep -c 'Routes' app/frontend/src/App.tsx
```

Expected: prints `2` — one opening `<Routes>` tag and one closing `</Routes>` tag (confirming Routes is used once, not wrapping the header).

- [x] Pass <!-- 2026-06-13 -->

---

### UAT-STATIC-011 — make typecheck-frontend passes with zero errors

```sh
make typecheck-frontend
echo "exit: $?"
```

Expected: exit code 0 printed as `exit: 0`. No TypeScript diagnostics.

- [x] Pass <!-- 2026-06-13 -->

---

### UAT-STATIC-012 — make typecheck (all packages) passes with zero errors

```sh
make typecheck
echo "exit: $?"
```

Expected: exit code 0 across all three `tsc --noEmit` invocations (host-server, app/api, app/frontend).

- [x] Pass <!-- 2026-06-13 -->

---

### UAT-UI-001 — / route renders the agents view (AddAgentForm + AgentList)

- **Page**: `http://localhost:4321/` (after login if auth guard redirects)
- **Description**: Navigating to `/` should render the `AgentsPage` content — the agent add form and agent list — not a placeholder.
- **Steps**:
  1. Start the frontend dev server: `cd app/frontend && npm run dev`.
  2. Open `http://localhost:4321/` in a browser.
  3. If redirected to `/login`, log in and return to `/`.
  4. Observe the page content.
- **Expected Result**: The page renders an agent-add form (input or button labelled for adding an agent) and an agent list section. No placeholder text ("Dashboard coming soon") is visible.

- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-13 -->

---

### UAT-UI-002 — /projects route renders a placeholder page (not a 404)

- **Page**: `http://localhost:4321/projects`
- **Description**: Navigating to `/projects` must mount `ProjectsPage` and render without crashing. The page shows placeholder content.
- **Steps**:
  1. With the dev server running, navigate to `http://localhost:4321/projects`.
  2. If redirected to `/login`, log in first.
  3. Observe the page content.
- **Expected Result**: The page loads without a white screen or console error. Placeholder content is rendered (the `Placeholder` component outputs a heading and "Dashboard coming soon." paragraph). The persistent header is visible.

- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-13 -->

---

### UAT-UI-003 — /projects/:id route renders a placeholder page for any id value

- **Page**: `http://localhost:4321/projects/1`
- **Description**: Navigating to a project detail URL must mount `ProjectDetailPage` and render without crashing.
- **Steps**:
  1. With the dev server running, navigate to `http://localhost:4321/projects/1`.
  2. If redirected to `/login`, log in first.
  3. Observe the page content.
- **Expected Result**: The page loads without a white screen or console error. Placeholder content is rendered (same `Placeholder` component output). The persistent header is visible.

- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-13 -->

---

### UAT-UI-004 — Persistent header is visible on all three routes

- **Page**: `/`, `/projects`, `/projects/1`
- **Description**: The `<header>` rendered in the `Dashboard` layout shell must appear on every route — it must not disappear or be replaced when the route changes.
- **Steps**:
  1. With the dev server running, visit each of the three routes in turn: `/`, `/projects`, `/projects/1`.
  2. On each page, confirm the header bar is present at the top.
- **Expected Result**: Each page shows the header with the `conductor` label and the green dot indicator. The header does not flash or disappear during navigation.

- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-13 -->

---

### UAT-EDGE-001 — Unknown route does not crash the app

- **Page**: `http://localhost:4321/does-not-exist`
- **Description**: An unknown path inside the `/*` catch-all (which loads `Dashboard`) must not throw an unhandled React error. The `<Routes>` block renders nothing for an unmatched path inside the Dashboard — that is acceptable.
- **Steps**:
  1. With the dev server running, navigate to `http://localhost:4321/does-not-exist`.
  2. Open the browser developer console.
  3. Observe whether an error boundary or unhandled error appears.
- **Expected Result**: No React error boundary red screen and no `Uncaught Error` in the console. The persistent header is still visible. The main content area may be empty (no matched route).

- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-13 -->

---

### UAT-EDGE-002 — /projects/:id route accepts non-numeric id values

- **Page**: `http://localhost:4321/projects/abc-project`
- **Description**: The `:id` route parameter is typed as a string; a non-numeric slug must still render `ProjectDetailPage` without a crash.
- **Steps**:
  1. With the dev server running, navigate to `http://localhost:4321/projects/abc-project`.
  2. Observe the page content and browser console.
- **Expected Result**: `ProjectDetailPage` renders (placeholder content visible). No React error. No console errors about invalid id type.

- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-13 -->
