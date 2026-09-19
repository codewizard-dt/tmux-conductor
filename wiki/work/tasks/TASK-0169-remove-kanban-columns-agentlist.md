---
id: TASK-0169
aliases: [TASK-0169]
title: "Remove the 3 Kanban status columns and their partition logic from AgentList"
status: pending-uat
created: 2026-09-18
updated: 2026-09-18
depends_on: []
blocks: [TASK-0170, TASK-0172]
parallel_safe_with: [TASK-0175]
uat: "[[UAT-0169]]"
tags: [frontend, agents-page, layout]
---

# TASK-0169 — Remove the 3 Kanban status columns and their partition logic from AgentList

blocks::[[TASK-0170]]
blocks::[[TASK-0172]]
relates_to::[[agents-page-sidebar-layout]]
relates_to::[[react-router-outlet-sidebar-layout]]

Roadmap: [[ROADMAP-0023]] Phase 1, item 1.

## Objective

`AgentList` (`frontend/src/components/AgentList.tsx`) renders agents as a 3-column Kanban board (`Waiting / Stalled`, `Busy`, `Ready / No tasks`). Delete the column model — the `Column` interface, the `COLUMNS` constant, `columnFor()`, the `columnAgents` partition in the render body and the `COLUMNS.map(...)` 3-column grid — so status is no longer a layout axis. This is the removal half of the Kanban-to-sidebar refactor; the sidebar itself is built by [[TASK-0170]].

## Approach

**Nothing else may depend on the column model when it goes.** `columnFor()` has one non-render consumer: `activeAgents` (used for Cmd+Shift+Arrow cycling and the `agentCount` prop), where `columnFor(deriveStatus(a)) !== null` doubles as "is this agent active (not exited/no-window/unknown)". Replace that with an explicit `isActiveStatus(status)` helper defined in `AgentList.tsx` with the **same** membership as the union of the old column `statuses` (`awaiting, stalled, error, busy, starting, idle, idle-waiting, empty`) so cycling behavior is byte-identical. Note `error` is intentionally in both this set and `INACTIVE_STATUSES` in `InactiveAgentsPanel.tsx` today (an errored agent shows in both places) — preserve that overlap, do not resolve it here.

**Keep the project-grouping helpers.** "Partition/sort logic" means the by-status partition. `byProjectThenStatus`, `STATUS_SORT` and `groupByProject` are exactly what [[TASK-0170]] reuses for the sidebar, so they stay. To keep the page usable in the window between this task and TASK-0170, render the filtered active agents as a **single-column stack** of the existing `AgentItem` cards, grouped by project via `groupByProject` (same sub-headers as today, just no columns). This interim layout is replaced wholesale by TASK-0170.

Do not touch `AgentDetailModal`, `InactiveAgentsPanel` or `AgentsPage.tsx` here.

## Dependencies

- depends_on: none.
- blocks: [[TASK-0170]] (sidebar builds on the flat grouped list), [[TASK-0172]] (extraction edits the same file and needs the column model gone first).
- parallel_safe_with: [[TASK-0175]] (NavBar/AgentsPage only; no shared file).
- File-overlap (ordering enforced by the deps above): every Phase 1 and Phase 2 task edits `AgentList.tsx`.

## Files

- `frontend/src/components/AgentList.tsx` — delete `Column`, `COLUMNS`, `columnFor`, `columnAgents` partition and the 3-column grid; add `isActiveStatus`; single-column interim render.
- `frontend/src/components/AgentList.test.tsx` — refresh two stale comments that mention `columnFor()`/kanban (around the `exited` STATUS_CONFIG test and the BgProcessSection heading test); add regression coverage described below.

## Steps

### 1. Replace the column dependency <!-- agent: general-purpose -->

- [x] In `AgentList.tsx`, add an exported-or-module-level `isActiveStatus(status: AgentStatus): boolean` returning true for exactly `awaiting, stalled, error, busy, starting, idle, idle-waiting, empty`. Place it next to `STATUS_SORT` (where `COLUMNS` lived).
- [x] In the `AgentList` component, change `activeAgents` from `columnFor(deriveStatus(a)) !== null` to `isActiveStatus(deriveStatus(a))`. Confirm via `find_referencing_symbols` on `columnFor` that this was its only non-render call site before deleting it.

### 2. Delete the column model and render a single-column interim list <!-- agent: general-purpose -->

- [x] Delete `interface Column`, `const COLUMNS`, and `function columnFor`.
- [x] Delete the `columnAgents` record, its partitioning `for` loop and the per-key `.sort(byProjectThenStatus)` loop in the render body.
- [x] Replace the `<div className="grid grid-cols-1 gap-4 md:grid-cols-3">{COLUMNS.map(...)}</div>` block with a single wrapper that sorts `filteredAgents.filter(isActiveStatus-derived)` using `byProjectThenStatus`, feeds it to `groupByProject`, and renders each group's project sub-header + `renderTile(agent)` (the exact inner markup the old column body used). Keep the existing "No agents registered." / "No agents match your filter." empty states.
- [x] Confirm via `search_for_pattern` that `COLUMNS`, `columnFor` and `Column[` have zero remaining references in `frontend/src`.

### 3. Tests and gates <!-- agent: general-purpose -->

- [x] Update the two stale comments in `AgentList.test.tsx` (search `columnFor` and `kanban`) to reference `isActiveStatus` / the interim list.
- [x] Add a test: with agents in `busy`, `idle`, `awaiting` and `exited` statuses, the rendered board shows the first three and not the exited one, and there are no `Waiting / Stalled` / `Busy` / `Ready / No tasks` column headings in the DOM.
- [x] Keep the existing "next-agent navigation still reaches an agent hidden by the current filter" test green (cycling set is unchanged).
- [x] Run `npm test` and `npm run typecheck` in `frontend/` — clean. (156/156 tests pass; `tsc --noEmit` reports only two unused-import errors in `NavBar.test.tsx`, owned by concurrent TASK-0175 — none in AgentList files.)
- [ ] [DEFERRED-TO-UAT] Live check: `make dev`, open the Agents page, confirm agents render as one project-grouped column with no Kanban headings.
