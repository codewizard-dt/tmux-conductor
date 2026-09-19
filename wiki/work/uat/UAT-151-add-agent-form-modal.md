---
id: UAT-151
aliases: [UAT-151]
title: "UAT: Convert the Add Agent form into a modal"
status: pending
task: TASK-151
created: 2026-09-17
updated: 2026-09-17
---

# UAT-151 — UAT: Convert the Add Agent form into a modal

implements::[[TASK-151]]

> **Source task**: [[TASK-151]]
> **Generated**: 2026-09-17

---

## Prerequisites

- [ ] Frontend dev server running (`make dev`, `http://localhost:4321`) for the UI cases.
- [ ] None of these cases require a live host-server call that creates a real agent — the UI cases below deliberately stop short of actually submitting the form, since a real submission spawns a real tmux window/agent process in whatever conductor session runs the check.

---

## Test Cases

### UAT-EDGE-001: AddAgentForm renders nothing when closed, and the full modal (header, inputs, submit button) when open
- **Scenario**: The core open/closed behavior this task introduces — `AddAgentForm` now takes `open`/`onClose` props and returns `null` when `!open`, replacing the old always-mounted collapsible card.
- **Steps**: Covered directly by the new `frontend/src/components/AddAgentForm.test.tsx` (see Repeatable Unit Test below) — no live browser required, since this is pure component-render behavior.
- **Expected Result**: `open={false}` → `container.firstChild === null`. `open={true}` → the "Add Agent" header, Name/Working Directory labeled inputs, and the Spawn Agent button are all present.
- **Repeatable Unit Test**: Created: `frontend/src/components/AddAgentForm.test.tsx` (`describe('AddAgentForm')`, 2 of its 4 tests)
- **Unit Test Command**: `npx vitest run src/components/AddAgentForm.test.tsx` (run from `frontend/`) — verified: 4/4 pass
- [x] Pass <!-- 2026-09-17 -->

---

### UAT-EDGE-002: Escape and overlay-click both close the modal; a click inside the card does not
- **Scenario**: Regression guard for the two dismissal affordances this task adds, mirroring `ConfirmDialog.tsx`'s existing pattern — the modal must be dismissible via keyboard or a backdrop click, but a click on the card's own content must not close it.
- **Steps**: Covered directly by `frontend/src/components/AddAgentForm.test.tsx` (see Repeatable Unit Test below) — no live browser required, since these are synthetic DOM events (`fireEvent.keyDown`, `fireEvent.click`) against a jsdom render.
- **Expected Result**: `Escape` keydown → `onClose` called once. Click on the overlay backdrop (`container.firstChild`) → `onClose` called once. Click on the "Add Agent" header text (inside the card) → `onClose` never called.
- **Repeatable Unit Test**: Created: `frontend/src/components/AddAgentForm.test.tsx` (`describe('AddAgentForm')`, remaining 2 of its 4 tests)
- **Unit Test Command**: `npx vitest run src/components/AddAgentForm.test.tsx` (run from `frontend/`) — verified: 4/4 pass
- [x] Pass <!-- 2026-09-17 -->

---

### UAT-UI-001: A real browser render shows the "Add Agent" trigger button on the Agents page, opening a visually correct modal
- **Page**: Dashboard SPA (`http://localhost:4321`) — the Agents page
- **Component**: `frontend/src/pages/AgentsPage.tsx` (the new "+ Add Agent" trigger button) + `frontend/src/components/AddAgentForm.tsx` (the modal)
- **Description**: The jsdom-based unit tests (UAT-EDGE-001/002) confirm the component's open/close *logic*, but not real CSS layout/visual correctness, or that `AgentsPage.tsx`'s new trigger button and layout changes (the old `grid grid-cols-2` wrapper replaced with a `flex` row) render sensibly in a real browser.
- **Steps**:
  1. Open the Agents page.
  2. Confirm a "+ Add Agent" button is visible near `InactiveAgentsPanel`, styled as a primary action (not a decorative/collapsed card).
  3. Click it and confirm a centered modal overlay opens with a dimmed backdrop, the "Add Agent" header, Name/Working Directory inputs, and a Spawn Agent button — no layout overflow or clipping.
  4. Press Escape; confirm it closes. Reopen; click the backdrop; confirm it closes.
- **Expected Result**: Visually correct, centered modal matching the `ConfirmDialog`/`FolderPickerModal` styling convention; no broken layout in the page behind it.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-09-17 -->

---

### UAT-UI-002: The nested "Add project" sub-form and folder-picker still work from inside the new modal, and a successful agent creation closes it
- **Page**: Dashboard SPA (`http://localhost:4321`) — the Agents page, Add Agent modal
- **Component**: `frontend/src/components/AddAgentForm.tsx` (nested `showAddProject` sub-form, `FolderPickerModal` invocation, `clearOnSuccess()`)
- **Description**: This task explicitly left the nested "Add project" sub-form and folder-picker browse button functionally untouched — only their enclosing wrapper changed. This case confirms they still work correctly nested inside the new modal card, and that a real successful agent creation closes the modal (via the new `onClose()` call added to `clearOnSuccess()`).
- **Steps**:
  1. Open the Add Agent modal.
  2. Click "+ Add project" (or equivalent) and confirm the nested sub-form still renders and functions inside the modal card.
  3. Click the workdir browse button and confirm `FolderPickerModal` still opens correctly on top of/alongside the Add Agent modal.
  4. **Deliberately not exercised by this generated UAT**: actually submitting the form to create a real agent — doing so spawns a real tmux window/agent process in whatever conductor session runs this check, which is a real, hard-to-cleanly-revert side effect (unlike UAT-0167's role-PATCH live test, which was a pure DB label change). A human walking this test should judge whether creating and then tearing down a real throwaway agent is acceptable in their environment before exercising this final assertion.
- **Expected Result**: Both nested pieces work unchanged; a successful submission calls `onClose()` and the new agent appears in `AgentList`.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-09-17 -->

---

## Gaps

- UAT-UI-002's final assertion (successful creation closes the modal) is intentionally not exercised even at human-walk time without an explicit judgment call, since it requires creating a real agent process — flagged rather than silently skipped.
