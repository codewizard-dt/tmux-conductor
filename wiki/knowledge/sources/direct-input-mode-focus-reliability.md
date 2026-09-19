---
id: direct-input-mode-focus-reliability
title: Direct Input Mode Focus Reliability
aliases: [direct-input-focus-audit]
updated: 2026-09-13
sources:
  - ../../raw/research/direct-input-mode-focus-reliability/index.md
confidence: extracted
tags: [frontend, terminal, xterm, keyboard, focus, bug]
---

# Direct Input Mode Focus Reliability

Two user-reported Direct Input failures — autofocus not landing when `AgentDetailModal` opens, and Direct Input "breaking" when the terminal is double-clicked to toggle `logExpanded` fullscreen — trace to two independent mechanisms, both confirmed against the live `LogTail.tsx`/`AgentList.tsx` code plus xterm.js's own source.

**Modal-open autofocus** is a data/timer race, not a browser quirk: both arm-on-mount effects in `LogTail.tsx` (`:448-455`, `:462-469`) gate the actual `captureRef.current?.focus()` call behind an async `/agents/:id/tail` fetch resolving *and* an additional `setTimeout(..., 0)`, with no verification afterward that focus landed and no retry if something else (e.g. the rename input's own `autoFocus`) won the race first.

**Double-click/expand breakage confirms and sharpens `derived_from::[[browser-terminal-input-capture]]`'s "Collision 2"**, previously verified only empirically in the live app: xterm.js's `MouseService.bindMouse` wires every mousedown inside the terminal element to `CoreBrowserTerminal.focus()`, which calls `textarea.focus({preventScroll:true})` on the always-`tabIndex=0` `.xterm-helper-textarea` — **`disableStdin` only gates `CoreService.triggerDataEvent` (blocking data reaching the pty) and has no effect on this mouse-driven focus binding.** This is now backed by a primary-source read of xterm.js's own TypeScript (via Context7), not just observed behavior.

**Critically, this is a shipped regression, not a new bug class**: `browser-terminal-input-capture.md`'s Collision 2 already prescribed the fix — "re-focus the wrapper on `mouseup` inside the terminal, not `mousedown`, so drag-select still completes" — but when `onDoubleClick={onToggleExpand}` was later added to `xtermContainerRef` (per `derived_from::[[agent-detail-modal-redesign]]`'s recommendation, reflected in `log-tail.md`'s "double-click-to-fullscreen" section), no `mouseup` refocus handler was implemented alongside it. `xtermContainerRef`'s `onClick` re-focus is also only wired when `!interacting` (`LogTail.tsx:687`), so once Direct Input is already active, *any* mousedown into the terminal — not just a double-click — loses focus to xterm's helper textarea with nothing to win it back.

**Full audit scope**: the same defect class (a focus-transition path with no corresponding re-focus path) likely affects other triggers beyond the two reported — see `raw/research/direct-input-mode-focus-reliability/index.md`'s Recommendation section for the Phase-0 audit checklist (interactSignal re-arm, single click while already interacting, collapse-from-expanded, rename-input timing).

## Phase 0 audit results — live-verified (2026-09-13, `TASK-136`)

Confirmed live against a disposable throwaway test agent (plain `bash`, not a real Claude Code session, so no real work was disturbed) — keystroke delivery was verified against the actual tmux pane content via `tmux capture-pane`, not just `document.activeElement`:

- **Single click on the terminal while `interacting` is already true**: confirmed **FAIL** — the same xterm mousedown→`.xterm-helper-textarea` focus-steal fires on a plain single click, not only a double-click. This was predicted by the research but not previously reproduced live.
- **Double-click/expand toggle while interacting**: confirmed **FAIL** (the originally reported bug) — the expand toggle itself fires correctly; only focus is lost.
- **Drag-select inside the terminal while interacting**: confirmed **FAIL** — focus is stolen on `mousedown`, before the drag begins; a real text selection still forms.
- **Alt+F expand toggle while interacting**: confirmed **PASS** — a pure keyboard path on the already-focused wrapper never triggers xterm's mouse-focus binding. This narrows the fix: the defect is specifically mouse-driven, not inherent to the expand mechanism itself.
- **Modal open — default mount path**: confirmed **PASS** — the `defaultInteractArmedRef` arm-on-mount effect worked reliably in this run.
- **Rename-cancel while Direct Input is active**: initially misreported as a new failure ("Escape drops focus to `<body>`, nothing restores `captureRef`"). **Corrected 2026-09-13**: `handleBlur` already deactivates Direct Input the moment the Rename input gains focus — the banner correctly disappears — so losing keystrokes after Escape-canceling Rename is expected (Direct Input is already off), and the modal closing on that Escape is the existing `!interacting` Escape-closes-modal path, not a defect. A speculative fix implemented on the strength of the original misdiagnosis was reverted once caught.

Full results table (including the correction): `wiki/work/tasks/TASK-136-audit-direct-input-focus-scenarios.md`'s `## Audit Results` section.

relates_to::[[log-tail]] relates_to::[[xterm-js]] relates_to::[[browser-terminal-input-capture]] relates_to::[[agent-detail-modal]] relates_to::[[agent-detail-modal-redesign]]
