---
id: UAT-0198
aliases: [UAT-0198]
title: "UAT: Drop bg_processes.linked_agent_id via a table-rebuild migration (schema v12)"
status: passed
task: TASK-0198
created: 2026-09-20
updated: 2026-09-20
---

# UAT-0198 — UAT: Drop bg_processes.linked_agent_id via a table-rebuild migration (schema v12)

implements::[[TASK-0198]]

> **Source task**: [[TASK-0198]]
> **Generated**: 2026-09-20
>
> **What changed**: `bg_processes.linked_agent_id` (retired by TASK-0187, unused since TASK-0197) is gone. Schema **v12** in `host-server/db.ts`: `seedBgProjectFromLinkedAgent()` first sets a still-`NULL` `project_id` from the linked agent's project, then the table is rebuilt without the column. `rebuildBgProcesses()` no longer copies `linked_agent_id`, so every rebuild (v11, v12, and the non-versioned `enforceBgProjectRequired`) omits it; the fresh-install DDL never creates it. The v12 step rebuilds only if the column is still present (a fresh DB, or one already rebuilt by v11, just gets the version bump) and handles both table shapes (nullable `project_id` plus the partial `idx_bg_processes_null_name`, and `NOT NULL`), preserving the `(project_id, name)` unique index, `ON DELETE CASCADE` and the `GLOB` name `CHECK`.
>
> **Deviation from the task's Approach text**: the task says unmatched `NULL` rows abort the migration with a list. The implementation deliberately does not: startup never fails on them (the v11 design, TASK-0196 test `v11 never fails startup`), and they are left for the workdir backfill and `enforceBgProjectRequired`. The task's step 2 checkbox and `background-process-registry.md` both record this. UAT-EDGE-001 asserts the implemented behavior; see Gaps.
>
> **Out of scope**: the live host-server on `:8788` (a stale old process), the live `conductor` tmux session, real bg processes, and any write to the live `./data/conductor.db`.

---

## Prerequisites

- [ ] Run everything from the repo root `/Users/davidtaylor/Repositories/tmux-conductor`. No `.env` file is read or written. Node with `tsx`, `sqlite3`, and bash >= 4.2 (`/opt/homebrew/bin/bash` first on `PATH`) are available.
- [ ] Both pre-migration backups exist and are never modified: `./tmp/conductor.db.bak-task0198` (schema_version **11**, `bg_processes` still has `linked_agent_id`, `project_id NOT NULL`, 2 rows: id 1 `dev-stack` in project 3 `wetware`, id 2 `dev` in project 10 `davill`, 0 linked) and `./tmp/conductor.db.bak-task0196` (schema_version **10**, nullable `project_id`, global `UNIQUE(name)`, same 2 rows). Agent 15 (`tmux-conductor-2`) belongs to project 1 (`tmux-conductor`) in both.
- [ ] **Every upgrade test runs on a scratch copy** made with `sqlite3 -readonly <backup> ".backup ./tmp/t0198-<x>.db"` (a WAL-safe copy). The live `./data/conductor.db` is only ever read, and only with `sqlite3 -readonly` (UAT-EDGE-012). Never open the live DB with `openDb`, never contact `:8788`.
- [ ] Scratch files use the prefix `./tmp/t0198-` and are removed at the end of each test that creates them (UAT-EDGE-013 sweeps any leftovers).
- [ ] Noise note: the host-server config module prints a `confPath: { ... }` block to stdout on import. Node commands below end in `| tail -n 1` (or are otherwise scoped) so only the last line, the JSON result, is judged.

**How the upgrade checks work.** UAT-EDGE-007 and UAT-EDGE-008 share one reporting one-liner (inlined in each, since each test must be runnable on its own). It opens the copy with the real `openDb`, then prints `version`, the `bg_processes` column names, whether `project_id` is `NOT NULL`, the non-autoindex index names, all rows, the `foreign_key_check` violation count, the number of leftover `bg_processes_v*` temp tables, and the version and column count after a **second** `openDb` (idempotency).

---

## Test Cases

### UAT-EDGE-001: v12 on a nullable-shape DB seeds `project_id` from the linked agent, drops the column, keeps every constraint
- **Scenario**: A faithful post-v11 fixture (`project_id` nullable, `idx_bg_processes_null_name` present, `linked_agent_id` still there) with four rows: (a) linked to agent 7 (project 1) with `NULL` project gets project 1; (b) linked but already in project 2 keeps project 2 (seed never overwrites); (c) linked to agent 8, which has no project, stays `NULL` and the migration still completes (the deviation above); (d) unlinked row unchanged. After `openDb`: `schema_version >= 12`; the column is gone (`PRAGMA table_info`); `id`, `name`, `workdir`, `launch_cmd` preserved on every row; `project_id` stays nullable (a row is still unmatched) and both indexes are recreated; `foreign_key_check` is empty; the `(project_id, name)` unique index, the `NULL`-project partial unique index and the `name GLOB` `CHECK` all still reject bad inserts; deleting project 2 cascades to its bg row; a reopen is a no-op (the column does not come back).
- **Steps**:
  1. Run the unit test command below
- **Expected Result**: 1 test passes, 0 fail.
- **Repeatable Unit Test**: Created: `host-server/db.migration.test.ts` (`TASK-0198: v12 seeds project_id from the linked agent, drops linked_agent_id, and keeps the nullable-shape indexes`)
- **Unit Test Command**: `node --import tsx/esm --test --test-name-pattern='TASK-0198: v12 seeds' host-server/db.migration.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-EDGE-002: v12 on a `NOT NULL` project_id DB drops the column and preserves rows, the unique index and cascade
- **Scenario**: A post-v11 fixture in the other shape TASK-0196's rebuild can leave: `project_id NOT NULL`, three rows including two named `dev` in different projects (one linked to agent 7, one linked to agent 8). After `openDb`: version `>= 12`; the column is gone; `project_id` is still `NOT NULL`; the only index is `idx_bg_processes_project_name` (no partial index appears); all rows and ids preserved; a second `dev` in project 1 is rejected (`UNIQUE`); a `NULL`-project insert is rejected (`NOT NULL`); deleting project 1 cascades and leaves only the other project's row.
- **Steps**:
  1. Run the unit test command below
- **Expected Result**: 1 test passes, 0 fail.
- **Repeatable Unit Test**: Created: `host-server/db.migration.test.ts` (`TASK-0198: v12 handles the NOT NULL project_id shape, preserving rows, the unique index and cascade`)
- **Unit Test Command**: `node --import tsx/esm --test --test-name-pattern='TASK-0198: v12 handles the NOT NULL' host-server/db.migration.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-EDGE-003: Seed-then-promote: a nullable shape whose only NULL row is linked ends up `NOT NULL`
- **Scenario**: A nullable-shape fixture whose only `NULL`-project row is linked to an agent with a project. The seed resolves it before the rebuild, so `countBgRowsMissingProject` is 0, the v12 rebuild produces `project_id NOT NULL`, the partial `idx_bg_processes_null_name` index is not recreated, and both rows keep the expected project ids (1 and 2).
- **Steps**:
  1. Run the unit test command below
- **Expected Result**: 1 test passes, 0 fail.
- **Repeatable Unit Test**: Created: `host-server/db.migration.test.ts` (`TASK-0198: v12 promotes a nullable shape to NOT NULL when the linked-agent seed resolves every NULL project`)
- **Unit Test Command**: `node --import tsx/esm --test --test-name-pattern='TASK-0198: v12 promotes' host-server/db.migration.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-EDGE-004: A fresh database never creates `linked_agent_id`, and the CRUD helpers never expose it
- **Scenario**: A brand-new DB (no legacy rows) ends at `schema_version >= 12` with no `linked_agent_id` column and `project_id NOT NULL`. `createBgProcess` returns a row with no `linkedAgentId` field and the column is absent (checked in `db.test.ts`'s bg CRUD test).
- **Steps**:
  1. Run the unit test command below
- **Expected Result**: 2 tests pass (`TASK-0198: a fresh database never creates linked_agent_id` and `TASK-159: createBgProcess, listBgProcesses, deleteBgProcess provide full CRUD ...`), 0 fail.
- **Repeatable Unit Test**: Created: `host-server/db.migration.test.ts` (`TASK-0198: a fresh database never creates linked_agent_id`) and `host-server/db.test.ts` (`TASK-159: createBgProcess, listBgProcesses, deleteBgProcess ...` asserts the column is absent)
- **Unit Test Command**: `node --import tsx/esm --test --test-name-pattern='TASK-0198: a fresh database|TASK-159: createBgProcess' host-server/db.migration.test.ts host-server/db.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-EDGE-005: The TASK-0196 v11 tests still pass after `rebuildBgProcesses` stopped copying the column
- **Scenario**: `rebuildBgProcesses` is shared by v11 and `enforceBgProjectRequired`. The v11 tests (per-project uniqueness, `NOT NULL`, cascade, "never fails startup on unmatched rows, then promotes on a later open") had their fixtures updated in this task, since the rebuilt table no longer has the column. They must still pass unmodified in intent: the unmatched-row deferral (nullable shape plus partial unique index, then `NOT NULL` on a later open) is exactly the behavior the TASK-0198 deviation preserves.
- **Steps**:
  1. Run the unit test command below
- **Expected Result**: 2 tests pass (`TASK-0196: v11 rebuilds ...` and `TASK-0196: v11 never fails startup ...`), 0 fail.
- **Repeatable Unit Test**: Created: `host-server/db.migration.test.ts` (`TASK-0196: v11 ...`, fixtures updated by TASK-0198)
- **Unit Test Command**: `node --import tsx/esm --test --test-name-pattern='TASK-0196: v11' host-server/db.migration.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-EDGE-006: The complete host-server DB suites pass
- **Scenario**: Regression guard for the v12 change against every earlier migration test (v2 through v11), the fixtures in `db.test.ts`, agents, tasks, projects, and the bg helpers.
- **Steps**:
  1. Run the unit test command below
- **Expected Result**: all tests pass with `fail 0` (75 at generation time; the count may grow).
- **Repeatable Unit Test**: Created: `host-server/db.test.ts` and `host-server/db.migration.test.ts`
- **Unit Test Command**: `node --import tsx/esm --test host-server/db.test.ts host-server/db.migration.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-EDGE-007: v11 -> v12 upgrade of a COPY of the real pre-change DB; a linked row that already has a project keeps it
- **Scenario**: The v11 backup is a real `NOT NULL` shape with the column present. To exercise the seed's "never overwrite" rule on real data, row 1 (`dev-stack`, project 3) is given `linked_agent_id=15` (agent 15 is in project 1) on the copy. After `openDb`: `version` `"12"`; columns exactly `id,name,workdir,launch_cmd,project_id`; `notNull` 1; only `idx_bg_processes_project_name`; both rows and ids unchanged **with `project_id` 3 (not 1)**; no FK violations; no temp table left; reopen keeps version 12 and 5 columns.
- **Steps**:
  1. Make the copy and link the row: `rm -f ./tmp/t0198-v11.db ./tmp/t0198-v11.db-wal ./tmp/t0198-v11.db-shm && sqlite3 -readonly ./tmp/conductor.db.bak-task0198 ".backup ./tmp/t0198-v11.db" && sqlite3 ./tmp/t0198-v11.db "UPDATE bg_processes SET linked_agent_id=15 WHERE id=1; SELECT id,name,project_id,linked_agent_id FROM bg_processes ORDER BY id; SELECT value FROM meta WHERE key='schema_version'"` prints `1|dev-stack|3|15`, `2|dev|10|`, `11`
  2. Run the command below as-is
  3. Cleanup: `rm -f ./tmp/t0198-v11.db ./tmp/t0198-v11.db-wal ./tmp/t0198-v11.db-shm`
- **Command**:
  ```bash
  node --import tsx/esm --input-type=module -e 'import { openDb } from "./host-server/db.ts"; const p = process.argv[1]; const q = (d, s) => d.prepare(s).all(); const db = openDb(p); const cols = db.pragma("table_info(bg_processes)"); const out = { version: q(db, "select value from meta where key=\x27schema_version\x27")[0].value, columns: cols.map((c) => c.name), notNull: cols.find((c) => c.name === "project_id").notnull, indexes: db.pragma("index_list(bg_processes)").map((i) => i.name).filter((n) => !n.startsWith("sqlite_autoindex")), rows: q(db, "select id,name,workdir,launch_cmd,project_id from bg_processes order by id"), fkViolations: db.pragma("foreign_key_check").length, tmpTables: q(db, "select name from sqlite_master where name like \x27bg_processes_v%\x27").length }; db.close(); const again = openDb(p); out.reopenVersion = q(again, "select value from meta where key=\x27schema_version\x27")[0].value; out.reopenColumns = again.pragma("table_info(bg_processes)").length; again.close(); console.log(JSON.stringify(out));' ./tmp/t0198-v11.db | tail -n 1
  ```
- **Expected Result**: exactly `{"version":"12","columns":["id","name","workdir","launch_cmd","project_id"],"notNull":1,"indexes":["idx_bg_processes_project_name"],"rows":[{"id":1,"name":"dev-stack","workdir":"/Users/davidtaylor/Repositories/gauntlet/wetware-factory","launch_cmd":"make dev","project_id":3},{"id":2,"name":"dev","workdir":"/Users/davidtaylor/Repositories/davill","launch_cmd":"npm run dev","project_id":10}],"fkViolations":0,"tmpTables":0,"reopenVersion":"12","reopenColumns":5}` (verified against the backup at generation time). `project_id` 1 on row 1 would mean the seed overwrote an existing project: fail.
- **Repeatable Unit Test**: Not applicable: real-backup upgrade check (the fixture-based equivalents are UAT-EDGE-001 and UAT-EDGE-002)
- [x] Pass <!-- 2026-09-20 -->

### UAT-EDGE-008: Full-chain v10 -> v12 upgrade: a linked row with a `NULL` project is seeded from the linked agent, not the workdir backfill
- **Scenario**: The v10 backup is the pre-TASK-0196 shape (global `UNIQUE(name)`, nullable `project_id`, column present). On the copy, row 1 (`dev-stack`, workdir `.../wetware-factory`, which the workdir backfill would map to project 3) is set to `project_id=NULL, linked_agent_id=15` (agent 15 is in project 1). The seed runs before the workdir backfill, so the result must be project **1**, which proves the linked-agent seed (not the backfill) fired. Row 2 (`dev`, project 10, unlinked) is unchanged. The v11 rebuild already drops the column, so the v12 step is a version bump only. After `openDb`: version `"12"`; five columns; `notNull` 1; one index; no FK violations; no temp table; reopen idempotent.
- **Steps**:
  1. Make the copy and link the row: `rm -f ./tmp/t0198-v10.db ./tmp/t0198-v10.db-wal ./tmp/t0198-v10.db-shm && sqlite3 -readonly ./tmp/conductor.db.bak-task0196 ".backup ./tmp/t0198-v10.db" && sqlite3 ./tmp/t0198-v10.db "UPDATE bg_processes SET project_id=NULL, linked_agent_id=15 WHERE id=1; SELECT id,name,project_id,linked_agent_id FROM bg_processes ORDER BY id; SELECT value FROM meta WHERE key='schema_version'"` prints `1|dev-stack||15`, `2|dev|10|`, `10`
  2. Run the command below as-is (identical reporting one-liner to UAT-EDGE-007, other file)
  3. Cleanup: `rm -f ./tmp/t0198-v10.db ./tmp/t0198-v10.db-wal ./tmp/t0198-v10.db-shm`
- **Command**:
  ```bash
  node --import tsx/esm --input-type=module -e 'import { openDb } from "./host-server/db.ts"; const p = process.argv[1]; const q = (d, s) => d.prepare(s).all(); const db = openDb(p); const cols = db.pragma("table_info(bg_processes)"); const out = { version: q(db, "select value from meta where key=\x27schema_version\x27")[0].value, columns: cols.map((c) => c.name), notNull: cols.find((c) => c.name === "project_id").notnull, indexes: db.pragma("index_list(bg_processes)").map((i) => i.name).filter((n) => !n.startsWith("sqlite_autoindex")), rows: q(db, "select id,name,workdir,launch_cmd,project_id from bg_processes order by id"), fkViolations: db.pragma("foreign_key_check").length, tmpTables: q(db, "select name from sqlite_master where name like \x27bg_processes_v%\x27").length }; db.close(); const again = openDb(p); out.reopenVersion = q(again, "select value from meta where key=\x27schema_version\x27")[0].value; out.reopenColumns = again.pragma("table_info(bg_processes)").length; again.close(); console.log(JSON.stringify(out));' ./tmp/t0198-v10.db | tail -n 1
  ```
- **Expected Result**: exactly `{"version":"12","columns":["id","name","workdir","launch_cmd","project_id"],"notNull":1,"indexes":["idx_bg_processes_project_name"],"rows":[{"id":1,"name":"dev-stack","workdir":"/Users/davidtaylor/Repositories/gauntlet/wetware-factory","launch_cmd":"make dev","project_id":1},{"id":2,"name":"dev","workdir":"/Users/davidtaylor/Repositories/davill","launch_cmd":"npm run dev","project_id":10}],"fkViolations":0,"tmpTables":0,"reopenVersion":"12","reopenColumns":5}`. Row 1 with `project_id` 3 means the seed did not run (workdir backfill won instead): fail. With `null`, the row was lost to the rebuild's dangling-project nulling: fail.
- **Repeatable Unit Test**: Not applicable: real-backup full-chain upgrade check (the fixture equivalent of the seed is UAT-EDGE-001 and UAT-EDGE-003)
- [x] Pass <!-- 2026-09-20 -->

### UAT-EDGE-009: On a migrated copy the DB enforces the per-project, `NOT NULL`, `CHECK` and cascade rules, and the column really is gone
- **Scenario**: On a v12 copy, a second `dev` in a different project inserts; a second `dev` in project 10 fails the `(project_id, name)` unique index; a `NULL`-project row fails `NOT NULL`; a name starting with `!` fails the `GLOB` `CHECK`; an insert that names `linked_agent_id` fails because the column does not exist; deleting project 10 (with `foreign_keys=ON`) cascades to its bg row. The backup is never modified.
- **Steps**:
  1. Make and migrate the copy: `rm -f ./tmp/t0198-cons.db ./tmp/t0198-cons.db-wal ./tmp/t0198-cons.db-shm && sqlite3 -readonly ./tmp/conductor.db.bak-task0198 ".backup ./tmp/t0198-cons.db" && node --import tsx/esm --input-type=module -e 'import { openDb } from "./host-server/db.ts"; openDb("./tmp/t0198-cons.db").close()' | tail -n 1` (prints the trailing `}` of the config noise; ignore it)
  2. Cross-project duplicate: `sqlite3 ./tmp/t0198-cons.db "INSERT INTO bg_processes (name, workdir, launch_cmd, project_id) VALUES ('dev','/x','sleep 1',1)"` prints nothing, exit 0
  3. Same-project duplicate: `sqlite3 ./tmp/t0198-cons.db "INSERT INTO bg_processes (name, workdir, launch_cmd, project_id) VALUES ('dev','/x','sleep 1',10)"` fails with `UNIQUE constraint failed: bg_processes.project_id, bg_processes.name`
  4. Project-less: `sqlite3 ./tmp/t0198-cons.db "INSERT INTO bg_processes (name, workdir, launch_cmd, project_id) VALUES ('nop','/x','sleep 1',NULL)"` fails with `NOT NULL constraint failed: bg_processes.project_id`
  5. Bad name: `sqlite3 ./tmp/t0198-cons.db "INSERT INTO bg_processes (name, workdir, launch_cmd, project_id) VALUES ('!bad','/x','sleep 1',1)"` fails with `CHECK constraint failed: name GLOB '[A-Za-z0-9_-]*'`
  6. The retired column: `sqlite3 ./tmp/t0198-cons.db "INSERT INTO bg_processes (name, workdir, launch_cmd, linked_agent_id, project_id) VALUES ('lnk','/x','sleep 1',15,1)"` fails with `table bg_processes has no column named linked_agent_id`
  7. Run the command below as-is (cascade)
  8. Confirm the backup is untouched: `sqlite3 -readonly ./tmp/conductor.db.bak-task0198 "select value from meta where key='schema_version'"` prints `11`
  9. Cleanup: `rm -f ./tmp/t0198-cons.db ./tmp/t0198-cons.db-wal ./tmp/t0198-cons.db-shm`
- **Command**:
  ```bash
  sqlite3 ./tmp/t0198-cons.db "PRAGMA foreign_keys=ON; DELETE FROM projects WHERE id=10; SELECT id||'|'||name||'|'||project_id FROM bg_processes ORDER BY id"
  ```
- **Expected Result**: Step 2 succeeds silently. Steps 3 to 6 fail with the exact messages above. Step 7 prints exactly `1|dev-stack|3` and `3|dev|1` (row 2 `dev` was cascade-deleted with project 10, the step-2 row survives). Step 8 prints `11`.
- **Repeatable Unit Test**: Not applicable: real-backup constraint check (the fixture equivalents are UAT-EDGE-001 and UAT-EDGE-002)
- [x] Pass <!-- 2026-09-20 -->

### UAT-EDGE-010: After the upgrade the DB helpers still list, create and delete bg rows (the dashboard's data path)
- **Scenario**: The dashboard and the status poll read bg rows through `listBgProcesses`/`listBgSlugs` (`SELECT *` mapped by `mapBgProcess`). On a migrated copy of the v11 backup those must still return both rows with their derived slugs; `createBgProcess` must insert (its `INSERT ... RETURNING *` names no retired column) and return a row with exactly the keys `id,launchCmd,name,projectId,workdir` (no link field); `deleteBgProcess` removes it again.
- **Steps**:
  1. Make the copy: `rm -f ./tmp/t0198-help.db ./tmp/t0198-help.db-wal ./tmp/t0198-help.db-shm && sqlite3 -readonly ./tmp/conductor.db.bak-task0198 ".backup ./tmp/t0198-help.db"`
  2. Run the command below as-is (it migrates the copy on open, then exercises the helpers)
  3. Cleanup: `rm -f ./tmp/t0198-help.db ./tmp/t0198-help.db-wal ./tmp/t0198-help.db-shm`
- **Command**:
  ```bash
  node --import tsx/esm --input-type=module -e 'import { openDb, listBgProcesses, listBgSlugs, createBgProcess, deleteBgProcess } from "./host-server/db.ts"; const db = openDb("./tmp/t0198-help.db"); const before = listBgProcesses(db).map((b) => [b.id, b.name, b.projectId]); const slugs = listBgSlugs(db); const made = createBgProcess(db, { name: "extra", workdir: "/x", launchCmd: "sleep 1", projectId: 1 }); const keys = Object.keys(made).sort(); const during = listBgSlugs(db); deleteBgProcess(db, made.id); const after = listBgSlugs(db); db.close(); console.log(JSON.stringify({ before, slugs, keys, during, after }));' | tail -n 1
  ```
- **Expected Result**: exactly `{"before":[[2,"dev",10],[1,"dev-stack",3]],"slugs":["wetware-dev-stack","davill-dev"],"keys":["id","launchCmd","name","projectId","workdir"],"during":["wetware-dev-stack","davill-dev","tmux-conductor-extra"],"after":["wetware-dev-stack","davill-dev"]}` (verified at generation time; `before` is ordered by name).
- **Repeatable Unit Test**: Created: `host-server/db.test.ts` (`TASK-159: createBgProcess, listBgProcesses, deleteBgProcess ...` covers the helpers on a fresh DB; this case adds the migrated real-data shape)
- **Unit Test Command**: `node --import tsx/esm --test --test-name-pattern='TASK-159: createBgProcess' host-server/db.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-EDGE-011: The shell loader (`scripts/lib/db.sh`) still reads the migrated DB
- **Scenario**: `conductor.sh`, `spawn.sh`, `monitor.sh`, `teardown.sh` and `dev-commands.sh` read bg rows through `scripts/lib/db.sh` `load_bg` (`SELECT ... FROM bg_processes b LEFT JOIN projects p`), which names no dropped column. Against a migrated copy, `load_bg` must populate `BG_NAMES` (slugs, sorted) with `BG_DIRS`/`BG_CMDS` keyed by slug, and `load_agents` must still load all agents (it no longer joins `bg_processes`, TASK-0197). Requires bash >= 4.2 (declare -gA); `/opt/homebrew/bin/bash` is 5.3.
- **Steps**:
  1. Make and migrate the copy: `rm -f ./tmp/t0198-sh.db ./tmp/t0198-sh.db-wal ./tmp/t0198-sh.db-shm && sqlite3 -readonly ./tmp/conductor.db.bak-task0198 ".backup ./tmp/t0198-sh.db" && node --import tsx/esm --input-type=module -e 'import { openDb } from "./host-server/db.ts"; openDb("./tmp/t0198-sh.db").close()' | tail -n 1`
  2. Run the command below as-is
  3. Cleanup: `rm -f ./tmp/t0198-sh.db ./tmp/t0198-sh.db-wal ./tmp/t0198-sh.db-shm`
- **Command**:
  ```bash
  CONDUCTOR_DB=./tmp/t0198-sh.db bash -c 'source scripts/lib/db.sh; load_bg; load_agents; printf "%s|%s|%s\n" "${BG_NAMES[0]}" "${BG_DIRS[${BG_NAMES[0]}]}" "${BG_CMDS[${BG_NAMES[0]}]}"; printf "%s\n" "${BG_NAMES[@]}"; echo agents=${#AGENT_NAMES[@]}'
  ```
- **Expected Result**: exactly four lines: `davill-dev|/Users/davidtaylor/Repositories/davill|npm run dev`, `davill-dev`, `wetware-dev-stack`, `agents=13` (the backup holds 13 agents). No `no such column` error.
- **Repeatable Unit Test**: Not applicable: exercises a shell script against a real-backup DB copy (`bgLinkRetired.test.ts` statically pins that `load_agents` names no bg column)
- [x] Pass <!-- 2026-09-20 -->

### UAT-EDGE-012: The live DB (read-only) is at v12 with the column gone and its two rows intact
- **Scenario**: The tsx-watch server already hot-migrated `./data/conductor.db` to v12. Read-only inspection only (`sqlite3 -readonly`; the live DB and `:8788` are never written to or contacted). Asserts `schema_version >= 12`, the retired column is absent, only the per-project unique index exists, no `bg_processes_v*` temp table is left over, the foreign-key check on `bg_processes` is clean, and the two original rows are unchanged. Other bg rows may exist if other sessions added some; only the two original ids are judged.
- **Steps**:
  1. Run the command below as-is
- **Command**:
  ```bash
  sqlite3 -readonly ./data/conductor.db "select 'version>=12:' || (cast(value as integer) >= 12) from meta where key='schema_version'" "select 'linkColumn:' || count(*) from pragma_table_info('bg_processes') where name='linked_agent_id'" "select 'projectNotNull:' || \"notnull\" from pragma_table_info('bg_processes') where name='project_id'" "select 'index:' || name from pragma_index_list('bg_processes') where name not like 'sqlite_autoindex%'" "select 'tmpTables:' || count(*) from sqlite_master where name like 'bg_processes_v%'" "select 'fkViolations:' || count(*) from pragma_foreign_key_check('bg_processes')" "select id||'|'||name||'|'||project_id from bg_processes where id in (1,2) order by id"
  ```
- **Expected Result**: exactly `version>=12:1`, `linkColumn:0`, `projectNotNull:1`, `index:idx_bg_processes_project_name`, `tmpTables:0`, `fkViolations:0`, `1|dev-stack|3`, `2|dev|10`.
- **Repeatable Unit Test**: Not applicable: read-only probe of the live database file
- [x] Pass <!-- 2026-09-20 -->

### UAT-EDGE-013: The backups are untouched and no scratch files are left behind
- **Scenario**: Nothing in this UAT may modify either backup or leave `./tmp/t0198-*` scratch files.
- **Steps**:
  1. Run the two commands below as-is
- **Command**:
  ```bash
  sqlite3 -readonly ./tmp/conductor.db.bak-task0198 "select value from meta where key='schema_version'" && sqlite3 -readonly ./tmp/conductor.db.bak-task0196 "select value from meta where key='schema_version'"
  ```
  ```bash
  node -e "console.log(require('fs').readdirSync('tmp').filter((f) => f.startsWith('t0198-')).length)"
  ```
- **Expected Result**: Step 1 prints `11` then `10`. Step 2 prints `0` (node may wrap it in terminal color codes; the value is what counts). Any leftover file: delete it and mark the test failed only if a test left it behind.
- **Repeatable Unit Test**: Not applicable: environment hygiene check
- [x] Pass <!-- 2026-09-20 -->

### UAT-INT-001: A real host-server boots on a fresh v12 DB and POST/PATCH `/bg-processes` work (private port, private tmux)
- **Scenario**: `scripts/verify-bg-link-retired.sh api` (from TASK-0197) boots the real host-server from this working tree on private port **18797** with a scratch conf and DB and a **private** tmux server under `./tmp/`, then drives `POST`/`PATCH /api/bg-processes` and `GET /api/status`. Since TASK-0198 the scratch DB is created straight at v12 (no `linked_agent_id`), so this proves the route handlers' `INSERT`/`UPDATE`/`SELECT *` paths work against the new schema end to end, and that the script's `legacy_link` helper tolerates the dropped column. The live `:8788` server and the `conductor` tmux session are never contacted. Needs port 18797 free: if another UAT session is running the same script, wait and re-run.
- **Steps**:
  1. Run the command below as-is
- **Command**:
  ```bash
  bash scripts/verify-bg-link-retired.sh api
  ```
- **Expected Result**: every line is `PASS`, ends with `[verify-bg-link-retired] PASS — bg-to-agent link is retired (api)`, exit 0 (11 PASS lines at generation time, about 3 seconds).
- **Repeatable Unit Test**: Created: `scripts/verify-bg-link-retired.sh` (TASK-0197; its api phase now doubles as the v12 boot check)
- **Unit Test Command**: `bash scripts/verify-bg-link-retired.sh api`
- [x] Pass <!-- 2026-09-20 -->

### UAT-STATIC-001: DB source and DB test files typecheck clean
- **Scenario**: `BgProcessRow` and the rebuild/seed helpers changed. Host-server `tsc` currently reports errors in files owned by other in-flight sessions (`bgAccess.ts`, `bgAccess.test.ts` at generation time; earlier `agentDiff.test.ts`, `hookLastPrompt.test.ts`), so the gate is scoped to the files this task touched: `db.ts`, `db.test.ts`, `db.migration.test.ts`. `tsc` prints paths relative to `host-server/`, so an error there would start with `db.ts(`, `db.test.ts(` or `db.migration.test.ts(`.
- **Steps**:
  1. Run the command below as-is
- **Command**:
  ```bash
  (cd host-server && npx tsc --noEmit 2>&1) | grep -cE '^db(\.test|\.migration\.test)?\.ts\('
  ```
- **Expected Result**: prints `0` (`grep -c` exits 1 when the count is 0, which is fine). Any other number lists real type errors in the touched files: fail. Errors in other files do not count against this task.
- **Repeatable Unit Test**: Not applicable: static type gate, not a unit test
- [x] Pass <!-- 2026-09-20 -->

### UAT-STATIC-002: `db.ts` mentions `linked_agent_id` only where the migration needs it
- **Scenario**: Outside comments, the only references left in `host-server/db.ts` are the existence probe in `bgHasLinkedAgentColumn` and the seed `UPDATE` in `seedBgProjectFromLinkedAgent`. In particular the fresh-install DDL, `BgProcessRow`, `mapBgProcess`, `rebuildBgProcesses` and every query are clean. (Other files: only historical fixtures and doc comments remain; the TASK-0197 pins in `bgLinkRetired.test.ts` cover `index.ts`, `config.ts` and the frontend.)
- **Steps**:
  1. Run the command below as-is
- **Command**:
  ```bash
  node -e "const l=require('fs').readFileSync('host-server/db.ts','utf8').split('\n'); console.log(JSON.stringify(l.map((t)=>t.trim()).filter((t)=>t.includes('linked_agent_id')&&!/^(\/\/|\*|\/\*)/.test(t))))"
  ```
- **Expected Result**: exactly `["return cols.some((c) => c.name === 'linked_agent_id');","SET project_id = (SELECT a.project_id FROM agents a WHERE a.id = bg_processes.linked_agent_id)","WHERE project_id IS NULL AND linked_agent_id IS NOT NULL"]`. Any additional entry (a `CREATE TABLE` column, a copy list, a `SELECT`) is a fail.
- **Repeatable Unit Test**: Not applicable: source sweep (behavior is pinned by UAT-EDGE-001, UAT-EDGE-004 and UAT-EDGE-010)
- [x] Pass <!-- 2026-09-20 -->

### UAT-STATIC-003: The TASK-0197 retirement pins still pass
- **Scenario**: `host-server/bgLinkRetired.test.ts` statically pins that host-server code, `conductor.conf`, `CLAUDE.md`, `scripts/README.md`, the shell scripts and the frontend no longer reference the bg-to-agent link. TASK-0198 edited `db.ts`, `CLAUDE.md` and `scripts/README.md`, all of which those pins read, so they must still pass.
- **Steps**:
  1. Run the unit test command below
- **Expected Result**: 7 tests pass, 0 fail.
- **Repeatable Unit Test**: Created: `host-server/bgLinkRetired.test.ts` (TASK-0197)
- **Unit Test Command**: `node --import tsx/esm --test host-server/bgLinkRetired.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-DOC-001: The docs state that the column was dropped in schema v12
- **Scenario**: `CLAUDE.md`, `scripts/README.md` and the `linked_agent_id` section of `wiki/knowledge/concepts/background-process-registry.md` no longer describe the column as retained legacy data; each says it was dropped in schema v12 by TASK-0198. The wiki page additionally records the unmatched-row deviation.
- **Steps**:
  1. Run the command below as-is
- **Command**:
  ```bash
  node -e "const fs=require('fs'); const r=(f,re)=>[f,re.test(fs.readFileSync(f,'utf8'))]; console.log(JSON.stringify([r('CLAUDE.md',/dropped in schema v12 \(TASK-0198\)/), r('scripts/README.md',/linked_agent_id. column was dropped in schema v12/), r('wiki/knowledge/concepts/background-process-registry.md',/\*\*Schema v12\*\*[^\n]*never abort|do not abort the migration/)]))"
  ```
- **Expected Result**: exactly `[["CLAUDE.md",true],["scripts/README.md",true],["wiki/knowledge/concepts/background-process-registry.md",true]]`.
- **Repeatable Unit Test**: Not applicable: documentation check
- [x] Pass <!-- 2026-09-20 -->

---

## Gaps

- **The task's deferred manual check ("start the host-server against a copy that still has a linked row and confirm the dashboard still lists the row") was not run by the implementer and is not reproduced literally here.** Starting the server against a copy of the real DB would boot the monitor and agent reconciliation against a DB that holds 13 real agent records, with a real risk of touching the live `conductor` tmux session; that is outside this UAT's safety rules. Its substance is covered instead: UAT-EDGE-007 and UAT-EDGE-008 run the real `openDb` on copies that still carry a linked row (seed, drop, preserve), UAT-EDGE-010 exercises the exact helpers the status poll and dashboard read through (`listBgProcesses`, `listBgSlugs`, `createBgProcess`), UAT-EDGE-011 covers the shell consumers, and UAT-INT-001 boots a real server, on a private port and private tmux, against a v12 DB. What none of them covers is the dashboard's UI rendering a migrated row; a person would have to open `http://localhost:4321` against a server started on a real-data copy, which was deliberately not scripted.
- **Task text contradicts the implementation on unmatched `NULL` rows.** The task's Approach says "if any remain unmatched the migration aborts with a list of them", while step 2's checkbox note (and the wiki page) record that the migration deliberately does not abort. The requirement text and the shipped behavior disagree; this UAT asserts the shipped, documented behavior (startup never fails, consistent with TASK-0196's tested v11 design) in UAT-EDGE-001 and UAT-EDGE-005. If the abort behavior is actually wanted, those two tests must be reversed and the implementation changed. The task file itself should be reconciled (the Approach paragraph still describes the abort).
- **Task test step (g)** ("if folded into TASK-0196, its unique-index assertions still pass") does not apply as such: TASK-0196 shipped as v11, so v12 is a standalone rebuild. The equivalent guard is UAT-EDGE-005 plus the index assertions inside UAT-EDGE-001 and UAT-EDGE-002.
- **Two DB-level failures elsewhere in the repo** were reported by the implementer as unrelated (`capture-perf-baseline.sh` and a cache test) and are outside this UAT. The full-suite gate here is scoped to the two DB test files (UAT-EDGE-006).
- **`scripts/verify-teardown-window-mapping.sh` and `scripts/verify-bg-link-retired.sh` (env mode) keep `linked_agent_id` in their fixture schemas** on purpose (they never call `openDb`, so they model a pre-v12 DB the scripts must tolerate). They are not part of this UAT.
- **Promotion of the upgrade checks** (UAT-EDGE-007 to UAT-EDGE-012) to unit tests was considered and not done: their value is running against the real backup files, which are gitignored and machine-local, so a committed test cannot depend on them. The fixture-based tests (UAT-EDGE-001 to UAT-EDGE-003) already assert the same rules deterministically.
