# Project Status

**Last updated:** 2026-06-14

## Current Focus

- Architecture simplification merged to main: `host-server/` (native tmux, systemd), `app/api/` (Fastify + better-auth, App Platform Docker service), `app/frontend/` (Vite SPA, App Platform static site). Local Docker via `app/docker-compose.yml`; DO App Platform spec at `deploy/app.yaml`.
- Next: live App Platform deploy (TASK-050); git worktree per-agent support (TASK-060–063); diff panel + checkpoint/rollback UI (TASK-064–071).

## Active Tasks

| Task | Title | Status |
|------|-------|--------|
| [TASK-001](wiki/work/tasks/TASK-001-skill-detection.md) | Skill detection — host-server scanner + dashboard surfacing | in-progress |
| [TASK-011](wiki/work/tasks/TASK-011-immediate-dispatch.md) | Immediate dispatch for idle agent with empty queue | in-progress |
| [TASK-012](wiki/work/tasks/TASK-012-sse-tail-stream.md) | Replace tail polling with SSE push for terminal output | in-progress |
| [TASK-050](wiki/work/tasks/TASK-050-app-platform-live-deploy-runbook.md) | App Platform live deploy runbook (api + frontend, invite-gated) | todo |
| [TASK-058](wiki/work/tasks/TASK-058-security-hardening-logs-heartbeat.md) | Security hardening + structured logs + heartbeat | todo |
| [TASK-059](wiki/work/tasks/TASK-059-readme-docs-updates.md) | README install one-liner + docs updates | todo |
| [TASK-060](wiki/work/tasks/TASK-060-agents-worktree-schema.md) | agents table schema — add worktree_path and branch columns | todo |
| [TASK-061](wiki/work/tasks/TASK-061-worktree-spawn.md) | Worktree spawn on agent add | todo |
| [TASK-062](wiki/work/tasks/TASK-062-branch-badge-ui.md) | Branch badge on agent card | todo |
| [TASK-063](wiki/work/tasks/TASK-063-worktree-teardown.md) | Worktree teardown on agent delete | todo |
| [TASK-064](wiki/work/tasks/TASK-064-diff-endpoint.md) | Diff endpoint — GET /api/agents/:agent/diff | todo |
| [TASK-065](wiki/work/tasks/TASK-065-base-branch-endpoint.md) | Base-branch endpoint | todo |
| [TASK-066](wiki/work/tasks/TASK-066-diff-panel-ui.md) | Diff panel UI in AgentDetailModal | todo |
| [TASK-067](wiki/work/tasks/TASK-067-agent-checkpoints-table.md) | agent_checkpoints SQLite table | todo |
| [TASK-068](wiki/work/tasks/TASK-068-pre-dispatch-checkpoint.md) | Pre-dispatch checkpoint (git stash) | todo |
| [TASK-069](wiki/work/tasks/TASK-069-checkpoints-list-endpoint.md) | Checkpoints list endpoint | todo |
| [TASK-070](wiki/work/tasks/TASK-070-rollback-endpoint.md) | Rollback endpoint | todo |
| [TASK-071](wiki/work/tasks/TASK-071-checkpoint-ui.md) | Checkpoint UI in AgentDetailModal | todo |

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
