---
id: UAT-138
aliases: [UAT-138]
title: "UAT: Fix xterm mousedown focus-steal while Direct Input is active"
status: passed
task: TASK-138
created: 2026-09-13
updated: 2026-09-13
---

# UAT-138 — UAT: Fix xterm mousedown focus-steal while Direct Input is active

implements::[[TASK-138]]

> **Source task**: [[TASK-138]]
> **Generated**: 2026-09-13

---

## Prerequisites

- [ ] Dashboard dev servers running (`make dev` — host-server on :8788, frontend on :4321)
- [ ] A disposable test agent exists (`focus-audit-test`, agent id 19, launch command `bash`, left running by TASK-136/137 — create a fresh one via `POST /agents` with `launchCmd: "bash"` if it no longer exists)

---

## Test Cases

### UAT-UI-001: Single click on the terminal while Direct Input is active no longer breaks input
- **Page**: `http://localhost:4321/` → `focus-audit-test` agent detail modal
- **Description**: The originally-confirmed-broken scenario (TASK-136) — verifies the `onMouseUp` re-focus fix on `xtermContainerRef` in `LogTail.tsx`.
- **Steps**:
  1. Open the modal; confirm Direct Input auto-arms and focus is on the capture div.
  2. Click once anywhere inside the rendered terminal output.
  3. Read `document.activeElement` — note it may momentarily become `.xterm-helper-textarea` on mousedown.
  4. After the click completes (mouseup), re-read `document.activeElement`.
  5. Type a character and check the tmux pane.
- **Expected Result**: After step 4, `document.activeElement` is back on the capture div (not the helper textarea), and the character typed in step 5 reaches the tmux pane.
- **Repeatable Unit Test**: Not applicable: requires a real browser DOM, live xterm.js instance, and a real tmux pane.
- [x] Pass <!-- 2026-09-13 -->

### UAT-UI-002: Double-click-to-expand while Direct Input is active no longer breaks input (the originally reported bug)
- **Page**: `http://localhost:4321/` → `focus-audit-test` agent detail modal
- **Description**: The exact bug the user originally reported — verifies it end-to-end.
- **Steps**:
  1. Open the modal with Direct Input active.
  2. Double-click the terminal output area.
  3. Confirm the log panel visibly expands.
  4. Read `document.activeElement`.
  5. Type a character and check the tmux pane.
- **Expected Result**: The expand toggle fires AND `document.activeElement` is the capture div afterward AND the typed character reaches the pane.
- **Repeatable Unit Test**: Not applicable: same reasons as UAT-UI-001.
- [x] Pass <!-- 2026-09-13 -->

### UAT-UI-003: Drag-select inside the terminal still works and focus recovers afterward
- **Page**: `http://localhost:4321/` → `focus-audit-test` agent detail modal
- **Description**: Confirms the `mouseup`-not-`mousedown` fix direction was correct — this is the reason the fix couldn't simply be "refocus on every mousedown," which would break selection.
- **Steps**:
  1. Open the modal with Direct Input active.
  2. Click-and-drag across text in the terminal output to select it, then release.
  3. Confirm a real text selection was produced (`.xterm-selection` overlay present, or `window.getSelection()` non-empty).
  4. Read `document.activeElement`.
  5. Type a character and check the tmux pane.
- **Expected Result**: The selection from step 3 is real and intact, `document.activeElement` is the capture div after the drag completes, and the typed character reaches the pane.
- **Repeatable Unit Test**: Not applicable: same reasons as UAT-UI-001.
- [x] Pass <!-- 2026-09-13 -->

### UAT-EDGE-001: Existing `!interacting` single-click-to-arm and `onDoubleClick={onToggleExpand}` behaviors are unaffected
- **Scenario**: The new `onMouseUp` handler is additive on the same `xtermContainerRef` element — this case confirms it didn't regress the two pre-existing handlers on that element.
- **Steps**:
  1. Open the modal via a normal path where Direct Input is NOT yet active (if reachable), or manually stop Direct Input via its toggle button.
  2. Click once on the terminal; confirm Direct Input arms (`interacting` becomes true) via the existing `!interacting` click-to-arm path.
  3. Double-click the terminal while Direct Input is active; confirm the expand toggle still fires (already covered by UAT-UI-002, cross-referenced here for the non-focus half of that behavior).
- **Expected Result**: Both pre-existing behaviors work exactly as before the fix.
- **Repeatable Unit Test**: Not applicable: same reasons as UAT-UI-001.
- [x] Pass <!-- 2026-09-13 -->

---

## Gaps (not tested this pass)

- None beyond what TASK-136's audit already flagged (CTA/needs-attention autofocus path, paste-after-focus-loss) — those are out of this task's scope (TASK-137/TASK-139 territory).
