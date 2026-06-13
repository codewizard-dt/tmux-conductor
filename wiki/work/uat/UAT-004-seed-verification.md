---
id: UAT-004
title: "UAT: Phase 1 foundation — SQLite startup, seed import, and idempotency"
status: passed
task: TASK-004
created: 2026-06-12
updated: 2026-06-12
run: 2026-06-12
---

# UAT-004 — UAT: Phase 1 foundation — SQLite startup, seed import, and idempotency

implements::[[TASK-004]]

> **Source task**: [`wiki/work/tasks/TASK-004-seed-verification.md`](../tasks/TASK-004-seed-verification.md)
> **Generated**: 2026-06-12

---

## Prerequisites

- [ ] `backend/` has a working `node_modules/` (`npm install` run in `backend/`)
- [ ] `conductor.conf` exists at repo root with at least one AGENTS entry
- [ ] `tasks.txt` exists at repo root (even if empty — zero-tasks is valid)
- [ ] No pre-existing `data/conductor.db` (remove it to test fresh start: `rm -f data/conductor.db`)
- [ ] Backend is **not** running before each test that verifies first-start behavior

---

## Test Cases

### UAT-EDGE-001: DB_PATH appears in conductor.conf

- **Scenario**: `DB_PATH` setting was added to `conductor.conf` in TASK-002
- **Steps**:
  1. Open `conductor.conf` in an editor or run the command below
  2. Confirm a line matching `DB_PATH="./data/conductor.db"` (or custom path) is present
  ```bash
  grep 'DB_PATH' conductor.conf
  ```
- **Expected Result**: Output contains `DB_PATH="./data/conductor.db"` — not empty
- [x] Pass <!-- 2026-06-12 -->

---

### UAT-EDGE-002: data/ directory is gitignored

- **Scenario**: `data/` was added to `.gitignore` in TASK-002 to prevent the DB from being committed
- **Steps**:
  1. Run:
  ```bash
  git check-ignore -v data/conductor.db
  ```
- **Expected Result**: Output contains `.gitignore` and `data/` — the file is ignored. No output means it is NOT ignored (fail).
- [x] Pass <!-- 2026-06-12 -->

---

### UAT-API-001: Backend starts cleanly and DB is created

- **Scenario**: `openDb()` is called at module startup in `index.ts`; the DB file must be created on first start
- **Steps**:
  1. Ensure `data/conductor.db` does not exist: `rm -f data/conductor.db`
  2. Start the backend: `cd backend && npm run dev &` (or `tsx index.ts &`)
  3. Wait ~3 seconds for startup
  4. Verify the DB file was created:
  ```bash
  ls -lh data/conductor.db
  ```
  5. Verify the backend responds:
  ```bash
  curl -sS 'http://localhost:8788/api/healthz'
  ```
- **Expected Result**:
  - `ls` shows `data/conductor.db` exists and has non-zero size
  - curl returns `{"ok":true}`
- [x] Pass <!-- 2026-06-12 -->

---

### UAT-API-002: Schema is correctly initialised (meta table check)

- **Scenario**: `runMigrations` writes `schema_version=1` and `seedFromLegacy` writes `legacy_import=1` on first start
- **Steps**:
  1. With the backend running (from UAT-API-001), run:
  ```bash
  sqlite3 data/conductor.db "SELECT key, value FROM meta ORDER BY key;"
  ```
- **Expected Result**: Output contains both rows:
  ```
  legacy_import|1
  schema_version|1
  ```
- [x] Pass <!-- 2026-06-12 -->

---

### UAT-API-003: Agents seeded from conductor.conf

- **Scenario**: `seedFromLegacy` imports `AGENTS` array entries as rows in the `agents` table
- **Steps**:
  1. Count AGENTS entries in conf: `grep -c '".*:' conductor.conf`
  2. Count agents in DB:
  ```bash
  sqlite3 data/conductor.db "SELECT name, workdir FROM agents;"
  ```
- **Expected Result**: Each agent in `AGENTS` array has a corresponding row. Names and workdirs match.
- [x] Pass <!-- 2026-06-12 -->

---

### UAT-API-004: Tasks seeded from tasks.txt

- **Scenario**: `seedFromLegacy` imports task lines from `tasks.txt` into the `tasks` table with `status='queued'`
- **Steps**:
  1. Count non-blank lines in tasks.txt: `grep -c . tasks.txt || echo 0`
  2. Count queued tasks in DB:
  ```bash
  sqlite3 data/conductor.db "SELECT count(*) FROM tasks WHERE status='queued';"
  ```
- **Expected Result**: DB count equals the non-blank line count in `tasks.txt`. If `tasks.txt` is empty, DB count is 0.
- [x] Pass <!-- 2026-06-12 -->

---

### UAT-API-005: Restart idempotency — no duplicate import

- **Scenario**: `seedFromLegacy` must not re-import data on subsequent backend starts
- **Steps**:
  1. Note the agent count: `sqlite3 data/conductor.db "SELECT count(*) FROM agents;"`
  2. Stop the backend (Ctrl+C or kill)
  3. Start the backend again: `cd backend && npm run dev &`
  4. Wait ~3 seconds
  5. Check counts again:
  ```bash
  sqlite3 data/conductor.db "SELECT count(*) FROM agents; SELECT count(*) FROM tasks WHERE status='queued';"
  ```
  6. Check meta guard:
  ```bash
  sqlite3 data/conductor.db "SELECT value FROM meta WHERE key='legacy_import';"
  ```
- **Expected Result**:
  - Agent and task counts are **identical** to step 1 (no duplication)
  - `meta.legacy_import` is still `1`
- [x] Pass <!-- 2026-06-12 -->

---

### UAT-EDGE-003: better-sqlite3 binary is present and functional

- **Scenario**: `better-sqlite3` native addon must be built and loadable under Node 26
- **Steps**:
  ```bash
  node -e "import('better-sqlite3').then(m => console.log('ok', m.default.name))" 2>&1
  ```
  (run from `backend/` directory where `node_modules` exists)
- **Expected Result**: Output is `ok Database` (or similar) — no error about missing native module
- [x] Pass <!-- 2026-06-12 -->

---

### UAT-EDGE-004: DB creation is atomic on concurrent starts

- **Scenario**: If two backend processes start simultaneously, schema migrations must not error
- **Steps**:
  1. Remove existing DB: `rm -f data/conductor.db`
  2. Start two backend processes simultaneously:
  ```bash
  cd backend && (npm run dev & npm run dev &) ; sleep 5 ; kill %1 %2 2>/dev/null ; true
  ```
  3. Check DB:
  ```bash
  sqlite3 data/conductor.db "SELECT key, value FROM meta ORDER BY key;"
  ```
- **Expected Result**: DB is valid — `schema_version=1` row present. No crash/corrupted DB. (One process may error on port conflict — that is acceptable; the DB itself must be clean.)
- [x] Pass <!-- 2026-06-12 -->
