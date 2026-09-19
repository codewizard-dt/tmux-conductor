---
id: TASK-151
aliases: [TASK-151]
title: "Convert the Add Agent form into a modal"
status: pending-uat
created: 2026-09-13
updated: 2026-09-13
depends_on: []
blocks: []
parallel_safe_with: []
uat: "[[UAT-151]]"
tags: [frontend]
---

# TASK-151 — Convert the Add Agent form into a modal

## Objective

`AddAgentForm` (`frontend/src/components/AddAgentForm.tsx`) is currently a self-contained, always-mounted collapsible inline card rendered directly in `frontend/src/pages/AgentsPage.tsx:6-12` next to `InactiveAgentsPanel` in a 2-column grid. It manages its own `collapsed` boolean (`AddAgentForm.tsx:41`) and toggles a disclosure header to show/hide the actual form. This task converts it into a modal dialog triggered by an explicit "Add Agent" button, matching the lightweight modal convention already used by `ConfirmDialog.tsx` and `FolderPickerModal.tsx`.

## Approach

- **State ownership**: lift the open/closed state to the parent. `AgentsPage.tsx` owns a new `showAddAgentModal` boolean and renders an "Add Agent" trigger button; `AddAgentForm` gains `open: boolean` and `onClose: () => void` props (replacing its internal `collapsed`/`setCollapsed` state and the clickable disclosure-header block). This mirrors the existing lift-to-parent + conditional-render precedent used for `AgentDetailModal` (`expandedAgent` state in `AgentList.tsx` around line 1423, conditional render at lines 1571-1572).
- **Modal styling/behavior**: follow the lightweight overlay convention from `ConfirmDialog.tsx` and `FolderPickerModal.tsx` — `fixed inset-0 z-50 flex items-center justify-center bg-black/40` overlay, overlay-click-to-close (compare pointer target to `e.currentTarget`), and escape-to-close via a `useEffect` that adds/removes a `keydown` listener while `open` is true. No `createPortal`, no body-scroll lock, no focus trap — none of the existing lightweight dialogs in this codebase implement those, and `AddAgentForm` isn't deeply nested in the DOM today so a portal isn't needed.
- **Nested pieces stay nested**: the existing inline "Add project" sub-form (`showAddProject` state, `AddAgentForm.tsx:44, 221-233, 235-319`) and the `FolderPickerModal` invoked from the workdir browse button (`AddAgentForm.tsx:163-169`) keep working exactly as they do today, just inside the new modal's content area instead of inside the old collapsible card.
- **Layout**: `AgentsPage.tsx`'s `grid grid-cols-2 gap-4` currently exists only to place `AddAgentForm` and `InactiveAgentsPanel` side by side. Once `AddAgentForm` is a modal (not permanently occupying a grid cell), re-check whether that grid should collapse to a single column with the "Add Agent" button placed near `InactiveAgentsPanel` or in a header row above `AgentList`.
- **Scope**: this task only covers `AddAgentForm`. `AddProjectForm.tsx`, `AddBgProcessForm.tsx`, and `AddTaskForm.tsx` follow different patterns (always-on inline, or already nested inside `AgentDetailModal`) and are out of scope — no broader "convert all Add*Form to modals" effort is implied or started here.

## Steps

### 1. Convert AddAgentForm into a modal <!-- agent: general-purpose -->

- [x] In `frontend/src/components/AddAgentForm.tsx`:
  - Add a props interface `AddAgentFormProps { open: boolean; onClose: () => void }` and change the function signature to `export default function AddAgentForm({ open, onClose }: AddAgentFormProps)`.
  - Remove the `collapsed`/`setCollapsed` state (`AddAgentForm.tsx:41`) and the clickable disclosure-header `<div>` (`AddAgentForm.tsx:170-184`) that currently toggles it.
  - Return `null` early when `!open` (matching `ConfirmDialog.tsx`'s `if (!open) return null` convention).
  - Wrap the existing form content (currently gated by `{!collapsed && (...)}` at `AddAgentForm.tsx:185`) in a `fixed inset-0 z-50 flex items-center justify-center bg-black/40` overlay `<div>` with an overlay-click-to-close handler (`if (e.target === e.currentTarget) onClose()`), containing an inner card `<div>` with a header (title "Add Agent" + an explicit close button calling `onClose`) and the form body.
  - Add a `useEffect` that registers a `keydown` listener for `Escape` calling `onClose` while `open` is true, cleaning up on unmount/close — same pattern as `ConfirmDialog.tsx`'s existing escape handler.
  - On successful submit (wherever the form currently resets/clears state after a successful add-agent call), also call `onClose()` so the modal closes after a successful add.
  - Leave the nested "Add project" sub-form (`showAddProject` state and its JSX) and the `FolderPickerModal` invocation (`AddAgentForm.tsx:163-169`, `showProjPicker` state) untouched functionally — they should keep working unchanged inside the new modal card.

<!-- Updated: 2026-09-17 -->
<!-- AddAgentForm.tsx: added AddAgentFormProps interface (open/onClose), changed signature accordingly, removed collapsed state + disclosure header, added `if (!open) return null`, wrapped form in a ConfirmDialog-style overlay (bg-black/40, overlay-click-to-close) + inner card with header/close button, added an Escape-key useEffect mirroring ConfirmDialog's, clearOnSuccess() now also calls onClose(). showAddProject/FolderPickerModal usage untouched functionally. tsc --noEmit: exactly the one expected AgentsPage.tsx prop-wiring error (TS2739, missing open/onClose), AddAgentForm.tsx itself clean. -->

### 2. Wire the trigger button and state into AgentsPage <!-- agent: general-purpose -->

- [x] In `frontend/src/pages/AgentsPage.tsx`:
  - Add `const [showAddAgentModal, setShowAddAgentModal] = useState(false)`.
  - Replace the unconditional `<AddAgentForm />` with an "Add Agent" trigger button (`onClick={() => setShowAddAgentModal(true)}`) placed in the layout, and render `<AddAgentForm open={showAddAgentModal} onClose={() => setShowAddAgentModal(false)} />` unconditionally alongside it (the component internally returns `null` when closed).
  - Re-evaluate the `grid grid-cols-2 gap-4` wrapper currently holding `AddAgentForm` and `InactiveAgentsPanel` (`AgentsPage.tsx:8-11`) now that `AddAgentForm` no longer needs a permanent grid cell — collapse to a layout that places the new "Add Agent" button sensibly next to `InactiveAgentsPanel` or above `AgentList`.

<!-- Updated: 2026-09-17 -->
<!-- AgentsPage.tsx rewritten: showAddAgentModal state added; the old grid grid-cols-2 wrapper replaced with a flex items-start gap-4 row holding a new "+ Add Agent" primary-CTA button (styled to match AddAgentForm's own submit-button classes) + InactiveAgentsPanel in a flex-1 wrapper; AddAgentForm now renders unconditionally below with open/onClose wired, returning null internally when closed. tsc --noEmit: zero errors, the one known error is resolved. -->

### 3. Add test coverage <!-- agent: general-purpose -->

- [x] Create `frontend/src/components/AddAgentForm.test.tsx` following the conventions in `frontend/src/components/ConfirmDialog.test.tsx`, covering:
  - Renders nothing when `open={false}`.
  - Renders the modal content when `open={true}`.
  - Calls `onClose` on Escape keydown.
  - Calls `onClose` on overlay (backdrop) click, but not on a click inside the card.
- [x] Run the frontend test suite and confirm no regressions in `frontend/src/components/AgentList.test.tsx` (which references `AddAgentForm` only in a comment about shared role-color maps, per prior investigation — no functional coupling expected).

<!-- Updated: 2026-09-17 -->
<!-- Created AddAgentForm.test.tsx (4 tests) mirroring ConfirmDialog.test.tsx's harness + CheckpointList.test.tsx's api-mocking pattern (listProjects mocked since it fires on mount). Covers: open=false renders nothing, open=true shows header/inputs/submit button, Escape calls onClose, overlay click calls onClose but a click inside the card does not. Full suite: 9 files/155 tests pass, 0 failures — including AgentList.test.tsx's 96 tests, no coupling regressions. -->

### 4. Manual verification <!-- agent: general-purpose -->

- [DEFERRED-TO-UAT] Start the dev servers (`make dev`), open the Agents page in a browser, and verify: the "Add Agent" button opens the modal, Escape and overlay-click both close it, the nested "Add project" sub-form and folder-picker still work from inside the modal, and a successful agent creation closes the modal and shows the new agent in `AgentList`.

<!-- Updated: 2026-09-17 -->
<!-- Runtime/browser verification is out of tackle's static-gates-only scope; deferred to UAT (/uat-generate + /uat-auto for what's automatable, /uat-walk for the live-browser cases). -->
