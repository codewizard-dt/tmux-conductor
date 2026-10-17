---
id: ROADMAP-0023
aliases: [ROADMAP-0023]
title: Replace the Agents Page Kanban Board with a Sidebar + Detail-Pane Layout
status: active
created: 2026-09-18
updated: 2026-09-19
owner: David Taylor
derived_from: [agents-page-sidebar-layout, react-router-outlet-sidebar-layout]
linked_requirements: —
linked_decisions: —
tags: [frontend, agents-page, layout, navigation]
---

# ROADMAP-0023 — Replace the Agents Page Kanban Board with a Sidebar + Detail-Pane Layout

## Goal

The Agents page has no Kanban columns left. A left sidebar lists agents grouped by project with a status-colored right border per row; inactive agents sit in a collapsible section at the sidebar's top. Clicking an agent renders its full detail (today's `AgentDetailModal` content) in the main content area instead of a popup overlay. "Add Agent" and "Add Background Process" are triggered from `NavBar`, both as modals.

## Phase 1: Sidebar List & Grouping

- [ ] [[TASK-0169: Remove the 3 Kanban status columns and their partition logic from AgentList]]
- [ ] [[TASK-0170: Build the AgentSidebar component grouping agents by project]]
- [ ] [[TASK-0171: Add a status-colored right border to each sidebar agent row]]

## Phase 2: Detail Pane Relocation

- [x] [[TASK-0172: Extract AgentDetailModal's content into a non-overlay AgentDetailView]]
- [ ] [[TASK-0173: Wire sidebar row click to render AgentDetailView in the main content area]]
- [ ] [[TASK-0174: Preserve Cmd+Shift+Arrow cycling and notification-driven open/arm-interact against the pane selection]]

## Phase 3: Nav & Forms

- [ ] [[TASK-0175: Move the + Add Agent trigger into NavBar]]
- [ ] [[TASK-0176: Convert AddBgProcessForm into a modal and move its trigger into NavBar]]

## Phase 4: Inactive Agents in Sidebar

- [ ] [[TASK-0177: Relocate InactiveAgentsPanel into a collapsible section at the top of the sidebar]]
- [ ] [[TASK-0178: Repoint InactiveAgentsPanel's open-detail action at the detail pane and retire the modal wrapper]]

## Notes

