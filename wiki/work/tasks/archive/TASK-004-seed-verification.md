---
id: TASK-004
title: "Verify Phase 1 foundation — seed import correctness and restart idempotency"
status: done
created: 2026-06-12
updated: 2026-06-12
depends_on: [TASK-002, TASK-003]
blocks: []
parallel_safe_with: [TASK-001]
uat: "../uat/UAT-004-seed-verification.md"
tags: [backend, sqlite, verification]
---

# TASK-004 — Verify Phase 1 foundation — seed import correctness and restart idempotency

## Objective

Confirm that the Phase 1 SQLite foundation (TASK-002 deps + TASK-003 schema/seed) works correctly end-to-end: the backend opens the DB, `seedFromLegacy` imports the existing `conductor.conf` arrays and `tasks.txt` into SQLite without errors, the counts match what was in the flat files, and a second restart does NOT re-import (idempotency guard). This task also wires the new `openDb()` call into `backend/index.ts` so the DB module is actually exercised on startup — even though the routes don't use it yet.

## Approach

Two parts:
1. **Wire `openDb()` into backend startup** — `backend/index.ts` calls `openDb(getDbPath(conf))` once at startup and stores the result in a module-level `let db`. This makes the DB reachable from route handlers in later tasks without a separate `import { openDb }` call in each route file.
2. **Verification** — a short manual-test procedure: start the backend, inspect the DB with `sqlite3`, restart, confirm no duplication.

The verification itself is the UAT for Phase 1. This task creates the plumbing so that UAT is possible.

## Steps

### 1. Wire openDb into backend/index.ts startup  <!-- agent: general-purpose -->

- [ ] Use Serena `get_symbols_overview` on `backend/index.ts` to locate the startup block (where `readConductorConf()` is called and `fastify.listen` is called)
- [ ] Import `openDb` and `getDbPath` from `./db` at the top of `backend/index.ts`
- [ ] After `const conf = readConductorConf()`, add:
  ```ts
  const db = openDb(getDbPath(conf));
  ```
- [ ] Export `db` from the module or pass it to the route registration functions (whichever pattern index.ts uses for sharing `conf` with handlers — match the existing style)
- [ ] The call is intentionally before `fastify.listen` so any schema migration or seed error surfaces immediately at startup, not on first request

### 2. Ensure ConductorConf exposes _confPath  <!-- agent: general-purpose -->

- [ ] Use Serena `find_symbol` on `backend/config.ts` to check if `ConductorConf` has a `_confPath` field
- [ ] If missing: add `_confPath: string` to the `ConductorConf` interface, and populate it in `readConductorConf()` (the function that resolves and reads the conf file — set `_confPath` to the resolved absolute path of the conf file)
- [ ] This field is needed by `getDbPath()` in `db.ts` to resolve `DB_PATH` relative to the conf file's directory

### 3. Static verification  <!-- agent: general-purpose -->

- [ ] Run `cd backend && npx tsc --noEmit` to confirm no type errors from the wiring
- [ ] Run `cd backend && node -e "require('./dist/index.js')"` is NOT needed here — static typecheck only; runtime verification is UAT

### 4. Write verification instructions for UAT  <!-- agent: general-purpose -->

- [ ] Create `wiki/work/uat/UAT-004-seed-verification.md` with the following manual test cases:
  - **T1 — First start**: `cd backend && npm run dev` (or `tsx index.ts`); check `data/conductor.db` created; run `sqlite3 data/conductor.db "SELECT name,workdir FROM agents;"` — count matches `AGENTS` in `conductor.conf`
  - **T2 — Task count**: `sqlite3 data/conductor.db "SELECT count(*) FROM tasks WHERE status='queued';"` matches line count in `tasks.txt` (ignoring blank/comment lines)
  - **T3 — Idempotency**: stop + restart backend; rerun T1 and T2 queries — same counts (no duplication)
  - **T4 — meta guard**: `sqlite3 data/conductor.db "SELECT * FROM meta;"` shows `schema_version=1` and `legacy_import=1`
