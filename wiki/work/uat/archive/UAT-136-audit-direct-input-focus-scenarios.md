---
id: UAT-136
aliases: [UAT-136]
title: "UAT: Audit every Direct Input focus-transition scenario"
status: passed
task: TASK-136
created: 2026-09-13
updated: 2026-09-13
---

# UAT-136 — UAT: Audit every Direct Input focus-transition scenario

implements::[[TASK-136]]

> **Source task**: [[TASK-136]]
> **Generated**: 2026-09-13

---

## Prerequisites

- [ ] Dashboard dev servers running (`make dev` — host-server on :8788, frontend on :4321)
- [ ] A disposable test agent exists to avoid touching real agent sessions (`focus-audit-test`, agent id 19, launch command `bash`, left running by TASK-136 — create a fresh one via `POST /agents` with `launchCmd: "bash"` if it no longer exists)

---

## Test Cases

### UAT-EDGE-001: Audit Results section exists and covers all 9 planned scenarios
- **Scenario**: TASK-136's deliverable is a completed `## Audit Results` table in the task file, not a code change.
- **Steps**:
  1. Open `wiki/work/tasks/TASK-136-audit-direct-input-focus-scenarios.md`.
  2. Confirm a `## Audit Results` section exists with one row per scenario: modal-open default mount, modal-open CTA path, single click while interacting, double-click/expand while interacting, Alt+F while interacting, collapse from expanded while interacting, rename-input race, drag-select while interacting, paste after focus loss.
- **Expected Result**: All 9 scenarios appear in the table with a recorded outcome (Pass / Fail / Not independently verified / Not tested this pass) — none silently omitted.
- **Repeatable Unit Test**: Not applicable: this checks the content of a markdown deliverable, not executable behavior.
- [x] Pass <!-- 2026-09-13 -->

### UAT-UI-001: Single click on the terminal while Direct Input is active steals focus (live re-verification)
- **Page**: `http://localhost:4321/` → open the `focus-audit-test` agent's detail modal
- **Description**: Re-confirms the audit's live-verified finding that a plain single click on the xterm container while `interacting` is true moves focus off `captureRef`.
- **Steps**:
  1. Open the `focus-audit-test` agent's detail modal (click its card). Direct Input auto-arms on mount; confirm the orange "Direct Input — keys go to focus-audit-test" banner is showing.
  2. In the browser console (or via a Playwright `browser_evaluate` call), read `document.activeElement` and confirm it is the capture `<div>` (has `tabindex="0"` and the orange focus ring class).
  3. Dispatch a real click on the terminal's `.terminal.xterm` element (mousedown → mouseup → click), or physically click inside the rendered terminal output area.
  4. Re-read `document.activeElement`.
  5. Type a character and check `tmux capture-pane -t <focus-audit-test window>` for whether it appears.
- **Expected Result**: After the click, `document.activeElement` is `.xterm-helper-textarea`, not the capture div, and the typed character does **not** appear in the tmux pane. (This is the confirmed-broken behavior TASK-137/TASK-138 must fix — this UAT case should flip to documenting the *fixed* behavior once those tasks land; do not weaken this assertion to match the bug.)
- **Repeatable Unit Test**: Not applicable: requires a real browser DOM, live xterm.js instance, and a real tmux pane — not isolable into a unit test.
- [x] Pass <!-- 2026-09-13 -->

### UAT-UI-002: Double-click-to-expand while Direct Input is active steals focus (live re-verification, the originally reported bug)
- **Page**: `http://localhost:4321/` → `focus-audit-test` agent detail modal
- **Description**: Re-confirms the originally reported user bug end-to-end: expand toggle fires correctly, but focus is lost.
- **Steps**:
  1. Open the modal with Direct Input active (same as UAT-UI-001 steps 1-2).
  2. Double-click the terminal output area.
  3. Confirm the log panel visibly expands (the "Expand log" button becomes "Collapse log", or the modal's non-terminal panels hide).
  4. Read `document.activeElement`.
  5. Type a character and check the tmux pane.
- **Expected Result**: The expand toggle fires (panel visibly expands), but `document.activeElement` is `.xterm-helper-textarea` and the typed character does not reach the pane.
- **Repeatable Unit Test**: Not applicable: same reasons as UAT-UI-001.
- [x] Pass <!-- 2026-09-13 -->

### UAT-UI-003: Alt+F expand toggle while Direct Input is active does NOT steal focus
- **Page**: `http://localhost:4321/` → `focus-audit-test` agent detail modal
- **Description**: Confirms the audit's finding that the keyboard-only expand path is safe, narrowing the fix to mouse-driven triggers only.
- **Steps**:
  1. Open the modal with Direct Input active; confirm focus is on the capture div.
  2. Press Alt+F (Option+F on macOS).
  3. Confirm the log panel visibly expands/collapses.
  4. Read `document.activeElement`.
  5. Type a character and check the tmux pane.
- **Expected Result**: The expand toggle fires, `document.activeElement` remains the capture div (not `.xterm-helper-textarea`), and the typed character reaches the pane.
- **Repeatable Unit Test**: Not applicable: same reasons as UAT-UI-001.
- [x] Pass <!-- 2026-09-13 -->

### UAT-UI-004: Canceling the Rename input while Direct Input is active correctly deactivates Direct Input (not a bug — corrected)
- **Page**: `http://localhost:4321/` → `focus-audit-test` agent detail modal
- **Description**: This case originally described a "newly discovered bug" (Rename-cancel drops focus to `<body>`). Re-verified and corrected 2026-09-13: `handleBlur` already deactivates Direct Input the instant the Rename input gains focus, so losing keystrokes after Escape-canceling Rename is expected behavior, not a defect — the modal itself closes on that Escape because Direct Input is (correctly) already off. This case now verifies the *correct* behavior instead.
- **Steps**:
  1. Open the modal with Direct Input active; confirm the "Direct Input — keys go to…" banner is showing and focus is on the capture div.
  2. Click "Rename". Confirm the rename `<input>` gains focus (expected — it has its own `autoFocus`) **and** the "Direct Input" banner disappears / the toggle button reverts to "Direct Input" (not "Stop Direct Input") — this is `handleBlur` correctly firing.
  3. Press Escape.
- **Expected Result**: The banner/toggle-button state already confirms Direct Input turned off in step 2. Pressing Escape in step 3 closes the whole modal (expected, since the modal's own Escape-closes-modal path is only guarded by `!interacting`, and `interacting` is already false by then) — this is not a focus-loss bug to fix.
- **Repeatable Unit Test**: Not applicable: same reasons as UAT-UI-001.
- [x] Pass <!-- 2026-09-13 -->

### UAT-EDGE-002: Drag-select inside the terminal while Direct Input is active steals focus but selection still works
- **Scenario**: Confirms the `mouseup`-not-`mousedown` fix direction is necessary — drag-select is a real, needed feature that must keep working after TASK-138's fix.
- **Steps**:
  1. Open the modal with Direct Input active; confirm focus is on the capture div.
  2. Click-and-drag across text in the terminal output to select it, then release.
  3. Read `document.activeElement` immediately after the initial mousedown (before drag completes) and again after mouseup.
  4. Confirm a text selection was actually produced (`.xterm-selection` overlay present, or `window.getSelection()` non-empty).
- **Expected Result**: Focus moves to `.xterm-helper-textarea` on mousedown (before TASK-138's fix), and a real selection is still produced. After TASK-138's fix, focus should return to the capture div (ideally via a `mouseup` handler, per `browser-terminal-input-capture.md`) without breaking the selection.
- **Repeatable Unit Test**: Not applicable: requires real browser mouse events against a live xterm.js instance.
- [x] Pass <!-- 2026-09-13 -->

---

## Gaps (not tested this pass — see TASK-136's Audit Results for detail)

- **Modal open — CTA/needs-attention path** (`interactSignal` re-arm): not independently live-tested; no case above covers it. Recommend a follow-up case once a safe way to trigger a genuine needs-attention CTA on a disposable agent is worked out.
- **Paste immediately after a focus-loss scenario**: not tested; `handlePaste` is only bound while `interacting`, so it should fail the same way keydown does once focus is lost, but this was not independently confirmed.
- **Collapse-from-expanded state transition itself** (distinct from the focus question): TASK-136's live run did not cleanly confirm the panel actually returns to collapsed state on the second double-click — flagged for TASK-139 to re-check specifically.
