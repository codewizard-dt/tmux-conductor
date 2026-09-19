---
id: UAT-139
aliases: [UAT-139]
title: "UAT: Verify all Direct Input focus scenarios after the fix"
status: passed
task: TASK-139
created: 2026-09-13
updated: 2026-09-13
---

# UAT-139 — UAT: Verify all Direct Input focus scenarios after the fix

implements::[[TASK-139]]

> **Source task**: [[TASK-139]]
> **Generated**: 2026-09-13

---

## Prerequisites

- [ ] Dashboard dev servers running (`make dev` — host-server on :8788, frontend on :4321)
- [ ] A disposable test agent exists (`focus-audit-test`, agent id 19, launch command `bash` — create a fresh one via `POST /agents` with `launchCmd: "bash"` if it no longer exists)

---

## Test Cases

### UAT-EDGE-001: Full regression sweep — every TASK-136 audit scenario now passes
- **Scenario**: This is the roadmap's closing gate — every scenario TASK-136 audited must now pass (or have an explicitly recorded, justified exception), per TASK-139's own `## Verification Results` table.
- **Steps**:
  1. Open `wiki/work/tasks/TASK-139-verify-direct-input-focus-regressions.md`.
  2. Confirm the `## Verification Results` table covers every scenario from TASK-136's `## Audit Results` (modal-open default mount, modal-open CTA path, single click while interacting, double-click/expand while interacting, Alt+F while interacting, collapse from expanded while interacting, rename-cancel, drag-select while interacting, paste after focus loss).
  3. Confirm every row is either `PASS` or has an explicit, justified exception (not a silent gap).
- **Expected Result**: All 9 scenarios accounted for; 0 unexplained failures. (As of this UAT's generation: 8 PASS, 1 explicitly-justified residual gap — the CTA/needs-attention path, never independently live-tested but sharing verified code with the passing default-mount path.)
- **Repeatable Unit Test**: Not applicable: checks the content of a markdown deliverable against the live-verified findings recorded during TASK-136/137/138, not executable behavior in isolation.
- [x] Pass <!-- 2026-09-13, verified by direct inspection of TASK-139's ## Verification Results table: all 9 scenarios present, 8 PASS + 1 explicitly-justified gap (CTA path), 0 silent omissions. -->

### UAT-UI-001: Re-confirm the two originally-reported bugs are fixed, end to end, in one session
- **Page**: `http://localhost:4321/` → `focus-audit-test` agent detail modal
- **Description**: A final, single-session smoke test combining both originally-reported failures (modal-open autofocus + double-click-to-expand) to catch any interaction between the two fixes that isolated testing might miss.
- **Steps**:
  1. Open the modal via a normal card click. Confirm Direct Input auto-arms (banner showing, focus on capture div).
  2. Type a character; confirm it reaches the tmux pane.
  3. Double-click the terminal to expand. Confirm the panel expands, focus remains/returns to the capture div, and a second typed character reaches the pane.
  4. Double-click again to collapse. Confirm the panel collapses, focus remains/returns to the capture div, and a third typed character reaches the pane.
- **Expected Result**: All three keystrokes (steps 2-4) reach the tmux pane; the expand/collapse toggle visibly works both directions.
- **Repeatable Unit Test**: Not applicable: requires a real browser DOM, live xterm.js instance, and a real tmux pane.
- [x] Pass <!-- 2026-09-13, genuine live Playwright walkthrough against focus-audit-test (agent id 19): modal opened, "1" reached pane; real double-click expanded panel (Collapse log shown, focus retained), "2" reached pane; second real double-click collapsed panel (Expand log shown again), "3" reached pane. Final pane content: "adfg123" (a/d/f/g from TASK-137/138 verification, 1/2/3 from this pass). All steps genuinely verified, not auto-judged. -->

---

## Gaps (accepted, not blocking)

- **CTA/needs-attention autofocus path** (`interactSignal` effect): never independently live-tested across TASK-136/137/139 — no safe way was found to put the disposable test agent into a genuine needs-attention state. Shares the same `focusCaptureWithRetry()` code path as the verified default-mount case, so risk is assessed as low, but this remains an open item for a future pass if a safe test method is found.
