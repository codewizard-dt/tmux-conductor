---
id: agents-page-sidebar-layout
title: Agents Page Sidebar Layout Refactor Research
aliases: [Agents Page Sidebar Layout]
updated: 2026-09-20
sources:
  - ../../../raw/research/agents-page-sidebar-layout/index.md
confidence: extracted
tags: [frontend, layout, kanban, sidebar, agents-page]
---

# Agents Page Sidebar Layout Refactor Research

Research backing a roadmap to replace the Agents page's three-column Kanban board with a project-grouped sidebar (status shown via a colored right border) and to relocate `derived_from::[[agent-detail-modal]]`'s content from a full-viewport overlay into the main content area — a routed or state-driven "list + detail pane" layout.

**The three ingredients the refactor needs already exist**, so the work is almost entirely removal/re-plumbing rather than new build: per-agent `projectName`/`projectId` fields already drive a sort comparator (`byProjectThenStatus`, `AgentList.tsx:2005`) that can become a group-by step instead; `STATUS_CONFIG`/`getStatusColor()` (`AgentList.tsx:89-105`) already maps every `AgentStatus` to a single hex dot color, ready to hand to a `border-right-color`; and `AgentDetailModal` (`AgentList.tsx:588` onward) is self-contained enough (all its own state/effects, fetches keyed only on `agent.id`) to relocate into a non-overlay container with modest changes — chiefly dropping its `document.body.style.overflow` lock effect and reconsidering its global-`Escape`-closes-modal listener for a non-overlay context.

> **Superseded detail (2026-09-19, TASK-0183):** the sort comparator `byProjectThenStatus` described above (project, then status urgency via `STATUS_SORT`, then name) no longer exists. The sidebar now orders project groups A–Z (unassigned last) with `byProject`, and orders agents within a group via `sortAgentsForSidebar`/`orderAgents` in `frontend/src/lib/agentOrder.ts` — alphabetical by default, with a drag-to-reorder custom order persisted in `localStorage['conductor:agentOrder']`. Status is conveyed only by the right border and badge, not by row position. The paragraph above is kept as the research-time snapshot.

The app already ships `react-router-dom` v7.17 with a conventional (non-data-router) `<Routes>/<Route>` tree (`/`, `/projects`, `/projects/:id`, `/history`) and no existing `/agents/:id` route. React Router's own tutorial documents exactly this target shape — a `layout` route rendering a sidebar plus `<Outlet>`, with an `index` route to avoid a blank detail pane when nothing is selected (`uses::[[react-router-outlet-sidebar-layout]]`) — expressible with the same `<Routes>/<Route>` API already in this app, without adopting the newer loader-based `RouteConfig` style. Keyboard cycling (Cmd+Shift+Arrow) and "open via SSE notification" currently key off local `expandedAgent` state with ref-mirrors to dodge stale closures; this is the trickiest part to preserve regardless of whether "selected agent" ends up as a route param or stays local state.

**Scope addendum** (added mid-research): three more relocations turned out to be small deltas on existing components. `NavBar.tsx` (`derived_from::[[nav-bar]]`) already exists as a top bar with a right-aligned button slot, ready to host "Add Agent"/"Add Background Process" triggers. `AddAgentForm` is already modal-shaped (`open`/`onClose` props); only its trigger needs to move into `NavBar`. `AddBgProcessForm` (`derived_from::[[add-bg-process-form]]`) is currently an always-rendered inline card with no `open`/`onClose` props — becoming a modal is a real small change, mirroring `AddAgentForm`'s existing pattern. `InactiveAgentsPanel` (`derived_from::[[inactive-agents-panel]]`) already implements the exact target interaction — a `collapsed` disclosure toggle, default collapsed, listing agents that each open a detail view on click — so relocating it into a collapsible section docked at the top of the new sidebar reuses its behavior wholesale; only its "open detail" call needs to point at whatever mechanism the main refactor adopts instead of its private `AgentDetailModal` instance.

## Collapsible sidebar

**Added 2026-09-20 (TASK-0201):** the sidebar (`AgentSidebar` in `frontend/src/components/AgentList.tsx`) can now collapse from its expanded 320px width (`SIDEBAR_WIDTH_PX`) to a 48px rail (`SIDEBAR_COLLAPSED_WIDTH_PX`) of status-colored `SidebarRailDot` buttons — name tooltip, click selects the agent, ordered by `sortAgentsForSidebar`. The filter input, "Show inactive" checkbox, "Reset to A–Z" link, project headers and drag-to-reorder exist only in the expanded layout. There is deliberately no keyboard shortcut, to avoid clashing with the terminal's key capture and the Cmd+Shift+Arrow agent cycling.

- **State:** `frontend/src/lib/sidebarState.ts` holds the persisted flag (`localStorage['conductor:sidebarCollapsed']`, default expanded, wrapped in try/catch like `agentOrder.ts`) plus a module-level current width read via `getSidebarWidthPx()`. `layoutConstants.ts` stays import-free so it does not recreate the `AgentList → LogTail → terminalSizeProbe` import cycle.
- **Coupling to the terminal size probe:** `terminalSizeProbe.ts` reads `getSidebarWidthPx()` on every probe to position its hidden measurement node, and the toggle calls `reprobeTerminalSize()` (400ms trailing debounce, shared with the window-resize listener). Each toggle therefore re-syncs and resizes every agent's tmux window globally, not just the visible one; `LogTail` refits its xterm via its `ResizeObserver`.
- **Verification:** live browser/tmux verification is deferred to UAT.

relates_to::[TASK-0201](../../work/tasks/TASK-0201-collapsible-agent-sidebar.md)

relates_to::[[agent-detail-modal]]
relates_to::[[nav-bar]]
relates_to::[[inactive-agents-panel]]
relates_to::[[add-bg-process-form]]
relates_to::[[react-router-outlet-sidebar-layout]]
