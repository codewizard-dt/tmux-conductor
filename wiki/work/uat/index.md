---
title: UAT Index
updated: 2026-09-13
---

# UAT — Active Items

Lists **only active** UAT files (`pending`, `in-progress`, `failed`). When a UAT leaves the active set (`passed`, `skipped`, `trashed`), delete its line here — the file itself never moves; status lives in its frontmatter. See the [lifecycle](lifecycle.md).

Entry format: `- [UAT-NNN — Title](UAT-NNN-slug.md) — verifies TASK-NNN · status`

- [UAT-001 — UAT: Skill detection — backend scanner + dashboard surfacing](UAT-001-skill-detection.md) — verifies TASK-001 · failed
- [UAT-005 — UAT: DB-backed agent and bg-process routes with spawnAgentWindow helper](UAT-005-backend-routes-db.md) — verifies TASK-005 · pending
- [UAT-006 — UAT: ID-based /api/tasks routes and SSE events](UAT-006-task-queue-routes.md) — verifies TASK-006 · pending
- [UAT-011 — UAT: Immediate dispatch for tasks enqueued to an idle agent with an empty queue](UAT-011-immediate-dispatch.md) — verifies TASK-011 · pending
- [UAT-128 — UAT: monitor.sh single-instance startup guard — PID lockfile keyed on STATE_DIR](UAT-128-monitor-single-instance-lock.md) — verifies TASK-128 · pending
- [UAT-012 — UAT: Replace tail polling with SSE push for terminal output](UAT-012-sse-tail-stream.md) — verifies TASK-012 · failed
- [UAT-130 — UAT: Dynamic tmux pane sizing from the browser terminal's full-width probe](UAT-130-dynamic-terminal-pane-sizing.md) — verifies TASK-130 · pending
- [UAT-135 — UAT: Dark-mode sweep — replace remaining hardcoded bg-white/surface literals across every page and component](UAT-135-dark-mode-hardcoded-surface-sweep.md) — verifies TASK-135 · pending
- [UAT-140 — UAT: Audit and fix button/badge contrast ratios in light and dark themes](UAT-140-badge-button-contrast-audit.md) — verifies TASK-140 · pending
- [UAT-146 — UAT: Toast-like notifications on agent status change (waiting / no tasks), click switches to that agent](UAT-146-agent-status-toast-notifications.md) — verifies TASK-146 · pending
- [UAT-0167 — UAT: Allow switching an agent's role directly from the agent detail modal](UAT-0167-agent-role-switcher-modal.md) — verifies TASK-0167 · pending
- [UAT-132 — UAT: Fix context-window limit lookup in host-server/context.ts](UAT-132-context-window-limit-accuracy.md) — verifies TASK-132 · pending
- [UAT-151 — UAT: Convert the Add Agent form into a modal](UAT-151-add-agent-form-modal.md) — verifies TASK-151 · pending
- [UAT-0164 — UAT: Make the Direct Input terminal border permanent (color-only state change, no layout shift)](UAT-0164-direct-input-border-no-shift.md) — verifies TASK-0164 · pending
- [UAT-162 — UAT: Move the Details and Queued Tasks accordions into the AgentInfoTabs structure](UAT-162-details-queued-tasks-into-tabs.md) — verifies TASK-162 · pending
- [UAT-0169 — UAT: Remove the 3 Kanban status columns and their partition logic from AgentList](UAT-0169-remove-kanban-columns-agentlist.md) — verifies TASK-0169 · pending
- [UAT-0170 — UAT: Build the AgentSidebar component grouping agents by project](UAT-0170-agent-sidebar-project-grouping.md) — verifies TASK-0170 · pending
- [UAT-0171 — UAT: Add a status-colored right border to each sidebar agent row](UAT-0171-sidebar-row-status-right-border.md) — verifies TASK-0171 · pending
- [UAT-0175 — UAT: Move the + Add Agent trigger into NavBar](UAT-0175-navbar-add-agent-trigger.md) — verifies TASK-0175 · pending
- [UAT-0176 — UAT: Convert AddBgProcessForm into a modal and move its trigger into NavBar](UAT-0176-add-bg-process-form-modal-navbar-trigger.md) — verifies TASK-0176 · pending
- [UAT-0172 — UAT: Extract AgentDetailModal's content into a non-overlay AgentDetailView](UAT-0172-extract-agent-detail-view.md) — verifies TASK-0172 · pending
- [UAT-0173 — UAT: Wire sidebar row click to render AgentDetailView in the main content area](UAT-0173-sidebar-click-renders-detail-pane.md) — verifies TASK-0173 · pending
- [UAT-0174 — UAT: Preserve Cmd+Shift+Arrow cycling and notification-driven open/arm-interact against the pane selection](UAT-0174-preserve-cycling-and-notification-open-in-pane.md) — verifies TASK-0174 · pending
- [UAT-0177 — UAT: Relocate InactiveAgentsPanel into a collapsible section at the top of the sidebar](UAT-0177-inactive-agents-into-sidebar-top.md) — verifies TASK-0177 · pending
- [UAT-0178 — UAT: Repoint InactiveAgentsPanel's open-detail action at the detail pane and retire the modal wrapper](UAT-0178-inactive-agents-open-detail-via-pane.md) — verifies TASK-0178 · pending
- [UAT-0179 — UAT: Add a sidebar minimize toggle with a hover-to-expand overlay flyout and a sticky sidebar header](UAT-0179-sidebar-minimize-hover-flyout.md) — verifies TASK-0179 · pending
