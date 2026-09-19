---
id: inactive-agents-panel
title: InactiveAgentsPanel
aliases: [InactiveAgentsPanel.tsx]
updated: 2026-09-18
sources:
  - ../../../raw/research/agents-page-sidebar-layout/index.md
confidence: extracted
tags: [frontend, component, agents-page]
---

# InactiveAgentsPanel

`InactiveAgentsPanel` — `frontend/src/components/InactiveAgentsPanel.tsx:12-167`. Standalone card rendered on `AgentsPage` beside the "+ Add Agent" button, listing agents whose status is in `INACTIVE_STATUSES` (`no-window`/`exited`/`unknown`). Implements a `collapsed`/`setCollapsed` disclosure (default collapsed) with a `▸`/`▾` toggle row; each listed agent opens its own `derived_from::[[agent-detail-modal]]` instance on click, with independent prev/next (`navigateExpanded`) cycling scoped to just the inactive set. Also owns wake/remove row actions with their own busy/error/confirm state.

**2026-09-18, `derived_from::[[agents-page-sidebar-layout]]`**: identified as behaviorally reusable as-is for the requested "inactive agents in a collapsible section at the top of the sidebar" — the existing collapse pattern and per-row click-to-open behavior transfer directly; the only required change is relocating the component from its standalone `AgentsPage` card into the new sidebar's top slot, and re-pointing its "open detail" action at whatever detail-rendering mechanism (routed page vs. local state) the main Kanban-removal work adopts, instead of its own private `AgentDetailModal` instance.

relates_to::[[agents-page-sidebar-layout]]
relates_to::[[agent-detail-modal]]
