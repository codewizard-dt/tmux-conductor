---
id: UAT-060
aliases: [UAT-060]
title: "UAT: agents table schema — add worktree_path and branch columns"
status: passed
task: TASK-060
created: 2026-07-06
updated: 2026-07-06
---

# UAT-060 — UAT: agents table schema — add worktree_path and branch columns

implements::[[TASK-060]]

> **Source task**: [[TASK-060-agents-worktree-schema]]
> **Generated**: 2026-07-06

---

## Prerequisites

- [ ] Dependencies installed in `host-server/` (`npm install` already run; `tsx` and `better-sqlite3` resolvable).
- [ ] `sqlite3` CLI available on PATH.
- [ ] Repo-local `./tmp/` directory writable (scratch DBs go in `./tmp/uat-060/`; never system `/tmp`).
- [ ] No other process holds an exclusive lock on the scratch DBs (the live server may keep running; tests 1–3 use isolated DB files).

---

## Test Cases

### UAT-CLI-001: Fresh database gets worktree_path and branch columns
- **Description**: Verifies that `openDb()` on a brand-new database file runs all migrations (v1→v3) and the resulting `agents` table contains the two new nullable columns, with `schema_version` at 3.
- **Steps**:
  1. Remove any stale scratch dir: delete `./tmp/uat-060/` at the repo root if present.
  2. From `host-server/`, run the command below as-is.
- **Command**:
  ```bash
  cd /Users/davidtaylor/Repositories/tmux-conductor/host-server && node --import tsx/esm --input-type=module -e "const {openDb} = await import('./db.ts'); const db = openDb('../tmp/uat-060/fresh.db'); const cols = db.prepare('PRAGMA table_info(agents)').all().map(c => c.name); const ver = db.prepare(\"SELECT value FROM meta WHERE key='schema_version'\").get(); console.log('columns:', cols.join(',')); console.log('schema_version:', ver.value);"
  ```
- **Expected Result**: Exit code 0. Output contains `columns: id,name,workdir,launch_cmd,project_id,created_at,worktree_path,branch` and `schema_version: 3`. No thrown migration errors.
- **Repeatable Unit Test**: Created: `host-server/db.migration.test.ts` — case `fresh DB has worktree_path and branch columns`. Run via `npm test` in `host-server/` (built-in `node:test` + existing `tsx`; no new dependency).
- [x] Pass <!-- 2026-07-06 -->

### UAT-CLI-002: Re-opening an already-migrated database is a no-op (idempotency)
- **Description**: Verifies the version-gated migration never re-runs the `ALTER TABLE` statements — opening the same DB twice must not throw `duplicate column name` and must leave `schema_version` at 3. Covers acceptance criterion "server starts without errors on an existing DB".
- **Steps**:
  1. Run UAT-CLI-001 first so `./tmp/uat-060/fresh.db` exists at schema version 3.
  2. From `host-server/`, run the command below as-is (opens, closes, and re-opens the same file).
- **Command**:
  ```bash
  cd /Users/davidtaylor/Repositories/tmux-conductor/host-server && node --import tsx/esm --input-type=module -e "const {openDb} = await import('./db.ts'); const a = openDb('../tmp/uat-060/fresh.db'); a.close(); const b = openDb('../tmp/uat-060/fresh.db'); console.log('re-open ok, schema_version:', b.prepare(\"SELECT value FROM meta WHERE key='schema_version'\").get().value);"
  ```
- **Expected Result**: Exit code 0. Output contains `re-open ok, schema_version: 3`. No `duplicate column name: worktree_path` (or `branch`) error.
- **Repeatable Unit Test**: Created: `host-server/db.migration.test.ts` — case `migration is idempotent on an already-migrated DB`.
- [x] Pass <!-- 2026-07-06 -->

### UAT-EDGE-001: Upgrade from schema version 2 adds columns and preserves existing rows
- **Scenario**: A database that already has the v2 `agents` table (pre-existing rows, `schema_version = 2`) is opened by the new code. The `if (version < 3)` migration block must add both columns, leave existing rows intact with `NULL` in the new fields, and bump `schema_version` to 3.
- **Steps**:
  1. From `host-server/`, run the command below as-is. It builds a v2-shaped fixture DB with one agent row and `schema_version = 2`, then opens it through `openDb()` and inspects the result.
- **Command**:
  ```bash
  cd /Users/davidtaylor/Repositories/tmux-conductor/host-server && node --import tsx/esm --input-type=module -e "
  const Database = (await import('better-sqlite3')).default;
  const fs = await import('node:fs');
  fs.mkdirSync('../tmp/uat-060', { recursive: true });
  fs.rmSync('../tmp/uat-060/v2-fixture.db', { force: true });
  const fx = new Database('../tmp/uat-060/v2-fixture.db');
  fx.exec(\"CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, workdir TEXT NOT NULL, default_launch_cmd TEXT NOT NULL DEFAULT 'claude', created_at TEXT NOT NULL DEFAULT ''); CREATE TABLE agents (id INTEGER PRIMARY KEY, name TEXT NOT NULL, workdir TEXT NOT NULL, launch_cmd TEXT NOT NULL, project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL, created_at TEXT NOT NULL DEFAULT ''); INSERT INTO agents (name, workdir, launch_cmd) VALUES ('legacy-agent', '/tmp/x', 'claude'); INSERT INTO meta VALUES ('schema_version', '2'); INSERT INTO meta VALUES ('legacy_import', '1');\");
  fx.close();
  const {openDb} = await import('./db.ts');
  const db = openDb('../tmp/uat-060/v2-fixture.db');
  const cols = db.prepare('PRAGMA table_info(agents)').all().map(c => c.name);
  const row = db.prepare(\"SELECT name, worktree_path, branch FROM agents WHERE name='legacy-agent'\").get();
  const ver = db.prepare(\"SELECT value FROM meta WHERE key='schema_version'\").get();
  console.log('columns:', cols.join(','));
  console.log('existing row:', JSON.stringify(row));
  console.log('schema_version:', ver.value);
  "
  ```
- **Expected Result**: Exit code 0. Output contains `columns: id,name,workdir,launch_cmd,project_id,created_at,worktree_path,branch`, `existing row: {"name":"legacy-agent","worktree_path":null,"branch":null}`, and `schema_version: 3`.
- **Repeatable Unit Test**: Created: `host-server/db.migration.test.ts` — case `existing pre-v3 DB gains columns and preserves rows`.
- [x] Pass <!-- 2026-07-06 -->

### UAT-CLI-003: Real host-server start migrates the live database without errors
- **Description**: The end-to-end acceptance criterion — starting the actual host-server migrates `./data/conductor.db` (observed pre-UAT at v2 shape) so the `agents` table gains both columns, with no migration errors in startup logs.
- **Steps**:
  1. From `host-server/`, start the server in the background: `npm run start` (or `npm run dev`). If the dev server is already running via `make dev`, it may have migrated the DB already — that is acceptable; proceed to step 3.
  2. Wait ~5 seconds for startup; confirm the logs show no thrown errors (no `SqliteError`, no `duplicate column name`, no migration stack trace).
  3. Run the command below as-is.
  4. Stop the background server if you started it in step 1.
- **Command**:
  ```bash
  sqlite3 /Users/davidtaylor/Repositories/tmux-conductor/data/conductor.db ".schema agents"
  ```
- **Expected Result**: The `agents` DDL/schema output includes both `worktree_path TEXT` and `branch TEXT`. Server startup produced no migration errors.
- **Repeatable Unit Test**: Not applicable: verifies live server startup wiring against the real database file — not a unit-scope behavior.
- [x] Pass <!-- 2026-07-06 -->

### UAT-CLI-004: TypeScript agent row type includes the new fields and typecheck passes
- **Description**: Verifies the `AgentRow` interface in `host-server/db.ts` declares `worktree_path?: string | null` and `branch?: string | null`, and that the package typechecks cleanly.
- **Steps**:
  1. Inspect the `AgentRow` interface in `host-server/db.ts` (around lines 76–85; use Serena `find_symbol` or Read — not shell grep). Confirm both optional nullable fields are present; `AgentWithProjectRow` inherits them via `extends AgentRow`.
  2. Run the command below as-is.
- **Command**:
  ```bash
  cd /Users/davidtaylor/Repositories/tmux-conductor/host-server && npx tsc --noEmit
  ```
- **Expected Result**: `AgentRow` contains `worktree_path?: string | null;` and `branch?: string | null;`. `tsc --noEmit` exits 0 with no output.
- **Repeatable Unit Test**: Not applicable: static type gate — already permanently enforced by the repo's `npm run typecheck` script.
- [x] Pass <!-- 2026-07-06 -->

---

## Cleanup

- Delete `./tmp/uat-060/` after the run (scratch DBs only; the live `./data/conductor.db` migration is intended and must be kept).
