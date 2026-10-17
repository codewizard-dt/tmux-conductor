---
id: agent-sidebar
title: AgentSidebar
aliases: [AgentSidebar, Agents page sidebar]
updated: 2026-09-20
sources:
  - ../../../raw/research/sidebar-hover-expand/index.md
  - ../../../raw/research/agents-page-sidebar-layout/index.md
confidence: extracted
tags: [frontend, component, sidebar, layout, agents-page]
---

# AgentSidebar

`AgentSidebar` in `frontend/src/components/AgentList.tsx` (~L1725-1789 as of 2026-09-20) — the left column of the Agents page introduced by ROADMAP-0023 (`derived_from::[[agents-page-sidebar-layout]]`). It renders `<aside aria-label="Agents" style={{ width: SIDEBAR_WIDTH_PX }} className="flex-shrink-0 overflow-y-auto border-r border-line bg-canvas/40 p-3">` containing the filter input, the docked `[[inactive-agents-panel]]` section, and project-grouped `AgentItem` rows (each a `role="button"` card with a 4 px status-colored right border from `getStatusColor`).

**Docked state:** fixed width (`SIDEBAR_WIDTH_PX = 320` in `frontend/src/lib/layoutConstants.ts`), a flex sibling of the detail region inside `AgentList`. Selection lives in `AgentList`'s `expandedAgent` state, passed down as `selectedAgentId`/`onExpand`. Width consumers: the inline `<aside>` style, `terminalSizeProbe.getProbeMount` (`left`), and the width-asserting tests (`AgentList.test.tsx`, `terminalSizeProbe.test.ts`) — see `uses::[[terminal-size-coupling-to-layout-width]]`.

**Minimize + hover flyout (built in TASK-0179, implemented, pending UAT)** — `derived_from::[[sidebar-hover-expand]]`, `uses::[[hover-expand-overlay-flyout-pattern]]`, `relates_to::[[TASK-0179]]`:
- **Toggle:** minimize button with `aria-expanded` and `aria-controls="agents-sidebar"`; state persisted in `localStorage` key `conductor:sidebarMinimized` (`SIDEBAR_MINIMIZED_STORAGE_KEY`); Cmd/Ctrl+B toggles it (on non-mac the shortcut is ignored inside `[data-terminal-capture]`).
- **Rail:** docked width `SIDEBAR_RAIL_WIDTH_PX = 56`; rows render as compact `AgentRailItem` (initial chip, status-colored right border, attention dot).
- **Flyout:** the full sidebar overlays the detail pane via `useHoverExpand` (`frontend/src/lib/useHoverExpand.ts`). Open delay 100 ms (450 ms when focus is in the detail pane, so a stray pointer doesn't steal terminal focus), close delay 250 ms; focus opens it, Esc closes and refocuses the toggle, selecting a row closes it. Docked width is unchanged on hover, so the terminal never resizes from hover.
- **Probe coupling:** `setSidebarDockedWidth` in `terminalSizeProbe.ts` moves the probe node and re-probes only when the docked width changes (the toggle), never on hover.
- **Sticky header:** toggle, filter and `[[inactive-agents-panel]]` (capped at 40vh) sit above a separately scrolling agent list.
- **Focus restore:** rail to flyout restores focus to the same row via `data-agent-id` + `useLayoutEffect`; flyout to rail restore is intentionally not done.

relates_to::[[log-tail]]
relates_to::[[hover-expand-overlay-flyout-pattern]]
