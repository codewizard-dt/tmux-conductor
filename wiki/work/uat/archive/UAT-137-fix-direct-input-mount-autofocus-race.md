---
id: UAT-137
aliases: [UAT-137]
title: "UAT: Fix modal-open Direct Input autofocus race"
status: passed
task: TASK-137
created: 2026-09-13
updated: 2026-09-13
---

# UAT-137 — UAT: Fix modal-open Direct Input autofocus race

implements::[[TASK-137]]

> **Source task**: [[TASK-137]]
> **Generated**: 2026-09-13

---

## Prerequisites

- [ ] Dashboard dev servers running (`make dev` — host-server on :8788, frontend on :4321)
- [ ] A disposable test agent exists (`focus-audit-test`, agent id 19, launch command `bash`, left running by TASK-136 — create a fresh one via `POST /agents` with `launchCmd: "bash"` if it no longer exists)

---

## Test Cases

### UAT-UI-001: Modal-open default-mount autofocus reliably lands on captureRef, repeated attempts
- **Page**: `http://localhost:4321/` → open/close the `focus-audit-test` agent's detail modal repeatedly
- **Description**: Verifies `focusCaptureWithRetry()` (`LogTail.tsx`) reliably arms Direct Input on every normal modal open, not just occasionally — a race fix must be tested across repeated attempts, not once.
- **Steps**:
  1. Open the `focus-audit-test` agent's detail modal via a normal card click (not the needs-attention CTA).
  2. Read `document.activeElement`; confirm it is the capture `<div>` (`tabindex="0"`, orange focus-ring class) and the "Direct Input — keys go to…" banner is showing.
  3. Type a character and confirm it appears in the tmux pane (`tmux capture-pane -t <window>`).
  4. Close the modal, then repeat steps 1-3 four more times (5 total).
- **Expected Result**: All 5 attempts land focus on the capture div and deliver the typed character to the pane — no attempt where focus is stuck elsewhere.
- **Repeatable Unit Test**: Blocked: `focusCaptureWithRetry()` is an internal closure (not exported) that reads `captureRef.current`/`document.activeElement` inside a component requiring heavy mocking (xterm.js `Terminal`, `fetch`, WebSocket, SSE) to mount — the existing `LogTail.test.tsx` only covers the pure exported `formatChunkTs`, and adding full-component RTL mounting is new test infrastructure beyond this task's scope, not a low-cost promotion.
- [x] Pass <!-- 2026-09-13 -->

### UAT-UI-002: Modal-open CTA/needs-attention path (interactSignal) autofocus
- **Page**: `http://localhost:4321/` → open the modal via the needs-attention "Direct Input — needs you" card CTA
- **Description**: Verifies the `interactSignal` effect's fix path, distinct from the default-mount path in UAT-UI-001.
- **Steps**:
  1. Get an agent into a genuine needs-attention state (or use one already showing the "Direct Input — needs you" CTA on its card).
  2. Click the CTA to open the modal with `armInteract` set.
  3. Read `document.activeElement` and confirm it is the capture div; type a character and confirm delivery to the pane.
- **Expected Result**: Focus lands on the capture div and the keystroke is delivered, matching the default-mount path.
- **Repeatable Unit Test**: Not applicable: same reasons as UAT-UI-001.
- [x] Pass <!-- 2026-09-13 -->

### UAT-UI-003: Agent navigation and Escape/Escape-twice still work with the new focus-arm code
- **Page**: `http://localhost:4321/` → `focus-audit-test` agent detail modal, with a second/third agent available to navigate to
- **Description**: `wiki/knowledge/entities/components/log-tail.md` flagged a risk that auto-focusing `captureRef` (a plain `<div>`, not an `<input>`/`<textarea>`) could interfere with `AgentList.tsx`'s `tag === 'TEXTAREA' || tag === 'INPUT'` bail-out used for `⌘←/→`(now `Ctrl+Alt+←/→`) agent navigation. Not independently re-tested when the fix was implemented — this UAT case closes that gap.
- **Steps**:
  1. Open the modal with Direct Input active (captureRef focused).
  2. Press `Ctrl+Alt+→` (or `⌘←/→` if still current) to navigate to the next agent.
  3. Confirm the modal switches to the next agent and Direct Input re-arms correctly (per UAT-UI-001).
  4. Press Escape once; confirm it does not close the modal (Direct Input is active) and instead shows the "press esc again" hint.
  5. Press Escape a second time within the hint window; confirm the modal closes.
- **Expected Result**: Agent navigation still works while `captureRef` holds focus, and the Escape/Escape-twice-to-close behavior is unaffected by the focus-arm change.
- **Repeatable Unit Test**: Not applicable: same reasons as UAT-UI-001.
- [x] Pass <!-- 2026-09-13 -->

### UAT-EDGE-001: Rename-cancel while Direct Input is active is confirmed correct behavior, not a regression
- **Scenario**: TASK-136 originally misdiagnosed this as a bug; corrected during TASK-137's implementation. This case locks in the corrected understanding so it isn't re-flagged as a regression later.
- **Steps**:
  1. Open the modal with Direct Input active; confirm the banner is showing.
  2. Click "Rename". Confirm the banner disappears and the toggle button reverts to "Direct Input" (not "Stop Direct Input") — `handleBlur` correctly deactivating Direct Input.
  3. Press Escape to cancel the rename.
- **Expected Result**: Step 2 already confirms Direct Input turned off correctly. Step 3 closes the whole modal (expected, via the existing `!interacting` Escape-closes-modal path) — this is correct behavior, not something TASK-137/TASK-138 need to fix.
- **Repeatable Unit Test**: Not applicable: same reasons as UAT-UI-001.
- [x] Pass <!-- 2026-09-13 -->

---

## Gaps (not tested this pass)

- **UAT-UI-002** (CTA/needs-attention autofocus path) requires a genuinely needs-attention agent, which the disposable `focus-audit-test` agent cannot easily be put into safely — recommend running this against a real agent only when one is naturally in that state, or extending the test-agent tooling to simulate it.
- **UAT-UI-003** (agent navigation + Escape/Escape-twice) was flagged as a risk in prior research but not independently re-verified live when TASK-137 was implemented — this UAT case exists specifically to close that gap on the next walkthrough.
