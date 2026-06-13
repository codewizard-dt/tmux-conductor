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

- [x] [TASK-009: Create scripts/lib/db.sh — sql wrapper, load_agents, load_bg, pop_task_sql](../tasks/TASK-009-scripts-lib-db-sh.md) <!-- Completed: 2026-06-12 -->

- [x] [TASK-010: Rewrite monitor.sh pop_task as atomic SQL pop and move_to_backlog as status flip](../tasks/TASK-010-monitor-sh-db.md) <!-- Completed: 2026-06-12 -->
- [x] [TASK-013: Migrate conductor.sh, spawn.sh, teardown.sh, and broadcast.sh to DB-loaded agent lists](../tasks/TASK-013-migrate-scripts-db-agent-lists.md) <!-- Completed: 2026-06-12 -->
- [x] [TASK-014: Rewrite add-task.sh to insert directly via sqlite3](../tasks/TASK-014-add-task-sh-sqlite-insert.md) <!-- Completed: 2026-06-12 -->

## Phase 4: Frontend

- [x] [TASK-015: Update lib/api.ts types and TaskList/AddTaskForm to ID-based tasks with per-row delete and jump-to-head](../tasks/completed/TASK-015-frontend-id-based-tasks.md) <!-- Completed: 2026-06-12 -->
- [x] [TASK-016: Make AddAgentForm project-aware and add ProjectList/AddProjectForm components](../tasks/completed/TASK-016-frontend-projects-ui.md) <!-- Completed: 2026-06-12 -->
- [x] [TASK-017: Add ScheduleList/ScheduleForm components with live schedule-fired updates](../tasks/completed/TASK-017-frontend-schedules-ui.md) <!-- Completed: 2026-06-12 -->
- [x] [TASK-018: Group AgentList by project and handle the new task SSE events](../tasks/completed/TASK-018-frontend-agentlist-grouping.md) <!-- Completed: 2026-06-12 -->

## Phase 5: Cutover

- [ ] [TASK-023: Remove legacy conf-splice and file-queue code from backend/config.ts and backend/state.ts](../tasks/TASK-023-remove-legacy-conf-queue-code-backend.md)
- [ ] [TASK-024: Strip AGENTS/BG_PROCESSES/AGENT_BG_LINKS/TASK_QUEUE from conductor.conf and retire tasks.txt](../tasks/TASK-024-strip-legacy-conf-keys-retire-tasks-txt.md)
- [ ] [TASK-025: Update docker-compose mounts, Dockerfile native-build step, and docs](../tasks/TASK-025-update-docker-dockerfile-docs.md)
- [ ] [TASK-026: Run the end-to-end SQLite-migration verification suite](../tasks/TASK-026-e2e-verification-suite.md)

## Notes

