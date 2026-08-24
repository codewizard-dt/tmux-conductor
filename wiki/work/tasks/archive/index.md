# Tasks Archive

Terminal task files (`done` or `trashed`) moved here by `/wiki-archive` to reduce directory clutter. **Append-only** — archived items never move again.

| ID | Title | Final Status | Archived |
|----|-------|--------------|----------|
| [[TASK-002]] | Add better-sqlite3 dependency, data/ gitignore entry, and DB_PATH setting | done | 2026-06-14 |
| [[TASK-076]] | Per-session usage breakdown — GET /agents/:id/usage endpoint + session table in AgentDetailModal | done | 2026-08-24 |
| [[TASK-062]] | Branch badge — display branch name on agent card in dashboard | done | 2026-08-15 |
| [[TASK-003]] | Create backend/db.ts — schema migrations and typed query helpers | done | 2026-06-14 |
| [[TASK-004]] | Verify Phase 1 foundation — seed import correctness and restart idempotency | done | 2026-06-14 |
| [[TASK-005]] | Rewrite agent and bg-process routes to be DB-backed with spawnAgentWindow helper | done | 2026-06-14 |
| [[TASK-006]] | Replace index-based queue endpoints with ID-based /api/tasks routes and SSE events | done | 2026-06-14 |
| [[TASK-007]] | Add /api/projects CRUD and POST /api/projects/:id/agents with auto-naming | done | 2026-06-14 |
| [[TASK-008]] | Add /api/schedules CRUD and the scheduler tick loop | done | 2026-06-14 |
| [[TASK-009]] | Create scripts/lib/db.sh — sql wrapper, load_agents, load_bg, pop_task_sql | done | 2026-06-14 |
| [[TASK-010]] | Rewrite monitor.sh pop_task as atomic SQL pop and move_to_backlog as status flip | done | 2026-06-14 |
| [[TASK-013]] | Migrate conductor.sh, spawn.sh, teardown.sh, broadcast.sh to DB-loaded agent lists | done | 2026-06-14 |
| [[TASK-014]] | Rewrite add-task.sh to insert directly via sqlite3 | done | 2026-06-14 |
| [[TASK-015]] | Update lib/api.ts types and TaskList/AddTaskForm to ID-based tasks with per-row delete and jump-to-head | done | 2026-06-14 |
| [[TASK-016]] | Make AddAgentForm project-aware and add ProjectList/AddProjectForm components | done | 2026-06-14 |
| [[TASK-017]] | Frontend Schedules UI — ScheduleList + ScheduleForm with live schedule-fired updates | done | 2026-06-14 |
| [[TASK-018]] | Group AgentList by project and react to the new ID-based task SSE events | done | 2026-06-14 |
| [[TASK-019]] | Parameterize daemon launchd plist (log path, node path) and add a systemd user-unit template | done | 2026-06-14 |
| [[TASK-020]] | Sync bin/conductor daemon install to the rendered-template + bootout/bootstrap flow | done | 2026-06-14 |
| [[TASK-021]] | Write install.sh — bash-3.2-safe, idempotent curl\|bash installer | done | 2026-06-14 |
| [[TASK-022]] | Verify install.sh end-to-end into a scratch CONDUCTOR_HOME on macOS | done | 2026-06-14 |
| [[TASK-023]] | Delete dead conf-splice + legacy file-queue code from backend/config.ts and backend/state.ts | done | 2026-06-14 |
| [[TASK-024]] | Strip AGENTS/BG_PROCESSES/AGENT_BG_LINKS/TASK_QUEUE from conductor.conf and retire tasks.txt | done | 2026-06-14 |
| [[TASK-025]] | Update docker-compose mounts, Dockerfile native-build step, and docs for the SQLite data layer | done | 2026-06-14 |
| [[TASK-026]] | Run the end-to-end SQLite-migration verification suite | done | 2026-06-14 |
| [[TASK-027]] | Scaffold portal/ (Fastify, env validation, pg Pool, boot-time migrations) with /healthz | done | 2026-06-14 |
| [[TASK-034]] | shared/relay-protocol.ts frame contract (req/res/body chunks/cancel/err, correlation ids) | done | 2026-06-14 |
| [[TASK-028]] | Dockerfile.portal + deploy/do-app.yaml; document the manual DO deploy + Google OAuth client setup | superseded | 2026-06-14 |
| [[TASK-029]] | Postgres migration 001 — users, devices (hashed tokens), pairing_codes | superseded | 2026-06-14 |
| [[TASK-030]] | Portal Google OIDC sign-in, JWT session cookie, email allowlist, /api/me | superseded | 2026-06-14 |
| [[TASK-036]] | Install react-router-dom in the Vite React frontend | done | 2026-06-14 |
| [[TASK-037]] | Define route tree (/, /projects, /projects/:id) in App.tsx and create page stubs | done | 2026-06-14 |
| [[TASK-038]] | Wrap app in BrowserRouter in main.tsx | done | 2026-06-14 |
| [[TASK-039]] | Create NavBar component with NavLink items for Agents and Projects | done | 2026-06-14 |
| [[TASK-040]] | Replace the static header in App.tsx with the NavBar component | done | 2026-06-14 |
| [[TASK-041]] | Verify and polish active-link styling on NavBar | done | 2026-06-14 |
| [[TASK-042]] | Create /projects route page wrapping ProjectList and AddProjectForm | done | 2026-06-14 |
| [[TASK-043]] | Make each project row in ProjectList a clickable link to /projects/:id | done | 2026-06-14 |
| [[TASK-044]] | Create /projects/:id route page with project header (name, workdir, defaultLaunchCmd) | done | 2026-06-14 |
| [[TASK-045]] | Show agents scoped to this project with a Spawn Agent button on the detail page | done | 2026-06-14 |
| [[TASK-046]] | Show project-scoped task queue on the project detail page | done | 2026-06-14 |
| [[TASK-051]] | Reground ROADMAP-002 portal tasks to app/api paths and better-auth user() FK | done | 2026-06-14 |
| [[TASK-048]] | Invite codes Fastify routes — public validate + admin CRUD | done | 2026-06-14 |
| [[TASK-031]] | app/api pairing-code creation API + rate-limited /pair/redeem (hashed, single-use, 10-min expiry) | done | 2026-06-14 |
| [[TASK-032]] | daemon/pair.ts + daemon/credentials.ts; conductor pair / conductor unpair CLI | done | 2026-06-14 |
| [[TASK-052]] | Daemon connector: outbound WSS client to app/api relay with reconnect/backoff and path-allowlisted proxying | done | 2026-06-14 |
| [[TASK-031]] | app/api pairing-code creation API + rate-limited /pair/redeem (hashed, single-use, 10-min expiry) | done | 2026-06-14 |
| [[TASK-033]] | app/api Devices API: list with connected flag, rename, revoke (ownership-404, revoke closes live connection) | done | 2026-06-14 |
| [[TASK-035]] | app/api WS relay endpoint, user-first connection registry, and mux (lifecycle, fail-all-pending on drop, caps, timeouts) | done | 2026-06-14 |
| [[TASK-047]] | Invite codes Postgres migration + better-auth redemption hook (replace email allowlist gate) | done | 2026-06-14 |
| [[TASK-049]] | Invite codes frontend — two-step signup page + admin list/create UI (react-router-dom) | done | 2026-06-14 |
| [[TASK-053]] | Relay validation milestone: plain JSON request/response working end-to-end (browser → app/api → WSS → daemon → host-server) | done | 2026-06-14 |
| [[TASK-054]] | Relay streaming: SSE pass-through, image-upload request bodies, cancel/backpressure — validated through the DO App Platform edge | done | 2026-06-14 |
| [[TASK-055]] | Wire app/frontend to call conductor endpoints through app/api (the relay) in prod, replacing the dev-only host-server Vite proxy | done | 2026-06-14 |
| [[TASK-056]] | Frontend runtime mode detection (local-direct vs relay) + API_BASE rewire | done | 2026-06-14 |
| [[TASK-057]] | DevicePicker (pairing code + device list/rename/revoke) and Onboarding UI | done | 2026-06-14 |
| [[TASK-058]] | Security hardening + structured logs + device last-seen heartbeat | done | 2026-06-15 |
| [[TASK-059]] | README install one-liner + docs updates (CLAUDE.md, scripts/README, .env.example) | done | 2026-06-14 |
| [[TASK-072]] | live-update timing instrumentation and counters | done | 2026-06-28 |
| [[TASK-073]] | capture current dashboard performance baseline | done | 2026-06-28 |
| [[TASK-075]] | consolidate dashboard EventSource usage | done | 2026-06-28 |
| [[TASK-074]] | identify performance budgets for live updates | done | 2026-06-28 |
| [[TASK-076]] | reduce focused terminal capture overhead | done | 2026-06-28 |
| [[TASK-077]] | remove avoidable duplicate tmux capture work | done | 2026-06-28 |
| [[TASK-078]] | host-server performance regression tests | done | 2026-06-28 |
| [[TASK-079]] | frontend live-update performance checks | done | 2026-06-28 |
| [[TASK-080]] | benchmark documentation and repeatable commands | done | 2026-06-28 |
| [[TASK-081]] | focused terminal WebSocket transport | done | 2026-06-28 |
| [[TASK-082]] | move direct input and focused output onto WebSocket path | done | 2026-06-28 |
| [[TASK-083]] | compare optimized SSE and WebSocket performance | done | 2026-06-28 |
| [[TASK-084]] | add event-loop delay and utilization metrics | done | 2026-07-04 |
| [[TASK-085]] | add tmux operation metrics with owner labels | done | 2026-07-04 |
| [[TASK-086]] | add terminal WebSocket lifecycle counters | done | 2026-07-04 |
| [[TASK-087]] | add input-to-ack and input-to-echo latency metrics | done | 2026-07-04 |
| [[TASK-088]] | enable env-gated Fastify structured request logging | done | 2026-07-04 |
| [[TASK-089]] | add status-transition JSONL records | done | 2026-07-04 |
| [[TASK-090]] | add slow-loop and tmux-timeout JSONL records | done | 2026-07-04 |
| [[TASK-091]] | add focused terminal debug overlay | done | 2026-07-04 |
| [[TASK-092]] | add local diagnostic bundle command | done | 2026-07-04 |
| [[TASK-093]] | extend performance scripts and metric threshold docs | done | 2026-07-04 |
| [[TASK-095]] | focused terminal latency baseline (renumbered from TASK-084) | done | 2026-07-06 |
| [[TASK-096]] | focused transport ownership acceptance criteria (renumbered from TASK-085) | done | 2026-07-06 |
| [[TASK-097]] | focused terminal WebSocket exclusive output and input path (renumbered from TASK-086) | done | 2026-07-06 |
| [[TASK-098]] | Vite dev proxy WebSocket support (renumbered from TASK-087) | done | 2026-07-06 |
| [[TASK-099]] | coalesce focused WebSocket output frames (renumbered from TASK-088) | done | 2026-07-06 |
| [[TASK-100]] | configurable live-update intervals and capture depths (renumbered from TASK-089) | done | 2026-07-06 |
| [[TASK-101]] | tune focused capture defaults from measured data (renumbered from TASK-090) | done | 2026-07-06 |
| [[TASK-102]] | backend-owned agent status contract (renumbered from TASK-091) | done | 2026-07-06 |
| [[TASK-103]] | dashboard status display uses backend status fields (renumbered from TASK-092) | done | 2026-07-06 |
| [[TASK-104]] | duplicate focused-capture regression checks (renumbered from TASK-093) | done | 2026-07-06 |
| [[TASK-105]] | focused input echo-latency regression checks (renumbered from TASK-094) | done | 2026-07-06 |
| [[TASK-060]] | agents table schema — add worktree_path and branch columns | done | 2026-07-06 |
| [[TASK-064]] | Diff endpoint — GET /api/agents/:agent/diff (git diff base-branch..HEAD) | done | 2026-07-06 |
| [[TASK-065]] | Base-branch endpoint — GET /api/agents/:agent/base-branch auto-detects default branch | done | 2026-07-06 |
| [[TASK-067]] | agent_checkpoints table — SQLite schema migration (agent_id, ts, stash_ref) | done | 2026-07-06 |
| [[TASK-061]] | Worktree spawn — detect git repo on agent spawn, create worktree + branch, store in DB | done | 2026-07-06 |
| [[TASK-072]] | agent_usage table — SQLite schema migration + DB helpers | done | 2026-07-06 |
| [[TASK-106]] | agent_terminal_log table — SQLite schema migration + DB helpers | done | 2026-07-06 |
| [[TASK-069]] | Checkpoints list endpoint — GET /api/agents/:agent/checkpoints | done | 2026-07-06 |
| [[TASK-073]] | Per-agent usage extraction — parse Claude Code transcript JSONL each poll (supersedes pane-tail regex) | done | 2026-07-06 |
| [[TASK-107]] | Append terminal output to agent_terminal_log during SSE pane polling | done | 2026-07-06 |
| [[TASK-108]] | GET /api/agents/:id/log endpoint — retrieve full persisted terminal-log history | done | 2026-07-06 |
| [[TASK-063]] | Worktree teardown — git worktree remove --force on agent delete | done | 2026-08-15 |
| [[TASK-075]] | Accumulate rolling token totals per agent in agent_usage — usage-store + pricing table + snapshot exposure | done | 2026-08-15 |
| [[TASK-068]] | Pre-dispatch checkpoint — git stash push before each task dispatch + record in agent_checkpoints | done | 2026-08-15 |
| [[TASK-070]] | Rollback endpoint — POST /api/agents/:agent/rollback | done | 2026-08-15 |
| [[TASK-112]] | Role presets — presets.json config with a per-role CLAUDE.md fragment | done | 2026-08-15 |
| [[TASK-111]] | Role column — add `role` enum to the agents SQLite table (schema v7) | done | 2026-08-15 |
| [[TASK-113]] | Write role fragment into the agent's worktree CLAUDE.md on spawn | done | 2026-08-15 |
| [[TASK-127]] | Add vitest + React Testing Library test harness to frontend/ | done | 2026-08-15 |
| [[TASK-125]] | Soft-delete task pop — status flip to 'done'/completed_at instead of hard DELETE (schema v8) | done | 2026-08-15 |
| [[TASK-131]] | AgentDetailModal terminal-first redesign — collapse Details/Queued Tasks, default Direct Input, double-click fullscreen | done | 2026-08-15 |
| [[TASK-116]] | Verify real task-start latency drops from ~15s worst-case to ~2s under a live agent session | done | 2026-08-22 |
| [[TASK-109]] | History toggle — switch LogTail between live SSE and persisted terminal log | done | 2026-08-24 |
