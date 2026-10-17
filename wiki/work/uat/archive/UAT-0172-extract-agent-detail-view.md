---
id: UAT-0172
aliases: [UAT-0172]
title: "UAT: Extract AgentDetailModal's content into a non-overlay AgentDetailView"
status: passed
task: TASK-0172
created: 2026-09-18
updated: 2026-09-19
---

# UAT-0172 — UAT: Extract AgentDetailModal's content into a non-overlay AgentDetailView

implements::[[TASK-0172]]

> **Source task**: [[TASK-0172]]
> **Generated**: 2026-09-18

---

## Prerequisites

- [ ] Dev servers running: `make dev` (host-server on port 8788, frontend on port 4321). Live cases use `http://localhost:4321/` (NOT `:4173`, a stale preview build).
- [ ] At least one registered agent with a live tmux window (`GET http://localhost:8788/api/status` lists `windowPresent: true`), so the Terminal tab loads and Direct Input arms by default. For UAT-INT-001's inactive-panel half, at least one agent whose derived status is `no-window`, `exited`, `error` or `unknown` (it then renders in the "Inactive Agents" panel).
- [ ] Live cases at a viewport at least 768px wide unless a step says otherwise (the `md:` breakpoint).

Source under test (all in `frontend/src/components/AgentList.tsx`, both exported): `AgentDetailView` (props `agent, project, projectId, status, onClose, armInteract, agentCount, onNavigate, onRenamed, onCloned, onRoleChanged` plus optional `onInteractingChange`; root `div.flex.h-full.min-h-0.flex-col.overflow-hidden.bg-card`; keeps the Cmd/Ctrl+Shift+Arrow keydown handler but registers no Escape listener) and the thin `AgentDetailModal` wrapper (`createPortal` to `document.body`; `div.fixed.inset-0.z-50[role=dialog][aria-modal=true][aria-label="<name> detail"]`; click-to-close backdrop `bg-black/40 backdrop-blur-[2px]`; panel `absolute inset-4 ... rounded-[14px] bg-card shadow-pop md:inset-8`; `document.body.style.overflow = 'hidden'` lock; Escape closes unless `interacting`). Consumers: `AgentList` (line ~2151) and `InactiveAgentsPanel` (`frontend/src/components/InactiveAgentsPanel.tsx:155`), both still mount `AgentDetailModal`. `AgentDetailView` has no in-app mount yet (TASK-0173), so its overlay-free behavior is only reachable through unit tests.

Coverage note: the wrapper and view cases are asserted in `frontend/src/components/AgentList.test.tsx`; no test in the repo asserts the wrapper's or the view root's class strings, the `md:inset-8` geometry, `InactiveAgentsPanel` mounting the modal, or the `TEXTAREA`/`INPUT` guard on the arrow-key handler. Those claims are live-only below.

---

## Test Cases

### UAT-UI-001: The overlay modal renders with the same DOM structure and geometry as before
- **Page**: `http://localhost:4321/` (route `/` renders `AgentsPage` then `AgentList`; click an agent row, `aria-label="<name> detail"`)
- **Description**: Wrapper renders `role="dialog"` `aria-modal="true"` labelled `<name> detail`, a backdrop, and a panel that hosts `AgentDetailView` whose root fills the panel. Rendered result must be unchanged from before the extraction.
- **Steps**:
  1. Run the unit test command below (asserts the dialog role, `aria-modal`, `aria-label`, and that the Terminal tab renders inside it).
  2. Open `http://localhost:4321/` at a viewport width of at least 768px and click an agent row so the modal opens.
  3. In devtools run:
     `(() => { const d = document.querySelector('[role="dialog"]'); const p = d.children[1]; const v = p.firstElementChild; const r = p.getBoundingClientRect(); return { dialog: d.className, aria: [d.getAttribute('aria-modal'), d.getAttribute('aria-label')], backdrop: d.children[0].className, panel: p.className, view: v.className, insets: [r.left, r.top, innerWidth - r.right, innerHeight - r.bottom] } })()`
  4. Resize the viewport to 600px wide and re-run the `insets` part.
- **Expected Result**: Unit test passes. Live: `dialog` = `fixed inset-0 z-50`; `aria` = `["true", "<name> detail"]`; `backdrop` = `absolute inset-0 bg-black/40 backdrop-blur-[2px]`; `panel` = `absolute inset-4 flex flex-col overflow-hidden rounded-[14px] bg-card shadow-pop md:inset-8`; `view` = `flex h-full min-h-0 flex-col overflow-hidden bg-card` (no rounded/shadow overlay classes on the view root); `insets` are `[32, 32, 32, 32]` at >=768px and `[16, 16, 16, 16]` at 600px; the header, tab strip and terminal fill the panel with no clipped or double-padded edges.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`AgentDetailModal overlay wrapper (TASK-0172) > renders the view inside a modal dialog labelled with the agent name`; written by the TASK-0172 tackle, no new file written by this generation run). Missing assertion: no test checks the panel/view class strings or the `md:inset-8` / `inset-4` geometry; that part is live-only (jsdom has no layout or media queries).
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "renders the view inside a modal dialog labelled with the agent name"` — verified: 1 passed
- [SKIP: user-directed — closing out] <!-- 2026-09-19 -->

---

### UAT-UI-002: Clicking the backdrop closes the modal
- **Page**: `http://localhost:4321/`
- **Description**: The backdrop `div` (`aria-hidden`) owns `onClick={onClose}`; the panel must not.
- **Steps**:
  1. Run the unit test command below (clicks the dialog's first child and expects exactly one `onClose` call).
  2. Live: open an agent's modal, click on the dimmed strip outside the panel (inside the 32px inset gutter), then reopen and click once inside the panel's header text.
- **Expected Result**: Unit test passes. Live: the gutter click closes the modal (no dialog in the DOM, background page visible); the click inside the panel does not close it.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`AgentDetailModal overlay wrapper (TASK-0172) > calls onClose when the backdrop is clicked`). The "click inside the panel does not close" half is not asserted by any test.
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "calls onClose when the backdrop is clicked"` — verified: 1 passed
- [SKIP: user-directed — closing out] <!-- 2026-09-19 -->

---

### UAT-EDGE-001: Escape closes the modal when Direct Input is not active
- **Scenario**: The wrapper's document `keydown` handler calls `onClose()` on `Escape` when `interacting` is false.
- **Steps**:
  1. Run the unit test command below (fires `keyDown(document, {key: 'Escape'})` with LogTail not interacting).
  2. Live: open an agent's modal; in the terminal banner click `stop` (ends Direct Input, banner "Direct Input — keys go to <name>" disappears); press `Escape`.
- **Expected Result**: Unit test passes (`onClose` called once). Live: the modal closes on the single Escape.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`AgentDetailModal overlay wrapper (TASK-0172) > calls onClose on Escape when not interacting`)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "calls onClose on Escape when not interacting"` — verified: 1 passed
- [x] Pass <!-- 2026-09-18 -->

---

### UAT-EDGE-002: Escape is not stolen from Direct Input, and closing resumes after it ends (deferred live check from TASK-0172)
- **Scenario**: While LogTail reports `interacting`, the wrapper's Escape handler must not close the modal (the wrapper learns `interacting` through `AgentDetailView`'s `onInteractingChange`, forwarded from LogTail's `onInteractChange`). LogTail's own double-Escape still closes via `onCloseModal={onClose}`.
- **Steps**:
  1. Run the unit test command below (drives the mocked LogTail's `onInteractChange(true)`, presses Escape, expects no `onClose`; then `onInteractChange(false)`, presses Escape, expects one `onClose`).
  2. Live: open an agent with a live window (Direct Input arms itself once the terminal loads; the amber banner "Direct Input — keys go to <name>" shows). Press `Escape` once.
  3. Wait more than 3 seconds, then press `Escape` once, then again within 800ms.
  4. Reopen the modal, press `Cmd+Escape` (macOS) or `Ctrl+Escape` once.
- **Expected Result**: Unit test passes. Live: step 2 leaves the modal open and shows the toast "Press esc again to close the modal" (with "Press ⌘/ctrl + esc to send esc to the agent"); step 3's first press re-shows the toast (it timed out after 3s), and the second press within 800ms closes the modal; step 4 keeps the modal open and sends Escape to the agent's pane (no close).
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`AgentDetailModal overlay wrapper (TASK-0172) > does not call onClose on Escape while Direct Input is active, and resumes once it ends` and `> wires LogTail's double-Escape onCloseModal to the modal's onClose, including through the bare view`) and `frontend/src/components/LogTail.test.tsx` (`LogTail Direct Input Escape handling (TASK-0172)`, 6 tests: hint text + double-Escape within 800ms calls `onCloseModal` and never reaches a document keydown listener; hint expires after 3s; a second Escape after 800ms does not close; Cmd/Ctrl+Escape POSTs `{keys:["Escape"]}` with no close or hint; `onInteractChange` reports true when armed and false on stop). Added by the uat-auto run for this UAT (tests only).
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx src/components/LogTail.test.tsx -t "does not call onClose on Escape while Direct Input is active|wires LogTail's double-Escape|LogTail Direct Input Escape handling"` — verified: 8 passed
- [x] Pass <!-- 2026-09-18 -->

---

### UAT-EDGE-003: Body scroll is locked while the modal is mounted and restored after
- **Scenario**: The wrapper's mount effect saves `document.body.style.overflow`, sets `hidden`, and restores the saved value on unmount. The view itself must not touch it.
- **Steps**:
  1. Run the unit test command below (sets overflow to `auto`, mounts, expects `hidden`, unmounts, expects `auto`).
  2. Live: in devtools run `document.body.style.overflow` (expect `""`), open an agent's modal and re-run, close the modal and re-run.
- **Expected Result**: Unit test passes. Live: `""` before, `"hidden"` while open, `""` after close.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`AgentDetailModal overlay wrapper (TASK-0172) > locks body scroll while mounted and restores it on unmount`)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "locks body scroll while mounted and restores it on unmount"` — verified: 1 passed
- [x] Pass <!-- 2026-09-18 -->

---

### UAT-EDGE-004: AgentDetailView rendered directly has no overlay behavior
- **Scenario**: Rendering `AgentDetailView` without the wrapper yields no `role="dialog"`, leaves `document.body.style.overflow` untouched, and does not react to Escape (in a non-overlay pane Escape must not deselect the agent). It has no in-app mount until TASK-0173, so no live check exists.
- **Steps**:
  1. Run the unit test command below (renders the view, asserts no dialog, Terminal tab present, overflow still `""`, `Escape` does not call `onClose`).
- **Expected Result**: 1 test passes.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`AgentDetailView without overlay chrome (TASK-0172) > has no dialog role, does not lock body scroll, and ignores Escape`)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "AgentDetailView without overlay chrome"` — verified: 1 passed
- [x] Pass <!-- 2026-09-18 -->

---

### UAT-UI-003: Tab strip contents, order and labels are unchanged inside the view
- **Page**: `http://localhost:4321/`
- **Description**: The `tabs` array stayed in `AgentDetailView`: `Terminal`, `Skills`, `Details` (or `Details •` when the window is missing), `Queued tasks (N)`, then data-driven `Diff`, `Usage`, `Checkpoints`. LogTail stays mounted across tab switches and `armInteract` forces the Terminal tab.
- **Steps**:
  1. Run both unit test commands below (`AgentDetailView tabbed info panel` renders the view directly; `AgentDetailView Details/Queued Tasks tabs` likewise).
  2. Live: open an agent's modal and read the `role="tablist"` labels in order; click `Details` then `Queued tasks`, then back to `Terminal`.
- **Expected Result**: Both unit commands pass. Live: order is Terminal, Skills, Details, Queued tasks (N), then whichever of Diff/Usage/Checkpoints have data; Details shows Command, Workdir, Window, Worktree rows and the mode switcher; Queued tasks shows the task list and the add-task form; returning to Terminal shows the same live terminal without a reload flash.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`AgentDetailView tabbed info panel (TASK-157)`, 3 tests; `AgentDetailView Details/Queued Tasks tabs (TASK-162 Step 3)`, 6 tests; these render `AgentDetailView` directly)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "AgentDetailView tabbed info panel|AgentDetailView Details/Queued Tasks tabs"` — verified: 9 passed
- [SKIP: user-directed — closing out] <!-- 2026-09-19 -->

---

### UAT-UI-004: Header actions still work and close the modal on success
- **Page**: `http://localhost:4321/`
- **Description**: Stop, Destroy, the actions menu (Rename, Change role, Clone), the two `ConfirmDialog`s and the `onClose`-on-success calls in `doRemove` / `doCloseWindow` moved with the view; through the wrapper they must still close the modal.
- **Steps**:
  1. Run the unit test command below (8 tests through the full `AgentList` tree, i.e. the wrapper: menu items, Stop hidden without a window, Rename pre-fill, both confirm messages, Clone POST with no confirm, Stop and Destroy closing the dialog on success).
  2. Live (non-destructive part only): open an agent's modal, open the `Agent actions` menu, choose `Rename`, confirm the pre-filled input, click `Cancel`; click `Stop agent` and then `Cancel` in the confirm dialog. Do not confirm Stop or Destroy on a real agent.
- **Expected Result**: Unit tests pass. Live: the menu lists exactly Rename, Change role, Clone; Rename swaps the trigger for the inline input; both confirm dialogs render inside the modal, and Cancel dismisses them leaving the modal open.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`AgentDetailModal actions menu wiring (TASK-148)`, 8 tests). Note: these render `AgentList` (the wrapper path), not `AgentDetailView` directly; the task asked for a repoint but they still cover the wired behavior.
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "AgentDetailModal actions menu wiring"` — verified: 8 passed
- [SKIP: user-directed — closing out] <!-- 2026-09-19 -->

---

### UAT-UI-005: Role switcher still works inside the view
- **Page**: `http://localhost:4321/`
- **Description**: `Change role` shows a select pre-filled with the current role and every `ROLE_VALUES` option; Save calls `updateAgentRole` and fires `onRoleChanged`; Cancel discards.
- **Steps**:
  1. Run the unit test command below (renders `AgentDetailView` directly).
- **Expected Result**: 3 tests pass.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`AgentDetailView role switcher (TASK-167)`, 3 tests)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "AgentDetailView role switcher"` — verified: 3 passed
- [SKIP: user-directed — closing out] <!-- 2026-09-19 -->

---

### UAT-UI-006: Skills list and header emphasis render unchanged
- **Page**: `http://localhost:4321/`
- **Description**: The flattened Skills list (`+N more` toggle at `SKILLS_VISIBLE_LIMIT` = 5), the 17px accent-blue agent name, the `md` `ProjectBadge`, and the most-recent-command strip under the header (`agent.activeTask`) all live in the view.
- **Steps**:
  1. Run both unit test commands below (each opens the modal through `AgentList`).
- **Expected Result**: Skills: 2 tests pass; header emphasis: 4 tests pass.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`AgentDetailModal Skills section (flattened list)`, 2 tests; `AgentDetailModal header emphasis and last-command row (TASK-154)`, 4 tests)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "AgentDetailModal Skills section|AgentDetailModal header emphasis"` — verified: 6 passed
- [SKIP: user-directed — closing out] <!-- 2026-09-19 -->

---

### UAT-EDGE-005: Cmd/Ctrl+Shift+Arrow agent cycling still works, and text fields are still exempt
- **Scenario**: The document `keydown` handler stayed in `AgentDetailView` (needs `onNavigate`). It cycles agents on Shift+Cmd (macOS) or Shift+Ctrl (elsewhere) with Left/Right; bare Cmd+Arrow and Ctrl+Alt+Arrow must not navigate; the handler returns early when the event target is a `TEXTAREA` or `INPUT`.
- **Steps**:
  1. Run the unit test command below (2 tests: Shift+Cmd+ArrowRight reaches the next agent while a filter hides it, bare Cmd+ArrowRight and Ctrl+Alt+ArrowRight do not navigate; the prev/next hint buttons call `onNavigate`).
  2. Live, with at least two active agents: open one agent's modal, press Shift+Cmd+ArrowRight (Shift+Ctrl on non-macOS), then Shift+Cmd+ArrowLeft.
  3. Live guard: click `Agent actions` then `Rename` so the inline rename `input` is focused, and press Shift+Cmd+ArrowRight with the cursor in it.
- **Expected Result**: Unit tests pass. Live: step 2 switches the dialog's `aria-label` to the next then back to the previous agent; step 3 does not switch agents.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`AgentList keyboard navigation ignores the grid filter`, 2 tests; `AgentDetailView agent-cycling shortcut text-field guard (TASK-0172)`, 2 tests: Shift+Cmd+ArrowRight/Left fired from an `<input>` or `<textarea>` never calls `onNavigate`, from a non-text target it calls `onNavigate('next'|'prev')`; added by the uat-auto run, tests only).
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "AgentList keyboard navigation ignores the grid filter|agent-cycling shortcut text-field guard"` — verified: 4 passed
- [x] Pass <!-- 2026-09-18 -->

---

### UAT-INT-001: Both consumers still open the same overlay modal
- **Page**: `http://localhost:4321/` (`AgentList` row click; `InactiveAgentsPanel` row click)
- **Description**: `AgentList` and `InactiveAgentsPanel` both mount the exported `AgentDetailModal` wrapper with unchanged props, so opening an agent from either place yields the same dialog.
- **Steps**:
  1. Run the unit test command below (a sidebar row click opens a dialog labelled `beta-api detail`).
  2. Live: click an active agent's sidebar row; confirm the dialog opens, then click the backdrop to close it.
  3. Live: expand the "Inactive Agents" panel, click an inactive agent's row, confirm the dialog opens with header, tabs, and the Details tab labelled `Details •` (no window). Click the backdrop, and confirm the panel's collapse state did not toggle (the list is still expanded).
- **Expected Result**: Unit test passes. Live: both entry points open the identical dialog (`role="dialog"`, `aria-label="<name> detail"`); closing it from the inactive panel does not collapse or expand the "Inactive Agents" list.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`AgentList sidebar (project grouping, TASK-0170) > still opens the detail modal when a sidebar row is clicked`) and `frontend/src/components/InactiveAgentsPanel.test.tsx` (new, added by the uat-auto run, tests only: a row click opens `role=dialog` `aria-label="<name> detail"` with the `Details •` tab; backdrop click and Escape close it; clicks inside the portalled modal do not toggle the panel's collapse state).
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx src/components/InactiveAgentsPanel.test.tsx -t "still opens the detail modal when a sidebar row is clicked|InactiveAgentsPanel opens AgentDetailModal"` — verified: 5 passed
- [SKIP: user-directed — closing out] <!-- 2026-09-19 -->

---

### UAT-INT-002: Live walk — opening an agent still looks and behaves exactly like before (deferred live check from TASK-0172)
- **Page**: `http://localhost:4321/`
- **Description**: The `[DEFERRED-TO-UAT]` step: no visible change from the extraction, end to end with a real terminal.
- **Steps**:
  1. Open `http://localhost:4321/` and click an active agent with a live window.
  2. Confirm the header shows name (and label if set), project badge, status badge, identity badge, context meter, and (for a waiting/stalled agent) the flashing `!`; the action buttons Stop, Destroy, the actions menu, previous/next hint buttons (only when more than one active agent) and the close `X` are on the right.
  3. If the agent has a most-recent command, confirm it shows in the mono strip under the header.
  4. Confirm the Terminal tab shows live output that fills the panel, and the amber "Direct Input" banner is present (default-on for a live window).
  5. Click the close `X`.
  6. From a waiting/awaiting agent's toast (if one appears) or CTA, open the modal and confirm it lands on the Terminal tab with Direct Input armed.
  7. Take a screenshot of the open modal to `wiki/work/uat/screenshots/UAT-0172-modal.png`.
- **Expected Result**: All header elements, tabs and the live terminal render as described with no layout glitches (no double borders, clipped header, or terminal not filling the panel); `X` closes the modal; the toast/CTA path opens on Terminal with Direct Input armed.
- **Repeatable Unit Test**: Not applicable: real terminal streaming, visual layout and toast/CTA flow need a real browser and live host-server; the discrete behaviors are covered by UAT-UI-001 to UAT-UI-006 and UAT-EDGE-001 to UAT-EDGE-005.
- [SKIP: user-directed — closing out] <!-- 2026-09-19 -->

---

### UAT-MANUAL-001: Frontend typecheck and full test suite are clean
- **Description**: The task's gate (`Run npm test and npm run typecheck in frontend/ — clean`); covers all the repointed and new tests together plus every other suite touching the file.
- **Steps**:
  1. Run `cd frontend && npm run typecheck` and confirm it exits 0 with no diagnostics.
  2. Run `cd frontend && npm test` and confirm no failures.
- **Expected Result**: Typecheck prints only the `tsc --noEmit` banner and exits 0; the suite passes (last run during generation: 10 test files, 203 tests, all passed).
- **Repeatable Unit Test**: Not applicable: this case is itself the project's static/unit gate, not a behavior that can be promoted to a single test.
- [x] Pass <!-- 2026-09-18 -->
