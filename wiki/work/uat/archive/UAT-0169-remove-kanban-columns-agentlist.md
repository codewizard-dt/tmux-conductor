---
id: UAT-0169
aliases: [UAT-0169]
title: "UAT: Remove the 3 Kanban status columns and their partition logic from AgentList"
status: skipped
task: TASK-0169
created: 2026-09-18
updated: 2026-10-17
---

# UAT-0169 — UAT: Remove the 3 Kanban status columns and their partition logic from AgentList

implements::[[TASK-0169]]

> **Source task**: [[TASK-0169]]
> **Generated**: 2026-09-18

---

## Prerequisites

- [ ] Dev servers running: `make dev` (host-server on port 8788, frontend on port 4321)
- [ ] A conductor tmux session exists with at least 3 registered agents in **at least two different projects**, in a mix of statuses (ideally one `busy`, one `idle` and one `awaiting`/`stalled`), plus one agent whose window has exited (status `exited`/`no-window`). `GET http://localhost:8788/api/status` lists agents and their current `state`.
- [ ] Dashboard reachable at `http://localhost:4321/` (route `/` renders `AgentsPage`, which renders `AgentList` then `InactiveAgentsPanel`)

---

## Test Cases

### UAT-UI-001: Agents page shows active agents as one column with no Kanban headings
- **Page**: `http://localhost:4321/`
- **Description**: The 3-column status board (`Waiting / Stalled`, `Busy`, `Ready / No tasks`) is gone. Status is no longer a layout axis: every active agent card appears in a single vertical stack.
- **Steps**:
  1. Open `http://localhost:4321/` at a desktop-width viewport (at least 1280px wide).
  2. Look at the area below the "tmux Conductor — Agents" heading and the filter input.
  3. Confirm there is no heading reading `Waiting / Stalled`, `Busy` or `Ready / No tasks` anywhere on the page.
  4. Confirm every active agent card (busy, idle, awaiting, stalled, starting, error) is left-aligned in one vertical stack, with no side-by-side columns.
- **Expected Result**: No Kanban column headings are present; the active agent cards are stacked vertically in a single column regardless of their status.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`AgentList board (no Kanban columns) > renders busy, idle and awaiting agents in one list, omits exited agents, and has no column headings`) — covers the heading-absence half only; the single-column visual layout is not unit-testable in jsdom.
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "AgentList board"` — verified: 1 passed
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk (unit test covers heading-absence only; single-column layout not asserted)] <!-- 2026-09-18 -->

---

### UAT-UI-002: Layout stays a single column at wide and narrow viewports
- **Page**: `http://localhost:4321/`
- **Description**: The removed board used `grid-cols-1 md:grid-cols-3`. The interim list must not reintroduce any responsive multi-column breakpoint.
- **Steps**:
  1. Open `http://localhost:4321/` and resize the browser to 1600px wide, then to 1024px, 768px and 390px.
  2. At each width, observe the arrangement of active agent cards.
- **Expected Result**: At every width the cards remain one vertical stack (cards never sit next to each other); at narrow widths the cards shrink to fit with no horizontal page scroll.
- **Repeatable Unit Test**: Not applicable: responsive CSS layout across breakpoints requires a real browser; jsdom does not evaluate Tailwind breakpoints.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-09-18 -->

---

### UAT-UI-003: Cards are grouped under project sub-headers, ordered project then status
- **Page**: `http://localhost:4321/`
- **Description**: The interim single-column list is grouped by project via `groupByProject` (same sub-headers as before, just no columns). Within a project group, cards are sorted by status priority (`byProjectThenStatus` / `STATUS_SORT`: awaiting/stalled first, then busy, then idle/empty).
- **Steps**:
  1. With agents from at least two projects registered, open `http://localhost:4321/`.
  2. Observe the small uppercase sub-header above each cluster of cards (the project name, or `Unassigned` for agents with no project).
  3. Confirm every agent card sits beneath the sub-header for its own project and that each project appears only once (no repeated headers for the same project).
  4. Within one project that has agents in different statuses, confirm the more attention-needing agents (awaiting/stalled) appear above busy ones, and busy above idle.
- **Expected Result**: One sub-header per project (`Unassigned` for project-less agents), each followed by only that project's active agents, ordered by status priority within the group.
- **Repeatable Unit Test**: Not applicable: `groupByProject` and the sort are closures inside the `AgentList` render body (not exported); an integration-style render test would have to assert DOM order across multiple projects, which the existing harness does not yet cover.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-09-18 -->

---

### UAT-EDGE-001: Inactive agents are excluded from the board (active-status membership)
- **Scenario**: `isActiveStatus()` must have the same membership as the union of the old column statuses: `awaiting`, `stalled`, `error`, `busy`, `starting`, `idle`, `idle-waiting`, `empty`. Agents with `exited`, `no-window` or `unknown` status must not appear in `AgentList`'s board.
- **Steps**:
  1. Run the unit test command below (renders `AgentList` with `busy`, `idle`, `awaiting` and `exited` agents).
  2. Live cross-check: on `http://localhost:4321/`, confirm the agent whose window has exited does not appear in the main agent stack, and appears instead in the inactive-agents panel rendered below `AgentList` on the same page.
- **Expected Result**: The busy, idle and awaiting agents render; the exited agent does not render in the board. Live, the exited/no-window agent appears only in the inactive-agents panel.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`AgentList board (no Kanban columns) > renders busy, idle and awaiting agents in one list, omits exited agents, and has no column headings`)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "AgentList board"` — verified: 1 passed
- [FAIL: auto-judge: unit test covers only part of Expected — passes (board omits exited agent, 2 tests ran, 0 fail) but the live claim that the exited agent appears only in the inactive-agents panel is not asserted; requires human verification] <!-- 2026-09-18 -->

---

### UAT-EDGE-002: `error`-status agents remain on the board (overlap with the inactive panel preserved)
- **Scenario**: `error` is intentionally in both `ACTIVE_STATUSES` (AgentList) and `INACTIVE_STATUSES` (`InactiveAgentsPanel.tsx`) today, so an errored agent shows in both places. TASK-0169 explicitly preserves this overlap.
- **Steps**:
  1. If an agent is currently in `error` status, open `http://localhost:4321/` and confirm it appears both in the main agent stack and in the inactive-agents panel. If no agent is in `error` status, verify with the unit test after the test is added (see Repeatable Unit Test).
- **Expected Result**: An `error` agent renders a card in the main `AgentList` stack (and also in the inactive panel, unchanged).
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`AgentList board (no Kanban columns) > keeps an error-status agent on the board (overlap with the inactive panel preserved)`) — added during /uat-auto on 2026-09-18 (previously Blocked)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "AgentList board"` — verified: 2 passed (this case + UAT-EDGE-001's)
- [x] Pass <!-- 2026-09-18 -->

---

### UAT-EDGE-003: Cmd/Ctrl+Shift+Arrow cycling and agent count are unchanged and ignore the filter
- **Scenario**: `activeAgents` (used for Cmd+Shift+Arrow agent cycling and the `agentCount` prop of the detail modal) now uses `isActiveStatus(deriveStatus(a))` instead of `columnFor(...) !== null`. The cycling set must be byte-identical to before and must still be derived from the unfiltered agent list.
- **Steps**:
  1. Run the unit test command below (opens the detail modal for the middle agent, filters the grid so that agent is hidden, then presses Cmd+Shift+ArrowRight and asserts the modal advances to the next agent).
  2. Live cross-check: on `http://localhost:4321/`, open an agent's detail modal and press Cmd+Shift+ArrowRight / ArrowLeft (Ctrl+Shift on non-Mac); confirm it cycles through active agents only, skipping exited/no-window agents.
- **Expected Result**: Navigation reaches the next active agent even when the current filter hides it; exited/no-window agents are never cycled to.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`AgentList keyboard navigation ignores the grid filter > next-agent navigation still reaches an agent hidden by the current filter (orderedAgentIds stays unfiltered)`)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "AgentList keyboard navigation"` — verified: 2 passed
- [FAIL: auto-judge: unit test covers only part of Expected — passes (2 tests ran, 0 fail) and proves cycling reaches a filter-hidden agent, but no case asserts that exited/no-window agents are skipped during cycling (all fixture agents are default-state); requires human verification] <!-- 2026-09-18 -->

---

### UAT-EDGE-004: Empty states are preserved
- **Scenario**: The single-column interim render keeps the "No agents registered." and "No agents match your filter." empty states (and the filter input hidden when there are zero agents).
- **Steps**:
  1. Run the unit test command below.
  2. Live cross-check: on `http://localhost:4321/`, type a string matching no agent (e.g. `zzzzzz`) into the "Filter agents" input.
- **Expected Result**: With zero agents, the page shows `No agents registered.` and no filter input. With a non-matching filter, it shows `No agents match your filter.` and no cards or column headings; clearing the filter restores the project-grouped stack.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`AgentList empty states (agent filter)` — 4 cases)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "AgentList empty states"` — verified: 4 passed
- [FAIL: auto-judge: unit test covers only part of Expected — passes (4 tests ran, 0 fail) and asserts both empty-state messages and the hidden filter input, but no case asserts that clearing the filter restores the project-grouped stack; requires human verification] <!-- 2026-09-18 -->

---

### UAT-EDGE-005: No lingering column-model references, and full frontend gates are clean for AgentList
- **Scenario**: `Column`, `COLUMNS` and `columnFor` are deleted with no dangling references, and the tackle-time stale comments referencing them are refreshed.
- **Steps**:
  1. From the repo root, search `frontend/src` for `COLUMNS`, `columnFor` and `Column[` (e.g. with Serena `search_for_pattern`).
  2. Run `cd frontend && npm run typecheck` and confirm no errors originate in `AgentList.tsx` or `AgentList.test.tsx`.
  3. Run the whole AgentList test file: `cd frontend && npx vitest run src/components/AgentList.test.tsx`.
- **Expected Result**: Zero matches for `COLUMNS`, `columnFor` and `Column[` in `frontend/src` (the phrase `Waiting / Stalled` / `Ready / No tasks` appears only inside the negative assertions in `AgentList.test.tsx`); typecheck reports no AgentList errors; the full AgentList test file passes (97/97 at generation time).
- **Repeatable Unit Test**: Not applicable: a source-absence grep and a typecheck are static gates, not behavioral unit assertions.
- [FAIL: auto-judge: manual test requires human verification — evidence gathered, all green: 0 matches for COLUMNS|columnFor|Column\[ in frontend/src; `npm run typecheck` clean; AgentList.test.tsx 98/98 passed (was 97 at generation; +1 for the UAT-EDGE-002 test)] <!-- 2026-09-18 -->
