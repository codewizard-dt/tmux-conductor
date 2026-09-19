---
id: UAT-0173
aliases: [UAT-0173]
title: "UAT: Wire sidebar row click to render AgentDetailView in the main content area"
status: pending
task: TASK-0173
created: 2026-09-18
updated: 2026-09-18
---

# UAT-0173 — UAT: Wire sidebar row click to render AgentDetailView in the main content area

implements::[[TASK-0173]]

> **Source task**: [[TASK-0173]]
> **Generated**: 2026-09-18

---

## Prerequisites

- [ ] Dev servers running: `make dev` (host-server on port 8788, frontend on port 4321). Live cases use `http://localhost:4321/` (NOT `:4173`, a stale preview build).
- [ ] At least one registered agent with a live tmux window (`GET http://localhost:8788/api/status` lists `windowPresent: true`), so the Terminal tab loads and Direct Input arms by default. UAT-UI-004 additionally needs a disposable scratch agent (its window will be killed).
- [ ] Live cases at a viewport at least 768px wide, and at least two active agents so row switching can be observed.
- [ ] Do NOT use Clone, Stop or Destroy on a real agent during live cases (a clone shares its source's workdir; Stop/Destroy remove the agent). Those paths are covered by unit tests below.

Source under test:
- `frontend/src/components/AgentList.tsx`: `AgentList` (selection state `expandedAgent: { id, armInteract } | null`; `expandedModalAgent` lookup at line ~2087; pane render at lines ~2153-2193: `div[role=region][aria-label="<name> detail"].flex.min-h-0.min-w-0.flex-1.flex-col` wrapping `<AgentDetailView key={agent.id} onClose={() => setExpandedAgent(null)} ...>`, else the empty state `Select an agent from the sidebar` followed by `BgProcessSection`), `AgentItem` (`selected` prop; `aria-current="true"` and `bg-canvas ring-2 ring-accent-blue/50` when selected; still `role="button"`, `aria-label="<name> detail"`), `AgentSidebar` (`aside[aria-label=Agents]`, `style={{ width: SIDEBAR_WIDTH_PX }}`), the `agent-removed` SSE handler (line ~2011, deselects via `setExpandedAgent((prev) => prev?.id === id ? null : prev)`).
- `frontend/src/lib/layoutConstants.ts` (`SIDEBAR_WIDTH_PX = 320`) and `frontend/src/lib/terminalSizeProbe.ts` (hidden node `fixed inset-y-0 right-0` with `style.left = SIDEBAR_WIDTH_PX px`, then `p-5`, then a bordered `border border-line` wrapper, then the `overflow-hidden` mount; posts `{cols, rows}` to `POST /api/terminal-size`).
- `frontend/src/pages/AgentsPage.tsx` (`main.flex.h-[calc(100vh-3rem)].w-full.flex-col.overflow-hidden`; not modified by this task).
- Sidebar row and pane share the accessible name `<name> detail` (row is `role=button`, pane is `role=region`), so live queries must include the role.

Coverage note: all unit-backed cases run in `frontend/src/components/AgentList.test.tsx` or `frontend/src/lib/terminalSizeProbe.test.ts` (jsdom; no layout, no media queries, real xterm mocked). No test asserts pixel geometry, the selected-row ring classes, the sidebar's inline width, real terminal rendering, or `tmux` window sizes; those claims are live-only below. Cases wholly covered by a unit test are typed EDGE so `/uat-auto` can judge them from the unit-test evidence.

---

## Test Cases

### UAT-EDGE-001: Clicking a sidebar row renders the agent's detail in the main pane, not in an overlay dialog
- **Scenario**: Row click calls `setExpandedAgent({ id, armInteract: false })`; the pane region `<name> detail` appears (containing the `Terminal` tab from `AgentDetailView`), no `role="dialog"` exists anywhere, and the pane is not a descendant of the sidebar.
- **Steps**:
  1. Run the unit test command below.
  2. Live: open `http://localhost:4321/`, click an agent row in the left sidebar.
  3. Check in devtools: `[document.querySelectorAll('[role="dialog"]').length, !!document.querySelector('[role="region"]'), document.querySelector('[role="region"]')?.closest('aside')]`.
- **Expected Result**: Unit test passes. Live: the detail (header, tab strip incl. Terminal) shows to the right of the sidebar with no dimmed backdrop; the devtools expression returns `[0, true, null]`.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`AgentList sidebar (project grouping, TASK-0170) > renders the detail view in the main pane (not an overlay dialog) when a sidebar row is clicked (TASK-0173)`; written by the TASK-0173 tackle, no new file written by this generation run)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "renders the detail view in the main pane"` — verified: 1 passed
- [x] Pass <!-- 2026-09-18 -->

---

### UAT-EDGE-002: Empty state and BgProcessSection show only while no agent is selected
- **Scenario**: With nothing selected the pane shows the card "Select an agent from the sidebar" followed by `BgProcessSection` ("Background processes"). Selecting an agent removes both. This is the deliberate behavior called out in the task's completion notes.
- **Steps**:
  1. Run the unit test command below.
  2. Live: load `http://localhost:4321/` with no row selected and observe the pane; click a row; observe again.
- **Expected Result**: Unit test passes. Live: unselected pane shows the empty-state card then the Background processes section (per-project groups); after a click neither the card nor "Background processes" is anywhere on the page.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`AgentList sidebar (project grouping, TASK-0170) > shows the empty state plus BgProcessSection when nothing is selected, and hides BgProcessSection while an agent is selected (TASK-0173)`)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "shows the empty state plus BgProcessSection"` — verified: 1 passed
- [x] Pass <!-- 2026-09-18 -->

---

### UAT-EDGE-003: The view's Close button deselects the agent and restores the empty state
- **Scenario**: `onClose` now means deselect. Clicking `Close` inside the pane sets `expandedAgent` to null: pane region disappears, empty state and `BgProcessSection` return, and the row loses `aria-current`.
- **Steps**:
  1. Run the unit test command below.
  2. Live: select a row, click the `Close` button in the pane header.
- **Expected Result**: Unit test passes. Live: the pane returns to "Select an agent from the sidebar" plus Background processes, and no sidebar row has the highlight ring or `aria-current`.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`AgentList sidebar (project grouping, TASK-0170) > the view's close button deselects the agent and returns the pane to the empty state (TASK-0173)`)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "close button deselects"` — verified: 1 passed
- [x] Pass <!-- 2026-09-18 -->

---

### UAT-EDGE-004: Only the selected row carries aria-current, and it follows the selection
- **Scenario**: `AgentItem` sets `aria-current="true"` only when `expandedAgent?.id === agent.id`; clicking a second row moves the attribute and removes it from the first. Rows keep `role="button"`.
- **Steps**:
  1. Run the unit test command below.
  2. Live: click row A, then row B; after each click run `[...document.querySelectorAll('aside [aria-current]')].map(e => e.getAttribute('aria-label'))`.
- **Expected Result**: Unit test passes. Live: the expression returns exactly `["<A> detail"]` after the first click and exactly `["<B> detail"]` after the second.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`AgentList sidebar (project grouping, TASK-0170) > marks only the selected sidebar row with aria-current (TASK-0173)`)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "marks only the selected sidebar row"` — verified: 1 passed
- [x] Pass <!-- 2026-09-18 -->

---

### UAT-EDGE-005: Switching rows fully remounts the view (per-agent local state does not leak)
- **Scenario**: The view is keyed by `agent.id`, so an open inline rename input in agent A's pane is gone after clicking agent B, and B's pane starts in its default state (previously such state leaked across modal navigation).
- **Steps**:
  1. Run the unit test command below.
  2. Live: select agent A, open `Agent actions` then `Rename` (an input pre-filled with A's name appears; do not save), switch to a different tab such as `Diff`, then click agent B in the sidebar.
- **Expected Result**: Unit test passes. Live: B's pane shows no rename input and no value equal to A's name in any input, the active tab is B's default (Terminal), and no confirm dialog from A is showing. Clicking A again shows A's default state (rename input not restored).
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`AgentList sidebar (project grouping, TASK-0170) > switching rows remounts the view, dropping the previous agent's local state such as an open rename input (TASK-0173)`, plus two gap tests added by the uat-auto run in `AgentList sidebar + pane selection gaps (TASK-0173 UAT)`: `switching rows resets the active tab and drops an open rename input, and returning to the first agent does not restore either` and `switching rows drops an open Stop agent confirmation, and returning to the first agent does not restore it`). Role input and `worktreeOverride` resets are not asserted individually (same `key` mechanism as the asserted state).
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "switching rows"` — verified: 3 passed
- [x] Pass <!-- 2026-09-18 -->

---

### UAT-EDGE-006: A removed selected agent returns the pane to the empty state and is not resurrected
- **Scenario**: SSE `agent-removed` for the selected id clears `expandedAgent` in the handler (not via an effect, so a just-cloned selection is not cleared early). A later `agent-update` with the same id does not re-select it.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: Unit test passes: after `agent-removed {id: 9}` the region `selected-removed-agent detail` is gone and "Select an agent from the sidebar" shows; after an `agent-update` with the same id the sidebar row returns but the pane region does not.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`NotificationStack grace-period toasts (TASK-146 Step 3) > agent-removed for the selected agent returns the pane to the empty state (TASK-0173)`; the test lives in the toast describe block because it reuses that block's SSE harness). Live variant intentionally omitted: it would require destroying a real agent.
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "agent-removed for the selected agent"` — verified: 1 passed
- [x] Pass <!-- 2026-09-18 -->

---

### UAT-EDGE-007: Stop agent / Destroy agent confirmations close the pane (onClose = deselect)
- **Scenario**: `doCloseWindow` (Stop agent) and `doRemove` (Destroy agent) call `onClose` after their DELETE succeeds; with the pane, that must remove the pane region.
- **Steps**:
  1. Run the unit test command below (matches the two tests whose names start with "confirming").
- **Expected Result**: Unit tests pass: after confirming Stop (window DELETE ok) and after confirming Destroy (agent DELETE ok) the region `<name> detail` is no longer in the document.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`AgentDetailModal actions menu wiring (TASK-148) > confirming Stop agent closes the modal once the window DELETE succeeds` and `> confirming Destroy agent closes the modal once the DELETE succeeds`; the tackle updated them from `dialog` to `region` queries). The uat-auto run added `AgentList sidebar + pane selection gaps (TASK-0173 UAT) > returns the pane to the empty state plus BgProcessSection after confirming Stop agent` and `> ... after confirming Destroy agent`, which assert the empty-state card and BgProcessSection reappear. No live variant: it would stop/destroy a real agent.
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "confirming"` — verified: 4 passed
- [x] Pass <!-- 2026-09-18 -->

---

### UAT-EDGE-008: Clicking a notification toast selects that agent in the pane, armed for Direct Input
- **Scenario**: `NotificationStack.onOpen` calls `setExpandedAgent({ id, armInteract: true })`: the agent's pane region renders and the toast is removed. The `armInteract` prop then forces the Terminal tab active when the view mounts.
- **Steps**:
  1. Run the unit test command below (two tests: toast click renders the pane; `armInteract: true` forces the Terminal tab on open).
- **Expected Result**: Unit tests pass. The pane region `open-agent detail` appears and the toast button is removed; the view with `armInteract: true` shows the Terminal tab active even after another tab had been selected.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`NotificationStack grace-period toasts (TASK-146 Step 3) > clicking a toast's body opens the agent detail modal (armed for Direct Input) and removes the toast` and `AgentDetailView tabbed info panel (TASK-157) > armInteract: true forces the Terminal tab active on open, overriding a tab the user had already switched to`). The uat-auto run added `AgentList sidebar + pane selection gaps (TASK-0173 UAT) > a toast click drives through AgentList to the target agent pane with its Terminal tab active, replacing another agent's pane and tab`, which drives a toast click through `AgentList` (with another agent's Skills tab open) and asserts the resulting pane's Terminal tab is selected and its tabpanel visible. Cycling through the pane is TASK-0174's scope.
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "toast's body|armInteract: true forces the Terminal tab|a toast click drives through AgentList"` — verified: 3 passed
- [x] Pass <!-- 2026-09-18 -->

---

### UAT-EDGE-009: No toast is raised for an agent that is already selected in the pane
- **Scenario**: The `expandedAgentRef` mirror suppresses awaiting toasts for the agent currently on screen; it must keep working now that "on screen" means the pane.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: Unit test passes: after selecting `open-modal-agent` and an `agent-update` to `awaiting` plus `NOTIFICATION_GRACE_MS`, no toast button appears for it.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`NotificationStack grace-period toasts (TASK-146 Step 3) > creates no toast for an agent whose detail modal is already open when its status enters awaiting`)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "creates no toast for an agent whose detail modal is already open"` — verified: 1 passed
- [x] Pass <!-- 2026-09-18 -->

---

### UAT-EDGE-010: The terminal-size probe's hidden node mirrors the pane geometry using the shared sidebar constant
- **Scenario**: `getProbeMount()` builds `div.fixed.inset-y-0.right-0` with `style.left = "<SIDEBAR_WIDTH_PX>px"`, `visibility: hidden`, `pointer-events: none`, containing `div.p-5` then a bordered `.border.border-line` wrapper then the `.overflow-hidden` mount. `SIDEBAR_WIDTH_PX` is imported from `frontend/src/lib/layoutConstants.ts` by both the probe and `AgentSidebar` (no duplicated `320`).
- **Steps**:
  1. Run the unit test command below (whole file; the probe node is created by the earlier sequential tests, so `-t` filtering a single case fails standalone).
- **Expected Result**: Unit tests pass (5): first-render/resize guards still hold, the probe's ancestry is `outer(fixed inset-y-0 right-0) > p-5 > border border-line > overflow-hidden`, and `outer.style.left` equals `${SIDEBAR_WIDTH_PX}px` with hidden/inert styling.
- **Repeatable Unit Test**: Created: `frontend/src/lib/terminalSizeProbe.test.ts` (`terminalSizeProbe — first-render and resize guards (TASK-130) > mounts the throwaway terminal inside a bordered wrapper ...` and `> positions the probe node to the right of the sidebar using the shared SIDEBAR_WIDTH_PX (TASK-0173)`). `AgentSidebar` itself rendering at `SIDEBAR_WIDTH_PX` is asserted by the uat-auto-added test cited in UAT-UI-001 (`AgentList.test.tsx`, "inline width of the shared SIDEBAR_WIDTH_PX"); pixel placement stays live-only there.
- **Unit Test Command**: `cd frontend && npx vitest run src/lib/terminalSizeProbe.test.ts` — verified: 5 passed
- [x] Pass <!-- 2026-09-18 -->

---

### UAT-UI-001: The pane sits at the sidebar edge, fills the remaining width to the viewport bottom, and the sidebar is 320px wide
- **Page**: `http://localhost:4321/` (route `/` renders `AgentsPage` then `AgentList`)
- **Description**: Live layout check of what jsdom cannot see: sidebar width equals `SIDEBAR_WIDTH_PX` (320) via inline style; the selected pane starts at x=320, is `flex-1`, fills to the viewport bottom, and the page itself does not scroll.
- **Steps**:
  1. Open the page at 1440x900 and click an agent row.
  2. In devtools run: `(() => { const a = document.querySelector('aside[aria-label="Agents"]'); const p = document.querySelector('[role="region"]'); const ar = a.getBoundingClientRect(), pr = p.getBoundingClientRect(); return { sidebarW: ar.width, sidebarInline: a.style.width, paneLeft: pr.left, paneRight: pr.right, paneBottom: pr.bottom, vw: innerWidth, vh: innerHeight, pageScrolls: document.documentElement.scrollHeight > innerHeight } })()`.
  3. Deselect (Close) and re-run with `p = document.querySelector('aside[aria-label="Agents"] + div')` to measure the empty-state pane.
  4. Resize to 1000x700 and repeat step 2.
- **Expected Result**: `sidebarW` = 320 and `sidebarInline` = `"320px"`; `paneLeft` = 320 (within 1px); `paneRight` = `vw` (minus any scrollbar); `paneBottom` = `vh`; `pageScrolls` = false at both sizes; the empty-state pane (step 3) starts at x=320 too and scrolls internally when the background-process list is long. No content is clipped at the right or bottom edge.
- **Repeatable Unit Test**: Not applicable: pixel geometry needs a real layout engine; jsdom has no layout. Fragment covered only: the sidebar's inline `style.width === "320px"` is asserted by `AgentList sidebar + pane selection gaps (TASK-0173 UAT) > renders the sidebar with an inline width of the shared SIDEBAR_WIDTH_PX (320px)` (`cd frontend && npx vitest run src/components/AgentList.test.tsx -t "inline width of the shared SIDEBAR_WIDTH_PX"` — verified: 1 passed); pane position, fill, and page-scroll claims remain live-only.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-09-18 -->

---

### UAT-UI-002: The selected row is visibly highlighted
- **Page**: `http://localhost:4321/`
- **Description**: `AgentItem` adds `bg-canvas ring-2 ring-accent-blue/50` (vs `bg-card`) when selected, in addition to `aria-current`. Also confirms the 4px status-colored right border from TASK-0171 is preserved on the selected row.
- **Steps**:
  1. Click agent row A, then row B.
  2. Screenshot the sidebar in light theme, then toggle dark theme via the nav bar and screenshot again.
  3. Run: `getComputedStyle(document.querySelector('aside [aria-current="true"]'))` and read `boxShadow`, `borderRightWidth`, `borderRightColor`.
- **Expected Result**: Exactly one row (B) shows a blue ring and a slightly different background than its siblings, legible in both themes; A returns to the plain card look. `borderRightWidth` = `4px` and `borderRightColor` still matches the agent's status color.
- **Repeatable Unit Test**: Not applicable: visual styling. `aria-current` is asserted by UAT-EDGE-004. Fragment covered only: the selected row's class list (`bg-canvas ring-2 ring-accent-blue/50`, no `bg-card`), the previous row reverting, and the preserved 4px status right border are asserted by `AgentList sidebar + pane selection gaps (TASK-0173 UAT) > gives only the selected row the ring/canvas highlight (no bg-card) and keeps its 4px status right border` (`cd frontend && npx vitest run src/components/AgentList.test.tsx -t "gives only the selected row the ring/canvas highlight"` — verified: 1 passed); rendered legibility in both themes and computed `boxShadow` remain live-only.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-09-18 -->

---

### UAT-UI-003: The terminal renders in the pane and Direct Input works (deferred live check from TASK-0173)
- **Page**: `http://localhost:4321/`
- **Description**: The live terminal (xterm) renders inside the pane at the new width, refits to it, and Direct Input accepts keys.
- **Steps**:
  1. Pick an idle scratch agent with a live window (not one mid-task). Click its sidebar row.
  2. Confirm the Terminal tab is active and shows the agent's pane text.
  3. Direct Input should arm on its own (banner "Direct Input — keys go to <name>"); if not, click `Direct Input`.
  4. Type the single character `x`, confirm it echoes at the agent's prompt in the terminal, press Backspace to remove it, then click `Stop Direct Input`.
  5. Switch to another agent's row and back.
- **Expected Result**: The terminal fills the pane's width inside a bordered box with no horizontal scrollbar or clipped right edge; the amber Direct Input banner appears and disappears with the toggle; `x` echoes and is removed; no keystrokes reach any agent other than the selected one; after switching back the terminal renders again (the view remounts, the terminal reconnects) with its content intact.
- **Repeatable Unit Test**: Not applicable: needs real xterm, a live tmux pane and a WebSocket; jsdom lacks `matchMedia`, so `terminalSizeProbe.test.ts` mocks xterm entirely.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-09-18 -->

---

### UAT-UI-004: A selected agent whose window disappears keeps rendering in the pane (inactive agents are not deselected)
- **Page**: `http://localhost:4321/`
- **Description**: Task says agents turning `exited`/`no-window` while selected keep rendering (the pane looks up the selected id in the full `agents` list, not the active-only list), while the sidebar drops the row.
- **Steps**:
  1. Register or pick a disposable scratch agent with a live window. Select it in the sidebar.
  2. Get its window name from `curl -sS 'http://localhost:8788/api/status' | jq '.agents[] | select(.name=="<scratch>") | .status.evidence.windowName'`.
  3. Kill its window: `tmux kill-window -t conductor:<windowName>` (the tmux session name is the `session` field of the status payload, `conductor` by default).
  4. Wait up to ~5s for the status to flip to `no-window`/`exited`.
- **Expected Result**: The sidebar row for the scratch agent disappears (it is now in the "Inactive Agents" panel above), but the pane region `<scratch> detail` stays mounted, showing the agent's details with the status badge updated and `Stop agent` omitted (no live window); the selection is not cleared, and the pane does not fall back to the empty state.
- **Repeatable Unit Test**: Partly covered: `AgentList sidebar + pane selection gaps (TASK-0173 UAT) > keeps the same pane mounted, minus Stop agent, when the selected agent turns no-window|exited, while the sidebar drops its row` (`cd frontend && npx vitest run src/components/AgentList.test.tsx -t "keeps the same pane mounted"` — verified: 2 passed) asserts the row leaves the sidebar, the same pane node stays mounted, `Stop agent` is omitted, and the status label shows. Not asserted: the row appearing in the "Inactive Agents" panel (a separate component outside `AgentList`) and the real tmux window kill.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-09-18 -->

---

### UAT-UI-005: Terminal size probe is not over-sized for the pane, and a window resize refits and re-syncs (deferred live check from TASK-0173)
- **Page**: `http://localhost:4321/`
- **Description**: The probe posts cols/rows to `POST /api/terminal-size`, which sets tmux `default-size` globally. With the terminal now in the pane (viewport minus 320px sidebar minus padding), the posted width must match the visible terminal, not the wider overlay geometry (an over-measure would be roughly 320px / cell-width, about 40 extra columns).
- **Steps**:
  1. Open the page fresh at 1440x900 with devtools Network open (filter `terminal-size`), then click an agent row so the terminal mounts (the probe runs once on the first terminal render).
  2. Read the POSTed `{cols, rows}` from the request body, then `tmux show-options -g default-size` and `tmux display -p -t conductor:<windowName> '#{window_width}x#{window_height}'`.
  3. Measure the visible terminal: `(() => { const s = document.querySelector('[role="region"] .xterm-screen'); const m = document.querySelector('[role="region"] .xterm-char-measure-element'); const cw = m.getBoundingClientRect().width / m.textContent.length; return { screenW: s.getBoundingClientRect().width, cellW: cw, visibleCols: Math.round(s.getBoundingClientRect().width / cw) } })()`.
  4. Resize the browser window to 1000x700, wait 1s (400ms debounce), and repeat steps 2-3; also observe that the terminal refits without a page reload.
- **Expected Result**: The `POST /api/terminal-size` responds 200; `default-size` and the tmux window size equal the POSTed `COLSxROWS`; `visibleCols` equals the POSTed `cols` within +/-1 (probe and live terminal both use `fitWithRightEdgeMargin`) and is never smaller than the POSTed cols by 2 or more. After the resize a new POST is sent with smaller cols, the visible terminal refits to the narrower pane with no horizontal clipping, and tmux `default-size` updates to the new values.
- **Repeatable Unit Test**: Not applicable: needs real font metrics (jsdom has none; xterm is mocked) and `tmux`. The guards and the probe node geometry are unit-covered by UAT-EDGE-010; comparing measured cols to the real visible terminal is live-only. `xterm-char-measure-element` is xterm's internal DOM; if absent in this xterm version, derive the cell width from one rendered `.xterm-rows > div` row's width divided by its character count.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-09-18 -->
