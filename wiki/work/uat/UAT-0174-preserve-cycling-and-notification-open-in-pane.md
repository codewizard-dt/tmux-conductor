---
id: UAT-0174
aliases: [UAT-0174]
title: "UAT: Preserve Cmd+Shift+Arrow cycling and notification-driven open/arm-interact against the pane selection"
status: pending
task: TASK-0174
created: 2026-09-18
updated: 2026-09-18
---

# UAT-0174 — UAT: Preserve Cmd+Shift+Arrow cycling and notification-driven open/arm-interact against the pane selection

implements::[[TASK-0174]]

> **Source task**: [[TASK-0174]]
> **Generated**: 2026-09-18

---

## Prerequisites

- [ ] Dev servers running: `make dev` (host-server on port 8788, frontend on port 4321). Live cases use `http://localhost:4321/` (NOT `:4173`, a stale preview build).
- [ ] At least two projects, each with at least one active agent (live tmux window, `state` not `no-window`/`exited`), so the sidebar shows several project groups. Check with `curl -sS 'http://localhost:8788/api/status' | jq -c '.agents[] | {name, projectName, state, windowPresent}'`.
- [ ] A disposable scratch agent (idle, live window, safe to send an arbitrary prompt to) for UAT-UI-002, UAT-UI-003 and UAT-UI-006. UAT-UI-006 kills its window. Never use a real agent that is mid-task.
- [ ] Live cases at a viewport at least 1024px wide unless a step says otherwise. The shortcut is Shift+Cmd on macOS and Shift+Ctrl elsewhere; steps below say "the shortcut" and assume macOS.
- [ ] No text field focused while pressing the shortcut (click a sidebar row first, not the filter input).

Source under test:
- `frontend/src/components/AgentList.tsx`:
  - `AgentList`: `activeAgents` (line ~1849), `orderedAgentIds` (line ~1857, `[...activeAgents].sort(byProjectThenStatus).map((a) => a.id)`, unfiltered), `handleNavigate` (line ~1861, `idx === -1` returns `prev`), `expandedAgentRef` (line ~1891) and the fire-time suppression `if (expandedAgentRef.current?.id === agentId) return` (line ~1980), `NotificationStack onOpen` -> `setExpandedAgent({ id, armInteract: true })` (line ~2203), sidebar `onExpand={(id, armInteract) => ...}` (line ~2150), pane render `key={expandedModalAgent.id}` with `armInteract={expandedAgent.armInteract}` and `agentCount={activeAgents.length}` (lines ~2158-2173).
  - `AgentDetailView`: document `keydown` effect (lines ~676-689: ignores `TEXTAREA`/`INPUT` targets, requires `isMac ? metaKey : ctrlKey` plus `shiftKey`, ArrowRight -> `onNavigate('next')`, ArrowLeft -> `onNavigate('prev')`, no Escape branch); `interactSignal = armInteract ? 1 : 0` (line ~633) and the mount effect that forces the Terminal tab when `armInteract` (lines ~653-660); the header prev/next buttons (`aria-label` `Previous agent` / `Next agent`, wrapper `hidden select-none items-center gap-1.5 sm:flex`, gated on `agentCount > 1`, lines ~1099-1117).
  - `AgentItem` row CTA `Direct Input — needs you` (`aria-label` `Direct Input to <name> — it needs your input`, calls `onExpand(true)`, line ~1280).
- `frontend/src/components/LogTail.tsx` `mapKey` (line ~45-62): returns `null` for Shift+Cmd/Ctrl+Arrow so the terminal does not intercept the cycling shortcut.
- Sidebar row and pane share the accessible name `<name> detail` (row is `role=button`, pane is `role=region`), so live queries must include the role.

Coverage note: all unit-backed cases run in `frontend/src/components/AgentList.test.tsx` or `frontend/src/components/LogTail.test.tsx` (jsdom; no layout, `LogTail` mocked as `mock-log-tail` with `data-interact-signal`, no real xterm or tmux). No test asserts: the `idx === -1` no-op branch of `handleNavigate` (a selected inactive agent), the sidebar highlight following a live multi-project cycle, real xterm/Direct Input behavior when the shortcut is pressed inside the terminal, the header buttons' layout at ~1024px, or a toast produced by a real agent going `awaiting`. Those are live-only below and each states the missing assertion.

---

## Test Cases

### UAT-EDGE-001: Shift+Cmd+Right/Left cycle in sidebar order (project, then status urgency, then name), wrapping at both ends
- **Scenario**: `orderedAgentIds` sorts `activeAgents` with `byProjectThenStatus`, so cycling follows the sidebar's flat order rather than a global name sort. Fixture: Project A has `charlie` (busy), `alpha` (idle), `delta` (idle); Project B has `bravo` (idle). A global name sort would be alpha, bravo, charlie, delta.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: Unit test passes: starting from `charlie`, Shift+Cmd+Right visits `alpha`, `delta`, `bravo`, then wraps to `charlie`; Shift+Cmd+Left from `charlie` wraps to `bravo`, then goes to `delta`.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`AgentList cycling order and arm-interact against the pane selection (TASK-0174) > Shift+Cmd+Right walks the sidebar order (status urgency within a project, then the next project) and wraps at the end; Left wraps backwards`; written by the TASK-0174 tackle, no new test written by this generation run)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "Shift\+Cmd\+Right walks the sidebar order"` — verified: 1 passed
- [x] Pass <!-- 2026-09-18 -->

---

### UAT-EDGE-002: The header Previous/Next agent buttons follow the same sidebar order
- **Scenario**: The buttons call the same `onNavigate` (`handleNavigate`) as the keyboard shortcut, gated on `agentCount > 1` where `agentCount = activeAgents.length`. Starting at `delta` (last of Project A), Next goes to `bravo` (Project B), not to whatever a name sort would give.
- **Steps**:
  1. Run the unit test command below (matches the new sidebar-order test and the legacy hint-buttons test, which uses agents with no project).
- **Expected Result**: Unit tests pass (2): from `delta`, clicking `Next agent` selects `bravo` and clicking `Previous agent` returns to `delta`; the legacy test still walks beta -> gamma -> beta with the same buttons.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`AgentList cycling order and arm-interact against the pane selection (TASK-0174) > the prev/next buttons follow the same sidebar order` and `AgentList keyboard navigation ignores the grid filter > clicking the Ctrl+Alt prev/next hint buttons calls onNavigate with the correct direction`), plus `AgentList cycling order and arm-interact against the pane selection (TASK-0174) > renders the prev/next header buttons only while more than one agent is active (agentCount > 1)` (added by the TASK-0174 uat-auto run: buttons absent with one active agent, appear when a second agent turns active via SSE, disappear when it goes away, in an `AgentList` render).
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "prev/next buttons follow the same sidebar order|Ctrl\+Alt prev/next hint buttons|renders the prev/next header buttons only while"` — verified: 3 passed
- [x] Pass <!-- 2026-09-18 -->

---

### UAT-EDGE-003: Cycling ignores the sidebar text filter, and still walks sidebar order
- **Scenario**: `orderedAgentIds` derives from unfiltered `activeAgents`, not `filteredAgents`. With `delta`'s pane open and the filter set to `Project B`, `delta`'s row is gone from the sidebar but its pane stays; the shortcut goes to `bravo`, then wraps to `charlie`, which the filter hides from the sidebar.
- **Steps**:
  1. Run the unit test command below (matches the new filtered-cycling test and the legacy `next-agent navigation still reaches an agent hidden by the current filter` test, whose expected neighbor is re-derived for the new order).
- **Expected Result**: Unit tests pass (2): the pane for `charlie` renders while `within(sidebar).queryByRole('button', { name: 'charlie detail' })` is null; in the legacy test, with `node-beta` open and filter `backend`, a bare Cmd+ArrowRight and Ctrl+Alt+ArrowRight do nothing and Shift+Cmd+ArrowRight reaches `node-gamma`.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`AgentList cycling order and arm-interact against the pane selection (TASK-0174) > cycling still reaches an agent hidden by the sidebar filter, in sidebar order` and `AgentList keyboard navigation ignores the grid filter > next-agent navigation still reaches an agent hidden by the current filter (orderedAgentIds stays unfiltered)`)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "cycling still reaches an agent hidden by the sidebar filter|next-agent navigation still reaches an agent hidden"` — verified: 2 passed
- [x] Pass <!-- 2026-09-18 -->

---

### UAT-EDGE-004: The shortcut is OS-aware (Shift+Ctrl off-Mac, Shift+Cmd on Mac)
- **Scenario**: `AgentDetailView` computes `modifierPressed = isMac ? e.metaKey : e.ctrlKey` from `navigator.userAgent`. On a Linux user agent, Shift+Cmd must do nothing and Shift+Ctrl must cycle.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: Unit test passes: with a Linux user agent and `charlie` open, Shift+Cmd+ArrowRight leaves `charlie` selected and Shift+Ctrl+ArrowRight selects `alpha` (the next sidebar-order neighbor). The Mac branch is asserted by UAT-EDGE-001 and UAT-EDGE-003, which pin a Mac user agent.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`AgentList cycling order and arm-interact against the pane selection (TASK-0174) > the shortcut is OS-aware: Shift+Ctrl cycles off-Mac and Shift+Cmd does not`)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "the shortcut is OS-aware"` — verified: 1 passed
- [x] Pass <!-- 2026-09-18 -->

---

### UAT-EDGE-005: The hotkey ignores events targeting an input/textarea and does not fire for bare-Cmd or Ctrl+Alt arrows
- **Scenario**: The keydown effect in `AgentDetailView` returns early when `e.target.tagName` is `TEXTAREA` or `INPUT` (Shift+Cmd+Arrow is a native text-selection gesture there), and requires modifier and Shift together (a bare Cmd+Arrow or the retired Ctrl+Alt+Arrow must not navigate).
- **Steps**:
  1. Run the unit test command below (matches the two `it.each` cases for `input` and `textarea`, plus the legacy filter test that asserts the bare-Cmd and Ctrl+Alt no-ops before the real navigation).
- **Expected Result**: Unit tests pass (3): `onNavigate` is not called for Shift+Cmd+Arrow dispatched from a focused `<input>` or `<textarea>`, is called with `'next'`/`'prev'` from a non-text `div`, and the legacy test's bare Cmd+ArrowRight and Ctrl+Alt+ArrowRight leave `node-beta` selected.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`AgentDetailView agent-cycling shortcut text-field guard (TASK-0172) > ignores Shift+Cmd+Arrow fired from a focused <input|textarea>, and still navigates from a non-text target` and `AgentList keyboard navigation ignores the grid filter > next-agent navigation still reaches an agent hidden by the current filter`)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "ignores Shift\+Cmd\+Arrow fired from a focused|next-agent navigation still reaches an agent hidden"` — verified: 3 passed
- [x] Pass <!-- 2026-09-18 -->

---

### UAT-EDGE-006: The terminal's key mapper does not swallow Shift+Cmd/Ctrl+Arrow
- **Scenario**: `LogTail.mapKey` handles bare Ctrl/Cmd/Alt+Arrow but must return `null` for Shift+Cmd+Arrow and Shift+Ctrl+Arrow so the event bubbles to the document listener in `AgentDetailView` (task Approach item 2; TASK-141/TASK-149 history).
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: Unit test passes: `mapKey` returns `null` for ArrowLeft and ArrowRight with `metaKey + shiftKey` and with `ctrlKey + shiftKey`. (Real-xterm behavior with Direct Input armed is UAT-UI-004.)
- **Repeatable Unit Test**: Created: `frontend/src/components/LogTail.test.tsx` (`regression: the AgentList agent-switch combo (Shift+Cmd/Ctrl+Arrow) is left untouched by the new arrow branches`)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/LogTail.test.tsx -t "AgentList agent-switch combo"` — verified: 1 passed
- [x] Pass <!-- 2026-09-18 -->

---

### UAT-EDGE-007: A plain row click leaves Direct Input unarmed; the row CTA arms it and forces the Terminal tab
- **Scenario**: Sidebar `onExpand(id, armInteract)` sets `{ id, armInteract }`. A row click passes `false` (LogTail `interactSignal` 0); the `Direct Input — needs you` CTA on an awaiting row calls `onExpand(true)`, which replaces the pane with the target agent, forces the Terminal tab (even though the previous pane had Skills open) and sets `interactSignal` 1.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: Unit test passes: `cta-busy`'s pane shows `data-interact-signal="0"`; after clicking `Direct Input to cta-waiting — it needs your input`, the `cta-busy detail` region is gone, `cta-waiting`'s Terminal tab has `aria-selected="true"` and its LogTail has `data-interact-signal="1"`.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`AgentList cycling order and arm-interact against the pane selection (TASK-0174) > a plain row click leaves Direct Input unarmed (interactSignal 0); the row CTA arms it (1) and forces the Terminal tab`). Live variant is UAT-UI-003.
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "a plain row click leaves Direct Input unarmed"` — verified: 1 passed
- [x] Pass <!-- 2026-09-18 -->

---

### UAT-EDGE-008: A toast click selects that agent, shows the Terminal tab and arms Direct Input, even while a different agent is selected
- **Scenario**: `NotificationStack.onOpen` -> `setExpandedAgent({ id, armInteract: true })`. With agent A selected and unarmed, a toast for B (raised by an `agent-update` to `awaiting` plus `NOTIFICATION_GRACE_MS`) is clicked: the keyed view remounts into B with `armInteract` true, the toast is removed. Also covers the pre-existing click-on-body and Enter-key paths.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: Unit tests pass (3): after the toast click B's pane region exists, its Terminal tab has `aria-selected="true"` and its LogTail has `data-interact-signal="1"` (A's was `0` beforehand); the body-click and Enter tests also remove the toast and open the pane.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`AgentList cycling order and arm-interact against the pane selection (TASK-0174) > a toast click selects the agent, shows the Terminal tab and arms Direct Input (interactSignal 1), even while a different agent is selected`; and `NotificationStack grace-period toasts (TASK-146 Step 3) > clicking a toast's body opens the agent detail modal (armed for Direct Input) and removes the toast` and `> pressing Enter on a toast opens the modal (armed for Direct Input) and removes the toast, matching click behavior`). Live variant is UAT-UI-002.
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "a toast click selects the agent, shows the Terminal tab|clicking a toast's body opens|pressing Enter on a toast"` — verified: 3 passed
- [x] Pass <!-- 2026-09-18 -->

---

### UAT-EDGE-009: A toast is suppressed at fire time for the currently selected agent, but not for an agent selected only after its transition
- **Scenario**: The grace-timer callback re-reads `expandedAgentRef.current?.id` when it fires (not when scheduled), so an agent that is on screen in the pane never gets a toast, while a different agent entering `awaiting` still does.
- **Steps**:
  1. Run the unit test command below (matches the new test and the legacy `creates no toast for an agent whose detail modal is already open` test).
- **Expected Result**: Unit tests pass (2): with `sup-a` selected and entering `awaiting`, no `sup-a` toast appears after `NOTIFICATION_GRACE_MS`, while a `sup-b` toast does appear when `sup-b` enters `awaiting`.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`AgentList cycling order and arm-interact against the pane selection (TASK-0174) > a toast is suppressed at fire time for the currently selected agent, but not for one that was selected only after the transition` and `NotificationStack grace-period toasts (TASK-146 Step 3) > creates no toast for an agent whose detail modal is already open when its status enters awaiting`). The "selected only after the transition" half (a toast already scheduled for B, then B selected during the grace period, must not surface, with a still-unselected agent C as positive control) is asserted by `AgentList cycling order and arm-interact against the pane selection (TASK-0174) > suppresses a toast already scheduled for an agent that is selected during the grace period (checked at fire time, not schedule time)`, added by the TASK-0174 uat-auto run (the older test's body only checks A-suppressed and B-not-suppressed).
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "a toast is suppressed at fire time|creates no toast for an agent whose detail modal|suppresses a toast already scheduled"` — verified: 3 passed
- [x] Pass <!-- 2026-09-18 -->

---

### UAT-EDGE-010: Cycling has exactly one hotkey listener (in the view), and the stale "modal" comments from Approach item 6 are reworded
- **Scenario**: Task Approach item 2 says not to register a second listener in `AgentList`; item 6 says the comments `Modal state lives here...`, the `expandedAgentRef` mirror comment and the suppression comment must say "selected agent"/"detail pane". Static check on `frontend/src/components/AgentList.tsx`.
- **Steps**:
  1. Search `frontend/src/components/AgentList.tsx` for `document.addEventListener('keydown'`.
  2. Search the same file for `Modal state lives here`.
  3. Read the comment above `const expandedAgentRef = useRef(expandedAgent)` (line ~1885-1891) and the comment above `if (expandedAgentRef.current?.id === agentId) return` (line ~1977).
- **Expected Result**: Step 1 has exactly two matches: the `AgentDetailView` cycling effect (line ~686) and the `AgentDetailModal` Escape handler (line ~1192); no listener inside `AgentList`. Step 2 has no match. Step 3: neither comment uses the word "modal"; the suppression comment reads "Suppress if the user is already looking at this agent's detail pane". (Remaining "modal" mentions at lines ~426, ~1213-1214 refer to `AgentDetailModal`/the card tile, are outside the three listed comments, and do not fail this case.)
- **Repeatable Unit Test**: Not applicable: source-comment and listener-count assertions are static text checks; a unit test would only re-grep the file. Behavior of the single listener is covered by UAT-EDGE-004 and UAT-EDGE-005.
- [FAIL: auto-judge: manual test requires human verification (static source-text check with no test file or command)] <!-- 2026-09-18 -->

---

### UAT-UI-001: Live cycle across a multi-project sidebar, highlighted row follows the shortcut (deferred live check from TASK-0174)
- **Page**: `http://localhost:4321/`
- **Description**: In the real sidebar, Shift+Cmd+Arrow moves the selection through rows exactly in on-screen top-to-bottom order across project groups, the `aria-current` row/highlight follows, the pane switches to each agent, and both ends wrap. Not asserted by any unit test: real multi-project data, the highlighted-row ring, and top-to-bottom visual order (jsdom asserts pane regions, not row positions).
- **Steps**:
  1. Open the page, with the filter empty. In devtools record the sidebar order: `[...document.querySelectorAll('aside[aria-label="Agents"] [role="button"][aria-label$=" detail"]')].map(e => e.getAttribute('aria-label'))`. Confirm it spans at least two project headers.
  2. Click the first row. Run `document.querySelector('aside [aria-current="true"]')?.getAttribute('aria-label')`; it should equal the first entry.
  3. Press Shift+Cmd+ArrowRight once per remaining row, running the step-2 expression after each press and noting the pane heading.
  4. Press it once more from the last row.
  5. From the first row press Shift+Cmd+ArrowLeft.
- **Expected Result**: After each Right press the `aria-current` row and the `<name> detail` pane are the next entry of the step-1 list (crossing project group boundaries in visual order, not alphabetical order across projects); the ring highlight is visible on that row only; from the last row Right wraps to the first; from the first row Left wraps to the last. If an agent's status changes mid-run, the sidebar reshuffles and the next hop follows the new visual order (accepted behavior). Pressing Shift+Cmd+Right while the Filter agents input has focus does nothing.
- **Repeatable Unit Test**: Not applicable: needs real multi-project runtime data and rendered row order. Sidebar-order hops, wrapping, and the text-field guard are unit-covered by UAT-EDGE-001 and UAT-EDGE-005; the highlight-follows-selection claim in the live sidebar is live-only (only `aria-current` following a click is unit-tested, per UAT-0173 UAT-EDGE-004).
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-09-18 -->

---

### UAT-UI-002: Clicking a real awaiting-agent toast opens that agent with Direct Input armed, and no toast fires for the selected agent (deferred live check from TASK-0174)
- **Page**: `http://localhost:4321/`
- **Description**: A real agent transition to `awaiting` produces a toast after the 3s grace period; clicking it, while a different agent is selected on a non-Terminal tab, remounts the pane into the scratch agent with the Terminal tab active and Direct Input armed. Not asserted by any unit test: a real agent reaching `awaiting`, the real audio/visual toast, and real Direct Input focus.
- **Steps**:
  1. Pick the disposable scratch agent (note its id from the status payload) and a different agent B. Click B's row and switch its pane to the `Skills` tab.
  2. Make the scratch agent ask a blocking question: `curl -sS -X POST 'http://localhost:8788/api/agents/<scratch-id>/keys' -H 'Content-Type: application/json' -d '{"text":"Use the AskUserQuestion tool to ask me to pick red or blue, then wait for my answer.","enter":true}'` (replace `<scratch-id>`).
  3. Wait until the scratch row shows `waiting` (a few seconds), then a further ~3s (`NOTIFICATION_GRACE_MS`). A toast for the scratch agent appears; B's pane is still showing the Skills tab.
  4. Click the toast body.
  5. Next: press Esc in the terminal pane to dismiss the question if needed, click B's row, wait for the scratch agent to be idle, then click the scratch row so it is the selected pane. Repeat step 2 and wait ~8s.
- **Expected Result**: Step 4: the pane switches to `<scratch> detail`, the `Terminal` tab is active (not Skills), the amber banner `Direct Input — keys go to <scratch>` shows (Direct Input armed and focused), and the toast is gone. Step 5: with the scratch agent already selected, no toast for it ever appears while it turns `waiting`.
- **Repeatable Unit Test**: Not applicable: needs a real agent, real SSE and real terminal focus. Toast -> arm -> Terminal tab, and selected-agent suppression, are unit-covered by UAT-EDGE-008 and UAT-EDGE-009 (which, for the suppression case, do not assert the scheduled-then-selected-during-grace interleaving).
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-09-18 -->

---

### UAT-UI-003: The sidebar row "Direct Input — needs you" CTA selects the agent with Direct Input armed (live)
- **Page**: `http://localhost:4321/`
- **Description**: The row CTA (`onExpand(true)`) does the same as the toast click: replaces the current pane with the target agent, Terminal tab active, Direct Input armed. Live variant of UAT-EDGE-007.
- **Steps**:
  1. Select agent B (any other agent) and switch its pane to the `Skills` tab.
  2. Make the scratch agent go `waiting` as in UAT-UI-002 step 2 (its row shows a `Direct Input — needs you` button).
  3. Click that CTA button on the scratch row.
- **Expected Result**: The pane becomes `<scratch> detail` with the Terminal tab active and the amber `Direct Input — keys go to <scratch>` banner showing; B's pane and its Skills tab are gone. A plain click on any ordinary row (no CTA) opens its pane with Direct Input not armed (no amber banner).
- **Repeatable Unit Test**: Not applicable: needs a real awaiting agent and real terminal focus; the CTA -> `interactSignal` 1 + Terminal-tab path is unit-covered by UAT-EDGE-007.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-09-18 -->

---

### UAT-UI-004: Shift+Cmd+Arrow pressed inside the armed terminal switches agents and is not typed into the pane (live)
- **Page**: `http://localhost:4321/`
- **Description**: With Direct Input armed and the terminal focused, the reserved switching combo must reach the document handler (not be swallowed or forwarded by `LogTail`), while bare Cmd+Arrow still works as terminal Home/End. Not asserted by any unit test: `mapKey` returning `null` is unit-covered (UAT-EDGE-006) but the real focused xterm/Direct Input capture element is not.
- **Steps**:
  1. Select the scratch agent (idle) and click `Direct Input` (banner `Direct Input — keys go to <scratch>`); click inside the terminal so it holds focus.
  2. Type `abc` (no Enter) so the agent's prompt shows text, then press bare Cmd+ArrowLeft, then Cmd+ArrowRight.
  3. Press Shift+Cmd+ArrowRight.
  4. Click back on the scratch row, select the scratch pane again, and inspect its prompt line; press Backspace after re-arming Direct Input to clear `abc`.
- **Expected Result**: Step 2: the cursor moves to line start then end (terminal handles bare Cmd+Arrow). Step 3: the selection moves to the next sidebar-order agent, its pane mounts unarmed (no amber banner). Step 4: the scratch agent's prompt contains only `abc`, with no stray escape characters such as `;2C`, `[1;` or similar from the switching combo, and no keystrokes reached the newly selected agent.
- **Repeatable Unit Test**: Not applicable: needs a real xterm/Direct Input capture element and a live pane; jsdom mocks `LogTail`. `mapKey` behavior is unit-covered by UAT-EDGE-006.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-09-18 -->

---

### UAT-UI-005: Prev/next header buttons render in the pane header at ~1024px and nothing wraps badly
- **Page**: `http://localhost:4321/`
- **Description**: The buttons sit in a `hidden select-none items-center gap-1.5 sm:flex` wrapper in the `AgentDetailView` header, now in a pane narrower than the old modal (about viewport width minus the 320px sidebar). Task Approach item 4 asks to confirm nothing wraps badly at ~1024px. Not asserted by any unit test: jsdom has no layout or media queries.
- **Steps**:
  1. Open the page at 1024x768 with at least two active agents and select one.
  2. Screenshot the pane header. Run: `(() => { const r = document.querySelector('[role="region"]'); const n = r.querySelector('button[aria-label="Next agent"]'); const p = r.querySelector('button[aria-label="Previous agent"]'); const c = r.querySelector('button[aria-label="Close"]'); const rr = r.getBoundingClientRect(); const b = [p, n, c].map(e => e.getBoundingClientRect()); return { scrollX: r.scrollWidth > r.clientWidth, closeInside: b[2].right <= rr.right, btnHeights: b.map(x => Math.round(x.height)), sameRow: Math.abs(b[0].top - b[1].top) < 2 } })()`.
  3. Repeat at 800x768, then at 600x768 (below the `sm` breakpoint).
- **Expected Result**: At 1024 and 800: `Previous agent` and `Next agent` are visible (the `⇧⌘ ‹` / `⇧⌘ ›` labels on one line each, no wrapped label text), `sameRow` true, `scrollX` false, `closeInside` true; the header wraps as whole groups at worst (actions onto a second row), never mid-button, and no element is clipped at the pane edge. At 600 the buttons are hidden (`sm:flex`) and the shortcut still works. With only one active agent the buttons are absent at all widths.
- **Repeatable Unit Test**: Not applicable: layout and breakpoint behavior need a real layout engine. Button presence/click behavior is unit-covered by UAT-EDGE-002.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-09-18 -->

---

### UAT-UI-006: A selected agent outside the active cycle makes the shortcut and buttons a no-op (`idx === -1`)
- **Page**: `http://localhost:4321/`
- **Description**: `handleNavigate` returns `prev` when the selected id is not in `orderedAgentIds` (a selected agent that turned `no-window`/`exited` keeps its pane but leaves the active list). The shortcut must do nothing rather than jump somewhere unrelated. This behavior is stated in the task (Approach item 3) but **no test asserts it**: `AgentList.test.tsx` has no case that selects an inactive agent and then fires Shift+Cmd+Arrow or clicks `Next agent`. The missing assertion is: after `agent-update` flips the selected agent to `no-window`/`exited`, pressing the shortcut (and clicking `Next agent`/`Previous agent`) leaves that agent's `<name> detail` region mounted and selects no other agent.
- **Steps**:
  1. With at least two other active agents present, select the disposable scratch agent (idle, live window). Get its window name: `curl -sS 'http://localhost:8788/api/status' | jq '.agents[] | select(.name=="<scratch>") | .status.evidence.windowName'`.
  2. Kill its window: `tmux kill-window -t conductor:<windowName>` (session name is the `session` field of the status payload, `conductor` by default). Wait up to ~5s for its sidebar row to disappear.
  3. Press Shift+Cmd+ArrowRight, then Shift+Cmd+ArrowLeft. Then click `Next agent` and `Previous agent` in the pane header.
- **Expected Result**: The scratch pane `<scratch> detail` stays mounted after every press/click (status badge no-window/exited, `Stop agent` omitted); the pane never switches to another agent, and no sidebar row has `aria-current`. The buttons still render because `agentCount` counts the other active agents.
- **Repeatable Unit Test**: Blocked: promotable in principle (fixture with a selected `no-window` agent plus a Shift+Cmd+Right keydown asserting the same region stays mounted, in the local pattern of `AgentList sidebar + pane selection gaps (TASK-0173 UAT) > keeps the same pane mounted, minus Stop agent, when the selected agent turns no-window|exited`), but this generation run was told to write no code files. Recommend adding it there. Update (TASK-0174 uat-auto run): the unit assertion now exists as `AgentList cycling order and arm-interact against the pane selection (TASK-0174) > is a no-op for Shift+Cmd+Arrow and the prev/next buttons when the selected agent turns no-window|exited (idx === -1): the pane stays mounted and no other agent is selected` (2 passed) in `frontend/src/components/AgentList.test.tsx`. The live case still needs a human: it kills a real tmux window.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-09-18 -->
