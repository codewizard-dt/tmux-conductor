# Project Status

**Last updated:** 2026-06-13

## Current Focus

- Architecture simplification (`simplify-architecture` branch): `backend/`→`host-server/`, `frontend/`→`app/frontend/`, `portal/`→`app/api/`; better-auth; App Platform deploy via `deploy/app.yaml`; managed Postgres provisioned and migrated.
- Next: commit the restructure branch and merge to main; build relay so app/api proxies conductor traffic to host-server in prod.

## Active Tasks

| Task | Title | Status |
|------|-------|--------|
| [TASK-001](wiki/work/tasks/TASK-001-skill-detection.md) | Skill detection — host-server scanner + dashboard surfacing | in-progress (awaiting UAT) |
| [TASK-011](wiki/work/tasks/TASK-011-immediate-dispatch.md) | Immediate dispatch for idle agent with empty queue | in-progress (awaiting UAT) |
| [TASK-012](wiki/work/tasks/TASK-012-sse-tail-stream.md) | Replace tail polling with SSE push for terminal output | in-progress (awaiting UAT) |
| [TASK-023](wiki/work/tasks/TASK-023-remove-legacy-conf-queue-code-backend.md) | Delete dead conf-splice + legacy file-queue code | todo |
| [TASK-024](wiki/work/tasks/TASK-024-strip-legacy-conf-keys-retire-tasks-txt.md) | Strip AGENTS/BG_PROCESSES blocks from conductor.conf, retire tasks.txt | todo |
| [TASK-026](wiki/work/tasks/TASK-026-e2e-verification-suite.md) | Run end-to-end SQLite migration verification suite | todo |

## Recently Completed / Superseded

- **Architecture simplification (2026-06-13, `simplify-architecture` branch):**
  - Deleted 5 Dockerfiles + 3 compose files + 2 CI workflows (Docker/GHCR infrastructure removed)
  - `backend/` → `host-server/` (native only, systemd deploy via `deploy/host-server.service`)
  - `frontend/` → `app/frontend/` (App Platform static site)
  - `portal/` → `app/api/` (Fastify + better-auth on Postgres, App Platform Docker service)
  - Added `app/docker-compose.yml` (local Docker for app, 100% env-driven, reaches native host-server via `host.docker.internal:8788`)
  - Added `deploy/app.yaml` (DO App Platform spec, push-to-deploy)
  - Added `.github/workflows/ci.yml` (typecheck + lint only; AP owns deploy)
  - Provisioned managed Postgres `tmux-conductor-db` (pg17, nyc3) via DO MCP; pinned CA cert in `deploy/do-ca-certificate.crt`; full TLS verification
  - Ran better-auth migration: `user`, `session`, `account`, `verification` tables live in `defaultdb`
  - All three services verified healthy: host-server `:8788`, app/api `:8090`, frontend `:4321`
- TASK-025: Update docker-compose mounts, Dockerfile, docs for SQLite data layer — **done**
- TASK-027: Scaffold portal/ foundation — **done** (now lives at `app/api/`)
- TASK-028: Dockerfile.portal + DO App Platform spec — **superseded** (replaced by `app/api/Dockerfile` + `deploy/app.yaml`)
- TASK-029: Postgres migration 001 (users/devices/pairing_codes) — **superseded** (replaced by better-auth schema)
- TASK-030: Portal Google OIDC + JWT session — **superseded** (replaced by better-auth with optional Google provider)
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
