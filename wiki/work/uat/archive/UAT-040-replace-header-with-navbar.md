---
id: UAT-040
title: "UAT: Replace the static header in App.tsx with the NavBar component"
status: passed
task: TASK-040
created: 2026-06-14
updated: 2026-06-14
---

# UAT-040 — UAT: Replace the static header in App.tsx with the NavBar component

implements::[[TASK-040]]

> **Source task**: [`wiki/work/tasks/TASK-040-replace-header-with-navbar.md`](../tasks/TASK-040-replace-header-with-navbar.md)
> **Generated**: 2026-06-14

---

## Prerequisites

- [ ] Frontend dev server is running (`npm run dev` in `app/frontend/` or `make dev`) and accessible at `http://localhost:4321`
- [ ] A valid authenticated session exists (logged in as any user) — required for Dashboard routes behind `AuthGuard`
- [ ] The browser is pointed at `http://localhost:4321`

---

## Test Cases

### UAT-UI-001: NavBar renders on the Agents page (root route)

- **Page**: `http://localhost:4321/`
- **Description**: Verify that the `<NavBar>` component (sticky header) is rendered on the root `/` route (AgentsPage), replacing the old static `<header>` element.
- **Steps**:
  1. Navigate to `http://localhost:4321/` (log in if redirected to `/login`).
  2. Observe the top of the page.
- **Expected Result**:
  - A sticky header bar is visible at the top of the page.
  - The header contains the text **"conductor"** (brand label with a small green dot to its left).
  - A **"Agents"** navigation link is visible in the header.
  - A **"Projects"** navigation link is visible in the header.
  - An account button (circle with user initials) is visible at the far right of the header.
  - No raw `<header>` containing legacy markup (e.g. an old inline title or standalone `AuthBadge` import in App.tsx) is present.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-14 -->

---

### UAT-UI-002: NavBar renders on the Projects page

- **Page**: `http://localhost:4321/projects`
- **Description**: Verify that `<NavBar>` is present on the `/projects` route, confirming it renders for all Dashboard child routes.
- **Steps**:
  1. While logged in, navigate to `http://localhost:4321/projects`.
  2. Observe the top of the page.
- **Expected Result**:
  - The same sticky header with "conductor", "Agents", and "Projects" links, and the AuthBadge, is rendered — identical in appearance to what is shown on `/`.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-14 -->

---

### UAT-UI-003: NavBar is absent on the Login page

- **Page**: `http://localhost:4321/login`
- **Description**: The `/login` route is mounted outside the `Dashboard` layout shell, so `<NavBar>` must not appear there.
- **Steps**:
  1. Log out (or open a private/incognito window) and navigate to `http://localhost:4321/login`.
  2. Observe the page.
- **Expected Result**:
  - The login page renders without any sticky header containing "conductor", "Agents", or "Projects" links.
  - No NavBar element is visible.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-14 -->

---

### UAT-UI-004: "Agents" NavLink is active-styled on root route

- **Page**: `http://localhost:4321/`
- **Description**: The `<NavLink to="/" end>` in NavBar should apply active styling when on the root route. Verify that "Agents" receives the active text class (`text-ink`) while "Projects" receives the inactive class (`text-muted`).
- **Steps**:
  1. Navigate to `http://localhost:4321/`.
  2. Inspect the "Agents" and "Projects" links in the header (use browser DevTools or visually compare).
- **Expected Result**:
  - "Agents" link text appears in the active/highlighted style (darker, full-ink colour).
  - "Projects" link text appears in the muted/subdued style.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-14 -->

---

### UAT-UI-005: "Projects" NavLink is active-styled on /projects route

- **Page**: `http://localhost:4321/projects`
- **Description**: Verify that navigating to `/projects` switches the active NavLink highlight to "Projects".
- **Steps**:
  1. Navigate to `http://localhost:4321/projects`.
  2. Observe the header nav links.
- **Expected Result**:
  - "Projects" link text appears in the active/highlighted style.
  - "Agents" link text appears in the muted/subdued style.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-14 -->

---

### UAT-UI-006: "Agents" link navigates to root route

- **Page**: `http://localhost:4321/projects`
- **Description**: Clicking the "Agents" NavLink in the header navigates to `/` without a full page reload.
- **Steps**:
  1. Navigate to `http://localhost:4321/projects`.
  2. Click the **"Agents"** link in the NavBar.
  3. Observe the URL and page content.
- **Expected Result**:
  - The URL changes to `http://localhost:4321/`.
  - The AgentsPage content is rendered below the NavBar.
  - The NavBar remains in place (no full page reload flicker).
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-14 -->

---

### UAT-UI-007: "Projects" link navigates to /projects route

- **Page**: `http://localhost:4321/`
- **Description**: Clicking the "Projects" NavLink in the header navigates to `/projects` without a full page reload.
- **Steps**:
  1. Navigate to `http://localhost:4321/`.
  2. Click the **"Projects"** link in the NavBar.
  3. Observe the URL and page content.
- **Expected Result**:
  - The URL changes to `http://localhost:4321/projects`.
  - The ProjectsPage content is rendered below the NavBar.
  - The NavBar remains in place (no full page reload flicker).
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-14 -->

---

### UAT-UI-008: AuthBadge is rendered in NavBar and shows user initials

- **Page**: `http://localhost:4321/`
- **Description**: Verify that the AuthBadge (account button) appears in the right side of the NavBar and displays the logged-in user's initials.
- **Steps**:
  1. Log in and navigate to `http://localhost:4321/`.
  2. Look at the far-right side of the NavBar.
- **Expected Result**:
  - A small circular button is visible at the right end of the header.
  - The button displays the user's initials (first letters of name, or first letter of email if name is not set).
  - The button has an `aria-label="Account menu"` attribute (verifiable via DevTools).
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-14 -->

---

### UAT-EDGE-001: No AuthBadge import in App.tsx (clean removal)

- **Scenario**: `AuthBadge` was previously imported directly in `App.tsx` alongside the old `<header>`. After TASK-040 it must be removed from App.tsx (it now lives solely inside NavBar.tsx).
- **Steps**:
  1. Open `app/frontend/src/App.tsx` in an editor or run: `grep -n 'AuthBadge' app/frontend/src/App.tsx`
  2. Observe the output.
- **Expected Result**:
  - No line in `app/frontend/src/App.tsx` contains `AuthBadge`.
  - The file only imports `NavBar` from `./components/NavBar` (among other imports).
- [x] Pass <!-- 2026-06-14 -->

---

### UAT-EDGE-002: No legacy `<header>` block in App.tsx

- **Scenario**: The old inline `<header>...</header>` JSX block must be fully removed from `App.tsx`, not just hidden.
- **Steps**:
  1. Open `app/frontend/src/App.tsx` in an editor or run: `grep -n '<header' app/frontend/src/App.tsx`
  2. Observe the output.
- **Expected Result**:
  - No `<header` tag is found in `App.tsx`.
  - The `Dashboard` component renders `<NavBar />` in place of the old header block.
- [x] Pass <!-- 2026-06-14 -->

---

### UAT-EDGE-003: NavBar sticky positioning persists on scroll

- **Page**: `http://localhost:4321/`
- **Description**: The NavBar uses `sticky top-0` and `z-10`. Verify it stays fixed at the top when the page content scrolls.
- **Steps**:
  1. Navigate to `http://localhost:4321/` and ensure there is enough content to scroll (or resize the window).
  2. Scroll down the page.
  3. Observe the NavBar.
- **Expected Result**:
  - The NavBar remains visible and stuck at the top of the viewport while the page content scrolls beneath it.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-14 -->
