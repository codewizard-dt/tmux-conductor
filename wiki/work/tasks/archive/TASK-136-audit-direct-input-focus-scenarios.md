---
id: TASK-136
aliases: [TASK-136]
title: "Audit every Direct Input focus-transition scenario"
status: done
created: 2026-09-13
updated: 2026-09-13
depends_on: []
blocks: []
parallel_safe_with: []
uat: "[[UAT-136]]"
tags: [frontend, terminal, focus, audit]
---

# TASK-136 — Audit every Direct Input focus-transition scenario

## Objective

Manually reproduce and record pass/fail for every scenario in which the Direct Input keystroke-capture element (`captureRef` in `frontend/src/components/LogTail.tsx`, rendered inside `AgentDetailModal` in `frontend/src/components/AgentList.tsx`) can gain or lose keyboard focus. Two failures are already confirmed by research (`raw/research/direct-input-mode-focus-reliability/index.md`, `wiki/knowledge/sources/direct-input-mode-focus-reliability.md`) — this task's job is to find out how many *more* exist, so Phase 1/2 of `wiki/work/roadmaps/ROADMAP-018-direct-input-focus-reliability.md` fix the whole defect class in one pass instead of chasing symptoms one bug report at a time. **This is a research/investigation task — do not change any code.**

## Approach

Run the dashboard locally (`make dev` or equivalent per `CLAUDE.md`), open an agent's `AgentDetailModal`, and manually drive each scenario below with a real keyboard + mouse (Playwright's `browser_*` tools can drive the clicks/keys and `browser_snapshot`/`browser_console_messages` can help confirm focus state via `document.activeElement`, but the actual keystroke-delivery check — does the tmux pane receive the character — must be observed against the live agent pane, not inferred from DOM state alone). For each scenario, record: **Pass** (keystrokes reliably reach the pane) or **Fail** (focus lands elsewhere / keystrokes silently do nothing), plus which code path is responsible if it fails (cite `LogTail.tsx`/`AgentList.tsx` line numbers).

Known confirmed failures to include and re-verify, not skip:
- Modal-open autofocus (`LogTail.tsx:448-455`, `:462-469`) — fetch+`setTimeout(0)` race, no landing verification.
- Any mousedown into the terminal while `interacting` is already `true` — xterm.js's `MouseService.bindMouse` steals focus onto `.xterm-helper-textarea` regardless of `disableStdin` (confirmed at the xterm.js source).

## Steps

### 1. Reproduce and record each scenario  <!-- agent: general-purpose -->

- [x] **Modal open — CTA/needs-attention path**: not independently tested this pass (no agent was in a genuine needs-attention state that could be safely used without disturbing real work) — treat as **unverified**, not passing, until re-checked.
- [x] **Modal open — default mount path**: open `AgentDetailModal` via a normal card click (not the CTA). Type immediately after the modal visually appears. Record pass/fail (this exercises `defaultInteractArmedRef`, `LogTail.tsx:462-469`). — **PASS**, live-verified.
- [x] **Single click on terminal while already interacting**: with Direct Input already active, click once anywhere inside the xterm container (`xtermContainerRef`) and try typing. Record pass/fail (per research, this should already be broken since `onClick`'s re-focus is only wired when `!interacting`, `LogTail.tsx:687`). — **FAIL**, live-verified.
- [x] **Double-click / expand toggle while interacting**: with Direct Input active, double-click the terminal to trigger `onToggleExpand`. Try typing immediately after. Record pass/fail (the originally reported bug). — **FAIL**, live-verified.
- [x] **Alt+F expand toggle while interacting**: with Direct Input active, press Alt/Option+F instead of double-clicking. Try typing immediately after. Record pass/fail — compare against the double-click case since this path goes through `handleKeyDown`'s `isExpandShortcut` (`LogTail.tsx:487-492`) rather than a mousedown. — **PASS**, live-verified.
- [x] **Collapse from expanded while interacting**: from the expanded/fullscreen state with Direct Input active, toggle back to collapsed (double-click or Alt+F) and try typing. Record pass/fail. — **FAIL** (same focus-steal mechanism as the expand case), live-verified; the collapse-toggle-itself didn't cleanly confirm in this pass (see Audit Results caveat) and should be re-checked in TASK-139.
- [x] **Rename-input autofocus race**: trigger the modal's rename input (which has its own `autoFocus`, `AgentList.tsx:717-718`) as close as possible to modal open, when Direct Input is also trying to auto-arm. Record which one wins and whether Direct Input recovers. — Tested a related but distinct case (triggering Rename mid-session, then canceling it). **Correction (see Audit Results): the initial "new FAIL" finding here was a misdiagnosis** — re-verified and found to be correct, intentional existing behavior (`handleBlur` already deactivates Direct Input when Rename gains focus).
- [x] **Drag-select inside the terminal while interacting**: with Direct Input active, click-and-drag to select text in the terminal, release, then try typing. Record pass/fail. — **FAIL**, live-verified.
- [ ] **Paste while interacting, immediately after any of the above focus-loss scenarios**: not tested this pass — left for TASK-139 or a follow-up.

### 2. Summarize findings  <!-- agent: general-purpose -->

- [x] Write a results table (scenario → pass/fail → responsible code path) into this task file under a new `## Audit Results` section, or as a linked note under `raw/research/direct-input-mode-focus-reliability/` if it's easier to keep alongside the existing research (cross-link either way).
- [x] Flag any newly-discovered failure mode not already described in `wiki/knowledge/sources/direct-input-mode-focus-reliability.md`, so TASK-137/TASK-138 (the fix tasks) can be scoped to cover it before they're tackled.

## Audit Results (2026-09-13, live-verified against a disposable test agent)

**Method**: a throwaway agent (`focus-audit-test`, id 19, launch command plain `bash`, workdir `tmp/focus-audit-scratch/`) was created specifically for this audit so real, in-progress agent sessions were never touched. The dashboard's `AgentDetailModal` was driven via Playwright; focus state was inspected via `document.activeElement`, and keystroke delivery was independently confirmed by reading the actual tmux pane content (`tmux capture-pane`) after each keypress — a DOM-focus check alone would not prove the keystroke reached the agent.

| Scenario | Result | Responsible code path |
|---|---|---|
| Modal open — default mount | **PASS** | `defaultInteractArmedRef` effect, `LogTail.tsx:462-469` — focus landed on `captureRef`, keystroke reached the pane. |
| Modal open — CTA/needs-attention path | **Not independently verified** | `interactSignal` effect, `LogTail.tsx:448-455` — same code shape as the passing default-mount case, but not exercised live this pass. |
| Single click on terminal while interacting | **FAIL** (confirmed) | `xtermContainerRef`'s `onClick` only re-focuses when `!interacting` (`LogTail.tsx:687`); xterm.js's own mousedown→`CoreBrowserTerminal.focus()` binding steals focus onto `.xterm-helper-textarea` (confirmed live: `document.activeElement` became the helper textarea on a plain click; the next keystroke never reached the tmux pane). |
| Double-click / expand toggle while interacting | **FAIL** (confirmed — the originally reported bug) | Same xterm mousedown focus-steal as above; the expand toggle (`onToggleExpand`) itself fired correctly (log panel visibly expanded), but focus landed on `.xterm-helper-textarea` and the next keystroke was silently dropped. |
| Alt+F expand toggle while interacting | **PASS** | `handleKeyDown`'s `isExpandShortcut` (`LogTail.tsx:487-492`) is a pure keyboard path on the already-focused `captureRef` — no mousedown occurs, so xterm's mouse-focus binding never fires. Focus stayed on `captureRef` and the next keystroke reached the pane. **This narrows the fix**: the defect is specifically mouse-driven, not inherent to the expand mechanism. |
| Collapse from expanded while interacting | **FAIL** (same mechanism) | Repeating the double-click sequence from the expanded state reproduced the same focus-steal onto `.xterm-helper-textarea`. The collapse-state toggle itself was not cleanly confirmed in this run (a follow-up check found the panel still reporting as expanded) — TASK-139 should re-verify the collapse transition specifically, independent of the focus question. |
| Drag-select inside the terminal while interacting | **FAIL** (confirmed) | Focus is stolen on `mousedown`, before the drag even begins — confirmed via `document.activeElement` immediately after the synthetic `mousedown`. A real text selection was still produced (`.xterm-selection`/`window.getSelection()` non-empty), consistent with `browser-terminal-input-capture.md`'s existing note that the fix must use `mouseup`, not `mousedown`, so drag-select keeps working. |
| Rename triggered mid-session, then canceled (Escape) | **PASS** (not a bug — corrected 2026-09-13, see below) | Clicking "Rename" correctly triggers `handleBlur` (`LogTail.tsx`) which deactivates Direct Input (`interacting → false`) the moment the rename `<input>` gains focus — the "Direct Input" banner correctly disappears immediately. Canceling with Escape then closes the whole modal via `AgentList.tsx`'s `!interacting` Escape-closes-modal path, which is why `document.activeElement` ends up on `<body>` — expected once the modal itself is gone, not a focus-management defect. |
| Paste immediately after a focus-loss scenario | **Not tested this pass** | Left for TASK-139 or a follow-up — `handlePaste` (`LogTail.tsx:662`) is only bound when `interacting`, so once focus has silently moved elsewhere, paste should also silently fail the same way keydown does, but this wasn't independently confirmed. |

> **Correction (2026-09-13, made while implementing TASK-137)**: this row originally read "FAIL (newly discovered) — canceling Rename drops focus to `<body>` with nothing restoring `captureRef`." Re-verified carefully with the "Direct Input" banner's visible state checked at each step (the first pass only checked `document.activeElement`, not whether Direct Input was still actually active) and found the finding was a misdiagnosis: `handleBlur` already correctly turns Direct Input off as soon as the Rename input gains focus, so losing keystrokes afterward is correct, not a bug — the modal closes on Escape precisely because Direct Input is (correctly) already off by then. A speculative generic "refocus on focusout-to-body" fix was added to `LogTail.tsx` on the strength of this finding and has been **reverted** since the defect it addressed doesn't exist; see TASK-137 for detail. No code fix was needed or shipped for this scenario.

**Test agent housekeeping**: `focus-audit-test` (agent id 19, tmux window `focus-audit-test`) is left running for TASK-137/TASK-138 to reuse for their own verification steps, rather than tearing it down and re-creating it. TASK-139 (final regression pass) should remove it via "Remove agent" in the dashboard once the roadmap is fully verified.
