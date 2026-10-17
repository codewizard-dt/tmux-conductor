---
id: UAT-0181
aliases: [UAT-0181]
title: "UAT: Remove the Inactive Agents accordion — show all agents in the sidebar with a red border + Show inactive checkbox"
status: passed
task: TASK-0181
created: 2026-09-19
updated: 2026-09-19
---

# UAT-0181 — UAT: Remove the Inactive Agents accordion — show all agents in the sidebar with a red border + Show inactive checkbox

implements::[[TASK-0181]]

> **Source task**: [[TASK-0181]]
> **Generated**: 2026-09-19

Unit-test evidence for every case below lives in `frontend/src/components/AgentList.test.tsx` (16 tests tagged `TASK-0181`, written during `/tackle`). Run them all with:
`cd frontend && npx vitest run src/components/AgentList.test.tsx -t "TASK-0181"`

---

## Prerequisites

- [ ] `make dev` is running; dashboard reachable at `http://localhost:4321/` (route `/`, `AgentsPage`)
- [ ] At least two agents in one project: one active (`idle` or `busy`) and one inactive (`no-window` — tmux window closed — or `exited`)
- [ ] Ideally also an agent in `error` status, and a second project with its own inactive agent (cases UI-002, UI-004 note when these matter)

---

## Test Cases

### UAT-UI-001: Accordion is gone; "Show inactive" starts unchecked and inactive agents are hidden
- **Page**: `http://localhost:4321/`
- **Description**: The collapsible "Inactive Agents (N)" section at the top of the sidebar no longer exists. A "Show inactive" checkbox sits between the filter input and the project groups, unchecked by default.
- **Steps**:
  1. Load the page fresh.
  2. Look at the top of the left sidebar: filter input, then the checkbox, then project groups.
  3. Look for any "Inactive Agents" header or expand/collapse control.
  4. Scan the project groups for the inactive agent.
- **Expected Result**: One "Show inactive" checkbox, unchecked. No "Inactive Agents" section anywhere. Only active agents (and `error` agents) are listed; the inactive agent is not.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`renders an unchecked "Show inactive" checkbox by default…`, `AgentsPage renders the "Show inactive" checkbox only inside the sidebar…`)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "TASK-0181"`
- [SKIP: user confirmed working manually; not walked] <!-- 2026-09-19 -->

### UAT-UI-002: Checking "Show inactive" lists inactive agents inline in their project group; unchecking hides them
- **Page**: `http://localhost:4321/`
- **Description**: Inactive agents render as ordinary sidebar rows, inside their own project group and after that group's active rows.
- **Steps**:
  1. Check "Show inactive".
  2. Find the inactive agent in its project group. If you have a second project with an inactive agent, confirm it appears in that project's group, not in a shared section.
  3. Uncheck "Show inactive".
- **Expected Result**: Step 1–2: the inactive rows appear inline, each under its own project, after the active rows in that group. Step 3: they disappear again; active rows never move out of the list.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`checking "Show inactive" lists inactive agents inline, inside their project group…`)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "TASK-0181"`
- [SKIP: user confirmed working manually; not walked] <!-- 2026-09-19 -->

### UAT-UI-003: Inactive rows have a fixed red right border; active rows keep their per-status colour
- **Page**: `http://localhost:4321/` with "Show inactive" checked
- **Description**: Every inactive row (`no-window`, `exited`, `unknown`) gets the same red (`#e5484d`) 4px right border regardless of its specific status. `no-window` and `unknown` used to be grey.
- **Steps**:
  1. Check "Show inactive".
  2. Look at the right border of the `no-window` row (and the `exited` row, if you have one).
  3. Compare against an active row (idle/busy).
- **Expected Result**: Both inactive rows show the identical red right border (a `no-window` row is no longer grey). Active rows keep their status colour (not red). No layout shift when toggling the checkbox.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`paints a %s inline row with the fixed inactive red 4px right border…`, `paints an inline inactive row… with the same 4px right border as any other sidebar row`). Assertion is on the inline `border-right-color` style; the visual read here is the human confirmation.
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "TASK-0181"`
- [SKIP: user confirmed working manually; not walked] <!-- 2026-09-19 -->

### UAT-UI-004: An `error` agent is unaffected by the checkbox and keeps its red border
- **Page**: `http://localhost:4321/`
- **Description**: `error` is in both the active and inactive status sets. It is always listed (checkbox on or off), appears once, and its border is the same red as before.
- **Steps**:
  1. With "Show inactive" unchecked, find the `error` agent in its project group.
  2. Check "Show inactive".
- **Expected Result**: The error agent appears exactly once in both states, with the same red right border, in the same position. (Skip if you cannot produce an `error` agent; mark the reason.)
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`lists an error-status agent once in its project group without the checkbox…`)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "TASK-0181"`
- [SKIP: user confirmed working manually; not walked] <!-- 2026-09-19 -->

### UAT-UI-005: Cmd+Shift+Arrow cycling skips inactive agents when "Show inactive" is off
- **Page**: `http://localhost:4321/`
- **Description**: Cycling uses one list gated by the checkbox. With it off, only active agents (plus `error`) are in the cycle, and it wraps.
- **Steps**:
  1. Uncheck "Show inactive". Select an active agent in the sidebar.
  2. Press Cmd+Shift+Right repeatedly, through the last agent.
  3. Press Cmd+Shift+Left repeatedly, through the first.
- **Expected Result**: Selection walks the visible active agents in sidebar order, never landing on an inactive agent, and wraps from last to first (and first to last).
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`with "Show inactive" off, Shift+Cmd+Right skips inactive agents and wraps…`)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "TASK-0181"`
- [SKIP: user confirmed working manually; not walked] <!-- 2026-09-19 -->

### UAT-UI-006: Cycling includes inactive agents in sidebar order when "Show inactive" is on
- **Page**: `http://localhost:4321/` with "Show inactive" checked
- **Description**: With the checkbox on, inactive agents join the cycle in the same order the sidebar shows them, and the cycle wraps at both ends.
- **Steps**:
  1. Check "Show inactive". Select the first agent in the sidebar.
  2. Press Cmd+Shift+Right repeatedly, through the last row and beyond.
  3. Press Cmd+Shift+Left from the first row.
- **Expected Result**: Selection moves row by row down the sidebar, including inactive rows, and wraps at both ends. Prev/next buttons in the detail pane (if shown) match.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`with "Show inactive" on, cycling walks the sidebar order including inactive agents…`, `the prev/next buttons appear only when the cycle set has more than one agent…`)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "TASK-0181"`
- [SKIP: user confirmed working manually; not walked] <!-- 2026-09-19 -->

### UAT-UI-007: Selected inactive agent stays in the pane; unchecking makes the shortcut a no-op
- **Page**: `http://localhost:4321/`
- **Description**: A selection outside the current cycle set must not jump anywhere.
- **Steps**:
  1. Check "Show inactive" and click the inactive agent's row; its detail pane opens.
  2. Uncheck "Show inactive" (the row leaves the sidebar).
  3. Press Cmd+Shift+Right and Cmd+Shift+Left.
- **Expected Result**: The detail pane for that agent stays mounted. Neither shortcut changes the selection. Selecting any visible agent restores normal cycling.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`an inactive agent selected with "Show inactive" on stays selected but the shortcut becomes a no-op…`, `is a no-op for Shift+Cmd+Arrow when the selected agent turns %s while "Show inactive" is off`)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "TASK-0181"`
- [SKIP: user confirmed working manually; not walked] <!-- 2026-09-19 -->

### UAT-UI-008: Inactive agent's detail pane still offers wake and remove
- **Page**: `http://localhost:4321/` with "Show inactive" checked
- **Description**: The removed accordion's inline Wake/Remove buttons are gone by design. The detail pane's "Create window" and the actions menu's Destroy must still work as the replacement path.
- **Steps**:
  1. Check "Show inactive" and click a `no-window` agent's row.
  2. Confirm the inline row has no Wake/Remove buttons.
  3. In the detail pane, click "Create window" (or open the actions menu and confirm Destroy is listed; do not confirm destruction unless you want to remove it).
- **Expected Result**: No inline Wake/Remove on the row. "Create window" spawns the tmux window and the agent turns active (red border becomes its status colour; with the checkbox off the row stays because it is now active). Destroy is present in the actions menu.
- **Repeatable Unit Test**: Not applicable: exercises real tmux window spawn and host-server routes; the `AgentDetailView` actions themselves were not changed by this task.
- [SKIP: user confirmed working manually; not walked] <!-- 2026-09-19 -->

### UAT-EDGE-001: Empty-state copy with all agents inactive
- **Scenario**: Every registered agent is inactive (all windows closed).
- **Steps**:
  1. Close or stop all agent windows so every agent is `no-window`/`exited` (or use a fixture environment with only such agents).
  2. With "Show inactive" unchecked, read the sidebar.
  3. Check "Show inactive".
- **Expected Result**: Unchecked: "No active agents." Checked: the inactive agents are listed and the message disappears.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`shows "No active agents." when every registered agent is inactive and the checkbox is off…`)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "TASK-0181"`
- [x] Pass <!-- 2026-09-19 -->

### UAT-EDGE-002: Non-matching filter with "Show inactive" on
- **Scenario**: Text filter matches nothing while the checkbox is checked.
- **Steps**:
  1. Check "Show inactive".
  2. Type a string into the filter that matches no agent (e.g. `zzzzz`).
  3. Clear the filter.
- **Expected Result**: "No agents match your filter." (not "No active agents."); the checkbox stays checked. Clearing the filter restores all rows including the inactive ones.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`shows "No agents match your filter." for a non-matching filter with "Show inactive" on…`)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "TASK-0181"`
- [x] Pass <!-- 2026-09-19 -->
