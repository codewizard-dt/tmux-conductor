---
id: TASK-0177
aliases: [TASK-0177]
title: "Relocate InactiveAgentsPanel into a collapsible section at the top of the sidebar"
status: pending-uat
created: 2026-09-18
updated: 2026-09-18
depends_on: [TASK-0170]
blocks: [TASK-0178]
parallel_safe_with: []
uat: "[[UAT-0177]]"
tags: [frontend, agents-page, sidebar]
---

# TASK-0177 — Relocate InactiveAgentsPanel into a collapsible section at the top of the sidebar

depends_on::[[TASK-0170]]
blocks::[[TASK-0178]]
relates_to::[[agents-page-sidebar-layout]]
relates_to::[[inactive-agents-panel]]

Roadmap: [[ROADMAP-0023]] Phase 4, item 9.

## Objective

`InactiveAgentsPanel` is a full-width card rendered by `AgentsPage.tsx` beside the Add Agent button. Move it into the sidebar from [[TASK-0170]] as a collapsible section docked above the project groups, restyled to fit a ~320px column. Its collapse toggle (default collapsed), wake/remove actions and remove-confirmation stay as they are.

## Approach

- **Reuse the component, restyle it.** `InactiveAgentsPanel` already implements the target interaction (`collapsed` disclosure defaulting to `true`, count in the header, list of rows). Keep its logic (`handleWake`, `doRemoveInactive`, `ConfirmDialog`, `INACTIVE_STATUSES`) and change only presentation for the narrow column: drop the outer `rounded-card ... px-5 py-4 shadow-card` card chrome in favor of a sidebar-section look (a header row flush with the sidebar, `border-b border-line`), and make rows compact: project badge + name on the first line, status label on the second with the workdir hidden or truncated in a `title`, and the **Wake agent / Remove agent** buttons collapsed into a compact right-aligned pair (icon or short-label buttons, e.g. "Wake" / a trash icon with `aria-label="Remove agent <name>"`) so they do not force horizontal overflow.
- **Mounting.** Render `<InactiveAgentsPanel />` inside `AgentSidebar` between the filter input and the first project group, so the filter stays the first control. Remove `<InactiveAgentsPanel />` and its import from `AgentsPage.tsx`, along with the wrapper row [[TASK-0175]] left behind.
- **Data source.** Leave `useAgents()` as the panel's own data source (it already has its own fetch + SSE). Do not refactor it to a prop from `AgentList` here — that is a separate cleanup, and the panel keeps working without touching `AgentList`'s state. (Trade-off noted: two independent agent subscriptions on the page, as today.)
- **Row border.** For visual consistency, give inactive rows the same 4px status-colored right border via `getStatusColor(status)` used by [[TASK-0171]] (grey for `no-window`/`unknown`, red for `exited`/`error`).
- **`error` overlap preserved.** `error` remains in both the active list and `INACTIVE_STATUSES` (existing behavior; see [[TASK-0169]]); an errored agent appears in both sections. Do not change that here.
- **Import cycle check.** `InactiveAgentsPanel.tsx` already imports `deriveStatus`, `ProjectBadge`, `AgentDetailModal` and types from `AgentList.tsx`; mounting it inside `AgentList.tsx` makes the import bidirectional. All cross-module uses are at render time (function components and a const only read inside functions), so this is safe at runtime, but verify: run vitest and `npm run build` in `frontend/`, and any configured lint rule for import cycles. If a cycle rule fires or a temporal-dead-zone error appears, fall back to a slot: give `AgentSidebar` a `topSlot?: ReactNode` prop and have `AgentsPage` pass `<InactiveAgentsPanel />` through `AgentList`'s new `sidebarTop` prop (no cycle, at the cost of one extra prop).
- **Open-detail behavior is unchanged in this task**: rows still open the panel's own private `AgentDetailModal` instance (with its `stopPropagation` wrapper). [[TASK-0178]] repoints that to the pane.

## Dependencies

- depends_on: [[TASK-0170]] (the sidebar must exist).
- blocks: [[TASK-0178]].
- File-overlap: `AgentList.tsx`/`AgentList.test.tsx` with every Phase 1/2 task; `AgentsPage.tsx` with [[TASK-0170]], [[TASK-0173]], [[TASK-0175]], [[TASK-0176]]. Not ordered against Phase 2 by dependency — the orchestrator must serialize this with [[TASK-0172]]–[[TASK-0174]].

## Files

- `frontend/src/components/InactiveAgentsPanel.tsx` — compact sidebar-section restyle, status border.
- `frontend/src/components/AgentList.tsx` — render the panel at the top of `AgentSidebar` (or the `topSlot` fallback).
- `frontend/src/pages/AgentsPage.tsx` — remove `<InactiveAgentsPanel />` + import + leftover wrapper row.
- `frontend/src/components/AgentList.test.tsx` — sidebar contains the section.
- `frontend/src/components/InactiveAgentsPanel.test.tsx` — **new** (none exists today).

## Steps

### 1. Restyle for the sidebar <!-- agent: general-purpose -->

- [x] In `InactiveAgentsPanel.tsx`, replace the outer card classes with a sidebar-section container (no shadow/rounded card), keep the header button (`aria-expanded`, `▸/▾`, `Inactive Agents (N)`) and default `collapsed = true`.
- [x] Make rows compact per Approach (two-line name/status, workdir in `title`, compact Wake/Remove controls with `aria-label`s), add the right status border with `getStatusColor`, and ensure no horizontal scroll at 320px.
- [x] Keep `handleWake`, `doRemoveInactive`, `ConfirmDialog` and the private `AgentDetailModal` block untouched.

### 2. Relocate the mount <!-- agent: general-purpose -->

- [x] In `AgentList.tsx`'s `AgentSidebar`, render `<InactiveAgentsPanel />` between the filter input and the project groups. Import it at the top of the file.
- [x] In `AgentsPage.tsx`, remove `<InactiveAgentsPanel />`, its import, and any wrapper row/flex container that only existed to place it.
- [x] Verify the circular-import behavior as described in Approach; if it misbehaves, switch to the `sidebarTop` slot fallback. (Verified: vitest, tsc and `npm run build` clean, eslint reports no cycle rule; no fallback needed.)

### 3. Tests and gates <!-- agent: general-purpose -->

- [x] Create `InactiveAgentsPanel.test.tsx` (mock `useAgents`/`fetch`): collapsed by default showing the count; expanding lists only `no-window`/`exited`/`error`/`unknown` agents; Wake issues DELETE (if window present) then POST to `/agents/:id/window`; Remove shows the `ConfirmDialog` and DELETEs on confirm.
- [x] In `AgentList.test.tsx` add: the sidebar contains an "Inactive Agents" section above the first project group.
- [x] Folded-in gap (TASK-0170 UAT): sidebar renders "No active agents." when agents are registered but all inactive and the filter is empty (inactive section stays visible); test added. The TASK-0171 test asserting inactive rows have no status border was flipped to assert the 4px status border. <!-- Updated: 2026-09-18 23:15 -->
- [x] Run `npm test`, `npm run typecheck` and `npm run build` in `frontend/` — clean.
- [ ] [DEFERRED-TO-UAT] Live check: expand the section at desktop and ~1024px widths; verify layout, wake/remove affordances and no overflow. Waking or removing a real agent is a real side effect — flag rather than run unattended.
