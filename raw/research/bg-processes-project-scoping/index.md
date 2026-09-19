---
topic: "Add project_id to bg_processes (migration + BgProcess/BgProcessRow/mapBgProcess) and a project-filtered listing endpoint, per ROADMAP-020 Phase 2"
slug: bg-processes-project-scoping
researched: 2026-09-13
sources: [./sources.md]
---

# Research: bg_processes project scoping (ROADMAP-020 Phase 2)

> Add a nullable `project_id` column to `bg_processes` via a simple `ALTER TABLE` migration (schema_version 9), mirroring the *v1* shape of `agents.project_id` (not the later v2 unique-index rebuild — that rebuild only exists because per-project agent creation needed name uniqueness scoped to project, and nothing today requires bg-process names to be unique per project). Add the new listing endpoint as `GET /projects/:id/bg-processes`, mirroring the existing `POST /projects/:id/agents` project-scoped precedent, backed by a new `listBgProcesses(db, { projectId })` filter. Scope this task strictly to `host-server/db.ts` (interfaces, migration, CRUD signatures) and the one new route in `host-server/index.ts` — do not touch `conductor.conf`/`config.ts`, the `GET /status` bg-process path, or any frontend file, all of which belong to Phase 1 (split-brain fix) and Phase 3 (UI/UX) respectively.

## Research Questions
- What is the exact current shape of `bg_processes` and how did `agents.project_id` get introduced/evolved?
- Is there already a GET listing endpoint for bg-processes, and where does live bg-process data actually come from today?
- Should `bg_processes.name` move to the same per-project partial-unique-index pattern `agents` uses, or is a plain nullable column sufficient?
- What is the correct shape/location for the new "project-filtered listing endpoint," and what should this task explicitly NOT touch?

## Current State (Codebase)

- `bg_processes` schema (schema_version 1, `host-server/db.ts:299-305`): `id`, `name TEXT NOT NULL UNIQUE CHECK (name GLOB '[A-Za-z0-9_-]*')`, `workdir`, `launch_cmd`, `linked_agent_id INTEGER REFERENCES agents(id) ON DELETE SET NULL`. No `project_id` column exists.
- `agents.project_id` was introduced in the very first migration (schema_version 1, `db.ts:291-298`) as a plain `INTEGER REFERENCES projects(id) ON DELETE SET NULL` alongside a *global* `UNIQUE` on `name` — identical shape to what `bg_processes` has today. Only later, in schema_version 2 (`db.ts:336-359`), did agents move to per-project uniqueness (`idx_agents_project_name` / `idx_agents_null_name` partial unique indexes via a full table rebuild), because `POST /projects/:id/agents` needed to allow the same short agent name to exist in two different projects without colliding. `bg_processes` has no equivalent project-scoped-creation flow today, so this second-stage rebuild is not warranted yet.
- `BgProcess`/`BgProcessRow`/`mapBgProcess` (`db.ts:38-44`, `~139-144`, `213-214`) carry no project fields. `createBgProcess`/`deleteBgProcess`/`listBgProcesses` (`db.ts:674-687`) are simple, unfiltered CRUD with no `projectId` parameter anywhere.
- **Split-brain confirmed live**: `GET /status`'s bg-process data (`buildBgStatuses`, `index.ts:147-151` and its caller at `index.ts:2404`) is built entirely from `conf.bgProcesses` — i.e. from `conductor.conf` via `readConductorConf()` — never from `listBgProcesses(db)`. `POST /bg-processes` and `DELETE /bg-processes/:name` (`index.ts:1816-1925`) likewise write to `conductor.conf` via `appendBgProcessToConf`/`removeBgProcessFromConf` (`config.ts:234`, `254`), not to the DB. The DB's `bg_processes` table is only ever populated once, by `seedFromLegacy` (`db.ts:448-481`) on first boot, and is otherwise dormant. There is currently **no `GET /bg-processes` (list) endpoint at all** — the frontend (`frontend/src/components/AgentList.tsx:1349-1421`) gets bg-process data exclusively through `GET /status`'s `bgProcesses` field and the `bg-update`/`bg-removed` SSE events (`index.ts:2547-2558`), both sourced from `conf`, not `db.ts`.
- This confirms the roadmap's own sequencing: Phase 1 (split-brain fix — route `POST`/`DELETE /bg-processes` and `GET /status` through `db.ts` instead of `conductor.conf`) has **not landed yet**. Phase 2's new `project_id` column and listing endpoint will be correct and testable in isolation (against `listBgProcesses`/`createBgProcess` directly, and via `db.test.ts`/`db.migration.test.ts`), but will have **no live effect on the dashboard** until Phase 1 lands and something (`GET /status` or its replacement) actually reads bg-process state from the DB.
- `POST /projects/:id/agents` (`index.ts:2089-2127`) is the established precedent for a project-scoped creation route: validates the project exists via `listProjects(db).find(...)`, 404s if not, then calls into `db.ts` with `projectId: id`. No equivalent `GET /projects/:id/agents` currently exists either — the frontend gets project-scoped agents by filtering the full `GET /agents` list client-side using each `Agent.projectId`/`projectName` field. This is a second viable pattern (filter client-side off a flat list) but the roadmap explicitly asks for "a project-filtered listing endpoint," which reads as a request for server-side filtering — consistent with mirroring `POST /projects/:id/agents` as `GET /projects/:id/bg-processes`.

## Key Findings

1. `agents`'s `project_id` evolution happened in **two separate migrations** (v1: plain nullable column + global unique name; v2: per-project unique-index rebuild), driven by a *creation-flow* requirement (`POST /projects/:id/agents` needing duplicate names across projects), not by the mere existence of `project_id` [S1]. `bg_processes` has no such creation-flow requirement yet — Phase 2's line item covers only the DB column and a listing endpoint, not project-scoped bg-process creation. Reusing the *v1* shape only is the closer match to what's actually being asked for. Uniqueness scoping can be its own follow-up if/when project-scoped bg-process creation becomes a requirement (likely Phase 3 or 4 territory).
2. `GET /status`'s bg-process branch and both bg-process mutation routes are 100% `conductor.conf`-sourced today, confirmed by direct inspection of `buildBgStatuses`, `POST /bg-processes`, and `DELETE /bg-processes/:name` [S2]. `listBgProcesses(db)` exists but nothing in `index.ts` currently calls it. This is exactly the split-brain ROADMAP-020 Phase 1 is scoped to fix, and it means Phase 2's new column/endpoint is necessarily inert in production until Phase 1 lands — the task should say so explicitly rather than implying it will change dashboard behavior on its own.
3. There is no existing `GET /bg-processes` list route of any kind [S2] — the "project-filtered listing endpoint" is wholly new surface, not a filter added to something pre-existing. The most consistent shape given the codebase's own precedent (`POST /projects/:id/agents`) is `GET /projects/:id/bg-processes`, not a query-param variant on a currently-nonexistent flat `GET /bg-processes`.
4. `db.migration.test.ts` (`host-server/db.migration.test.ts:125-130`, `811-813`) already has a fixture-based pattern for testing `bg_processes` across schema versions (a hand-rolled pre-v3 CREATE TABLE fixture, and a v7-shaped fixture at line 811) — any new migration test should follow this file's existing fixture-per-version style rather than inventing a new one [S3].

## Constraints

- Must follow the existing schema-version-gated migration pattern in `runMigrations` (`db.ts:278-446`): a new `if (version < 9) { ... }` block ending in `INSERT OR REPLACE INTO meta VALUES ('schema_version', '9')`.
- `better-sqlite3` + `strict: true` TypeScript — row/interface shapes must stay in lockstep (`BgProcessRow` ↔ `BgProcess` ↔ `mapBgProcess`), matching how `AgentRow`/`Agent`/`mapAgent` already handle a nullable FK-derived field (`projectId: number | null`, plus a joined `projectName` for `Agent` — `bg_processes` doesn't need a joined name field unless a route needs to display it, which this task's scope doesn't require).
- `createBgProcess`'s existing signature (`data: { name; workdir; launchCmd; linkedAgentId? }`) should gain an optional `projectId?: number` for forward compatibility, but note: the only route that calls `createBgProcess` today (`POST /bg-processes`, `index.ts:1816`) doesn't touch the DB at all yet (Phase 1 territory) — wiring `projectId` through that specific route is out of scope for this task.
- `wiki/guides/mcp-tools.md` / this session's rules: all code edits via Serena, no shell-based file edits.

## Recommendation

**Migration (schema_version 9)**, appended after the existing `version < 8` block in `runMigrations`:
```sql
ALTER TABLE bg_processes ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL;
```
No table rebuild needed (SQLite supports `ADD COLUMN` with a REFERENCES clause directly, same as agents v1's approach before its v2 rebuild). Leave the existing `UNIQUE` on `name` untouched — do not scope it per-project in this task.

**Interfaces** (`db.ts`):
- `BgProcess`: add `projectId: number | null`.
- `BgProcessRow`: add `project_id: number | null`.
- `mapBgProcess`: add `projectId: r.project_id`.
- `createBgProcess`'s `data` param: add optional `projectId?: number`, pass `data.projectId ?? null` into the INSERT (column list grows to include `project_id`).
- `listBgProcesses`: add an optional `opts?: { projectId?: number }` parameter; when set, filter with `WHERE project_id = ?`, else keep today's unfiltered `SELECT * FROM bg_processes ORDER BY name` behavior — this keeps existing callers (e.g. `seedFromLegacy`, if it ever reads back) untouched.

**Endpoint** (`index.ts`), placed alongside the existing Projects API block (`index.ts:2016+`):
```
GET /projects/:id/bg-processes
```
Validate `id` parses and the project exists (404 otherwise), mirroring `POST /projects/:id/agents`'s existing validation exactly (`index.ts:2089-2098`), then return `listBgProcesses(db, { projectId: id })`.

**Explicitly out of scope for this task** (leave to Phase 1/3):
- Wiring `POST /bg-processes` / `DELETE /bg-processes/:name` to read/write the DB instead of `conductor.conf` (Phase 1).
- Making `GET /status` / `buildBgStatuses` source bg-process data from the DB (Phase 1).
- Any frontend change — `AddBgProcessForm.tsx`, `BgProcessSection` (Phase 3).
- Per-project unique-index rebuild for `bg_processes.name` (no current requirement; revisit only if/when project-scoped bg-process *creation* is added).

**Risks / mitigations**:
- Risk: the new endpoint appears "dead" (no UI consumes it) until Phase 1 + Phase 3 land — mitigate by stating this plainly in the task so it isn't mistaken for a bug during UAT.
- Risk: forgetting the `db.migration.test.ts` fixture-per-version convention — mitigate by adding a v8→v9 migration test following the existing `bg_processes` fixtures at lines 125-130 / 811-813.

## Next Steps

- `/task-add` a task scoped to exactly: `db.ts` migration (schema_version 9) + `BgProcess`/`BgProcessRow`/`mapBgProcess`/`createBgProcess`/`listBgProcesses` updates + `GET /projects/:id/bg-processes` route + migration/route tests. Depends on Phase 1 (split-brain fix) landing first for the endpoint to have any live effect, though the schema/route work is independently buildable and testable.
