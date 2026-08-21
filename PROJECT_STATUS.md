# Project Status

**Last updated:** 2026-08-15

## Current Focus

- **ROADMAP-007 (Git workflow):** worktree isolation, diff review, and checkpoint/rollback are functionally complete; only UI polish remains (TASK-062 branch badge, TASK-066 diff panel, TASK-071 checkpoint UI — all pending-uat). Worktree creation is **opt-in, off by default** — never automatic.
- **ROADMAP-010 (Agent observability & UX):** token/cost tracking, per-session usage breakdown, session recording (LogTail history toggle + boundary markers), and role badges/selector — mostly pending-uat, wrapping up.
- **ROADMAP-017 (Competitive-audit follow-ups):** dispatch-latency collapse (monitor.sh's dispatch loop folding into the host-server's status-poll loop), perf-budget calibration, and dashboard UI/UX + task history — mix of in-progress and todo.

## Active Tasks

| Task | Title | Status |
|------|-------|--------|
| [TASK-001](wiki/work/tasks/TASK-001-skill-detection.md) | Skill detection — backend scanner + dashboard surfacing | in-progress |
| [TASK-011](wiki/work/tasks/TASK-011-immediate-dispatch.md) | Immediate dispatch for tasks enqueued to an idle agent with an empty queue | in-progress |
| [TASK-012](wiki/work/tasks/TASK-012-sse-tail-stream.md) | Replace tail polling with SSE push for terminal output | in-progress |
| [TASK-050](wiki/work/tasks/TASK-050-app-platform-live-deploy-runbook.md) | App Platform live deploy runbook | todo |
| [TASK-062](wiki/work/tasks/TASK-062-branch-badge-ui.md) | Branch badge — display branch name on agent card in dashboard | pending-uat |
| [TASK-066](wiki/work/tasks/TASK-066-diff-panel-ui.md) | Diff panel UI — unified diff in AgentDetailModal | pending-uat |
| [TASK-071](wiki/work/tasks/TASK-071-checkpoint-ui.md) | Checkpoint UI — AgentDetailModal checkpoint list + rollback button | pending-uat |
| [TASK-074](wiki/work/tasks/TASK-074-usage-badge-ui.md) | Token/cost badge on agent card | pending-uat |
| [TASK-076](wiki/work/tasks/TASK-076-usage-session-breakdown-ui.md) | Per-session usage breakdown UI | pending-uat |
| [TASK-109](wiki/work/tasks/TASK-109-logtail-history-toggle.md) | History toggle for LogTail | pending-uat |
| [TASK-110](wiki/work/tasks/TASK-110-logtail-history-timestamp-markers.md) | Session boundary markers in LogTail history view | pending-uat |
| [TASK-114](wiki/work/tasks/TASK-114-role-badge-ui.md) | Role badge UI | pending-uat |
| [TASK-115](wiki/work/tasks/TASK-115-role-selector-ui.md) | Role selector UI | pending-uat |
| [TASK-116](wiki/work/tasks/TASK-116-verify-dispatch-latency.md) | Verify real task-start latency drops | todo |
| [TASK-117](wiki/work/tasks/TASK-117-capture-perf-baseline-data.md) | Capture perf baseline data | todo |
| [TASK-118](wiki/work/tasks/TASK-118-calibrate-perf-budgets.md) | Calibrate perf budgets | todo |
| [TASK-119](wiki/work/tasks/TASK-119-persist-metrics-snapshots.md) | Persist metrics snapshots | pending-uat |
| [TASK-120](wiki/work/tasks/TASK-120-collapse-dispatch-into-status-poll.md) | Collapse monitor.sh dispatch into host-server status-poll loop | todo |
| [TASK-121](wiki/work/tasks/TASK-121-remove-redundant-monitor-dispatch.md) | Remove redundant monitor.sh dispatch block | todo |
| [TASK-122](wiki/work/tasks/TASK-122-dashboard-dark-mode.md) | Dashboard dark mode | todo |
| [TASK-123](wiki/work/tasks/TASK-123-replace-confirm-dialogs.md) | Replace window.confirm() dialogs with custom modal | pending-uat |
| [TASK-124](wiki/work/tasks/TASK-124-agentlist-text-filter.md) | AgentList text filter | pending-uat |
| [TASK-126](wiki/work/tasks/TASK-126-task-history-view.md) | Task history view | todo |
| [TASK-128](wiki/work/tasks/TASK-128-monitor-single-instance-lock.md) | monitor.sh single-instance startup guard | todo |
| [TASK-129](wiki/work/tasks/TASK-129-verify-script-port-isolation.md) | Port isolation for verify-sqlite-migration.sh | todo |
| [TASK-130](wiki/work/tasks/TASK-130-dynamic-terminal-pane-sizing.md) | Dynamic tmux pane sizing | pending-uat |
| [TASK-132](wiki/work/tasks/TASK-132-context-window-limit-accuracy.md) | Fix context-window limit lookup accuracy | todo |
| [TASK-133](wiki/work/tasks/TASK-133-sentinel-gate-background-agent-dispatch.md) | Sentinel gate for background-agent dispatch (BUG-0001) | todo |
| [TASK-134](wiki/work/tasks/TASK-134-clone-agent-button.md) | Clone button in AgentDetailModal | todo |

## Recently Completed / Superseded

- **ROADMAP-007 git workflow — Phases 1–3 done (2026-08-15):** Worktree isolation (Phase 1: TASK-060 schema, TASK-061 spawn, TASK-063 teardown), diff review (Phase 2: TASK-064 diff endpoint, TASK-065 base-branch endpoint), and checkpoint/rollback (Phase 3: TASK-067 SQLite table, TASK-068 pre-dispatch checkpoint, TASK-069 list endpoint, TASK-070 rollback endpoint) are all implemented. Only their UI counterparts remain pending-uat: TASK-062 (branch badge), TASK-066 (diff panel), TASK-071 (checkpoint UI). **Correction:** worktree creation is **opt-in, not automatic** — a `useWorktree` flag (default `false`) gates `host-server/db.ts#createAgent`'s worktree creation, `AddAgentForm`'s checkbox defaults unchecked, and an existing agent can opt in later via `POST /agents/:id/worktree` (`addWorktreeToAgent`, triggered by a "Create worktree" button in `AgentDetailModal`). Worktrees live in a sibling `<repo>-worktrees/<id>` directory, not nested inside the repo.
- TASK-058: Security hardening + structured logs + heartbeat — **done**
- TASK-059: README install one-liner + docs updates — **done**
- **Revert to single-user local (2026-06-21, `revert-to-simplicity` branch):** Deleted `app/api/`, `daemon/`, `shared/`, `deploy/`, all Dockerfiles/compose, `bin/conductor`, and the daemon plist. Flattened `app/frontend/` → `frontend/` and collapsed it to direct-only (removed auth/relay/device/pairing UI and the runtime mode probe). Simplified the Makefile, `.env.example`, CI matrix, and `install.sh`. Supersedes the App Platform deploy work (TASK-050 and the relay/portal task line).
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
