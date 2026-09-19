---
id: agent-modal-actions-dropdown
title: Collapsing Agent Modal Actions into a Dropdown + Adding Clone
aliases: [Agent Modal Actions Dropdown]
updated: 2026-09-13
sources:
  - ../../raw/research/agent-modal-actions-dropdown/index.md
confidence: extracted
tags: [frontend, component, modal, ux, accessibility]
---

# Collapsing Agent Modal Actions into a Dropdown + Adding Clone

Research into two paired requests for `uses::[[agent-detail-modal]]`'s header action row (`AgentList.tsx:703-763`): collapsing the **Rename / Close agent / Remove agent** buttons into a 3-dot dropdown, and adding a **Clone/duplicate agent** action. **The duplicate-agent half is already fully scoped and unstarted** as `wiki/work/tasks/TASK-134-clone-agent-button.md` (status `todo`) — a `POST /agents/:id/clone` route that reuses the existing `createAgent()` machinery with a `<name>-copy`/`-copy-2` collision-avoiding name helper, plus a `cloneAgent()` frontend API client. TASK-134's own UI step, however, specifies adding Clone as a **fourth flat button**, which runs against the "collapse these buttons" half of the request — the two should be implemented as one unit, with Clone landing as a menu item rather than a fifth control.

**No dropdown/menu/popover component exists anywhere in `frontend/src/components/`**, and no headless-UI dependency (Radix, Headless UI, etc.) is present in `frontend/package.json` — a 3-dot actions menu has to be hand-built, following the W3C WAI-ARIA Authoring Practices "Actions Menu Button" pattern (`aria-haspopup="true"` trigger, `role="menu"`/`role="menuitem"` panel, roving-focus arrow-key navigation, Escape/outside-click to close). Close and Remove already route through a shared `ConfirmDialog` independent of their trigger control, so moving them into menu items needs no new confirmation plumbing; Rename is the exception, since today it swaps the button itself for an inline input in place — a closed dropdown has no "in place" to swap to, so Rename's entry point needs its own small rework (menu item opens the same existing inline input, just no longer nested under a visible button).

`InactiveAgentsPanel.tsx` renders the same `AgentDetailModal` (not a separate implementation), so the dropdown change automatically covers agents opened from the inactive-agents view with no second component to touch.

relates_to::[[agent-detail-modal]]
relates_to::[[accessible-dropdown-menu-pattern]]
