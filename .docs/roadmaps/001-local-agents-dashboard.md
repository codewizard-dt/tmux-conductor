# Roadmap 001: Local Agents & Accordion Dashboard

> Remove the container layer entirely and replace it with a lightweight Astro+React dashboard for managing agents, tasks, and queue order.

- **Status**: active
- **Created**: 2026-06-06
- **Last updated**: 2026-06-06
- **Owner**: David Taylor
- **Linked PRD**: —
- **Linked ADRs**: —
- **Tags**: agents, dashboard, refactor

## Goal

Agents run directly as plain tmux windows using `claude --dangerously-skip-permissions` — no Docker, no containers, no EXEC_MODE. A single-page Astro+React web dashboard lists all agents as accordion sections showing pending and active tasks, supports drag-to-reorder and inline task-add, has an add-agent button at the top, and surfaces per-agent status via color coding (yellow=empty queue, red=error, flashing `!`=awaiting user input).

## Phase 1: Agent Refactor

> Strip all container/Docker wiring so agents are plain tmux windows running claude directly.

- [ ] Strip container mode from `conductor.sh` / `spawn.sh` — agents become plain `claude --dangerously-skip-permissions` tmux windows; remove `build_launch_cmd`, `agent_exec.sh` wrapping, and `EXEC_MODE` branches
- [ ] Remove or simplify `scaffold.sh` — devcontainer scaffolding is no longer needed
- [ ] Update `conductor.conf` — remove EXEC_MODE and container knobs; add `CLAUDE_FLAGS="--dangerously-skip-permissions"`
- [ ] Trash tasks 016 (Ensure Container Up) and 017 (Command Center Dashboard) — both are superseded by this roadmap

## Phase 2: Dashboard Backend

> Fastify server exposing agent state, task queue CRUD, and SSE for live updates.

- [ ] Fastify server with `GET /status` — per-agent state, queue length, session health; served on plain HTTP (no SSL required on localhost)
- [ ] Task queue CRUD API — `POST /queue/:agent` (add task), `PUT /queue/:agent/reorder` (reorder), `DELETE /queue/:agent/:index`
- [ ] Agent management API — `POST /agents` updates `conductor.conf` and spawns a new tmux window into the live session
- [ ] SSE live state stream — `GET /events` streams per-agent state changes so the UI updates without polling

## Phase 3: Dashboard Frontend

> Astro + React single-page app with accordion agent list, task management, and add-agent form.

- [ ] Scaffold Astro + React project under `scripts/dashboard/ui/`
- [ ] Agent accordion list — collapsible per-agent sections showing pending and active tasks, colored by status (yellow=empty queue, red=error, flashing `!`=awaiting input)
- [ ] Add-task form + drag-to-reorder — text input + button inside each agent accordion; drag handles to reorder queue entries
- [ ] Add-agent form at page top — text input + button to spawn a new named agent window into the running session

## Phase 4: Integration & Polish

> Wire the dashboard into the conductor lifecycle and finalize status signals.

- [ ] Error state detection + red highlight — detect unrecoverable agent error via hook or pattern and surface in the UI
- [ ] Empty-queue amber/yellow highlight — when an agent has no pending tasks, its accordion header shows in amber
- [ ] `!` icon with gentle flash for agents awaiting user input (paused, needs interactive response)
- [ ] Wire dashboard window into `conductor.sh` + `teardown.sh` — spawn on start, `C-c` on teardown
- [ ] Docs update — CLAUDE.md, root README, `scripts/README.md` to reflect the new local-only agent model

## Notes

Tasks 016 and 017 are superseded; trash them before starting Phase 1 work.
Astro + React chosen over Vite + React for the frontend (user preference).
SSE stream runs over plain HTTP on localhost — no SSL plumbing needed.
