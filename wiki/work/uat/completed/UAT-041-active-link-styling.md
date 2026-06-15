---
id: UAT-041
title: "UAT: Verify and polish active-link styling on NavBar"
status: passed
task: TASK-041
created: 2026-06-14
updated: 2026-06-14
---

# UAT-041 — UAT: Verify and polish active-link styling on NavBar

implements::[[TASK-041]]

> **Source task**: [`wiki/work/tasks/TASK-041-active-link-styling.md`](../tasks/TASK-041-active-link-styling.md)
> **Generated**: 2026-06-14

---

## Prerequisites

- [ ] Dev server is running: `cd app/frontend && npm run dev` (port 4321)
- [ ] App is accessible at `http://localhost:4321`
- [ ] Browser DevTools available (to inspect computed styles if needed)

---

## Test Cases

### UAT-UI-001: Active "Agents" link shows accent-green bottom border on root route

- **Page**: `http://localhost:4321/`
- **Description**: Verifies that navigating to `/` applies the active style (`border-b-2 border-accent-green`) to the "Agents" NavLink and the inactive style (`text-muted`) to the "Projects" NavLink.
- **Steps**:
  1. Open `http://localhost:4321/` in the browser.
  2. Observe the NavBar at the top of the page.
  3. Inspect the "Agents" link text colour and bottom border.
  4. Inspect the "Projects" link text colour and absence of bottom border.
- **Expected Result**:
  - "Agents" link has visually darker text (ink: `#0b0b0d`) and a 2px green bottom border (`#30a46c`).
  - "Projects" link has muted text (`#6b6e76`) with no bottom border.
  - The two links are visually distinguishable at a glance — the active link is immediately obvious without needing to hover.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-14 -->

---

### UAT-UI-002: Active "Projects" link shows accent-green bottom border on /projects route

- **Page**: `http://localhost:4321/projects`
- **Description**: Verifies that navigating to `/projects` transfers the active indicator to the "Projects" NavLink and removes it from "Agents".
- **Steps**:
  1. From any page, click the "Projects" link in the NavBar (or navigate directly to `http://localhost:4321/projects`).
  2. Observe the NavBar after the route change.
  3. Inspect the "Projects" link text colour and bottom border.
  4. Inspect the "Agents" link text colour and absence of bottom border.
- **Expected Result**:
  - "Projects" link has ink-coloured text and a 2px green bottom border.
  - "Agents" link has muted text with no bottom border.
  - Transition happens immediately on navigation (no delay or flash).
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-14 -->

---

### UAT-UI-003: Active indicator switches correctly when navigating between routes

- **Page**: `http://localhost:4321/`
- **Description**: Verifies that the active indicator follows the current route when the user navigates back and forth between Agents and Projects.
- **Steps**:
  1. Navigate to `http://localhost:4321/` — confirm "Agents" is active.
  2. Click the "Projects" link — confirm "Projects" becomes active and "Agents" becomes inactive.
  3. Click the "Agents" link — confirm "Agents" becomes active again and "Projects" becomes inactive.
- **Expected Result**:
  - Each navigation step correctly reflects the active route on exactly one link.
  - No link stays "stuck" in an active or inactive state after navigation.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-14 -->

---

### UAT-EDGE-001: "Agents" link is NOT active on /projects route (end prop behaviour)

- **Page**: `http://localhost:4321/projects`
- **Description**: Verifies that the "Agents" NavLink uses the `end` prop so it only matches the exact path `/` and does not activate on `/projects` or any sub-path.
- **Steps**:
  1. Navigate to `http://localhost:4321/projects`.
  2. Inspect the "Agents" link in the NavBar.
- **Expected Result**:
  - "Agents" link shows inactive style (`text-muted`, no bottom border).
  - Without `end`, React Router's `NavLink` would match `/` as a prefix of `/projects` and incorrectly mark "Agents" as active — this must not happen.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-14 -->

---

### UAT-EDGE-002: "Projects" link remains active on /projects/:id sub-route

- **Page**: `http://localhost:4321/projects/1` (or any valid project detail route)
- **Description**: Verifies that the "Projects" NavLink (which has no `end` prop) stays active when viewing a project detail page at `/projects/:id`, since `/projects` is a prefix of that path.
- **Steps**:
  1. Navigate to `http://localhost:4321/projects`.
  2. If a project row is available, click it to navigate to `/projects/:id`; otherwise navigate directly to `http://localhost:4321/projects/test`.
  3. Inspect the "Projects" link in the NavBar.
- **Expected Result**:
  - "Projects" link shows active style (ink text, 2px green bottom border) even on the detail sub-route.
  - "Agents" link remains inactive.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-14 -->

---

### UAT-UI-004: Hover state on inactive link changes text to ink colour

- **Page**: `http://localhost:4321/projects`
- **Description**: Verifies that hovering over the inactive "Agents" link applies the `hover:text-ink` class, providing interactive feedback.
- **Steps**:
  1. Navigate to `http://localhost:4321/projects` so "Agents" is inactive.
  2. Hover the mouse cursor over the "Agents" link.
  3. Observe the text colour change during hover.
  4. Move the cursor away and observe the revert.
- **Expected Result**:
  - "Agents" link text darkens to ink colour (`#0b0b0d`) on hover.
  - Text reverts to muted (`#6b6e76`) when the cursor moves away.
  - The `transition` class ensures the colour change is animated (not instant).
- [ ] Pass
