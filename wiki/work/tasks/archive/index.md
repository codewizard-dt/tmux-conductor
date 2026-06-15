# Tasks Archive

Terminal task files (`done` or `trashed`) moved here by `/wiki-archive` to reduce directory clutter. **Append-only** — archived items never move again.

| ID | Title | Final Status | Archived |
|----|-------|--------------|----------|
| [[TASK-002]] | Add better-sqlite3 dependency, data/ gitignore entry, and DB_PATH setting | done | 2026-06-14 |
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
