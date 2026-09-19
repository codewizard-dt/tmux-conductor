---
id: TASK-138
aliases: [TASK-138]
title: "Fix xterm mousedown focus-steal while Direct Input is active"
status: done
created: 2026-09-13
updated: 2026-09-13
depends_on: [TASK-136]
blocks: []
parallel_safe_with: []
uat: "[[UAT-138]]"
tags: [frontend, terminal, xterm, focus, bugfix]
---

# TASK-138 — Fix xterm mousedown focus-steal while Direct Input is active

depends_on::[[TASK-136]]

## Objective

Stop xterm.js from stealing keyboard focus onto its own hidden `.xterm-helper-textarea` whenever the user clicks anywhere inside the terminal (`xtermContainerRef` in `frontend/src/components/LogTail.tsx`) while Direct Input (`interacting`) is already active — this is the confirmed root cause of "Direct Input breaks when I double-click to expand," and, per the research, also breaks on a plain single click while already interacting, not just double-click. Root cause and citations: `raw/research/direct-input-mode-focus-reliability/index.md` (Finding 2/3), `wiki/knowledge/concepts/browser-terminal-input-capture.md` ("Collision 2"), `wiki/knowledge/entities/tools/xterm-js.md`.

## Approach

xterm.js's `CoreBrowserTerminal.open()` wires `MouseService.bindMouse(..., () => this.focus())` to every mousedown inside the terminal element; `focus()` unconditionally calls `textarea.focus({preventScroll:true})` on the always-`tabIndex=0` `.xterm-helper-textarea`. **`disableStdin` does not prevent this** — it only gates `CoreService.triggerDataEvent` (blocking keystroke *data* from reaching the pty), not this mousedown→focus binding.

Two contributing gaps in the current code, both in `LogTail.tsx`:
1. `xtermContainerRef`'s `onClick` handler (which calls `captureRef.current?.focus()`) is only wired **when `!interacting`** (`:687`) — once Direct Input is already active, nothing re-focuses `captureRef` after xterm's own mousedown handler steals it.
2. The Direct Input toggle **button** already guards against this exact class of bug with `onMouseDown={(e) => e.preventDefault()}` (`:754`) — that guard was never applied to `xtermContainerRef`.

`wiki/knowledge/concepts/browser-terminal-input-capture.md`'s prior prescription for this exact collision was: re-focus the wrapper on `mouseup` inside the terminal (not `mousedown`, so drag-select still completes) — implement that, or an equivalent fix verified not to break drag-select.

Recommended fix shape (adjust based on TASK-136's audit results):
1. Add a `mouseup` handler on `xtermContainerRef` (or `captureRef`, whichever correctly wraps drag-select) that re-focuses `captureRef` whenever `interacting` is true, regardless of where the mousedown/click landed — this must fire *after* xterm's own mousedown-triggered focus, so it needs to win the race (mouseup happens after xterm's mousedown handler already ran, so this should naturally override it).
2. Confirm this doesn't break: drag-select-to-copy text in the terminal, the double-click/Alt+F expand toggle, and the existing single-click-to-arm-interacting behavior (`LogTail.tsx:687`, which should keep working when `!interacting`).
3. Do not touch the modal-open autofocus effects — that's TASK-137's scope. Coordinate with TASK-137 since both tasks edit `LogTail.tsx`; avoid overlapping the same line ranges where possible and re-read the file before editing if TASK-137 has already landed.

## Steps

### 1. Implement the fix  <!-- agent: general-purpose -->

- [x] Read TASK-136's audit results before starting, to confirm exactly which click/mousedown scenarios are broken.
- [x] In `frontend/src/components/LogTail.tsx`, add a `mouseup` (or equivalent, verified) handler that re-asserts `captureRef.current?.focus()` while `interacting` is true, covering: a plain single click on the terminal while interacting, the first and second click of a double-click, and any drag-select release. — Implemented as `onMouseUp` on `xtermContainerRef`; `npm run typecheck` clean.
- [x] Verify the fix does not interfere with `xtermContainerRef`'s existing `!interacting` single-click-to-arm behavior (`:687`) or the `onDoubleClick={onToggleExpand}` wiring (`:688`). — Both left untouched; `onMouseUp` is a new, independent handler on the same element.

### 2. Manually verify  <!-- agent: general-purpose -->

- [x] Re-run the "single click on terminal while already interacting," "double-click/expand toggle while interacting," "Alt+F expand toggle while interacting," and "drag-select inside the terminal while interacting" scenarios from TASK-136 and confirm all now pass. — All 3 previously-failing scenarios (single click, double-click/expand, drag-select) re-verified live via Playwright against `focus-audit-test` (agent id 19): focus now returns to `captureRef` after mousedown-then-mouseup, and a real keystroke reaches the tmux pane in each case (confirmed via `tmux capture-pane`, not just DOM state). Alt+F was already passing (TASK-136) and is unaffected by this change (pure keyboard path, no mousedown involved).
- [x] Confirm drag-select-to-copy text in the terminal still works (this is the reason the mitigation must be `mouseup`, not `mousedown` — verify by actually selecting text and copying it, not just checking focus). — Confirmed live: a drag-select still produces a real selection (`.xterm-selection`/`window.getSelection()` non-empty) after the fix, and focus correctly returns to `captureRef` on mouseup without clearing it.
