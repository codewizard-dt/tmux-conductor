---
id: TASK-126
aliases: [TASK-126]
title: "Task history view — dashboard page reading completed tasks"
status: pending-uat
created: 2026-08-15
updated: 2026-08-21
depends_on: [TASK-125]
blocks: []
parallel_safe_with: [TASK-122, TASK-123, TASK-124]
uat: "[[UAT-126]]"
tags: [frontend, host-server, ui, roadmap-017]
---

# TASK-126 — Task history view — dashboard page reading completed tasks

depends_on::[[TASK-125]]

## Objective

Add a task history view to the dashboard that reads and displays completed tasks (`status='done'` rows, with their `completed_at` timestamp) — the read-side companion to [TASK-125](TASK-125-soft-delete-task-pop.md)'s write-side change from hard-`DELETE` to soft status flip.

## Hard dependency — do not start before TASK-125 lands

There is **no completed-task data to read** until TASK-125's soft-flip migration is live: today, popping a task hard-deletes the row, so `status='done'` rows do not exist and never will until that migration ships. Confirm TASK-125 is `status: done` (check `wiki/work/tasks/archive/TASK-125-soft-delete-task-pop.md` or its still-active file) before beginning implementation — starting early means building against a schema (`tasks.completed_at`, `status='done'`) that doesn't exist yet.

## Approach

**Backend — new read endpoint.** Add a query function in `host-server/db.ts` (e.g. `listCompletedTasks(db, opts?: { agentId?: number; projectId?: number; limit?: number })`) following the existing pattern of `listTasksForAgentId`/`listTasksByProject` (confirm their exact signatures via `mcp__serena__find_symbol` before writing the new one — mirror their style, e.g. ordering, parameter shape). Query `SELECT * FROM tasks WHERE status='done' ORDER BY completed_at DESC` (optionally scoped by `agent_id`/`project_id`), and expose it as a new route, e.g. `GET /agents/:id/task-history` or a global `GET /tasks/history` (decide based on whether the UI wants a global history view, a per-agent one, or both — the roadmap text just says "a task history view," not scoped to one agent, so a global endpoint with optional `?agentId=`/`?projectId=` filters is likely the more useful shape). **Routes are `/api`-prefixed** — the route registers without the prefix inside `host-server/index.ts`'s `fastify.register((api) => {...}, { prefix: '/api' })` block (same as every other route in that file; confirmed at `host-server/index.ts:2087` in earlier UAT-076 research), so it's reachable at `GET /api/agents/:id/task-history` (or `GET /api/tasks/history`), not the bare path.

**Frontend — where the view lives.** This app uses `react-router-dom` with routes defined in `frontend/src/App.tsx` (`/`, `/projects`, `/projects/:id`, all wrapped by `<NavBar />`). A dedicated `/history` route (new `TaskHistoryPage` component, mirroring `ProjectsPage`'s existing shape) is the most discoverable placement, with a `NavBar` link added alongside the existing nav items — confirm `NavBar.tsx`'s current link list via `mcp__serena__get_symbols_overview` before adding to it (TASK-122 also touches `NavBar.tsx` for the dark-mode toggle; re-read immediately before editing to avoid clobbering that concurrent change). Render one row per completed task: command text, which agent/project it ran under, and `completed_at` — reuse `AgentList.tsx`'s existing `formatSessionStart`-style compact-timestamp helper if it's still there and applicable, or write a small local one; do not duplicate a full date-formatting library for this.

**Verification is human-gated for the UI half**, same as the rest of Phase 3 — no frontend test runner exists in this repo. The new backend query/route, however, is genuinely machine-verifiable via live curl (same pattern UAT-076 used for `GET /agents/:id/usage`) and via a repeatable unit test on the new `listCompletedTasks` db.ts function (same pattern as `host-server/db.migration.test.ts`'s existing task-focused tests) — `/uat-generate` should split this task's cases the same way UAT-076 split TASK-076's, maximizing the machine-checkable half.

## Steps

### 1. Confirm TASK-125 has landed  <!-- agent: Explore -->

- [x] Confirm `wiki/work/tasks/archive/TASK-125-soft-delete-task-pop.md` exists with `status: done` (or the active file shows `status: done` if not yet archived). If not landed, STOP — do not proceed with implementation.
- [x] `mcp__serena__find_symbol` on `listTasksForAgentId`/`listTasksByProject` in `host-server/db.ts` (`include_body=true`) to confirm the exact query-helper pattern to mirror.

Findings: TASK-125 archived at `wiki/work/tasks/archive/TASK-125-soft-delete-task-pop.md`, `status: done`. `host-server/db.ts` confirms soft-flip landed in code: `tasks.completed_at TEXT` column exists (v8 migration, ~line 430), `popTask` (~lines 757-766) does `UPDATE tasks SET status='done', completed_at=strftime(...)`. Pattern to mirror: `db.prepare(sql).all(...params) as TaskRow[]` then `.map(mapTask)`. Gap flagged: `Task` interface (~line 45-55) types `status: 'queued' | 'backlog'` only, no `completedAt` field, and `mapTask` (~lines 215-221) doesn't map `completed_at` — `listCompletedTasks` needs either a widened `Task['status']` + `completedAt` field, or its own row-based shape exposing `completed_at`.

### 2. Add the backend query + route  <!-- agent: general-purpose -->

- [x] Add `listCompletedTasks(db, opts?)` to `host-server/db.ts`, querying `status='done'` rows ordered by `completed_at DESC`, following the Step 1 pattern.
- [x] Add a new route in `host-server/index.ts` (hot file — re-read the target insertion point immediately before editing) exposing the query, following the shape of an adjacent simple `GET` route (e.g. the `/agents/:id/usage` route TASK-076 added, or `/agents/:id/skills`) for error-handling/response conventions.

Findings: `listCompletedTasks(db, opts?: { agentId?, projectId?, limit? })` added to `host-server/db.ts` (~line 694-718), builds `WHERE status='done'` + optional `agent_id`/`project_id`/`LIMIT` clauses, `ORDER BY completed_at DESC`, mirrors `.prepare().all() as TaskRow[]` → `.map(mapTask)` pattern. `Task` interface widened (`status` now includes `'done'`, added `completedAt?: string | null`); `TaskRow`/`mapTask` updated to carry `completed_at`. Route `GET /tasks/history` added in `host-server/index.ts` (~line 851-873), inside the `/api`-prefixed block → reachable at `GET /api/tasks/history?agentId=&projectId=&limit=`, returns a bare `Task[]` JSON array (matches the adjacent `GET /tasks` route's shape). `cd host-server && npx tsc --noEmit` — zero errors.

### 3. Add the frontend history view  <!-- agent: general-purpose -->

- [x] Add a `TaskHistoryPage` component (or similar) and wire a `/history` route into `frontend/src/App.tsx`.
- [x] Add a nav link in `frontend/src/components/NavBar.tsx` (re-read immediately before editing — concurrently touched by TASK-122).
- [x] Render the fetched completed-task list: command, agent/project, formatted `completed_at`.

Findings: `frontend/src/pages/TaskHistoryPage.tsx` added (fetches `fetchTaskHistory()` + `listProjects()`, uses existing `useAgents()` hook for names, reuses `formatSessionStart` from `AgentList.tsx`, mirrors `ProjectsPage` structure). `/history` route wired into `frontend/src/App.tsx`. `NavBar.tsx` re-read fresh via Serena before editing — confirmed TASK-122's theme toggle button already present; added a single additive `<NavLink to="/history">History</NavLink>` alongside `Agents`/`Projects`, nothing removed/reordered. `frontend/src/lib/api.ts`: extended `Task` interface (`status` now includes `'done'`, added `completedAt?: string | null`) and added `fetchTaskHistory(opts?)` following the `apiFetch` convention. `npx tsc --noEmit` and `npm run build` in `frontend/` both pass clean.

### 4. Typecheck, build, smoke  <!-- agent: general-purpose -->

- [x] `npx tsc --noEmit` in `host-server/` and `frontend/` — zero errors in both.
- [x] `npm run build` in `frontend/` — clean (only a pre-existing >500kB chunk-size advisory, unrelated to this change).
- [DEFERRED-TO-UAT] With `make dev` running and at least one task popped since TASK-125 landed, open `/history` and confirm it lists that task with a sensible timestamp. Runtime/E2E verification is out of scope for /tackle; deferred to UAT.

<!-- Updated: 2026-08-21 -->

## Acceptance Criteria

- [ ] A new backend endpoint returns completed (`status='done'`) tasks, newest first, reachable under the `/api` prefix.
- [ ] A new dashboard view/page displays the completed-task list (command, agent/project, completion time).
- [ ] The view is reachable via dashboard navigation (not a hidden/undiscoverable route).
- [ ] `npx tsc --noEmit` passes in both `host-server/` and `frontend/`; `npm run build` is clean in `frontend/`.

## Dependencies

- **DEPENDS ON [TASK-125](TASK-125-soft-delete-task-pop.md)** — no completed-task data exists to read until the soft-flip migration lands. Do not start before TASK-125 is `done`.
- **Parallel-safe with** [TASK-122](TASK-122-dashboard-dark-mode.md), [TASK-123](TASK-123-replace-confirm-dialogs.md), [TASK-124](TASK-124-agentlist-text-filter.md) — different concerns, though this task and TASK-122 both touch `frontend/src/components/NavBar.tsx`; re-read immediately before editing.

### Roadmap

Implements ROADMAP-017 Phase 3, item "Add a task history view in the dashboard reading completed tasks" — `wiki/work/roadmaps/ROADMAP-017-competitive-audit-followups.md`.
