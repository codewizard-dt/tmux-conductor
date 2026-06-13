# Wiki Log

Append-only record of wiki operations — ingests, queries filed back, lint passes, scaffolding. **Never edit existing entries**; only append new ones at the bottom.

Entry format (consistent prefix keeps the log greppable — `grep "^## \[" log.md | tail -5`):

```
## [YYYY-MM-DD] <op> | <subject>
1–3 sentences on what happened.
```

Operations: `scaffold`, `ingest`, `query`, `lint`, `decision`, `task`, `bug`, `requirement`, `roadmap`.

---

## [2026-06-12] uat | UAT-001 UAT: Skill detection — backend scanner + dashboard surfacing
Generated UAT-001 for TASK-001 with 11 test cases: 5 API happy-path/shape tests, 3 edge-case tests (404, empty project, wrong agent), and 5 UI tests covering the AgentDetailModal skills section, badge rendering, and click-to-enqueue flow.

## [2026-06-12] task | TASK-001 Skill detection — backend scanner + dashboard surfacing
Created TASK-001: scan ~/.claude/skills (user-global) and per-agent <workdir>/.claude/skills (project), expose GET /skills and GET /agents/:agent/skills in the Fastify backend, and render available skills inside AgentDetailModal with click-to-enqueue support.

## [2026-06-12] roadmap | ROADMAP-001 SQLite data layer, Projects, and recurring schedules
Created ROADMAP-001 with 5 phases / 19 inline items: migrate tasks.txt + conductor.conf arrays to SQLite (better-sqlite3 + sqlite3 CLI), add Projects as a top-level resource with per-project agent spawning, and add interval-based schedules fired by the backend. Design reference: plan file from the 2026-06-12 planning session. Added to roadmaps index.

## [2026-06-12] task | TASK-002 Add better-sqlite3 dependency, data/ gitignore entry, and DB_PATH setting
Created TASK-002: prerequisite config foundation for ROADMAP-001 SQLite migration — install better-sqlite3 + @types/better-sqlite3 in backend/package.json, add data/ to .gitignore, and add DB_PATH to conductor.conf.

## [2026-06-12] task | TASK-003 Create backend/db.ts — schema migrations and typed query helpers
Created TASK-003: full SQLite data module — openDb with WAL+pragmas, schema migrations for 6 tables (meta/projects/agents/bg_processes/tasks/schedules), typed CRUD helpers, atomic pop, and seedFromLegacy one-time import.

## [2026-06-12] task | TASK-004 Verify Phase 1 foundation — seed import correctness and restart idempotency
Created TASK-004: wire openDb into backend/index.ts startup, expose _confPath on ConductorConf, and write UAT test cases for seed correctness and idempotency.

## [2026-06-12] task | TASK-005 Rewrite agent and bg-process routes to be DB-backed with spawnAgentWindow helper
Created TASK-005: replace conf-splice agent/bg CRUD with DB helpers, extract shared spawnAgentWindow(), update buildSnapshot() to use listAgents(db).

## [2026-06-12] task | TASK-006 Replace index-based queue endpoints with ID-based /api/tasks routes and SSE events
Created TASK-006: POST/DELETE/PUT /api/tasks + jump-head endpoint, update GET /api/queue/:agent to return task objects, broadcast task-added/task-removed SSE.

## [2026-06-12] task | TASK-007 Add /api/projects CRUD and POST /api/projects/:id/agents with auto-naming
Created TASK-007: full /api/projects resource with force-delete guard, plus spawn-agent-for-project endpoint with nextAgentName auto-fill and project workdir/launchCmd pre-fill.

## [2026-06-12] task | TASK-008 Add /api/schedules CRUD and the scheduler tick loop
Created TASK-008: /api/schedules CRUD + setInterval(5000) tick firing dueSchedules via fireSchedule, broadcasting schedule-fired + task-added SSE.

## [2026-06-12] task | TASK-009 Create scripts/lib/db.sh — sql wrapper, load_agents, load_bg, pop_task_sql
Created TASK-009: shared SQLite helper library for shell scripts — sql() wrapper, load_agents/load_bg array loaders, pop_task_sql atomic DELETE…RETURNING.

## [2026-06-12] task | TASK-010 Rewrite monitor.sh pop_task as atomic SQL pop and move_to_backlog as status flip
Created TASK-010: migrate monitor.sh queue ops to SQLite — pop_task_sql call, UPDATE status='backlog', load_agents inside poll loop for live agent pickup.

## [2026-06-12] uat | UAT-004 UAT: Phase 1 foundation — SQLite startup, seed import, and idempotency
Generated UAT-004 for TASK-004 with 8 test cases: 2 edge-case config/gitignore checks, 4 API/runtime tests (startup, schema init, agent seed, task seed), and 2 edge cases (idempotency restart, concurrent start).

## [2026-06-12] uat | UAT-004 passed (auto)
Task TASK-004 marked done. All 9 tests passed: DB_PATH in conf, data/ gitignored, backend startup + DB creation, meta table schema_version/legacy_import, agent seed count, task seed count, restart idempotency, better-sqlite3 binary loadable, concurrent-start atomicity. Fixed test URL from /healthz to /api/healthz.

## [2026-06-12] roadmap | ROADMAP-002 Hosted portal with Google OAuth, device relay, and installer
Created ROADMAP-002 with 5 phases / 21 inline items: DO App Platform portal (Google OIDC + email allowlist, Postgres for identity only), outbound WebSocket relay from the local daemon (pairing-code device auth, user-first connection registry), curl|bash install.sh (prereqs, SQLite init, hooks, daemon service), and frontend relay mode with onboarding. Phase 1 depends on ROADMAP-001 Phase 1. Design reference: plan file from the 2026-06-12 planning session (relay protocol, DDL, route table, security checklist). Added to roadmaps index.

## [2026-06-12] uat | UAT-005 UAT: DB-backed agent and bg-process routes with spawnAgentWindow helper
Generated UAT-005 for TASK-005 with 11 test cases: 8 API tests (GET /api/agents, GET /api/status sourcing, POST/DELETE validation and 409/404 responses for agents and bg-processes) and 3 edge-case tests (DB persistence across restart, conf-splice regression check, seeded agent count consistency).

## [2026-06-12] uat | UAT-006 UAT: ID-based /api/tasks routes and SSE events
Generated UAT-006 for TASK-006 with 13 test cases: 11 API tests (POST happy path global + scoped, validation 400s, DELETE by id, PUT reorder, POST jump-head, GET queue returning objects) and 2 edge cases (head placement ordering, hard delete confirmation).

## [2026-06-12] task | TASK-011 Immediate dispatch for tasks enqueued to an idle agent with an empty queue
Created task TASK-011: backend fast-path on the task-add routes — when the target agent is idle with no pending tasks, mark busy, log to dispatch.jsonl, and send-keys immediately instead of waiting up to POLL_INTERVAL for the monitor poll.

## [2026-06-12] uat | UAT-011 UAT: Immediate dispatch for tasks enqueued to an idle agent with an empty queue
Generated UAT-011 for TASK-011 with 10 test cases: 2 fast-path API happy paths (legacy queue route + DB tasks route), 1 dispatch.jsonl record verification, 2 slow-path API tests (busy agent, non-empty queue), 2 UI tests (fast-path hint + slow-path queue update), and 3 edge-case tests (no double-dispatch, dispatched:false for global task, state-file-before-send-keys ordering guarantee).
