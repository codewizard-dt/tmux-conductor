---
id: TASK-0174
aliases: [TASK-0174]
title: "Preserve Cmd+Shift+Arrow cycling and notification-driven open/arm-interact against the pane selection"
status: pending-uat
created: 2026-09-18
updated: 2026-09-18
depends_on: [TASK-0173]
blocks: []
parallel_safe_with: []
uat: "[[UAT-0174]]"
tags: [frontend, agents-page, keyboard, notifications]
---

# TASK-0174 — Preserve Cmd+Shift+Arrow cycling and notification-driven open/arm-interact against the pane selection

depends_on::[[TASK-0173]]
relates_to::[[agents-page-sidebar-layout]]
relates_to::[[react-router-outlet-sidebar-layout]]

Roadmap: [[ROADMAP-0023]] Phase 2, item 6.

## Objective

After [[TASK-0173]] the selected agent renders in a pane rather than a modal. Verify and adjust the two behaviors that key off the selection so they work identically (plus one deliberate ordering change): Shift+Cmd/Ctrl+Left/Right cycling between agents, and notification-toast click opening an agent with Direct Input armed (`setExpandedAgent({ id, armInteract: true })`).

## Approach

Most of the mechanism survives untouched because [[TASK-0173]] kept `expandedAgent` as the selection state; this task is about confirming that and fixing what the layout change actually breaks.

1. **Cycling order = sidebar visual order (intentional behavior change).** Today `orderedAgentIds` sorts `activeAgents` by name globally. With a project-grouped sidebar, pressing the shortcut would jump around visually. Change the order to the sidebar's flat order: `activeAgents` sorted by `byProjectThenStatus` (project name, then status urgency, then name), computed from the **unfiltered** active list (preserving the documented "cycling ignores the text filter" guarantee — the test `next-agent navigation still reaches an agent hidden by the current filter` stays valid, with its expected neighbor re-derived under the new order). Rationale to record in the code comment: cycling should follow what the user sees. Status-urgency ordering means the order can shift as statuses change while the user is cycling; accept that (same as the sidebar reshuffling) rather than caching an order.
2. **Where the hotkey lives.** The document-level keydown handler is inside `AgentDetailView` (moved there by [[TASK-0172]]), mounted only while an agent is selected. Confirm it still fires, still ignores events targeting `TEXTAREA`/`INPUT`, and that Shift+Cmd/Ctrl+Arrow inside the xterm/LogTail terminal is not swallowed (TASK-141/TASK-149 history: the terminal handles bare Cmd/Ctrl+Arrow; Shift+Cmd+Arrow is reserved for switching). Do not register a second listener in `AgentList`.
3. **`handleNavigate` with a non-cycle selection.** `idx === -1` (selected agent not in the active list, e.g. an inactive agent opened later by [[TASK-0178]]) currently returns `prev`, making the shortcut a no-op. Keep that here; [[TASK-0178]] decides cycling scope for inactive agents.
4. **Prev/next buttons and `agentCount`.** The view's ⇧⌘←/→ buttons and `agentCount > 1` gating keep using `activeAgents.length`. Confirm they render in the pane header (the header uses `hidden sm:flex`; the pane is narrower than the modal, so check nothing wraps badly at ~1024px).
5. **Notification path.** `NotificationStack.onOpen` -> `setExpandedAgent({ id, armInteract: true })` now selects the row and mounts the view (keyed by id) with `armInteract: true`, so the view's mount effect forces the Terminal tab and `interactSignal = 1` arms Direct Input. Verify the two edge cases the keyed remount changes: (a) toast for the **already selected** agent — suppressed at fire time by `expandedAgentRef.current?.id === agentId`, unchanged; (b) toast click while a *different* agent is selected — remounts into the new agent with armInteract true. Also confirm the "Direct Input — needs you" CTA on a sidebar row (`onExpand(true)`) does the same.
6. The old wording "modal" in comments (`Modal state lives here...`, `expandedAgentRef` mirror comment, suppression comment) must be updated to "selected agent"/"detail pane" so the code does not lie.

## Dependencies

- depends_on: [[TASK-0173]].
- blocks: none.
- File-overlap: `AgentList.tsx` / `AgentList.test.tsx` with all other Phase 1/2/4 tasks; do not run concurrently with [[TASK-0177]] or [[TASK-0178]].

## Files

- `frontend/src/components/AgentList.tsx` — `orderedAgentIds` ordering, `handleNavigate` comment/behavior, stale "modal" comments; possibly the view's keydown effect if a fix is needed.
- `frontend/src/components/AgentList.test.tsx` — cycling and notification tests (existing ones at the `Shift+Cmd`/filtered-cycling and notification-toast describe blocks are updated, not deleted).

## Steps

### 1. Cycling order <!-- agent: general-purpose -->

- [x] In `AgentList`, derive `orderedAgentIds` from `[...activeAgents].sort(byProjectThenStatus)`; because `byProjectThenStatus` is currently a closure after the early returns (or module-level after [[TASK-0170]]), make sure it is a module-level function so the memo above the early returns can use it (Rules of Hooks: the `useMemo` must stay above the loading/error early returns). (already module-level; memo sits above the early returns)
- [x] Update the comment on `activeAgents`/`orderedAgentIds` to describe visual-order cycling and unfiltered scope.

### 2. Verify hotkey and notification behavior in the pane <!-- agent: general-purpose -->

- [x] Read the keydown effect in `AgentDetailView` and confirm the Escape branch is gone (belongs to the modal wrapper only) and the Shift+Cmd/Ctrl+Arrow branch is intact. Fix if [[TASK-0172]] regressed it. (Verified intact; `LogTail.mapKey` returns null for Shift+Cmd/Ctrl+Arrow so the terminal does not stopPropagation it.)
- [x] Manually trace `NotificationStack.onOpen`, the row CTA (`onExpand(true)`), and the `agent-update` grace-timer suppression against the keyed remount; fix any stale-closure issue found (the refs `expandedAgentRef`/`agentsRef` should already cover it). (No stale closure found; covered by tests.)
- [x] Reword the stale "modal" comments listed in Approach item 6.

### 3. Tests and gates <!-- agent: general-purpose -->

- [x] Update the cycling tests: with agents `alpha` (project A), `bravo` (project B), `charlie` (project A), pressing Shift+Cmd+Right from the first A agent moves to the next agent in **sidebar order** (A's agents by status then name, then B), wraps at the end, and Left wraps backwards. Re-derive the filtered-cycling test's expected neighbor under the new order; it must still reach an agent hidden by the filter.
- [x] Keep/adjust the OS-aware shortcut test (Shift+Cmd on Mac, Shift+Ctrl elsewhere).
- [x] Add/adjust notification tests: clicking a toast selects that agent's row, shows the Terminal tab and arms Direct Input (LogTail receives `interactSignal` 1); a toast for the currently selected agent is suppressed.
- [x] Run `npm test` and `npm run typecheck` in `frontend/` — clean.
- [ ] [DEFERRED-TO-UAT] Live check: cycle with Shift+Cmd+Arrow across a multi-project set and confirm the highlighted sidebar row follows; trigger an awaiting agent, click its toast, confirm Direct Input is armed.
