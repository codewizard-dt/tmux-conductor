---
id: UAT-162
aliases: [UAT-162]
title: "UAT: Move the Details and Queued Tasks accordions into the AgentInfoTabs structure"
status: pending
task: TASK-162
created: 2026-09-18
updated: 2026-09-18
---

# UAT-162 — UAT: Move the Details and Queued Tasks accordions into the AgentInfoTabs structure

implements::[[TASK-162]]

> **Source task**: [[TASK-162]]
> **Generated**: 2026-09-18

---

## Prerequisites

- [ ] `make dev` running (host-server on :8788, frontend on :4321)
- [ ] At least one spawned agent visible in the dashboard, ideally one with `worktreePath` set (so the Checkpoints tab is present) and one or more queued tasks (so `Queued tasks (N)` shows a non-zero count)

---

## Test Cases

### UAT-UI-001: Details and Queued Tasks render as tabs in the correct position
- **Page**: `http://localhost:4321` → click any agent card to open `AgentDetailModal`
- **Description**: Confirms `frontend/src/components/AgentList.tsx`'s `tabs` array (lines ~859-998) renders exactly 7 entries in the tab strip (`role="tablist"`, `AgentInfoTabs.tsx:52`) in the order Terminal, Skills, Details, Queued Tasks, Diff, Usage, Checkpoints, and that the two new tabs' content matches their `tabs` array source (lines 921-980) instead of the old `<details>`/`<summary>` accordions.
- **Steps**:
  1. Open an agent's detail modal.
  2. Read the tab strip left-to-right; confirm the 7 labels appear in order: `Terminal`, `Skills` (or `Skills (N)` if any skills present), `Details` (or `Details •` if the agent's window is missing), `Queued tasks (N)`, `Diff` (if `diffPresent`), `Usage` (if `usagePresent`), `Checkpoints` (if the agent has a worktree).
  3. Click the `Details` tab. Confirm the panel shows Command, Workdir, Window (present/missing), Worktree (branch or "Create worktree" button), the `ModeSwitcher` control, and — only when the window is missing — a "Create window" button (`AgentList.tsx:926-968`).
  4. Click the `Queued tasks (N)` tab. Confirm the panel shows `TaskList` (the queue) followed by `AddTaskForm` (`AgentList.tsx:977-978`), and that `N` in the tab label matches the number of rows in `TaskList`.
  5. Confirm no `<details>`/`<summary>` disclosure triangle appears anywhere in the modal (the old accordion markup is fully removed).
- **Expected Result**: All 7 tabs are reachable by click; Details and Queued Tasks land between Skills and Diff; each panel's content matches the source in step 3/4; zero native `<details>` elements remain in the modal.
- **Repeatable Unit Test**: Not applicable: tab order, panel content, and the `Details •`/`Queued tasks (N)` label variants are already asserted by the existing `describe('AgentDetailModal Details/Queued Tasks tabs (TASK-162 Step 3)')` block in `frontend/src/components/AgentList.test.tsx` (6 tests, added by the task itself) — a real-browser walkthrough is the remaining gap, not a second unit assertion of the same render logic.
- [ ] Pass

### UAT-UI-002: Keyboard tab-list navigation cycles through the full 7-tab set in the live modal
- **Page**: `http://localhost:4321` → open an agent's detail modal (same agent as UAT-UI-001, with all 7 tabs present)
- **Description**: Confirms `AgentInfoTabs`'s roving-tabindex keyboard handler (`AgentInfoTabs.tsx:69-86`: ArrowRight/ArrowLeft move ±1 with wraparound via `% count`, Home/End jump to the first/last visible tab) works end-to-end against the real `AgentList.tsx` wiring (`activeTabId` state + `handleActiveTabChange`, `AgentList.tsx:633,809-811`), not just the synthetic 4-tab harness already covered in `AgentInfoTabs.test.tsx`.
- **Steps**:
  1. Click the `Terminal` tab to focus it.
  2. Press `ArrowRight` six times, confirming focus and the visibly active panel advance one tab at a time in order (Skills → Details → Queued tasks → Diff → Usage → Checkpoints), and that the underlying content pane changes each time (e.g. Terminal's xterm view disappears, Details' `<dl>` appears, etc.).
  3. Press `ArrowRight` a 7th time from Checkpoints; confirm focus wraps back to `Terminal` (not to a nonexistent 8th tab).
  4. Press `ArrowLeft` once from `Terminal`; confirm it wraps to `Checkpoints` (the last tab).
  5. Press `Home` from any tab; confirm `Terminal` becomes active. Press `End`; confirm the last present tab (`Checkpoints`, or `Usage`/`Diff` if Checkpoints is absent for this agent) becomes active.
- **Expected Result**: Keyboard navigation visits all 7 tabs in order with no skips or dead stops, wraps correctly at both ends, and Home/End jump to the first/last tab — matching the algorithm already unit-tested generically in `AgentInfoTabs.test.tsx`, now confirmed against the real 7-tab production tab set.
- **Repeatable Unit Test**: Not applicable: `AgentInfoTabs.test.tsx`'s existing `ArrowRight`/`ArrowLeft`/`Home`/`End` suite (a 4-tab synthetic harness including a `present: false` tab) already exercises the identical `handleKeyDown`/`focusAndSelect` logic (`AgentInfoTabs.tsx:69-86`) — the component's behavior does not depend on tab count or which real labels are used, so a duplicate assertion swapping in the real 7 AgentDetailModal tabs would not exercise a different code path. This case exists to catch integration-only regressions (e.g. `activeTabId` wiring, a tab whose `present` condition breaks navigation) that the synthetic harness cannot see.
- [ ] Pass

### UAT-UI-003: Tab strip does not overflow or wrap awkwardly at narrow modal widths
- **Page**: `http://localhost:4321` → open an agent's detail modal at a reduced browser/viewport width (e.g. ~500-600px)
- **Description**: The task's own Notes flag this as an unverified concern: "Growing from 5 tabs to 7 in a fixed-width modal header strip has not been checked for overflow/wrapping behavior at narrow modal widths." The tablist is a plain `flex items-center gap-1` row with no `flex-wrap` or horizontal-scroll handling (`AgentInfoTabs.tsx:52`), so 7 tabs (up from 5) increases the chance of clipping or wrapping onto a second line at narrow widths.
- **Steps**:
  1. Resize the browser window (or use devtools responsive mode) to ~500-600px wide.
  2. Open an agent's detail modal with all 7 tabs present.
  3. Observe the tab strip: do all 7 labels remain on one line and legible, does the strip scroll horizontally, does it wrap to a second line pushing panel content down, or are trailing tabs (e.g. Checkpoints) clipped/inaccessible?
- **Expected Result**: All 7 tabs remain usable — either by staying on one line, or via a deliberate scroll/wrap affordance that keeps every tab clickable and readable. Silent clipping of trailing tabs (making Usage/Checkpoints unreachable by click) would be a regression introduced by this task's 5→7 tab growth.
- **Repeatable Unit Test**: Not applicable: overflow/wrapping is a rendered-layout/CSS concern (`jsdom` performs no layout), verifiable only in a real browser viewport.
- [ ] Pass

## Gaps

- **Terminal-fullscreen (⌥F) interaction dropped**: the task's own Step 4 verify note called for confirming "`⌥F` Terminal-fullscreen no longer needs special-case handling for these two sections." Investigation during UAT generation found that the `logExpanded` state and the entire fullscreen-toggle mechanism referenced in the task's Step 1/2 design notes (`AgentList.tsx`'s prior `logExpanded`-driven `' hidden'` className logic, and the `handleActiveTabChange` comment about closing fullscreen Terminal) no longer exist anywhere in `frontend/src` — a later, unrelated change removed the fullscreen-Terminal feature entirely (`handleActiveTabChange` is now just `setActiveTabId(id)`, `AgentList.tsx:809-811`; a repo-wide search for `logExpanded` returns zero matches). There is no fullscreen mechanism left to test against the new tab set, so this specific verify concern is moot rather than failing — dropped instead of writing a test against a feature that no longer exists.
