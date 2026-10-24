---
id: UAT-0170
aliases: [UAT-0170]
title: "UAT: Build the AgentSidebar component grouping agents by project"
status: skipped
task: TASK-0170
created: 2026-09-18
updated: 2026-10-17
---

# UAT-0170 — UAT: Build the AgentSidebar component grouping agents by project

implements::[[TASK-0170]]

> **Source task**: [[TASK-0170]]
> **Generated**: 2026-09-18

---

## Prerequisites

- [ ] Dev servers running: `make dev` (host-server on port 8788, frontend on port 4321)
- [ ] A conductor tmux session exists with at least 5 registered agents: at least two in **project A**, at least one in **project B**, at least one **unassigned** (no project), in a mix of statuses within a project (ideally one `awaiting`/`stalled`, one `busy`, one `idle`), plus one agent whose window has exited (status `exited`/`no-window`). `GET http://localhost:8788/api/status` lists agents with their `projectName` and `state`.
- [ ] Dashboard reachable at `http://localhost:4321/` (route `/` renders `AgentsPage`, which renders `InactiveAgentsPanel` then `AgentList` containing `AgentSidebar`)

---

## Test Cases

### UAT-UI-001: Sidebar lists agents under project headers, alphabetical, `Unassigned` last, with per-group counts
- **Page**: `http://localhost:4321/`
- **Description**: `AgentSidebar` (an `<aside aria-label="Agents">` in `AgentList.tsx`) sorts active agents with `byProjectThenStatus` and clusters them with `groupByProject`. Each group renders a project header (`group.project ?? 'Unassigned'`) plus a small agent count, followed by that group's `AgentItem` rows.
- **Steps**:
  1. Run the unit test command below (renders agents from projects `Alpha` x2, `Beta` x1 and one unassigned agent).
  2. Live cross-check: open `http://localhost:4321/` and read the left sidebar top to bottom.
- **Expected Result**: Headers appear in the order `Alpha`, `Beta`, `Unassigned` (project name case-insensitive alphabetical, unassigned last); every agent sits below its own project's header and above the next header; the header text and count read `Alpha` `2`, `Beta` `1`, `Unassigned` `1`; each project appears exactly once. Live: same structure for the real projects.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`AgentList sidebar (project grouping, TASK-0170) > renders agents under project headers in order, unassigned last, with per-group counts`)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "renders agents under project headers in order"` — verified: 1 passed
- [x] Pass <!-- 2026-09-18 -->

---

### UAT-UI-002: Within a project group, rows are ordered by status urgency, then name
- **Page**: `http://localhost:4321/`
- **Description**: Group order and within-group order are exactly `byProjectThenStatus`: project, then `STATUS_SORT` urgency (awaiting/stalled first, then busy, then idle/empty), then agent name case-insensitively.
- **Steps**:
  1. Open `http://localhost:4321/` and locate a project group containing agents in at least two different statuses (e.g. `awaiting` and `idle`, or `busy` and `idle`).
  2. Read the rows in that group top to bottom and note each row's status badge.
  3. Within a run of rows sharing the same status, note their names.
- **Expected Result**: More urgent statuses appear above less urgent ones inside the same group (awaiting/stalled above busy above idle); rows with equal status are ordered by name, case-insensitive ascending.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`AgentList sidebar (project grouping, TASK-0170) > orders rows within a project group by status urgency, then by name case-insensitively`). Added by the UAT runner (2026-09-18): one project with `awaiting`/`busy`/`idle` agents whose names (`c-await`, `b-busy`, `a-idle`) sort in the reverse of urgency order, asserting DOM order awaiting > busy > idle; a second project with two `busy` agents `apple` / `Banana` asserting case-insensitive name order.
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "orders rows within a project group"` — verified: 1 passed
- [x] Pass <!-- 2026-09-18 -->

---

### UAT-UI-003: Filter input lives inside the sidebar and narrows the grouped rows
- **Page**: `http://localhost:4321/`
- **Description**: The `Filter agents` text input moved from the page header to the top of the sidebar; its state stays in `AgentList` and is passed down as `filterText` / `onFilterChange`. Typing still filters by name/project/role/branch.
- **Steps**:
  1. Run the unit test command below (two tests: the input is inside the `complementary` landmark named `Agents`; typing `alpha` leaves only `alpha-backend` and hides `beta-frontend`).
  2. Live cross-check: on `http://localhost:4321/`, type part of one agent's name into the `Filter agents` input at the top of the sidebar.
- **Expected Result**: `getByLabelText('Filter agents')` resolves within the `aside` labelled `Agents`; typing a substring that matches one agent leaves that agent visible and removes non-matching agents from the sidebar.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`AgentList sidebar (project grouping, TASK-0170) > keeps the filter input inside the sidebar` and `AgentList filter (integration) > typing into the filter input narrows the rendered agent cards`). Note: neither test asserts the input is absent from the old header position (no `getAllByLabelText('Filter agents')).toHaveLength(1)` style check); that half is covered live in UAT-UI-007.
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "keeps the filter input inside the sidebar|typing into the filter input narrows"` — verified: 2 passed
- [x] Pass <!-- 2026-09-18 -->

---

### UAT-UI-004: Clicking a sidebar row still opens the existing detail modal
- **Page**: `http://localhost:4321/`
- **Description**: Selection semantics are unchanged in this task: a row click calls `setExpandedAgent({ id, armInteract })`, which opens the existing `AgentDetailModal` overlay (the in-page detail pane arrives in TASK-0173).
- **Steps**:
  1. Run the unit test command below (clicks the `beta-api` row in the sidebar).
  2. Live cross-check: on `http://localhost:4321/`, click any agent row in the sidebar.
- **Expected Result**: No `dialog` is present before the click; after clicking `beta-api` a `dialog` with `aria-label` `beta-api detail` appears. Live: the detail overlay opens for the clicked agent and closes normally.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`AgentList sidebar (project grouping, TASK-0170) > still opens the detail modal when a sidebar row is clicked`)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "still opens the detail modal when a sidebar row"` — verified: 1 passed
- [x] Pass <!-- 2026-09-18 -->

---

### UAT-UI-005: Desktop layout — sidebar flush left at 320px, page no longer width-capped
- **Page**: `http://localhost:4321/`
- **Description**: `AgentsPage`'s `<main>` no longer uses the `max-w-[1280px]` centred wrapper; it is `flex h-[calc(100vh-3rem)] w-full flex-col overflow-hidden`. The sidebar is `w-[320px] flex-shrink-0 overflow-y-auto border-r border-line`, with the main content area (`min-w-0 flex-1`) taking the remaining width.
- **Steps**:
  1. Open `http://localhost:4321/` at a desktop viewport of 1600px wide (the NavBar is 48px tall / `h-12`).
  2. Visually confirm the sidebar touches the left edge of the window and a vertical divider line separates it from the right column.
  3. In devtools run `document.querySelector('aside[aria-label="Agents"]').getBoundingClientRect()` and note `left` and `width`.
  4. In devtools run `document.querySelector('main').getBoundingClientRect().width` and compare with `window.innerWidth`.
- **Expected Result**: The sidebar's `left` is 0 and `width` is 320; `main` spans the full viewport width (no 1280px cap, no side gutters); the right column fills the remaining ~1280px; the page area fills the viewport below the NavBar (no dead space below the columns).
- **Repeatable Unit Test**: Not applicable: real layout metrics (bounding boxes, viewport height calc) are not evaluated by jsdom; Tailwind classes are not resolved to computed sizes in the vitest environment.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-09-18 -->

---

### UAT-UI-006: At ~1024px width there is no horizontal page scroll and the sidebar scrolls independently
- **Page**: `http://localhost:4321/`
- **Description**: Deferred-to-UAT step from TASK-0170: the sidebar (`overflow-y-auto`) and main column (`overflow-y-auto`) must scroll independently, and the fixed 320px sidebar must not push the page into horizontal scroll at laptop widths.
- **Steps**:
  1. Register enough agents (or shrink the window height) that the sidebar's content is taller than the viewport.
  2. Resize the browser to 1024px wide.
  3. In devtools run `document.documentElement.scrollWidth <= document.documentElement.clientWidth` and confirm it prints `true`; also try scrolling horizontally on the page.
  4. Scroll the sidebar with the mouse wheel over it; observe the right column and the NavBar/page header.
  5. Scroll the right column (if it overflows, e.g. many background processes) and observe the sidebar.
  6. Repeat steps 2-3 at 1280px and 1600px.
- **Expected Result**: `scrollWidth <= clientWidth` at 1024px (and larger widths) — no horizontal page scrollbar; scrolling the sidebar moves only the sidebar's rows (the filter input scrolls with it; the right column and NavBar stay put); scrolling the right column moves only that column; agent rows wrap (row 1 uses `flex-wrap`) rather than overflowing the 320px column.
- **Repeatable Unit Test**: Not applicable: scroll containers and horizontal overflow at a given viewport width need a real browser; jsdom has no layout engine.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-09-18 -->

---

### UAT-UI-007: Header, session banner, background processes and inactive panel stay where the task says; no second filter input
- **Page**: `http://localhost:4321/`
- **Description**: Per the task, the `h1` "tmux Conductor — Agents" and `SessionBanner` stay above the two columns; the right column holds `BgProcessSection`; `InactiveAgentsPanel` still renders above `AgentList` inside `AgentsPage`; the filter input exists only in the sidebar now.
- **Steps**:
  1. Open `http://localhost:4321/` with at least one background process registered (`GET http://localhost:8788/api/status` lists `bgProcesses`).
  2. Confirm the `tmux Conductor — Agents` heading sits above both columns, spanning the full width, with a divider line beneath it before the two columns start.
  3. Confirm the background-process section (per-project sub-headers) renders in the right-hand column, not in the sidebar.
  4. If an inactive agent exists, confirm the inactive-agents panel renders above the heading/columns at the top of the page (and that with no inactive agents it takes no space).
  5. In devtools run `document.querySelectorAll('input[aria-label="Filter agents"]').length`.
  6. (Optional) Stop the tmux session so `sessionAlive` is false and reload; confirm the session banner appears under the heading, above the columns.
- **Expected Result**: Heading (and banner when the session is down) above both columns; `BgProcessSection` in the right column only; inactive panel above the heading; the devtools query returns exactly `1` (the sidebar input) — no filter input remains in the old header position.
- **Repeatable Unit Test**: Not applicable: relative placement of regions and count of inputs on the composed `AgentsPage` requires the full page (`InactiveAgentsPanel`, router, NavBar) and real layout; existing tests render `AgentList` alone. (A count-of-inputs assertion could be added to the sidebar suite, but would not cover region placement.)
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-09-18 -->

---

### UAT-EDGE-001: Filter matching nothing shows the no-match copy in the sidebar and removes rows and headers
- **Scenario**: Agents exist but none match the filter.
- **Steps**:
  1. Run the unit test command below (types `zzz-no-such-agent` into the sidebar filter).
  2. Live cross-check: on `http://localhost:4321/`, type `zzzzzz` into the sidebar filter.
- **Expected Result**: Inside the `Agents` aside, the text `No agents match your filter.` is shown; no agent rows and no project headers (e.g. `Alpha`) remain; the filter input stays visible so it can be cleared.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`AgentList sidebar (project grouping, TASK-0170) > shows the no-match copy inside the sidebar when the filter excludes every agent`; the distinct-from-zero-agents behavior is also covered by `AgentList empty states (agent filter) > shows "No agents match your filter." …`). Update (UAT runner, 2026-09-18): the no-match test now also asserts `within(sidebar).getByLabelText('Filter agents')` is still present, so "the filter input stays visible" is asserted.
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "shows the no-match copy inside the sidebar"` — verified: 1 passed
- [x] Pass <!-- 2026-09-18 -->

---

### UAT-EDGE-002: Zero registered agents shows "No agents registered." and no filter input
- **Scenario**: The sidebar is rendered with `totalAgentCount === 0`.
- **Steps**:
  1. Run the unit test command below (renders `AgentList` with `agents: []`).
  2. Live cross-check (optional, destructive — only on a scratch DB): with no agents registered, open `http://localhost:4321/`.
- **Expected Result**: The text `No agents registered.` is shown and there is no `Filter agents` input; the text is distinct from (and never accompanies) `No agents match your filter.`.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`AgentList empty states (agent filter) > shows "No agents registered." (and no filter input) when there are zero agents`). Note: the test queries via `screen`, not scoped `within` the aside; the string is only emitted by `AgentSidebar`, so aside containment is structural.
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "shows \"No agents registered.\""` — verified: 1 passed
- [x] Pass <!-- 2026-09-18 -->

---

### UAT-EDGE-003: Exited agents are excluded from the sidebar
- **Scenario**: `AgentList` passes `visibleAgents = filteredAgents.filter(isActiveStatus(deriveStatus(a)))` to the sidebar, so agents with `exited`/`no-window`/`unknown` status never render as sidebar rows (they belong to `InactiveAgentsPanel`).
- **Steps**:
  1. Run the unit test command below (renders `busy`, `idle`, `awaiting` and `exited` agents).
  2. Live cross-check: on `http://localhost:4321/`, find the agent whose window has exited and confirm it is not a row in the sidebar (and is listed in the inactive-agents panel at the top of the page).
- **Expected Result**: Busy, idle and awaiting agents render; the exited agent's name does not render in the sidebar. Live: the exited agent appears only in the inactive-agents panel.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`AgentList board (no Kanban columns) > renders busy, idle and awaiting agents in one list, omits exited agents, and has no column headings`) — covers the sidebar-exclusion half only. Missing: (a) the assertion is via `screen.queryByText`, not scoped to the `Agents` aside, and (b) the "appears in the inactive-agents panel" half is not asserted anywhere at the `AgentList` level because `InactiveAgentsPanel` is not rendered in that test.
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "omits exited agents"` — verified: 1 passed
- **Additional Unit Test** (UAT runner, 2026-09-18): `AgentList sidebar (project grouping, TASK-0170) > does not render an exited agent as a sidebar row` asserts `within(sidebar).queryByText('alpha-gone')` is null, closing gap (a) (aside scoping). Gap (b), the inactive-panel half, is still not asserted by any test.
- [FAIL: auto-judge: unit test covers only part of Expected — the "exited agent appears only in the inactive-agents panel" half is not asserted by any test (InactiveAgentsPanel is not rendered at the AgentList level); the sidebar-exclusion half passes] <!-- 2026-09-18 -->

---

### UAT-EDGE-004: Clearing the filter restores the full grouped sidebar
- **Scenario**: After filtering to zero (or a subset), emptying the `Filter agents` input must bring back every project group and row in the original order.
- **Steps**:
  1. On `http://localhost:4321/`, note the headers and row order in the sidebar.
  2. Type `zzzzzz` into the sidebar filter and confirm `No agents match your filter.` appears.
  3. Clear the input (select all + delete, or empty it).
  4. Compare the sidebar with the state noted in step 1.
- **Expected Result**: All project headers (with counts) and all active rows return in the same order as before filtering; the no-match copy disappears.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`AgentList sidebar (project grouping, TASK-0170) > restores the full grouped sidebar after clearing a no-match filter`). Added by the UAT runner (2026-09-18): filters to zero, clears the input, then asserts the no-match copy is gone, all four rows are back, the header list equals `['Alpha2', 'Beta1', 'Unassigned1']` and equals the pre-filter header list, and row order equals the pre-filter order.
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "restores the full grouped sidebar"` — verified: 1 passed
- [x] Pass <!-- 2026-09-18 -->

---

### UAT-EDGE-005: Project helpers hoisted to module level and frontend gates clean
- **Scenario**: `projectLabelFor` / `projectIdFor` are module-level pure functions of `Agent` (one shared definition for the sidebar, the render body and the detail-modal wiring), no stale closures remain in `AgentList`'s body, the AgentList test file passes and the project typechecks.
- **Steps**:
  1. Search `frontend/src/components/AgentList.tsx` for `const projectLabelFor` and `const projectIdFor` (Serena `search_for_pattern`) and note the line numbers and indentation.
  2. Run `cd frontend && npx vitest run src/components/AgentList.test.tsx`.
  3. Run `cd frontend && npm run typecheck`.
- **Expected Result**: Exactly one definition of each helper, at column 0 (module level, before `byProjectThenStatus`), each a one-line read of `agent.projectName` / `agent.projectId`; the full AgentList test file passes (102/102 at generation time); `tsc --noEmit` exits clean with no errors.
- **Repeatable Unit Test**: Not applicable: source-location check plus static gates (test suite, typecheck), not a behavioral unit assertion. Evidence at generation time: definitions at `AgentList.tsx:1685-1686`, 102/102 tests passing, typecheck clean.
- [x] Pass <!-- 2026-09-18 -->
