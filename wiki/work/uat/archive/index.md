# UAT Archive

Terminal UAT files (`passed`, `skipped`, or `trashed`) moved here by `/wiki-archive` to reduce directory clutter. **Append-only** — archived items never move again.

| ID | Title | Final Status | Archived |
|----|-------|--------------|----------|
| [[UAT-004]] | UAT: Phase 1 foundation — SQLite startup, seed import, and idempotency | passed | 2026-06-14 |
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
