---
id: TASK-0198
aliases: [TASK-0198]
title: "Drop bg_processes.linked_agent_id via a table-rebuild migration (seed project_id first, folded into the TASK-0196 rebuild)"
status: done
created: 2026-09-19
updated: 2026-09-20
depends_on: [TASK-0197]
blocks: []
parallel_safe_with: [TASK-0189]
uat: "[[UAT-0198]]"
tags: [bg-processes, migration, host-server, roadmap-0024]
---

# TASK-0198 — Drop bg_processes.linked_agent_id via a table-rebuild migration (seed project_id first, folded into the TASK-0196 rebuild)

implements::[[TASK-0187]]
relates_to::[[ROADMAP-0024]]
relates_to::[[background-process-registry]]
depends_on::[[TASK-0197]]
relates_to::[[TASK-0196]]
relates_to::[[TASK-0186]]
relates_to::[[TASK-0195]]

> Stage 2 of 2 of the RETIRE decision recorded in `TASK-0187` (option C). Must not start until `TASK-0197` has landed and nothing reads or writes `linked_agent_id`. **Coordinate with `TASK-0196`**: it already plans a schema_version 10 rebuild of `bg_processes` (per-project unique indexes) and says to fold any `linked_agent_id` change into that same version. Do not add a second rebuild if `TASK-0196` has not shipped.

## Objective

Remove the `linked_agent_id` column (`INTEGER NULL REFERENCES agents(id) ON DELETE SET NULL`) from `bg_processes`. SQLite cannot `ALTER TABLE ... DROP COLUMN` a column that has a `REFERENCES` clause (documented limitation), so the removal is a table-rebuild migration, the same pattern as the earlier `agents` (v2) and `tasks` (v8) rebuilds. Before the column disappears, preserve any data it can still contribute: seed `project_id` from the linked agent's project on rows that are still unscoped.

## Approach

- **Choose the migration slot by checking `TASK-0196` first.**
  - If `TASK-0196` has **not** landed: edit its planned v10 rebuild (`bg_processes_v10`) so the new table simply omits `linked_agent_id`, and add the seed statement below before the copy. One migration, one `schema_version` bump, one fixture. Update `TASK-0196`'s step 1 to say the column is dropped in the same rebuild.
  - If `TASK-0196` has **landed**: add the next `schema_version` (v11 if v10 shipped) as a standalone `bg_processes` rebuild that preserves `id`, `name`, `workdir`, `launch_cmd`, `project_id` and every index `TASK-0196` created (its `(project_id, name)` unique index must be recreated after the rename, since `DROP TABLE` removes it).
- **Seed before drop.** Inside the migration transaction, before the copy:
  `UPDATE bg_processes SET project_id = (SELECT a.project_id FROM agents a WHERE a.id = bg_processes.linked_agent_id) WHERE project_id IS NULL AND linked_agent_id IS NOT NULL;`
  Rows still `NULL` afterwards are handled by the workdir backfill defined in `TASK-0195` (`TASK-0186`'s 2026-09-20 amendment: every bg process must have a project); if any remain unmatched the migration aborts with a list of them. No live data needs this today (live DB: 2 rows, 0 linked, 0 with `NULL` project), but other installs may.
- Use the established pattern from `runMigrations` in `host-server/db.ts`: `PRAGMA foreign_keys=OFF`, one transaction, `CREATE TABLE bg_processes_vN`, explicit-column `INSERT ... SELECT` preserving `id`, `DROP TABLE bg_processes`, `ALTER TABLE ... RENAME`, recreate indexes, `PRAGMA foreign_keys=ON`, set `schema_version`. `project_id` is `NOT NULL REFERENCES projects(id) ON DELETE CASCADE` per the amendment (defined in `TASK-0196`'s rebuild; keep it if that has shipped, otherwise it is set there). Keep the `name` `GLOB` `CHECK`.
- The `db.migration.test.ts` fixtures for old versions keep their `linked_agent_id` column; they are the inputs the migration must handle.

## Steps

### 1. Preconditions  <!-- agent: Explore -->

- [x] Confirm `TASK-0197` is done: `find_referencing_symbols` / `search_for_pattern` for `linked_agent_id|linkedAgent|linkedAgentId|CONDUCTOR_BG_|AGENT_BG_LINKS` over `host-server/`, `frontend/src/`, `scripts/`, `skills/`, `conductor.conf` returns only the DDL/migration lines and the historical fixtures in `host-server/db.migration.test.ts` and the `scripts/verify-teardown-window-mapping.sh` fixture schema
- [x] Read `TASK-0196` and `host-server/db.ts` `runMigrations` to see whether the v10 `bg_processes` rebuild has shipped, and record which slot this task uses (fold into v10 or add the next version) — TASK-0196 shipped as schema v11; this task is schema v12

### 2. Migration  <!-- agent: general-purpose -->

- [x] In `host-server/db.ts` `runMigrations`, add (or extend, per Approach) the `bg_processes` rebuild: seed `project_id` from `linked_agent_id` where `project_id IS NULL`, rebuild the table without `linked_agent_id`, recreate all indexes, bump `schema_version` — v12 block plus `seedBgProjectFromLinkedAgent`/`bgHasLinkedAgentColumn`; `rebuildBgProcesses` now always omits the column (also keeps `enforceBgProjectRequired` in sync). Unmatched NULL rows do not abort (startup never fails, per the v11 design)
- [x] Update the fresh-install DDL (~305) so new databases never create the column
- [x] Remove any remaining `linked_agent_id` reference in `host-server/db.ts` (`BgProcessRow` ~145, `SELECT *` consumers); the compiler and `find_referencing_symbols` should show none left

### 3. Tests  <!-- agent: general-purpose -->

- [x] `host-server/db.migration.test.ts`: add a faithful pre-migration `bg_processes` fixture (with `linked_agent_id`) covering: (a) a linked row with `NULL` `project_id` whose agent has a project gets that `project_id`; (b) a linked row that already has a `project_id` keeps it (seed does not overwrite); (c) a linked row whose agent has no project stays `NULL`; (d) an unlinked row is unchanged; (e) `id`, `name`, `workdir`, `launch_cmd` are preserved; (f) the column no longer exists after migration (`PRAGMA table_info`); (g) if folded into `TASK-0196`, its unique-index assertions still pass
- [x] Run `cd host-server && npx tsc --noEmit && npm test` — db.migration.test.ts + db.test.ts 69/69 pass; no tsc errors in db.ts/db tests (remaining tsc errors are in other agents' in-flight `agentDiff.test.ts`/`hookLastPrompt.test.ts`; 2 unrelated failing tests: capture-perf-baseline.sh, a cache test)

### 4. Docs and wiki  <!-- agent: general-purpose -->

- [x] Update `scripts/README.md` and `CLAUDE.md` if they mention the column as retained legacy data (`TASK-0197` may have added such a note); update the "linked_agent_id" subsection of `wiki/knowledge/concepts/background-process-registry.md` to say the column is dropped and in which `schema_version`
- [x] `[DEFERRED-TO-UAT]` (note: the hot-reloaded live host-server already migrated `./data/conductor.db` to v12, 2 rows preserved; pre-migration backup at `./tmp/conductor.db.bak-task0198`): back up `./data/conductor.db`, start the host-server against a copy that still has a linked row, and confirm the migration seeds `project_id` and the dashboard still lists the row

## Dependencies

- Depends on: `TASK-0197` (no code may read or write the column when it is dropped).
- Coordinates with: `TASK-0196` (shared `bg_processes` rebuild; fold into one migration if it has not shipped), `TASK-0186` and `TASK-0195` (policy for rows that remain `NULL`).
- Parallel-safe with `TASK-0189`.
