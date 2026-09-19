---
id: UAT-0178
aliases: [UAT-0178]
title: "UAT: Repoint InactiveAgentsPanel's open-detail action at the detail pane and retire the modal wrapper"
status: pending
task: TASK-0178
created: 2026-09-18
updated: 2026-09-18
---

# UAT-0178 — UAT: Repoint InactiveAgentsPanel's open-detail action at the detail pane and retire the modal wrapper

implements::[[TASK-0178]]

> **Source task**: [[TASK-0178]]
> **Generated**: 2026-09-18

---

## Prerequisites

- [ ] Dev servers running: `make dev` (host-server on port 8788, frontend on port 4321). Live cases use `http://localhost:4321/` (NOT `:4173`, a stale preview build). The route `/` renders `AgentsPage` then `AgentList` then the `<aside aria-label="Agents">` sidebar and the main detail pane.
- [ ] At least two registered agents in `no-window` / `exited` state (so inactive cycling has somewhere to go) and at least two active agents. `GET http://localhost:4321/api/status` (through the Vite `/api` proxy) lists each agent's `state` and `windowPresent`.
- [ ] Unit cases run from `frontend/` with `npx vitest run <file> -t "<name>"`. Note: `-t` takes a regex, so a literal `+` in a test title is written as `.` in the filters below.

**Safety rule for every live case**: never click **Wake**, the trash/**Remove** control, **Create window**, **Stop agent**, **Destroy agent** or **Clone** on a real agent, and never type into the Terminal tab. Wake and Create window start a real tmux window; Remove and Destroy delete the agent from SQLite; Stop kills a window. Live cases only select rows, switch tabs, use the cycling shortcut and read the DOM. Anything that must exercise those actions is covered by the mocked-`fetch` unit tests.

Source under test:
- `frontend/src/components/InactiveAgentsPanel.tsx` — props `onOpenDetail: (agentId: number) => void` and `selectedId?: number | null`; each row `li` calls `onOpenDetail(a.id)` on click, carries `aria-current="true"` plus `ring-2 ring-accent-blue/50` when `selectedId === a.id`; the private `expandedId` / `navigateExpanded` state, the `stopPropagation` wrapper and the modal render are gone; Wake / Remove buttons still `stopPropagation`.
- `frontend/src/components/AgentList.tsx` — renders `<InactiveAgentsPanel onOpenDetail={(id) => { onExpand(id, false) }} selectedId={selectedAgentId} />`; exports `isInactiveStatus`; `orderedInactiveIds` and `handleNavigate` choose the active list when it contains the selected id (wrapping) else the inactive list (non-wrapping); the view's `agentCount` is the length of the list the selection cycles in; the pane resolves the selected id against the full `agents` state, so an inactive agent renders in it. The exported `AgentDetailModal` wrapper is deleted.
- Windowless view: `AgentDetailView` Details tab is labelled `Details •` when `windowPresent` is false and shows a `Create window` button; `LogTail` renders `Window not present.` when the tail reports `windowPresent: false`.

---

## Test Cases

### UAT-EDGE-001: Clicking an inactive row calls `onOpenDetail(id)`, opens no dialog, and leaves the panel expanded
- **Scenario**: In `InactiveAgentsPanel` alone, a row click must call the new `onOpenDetail` prop exactly once with that agent's id, must not open any `role="dialog"` (the private modal is gone), and must not collapse the section.
- **Steps**:
  1. Run the unit command below.
- **Expected Result**: 1 test passes: `onOpenDetail` called once with `1`; `queryByRole('dialog')` is null; the header toggle is still `aria-expanded="true"` and the row is still listed.
- **Repeatable Unit Test**: Created: `frontend/src/components/InactiveAgentsPanel.test.tsx` (`InactiveAgentsPanel open-detail action (TASK-0178) > clicking a row calls onOpenDetail with that agent id, opens no dialog, and leaves the panel expanded`; written during the TASK-0178 tackle, no new file written by this generation run).
- **Unit Test Command**: `cd frontend && npx vitest run src/components/InactiveAgentsPanel.test.tsx -t "clicking a row calls onOpenDetail"` — verified: 1 passed
- [x] Pass <!-- 2026-09-18 -->

---

### UAT-EDGE-002: Wake and Remove clicks do not trigger `onOpenDetail`
- **Scenario**: The row's Wake and trash buttons `stopPropagation`, so acting on a row must not also select it into the pane.
- **Steps**:
  1. Run the unit command below (`fetch` is mocked; no real agent is touched).
- **Expected Result**: 1 test passes: after clicking `Wake agent sleepy-agent` and `Remove agent dozing-agent`, `onOpenDetail` has not been called.
- **Repeatable Unit Test**: Created: `frontend/src/components/InactiveAgentsPanel.test.tsx` (`... > Wake and Remove clicks do not trigger onOpenDetail`; written during the TASK-0178 tackle). Coverage note: the test clicks Wake on one row and Remove on another so neither lands on a button disabled by the other's busy state; it does not assert that the section stays expanded after those clicks (that is covered for the header/row by UAT-EDGE-001).
- **Unit Test Command**: `cd frontend && npx vitest run src/components/InactiveAgentsPanel.test.tsx -t "Wake and Remove clicks do not trigger onOpenDetail"` — verified: 1 passed
- [x] Pass <!-- 2026-09-18 -->

---

### UAT-EDGE-003: The row matching `selectedId` (and only that row) is `aria-current="true"` in the panel
- **Scenario**: `selectedId` marks exactly one inactive row with `aria-current="true"`; the others carry no `aria-current` attribute.
- **Steps**:
  1. Run the unit command below.
- **Expected Result**: 3 tests pass: with `selectedId={2}` the `dozing-agent` row has `aria-current="true"` and the `sleepy-agent` row has no `aria-current`; the `dozing-agent` row has `ring-2 ring-accent-blue/50` and the other row has neither class; after a rerender with `selectedId` set to an id outside the inactive list (an active agent), the `dozing-agent` row has no `aria-current` and no ring classes.
- **Repeatable Unit Test**: Created: `frontend/src/components/InactiveAgentsPanel.test.tsx` (`... > marks only the row matching selectedId with aria-current`; written during the TASK-0178 tackle) and, added by the uat-auto run (tests only), `InactiveAgentsPanel selection highlight (TASK-0178 / UAT-0178 UAT-EDGE-003) > gives the selected inactive row the ring highlight and no other row` and `> clears aria-current and the ring from the inactive row when selection moves to an id outside the panel (an active agent)`. These close the earlier gap (ring classes, and the marker clearing when an active row is selected afterwards, asserted at the panel level via `selectedId` change; the `AgentList`-level wiring of that prop is covered by UAT-EDGE-004 and the live case UAT-UI-001).
- **Unit Test Command**: `cd frontend && npx vitest run src/components/InactiveAgentsPanel.test.tsx -t "marks only the row matching selectedId|gives the selected inactive row the ring highlight|clears aria-current and the ring"` — verified: 3 passed
- [x] Pass <!-- 2026-09-18 -->

---

### UAT-EDGE-004: Through `AgentList`, clicking an inactive row renders that agent in the main pane (no dialog), marks the row `aria-current`, and keeps the section expanded
- **Scenario**: Full wiring `InactiveAgentsPanel` -> `onOpenDetail` -> `AgentList` selection -> pane. A `role="region"` named `<name> detail` appears (not a `role="dialog"`), the clicked inactive row is `aria-current="true"` and a sibling inactive row is not, and the panel toggle stays `aria-expanded="true"`.
- **Steps**:
  1. Run the unit command below (matches the two tests in the `inactive selection via InactiveAgentsPanel (TASK-0178)` describe that cover selection, highlight and no-collapse).
- **Expected Result**: 2 tests pass. In the first, `sleep-a` (state `exited`, no window) renders `region` "sleep-a detail" with Terminal and `Details •` tabs, `queryByRole('dialog')` is null, `sleep-a`'s `li` has `aria-current="true"` and `sleep-b`'s does not. In the second, the `Inactive Agents` toggle is still `aria-expanded="true"` after the row click.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`AgentList > inactive selection via InactiveAgentsPanel (TASK-0178) > clicking an inactive row selects it into the main pane (no dialog), marks the row aria-current, and shows the windowless Details marker` and `> does not collapse the inactive section when a row is clicked`; written during the TASK-0178 tackle).
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "clicking an inactive row selects it into the main pane|does not collapse the inactive section"` — verified: 2 passed
- [x] Pass <!-- 2026-09-18 -->

---

### UAT-EDGE-005: A windowless (exited / no-window) agent's pane is usable: `Details •` marker, no Stop agent, Destroy agent still present
- **Scenario**: The pane must render for an agent with `windowPresent: false` without errors. The Details tab label carries the missing-window bullet, `Stop agent` (which needs a live window) is omitted, and `Destroy agent` remains.
- **Steps**:
  1. Run the unit command below (the Stop-omitted button test, plus the it.each that turns a selected agent `no-window`/`exited` and keeps the same pane mounted without Stop). The `Details •` label on a selected inactive agent is asserted by UAT-EDGE-004's first test.
- **Expected Result**: 3 tests pass: `omits the Stop agent button entirely` (1) and `keeps the same pane mounted, minus Stop agent` (2, one per state). In each, `Stop agent` is absent and `Destroy agent` is present (the it.each also checks the status label updates). Plus (added by the uat-auto run): 2 tests pass in the same file, where the Details tab shows a `Create window` button and `missing` when `windowPresent` is false and shows no `Create window` button and `present` when it is true; and 1 test passes in `LogTail.test.tsx`, where a `/tail` response with `windowPresent: false` renders `Window not present.` with no `Loading…`/error text and no Direct Input `stop` control.
- **Repeatable Unit Test**: Created (pre-existing, from TASK-0172/0173): `frontend/src/components/AgentList.test.tsx` (`AgentDetailModal actions menu wiring (TASK-148) > omits the Stop agent button entirely (not just disabled) when the agent has no live window` and `AgentList sidebar + pane selection gaps (TASK-0173 UAT) > keeps the same pane mounted, minus Stop agent, when the selected agent turns %s ...`). Added by the uat-auto run (tests only): `AgentDetailView Details/Queued Tasks tabs (TASK-162 Step 3) > shows the Create window button and "Window: missing" in the Details tab when agent.windowPresent is false (TASK-0178)` and `> omits the Create window button from the Details tab when agent.windowPresent is true (TASK-0178)` in `AgentList.test.tsx`, and `LogTail with no tmux window (TASK-0178) > renders "Window not present." and no terminal capture surface when the tail reports windowPresent: false` in `LogTail.test.tsx` (uses the real `LogTail`, not the `AgentList.test.tsx` mock).
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "omits the Stop agent button entirely|keeps the same pane mounted, minus Stop agent|Create window button"` — verified: 5 passed. LogTail half: `cd frontend && npx vitest run src/components/LogTail.test.tsx -t "LogTail with no tmux window"` — verified: 1 passed
- [x] Pass <!-- 2026-09-18 -->

---

### UAT-EDGE-006: Shift+Cmd+Right from an inactive agent moves to the next inactive agent and stops at the end; Left stops at the start (non-wrapping)
- **Scenario**: With `sleep-a` (id 103) and `sleep-b` (id 104) inactive plus two active agents, selecting `sleep-a` and pressing Shift+Cmd+Right goes to `sleep-b`; pressing it again stays on `sleep-b` (does not wrap and does not jump into the active set); Shift+Cmd+Left goes back to `sleep-a` and a second press stays.
- **Steps**:
  1. Run the unit command below.
- **Expected Result**: 1 test passes with the sequence `sleep-a` -> `sleep-b` -> (stay) -> `sleep-a` -> (stay).
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`AgentList > inactive selection via InactiveAgentsPanel (TASK-0178) > Shift+Cmd+Right from an inactive agent moves to the next inactive agent and stops at the end; Left stops at the start`; written during the TASK-0178 tackle).
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "Shift.Cmd.Right from an inactive agent"` — verified: 1 passed
- [x] Pass <!-- 2026-09-18 -->

---

### UAT-EDGE-007: From an active agent the shortcut still cycles the active list (wrapping), and the view's prev/next counter follows the set the selection is in
- **Scenario**: Selecting an inactive agent shows the prev/next buttons because two inactive agents exist (`agentCount` = inactive list length). Switching to an active agent, Shift+Cmd+Right moves `live-one` -> `live-two` and the next press wraps back to `live-one`, never entering the inactive set.
- **Steps**:
  1. Run the unit command below.
- **Expected Result**: 1 test passes: `Next agent` button present in the `sleep-a` pane; active cycling `live-one` -> `live-two` -> `live-one`.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`... > the view counter follows the selection: two inactive agents show the prev/next buttons, and from an active agent the active list still wraps`; written during the TASK-0178 tackle).
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "the view counter follows the selection"` — verified: 1 passed
- [x] Pass <!-- 2026-09-18 -->

---

### UAT-EDGE-008: A sole inactive agent: the shortcut is a no-op, prev/next buttons hide, and no active agent gets selected
- **Scenario**: A selected active agent turns `no-window` / `exited` while other active agents exist. The pane stays mounted (same DOM node), the inactive set is now just that agent so the prev/next buttons disappear, and Shift+Cmd+Right/Left change nothing (no jump into `noop-x` / `noop-y`, and the sidebar has no `aria-current` row because the selected agent is not in the active groups).
- **Steps**:
  1. Run the unit command below (`it.each` over `no-window` and `exited`).
- **Expected Result**: 2 tests pass.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`is a no-op for Shift+Cmd+Arrow when the selected agent turns %s and is the only inactive agent (TASK-0178): ...`, 2 cases; written during the TASK-0178 tackle).
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "is a no-op for Shift.Cmd.Arrow when the selected agent turns"` — verified: 2 passed
- [x] Pass <!-- 2026-09-18 -->

---

### UAT-EDGE-009: An `error` agent belongs to both sets; the active list is authoritative when it is selected
- **Scenario**: `error` is in both `ACTIVE_STATUSES` and `INACTIVE_STATUSES`. When an `error` agent is the selection, `handleNavigate` computes `inActive = orderedAgentIds.includes(prev.id)` (true), so the shortcut cycles the active list (wrapping), not the inactive list, and `agentCount` is the active-list length. This holds whether the agent was selected from its project-group row or from the inactive panel.
- **Steps**:
  1. Run the unit command below (added by the uat-auto run; it asserts the error-agent cycling rule and the counter, and the existing non-wrapping inactive cycling test covers the pure-inactive half). Optionally also verify by reading `handleNavigate` and the `agentCount` computation in `frontend/src/components/AgentList.tsx`, or manually: in Playwright, intercept `**/api/status` (`page.route`) with a payload of two active agents (e.g. `idle`, `busy`), one `error` agent and two `exited` agents, and reload `http://localhost:4321/`. Do not create a real errored agent.
  2. Expand `Inactive Agents`, click the `error` agent's row (body only), then press Shift+Cmd+Right (Ctrl+Shift+Right on non-Mac). The pane must move to an active agent (the next in sidebar order, wrapping at the end), not to an `exited` agent.
  3. Click an `exited` agent's row and press the shortcut: the pane moves only among the `exited`/`no-window`/`unknown`/`error` list (inactive list order), non-wrapping.
- **Expected Result**: Selection of the `error` agent cycles the active list with wrap; selection of a pure-inactive agent cycles the inactive list without wrap. `agentCount` (prev/next buttons visible) follows accordingly.
- **Repeatable Unit Test**: Created (by the uat-auto run, tests only): `frontend/src/components/AgentList.test.tsx` (`AgentList cycling order and arm-interact against the pane selection (TASK-0174) > cycles the active list (wrapping) when an error agent is selected from the inactive panel` and `> the view counter for an error agent selected from the inactive panel is the active count, not the inactive count`). Test 1 uses `[idle live-one, busy live-two, error err-one, exited sleep-a]`, selects `err-one` through the inactive panel and asserts Shift+Cmd+Right wraps to `live-two` (first in active sidebar order: busy sorts before idle before error) and never opens `sleep-a`. Test 2 uses a fixture where `err-one` is the only inactive-set agent, so an inactive-list counter would be 1 and hide prev/next; it asserts Previous/Next agent buttons are visible and the shortcut still cycles the active list. The pure-inactive non-wrapping half is asserted by the UAT-EDGE-006 test, included in the command below.
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "when an error agent is selected|counter for an error agent|Shift.Cmd.Right from an inactive agent"` — verified: 3 passed
- [x] Pass <!-- 2026-09-18 -->

---

### UAT-EDGE-010: The `AgentDetailModal` overlay wrapper is retired: the view has no dialog role, no scroll lock and ignores Escape, and no wrapper tests remain
- **Scenario**: With `AgentDetailModal` deleted, the only way to show an agent is `AgentDetailView` in the pane. The remaining view-level test proves no overlay chrome (no `role="dialog"`, `document.body.style.overflow` untouched, Escape does not call `onClose`), and the overlay-only wrapper tests (dialog role, backdrop click, Escape-closes, body scroll lock) are gone.
- **Steps**:
  1. Run the first unit command below.
  2. Run the second unit command below (the old wrapper describe title must now match nothing).
- **Expected Result**: Step 1: 1 test passes. Step 2: vitest reports `Tests 158 skipped (158)` / no test run (zero matches), confirming `AgentDetailModal overlay wrapper (TASK-0172)` no longer exists.
- **Repeatable Unit Test**: Created (pre-existing, from TASK-0172): `frontend/src/components/AgentList.test.tsx` (`AgentDetailView without overlay chrome (TASK-0172) > has no dialog role, does not lock body scroll, and ignores Escape`). No new file written by this generation run.
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "without overlay chrome"` — verified: 1 passed. Zero-match check: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "AgentDetailModal overlay wrapper"` — verified: 0 run, 158 skipped
- [x] Pass <!-- 2026-09-18 -->

---

### UAT-INT-001: `AgentDetailModal` is fully removed from `frontend/src` (no definition, export, import or JSX use), and `InactiveAgentsPanel` no longer imports it
- **Scenario**: TASK-0178 Step 3: the wrapper had two consumers (`AgentList`, `InactiveAgentsPanel`); after repointing there are none and the wrapper is deleted. The task's completion notes say the `describe(...)` titles in `AgentList.test.tsx` still spell `AgentDetailModal ...` for view-level suites, kept on purpose to preserve UAT cross-references. So the requirement is: zero code references, zero mentions outside that one test file.
- **Steps**:
  1. Symbol check (Serena `search_for_pattern`, or grep): pattern `(import|export|function|const|class|interface|type)[^\n]*AgentDetailModal|<AgentDetailModal|AgentDetailModal\(` under `frontend/src` — must return no matches. Verified at generation time: no matches.
  2. Mention check: pattern `AgentDetailModal` under `frontend/src` excluding `**/AgentList.test.tsx` — must return no matches. Verified at generation time: no matches.
  3. Confirm `frontend/src/components/InactiveAgentsPanel.tsx` imports only `useState`, `API_BASE`, `useAgents`, `deriveStatus / getStatusColor / isInactiveStatus / ProjectBadge / Agent` from `./AgentList`, and `ConfirmDialog` — no modal import and no `expandedId` / `expandedAgent` / `navigateExpanded` identifiers.
  4. Optional: `find_symbol("AgentDetailModal", substring_matching=true)` under `frontend/src` should return only `describe(...)` callbacks in `AgentList.test.tsx` (three at generation time: the TASK-148 actions-menu, TASK-153 Skills and TASK-154 header describes).
- **Expected Result**: No definition/import/usage of `AgentDetailModal` anywhere; the only remaining textual mentions are describe titles and comments inside `frontend/src/components/AgentList.test.tsx`.
- **Repeatable Unit Test**: Not applicable: this is a static absence check with no runtime behavior; steps 1-2 are one-line pattern searches and the compile-time proof is UAT-INT-002 (`tsc` fails on any dangling import). Missing assertion: none feasible in vitest short of a file-content lint rule.
- [FAIL: auto-judge: manual test requires human verification (no Repeatable Unit Test and no `**Command**:` field; at run time the step 1 and step 2 pattern searches under `frontend/src` returned no matches and `InactiveAgentsPanel.tsx` imports match step 3, but that is a heuristic check, not a recorded oracle)] <!-- 2026-09-18 -->

---

### UAT-INT-002: Whole frontend suite, typecheck, build and lint of the touched files are clean
- **Scenario**: Task Step 4 gates, re-run independently.
- **Steps**:
  1. `cd frontend && npx vitest run` — all files pass. Verified at generation time: 11 files, 258 tests passed (a jsdom `HTMLCanvasElement's getContext()` "Not implemented" notice is pre-existing noise, not a failure).
  2. `cd frontend && npx tsc --noEmit` — exit 0, no output. Verified at generation time: clean.
  3. Build into a scratch directory so the served `dist/` is not overwritten: `cd frontend && npx vite build --outDir ../tmp/uat-0178-dist --emptyOutDir` — ends with `built in ...` (the >500 kB chunk warning is pre-existing). Verified at generation time: built. The scratch directory `tmp/uat-0178-dist` (gitignored) was left in place by this run because the shell denied `rm -rf`; delete it afterwards.
  4. `cd frontend && npx eslint src/components/InactiveAgentsPanel.tsx src/components/InactiveAgentsPanel.test.tsx src/components/AgentList.tsx` — 0 errors. Verified at generation time: 0 errors, 1 pre-existing `react-hooks/exhaustive-deps` warning (`pendingNotifyTimersRef.current`, AgentList.tsx ~1917). (`AgentList.test.tsx` lint errors around lines ~661/816/2212 are recorded in the task as pre-existing and were not in this run's lint scope.)
- **Expected Result**: Steps 1-4 as stated.
- **Repeatable Unit Test**: Not applicable: these are the repo's static gates; step 1 is the whole suite itself.
- **Unit Test Command**: `cd frontend && npx vitest run` — verified: 258 passed
- [FAIL: auto-judge: not unit-backed and no `**Command**:` field, so no recorded oracle (at run time: vitest 11 files 265 passed, `tsc --noEmit` exit 0, scratch `vite build` ended `built in 1.23s`, eslint 0 errors and the 1 pre-existing warning; human can confirm and flip)] <!-- 2026-09-18 -->

---

### UAT-UI-001: Live — click an inactive agent: it renders in the main pane (no dialog) with the Create window path and a highlighted row
- **Page**: `http://localhost:4321/`
- **Description**: The `[DEFERRED-TO-UAT]` live check from TASK-0178, restricted to read-only actions (see the safety rule).
- **Steps**:
  1. Open `http://localhost:4321/` at 1440x900. In the sidebar click the `Inactive Agents (N)` header to expand.
  2. Click the body of an `EXITED` or `CLOSED` row (not `Wake`, not the trash button). Expected: no dialog or backdrop appears; the main pane (right of the sidebar) shows a region named `<name> detail`; the clicked row shows a blue ring and `aria-current="true"` (console, read-only: `document.querySelector('aside[aria-label="Agents"] li[aria-current="true"]')?.textContent`); the section stays expanded.
  3. In the pane confirm the tabs: `Terminal` and `Details •` (the bullet marks a missing window). Header actions show `Destroy agent` and no `Stop agent`. Do not click any of them.
  4. Open the `Terminal` tab: it shows `Window not present.` (italic, muted) and no red error boundary or blank screen. Browser console: no uncaught errors or React error-boundary output while selecting.
  5. Open the `Details •` tab: rows `Window: missing`, and a blue `Create window` button. Do NOT click it (it would spawn a tmux window).
  6. Click a different inactive row: the pane switches to that agent, the ring moves to the new row and leaves the old one. Then click an active agent's row in the project groups: the pane switches to it, and no inactive row keeps `aria-current`.
- **Expected Result**: Inactive agents open in the pane like active ones; windowless view is usable (Terminal `Window not present.`, Details `Details •` with `Create window`); selection highlight follows the click on both inactive and active rows; no dialog overlay ever appears.
- **Repeatable Unit Test**: Not applicable for the live look. Coverage from unit tests: dialog absence, `aria-current` on the row and the `Details •` label are covered by UAT-EDGE-004; Stop omitted / Destroy present by UAT-EDGE-005. The former missing assertions (the `Create window` button rendering, `Window not present.` from `LogTail` with `windowPresent: false`, the ring classes on the selected inactive row, and `aria-current` clearing when an active row is later selected) were added at unit level by the uat-auto run (see UAT-EDGE-003 and UAT-EDGE-005); the live look stays human-only.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-09-18 -->

---

### UAT-UI-002: Live — Shift+Cmd+Arrow cycling: inside the inactive list from an inactive selection (non-wrapping), inside the active list from an active selection (wrapping)
- **Page**: `http://localhost:4321/`
- **Description**: Live confirmation of the cycling decision. Uses only the keyboard shortcut and row clicks; no action buttons and no typing into a terminal.
- **Steps**:
  1. With at least two inactive agents, expand `Inactive Agents` and click the first inactive row (in sidebar order). Click a neutral area of the page body (not a text field) so focus is not in an input.
  2. Press Shift+Cmd+Right (Ctrl+Shift+Right on non-Mac). The pane moves to the next inactive agent in the panel's list order. Repeat until the last inactive agent; one more press does nothing (no wrap, and no jump to an active agent).
  3. Press Shift+Cmd+Left back to the first inactive agent; one more press does nothing.
  4. Confirm the pane header's previous/next arrows are visible while two or more inactive agents exist, and that the counter reflects the inactive count.
  5. Click an active agent's row and press Shift+Cmd+Right repeatedly: the pane moves through active agents in sidebar order and wraps from the last to the first; it never enters the inactive list.
  6. (Edge) If only one agent is inactive, select it: the prev/next arrows are hidden and the shortcut does nothing.
- **Expected Result**: Inactive selection cycles only the inactive list, non-wrapping; active selection cycles only the active list, wrapping; prev/next arrows follow the list the selection is in.
- **Repeatable Unit Test**: Not applicable for the live look. The same behavior is covered by UAT-EDGE-006, UAT-EDGE-007 and UAT-EDGE-008; the `error`-in-both-sets rule is covered at unit level by the tests added for UAT-EDGE-009.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-09-18 -->

---

## Follow-up observations (not test cases)

- Earlier UATs reference the deleted `AgentDetailModal` wrapper and its overlay tests (UAT-0172, UAT-0173, UAT-0177 were the ones flagged; a text search shows UAT-0173 only cites the `AgentDetailModal actions menu wiring (TASK-148)` describe title, which still exists, so only UAT-0172 and UAT-0177 have dead references): **UAT-0172** (UAT-UI cases and gaps describing the portal / backdrop / body-scroll-lock / Escape behavior, and the `AgentDetailModal overlay wrapper (TASK-0172)` unit tests that no longer exist), **UAT-0173** (line ~115 cites `AgentDetailModal actions menu wiring (TASK-148)` tests, which still exist under that title), and **UAT-0177** (UAT-EDGE-007 runs `-t "opens AgentDetailModal"`, which now matches zero tests; UAT-INT-001 names `AgentDetailModal` as an import of `InactiveAgentsPanel`; UAT-EDGE-007 already says it is superseded by UAT-0178). Those cases' unit commands will need updating or their results marked superseded. The view-level describes kept the `AgentDetailModal ...` titles (TASK-148/153/154), so commands citing those still resolve.
- Stale product copy remains that TASK-0178's Step 3 scrub did not cover (it listed `AgentList.tsx`, `terminalSizeProbe.ts` and its test): `frontend/src/components/LogTail.tsx` shows `Press esc again to close the modal` (line ~749), the prop is still named `onCloseModal` (`LogTail.tsx` ~160, wired at `AgentList.tsx` ~855) and its doc comments say "modal"; `LogTail.test.tsx` asserts that literal hint text. In the pane there is no modal, so the copy misdescribes what a double-Escape does. Also `AgentInfoTabs.tsx` ~132 comment says "fill the modal". Worth a small follow-up task; not a TASK-0178 acceptance failure.
- Pre-existing, recorded in TASK-0178 and not fixed by it: clicking Confirm/Cancel inside the panel's `ConfirmDialog` bubbles to the panel's outer `onClick` and collapses the section. UAT-0177 UAT-EDGE-004 unit tests do not assert the section stays expanded after Cancel.
- The `agent-detail-modal` wiki entity page is stale after this task; the task's completion notes defer it to update-docs.

## Coverage gaps (no test asserts these; see the per-case notes)

All four gaps below were closed at unit level by the uat-auto run on 2026-09-18 (tests only; see the cited cases):

- `Create window` button rendered for a windowless agent's Details tab and absent when a window exists (UAT-EDGE-005, UAT-UI-001). Closed.
- `LogTail` with `windowPresent: false` renders `Window not present.` without throwing (UAT-EDGE-005, UAT-UI-001). Closed in `LogTail.test.tsx`.
- Ring classes (`ring-2 ring-accent-blue/50`) on the selected inactive row, and `aria-current` clearing from an inactive row when the selection moves to an id outside the panel (UAT-EDGE-003, UAT-UI-001). Closed at panel level via `selectedId` rerender.
- An `error` agent (in both sets) cycles the active list when selected, including when selected from the inactive panel (UAT-EDGE-009). Closed.
