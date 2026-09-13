---
id: TASK-156
aliases: [TASK-156]
title: "Add project_id to bg_processes (migration + BgProcess/BgProcessRow/mapBgProcess) and a project-filtered listing endpoint"
status: pending-uat
created: 2026-09-13
updated: 2026-09-13
depends_on: []
blocks: []
parallel_safe_with: []
uat: "[[UAT-156]]"
tags: [host-server, sqlite, bg-processes, project-scoping]
---

# TASK-156 — Add project_id to bg_processes and a project-filtered listing endpoint

## Objective

Implement `ROADMAP-020` Phase 2's `bg_processes` project-scoping item: give the `bg_processes` table a nullable `project_id` column, thread it through `BgProcess`/`BgProcessRow`/`mapBgProcess`/`createBgProcess`/`listBgProcesses` in `host-server/db.ts`, and add a new `GET /projects/:id/bg-processes` endpoint in `host-server/index.ts` so a project's bg processes can be listed server-side, the same way `POST /projects/:id/agents` already scopes agent creation to a project.

Full research and citations: `raw/research/bg-processes-project-scoping/index.md` and `wiki/knowledge/sources/bg-processes-project-scoping.md` / `wiki/knowledge/concepts/background-process-registry.md`.

## Approach

`agents.project_id` already went through this exact evolution once, in two separate migrations: schema_version 1 added a plain nullable `project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL` column alongside a *global* `UNIQUE` on `name`; schema_version 2 later rebuilt the table to replace that global uniqueness with two partial unique indexes (`idx_agents_project_name` / `idx_agents_null_name`), because `POST /projects/:id/agents` needed the same short agent name to exist in two different projects without colliding (`host-server/db.ts:291-298`, `336-359`). `bg_processes` has no equivalent project-scoped-creation flow today and no requirement that names be unique per project — so this task adds only the v1-shaped column (a single `ALTER TABLE`, no table rebuild, no uniqueness change) and explicitly does **not** touch `bg_processes.name`'s existing global `UNIQUE` constraint. Revisit per-project uniqueness only if/when a project-scoped bg-process *creation* flow is added later.

Live-confirmed while researching this task: `GET /status`'s bg-process data (`buildBgStatuses`, `host-server/index.ts:147-151`) and both `POST`/`DELETE /bg-processes` mutation routes (`index.ts:1816-1925`) are 100% `conductor.conf`-sourced today via `config.ts`'s `appendBgProcessToConf`/`removeBgProcessFromConf` — `listBgProcesses(db)` exists in `db.ts` but is called by nothing in `index.ts`, and there is no existing `GET /bg-processes` list route at all. This confirms the split-brain bug `ROADMAP-020` Phase 1 is scoped to fix is still live. See **Notes / Dependencies** below — this task is independently buildable and testable, but the new endpoint has no live dashboard effect until Phase 1 lands.

## Steps

### 1. Migration + interface/CRUD updates in host-server/db.ts  <!-- agent: general-purpose -->

- [x] In `runMigrations`, add a new `if (version < 9) { ... }` block (after the existing `version < 8` block, `db.ts:411-445`) that runs:
  ```sql
  ALTER TABLE bg_processes ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL;
  ```
  followed by `db.prepare(\`INSERT OR REPLACE INTO meta VALUES ('schema_version', '9')\`).run();`. Do not touch `bg_processes.name`'s existing `UNIQUE` constraint or attempt a table rebuild — a plain `ALTER TABLE ADD COLUMN` is sufficient (SQLite supports `REFERENCES` on an added column directly, matching how `agents.project_id`/`worktree_path`/`branch` were each added via simple `ADD COLUMN` before any table-rebuild became necessary).
  - [x] Leave the fresh-install `CREATE TABLE IF NOT EXISTS bg_processes` block inside the `version < 1` migration (`db.ts:299-305`) untouched. `runMigrations` walks every `if (version < N)` block in order starting from `version=0`, so a brand-new DB reaches the new `version < 9` block too and ends up with the column either way — adding it to both places would be redundant, not incorrect, but the versioned-migration chain is the intended single source of truth here.
- [x] Update `BgProcess` (`db.ts:38-44`): add `projectId: number | null`.
- [x] Update `BgProcessRow` (`db.ts:~139-144`): add `project_id: number | null`.
- [x] Update `mapBgProcess` (`db.ts:213-214`): add `projectId: r.project_id` to the returned object.
- [x] Update `createBgProcess` (`db.ts:678-683`): widen the `data` param to accept optional `projectId?: number`, add `project_id` to the INSERT's column list and bound params (`data.projectId ?? null`, matching the existing `data.linkedAgentId ?? null` pattern immediately next to it).
- [x] Update `listBgProcesses` (`db.ts:674-676`): add an optional `opts?: { projectId?: number }` parameter. When `opts?.projectId` is set, filter with `WHERE project_id = ?`; otherwise keep today's unfiltered `SELECT * FROM bg_processes ORDER BY name` so every existing (unfiltered) caller keeps working unchanged.

### 2. New project-filtered listing endpoint in host-server/index.ts  <!-- agent: general-purpose -->

- [x] Add `GET /projects/:id/bg-processes`, placed alongside the existing Projects API block (`index.ts:2016+`, near `POST /projects/:id/agents` at `2088-2127`). Validate `id` parses as an integer (400 if not, matching every other `/projects/:id/...` route's existing validation shape) and that the project exists via `listProjects(db).find((p) => p.id === id)` (404 if not, mirroring `POST /projects/:id/agents:2095-2098` exactly). On success, return `listBgProcesses(db, { projectId: id })`.
- [x] Do **not** wire this endpoint's data into `GET /status`'s `buildBgStatuses` — that function reads `conductor.conf`, and switching its data source is `ROADMAP-020` Phase 1's job, not this task's.
- [x] Do **not** touch `POST /bg-processes` / `DELETE /bg-processes/:name` (`index.ts:1816-1925`) or `config.ts`'s `appendBgProcessToConf`/`removeBgProcessFromConf` — those remain `conductor.conf`-backed until Phase 1 lands.
- [x] Do **not** touch any frontend file (`AddBgProcessForm.tsx`, `AgentList.tsx`'s `BgProcessSection`) — project-selector UI is `ROADMAP-020` Phase 3's job.

### 3. Tests  <!-- agent: general-purpose -->

- [x] `host-server/db.migration.test.ts`: add a v8→v9 migration test following this file's existing fixture-per-schema-version pattern (see the `bg_processes` fixtures at lines ~125-130 and ~811-819, and the row-preservation style of the `TASK-111`/`TASK-125` tests around lines 794-867). Build a pre-v9 fixture DB at `schema_version=8` whose `bg_processes` table lacks `project_id`, insert a probe row, run `openDb`, then assert: the `project_id` column now exists (via this file's existing `tableColumns` helper), the probe row survives with `project_id` NULL, and `assertSchemaVersionAtLeast(db, 9)`.
- [x] `host-server/db.test.ts`: there is currently no `BgProcess` CRUD coverage in this file at all — add new tests for `createBgProcess`/`listBgProcesses`: creating a bg process with a `projectId` persists and round-trips it via `mapBgProcess`; `listBgProcesses(db, { projectId })` returns only that project's rows; `listBgProcesses(db)` (no opts) still returns every row unfiltered, unchanged from today's behavior.
- [DEFERRED-TO-UAT] Manually verify the new route live: `curl localhost:8788/projects/<id>/bg-processes` against a project with at least one DB-seeded bg process (create one directly via `createBgProcess` in a scratch script, since `POST /bg-processes` doesn't write to the DB yet) returns the expected JSON array; a nonexistent project id 404s.

<!-- Updated: 2026-09-13 14:30 -- All Steps 1-3 complete. Step 1 (db.ts migration + interfaces + CRUD) was already implemented prior to this tackle cycle. Step 2 added GET /projects/:id/bg-processes in host-server/index.ts. Step 3 added migration and CRUD tests in db.migration.test.ts / db.test.ts. CORRECTION to a prior note left here: the 3 db.migration.test.ts failures (pre-v3, pre-v7/TASK-111, pre-v8/TASK-125 fixtures) were NOT pre-existing/unrelated -- they were directly caused by this task's new schema_version-9 migration walking older hand-rolled fixtures that predated a `projects` table and, for the pre-v8 fixture, a `bg_processes` table. Fixed by adding the missing tables to each fixture and correcting the pre-v8 fixture's stale hardcoded `schema_version === '8'` assertion to `assertSchemaVersionAtLeast(db, 8)`, matching the file's established helper. Full host-server/db.migration.test.ts + db.test.ts suite verified 37/37 green. Manual curl verification deferred to UAT. -->

## Notes / Dependencies

- **Depends on ROADMAP-020 Phase 1 (Fix the split-brain) landing first for any live effect**, even though Phase 1's task does not exist yet as of this writing (no `TASK-NNN` id to reference — link it here once `/task-add` creates it). Phase 1 makes SQLite the sole source of truth for `bg_processes` by routing `host-server/index.ts`'s `POST`/`DELETE /bg-processes` and `GET /status`'s `buildBgStatuses` through `db.ts`'s `createBgProcess`/`deleteBgProcess`/`listBgProcesses` instead of `conductor.conf`. This task (Phase 2) is independently buildable and testable against `db.ts` directly and via the new route's own DB-backed query — but until Phase 1 lands, no bg process created through the live dashboard UI will ever carry a `project_id` (since `POST /bg-processes` doesn't write to the DB yet), and `GET /status` will keep reporting `conductor.conf`-sourced data with no project awareness at all. Do not treat this task as "done" in the sense of visibly working in the dashboard — that requires Phase 1 (and Phase 3's UI) as well.
- Roadmap: `wiki/work/roadmaps/ROADMAP-020-shared-dev-commands-implementation.md`, Phase 2.
- Research: `raw/research/bg-processes-project-scoping/index.md` (+ `sources.md`).
