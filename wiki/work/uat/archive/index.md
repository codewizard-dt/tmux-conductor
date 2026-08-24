# UAT Archive

Terminal UAT files (`passed`, `skipped`, or `trashed`) moved here by `/wiki-archive` to reduce directory clutter. **Append-only** — archived items never move again.

| ID | Title | Final Status | Archived |
|----|-------|--------------|----------|
| [[UAT-004]] | UAT: Phase 1 foundation — SQLite startup, seed import, and idempotency | passed | 2026-06-14 |
| [[UAT-076]] | UAT: Per-session usage breakdown — GET /agents/:id/usage endpoint + session table in AgentDetailModal | passed | 2026-08-24 |
| [[UAT-062]] | UAT: Branch badge — display branch name on agent card in dashboard | passed | 2026-08-15 |
| [[UAT-009]] | UAT: Create scripts/lib/db.sh — sql wrapper, load_agents, load_bg, pop_task_sql | passed | 2026-06-14 |
| [[UAT-010]] | UAT: Rewrite monitor.sh pop_task as atomic SQL pop and move_to_backlog as status flip | passed | 2026-06-14 |
| [[UAT-013]] | UAT: Migrate conductor.sh, spawn.sh, teardown.sh, broadcast.sh to DB-loaded agent lists | passed | 2026-06-14 |
| [[UAT-014]] | UAT: Rewrite add-task.sh to insert directly via sqlite3 | passed | 2026-06-14 |
| [[UAT-015]] | UAT: Frontend ID-based tasks — lib/api helpers, TaskList per-row delete + jump-to-head, AddTaskForm/AgentList wiring | passed | 2026-06-14 |
| [[UAT-016]] | UAT: Make AddAgentForm project-aware and add ProjectList/AddProjectForm components | passed | 2026-06-14 |
| [[UAT-017]] | UAT: Frontend Schedules UI — ScheduleList + ScheduleForm with live schedule-fired updates | passed | 2026-06-14 |
| [[UAT-018]] | UAT: Group AgentList by project and react to the new ID-based task SSE events | passed | 2026-06-14 |
| [[UAT-019]] | UAT: Parameterize daemon launchd plist (log path, node path) and add a systemd user-unit template | passed | 2026-06-14 |
| [[UAT-020]] | UAT: Sync bin/conductor daemon install to the rendered-template + bootout/bootstrap flow | passed | 2026-06-14 |
| [[UAT-021]] | UAT: Write install.sh — bash-3.2-safe, idempotent curl\|bash installer | passed | 2026-06-14 |
| [[UAT-022]] | UAT: Verify install.sh end-to-end into a scratch CONDUCTOR_HOME on macOS | passed | 2026-06-14 |
| [[UAT-023]] | UAT: Delete dead conf-splice + legacy file-queue code from backend/config.ts and backend/state.ts | passed | 2026-06-14 |
| [[UAT-025]] | UAT: Update docker-compose mounts, Dockerfile native-build step, and docs for the SQLite data layer | passed | 2026-06-14 |
| [[UAT-026]] | UAT: End-to-end SQLite migration verification suite | passed | 2026-06-14 |
| [[UAT-027]] | UAT: Scaffold portal/ (Fastify, env validation, pg Pool, boot-time migrations) with /healthz | passed | 2026-06-14 |
| [[UAT-034]] | UAT: shared/relay-protocol.ts frame contract (req/res/body chunks/cancel/err, correlation ids) | passed | 2026-06-14 |
| [[UAT-036]] | UAT: Install react-router-dom in the Vite React frontend | passed | 2026-06-14 |
| [[UAT-037]] | UAT: Define route tree (/, /projects, /projects/:id) in App.tsx and create page stubs | passed | 2026-06-14 |
| [[UAT-038]] | UAT: Wrap app in BrowserRouter in main.tsx | pending | 2026-06-14 |
| [[UAT-039]] | UAT: Create NavBar component with NavLink items for Agents and Projects | passed | 2026-06-14 |
| [[UAT-040]] | UAT: Replace the static header in App.tsx with the NavBar component | passed | 2026-06-14 |
| [[UAT-041]] | UAT: Verify and polish active-link styling on NavBar | passed | 2026-06-14 |
| [[UAT-042]] | UAT: Create /projects route page wrapping ProjectList and AddProjectForm | passed | 2026-06-14 |
| [[UAT-043]] | UAT: Make each project row in ProjectList a clickable link to /projects/:id | passed | 2026-06-14 |
| [[UAT-044]] | UAT: Create /projects/:id route page with project header | passed | 2026-06-14 |
| [[UAT-045]] | UAT: Show agents scoped to this project with a Spawn Agent button on the detail page | passed | 2026-06-14 |
| [[UAT-046]] | UAT: Show project-scoped task queue on the project detail page | passed | 2026-06-14 |
| [[UAT-047]] | UAT: Reground ROADMAP-002 portal tasks to app/api paths and better-auth user() FK (Skipped) | skipped | 2026-06-14 |
| [[UAT-048]] | UAT: Invite codes Fastify routes — public validate + admin CRUD | passed | 2026-06-14 |
| [[UAT-031]] | UAT: app/api pairing-code creation API + rate-limited /pair/redeem (hashed, single-use, 10-min expiry) | passed | 2026-06-14 |
| [[UAT-032]] | UAT: daemon/pair.ts + daemon/credentials.ts; conductor pair / conductor unpair CLI | passed | 2026-06-14 |
| [[UAT-052]] | UAT: Daemon connector — outbound WSS client to app/api relay with reconnect/backoff and path-allowlisted proxying | passed | 2026-06-14 |
| [[UAT-058]] | UAT: Security checklist pass + structured logs + device last-seen heartbeat | passed | 2026-06-15 |
| [[UAT-059]] | UAT: README install one-liner + docs updates (CLAUDE.md, scripts/README, .env.example) | passed | 2026-06-14 |
| [[UAT-072]] | UAT: live-update timing instrumentation and counters | passed | 2026-06-28 |
| [[UAT-073]] | UAT: capture current dashboard performance baseline | passed | 2026-06-28 |
| [[UAT-075]] | UAT: consolidate dashboard EventSource usage | passed | 2026-06-28 |
| [[UAT-074]] | UAT: identify performance budgets for live updates | passed | 2026-06-28 |
| [[UAT-076]] | UAT: reduce focused terminal capture overhead | passed | 2026-06-28 |
| [[UAT-077]] | UAT: remove avoidable duplicate tmux capture work | passed | 2026-06-28 |
| [[UAT-078]] | UAT: host-server performance regression tests | passed | 2026-06-28 |
| [[UAT-079]] | UAT: frontend live-update performance checks | passed | 2026-06-28 |
| [[UAT-080]] | UAT: benchmark documentation and repeatable commands | passed | 2026-06-28 |
| [[UAT-081]] | UAT: focused terminal WebSocket transport | passed | 2026-06-28 |
| [[UAT-082]] | UAT: move direct input and focused output onto WebSocket path | passed | 2026-06-28 |
| [[UAT-083]] | UAT: compare optimized SSE and WebSocket performance | passed | 2026-06-28 |
| [[UAT-084]] | UAT: add event-loop delay and utilization metrics | passed | 2026-07-04 |
| [[UAT-085]] | UAT: add tmux operation metrics with owner labels | passed | 2026-07-04 |
| [[UAT-086]] | UAT: add terminal WebSocket lifecycle counters | passed | 2026-07-04 |
| [[UAT-087]] | UAT: add input-to-ack and input-to-echo latency metrics | passed | 2026-07-04 |
| [[UAT-088]] | UAT: enable env-gated Fastify structured request logging | passed | 2026-07-04 |
| [[UAT-089]] | UAT: add status-transition JSONL records | passed | 2026-07-04 |
| [[UAT-090]] | UAT: add slow-loop and tmux-timeout JSONL records | passed | 2026-07-04 |
| [[UAT-091]] | UAT: add focused terminal debug overlay | passed | 2026-07-04 |
| [[UAT-092]] | UAT: add local diagnostic bundle command | passed | 2026-07-04 |
| [[UAT-093]] | UAT: extend performance scripts and metric threshold docs | passed | 2026-07-04 |
| [[UAT-095]] | UAT: focused terminal latency baseline (renumbered from UAT-084) | passed | 2026-07-06 |
| [[UAT-096]] | UAT: focused transport ownership acceptance criteria (renumbered from UAT-085) | passed | 2026-07-06 |
| [[UAT-097]] | UAT: focused terminal WebSocket exclusive output and input path (renumbered from UAT-086) | passed | 2026-07-06 |
| [[UAT-098]] | UAT: Vite dev proxy WebSocket support (renumbered from UAT-087) | passed | 2026-07-06 |
| [[UAT-099]] | UAT: coalesce focused WebSocket output frames (renumbered from UAT-088) | passed | 2026-07-06 |
| [[UAT-100]] | UAT: configurable live-update intervals and capture depths (renumbered from UAT-089) | passed | 2026-07-06 |
| [[UAT-101]] | UAT: tune focused capture defaults from measured data (renumbered from UAT-090) | passed | 2026-07-06 |
| [[UAT-102]] | UAT: backend-owned agent status contract (renumbered from UAT-091) | passed | 2026-07-06 |
| [[UAT-103]] | UAT: dashboard status display uses backend status fields (renumbered from UAT-092) | passed | 2026-07-06 |
| [[UAT-104]] | UAT: duplicate focused-capture regression checks (renumbered from UAT-093) | passed | 2026-07-06 |
| [[UAT-105]] | UAT: focused input echo-latency regression checks (renumbered from UAT-094) | passed | 2026-07-06 |
| [[UAT-060]] | UAT: agents table schema — add worktree_path and branch columns | passed | 2026-07-06 |
| [[UAT-064]] | UAT: Diff endpoint — GET /api/agents/:id/diff (git diff base..HEAD) | passed | 2026-07-06 |
| [[UAT-065]] | UAT: Base-branch endpoint — GET /api/agents/:id/base-branch auto-detects default branch | passed | 2026-07-06 |
| [[UAT-067]] | UAT: agent_checkpoints table — SQLite schema migration (agent_id, ts, stash_ref) | passed | 2026-07-06 |
| [[UAT-061]] | UAT: Worktree spawn — detect git repo on agent spawn, create worktree + branch, store in DB | passed | 2026-07-06 |
| [[UAT-072]] | UAT: agent_usage table — SQLite schema migration + DB helpers | passed | 2026-07-06 |
| [[UAT-106]] | UAT: agent_terminal_log table — SQLite schema migration + DB helpers | passed | 2026-07-06 |
| [[UAT-069]] | UAT: Checkpoints list endpoint — GET /api/agents/:id/checkpoints | passed | 2026-07-06 |
| [[UAT-073]] | UAT: Per-agent usage extraction — parse Claude Code transcript JSONL each poll | passed | 2026-07-06 |
| [[UAT-107]] | UAT: Append terminal output to agent_terminal_log during SSE pane polling | passed | 2026-07-06 |
| [[UAT-108]] | UAT: GET /api/agents/:id/log endpoint — retrieve full persisted terminal-log history | passed | 2026-07-06 |
| [[UAT-063]] | UAT: Worktree teardown — git worktree remove --force on agent delete | passed | 2026-08-15 |
| [[UAT-075]] | UAT: Accumulate rolling token totals per agent in agent_usage — usage-store + pricing table + snapshot exposure | passed | 2026-08-15 |
| [[UAT-068]] | UAT: Pre-dispatch checkpoint — git stash push before each task dispatch + record in agent_checkpoints | passed | 2026-08-15 |
| [[UAT-070]] | UAT: Rollback endpoint — POST /api/agents/:agent/rollback | passed | 2026-08-15 |
| [[UAT-112]] | UAT: Role presets — presets.json config with a per-role CLAUDE.md fragment | passed | 2026-08-15 |
| [[UAT-111]] | UAT: Role column — add `role` enum to the agents SQLite table (schema v7) | passed | 2026-08-15 |
| [[UAT-113]] | UAT: Write role fragment into the agent's worktree CLAUDE.md on spawn | passed | 2026-08-15 |
| [[UAT-127]] | UAT: Add vitest + React Testing Library test harness to frontend/ | passed | 2026-08-15 |
| [[UAT-125]] | UAT: Soft-delete task pop — status flip to 'done'/completed_at instead of hard DELETE (schema v8) | passed | 2026-08-15 |
| [[UAT-131]] | UAT: AgentDetailModal terminal-first redesign | passed | 2026-08-15 |
| [[UAT-116]] | UAT: Verify real task-start latency drops from ~15s worst-case to ~2s under a live agent session | passed | 2026-08-22 |
