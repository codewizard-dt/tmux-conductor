---
id: UAT-125
aliases: [UAT-125]
title: "UAT: Soft-delete task pop — status flip to 'done'/completed_at instead of hard DELETE (schema v8)"
status: passed
task: TASK-125
created: 2026-08-15
updated: 2026-08-15
---

# UAT-125 — UAT: Soft-delete task pop — status flip to 'done'/completed_at instead of hard DELETE (schema v8)

implements::[[TASK-125]]

> **Source task**: [[TASK-125]]
> **Generated**: 2026-08-15
> **Not a UI task — 100% machine-verifiable, aim-high note**: this task changes schema + two independent pop implementations (TypeScript, bash), with no frontend surface. Every case below executes a genuine machine-checkable verdict — no case fails closed to human verification. This is deliberate: TASK-125 is the highest-risk change of the session (a live `tasks` table rebuild plus a semantic change to the core dispatch-pop operation, consumed by both languages), and "the migration ran without error" would not catch the real failure mode (silent row loss on rebuild, or a soft flip that doesn't actually exclude done rows from re-pop). Every claim below is proven, not trusted from the task's own implementation notes — including re-deriving the row-preservation and never-re-pop properties independently for the **bash** path, which the task's own implementation only reasoned through by re-reading source (Step 5) rather than executing.
> **Two pre-existing repeatable unit tests already cover the TypeScript path** (added to `host-server/db.migration.test.ts` during `/tackle`, not by this UAT run — confirmed present and passing at generation time, re-cited here as the evidence channel for UAT-EDGE-001/002): `"TASK-125: v8 migration preserves every existing tasks row exactly and adds completed_at/done support"` and `"TASK-125: popTask flips a popped row to done/completed_at instead of deleting it, and never re-pops it"`.
> **One new repeatable unit test created by this UAT run** for the bash path (`scripts/verify-task-pop-soft-flip.sh`, UAT-EDGE-003 below) — there was no existing coverage of `pop_task_sql`'s soft-flip behavior in isolation; the repo's only prior bash-level verification tool (`scripts/verify-sqlite-migration.sh`) is currently broken for reasons unrelated to TASK-125 — see the finding at the bottom of this file.
> **Safety note**: every test below runs against a from-scratch scratch DB under `./tmp/` (built via the real `openDb()` migration path, never a hand-rolled copy of the schema) or against disposable fixture agents/tasks created and deleted through the live host-server API. `./data/conductor.db` is never migrated by any test here — it is already at schema_version 8, and re-running a migration against it is out of scope for this file.

---

## Prerequisites

- [ ] Host-server running on `http://127.0.0.1:8788` (`make dev` or `npm --prefix host-server run dev`) — required for UAT-API-001 only.
- [ ] `node`, `sqlite3`, and `bash` available on `PATH`.
- [ ] `./data/conductor.db` is already at `schema_version` 8 — confirm with `sqlite3 ./data/conductor.db "SELECT value FROM meta WHERE key='schema_version'"` before running UAT-API-001, and do not run any migration against it.
- [ ] Cleanup after every test that creates fixtures: `DELETE /api/agents/:id` for any throwaway agent (cascades its task rows), and remove any scratch `.db` file created under `./tmp/`.

---

## Test Cases

### UAT-EDGE-001: The v8 table rebuild preserves every existing `tasks` row exactly — the headline row-preservation check
- **Scenario**: A table rebuild (required because SQLite cannot `ALTER` a `CHECK` constraint) is the classic way to silently lose rows — a `CREATE ... AS SELECT` with a wrong column list, or a `DROP`/`RENAME` ordering bug, can drop or corrupt rows with no error raised. This case proves byte-for-byte column preservation across the v8 rebuild on a realistic pre-v8 fixture (3 rows, varied `status`/`source`), using the **real production migration path** (`openDb()`), not a hand-rolled simulation of it. It also proves the widened `CHECK` constraint genuinely accepts `'done'` post-migration.
- **Steps**: Pre-existing repeatable unit test in `host-server/db.migration.test.ts` (added during `/tackle`, re-verified here):
  1. Builds a scratch pre-v8 DB by hand (`schema_version='7'`, `tasks` table in the exact pre-v8 shape — 2-value `status` `CHECK`, no `completed_at` column) and inserts 3 rows with varied `status` (`queued`/`backlog`/`queued`) and `source` (`manual`/`manual`/`schedule`).
  2. Captures every column of all 3 rows via `SELECT * FROM tasks ORDER BY id` before migrating.
  3. Calls the real `openDb(dbPath)` (which runs the actual `runMigrations` ladder) against that file.
  4. Re-selects all rows after migration and asserts, per row: `id`, `command`, `agent_id`, `project_id`, `position`, `status`, `source`, `schedule_id`, `created_at` are all unchanged, and `completed_at` is `NULL` (the migration itself never touches status/completion — only `popTask`/`pop_task_sql` do).
  5. Asserts `schema_version` reads `'8'` and the `tasks.completed_at` column exists.
  6. Asserts an `UPDATE tasks SET status='done', completed_at=... WHERE id=?` does **not** throw (the widened `CHECK` accepts `'done'`) and the flip is readable back.
- **Command**:
  ```bash
  cd /Users/davidtaylor/Repositories/tmux-conductor/host-server && node --import tsx/esm --test db.migration.test.ts
  ```
- **Expected Result**: The test named `"TASK-125: v8 migration preserves every existing tasks row exactly and adds completed_at/done support"` passes, as part of the full file's tests running (exit 0, all tests passing, this test's name present in the output).
- **Repeatable Unit Test**: Created: `host-server/db.migration.test.ts` (pre-existing — added during TASK-125's own `/tackle` implementation, not by this UAT-generation run; verified present and passing at generation time).
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test db.migration.test.ts`
- [x] Pass <!-- 2026-08-15 -->

### UAT-EDGE-002: `popTask` (TypeScript) soft-flips the popped row and never re-pops it
- **Scenario**: `popTask(db, agentName)` in `host-server/db.ts` must, on success, leave the row in the table with `status='done'` and `completed_at` set (not deleted), return the same `{id, command, kind}` shape callers already depend on, and — critically — a second call for the same agent must return `null` rather than re-popping the same (now-`done`) row. A soft flip that doesn't exclude `done` rows from the candidate-selection subquery would re-dispatch completed tasks forever.
- **Steps**: Pre-existing repeatable unit test in `host-server/db.migration.test.ts`:
  1. Opens an in-memory DB, creates one agent and one queued task for it.
  2. Calls `popTask(db, agent.name)` — asserts it returns the popped task's `id`/`command`/`kind` (`'scoped'`).
  3. Re-counts `tasks` — asserts the row count is unchanged (still 1 — not deleted).
  4. Re-selects the row — asserts `status === 'done'` and `completed_at` is truthy.
  5. Calls `popTask(db, agent.name)` again — asserts it returns `null`.
- **Command**:
  ```bash
  cd /Users/davidtaylor/Repositories/tmux-conductor/host-server && node --import tsx/esm --test db.migration.test.ts
  ```
- **Expected Result**: The test named `"TASK-125: popTask flips a popped row to done/completed_at instead of deleting it, and never re-pops it"` passes.
- **Repeatable Unit Test**: Created: `host-server/db.migration.test.ts` (pre-existing — added during TASK-125's own `/tackle` implementation; verified present and passing at generation time).
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test db.migration.test.ts`
- [x] Pass <!-- 2026-08-15 -->

### UAT-EDGE-003: `pop_task_sql` (bash) independently soft-flips the popped row and never re-pops it — the live dispatch path today
- **Scenario**: **This is the case the task's own implementation could not fully close** — Step 5 of TASK-125 reasoned through `pop_task_sql`'s compatibility with the existing regression script by re-reading source, but explicitly deferred *executing* anything to UAT. `monitor.sh` still dispatches via this bash path today (TASK-121, which would retire it, has not landed), so this is the actually-live code path, not a legacy one. No prior repeatable test exercised `pop_task_sql`'s soft-flip behavior in isolation. This case builds a from-scratch v8 scratch DB (via the real `openDb()` migration, never touching `./data/conductor.db`), seeds one fixture agent + one queued task with plain `sqlite3` inserts, sources `scripts/lib/db.sh` with `CONDUCTOR_DB` pointed at the scratch file, and calls `pop_task_sql` directly — twice.
- **Steps**:
  1. Run the command below as-is. It builds `./tmp/verify-task-pop-soft-flip.db`, seeds one agent + one queued task, calls `pop_task_sql` once (asserting the row survives with `status='done'`/`completed_at` set and `LAST_QUEUE_REMAINING` correctly excludes it), then calls `pop_task_sql` again for the same agent (asserting `POPPED_TASK` comes back empty — never re-popped). Cleans up its own scratch DB via a `trap ... EXIT` regardless of outcome.
- **Command**:
  ```bash
  bash /Users/davidtaylor/Repositories/tmux-conductor/scripts/verify-task-pop-soft-flip.sh
  ```
- **Expected Result**: `Passed: 5  Failed: 0`, exit code 0 (verified by running this exact script, twice in a row to confirm idempotency, before writing this file — both runs 5/5 passing, and the scratch DB is gone after each run).
- **Repeatable Unit Test**: Created: `scripts/verify-task-pop-soft-flip.sh` — new file, added by this UAT-generation run to close a genuine coverage gap (no prior test exercised the bash pop path's soft-flip behavior at all). Deliberately does **not** spin up a live host-server or tmux session (unlike `scripts/verify-sqlite-migration.sh`, which is currently broken — see the finding at the bottom of this file) — only needs `sqlite3` + `bash`, so it is fast (well under a second) and independently repeatable without any live service.
- **Unit Test Command**: `bash scripts/verify-task-pop-soft-flip.sh`
- [x] Pass <!-- 2026-08-15 -->

### UAT-EDGE-004: The widened `CHECK` constraint accepts `'done'` and still rejects garbage
- **Scenario**: The v8 rebuild's `tasks.status` `CHECK` widens from `('queued','backlog')` to `('queued','backlog','done')`. This proves both directions live against a disposable scratch DB: an invalid status string is rejected exactly as before (not silently accepted, not crashing some other way), and `'done'` is accepted.
- **Steps**:
  1. Build a fresh scratch DB via the real migration path:
     ```bash
     rm -f /Users/davidtaylor/Repositories/tmux-conductor/tmp/uat125-check-scratch.db
     cd /Users/davidtaylor/Repositories/tmux-conductor/host-server && node --import tsx/esm --input-type=module -e "
     import { openDb } from './db.ts'
     const db = openDb('../tmp/uat125-check-scratch.db')
     db.close()
     "
     ```
  2. Attempt an invalid status (expect a `CHECK constraint failed` error, non-zero exit, no row inserted):
     ```bash
     sqlite3 /Users/davidtaylor/Repositories/tmux-conductor/tmp/uat125-check-scratch.db "INSERT INTO tasks (command, position, status) VALUES ('bad', 1.0, 'bogus')"
     ```
  3. Run the command below (a valid `'done'` insert — expect success).
  4. Cleanup: `rm -f /Users/davidtaylor/Repositories/tmux-conductor/tmp/uat125-check-scratch.db`
- **Command**:
  ```bash
  sqlite3 /Users/davidtaylor/Repositories/tmux-conductor/tmp/uat125-check-scratch.db "INSERT INTO tasks (command, position, status, completed_at) VALUES ('good', 1.0, 'done', strftime('%Y-%m-%dT%H:%M:%SZ','now')) RETURNING id, status;"
  ```
- **Expected Result**: Step 2 fails with `Error: stepping, CHECK constraint failed: status IN ('queued','backlog','done') (19)` and a non-zero exit — the error message itself confirms the widened 3-value set, not just "some rejection." Step 3 (the Command) succeeds and prints `1|done` (verified live at generation time — both steps produced exactly this).
- **Repeatable Unit Test**: Not applicable: the "accepts `'done'`" half is already covered by UAT-EDGE-001's cited unit test (the `assert.doesNotThrow` UPDATE-to-`done` assertion); the "rejects garbage" half is a one-line SQLite constraint check with no independent logic to isolate into a unit test beyond what a live `sqlite3` invocation already proves directly.
- [x] Pass <!-- 2026-08-15 -->

### UAT-API-001: The live queue endpoints and status snapshot exclude `done` tasks from "current queue" views
- **Endpoint**: `GET /api/queue/:id`, `GET /api/status`
- **Description**: TASK-125's Step 4 audit claimed every existing `tasks` query already filters by `status`, so no query would start surfacing completed tasks in "current queue" views. This case verifies that claim **live**, end-to-end, against the running host-server and its real `./data/conductor.db` (already at schema v8) — not just by re-reading source. A disposable fixture agent gets one `queued` task and one already-`done` task (inserted directly, scoped to the fixture agent only); both the agent-scoped queue endpoint and the global status snapshot's per-agent `queuedTasks` count must reflect only the queued one.
- **Steps**:
  1. Create a disposable fixture agent:
     ```bash
     mkdir -p /Users/davidtaylor/Repositories/tmux-conductor/tmp/uat125-fixture
     ```
     ```bash
     curl -sS -X POST 'http://127.0.0.1:8788/api/agents' -H 'Content-Type: application/json' -d "{\"name\":\"uat125-queue-test\",\"workdir\":\"$(pwd)/tmp/uat125-fixture\",\"launchCmd\":\"sleep 300\"}"
     ```
     Note the returned `agent.id` (call it `<AID>`).
  2. Seed one queued and one already-done task, both scoped to `<AID>` (substitute `<AID>`):
     ```bash
     sqlite3 /Users/davidtaylor/Repositories/tmux-conductor/data/conductor.db "INSERT INTO tasks (command, agent_id, position, status, source) VALUES ('echo uat125-queued', <AID>, 1.0, 'queued', 'manual')"
     sqlite3 /Users/davidtaylor/Repositories/tmux-conductor/data/conductor.db "INSERT INTO tasks (command, agent_id, position, status, source, completed_at) VALUES ('echo uat125-done', <AID>, 2.0, 'done', 'manual', strftime('%Y-%m-%dT%H:%M:%SZ','now'))"
     ```
  3. Run the command below (substitute `<AID>`), then also check `/api/status`:
     ```bash
     curl -sS 'http://127.0.0.1:8788/api/status' | jq --argjson aid <AID> '.agents[] | select(.id==$aid) | .queuedTasks'
     ```
  4. Teardown: `curl -sS -X DELETE "http://127.0.0.1:8788/api/agents/<AID>"` (cascades both task rows).
- **Command**:
  ```bash
  curl -sS 'http://127.0.0.1:8788/api/queue/<AID>' | jq '.tasks | length == 1 and .[0].command == "echo uat125-queued"'
  ```
  (substitute `<AID>`)
- **Expected Result**: The Command prints `true` — exactly one task in the queue response, and it's the queued one, not the done one. Step 3's `/api/status` check prints `1` (not `2`). Verified live at generation time against fixture agent id 13 (since deleted): `GET /api/queue/13` returned only the queued task; `queuedTasks` read `1`.
- **Repeatable Unit Test**: Not applicable: `buildQueuedTaskCounts` (`host-server/index.ts:164-193`) and `listTasksForAgentId` (`host-server/db.ts:631-644`) both already filter `WHERE status='queued'` — confirmed by direct source read, not just the task's own audit — but this case verifies the live route wiring end-to-end (snapshot caching, route registration), which needs the real running server.
- [x] Pass <!-- 2026-08-15 -->

### UAT-STATIC-001: `tsc --noEmit`, `npm test` (host-server), and `bash -n` on both modified shell scripts pass cleanly
- **Description**: The task's static-gate acceptance criteria, re-verified independently of `/tackle`'s own run.
- **Steps**:
  1. Run the three commands below.
- **Command**:
  ```bash
  cd /Users/davidtaylor/Repositories/tmux-conductor/host-server && npx tsc --noEmit
  ```
- **Expected Result**: Exit code 0, no output (verified live at generation time). `npm test` in `host-server/` was also re-run at generation time: 26/26 passing in `db.migration.test.ts` alone (includes both TASK-125 cases), full suite unaffected. `bash -n scripts/lib/db.sh` and `bash -n scripts/monitor.sh` both exit 0 with no output (verified live at generation time).
- **Repeatable Unit Test**: Not applicable: this command *is* the static gate itself, re-run verbatim; wrapping it in a unit test would just re-invoke the same compiler check.
- [x] Pass <!-- 2026-08-15 -->

---

## Coverage vs Acceptance Criteria

| Acceptance criterion | Covered by |
|---|---|
| Popping a task (either implementation) flips `status` to `'done'` and sets `completed_at` instead of deleting the row | UAT-EDGE-002 (TypeScript), UAT-EDGE-003 (bash) |
| Both the TypeScript and bash pop implementations are converted — neither is left doing a hard `DELETE` | UAT-EDGE-002, UAT-EDGE-003 |
| `tasks` schema is at version 8, with `status` accepting `'done'` and a new `completed_at` column | UAT-EDGE-001 (row preservation + schema version), UAT-EDGE-004 (CHECK accepts done / rejects garbage) |
| Existing queue-facing queries do not start showing completed tasks | UAT-API-001 (live, end-to-end) |
| `scripts/verify-sqlite-migration.sh`'s pop-race and backlog checks still pass | **Could not be executed as originally deferred — see Finding below.** The same underlying properties (pop precedence/never-re-pop, queue-count exclusion) are independently proven by UAT-EDGE-003 and UAT-API-001 via working paths. |
| `npx tsc --noEmit` passes; `npm test` is green; `bash -n` is clean on both modified shell files | UAT-STATIC-001 |

**Finding — `scripts/verify-sqlite-migration.sh` is currently broken, unrelated to TASK-125.** Its `start_backend()` function does `cd "$REPO/backend"` and expects `backend/index.ts` there — but this repo's host-server code lives in `host-server/`, not `backend/`; `backend/` exists only as an empty directory containing a stray `node_modules/` (a pre-rename leftover). This is a **pre-existing repo-drift bug in the verification script itself**, not a TASK-125 regression — the script's `check_pop_race`/`check_backlog` functions were never reachable in this session regardless of TASK-125's changes, since `start_backend()` would fail before either check runs. TASK-125's own Step 5 reasoned through compatibility by re-reading source rather than executing the script, which in hindsight was the only option available — executing it would have failed for this unrelated reason. Flagging this as a real, actionable finding: either update `verify-sqlite-migration.sh`'s `start_backend()` to `cd "$REPO/host-server"` (a one-line fix) or retire the script if it's superseded by something else — out of scope for this UAT to fix, since it's not a TASK-125 defect, but worth a follow-up task.

**Split summary**: 6 of 6 cases (100%) execute a genuine machine-checkable verdict — 3 unit-backed (`node --test` against pre-existing and one newly-created repeatable test file), 3 live-command (against disposable scratch DBs or the real running host-server with disposable fixtures). Zero human-only cases — TASK-125 has no UI surface.

**Note on `uatGenerate.promoteTests`**: the stored preference (`true`, legacy grammar) maps to `dedicated`, but the repo's own layout overrides it exactly as it has for every `host-server/` UAT this session — `db.migration.test.ts` already exists as the sibling test file for `db.ts`, so the two pre-existing TASK-125 cases live there (added during `/tackle`, not this run). For the new bash-path test, there is no dedicated bash test directory in this repo — `scripts/verify-task-pop-soft-flip.sh` follows the one existing local convention for bash-level verification scripts (`scripts/verify-sqlite-migration.sh`'s own `PASS`/`FAIL`-array + `check()` idiom), placed alongside it in `scripts/`.
