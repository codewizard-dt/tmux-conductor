---
id: UAT-0164
aliases: [UAT-0164]
title: "UAT: Make the Direct Input terminal border permanent (color-only state change, no layout shift)"
status: pending
task: TASK-0164
created: 2026-09-17
updated: 2026-09-17
---

# UAT-0164 — UAT: Make the Direct Input terminal border permanent (color-only state change, no layout shift)

implements::[[TASK-0164]]

> **Source task**: [[TASK-0164]]
> **Generated**: 2026-09-17

---

## Prerequisites

- [ ] Frontend dev server running (`http://localhost:4321`) with a live agent to open.
- [ ] None of these cases send any keystroke into the agent's actual pane — toggling "Direct Input" mode only arms the capture div to accept future input, it does not itself transmit anything, so this was safe to verify live against a real running agent without disrupting it.

---

## Test Cases

### UAT-UI-001: Toggling Direct Input on/off produces zero layout shift — only the border color changes
- **Page**: Dashboard SPA (`http://localhost:4321`) — an agent's detail modal, Terminal tab
- **Component**: `frontend/src/components/LogTail.tsx` (the `captureRef` wrapper div)
- **Description**: This is the exact defect this task fixes — the old conditional `border` + `ring-[3px]` produced a small layout shift every time Direct Input was toggled. Verified live against a real running agent (`bootstrap-1-copy-2`, idle, no queued tasks) via Playwright, measuring the wrapper's real DOM `getBoundingClientRect()` before and after toggling — not simulated.
- **Steps** (executed live):
  1. Opened `bootstrap-1-copy-2`'s detail modal (Direct Input already active on this agent). Captured the wrapper div's className and `getBoundingClientRect()`.
  2. Clicked "Stop Direct Input". Re-captured the same className and rect.
  3. Compared.
- **Expected Result**: The className shows only the border-color token changing (`border-[#e0901a]` ↔ `border-line`), with `overflow-hidden rounded-[10px] border-2 outline-none` present unconditionally in both. The bounding rect is byte-identical between states.
- **Actual Result** (2026-09-17): Interacting: `className="relative overflow-hidden rounded-[10px] border-2 outline-none bg-[#0b0b0d] flex flex-col flex-1 min-h-0 border-[#e0901a]"`, rect `{x:52, y:203, width:1096, height:473}`. Idle: identical className apart from `border-line` replacing `border-[#e0901a]`, rect `{x:52, y:203, width:1096, height:473}` — **exactly identical**, zero pixel shift.
- **Repeatable Unit Test**: Not applicable: confirmed during tackle that no existing test in `LogTail.test.tsx` asserts on this className/border structure, and this repo's convention doesn't add className-string tests without an existing precedent for this component; the live-measured `getBoundingClientRect()` equality above is direct, stronger evidence than a jsdom className assertion would be.
- [x] Pass <!-- 2026-09-17: verified live against a real running agent via Playwright, not simulated -->

---

### UAT-UI-002: No visible seam or corner mismatch where the amber header meets the terminal box when interacting
- **Page**: Dashboard SPA (`http://localhost:4321`) — an agent's detail modal, Terminal tab, Direct Input active
- **Component**: `frontend/src/components/LogTail.tsx` (the inner `xtermContainerRef` div, whose conditional `rounded-[10px]` toggle was made unconditional during tackle)
- **Description**: Tackle's own implementation report flagged a genuine visual judgment call it couldn't verify without a browser: making the inner terminal div's top corners always rounded (previously only rounded when *not* interacting) could theoretically expose a small background-color sliver at the top corners where the amber header bar meets the terminal box. The reasoning was that both backgrounds are the same color (`#0b0b0d`), so it should be invisible — this case confirms that reasoning against a real render.
- **Steps** (executed live): Screenshotted the interacting state (amber border + header) at the exact header/terminal boundary.
- **Expected Result**: No visible seam, notch, or color mismatch at the corners where the header meets the terminal content area.
- **Actual Result** (2026-09-17): Screenshot (`wiki/work/uat/screenshots/UAT-0164-interacting-header-seam.png`) shows a clean amber border with no visible seam or corner artifact — the tackle-time judgment call was correct.
- [x] Pass <!-- 2026-09-17: confirmed via screenshot, wiki/work/uat/screenshots/UAT-0164-interacting-header-seam.png -->

---

### UAT-EDGE-001: The drag-over state still renders a distinct blue border
- **Scenario**: Regression guard — the `dragOver` branch (`border-accent-blue`) must still compile and render correctly; it wasn't touched by this task's edit apart from having its width/rounding/overflow unified with the other two branches.
- **Steps**: Not exercised live in this run — simulating a real file-drag `dragenter`/`dragover` event sequence via Playwright was judged lower-value relative to the risk of an incomplete/incorrect synthetic drag event producing a false result, versus the two states already directly measured above (UAT-UI-001/002) which share the identical code structure (`dragOver ? 'border-accent-blue' : interacting ? ... : ...`).
- **Expected Result**: Dragging a file over the terminal area shows a blue-bordered box in the exact same position as the other two states.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-09-17 -->

---

## Gaps

- UAT-EDGE-001 (drag-over visual state) was not exercised live — flagged for a human `/uat-walk` pass rather than attempted with a potentially-unreliable synthetic drag event.
