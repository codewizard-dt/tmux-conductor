---
id: TASK-0170
aliases: [TASK-0170]
title: "Build the AgentSidebar component grouping agents by project"
status: done
created: 2026-09-18
updated: 2026-10-17
depends_on: [TASK-0169]
blocks: [TASK-0171, TASK-0173, TASK-0177]
parallel_safe_with: []
uat: "[[UAT-0170]]"
tags: [frontend, agents-page, layout, navigation]
---

# TASK-0170 — Build the AgentSidebar component grouping agents by project

depends_on::[[TASK-0169]]
blocks::[[TASK-0171]]
blocks::[[TASK-0173]]
blocks::[[TASK-0177]]
relates_to::[[agents-page-sidebar-layout]]
relates_to::[[react-router-outlet-sidebar-layout]]

Roadmap: [[ROADMAP-0023]] Phase 1, item 2.

## Objective

Introduce a left-hand `AgentSidebar` that lists the active agents grouped under project headers (unassigned last), replacing the interim single-column stack [[TASK-0169]] left behind. The page becomes a two-column layout: sidebar on the left, a main content area on the right. Grouping reuses the existing `projectLabelFor` / `projectIdFor` semantics (project membership rides on every agent payload as `projectName`/`projectId`).

## Approach

- **Reuse `AgentItem` as the row.** Do not write a new row component: `AgentItem` already carries project badge, name, usage/type/role/status badges, label, context meter, branch, active task and the "Direct Input — needs you" CTA, and the existing tests exercise it through `AgentList`. Narrow-width pressure is already handled by its `flex-wrap` row-1. The status-colored right border is added to that same row by [[TASK-0171]].
- **Where it lives.** Define `AgentSidebar` inside `AgentList.tsx` (like `AgentItem` and `BgProcessSection`), not in a new file: it needs `AgentItem`, `groupByProject`, `byProjectThenStatus`, `STATUS_SORT` and would otherwise create an `AgentList.tsx` <-> `AgentSidebar.tsx` circular import.
- **Hoist the project helpers.** `projectLabelFor` / `projectIdFor` are currently closures declared inside the `AgentList` render body *after* the loading/error early returns. Hoist both to module-level pure functions of `Agent` so the sidebar, the render body and the detail wiring in later tasks share one definition. Behavior unchanged.
- **Selection is unchanged for now.** Row click still calls `setExpandedAgent({ id, armInteract })`, which still opens the existing `AgentDetailModal` overlay. [[TASK-0173]] swaps the overlay for the in-page detail pane; do not change selection semantics here so the app stays fully working after this task.
- **Filter moves into the sidebar.** The `Filter agents` text input (`filterText` state, `agentMatchesFilter`) moves from the page header to the top of the sidebar. State stays in `AgentList`; the sidebar receives `filterText` / `onFilterChange`.
- **Main area (interim).** Until [[TASK-0173]], the right column holds the `BgProcessSection` and `NotificationStack` as today. The `h1` "tmux Conductor — Agents" label and `SessionBanner` stay above the two columns. No layout task moves them yet.
- **Layout container.** `AgentsPage.tsx`'s `<main className="mx-auto flex max-w-[1280px] flex-col gap-6 px-6 py-8">` must stop capping width so the sidebar can sit flush left and the future detail pane can use the remaining width. Change it to a full-width, full-remaining-height container (NavBar is `h-12`, sticky) — e.g. `flex h-[calc(100vh-3rem)]`-style wrapper — keeping `AddAgentForm`, `AddBgProcessForm` and `InactiveAgentsPanel` renders exactly where they are (later tasks remove them). Sidebar: fixed width (~320px), `overflow-y-auto`, right border `border-line`.
- Group order and within-group order are exactly the current `byProjectThenStatus` (project name case-insensitive, unassigned last; then `STATUS_SORT` urgency; then name).
- Sidebar empty states reuse the current copy ("No agents registered.", "No agents match your filter.").

## Dependencies

- depends_on: [[TASK-0169]] (needs the column model gone and the interim grouped list to replace).
- blocks: [[TASK-0171]] (border on the sidebar row), [[TASK-0173]] (detail pane wiring targets the sidebar rows), [[TASK-0177]] (Inactive section docks at the top of this sidebar).
- File-overlap with `AgentsPage.tsx`: also edited by [[TASK-0173]], [[TASK-0175]], [[TASK-0176]], [[TASK-0177]] — the orchestrator must serialize those.

## Files

- `frontend/src/components/AgentList.tsx` — add `AgentSidebar`, hoist `projectLabelFor`/`projectIdFor`, two-column layout in `AgentList`'s return, move filter input.
- `frontend/src/pages/AgentsPage.tsx` — replace the `max-w-[1280px]` page wrapper with a full-width/full-height layout container (overlap with Phase 2 and Phase 3/4 tasks).
- `frontend/src/components/AgentList.test.tsx` — sidebar tests.
- `frontend/src/styles/global.css` — only if a sticky/scroll utility is needed and cannot be expressed with existing Tailwind classes (avoid if possible).

## Steps

### 1. Hoist project helpers <!-- agent: general-purpose -->

- [x] In `AgentList.tsx`, move `projectLabelFor(agent)` and `projectIdFor(agent)` out of the `AgentList` body to module level (same one-line bodies: `agent.projectName` / `agent.projectId`). Update the existing call sites (`renderTile`, the `AgentDetailModal` props) to use them.

### 2. Build AgentSidebar <!-- agent: general-purpose -->

- [x] Add `function AgentSidebar({ agents, filterText, onFilterChange, onExpand, totalAgentCount })` in `AgentList.tsx`. It renders `<aside aria-label="Agents">` containing: the filter `<input>` (same classes/placeholder/aria-label as today), then the project groups produced by sorting `agents` with `byProjectThenStatus` and clustering with `groupByProject`.
- [x] Each group: a project header (`group.project ?? 'Unassigned'`, same styling as the current sub-header) plus a small count, followed by `AgentItem` rows (`onExpand={(armInteract) => onExpand(agent.id, armInteract)}`).
- [x] Empty states: no agents at all → "No agents registered."; agents exist but none match → "No agents match your filter.".
- [x] `aside` styling: `w-[320px] flex-shrink-0 overflow-y-auto border-r border-line bg-canvas/40 p-3`.

### 3. Two-column layout <!-- agent: general-purpose -->

- [x] In `AgentList`'s return, replace the interim single-column stack from [[TASK-0169]] with `<div className="flex ...">` holding `<AgentSidebar .../>` and a `<div className="min-w-0 flex-1 overflow-y-auto p-5">` main area containing `BgProcessSection`. Keep `h1`, `SessionBanner`, `NotificationStack` and the `AgentDetailModal` render where they are.
- [x] Remove the now-relocated filter `<input>` from the old header position.
- [x] Change `AgentsPage.tsx`'s `<main>` wrapper to the full-width/full-height layout container described in Approach without moving or removing any of its children.

### 4. Tests and gates <!-- agent: general-purpose -->

- [x] Add tests in `AgentList.test.tsx`: agents from two projects plus one unassigned render under three headers in the expected order; filter input lives inside the `aside`; clicking a row still opens the detail modal (`getByRole('dialog')`); filtering to zero shows the no-match copy.
- [x] Run `npm test` and `npm run typecheck` in `frontend/` — clean. (178/178 tests pass; `tsc --noEmit` clean.)
- [ ] [DEFERRED-TO-UAT] Live check at desktop and ~1024px widths: sidebar flush left, independent scroll, no horizontal page scroll.
