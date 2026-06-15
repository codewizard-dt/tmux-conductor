---
id: UAT-039
title: "UAT: Create NavBar component with NavLink items for Agents and Projects"
status: pending
task: TASK-039
created: 2026-06-13
updated: 2026-06-13
---

# UAT-039 — UAT: Create NavBar component with NavLink items for Agents and Projects

implements::[[TASK-039]]

> **Source task**: [`wiki/work/tasks/TASK-039-create-navbar-component.md`](../tasks/TASK-039-create-navbar-component.md)
> **Generated**: 2026-06-13

---

## Prerequisites

- [ ] Dev server running: `cd app/frontend && npm run dev` (or `make dev-frontend`)
- [ ] App accessible at `http://localhost:4321` (or the configured Vite port)
- [ ] react-router-dom installed (TASK-036 complete)
- [ ] `app/frontend/src/components/NavBar.tsx` exists in the repository

---

## Test Cases

### UAT-STATIC-001: NavBar file exists at the correct path

- **Scenario**: The NavBar component is created at the expected location
- **Steps**:
  1. From the repository root, verify the file exists:
     ```bash
     ls -la app/frontend/src/components/NavBar.tsx
     ```
- **Expected Result**: File is listed with non-zero size; no "No such file" error
- [x] Pass <!-- auto-judge: 2026-06-13 -->

---

### UAT-STATIC-002: NavBar exports a default function component

- **Scenario**: The module exports `NavBar` as a default export so it can be imported as `import NavBar from './components/NavBar'`
- **Steps**:
  1. Run:
     ```bash
     grep -n "export default function NavBar" app/frontend/src/components/NavBar.tsx
     ```
- **Expected Result**: At least one matching line is printed, confirming `export default function NavBar` is present
- [x] Pass <!-- auto-judge: 2026-06-13 -->

---

### UAT-STATIC-003: NavBar imports NavLink from react-router-dom

- **Scenario**: NavLink (not plain `<a>`) is used for route-aware links
- **Steps**:
  1. Run:
     ```bash
     grep -n "NavLink" app/frontend/src/components/NavBar.tsx
     ```
- **Expected Result**: Output includes `import { NavLink } from 'react-router-dom'` and at least two `<NavLink` usages
- [x] Pass <!-- auto-judge: 2026-06-13 -->

---

### UAT-STATIC-004: Agents NavLink targets "/" with end prop

- **Scenario**: The Agents link uses `to="/"` with the `end` prop so it only matches the exact root route (not `/projects`)
- **Steps**:
  1. Run:
     ```bash
     grep -n "end" app/frontend/src/components/NavBar.tsx
     ```
- **Expected Result**: A line is printed containing `end` adjacent to `to="/"`, e.g. `<NavLink to="/" end ...>`
- [x] Pass <!-- auto-judge: 2026-06-13 -->

---

### UAT-STATIC-005: Projects NavLink targets "/projects"

- **Scenario**: The Projects link routes to `/projects`
- **Steps**:
  1. Run:
     ```bash
     grep -n '"/projects"' app/frontend/src/components/NavBar.tsx
     ```
- **Expected Result**: At least one matching line is printed showing `to="/projects"`
- [x] Pass <!-- auto-judge: 2026-06-13 -->

---

### UAT-STATIC-006: Header carries the required sticky/layout Tailwind classes

- **Scenario**: The `<header>` element has the full set of layout classes from the task spec: `sticky top-0 z-10 flex h-12 items-center gap-6 border-b border-line bg-canvas/80 px-6 backdrop-blur-sm`
- **Steps**:
  1. Run:
     ```bash
     grep -n "sticky top-0" app/frontend/src/components/NavBar.tsx
     ```
- **Expected Result**: A line is printed containing the header className with at minimum `sticky top-0 z-10 flex h-12`
- [x] Pass <!-- auto-judge: 2026-06-13 -->

---

### UAT-STATIC-007: Branding "conductor" text is present with accent-green dot

- **Scenario**: The NavBar renders the brand name "conductor" alongside the `bg-accent-green` indicator dot
- **Steps**:
  1. Run:
     ```bash
     grep -n "conductor" app/frontend/src/components/NavBar.tsx
     ```
  2. Run:
     ```bash
     grep -n "accent-green" app/frontend/src/components/NavBar.tsx
     ```
- **Expected Result**: First command prints a line containing `conductor`; second prints a line containing `bg-accent-green`
- [x] Pass <!-- auto-judge: 2026-06-13 -->

---

### UAT-STATIC-008: Active-state className callback applies distinct text classes

- **Scenario**: Active links use `text-ink` and inactive links use `text-muted hover:text-ink`, distinguishing the active route visually
- **Steps**:
  1. Run:
     ```bash
     grep -n "isActive" app/frontend/src/components/NavBar.tsx
     ```
- **Expected Result**: Output shows a `linkCls` arrow function (or equivalent) that references `isActive` and returns different classes — specifically `text-ink` for active and `text-muted` for inactive
- [x] Pass <!-- auto-judge: 2026-06-13 -->

---

### UAT-TYPECHECK-001: NavBar passes TypeScript strict type check with zero errors

- **Scenario**: The component compiles cleanly with no type errors
- **Steps**:
  1. From the repository root, run:
     ```bash
     cd app/frontend && npx tsc --noEmit 2>&1 | head -40
     ```
- **Expected Result**: Command exits with code 0 and prints no error lines (no `error TS` lines in output)
- [x] Pass <!-- auto-judge: 2026-06-13 -->

---

### UAT-UI-001: NavBar renders "Agents" and "Projects" links in the browser

- **Scenario**: When NavBar is rendered (e.g. in a test harness or once wired into App), both nav links are visible
- **Note**: TASK-039 creates the component; TASK-040 wires it into App.tsx. If TASK-040 is also complete, verify in the live app at `http://localhost:4321`. Otherwise, verify by importing NavBar in a temporary test page or by confirming the component structure in the source file.
- **Steps** (source-code path, pre-TASK-040):
  1. Run:
     ```bash
     grep -n "Agents\|Projects" app/frontend/src/components/NavBar.tsx
     ```
- **Expected Result**: Output shows two lines — one containing `Agents` as link text and one containing `Projects` as link text, both inside `<NavLink>` elements
- [x] Pass <!-- auto-judge: 2026-06-13 -->

---

### UAT-UI-002: Active Agents link on root route (live app — requires TASK-040)

- **Scenario**: Navigating to `/` marks the "Agents" NavLink as active (applies `text-ink` class) and "Projects" as inactive (`text-muted`)
- **Prerequisite**: TASK-040 must be complete (NavBar wired into App.tsx Dashboard)
- **Steps**:
  1. Open `http://localhost:4321/` in a browser
  2. Inspect the "Agents" link element (right-click → Inspect)
  3. Check its applied CSS classes
  4. Inspect the "Projects" link element and check its classes
- **Expected Result**: "Agents" link has `text-ink` in its class list; "Projects" link has `text-muted` in its class list
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- auto-judge: 2026-06-13 -->

---

### UAT-UI-003: Active Projects link on /projects route (live app — requires TASK-040)

- **Scenario**: Navigating to `/projects` marks "Projects" as active and "Agents" as inactive
- **Prerequisite**: TASK-040 must be complete (NavBar wired into App.tsx Dashboard)
- **Steps**:
  1. Open `http://localhost:4321/projects` in a browser
  2. Inspect the "Projects" link — confirm `text-ink` class is applied
  3. Inspect the "Agents" link — confirm `text-muted` class is applied (NOT `text-ink`)
- **Expected Result**: "Projects" has `text-ink`; "Agents" has `text-muted`
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- auto-judge: 2026-06-13 -->

---

### UAT-EDGE-001: Agents link does NOT become active when on /projects (end prop guard)

- **Scenario**: Without the `end` prop, `to="/"` would match any route including `/projects`. The `end` prop must prevent this.
- **Prerequisite**: TASK-040 must be complete (NavBar wired into App.tsx Dashboard)
- **Steps**:
  1. Navigate to `http://localhost:4321/projects` in a browser
  2. Inspect the "Agents" link's class attribute
- **Expected Result**: The "Agents" link does NOT have `text-ink` class; it has `text-muted` — confirming the `end` prop is working
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- auto-judge: 2026-06-13 -->

---

## Gaps

The following tests could not be written with full contract certainty and are deferred to TASK-040's UAT:

- **NavBar rendered in the live DOM shell** — the component is not yet wired into `App.tsx` (Dashboard) as of TASK-039. UAT-UI-001 through UAT-EDGE-001 include live-app steps gated on TASK-040 completion. Static/source-level checks are provided as the primary verification path for TASK-039 in isolation.
