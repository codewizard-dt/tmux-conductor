---
id: TASK-0196
aliases: [TASK-0196]
title: "Implement per-project bg process name uniqueness with a derived project-name slug identity"
status: done
created: 2026-09-19
updated: 2026-09-20
depends_on: [TASK-0188]
blocks: []
parallel_safe_with: [TASK-0189, TASK-0191, TASK-0192]
uat: "[[UAT-0196]]"
tags: [bg-processes, migration, project-scoping, roadmap-0024]
---

# TASK-0196 — Implement per-project bg process name uniqueness with a derived project-name slug identity

relates_to::[[ROADMAP-0024]]
relates_to::[[background-process-registry]]
relates_to::[[TASK-0186]]
relates_to::[[TASK-0187]]
relates_to::[[TASK-0190]]
relates_to::[[TASK-0193]]
relates_to::[[TASK-0195]]
depends_on::[[TASK-0188]]

> Implementation follow-up to the decision recorded in `TASK-0188` (Option B). It deliberately does **not** block `TASK-0190`: the restart route keys by slug through the shared slug resolver, which can land in either order. Coordinate the `bg_processes` rebuild with `TASK-0187` (if that decision also needs a rebuild, fold both into the same schema version) and with `TASK-0195` (both touch the `POST/PATCH /bg-processes` handlers).

## Objective

`bg_processes.name` is globally `UNIQUE`, so two projects cannot each own a process called `dev`. Make names unique **per project**, and make the addressable identity a derived slug `<projectName>-<name>` (bare `name` when the row has no project), mirroring `agentWindowName()` in `host-server/db.ts:33-35`. The slug becomes the identity for the tmux window name, `$LOG_DIR/bg-<slug>.log`, `$STATE_DIR/bg-<slug>.state`, the `/bg-processes/:slug` routes, SSE events, and `dev-commands.sh status|tail`.

## Approach

- **Schema**: schema_version 10 rebuilds `bg_processes` (v2 `agents` / v8 `tasks` pattern: `foreign_keys=OFF`, one transaction, `CREATE bg_processes_v10`, explicit-column `INSERT ... SELECT` preserving `id`, `DROP`, `RENAME`, `foreign_keys=ON`). The column-level `UNIQUE` on `name` is dropped, the `GLOB` `CHECK` is kept, and a single unique index replaces it: `idx_bg_processes_project_name ON bg_processes(project_id, name)`. **Amended 2026-09-20 (TASK-0186 amendment):** every bg process must have a project, so the same rebuild makes `project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE` and backfills existing `NULL` rows from a workdir-to-project match first (the second partial index for `NULL`-project rows is no longer needed; there are no such rows). The migration must fail with a message listing any row it cannot match rather than dropping it. `TASK-0195` owns the backfill rules and the route-level tmux cleanup; this task owns the DDL.
- **Slug rule**: `bgSlug(bg, projectName) = \`${projectName}-${bg.name}\`` (a project is always present). `-` is legal in both project and process names, so different `(project, name)` pairs can produce the same slug (project `dev` + name `stack` versus name `dev-stack`). Create must therefore reject a slug that collides with another bg slug **or** an existing agent window name (agent and bg windows share one tmux session namespace; `TASK-0182`'s exact-match `windowTarget()` only removes the prefix hazard, not equality).
- **Slug changes**: a `PATCH` that changes `projectId` changes the slug (window, log, state names). Reject it with 409 while the window is present; when the window is closed the rename is metadata-only (legacy log/state files stay behind and are ignored).
- **No project-less rows** (per `TASK-0186`'s 2026-09-20 amendment): `project_id` is `NOT NULL` after this migration, so there is no bare-name slug case.
- **Existing data**: the live DB has 2 rows (`dev` project 10, `dev-stack` project 3), 0 with `NULL` project. After upgrade the slugs change, so already-running bare-name windows are not matched; recreate them via `POST /bg-processes/:slug/window`. Renaming legacy `bg-<name>.log|state` files is best-effort (see step 6).

## Steps

### 1. Migration and DB helpers  <!-- agent: general-purpose -->

- [x] (done as schema v11, not v10: v10 had already shipped; NOT NULL enforced when every row has a project, otherwise deferred to idempotent non-versioned `enforceBgProjectRequired` at openDb + partial `WHERE project_id IS NULL` unique index; never fails startup) In `host-server/db.ts` `runMigrations` add `if (version < 10)` rebuilding `bg_processes` per Approach (preserve `id`, `name`, `workdir`, `launch_cmd`, `linked_agent_id`, `project_id`; keep `linked_agent_id REFERENCES agents(id) ON DELETE SET NULL` unless `TASK-0198` lands in the same rebuild (then drop it); make `project_id NOT NULL REFERENCES projects(id) ON DELETE CASCADE` after the workdir backfill from `TASK-0195`, aborting with a list of unmatched rows), then create the single `(project_id, name)` unique index and set `schema_version='10'`
- [x] Add `bgSlug(bg, projectName)` and `getBgBySlug(db, slug)` (joins `projects` for the name; returns `BgProcess` plus `projectName`) next to `agentWindowName` in `host-server/db.ts`; export a `listBgSlugs(db)` used for collision checks
- [x] (seed now resolves project by exact workdir match via `matchProjectIdByWorkdir`, else skips the row with a warning; fresh DBs have no projects so conf-seeded bg rows are skipped) Fix `seedFromLegacy` (`host-server/db.ts` ~467-468): `INSERT OR IGNORE INTO bg_processes` no longer relies on a global `UNIQUE`; make the legacy seed skip an existing `(NULL project, name)` row explicitly and keep the link-by-name update scoped to that row
- [x] Add a faithful pre-v10 fixture to `host-server/db.migration.test.ts` (real v1 `name TEXT NOT NULL UNIQUE CHECK (name GLOB '[A-Za-z0-9_-]*')`, not the bare fixtures used by the pre-v3/pre-v8 tests; set `legacy_import='1'`) asserting: row count and every column preserved, `id`s stable, cross-project duplicate names accepted, same-project duplicate rejected, `NULL`-project rows are backfilled from workdir (and the migration fails naming any unmatched row), deleting a project cascades to its bg rows, and `linked_agent_id` survives
- [x] Add `host-server/db.test.ts` cases for `bgSlug` (project, no project, hyphenated names) and `getBgBySlug`

<!-- Updated: 2026-09-20 step 1 done. Notes: bgSlug/getBgBySlug/listBgSlugs exported from db.ts; BgProcess.projectId stays number|null (deferred-nullable state possible), so callers must not assume non-null; linked_agent_id kept (TASK-0198 adds v12 via rebuildBgProcesses, must handle both nullable/NOT NULL table shapes and keep enforceBgProjectRequired in sync). -->

### 2. Host-server routes and status  <!-- agent: general-purpose -->

- [x] In `host-server/index.ts` replace every `listBgProcesses(db).find(b => b.name === name)` with `getBgBySlug` and treat the `:name` route param as the slug: `PATCH /bg-processes/:name`, `DELETE /bg-processes/:name`, `POST /bg-processes/:name/window`, `DELETE /bg-processes/:name/window` (rename the param to `:slug` in the handlers)
- [x] `POST /bg-processes`: replace the global duplicate check (~1910) with a per-project check plus the slug-collision check against all bg slugs and all `agentWindowName` values (409 with a message naming the colliding slug); use the slug for `isTmuxWindowPresent`, `new-window -n`, `send-keys`/`windowTarget`, and the `pipe-pane` log path (~1913-1938)
- [x] `PATCH /bg-processes/:name`: reject with 409 when the change alters the slug (project change) while the window is present
- [x] `buildBgStatuses` (~149-174): compute `slug`, build `statePath`/`logPath` as `bg-${slug}.state|log`, use the slug for the window lookup, and add `slug` to `BgStatus`; keep `name` for display
- [x] State unlink (~2006, ~2059), window respawn (~2031-2033), SSE `bg-update`/`bg-removed` (~2408-2409, ~2689-2697) key by slug and carry `slug` in the payload
- [x] Add `host-server` unit tests for the slug-collision predicate (extract it as a pure function, for example `bgSlugCollides(slug, bgSlugs, agentWindowNames)`)

<!-- Updated: 2026-09-20 step 2 done. Notes: `bgSlugCollides` in db.ts; BgStatus now has `slug`; GET /bg-processes/:slug/tail returns {slug,name,...}; SSE bg-removed = {slug,name}; POST 201 bg gained slug; DELETE /projects/:id `removedBgProcesses` still bare names. -->

### 3. Shell scripts  <!-- agent: general-purpose -->

- [x] `scripts/lib/db.sh` `load_bg` (~86-97): select the slug (`COALESCE(p.name || '-' || b.name, b.name)` with `LEFT JOIN projects p ON p.id=b.project_id`) as the first column and key `BG_NAMES`/`BG_DIRS`/`BG_CMDS` by it; `load_agents` (~67-80): make the `AGENT_BG` join emit the slug too
- [x] (conductor/spawn/teardown needed no edits: they already derive every name/path from BG_NAMES/AGENT_BG values, which are now slugs; monitor.sh comments only) `scripts/conductor.sh` (bg loop ~90-97, `CONDUCTOR_BG_LOG`/`CONDUCTOR_BG_STATE` ~63, ~81), `scripts/spawn.sh` (~51-54, ~68-71, ~87), `scripts/monitor.sh` (~571-580, `bg-$bg_name.state`), `scripts/teardown.sh` (~31-34): every window name, `pipe-pane` log path and state path uses the slug (variable names may stay `name`; the loaded value is the slug)
- [x] (verify-teardown-window-mapping.sh fixture updated with project_id + (project_id,name) index; verify-dev-commands.sh unchanged) `bash -n` on every touched script; update `scripts/verify-teardown-window-mapping.sh` and `scripts/verify-dev-commands.sh` fixtures only if they hard-code a bare-name assumption that the change breaks

<!-- Updated: 2026-09-20 step 3 done. -->

### 4. dev-commands skill  <!-- agent: general-purpose -->

- [x] `skills/dev-commands/scripts/dev-commands.sh`: `list` prints slugs (online via `.bgProcesses[].slug`, offline from the `bg-*.state` glob, already slugs after this change); `status <slug>`/`tail <slug>` use `bg-<slug>.state|log` and match `.slug` (not `.name`) in the jq select; an unknown argument prints the closest candidates from `list`
- [x] (ambiguous exits 2, unknown exits 1; exact slug wins over suffix match) Accept a bare `name` only when exactly one registered slug ends in `-<name>` or equals `<name>`; when several match, exit non-zero and list the candidates (ROADMAP-0024 Phase 3 project defaulting will later narrow this by the caller's project)
- [x] Update `skills/dev-commands/SKILL.md` (~line 58 example) to describe slugs

<!-- Updated: 2026-09-20 step 4 done (scripts/verify-dev-commands.sh extended, 15 checks pass). -->

### 5. Frontend  <!-- agent: general-purpose -->

- [x] `frontend/src/lib/api.ts` `updateBgProcess(slug, data)` (~423-437) and `frontend/src/components/AgentList.tsx` bg delete/window/PATCH calls (~1362, ~1367, ~1395, ~1451) use `bg.slug`; add `slug` to the frontend `BgProcess` type (~62-73)
- [x] `AgentList.tsx`: `BgProcessRow key` (~1609) and the `setBgs` SSE handlers (~2007, ~2022, ~2033) key by `slug`; show `name` as the label and the slug as a secondary/tooltip detail only when it differs
- [x] Update `AgentList.test.tsx` (and `AddBgProcessForm.test.tsx` if the create response shape changes) for two bg rows sharing a `name` in different projects
- [x] (tsc clean, 298 vitest tests pass) Run `cd frontend && npx tsc --noEmit` and the frontend unit tests

<!-- Updated: 2026-09-20 step 5 done. Follow-up nit: bg remove/close confirm dialogs still show bare `name` (ambiguous across projects). -->

### 6. Legacy files, docs, and gates  <!-- agent: general-purpose -->

- [x] (decision: legacy files left in place and documented; no startup rename) Best-effort rename of existing `$LOG_DIR/bg-<name>.log` and `$STATE_DIR/bg-<name>.state` to their slugs on host-server startup (idempotent, skip if the target exists, never overwrite), or, if judged riskier than it is worth, document that legacy files are left in place; record the choice in this task
> **Legacy files decision (2026-09-20, lead):** no startup rename is implemented. Renaming `$LOG_DIR/bg-<name>.log` / `$STATE_DIR/bg-<name>.state` at host-server boot would be a runtime file-moving side effect on the live system, and existing bare-name windows must be recreated anyway (they no longer match a slug). Legacy files are left in place and ignored; stale ones can be deleted by hand. Documented in `CLAUDE.md`, `scripts/README.md` and `wiki/knowledge/concepts/background-process-registry.md`.

- [x] Update `CLAUDE.md` and `scripts/README.md` path descriptions (`bg-<name>` becomes `bg-<slug>`) and the "Name uniqueness" note in `wiki/knowledge/concepts/background-process-registry.md`
- [x] (host-server tsc clean + 240/240 tests; bash -n OK; frontend tsc clean + 298/298 tests) Static gates: `cd host-server && npx tsc --noEmit && npm test`; `bash -n` on touched scripts; frontend typecheck and tests. Runtime checks (creating two projects each with a `dev` process, opening/closing windows, the rename path) are `[DEFERRED-TO-UAT]`

## Dependencies

- Depends on: `TASK-0188` (the decision).
- Does not block `TASK-0190`, `TASK-0193`, `TASK-0194` (they key by slug through `getBgBySlug`); expect merge overlap with them in the `host-server/index.ts` bg routes.
- Soft links: `TASK-0187` (shared `bg_processes` rebuild), `TASK-0186`/`TASK-0195` (`NULL`-project policy and create/patch handlers).
