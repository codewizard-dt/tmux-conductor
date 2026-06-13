---
id: ROADMAP-003
title: Local Agents Dashboard
status: done
created: 2026-06-06
updated: 2026-06-12
owner: David Taylor
linked_requirements: []
linked_decisions: []
tags: [agents, dashboard, refactor]
---

# Roadmap 003: Local Agents Dashboard

> Remove the container layer entirely and replace it with a lightweight Astro+React dashboard for managing agents, tasks, and queue order.

## Goal

Agents run directly as plain tmux windows using `claude --dangerously-skip-permissions` — no Docker, no containers, no EXEC_MODE. A single-page Astro+React web dashboard lists all agents as accordion sections showing pending and active tasks, supports drag-to-reorder and inline task-add, has an add-agent button at the top, and surfaces per-agent status via color coding (yellow=empty queue, red=error, flashing `!`=awaiting user input).

## Phase 1: Agent Refactor

> Strip all container/Docker wiring so agents are plain tmux windows running claude directly.

- [x] TASK-018: Strip Container Mode from conductor.sh / spawn.sh
- [x] TASK-019: Remove scaffold.sh (devcontainer scaffolding no longer needed)
- [x] TASK-020: Update conductor.conf for local-agent model
- [x] TASK-021: Trash Tasks 016 and 017 (Superseded by ROADMAP-001)

## Phase 2: Dashboard Backend

> Fastify server exposing agent state, task queue CRUD, and SSE for live updates.

- [x] TASK-022: Fastify Server with GET /status Endpoint
- [x] TASK-023: Task Queue CRUD API
- [x] TASK-024: Agent Management API
- [x] TASK-025: SSE Live State Stream (GET /events)

## Phase 3: Dashboard Frontend

> Astro + React single-page app with accordion agent list, task management, and add-agent form.

- [x] TASK-026: Scaffold Astro + React Project under scripts/dashboard/ui/
- [x] TASK-027: Agent Accordion List
- [x] TASK-028: Add-task Form + Drag-to-Reorder
- [x] TASK-029: Add-agent Form

## Phase 4: Integration & Polish

> Wire the dashboard into the conductor lifecycle and finalize status signals.

- [x] TASK-030: Error State Detection + Red Highlight
- [x] TASK-031: Empty-queue Amber Highlight
- [x] TASK-032: Awaiting-input Flash Icon
- [x] TASK-033: Wire Dashboard into conductor.sh + teardown.sh
- [x] TASK-034: Docs Update: Local-agent Model

## Notes

Tasks 016 and 017 were superseded and trashed before Phase 1 work began.
Astro + React chosen over Vite + React for the frontend (user preference).
SSE stream runs over plain HTTP on localhost — no SSL plumbing needed.

## Migration Note

Migrated 2026-06-12 from `.docs/roadmaps/completed/001-local-agents-dashboard.md` (pre-wiki task system). Task links have been inlined as names — original task files lived under `.docs/tasks/completed/`.
