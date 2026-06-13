# Project Status

**Last updated:** 2026-06-12

## Current Focus

- ROADMAP-001 Phase 5 cutover (SQLite data layer) — clean up legacy conf/queue code, retire tasks.txt, update docs/Docker
- ROADMAP-002 hosted portal scaffolding (TASK-027–030)

## Active Tasks

| Task | Title | Status |
|------|-------|--------|
| [TASK-001](wiki/work/tasks/TASK-001-skill-detection.md) | Skill detection — backend scanner + dashboard surfacing | in-progress (awaiting UAT) |
| [TASK-011](wiki/work/tasks/TASK-011-immediate-dispatch.md) | Immediate dispatch for idle agent with empty queue | in-progress (awaiting UAT) |
| [TASK-012](wiki/work/tasks/TASK-012-sse-tail-stream.md) | Replace tail polling with SSE push for terminal output | in-progress (awaiting UAT) |
| [TASK-023](wiki/work/tasks/TASK-023-remove-legacy-conf-queue-code-backend.md) | Delete dead conf-splice + legacy file-queue code | todo |
| [TASK-024](wiki/work/tasks/TASK-024-strip-legacy-conf-keys-retire-tasks-txt.md) | Strip AGENTS/BG_PROCESSES blocks from conductor.conf, retire tasks.txt | todo (blocks on TASK-023) |
| [TASK-025](wiki/work/tasks/TASK-025-update-docker-dockerfile-docs.md) | Update docker-compose mounts, Dockerfile, docs for SQLite data layer | todo |
| [TASK-026](wiki/work/tasks/TASK-026-e2e-verification-suite.md) | Run end-to-end SQLite migration verification suite | todo |
| [TASK-027](wiki/work/tasks/TASK-027-scaffold-portal-foundation.md) | Scaffold portal/ (Fastify, env validation, pg Pool, migrations, /healthz) | todo |
| [TASK-028](wiki/work/tasks/TASK-028-portal-dockerfile-do-app-deploy.md) | Dockerfile.portal + DO App Platform spec | todo |
| [TASK-029](wiki/work/tasks/TASK-029-portal-pg-migration-001.md) | Postgres migration 001 — users, devices, pairing_codes | todo |
| [TASK-030](wiki/work/tasks/TASK-030-portal-google-oidc-session-allowlist.md) | Portal Google OIDC sign-in, JWT session, email allowlist, /api/me | todo |

## Recently Completed

- TASK-022: Verify installer e2e on macOS
- TASK-021: install.sh curl-bash installer
- TASK-020: Daemon install + render bootstrap (plist/systemd)
- TASK-019: Parameterize daemon plist/systemd
- TASK-018: Frontend agent list grouping
- TASK-017: Frontend schedules UI
- TASK-016: Frontend projects UI
- TASK-015: Frontend ID-based tasks
- TASK-014: add-task.sh SQLite insert
- TASK-013: Migrate scripts DB agent lists
- TASK-010: monitor.sh DB integration
- TASK-009: scripts/lib/db.sh shared library
