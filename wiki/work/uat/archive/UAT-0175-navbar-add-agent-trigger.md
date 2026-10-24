---
id: UAT-0175
aliases: [UAT-0175]
title: "UAT: Move the + Add Agent trigger into NavBar"
status: skipped
task: TASK-0175
created: 2026-09-18
updated: 2026-10-17
---

# UAT-0175 — UAT: Move the + Add Agent trigger into NavBar

implements::[[TASK-0175]]

> **Source task**: [[TASK-0175]]
> **Generated**: 2026-09-18

---

## Prerequisites

- [ ] Frontend dev server running (`make dev`, `http://localhost:4321`) with the host-server on `:8788` for the UI cases.
- [ ] Unit-test cases run from `frontend/` (`npx vitest run ...`); no live server needed.
- [ ] **Do not submit the Add Agent form.** Submitting spawns a real tmux window and agent process in whatever conductor session runs the check (same caution as [[UAT-151]]). Every UI case below stops short of "Spawn Agent". Successful-spawn closing behavior is already unit-covered in `AddAgentForm` (unmodified by this task).
- [ ] UAT-UI-003 creates one throwaway project row in the live SQLite DB and deletes it afterward via `DELETE /api/projects/:id`. Skip it if a DB write is unacceptable in your environment.

---

## Test Cases

### UAT-EDGE-001: The `+ Add Agent` trigger renders in the NavBar on every route, and the modal is not mounted (no project fetch) until it is clicked
- **Scenario**: NavBar is global (rendered once in `App.tsx` above `<Routes>`), so the trigger must be present on Agents (`/`), Projects (`/projects`) and History (`/history`). The form is conditionally mounted, so `listProjects()` must not fire on initial render.
- **Steps**: Covered by `frontend/src/components/NavBar.test.tsx` (`describe('NavBar Add Agent trigger')`, the `it.each` route case and the click-opens case) — synthetic render through `MemoryRouter`, no browser needed.
- **Expected Result**: On each of the three routes a button named `+ Add Agent` is in the document and `listProjects` has not been called. After clicking it, the dialog content is present ("Add Agent" header, `Working Directory` labeled input, `Spawn Agent` button) and `listProjects` is called exactly once.
- **Repeatable Unit Test**: Created: `frontend/src/components/NavBar.test.tsx` (added by TASK-0175 step 3; existing file, not modified by this UAT)
- **Unit Test Command**: `npx vitest run src/components/NavBar.test.tsx` (run from `frontend/`) — verified: 12/12 pass
- [x] Pass <!-- 2026-09-18 -->

---

### UAT-EDGE-002: Escape closes the NavBar-owned modal and unmounts the form; reopening mounts a fresh form and refetches projects
- **Scenario**: State ownership moved up into `NavBar` (`showAddAgent`). Dismissal must flip it back to `false` so `AddAgentForm` unmounts, and a later open must remount (fresh form state, second `listProjects()` call) rather than reuse a stale mounted-but-closed instance.
- **Steps**: Covered by `frontend/src/components/NavBar.test.tsx` (`Escape closes the dialog and unmounts the form; reopening refetches projects`).
- **Expected Result**: After Escape the `Working Directory` input is gone from the DOM. Clicking `+ Add Agent` again brings it back and `listProjects` has been called 2 times total.
- **Repeatable Unit Test**: Created: `frontend/src/components/NavBar.test.tsx` (existing, see UAT-EDGE-001)
- **Unit Test Command**: `npx vitest run src/components/NavBar.test.tsx` (run from `frontend/`) — verified: 12/12 pass
- [x] Pass <!-- 2026-09-18 -->

---

### UAT-EDGE-003: The trigger and the theme toggle share one right-aligned cluster, and the toggle still works
- **Scenario**: The theme button previously owned `ml-auto`; it now sits in a `ml-auto flex items-center gap-2` wrapper next to the trigger. Regression guard that the toggle did not lose its behavior or leave a duplicate `ml-auto`.
- **Steps**: Covered by `frontend/src/components/NavBar.test.tsx` (`places the trigger and the theme toggle in a right-aligned cluster, and the toggle still works`, plus the whole `NavBar theme toggle` describe block, which the task required to stay green unchanged).
- **Expected Result**: Trigger and toggle have the same `parentElement`; that parent has class `ml-auto`; the toggle itself does not; clicking the toggle adds the `dark` class to `<html>`. All 6 pre-existing theme-toggle tests still pass.
- **Repeatable Unit Test**: Created: `frontend/src/components/NavBar.test.tsx` (existing, see UAT-EDGE-001)
- **Unit Test Command**: `npx vitest run src/components/NavBar.test.tsx` (run from `frontend/`) — verified: 12/12 pass
- [x] Pass <!-- 2026-09-18 -->

---

### UAT-EDGE-004: `AddAgentForm` itself is unchanged — Escape and overlay-click dismissal, open/closed rendering still hold
- **Scenario**: The task must not redo or restyle the TASK-151 modal; `AddAgentForm.test.tsx` must still pass unmodified, and it is the evidence for overlay-click dismissal, which `NavBar.test.tsx` does not exercise. Because `NavBar` passes the same `onClose` for every dismissal path, overlay-click and Escape both reach `setShowAddAgent(false)`.
- **Steps**: Covered by `frontend/src/components/AddAgentForm.test.tsx` (4 tests: closed renders nothing, open shows content, Escape closes, overlay click closes but a card click does not).
- **Expected Result**: 4/4 pass with no edits to that test file.
- **Repeatable Unit Test**: Created: `frontend/src/components/AddAgentForm.test.tsx` (existing, from TASK-151)
- **Unit Test Command**: `npx vitest run src/components/AddAgentForm.test.tsx` (run from `frontend/`) — verified: 4/4 pass
- [x] Pass <!-- 2026-09-18 -->

---

### UAT-UI-001: Agents page shows exactly one `+ Add Agent` button, in the NavBar, styled as the primary action; the page body no longer has one
- **Page**: `http://localhost:4321/` (Agents)
- **Component**: `frontend/src/components/NavBar.tsx` (trigger + action cluster); `frontend/src/pages/AgentsPage.tsx` (button, `showAddAgentModal` state and `<AddAgentForm>` removed)
- **Description**: jsdom cannot confirm real layout. This checks the trigger's real position and styling in the sticky header, and that removing it from `AgentsPage` left no orphaned button, empty flex item, or visible gap.
- **Steps**:
  1. Open the Agents page.
  2. Look at the header: `conductor`, then the Agents / Projects / History links on the left, and on the far right a `+ Add Agent` primary button immediately left of the round theme toggle.
  3. Confirm exactly one `+ Add Agent` button exists on the page (none inside the page body next to `InactiveAgentsPanel`).
  4. Confirm `InactiveAgentsPanel` still renders in the body with no blank space where the old button sat.
  5. Scroll the page (or narrow the window) and confirm the header stays sticky with the cluster still right-aligned, and the cluster does not wrap or overlap the nav links at a normal laptop width.
  6. Click the theme toggle once and confirm the theme flips and the trigger stays in place; click again to restore.
- **Expected Result**: One right-aligned `+ Add Agent` button in the header, styled like the other primary buttons (dark fill, 32px tall, label exactly `+ Add Agent`); no button in the body; no empty gap; theme toggle unaffected.
- **Repeatable Unit Test**: Not applicable: real layout, stickiness and visual styling need a browser; the DOM-structure part is covered by UAT-EDGE-003.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-09-18 -->

---

### UAT-UI-002: The trigger is available on Projects and History, and the modal opens and dismisses correctly from each page (three ways)
- **Page**: `http://localhost:4321/projects` and `http://localhost:4321/history`
- **Component**: `frontend/src/components/NavBar.tsx`, `frontend/src/components/AddAgentForm.tsx`
- **Description**: Showing the trigger on every route is a deliberate behavior addition. Confirms it is present and functional off the Agents page and that the modal renders above the sticky header.
- **Steps**:
  1. Go to `/projects`. Confirm the header shows `+ Add Agent`. Click it.
  2. Confirm a centered modal with a dimmed backdrop covers the whole viewport including the sticky header, with the `Add Agent` heading, Project select, Name, Working Directory, Role, and a `Spawn Agent` button. No clipping or overflow.
  3. Press Escape; confirm it closes.
  4. Reopen; click the dimmed backdrop outside the card; confirm it closes. Reopen and click inside the card (e.g. on the heading); confirm it stays open.
  5. Reopen; click the `✕` (aria-label `Close`) in the card header; confirm it closes.
  6. Repeat steps 1-3 on `/history`.
  7. Navigate to `/`, open and close the modal once more to confirm state does not leak between routes (modal is closed after navigating with it closed).
  8. **Do not click `Spawn Agent`.**
- **Expected Result**: Trigger present and working on Projects, History and Agents; modal closes via Escape, backdrop click and `✕`; a click inside the card does not close it; the header is covered by the backdrop, not painted above it.
- **Repeatable Unit Test**: Not applicable: real browser stacking (`z-50` modal over `z-10` sticky header), backdrop hit-testing and visual layout. The jsdom-checkable logic is in UAT-EDGE-001, 002 and 004.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-09-18 -->

---

### UAT-UI-003: A project created on the Projects page appears in the modal's Project dropdown without a page reload
- **Page**: `http://localhost:4321/projects`
- **Component**: `frontend/src/components/AddProjectForm.tsx` (Projects page form), `frontend/src/components/AddAgentForm.tsx` (`listProjects()` in a mount-only effect), `frontend/src/components/NavBar.tsx` (conditional mount)
- **Description**: The reason the modal is conditionally mounted instead of left mounted-but-closed: `NavBar` lives for the whole SPA session, so a permanently mounted `AddAgentForm` would never refetch and would miss projects created after first load.
- **Steps**:
  1. On `/projects`, click `+ Add Agent`, open the `Project` select, and note the current options. Close the modal with Escape. Do not reload the page.
  2. In the `Add Project` card on the same page, create a throwaway project: Name `uat-0175-probe`, Working Directory an existing absolute path (for example this repo's `./tmp` directory), default launch command. Click `Create Project` and wait for `Project created ✓`.
  3. Without reloading, click `+ Add Agent` again and open the `Project` select.
  4. Confirm `uat-0175-probe` is now one of the options. **Do not spawn.** Close the modal.
  5. Cleanup: find the new project's id (`curl -sS 'http://localhost:8788/api/projects' | jq '.[] | select(.name=="uat-0175-probe") | .id'`), then remove it with `curl -sS -X DELETE 'http://localhost:8788/api/projects/<id>'` (add `?force=true` only if the API asks for it and the project has no real agents).
- **Expected Result**: The new project appears in the modal's dropdown on the second open with no reload. After cleanup the project no longer appears in `GET /api/projects`.
- **Repeatable Unit Test**: Not applicable: the refetch-per-open half is already covered by UAT-EDGE-002 (second `listProjects()` call on reopen); the end-to-end half needs the real API and a real DB write.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-09-18 -->

---

## Gaps

- **No overlay-click / `✕` test through `NavBar`.** `NavBar.test.tsx` only exercises Escape for dismissal. Overlay-click is covered in `AddAgentForm.test.tsx` (UAT-EDGE-004) and `NavBar` passes the same `onClose` to all paths, so the risk is low, but a `NavBar`-level overlay-click test is a cheap promotion. Not added here because this run was restricted to writing UAT/wiki files only (no code edits).
- **No `AgentsPage` test asserts the button and `AddAgentForm` are gone.** `AgentsPage` has no test file and rendering it needs `AgentList`, SSE and the API mocked, which is new harness. Covered only by UAT-UI-001 (live browser).
- **Successful-spawn behavior deliberately not exercised.** It spawns a real tmux window and agent. One consequence worth a human's eyes when someone does exercise it: `AddAgentForm` sets `success` ("Agent spawned ✓") and then calls `onClose()`; with `NavBar` unmounting the form, that message is never visible, and on `/projects` or `/history` there is no other visible confirmation until the user navigates to Agents. The task did not specify a confirmation, so this is noted, not asserted.
