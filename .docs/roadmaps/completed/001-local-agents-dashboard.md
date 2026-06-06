# Roadmap 001: Local Agents & Accordion Dashboard

> Remove the container layer entirely and replace it with a lightweight Astro+React dashboard for managing agents, tasks, and queue order.

- **Status**: done
- **Created**: 2026-06-06
- **Last updated**: 2026-06-06 (task 034 archived — ROADMAP-001 complete)
- **Owner**: David Taylor
- **Linked PRD**: —
- **Linked ADRs**: —
- **Tags**: agents, dashboard, refactor

## Goal

Agents run directly as plain tmux windows using `claude --dangerously-skip-permissions` — no Docker, no containers, no EXEC_MODE. A single-page Astro+React web dashboard lists all agents as accordion sections showing pending and active tasks, supports drag-to-reorder and inline task-add, has an add-agent button at the top, and surfaces per-agent status via color coding (yellow=empty queue, red=error, flashing `!`=awaiting user input).

## Phase 1: Agent Refactor

> Strip all container/Docker wiring so agents are plain tmux windows running claude directly.

- [x] [TASK-018: Strip Container Mode from conductor.sh / spawn.sh](../tasks/completed/018-strip-container-mode.md)
- [x] [TASK-019: Remove scaffold.sh (devcontainer scaffolding no longer needed)](../tasks/completed/019-remove-scaffold-sh.md)
- [x] [TASK-020: Update conductor.conf for local-agent model](../tasks/completed/020-update-conductor-conf.md)
- [x] [TASK-021: Trash Tasks 016 and 017 (Superseded by ROADMAP-001)](../tasks/completed/021-trash-016-017.md)

## Phase 2: Dashboard Backend

> Fastify server exposing agent state, task queue CRUD, and SSE for live updates.

- [x] [TASK-022: Fastify Server with GET /status Endpoint](../tasks/completed/022-fastify-status-server.md)
- [x] [TASK-023: Task Queue CRUD API](../tasks/completed/023-task-queue-crud-api.md)
- [x] [TASK-024: Agent Management API](../tasks/completed/024-agent-management-api.md)
- [x] [TASK-025: SSE Live State Stream (GET /events)](../tasks/completed/025-sse-live-state-stream.md)

## Phase 3: Dashboard Frontend

> Astro + React single-page app with accordion agent list, task management, and add-agent form.

- [x] [TASK-026: Scaffold Astro + React Project under scripts/dashboard/ui/](../tasks/completed/026-scaffold-astro-react.md)
- [x] [TASK-027: Agent Accordion List](../tasks/completed/027-agent-accordion-list.md)
- [x] [TASK-028: Add-task Form + Drag-to-Reorder](../tasks/completed/028-add-task-drag-reorder.md)
- [x] [TASK-029: Add-agent Form](../tasks/completed/029-add-agent-form.md)

## Phase 4: Integration & Polish

> Wire the dashboard into the conductor lifecycle and finalize status signals.

- [x] [TASK-030: Error State Detection + Red Highlight](../tasks/completed/030-error-state-red-highlight.md)
- [x] [TASK-031: Empty-queue Amber Highlight](../tasks/completed/031-empty-queue-amber-highlight.md)
- [x] [TASK-032: Awaiting-input Flash Icon](../tasks/completed/032-awaiting-input-flash-icon.md)
- [x] [TASK-033: Wire Dashboard into conductor.sh + teardown.sh](../tasks/completed/033-wire-dashboard-conductor.md)
- [x] [TASK-034: Docs Update: Local-agent Model](../tasks/completed/034-docs-update-local-agent-model.md)

## Notes

Tasks 016 and 017 are superseded; trash them before starting Phase 1 work.
Astro + React chosen over Vite + React for the frontend (user preference).
SSE stream runs over plain HTTP on localhost — no SSL plumbing needed.
