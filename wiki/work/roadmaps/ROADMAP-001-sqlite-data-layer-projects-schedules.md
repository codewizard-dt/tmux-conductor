---
id: ROADMAP-001
title: SQLite data layer, Projects, and recurring schedules
status: active
created: 2026-06-12
updated: 2026-06-12
owner: David
linked_requirements: []
linked_decisions: []
tags: [data-layer, backend, scheduler]
---

# Roadmap 001: SQLite data layer, Projects, and recurring schedules

## Goal

All conductor data — projects, agents, bg processes, task queue, and schedules — lives in SQLite (`./data/conductor.db`); `conductor.conf` holds only tuning settings; the dashboard manages projects and recurring schedules; `monitor.sh` pops tasks atomically via SQL; agents can be spawned per-project with auto-naming.

Design reference: implementation plan at `/Users/davidtaylor/.claude/plans/let-s-figure-out-a-sequential-bengio.md` (schema DDL, atomic pop SQL, API route table, verification suite).

## Phase 1: Foundation

- [x] [TASK-002: Add better-sqlite3 dependency, data/ gitignore entry, and DB_PATH setting](../tasks/TASK-002-sqlite-dependency-config.md) <!-- Completed: 2026-06-12 -->
- [x] [TASK-003: Create backend/db.ts — schema migrations and typed query helpers](../tasks/TASK-003-backend-db-ts.md) <!-- Completed: 2026-06-12 -->
- [x] [TASK-004: Verify Phase 1 foundation — seed import correctness and restart idempotency](../tasks/TASK-004-seed-verification.md) <!-- Completed: 2026-06-12 -->

## Phase 2: Backend API

- [x] [TASK-005: Rewrite agent and bg-process routes to be DB-backed with spawnAgentWindow helper](../tasks/TASK-005-backend-routes-db.md) <!-- Completed: 2026-06-12 -->
- [x] [TASK-006: Replace index-based queue endpoints with ID-based /api/tasks routes and SSE events](../tasks/TASK-006-task-queue-routes.md) <!-- Completed: 2026-06-12 -->
- [x] [TASK-007: Add /api/projects CRUD and POST /api/projects/:id/agents with auto-naming](../tasks/TASK-007-projects-api.md) <!-- Completed: 2026-06-12 -->
- [x] [TASK-008: Add /api/schedules CRUD and the scheduler tick loop](../tasks/TASK-008-schedules-api.md) <!-- Completed: 2026-06-12 -->

## Phase 3: Shell Scripts

- [ ] [TASK-009: Create scripts/lib/db.sh — sql wrapper, load_agents, load_bg, pop_task_sql](../tasks/TASK-009-scripts-lib-db-sh.md)
- [ ] [TASK-010: Rewrite monitor.sh pop_task as atomic SQL pop and move_to_backlog as status flip](../tasks/TASK-010-monitor-sh-db.md)
- [ ] Migrate conductor.sh, spawn.sh, teardown.sh, and broadcast.sh to DB-loaded agent lists
- [ ] Rewrite add-task.sh to insert directly via sqlite3

## Phase 4: Frontend

- [ ] Update lib/api.ts types and TaskList/AddTaskForm to ID-based tasks with per-row delete and jump-to-head
- [ ] Make AddAgentForm project-aware and add ProjectList/AddProjectForm components
- [ ] Add ScheduleList/ScheduleForm components with live schedule-fired updates
- [ ] Group AgentList by project and handle the new task SSE events

## Phase 5: Cutover

- [ ] Delete conf-splice functions and legacy queue code from backend/config.ts and backend/state.ts
- [ ] Strip AGENTS/BG_PROCESSES/AGENT_BG_LINKS/TASK_QUEUE from conductor.conf and retire tasks.txt
- [ ] Update docker-compose mounts, Dockerfile native-build step, and docs (CLAUDE.md, READMEs)
- [ ] Run the end-to-end verification suite (seed check, pop race test, fake agent dispatch, schedule fire, backlog restore)

## Notes

