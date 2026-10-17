---
id: UAT-0183
aliases: [UAT-0183]
title: "UAT: Sort the agent sidebar alphabetically by default with drag-to-reorder persisted in localStorage"
status: passed
task: TASK-0183
created: 2026-09-19
updated: 2026-09-19
---

# UAT-0183 — UAT: Sort the agent sidebar alphabetically by default with drag-to-reorder persisted in localStorage

implements::[[TASK-0183]]

> **Source task**: [[TASK-0183]]
> **Generated**: 2026-09-19
> **Scope**: automatable cases only, at the user's request — every case below is backed by an existing repeatable unit test (no UI / manual-browser cases). All commands are run **from the repo root** (they `cd frontend` first).

---

## Prerequisites

- [ ] Dependencies installed (`frontend/node_modules` present; `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` resolve)
- [ ] No dev server needed — the tests run under vitest/jsdom

## Not covered by this UAT (deliberately excluded — needs a live browser)

Real pointer drag with the 6px activation threshold, suppression of the trailing click after a drag, persistence across a real page reload, and Cmd+Shift+Arrow cycling in a live `make dev` session. jsdom cannot drive dnd-kit pointer sensors, so the component tests invoke the captured `onDragEnd` handler directly. Use `/uat-walk` with an added manual case if these need a verdict.

---

## Test Cases

### UAT-EDGE-001: Pure ordering — A–Z default, saved-order precedence, appended new agents, stale ids ignored
- **Scenario**: `orderAgents(agents, saved)` with no saved order sorts A–Z case-insensitively; saved-order members come first in saved order; agents missing from the saved list follow alphabetically; saved ids with no matching agent are ignored; neither input is mutated.
- **Steps**: Run the unit test command.
- **Expected Result**: All 5 `orderAgents (TASK-0183)` tests pass.
- **Repeatable Unit Test**: Created: `frontend/src/lib/agentOrder.test.ts` (describe `orderAgents (TASK-0183)`)
- **Unit Test Command**: `cd frontend && npx vitest run src/lib/agentOrder.test.ts -t "orderAgents"`
- [x] Pass <!-- 2026-09-19 -->

### UAT-EDGE-002: Pure reorder — move down/up, no-ops, hidden members and other groups preserved
- **Scenario**: `reorderGroup(fullGroupIds, activeId, overId, saved)` moves an item down or up within the full group; returns the saved list unchanged for equal or missing ids; keeps hidden group members in their relative positions; preserves other groups' ids already in `saved`.
- **Steps**: Run the unit test command.
- **Expected Result**: All 6 `reorderGroup (TASK-0183)` tests pass.
- **Repeatable Unit Test**: Created: `frontend/src/lib/agentOrder.test.ts` (describe `reorderGroup (TASK-0183)`)
- **Unit Test Command**: `cd frontend && npx vitest run src/lib/agentOrder.test.ts -t "reorderGroup"`
- [x] Pass <!-- 2026-09-19 -->

### UAT-EDGE-003: localStorage helpers — validation, round-trip, clear, and failure tolerance
- **Scenario**: `loadOrder` returns `[]` for a missing key, malformed JSON and non-array JSON, and drops non-integers/duplicates (first occurrence kept); `saveOrder`/`loadOrder` round-trip under `conductor:agentOrder`; `clearOrder` removes the key; neither `loadOrder` nor `saveOrder` throws when `localStorage.getItem`/`setItem` throws.
- **Steps**: Run the unit test command.
- **Expected Result**: All 8 `loadOrder / saveOrder / clearOrder (TASK-0183)` tests pass.
- **Repeatable Unit Test**: Created: `frontend/src/lib/agentOrder.test.ts` (describe `loadOrder / saveOrder / clearOrder (TASK-0183)`)
- **Unit Test Command**: `cd frontend && npx vitest run src/lib/agentOrder.test.ts -t "loadOrder / saveOrder / clearOrder"`
- [x] Pass <!-- 2026-09-19 -->

### UAT-EDGE-004: Sidebar rows are A–Z within a project regardless of status
- **Scenario**: Status urgency no longer sorts. Within a project group, a `busy` agent named `zeta` renders after an `idle` `alpha`, and mixed-case names order case-insensitively (`apple` before `Banana`) whatever their status.
- **Steps**: Run the unit test command.
- **Expected Result**: Both matching tests pass (the rewritten within-group-order test and the new busy-zeta/idle-alpha test).
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`orders rows within a project group alphabetically and case-insensitively, regardless of status`; `TASK-0183: renders agents A-Z within a project regardless of status`)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "regardless of status"`
- [x] Pass <!-- 2026-09-19 -->

### UAT-EDGE-005: A saved order present before mount is honoured on first render
- **Scenario**: With `localStorage['conductor:agentOrder']` set before the component mounts, the first render shows the group in the saved order rather than A–Z.
- **Steps**: Run the unit test command.
- **Expected Result**: The test passes.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`TASK-0183: honours a saved order in localStorage that is present before mount on first render`)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "honours a saved order"`
- [x] Pass <!-- 2026-09-19 -->

### UAT-EDGE-006: A newly-appearing agent lands after the saved-order members of its group
- **Scenario**: An agent whose id is not in the saved order renders after the saved-order members of its group (then alphabetical among unsaved agents).
- **Steps**: Run the unit test command.
- **Expected Result**: The test passes.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`TASK-0183: renders a newly-appearing agent (id not in the saved order) after the saved-order members of its group`)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "newly-appearing agent"`
- [x] Pass <!-- 2026-09-19 -->

### UAT-EDGE-007: Drag end reorders the DOM and persists; a drop with no target is a no-op
- **Scenario**: Invoking the group's `onDragEnd` with `{ active, over }` reorders the rendered rows and writes the new id order to `localStorage['conductor:agentOrder']`; invoking it with `over: null` changes nothing and writes nothing.
- **Steps**: Run the unit test command.
- **Expected Result**: Both tests pass.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`TASK-0183: a drag end reorders the group in the DOM and persists the new order to localStorage`; `TASK-0183: a drop with no target (over: null) changes nothing and writes nothing`)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "a drag end reorders|drop with no target"`
- [x] Pass <!-- 2026-09-19 -->

### UAT-EDGE-008: A drag in one project does not change another project's order
- **Scenario**: Reordering within project A leaves project B's row order untouched (each project group has its own `DndContext`/`SortableContext`).
- **Steps**: Run the unit test command.
- **Expected Result**: The test passes.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`TASK-0183: a drag in one project does not change another project's order`)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "does not change another project"`
- [x] Pass <!-- 2026-09-19 -->

### UAT-EDGE-009: Reordering while a filter hides a member preserves that member's position
- **Scenario**: With the filter hiding one member of a group, a drop among the visible rows must not disturb the hidden member's relative position; verified after clearing the filter (a visible-only reorder would give a different result).
- **Steps**: Run the unit test command.
- **Expected Result**: The test passes.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`TASK-0183: reordering while the filter hides a group member preserves that member's relative position`)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "filter hides a group member"`
- [x] Pass <!-- 2026-09-19 -->

### UAT-EDGE-010: "Reset to A–Z" appears only with a custom order and restores A–Z
- **Scenario**: The "Reset to A–Z" button is absent with no saved order, appears after a reorder, and clicking it restores alphabetical order and removes the storage key.
- **Steps**: Run the unit test command.
- **Expected Result**: The test passes.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`TASK-0183: "Reset to A–Z" is absent without a saved order, appears after a reorder, and clicking it restores A-Z and clears storage`)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "Reset to A"`
- [x] Pass <!-- 2026-09-19 -->

### UAT-EDGE-011: A plain click on a sortable row still selects the agent (logic level)
- **Scenario**: Wrapping rows in the sortable wrapper (listeners only, no `attributes`) must not break click-to-select: a plain click opens the detail pane. This verifies the click handler wiring only; the real 6px pointer-activation threshold is excluded (see "Not covered").
- **Steps**: Run the unit test command.
- **Expected Result**: The test passes.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`TASK-0183: a plain click on a sortable row still selects the agent and opens the detail pane`)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "plain click on a sortable row"`
- [x] Pass <!-- 2026-09-19 -->

### UAT-EDGE-012: Rendering survives a throwing localStorage
- **Scenario**: When `localStorage.getItem` throws (private browsing / blocked storage), the sidebar still renders A–Z without throwing.
- **Steps**: Run the unit test command.
- **Expected Result**: The test passes.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`TASK-0183: renders A-Z without throwing when localStorage.getItem throws`)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "getItem throws"`
- [x] Pass <!-- 2026-09-19 -->

### UAT-EDGE-013: Cmd+Shift+Arrow cycling follows a custom (dragged) order
- **Scenario**: After a reorder, Shift+Cmd+Arrow cycling walks the custom order, not alphabetical — the cycle list and the sidebar share `sortAgentsForSidebar`, so they cannot drift.
- **Steps**: Run the unit test command.
- **Expected Result**: The test passes.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`TASK-0183: Shift+Cmd+Arrow follows a dragged custom order, not alphabetical`)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "follows a dragged custom order"`
- [x] Pass <!-- 2026-09-19 -->

### UAT-EDGE-014: Default cycling order is alphabetical within a project and wraps
- **Scenario**: With no saved order, Shift+Cmd+Right walks the sidebar's alphabetical order (then the next project) and wraps at the end; Left wraps backwards.
- **Steps**: Run the unit test command.
- **Expected Result**: The test passes.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`Shift+Cmd+Right walks the sidebar order (alphabetical within a project…)`, rewritten from the status-urgency version)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "Shift\+Cmd\+Right walks the sidebar order"`
- [x] Pass <!-- 2026-09-19 -->

### UAT-EDGE-015: "Show inactive" rows sort alphabetically among their group's rows
- **Scenario**: Checking "Show inactive" lists inactive agents inline, alphabetically among the group's active rows (no longer forced after the active ones); unchecking hides them again.
- **Steps**: Run the unit test command.
- **Expected Result**: The test passes.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`checking "Show inactive" lists inactive agents inline, inside their project group and alphabetically among that group's active rows; unchecking hides them again (TASK-0181, TASK-0183)`)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "lists inactive agents inline"`
- [x] Pass <!-- 2026-09-19 -->
