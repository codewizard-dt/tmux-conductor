---
id: TASK-0178
aliases: [TASK-0178]
title: "Repoint InactiveAgentsPanel's open-detail action at the detail pane and retire the modal wrapper"
status: pending-uat
created: 2026-09-18
updated: 2026-09-18
depends_on: [TASK-0173, TASK-0177]
blocks: []
parallel_safe_with: []
uat: "[[UAT-0178]]"
tags: [frontend, agents-page, sidebar, cleanup]
---

# TASK-0178 — Repoint InactiveAgentsPanel's open-detail action at the detail pane and retire the modal wrapper

depends_on::[[TASK-0173]]
depends_on::[[TASK-0177]]
relates_to::[[agents-page-sidebar-layout]]
relates_to::[[inactive-agents-panel]]
relates_to::[[agent-detail-modal]]

Roadmap: [[ROADMAP-0023]] Phase 4, item 10.

## Objective

`InactiveAgentsPanel` still opens a private `AgentDetailModal` (its own `expandedId` state and `navigateExpanded`). Replace that with the pane selection from [[TASK-0173]]: clicking an inactive row selects that agent in `AgentList`, and the detail renders in the main area like any other agent. Then `AgentDetailModal` has no remaining consumer and is removed.

## Approach

- **New prop.** `InactiveAgentsPanel` gains `onOpenDetail: (agentId: number) => void`. The row `onClick` calls it instead of `setExpandedId`. `AgentList` passes `(id) => setExpandedAgent({ id, armInteract: false })`. Delete from the panel: `expandedId` state, `expandedAgent` lookup, `navigateExpanded`, the `stopPropagation` wrapper `div` and the `AgentDetailModal` render (plus the now-unused `AgentDetailModal` import). The panel's header toggle/`stopPropagation` handling for rows and buttons stays.
- **The selected agent may be inactive.** After [[TASK-0173]] the pane resolves the selected id against `AgentList`'s full `agents` state (not only active agents), so an `exited`/`no-window`/`unknown`/`error` agent renders in the pane with the view's existing "Create window" affordance. Confirm the view is usable for windowless agents: Terminal tab with no tmux window (LogTail must not throw), Details tab showing `Details •` and the "Create window" button. Fix anything that assumes a live window.
- **Selected-row highlight.** Highlight the selected inactive row (same `aria-current`/ring treatment [[TASK-0173]] gives active rows).
- **Cycling scope for inactive selection.** `handleNavigate` currently returns `prev` when the selected id is not in the active ordering ([[TASK-0174]]), making Shift+Cmd+Arrow a no-op on an inactive agent. Decision: keep the old `InactiveAgentsPanel` behavior — when the selection is an inactive agent, cycle **within the inactive list** (sidebar order, non-wrapping, as `navigateExpanded` did); when active, cycle within the active list. Implement by computing `orderedInactiveIds` in `AgentList` (using the same `INACTIVE_STATUSES` predicate, exported from `InactiveAgentsPanel.tsx` or hoisted into `AgentList.tsx` next to `isActiveStatus`) and choosing the list containing the selected id. The view's `agentCount` becomes the length of that list. An `error` agent belongs to both sets today; treat the active list as authoritative for it.
- **Remove the modal wrapper.** With `InactiveAgentsPanel` repointed, grep `find_referencing_symbols` on `AgentDetailModal`: the only remaining references should be its tests. Delete the exported `AgentDetailModal` wrapper from `AgentList.tsx` (created by [[TASK-0172]]) and the overlay-only wrapper tests (dialog role, backdrop click, Escape-closes, body scroll lock). `terminalSizeProbe.ts` then has no overlay geometry left to mirror — confirm [[TASK-0173]]'s pane-based probe is the only path and remove any stale modal wording in `terminalSizeProbe.ts`/`.test.ts` comments. The `agent-detail-modal` wiki entity page will be stale after this; refresh it through the normal update-docs flow and mention it in the completion notes (out of scope for the code steps here).

## Dependencies

- depends_on: [[TASK-0173]] (pane selection mechanism), [[TASK-0177]] (panel lives in the sidebar).
- blocks: none.
- File-overlap: `AgentList.tsx`/`AgentList.test.tsx` with every Phase 1/2 task; `InactiveAgentsPanel.tsx` with [[TASK-0177]] (ordered by dependency). Do not run concurrently with [[TASK-0174]].

## Files

- `frontend/src/components/InactiveAgentsPanel.tsx` — add `onOpenDetail`, remove private modal state/render, selected highlight.
- `frontend/src/components/AgentList.tsx` — pass `onOpenDetail`, inactive-aware cycling, delete `AgentDetailModal` wrapper.
- `frontend/src/components/AgentList.test.tsx` — inactive selection/cycling tests; delete wrapper-only overlay tests.
- `frontend/src/components/InactiveAgentsPanel.test.tsx` — from [[TASK-0177]]; add `onOpenDetail` test.
- `frontend/src/lib/terminalSizeProbe.ts`, `frontend/src/lib/terminalSizeProbe.test.ts` — comment cleanup only, if stale modal references remain.

## Steps

### 1. Repoint the panel <!-- agent: general-purpose -->

- [x] Add `onOpenDetail` to `InactiveAgentsPanel`'s props; row `onClick` -> `onOpenDetail(a.id)`. Delete `expandedId`, `expandedAgent`, `navigateExpanded`, the `AgentDetailModal` render + `stopPropagation` wrapper, and the unused import. Add a `selectedId?: number | null` prop and highlight the matching row.
- [x] In `AgentList.tsx`, render the panel with `onOpenDetail={(id) => { setExpandedAgent({ id, armInteract: false }) }}` and `selectedId={expandedAgent?.id ?? null}`.

### 2. Make the pane and cycling work for inactive agents <!-- agent: general-purpose -->

- [x] Verify (and fix if needed) that `AgentDetailView` renders for an agent with `windowPresent: false` / status `exited` without errors and shows the Create-window path.
- [x] Add `orderedInactiveIds` and update `handleNavigate`/`agentCount` per Approach so cycling stays inside the selected agent's set; non-wrapping within the inactive set.

### 3. Retire AgentDetailModal <!-- agent: general-purpose -->

- [x] Confirm via `find_referencing_symbols` that only tests reference `AgentDetailModal`; delete the wrapper and its overlay-only tests; keep all `AgentDetailView` tests.
- [x] Scrub stale "modal" wording in `AgentList.tsx`, `terminalSizeProbe.ts` and its test where it now describes nothing.

### 4. Tests and gates <!-- agent: general-purpose -->

- [x] Add tests: clicking an inactive row selects it and the pane renders that agent (no `role="dialog"`); the row is `aria-current`; Shift+Cmd+Right from an inactive agent moves to the next inactive agent and stops at the end; from an active agent it still cycles the active list.
- [x] Run `npm test`, `npm run typecheck` and `npm run build` in `frontend/` — clean. (258/258 tests, `tsc --noEmit` clean, `vite build` OK.)
<!-- Updated: 2026-09-18 23:26 -->
<!-- Completion notes: `AgentDetailModal` and `AgentDetailView`'s `onInteractingChange` prop deleted (no consumer). `isInactiveStatus` exported from AgentList.tsx; the panel imports it. Cycling from an inactive agent stays inside the inactive list (non-wrapping); `error` agents use the active list. The `agent-detail-modal` wiki entity page is now stale — refresh via update-docs. Test describe titles in AgentList.test.tsx still say "AgentDetailModal ..." for view-level suites (kept to preserve UAT cross-references). -->
<!-- Pre-existing, not touched: clicking Confirm/Cancel in the panel's ConfirmDialog bubbles to the panel's onClick and collapses the section. -->
<!-- Observed: AgentList.test.tsx lint errors at ~661/816/2212 predate this task. -->
<!-- Sub-step note: the [DEFERRED-TO-UAT] live check remains below. -->

- [ ] [DEFERRED-TO-UAT] Live check: expand Inactive Agents, click an exited agent, confirm the pane shows it with "Create window"; cycle with the shortcut; waking it (real side effect) is flagged, not run unattended.
