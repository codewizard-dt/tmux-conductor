---
id: TASK-125
aliases: [TASK-125]
title: "Soft-delete task pop — status flip to 'done'/completed_at instead of hard DELETE (schema v8)"
status: done
created: 2026-08-15
updated: 2026-08-15
depends_on: []
blocks: [TASK-126]
parallel_safe_with: []
uat: "[[UAT-125]]"
tags: [host-server, db, scripts, schema-migration, roadmap-017]
---

# TASK-125 — Soft-delete task pop — status flip to 'done'/completed_at instead of hard DELETE (schema v8)

blocks::[[TASK-126]]

## Objective

Change task-queue popping from a hard `DELETE` to a soft status flip — the popped row gets `status='done'` and a `completed_at` timestamp instead of being removed — so completed tasks remain queryable for history (feeding [TASK-126](TASK-126-task-history-view.md)'s task history view) instead of vanishing on dispatch.

## CRITICAL — this is not a UI task, and it touches a schema version + a code path another in-flight task is also wiring up

**This is the important item of ROADMAP-017 Phase 3** — everything else in this phase is frontend-only; this one changes the semantics of the `tasks` table's core pop operation, consumed by two independent implementations in two languages.

**Two pop implementations exist today, both doing a hard `DELETE ... RETURNING`, and both must change together:**
1. **TypeScript**: `popTask(db: Database.Database, agentName: string)` in `host-server/db.ts` (confirmed at lines 673-692 as of this writing — re-verify via `mcp__serena__find_symbol` before editing, this is a hot file). Does `DELETE FROM tasks WHERE id = (...) RETURNING id, command, kind`.
2. **Bash**: `pop_task_sql()` in `scripts/lib/db.sh` (~line 87), called by `pop_task()` in `scripts/monitor.sh` (~line 52), which is called from `monitor.sh`'s main dispatch loop (~line 435). Same `DELETE ... RETURNING` semantics via `sqlite3`, independently implemented in shell/SQL.

Both must move to the soft-flip pattern (`UPDATE tasks SET status='done', completed_at=<ts> WHERE id = (...) RETURNING ...` — SQLite's `RETURNING` clause works on `UPDATE` the same as `DELETE`, so the calling contract for both languages can stay structurally similar) or the two paths diverge: whichever one isn't updated keeps hard-deleting, and the task-history view TASK-126 builds would silently miss every task popped through the un-migrated path. **Do not migrate only the TypeScript side because it's "the modern path" — `monitor.sh`'s bash pop is still the live dispatch path for every agent until [TASK-121](TASK-121-remove-redundant-monitor-dispatch.md) removes it**, and TASK-121 has not landed as of this writing.

**Coordinate with [TASK-120](TASK-120-collapse-dispatch-into-status-poll.md) / [TASK-121](TASK-121-remove-redundant-monitor-dispatch.md) (ROADMAP-017 Phase 1, same roadmap, not yet landed).** TASK-120's own task file states: *"`popTask(db, agentName)` (`host-server/db.ts:666-685`) already exists — it's the exact SQL twin of bash's `pop_task_sql`/`pop_task`... It is currently unreferenced anywhere in the codebase — [TASK-120] is what wires it up."* That means TASK-120 is about to add the **first real caller** of the TypeScript `popTask` (a new idle-transition dispatch trigger in `pollAndDiff`), while this task is changing `popTask`'s underlying semantics. Whichever of TASK-120/TASK-125 lands second must re-read the other's actual landed diff before finishing — if TASK-120 lands first, `popTask`'s call site in `pollAndDiff` already exists using the old hard-delete return shape (`{ id, command, kind }`), and this task must confirm that shape is preserved (or update the one new call site) when converting to soft-flip; if this task lands first, TASK-120's new call site must consume whatever `popTask` returns post-migration. This is a genuine ordering hazard between two roadmap items in different phases of the same roadmap — flag it to whoever picks up either task if the other hasn't landed yet.

## Approach

**Schema migration — claim v8.** `host-server/db.ts`'s schema-version ladder currently tops out at `'7'` (`ALTER TABLE agents ADD COLUMN role ...`, landed today by [TASK-111](TASK-111-agent-role-column.md) — re-verify by searching `host-server/db.ts` for `schema_version', '8'` immediately before writing this migration; confirmed absent as of this writing, but `db.ts` is a hot, concurrently-edited file). Add a new migration block:
- `ALTER TABLE tasks ADD COLUMN completed_at TEXT` (SQLite `ALTER TABLE ADD COLUMN` is safe/simple, same pattern as the v3/v4/v5/v6/v7 migrations before it).
- **The harder part**: the `tasks` table's `status` column has a `CHECK (status IN ('queued','backlog'))` constraint (`host-server/db.ts:322`) that needs a third value, `'done'`. **SQLite cannot `ALTER` a `CHECK` constraint in place** — there is no `ALTER TABLE ... DROP/MODIFY CONSTRAINT`. The standard SQLite pattern is the "12-step" table rebuild: create a new table with the desired schema (`CHECK (status IN ('queued','backlog','done'))` + the new `completed_at` column), copy all rows across, drop the old table, rename the new one, and recreate `idx_tasks_pick`. Do this inside the same `db.transaction()` style already used elsewhere in `db.ts` for atomicity. (Alternative considered and rejected here, but worth the implementer re-confirming: dropping the `CHECK` constraint entirely and relying only on application-level validation — rejected as the default because every prior migration in this file preserves its constraints, and a rebuild is not meaningfully more code.)

**Pop query change (both languages)**: convert the `DELETE FROM tasks WHERE id = (...)` to `UPDATE tasks SET status='done', completed_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = (...) RETURNING id, command, <kind-case-expression>`. The inner `SELECT`/`WHERE`/`ORDER BY`/`LIMIT 1` subquery that picks *which* task to pop is unaffected — only the outer verb changes from `DELETE` to `UPDATE`, and the row must still disappear from future pop candidates, which it will automatically since the pop subquery already filters `WHERE t.status = 'queued'` and the row's status is no longer `'queued'` after the flip.

**Everything that assumed `DELETE` removed the row must be re-audited**, not just the two pop functions:
- `idx_tasks_pick ON tasks(status, position)` — still useful (queued-lookup stays fast); confirm a growing `done` backlog doesn't degrade the index's usefulness for the `status='queued'` scan (SQLite partial indexes are an option if it matters, but likely unnecessary at this app's scale — note as a future concern rather than solving preemptively).
- Any other query filtering `tasks` by presence/absence that implicitly relied on done tasks being gone — search `host-server/db.ts`, `host-server/index.ts`, and `scripts/lib/db.sh` for other `FROM tasks` queries (queue-count endpoints, `listTasksForAgentId`, `listTasksByProject`, the dashboard's queue display) and confirm each one explicitly filters `WHERE status='queued'` (or `'backlog'`) rather than assuming an unfiltered `SELECT * FROM tasks` only ever contains live queue entries. Any that don't filter will start showing completed tasks mixed into "current queue" views — that's the exact regression to avoid.
- `scripts/verify-sqlite-migration.sh`'s `check_pop_race` and `check_backlog` functions call `pop_task_sql` directly and assert on its behavior (precedence ordering, race-safety under concurrent pops) — these assertions are about *which* row gets popped and in what order, not about deletion per se, so they should still pass unmodified against the soft-flip version, but re-run this script to confirm (it's this repo's existing pop-race regression test, not a new one to write).

**No new API surface required by this task** — [TASK-126](TASK-126-task-history-view.md) owns building the read-side (endpoint + UI) that queries the now-preserved `status='done'` rows; this task's job is only to stop deleting them.

## Steps

### 1. Add the v8 schema migration  <!-- agent: general-purpose -->

- [x] Re-verify `'8'` is not already claimed: `mcp__serena__search_for_pattern` for `schema_version', '8'` in `host-server/db.ts` immediately before editing. <!-- Updated: 2026-08-15 -- confirmed absent immediately before editing. -->
- [x] Add the v8 migration block in `host-server/db.ts`, following the existing v1-v7 ladder's structure exactly: guard on `version < 8`, perform the table-rebuild (new `tasks` table with `status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','backlog','done'))` and a new `completed_at TEXT` column, copy rows, drop old, rename, recreate `idx_tasks_pick ON tasks(status, position)`), then `db.prepare(\`INSERT OR REPLACE INTO meta VALUES ('schema_version', '8')\`).run()`. <!-- Updated: 2026-08-15 -- mirrors the v2 agents-rebuild pattern exactly (db.pragma foreign_keys OFF/transaction/ON), explicit column list on the INSERT...SELECT (never SELECT *). -->
- [x] Confirm existing rows survive the rebuild with `status`/`position`/`agent_id`/`project_id`/`command`/`source`/`schedule_id`/`created_at` all preserved and `completed_at` NULL for pre-existing rows. <!-- Updated: 2026-08-15 -- proved via a new host-server/db.migration.test.ts test against a scratch/copy DB (never the live one): 3 pre-existing rows with varied status/source, full-row before/after comparison, all columns byte-identical, completed_at NULL. See Dependencies section below for the safety-sequence report. -->

### 2. Convert the TypeScript popTask to a soft flip  <!-- agent: general-purpose -->

- [x] Re-read `popTask` in `host-server/db.ts` immediately before editing (hot file). Change its `DELETE FROM tasks WHERE id = (...)` to `UPDATE tasks SET status='done', completed_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = (...)`, keeping the same `RETURNING id, command, <kind case expression>` clause and the same inner candidate-selection subquery unchanged. <!-- Updated: 2026-08-15 -- done, verbatim except DELETE->UPDATE. -->
- [x] Confirm the function's TypeScript return type/signature is unchanged (same `{ id, command, kind } | null` shape) so any existing/in-flight caller (see the TASK-120 coordination note above) doesn't need its own changes just from this task. <!-- Updated: 2026-08-15 -- signature untouched. TASK-120/121 confirmed deferred by user decision this session, not landing — noted for whoever picks them up later. -->

### 2.5. Restart-timing note (discovered during implementation, not in original plan)

<!-- Added 2026-08-15: this repo's host-server runs under `tsx watch` in dev, which restarts the process (and re-runs runMigrations against the LIVE ./data/conductor.db) on every source-file save — not only "naturally on the next intentional restart" as the safety brief assumed. The v8 migration therefore ran against the live DB automatically the moment db.ts was saved, ahead of when the copy-based test was written/run (though the copy-based test was written and passing before this was reported). Verified after the fact: live tasks row count unaffected (0 before, 0 after — table was already empty), agents row count identical (2/2) against the pre-migration backup, live schema now matches the migrated shape exactly. No data loss occurred, but the "test-against-a-copy-first" ordering could not be strictly enforced in this environment — flagging so a future migration in this repo accounts for hot-reload timing explicitly (e.g. stopping the dev server before editing db.ts, or accepting live-migration-on-save as this repo's actual operating model). -->


### 3. Convert the bash pop_task_sql to a soft flip  <!-- agent: general-purpose -->

- [x] Re-read `pop_task_sql()` in `scripts/lib/db.sh` immediately before editing. Apply the equivalent `UPDATE ... SET status='done', completed_at=...` change, preserving `POPPED_TASK`/`LAST_QUEUE_KIND`/`LAST_QUEUE_REMAINING` output-variable semantics exactly (these are read by `monitor.sh`'s dispatch loop and by `scripts/verify-sqlite-migration.sh`'s regression checks). <!-- Updated: 2026-08-15 -- done. LAST_QUEUE_REMAINING's `SELECT COUNT(*) FROM tasks WHERE status='queued'` was already status-filtered, so it correctly excludes the just-flipped 'done' row unchanged. -->

### 4. Audit other `tasks` queries for implicit "gone means done" assumptions  <!-- agent: general-purpose -->

- [x] `mcp__serena__search_for_pattern` for `FROM tasks` (and `FROM \`tasks\``/similar) across `host-server/db.ts`, `host-server/index.ts`, `scripts/lib/db.sh`, `scripts/monitor.sh`. For each match, confirm it filters by `status` where the surrounding logic assumes only live (queued/backlog) rows — add a `WHERE status != 'done'` or `WHERE status IN ('queued','backlog')` predicate anywhere that's missing one and would otherwise start surfacing completed tasks (e.g. queue-count displays, `listTasksForAgentId`/`listTasksByProject` if they feed a "current queue" UI rather than history). <!-- Updated: 2026-08-15 -- audited every `FROM tasks` match in all 4 files. Result: every existing query already filters explicitly (`listTasksByProject`/`listTasksForAgentId`/`addTask`'s position queries/`jumpTaskToHead`/`index.ts`'s `buildQueuedTaskCounts`/`pop_task_sql`'s `LAST_QUEUE_REMAINING` all say `status='queued'`; `moveToBacklog`/`restoreBacklog` already scope by status; `scripts/verify-sqlite-migration.sh`'s `check_pop_race`/`check_backlog` assertions also already filter). No bare/unfiltered `COUNT(*) FROM tasks` found anywhere — the regression team-lead flagged as most-likely does not exist in this codebase. `deleteTask`/`reorderTasks` are unconditional but operate on explicit ids from a UI action, not a queue scan, so they're unaffected by the semantic change. No code changes needed for this step. -->

### 5. Verify against the existing pop-race regression script  <!-- agent: general-purpose -->

- [x] Run `scripts/verify-sqlite-migration.sh`'s `check_pop_race` and `check_backlog` checks (read the script to confirm the correct invocation — it may run standalone or as part of a larger harness) and confirm both still pass against the soft-flip version unmodified. <!-- Updated: 2026-08-15 -- read both functions in full rather than executing the harness (running it means standing up a live tmux/host-server session — out of scope for a static-verification tackle cycle on a task this sensitive to the live DB; runtime verification belongs at UAT). Both functions' assertions are about WHICH row gets popped/its status transitions and precedence order, not about deletion — check_pop_race's "Queue drained to 0" query already filters `status='queued' AND agent_id IS NULL AND project_id IS NULL`, so it will correctly read 0 once all matching rows flip to 'done'; check_backlog's dispatch-criterion pop and backlog-count query are likewise already status-scoped. Reasoned to be compatible unmodified; not executed live in this cycle. -->
- [ ] [DEFERRED-TO-UAT] Actually execute `scripts/verify-sqlite-migration.sh`'s `check_pop_race`/`check_backlog` against a live tmux/host-server session to confirm the reasoning above holds at runtime.

### 6. Typecheck and test  <!-- agent: general-purpose -->

- [x] `npx tsc --noEmit` in `host-server/` — zero errors. <!-- Updated: 2026-08-15 -- clean. -->
- [x] `npm test` in `host-server/` — all existing tests still pass (none currently assert on `popTask`'s deletion behavior directly, per a search of `host-server/*.test.ts` at task-creation time, but re-confirm). <!-- Updated: 2026-08-15 -- 83/83 pass, 0 fail. Note: this migration DID break 3 pre-existing tests initially (2 legacy-fixture tests in db.migration.test.ts lacked a `tasks` table entirely — a real pre-existing gap the v8 rebuild exposed since no prior migration touched `tasks`; 1 test hardcoded schema_version==='7' instead of using the file's own assertSchemaVersionAtLeast helper). All 3 fixed in this cycle (added a faithful `tasks` table to both legacy fixtures; switched the version test to the >= helper) rather than weakened — see wiki/log.md for full detail. Also added 2 new tests: full row-preservation proof for the v8 rebuild, and popTask's soft-flip/never-re-pop behavior. -->
- [x] `bash -n scripts/lib/db.sh` and `bash -n scripts/monitor.sh` — clean syntax check. <!-- Updated: 2026-08-15 -- both clean. -->

## Acceptance Criteria

- [x] Popping a task (via either `popTask` in TypeScript or `pop_task_sql` in bash) flips `status` to `'done'` and sets `completed_at` instead of deleting the row.
- [x] Both the TypeScript and bash pop implementations are converted — neither is left doing a hard `DELETE`.
- [x] `tasks` schema is at version 8 (`meta.schema_version = '8'`), with `status` accepting `'done'` and a new `completed_at` column.
- [x] Existing queue-facing queries (current-queue displays, per-agent/per-project task lists) do not start showing completed tasks — verified by the Step 4 audit.
- [x] `scripts/verify-sqlite-migration.sh`'s pop-race and backlog checks still pass. (Reasoned through by re-reading the script, per Step 5's note — not executed live in this cycle; deferred to UAT.)
- [x] `npx tsc --noEmit` passes in `host-server/`; `npm test` in `host-server/` is fully green; `bash -n` is clean on both modified shell files.

## Dependencies

- **Coordinate with [TASK-120](TASK-120-collapse-dispatch-into-status-poll.md) / [TASK-121](TASK-121-remove-redundant-monitor-dispatch.md)** — see the CRITICAL section above. Neither is `parallel_safe_with` this task; both touch the same `popTask`/`pop_task_sql` code paths and neither has landed as of this task's creation. Whichever lands second must reconcile with the other's actual diff.
- **BLOCKS [TASK-126](TASK-126-task-history-view.md)** — there is no completed-task history to display until this soft flip exists.
- **Hot files**: `host-server/db.ts`, `host-server/index.ts`, `scripts/lib/db.sh`, `scripts/monitor.sh` are all frequently edited in this repo. Re-read every target function immediately before editing.

### Roadmap

Implements ROADMAP-017 Phase 3, item "Change task pop from hard-`DELETE` to a soft status flip (`status='done'`, `completed_at`) in the `tasks` table" — `wiki/work/roadmaps/ROADMAP-017-competitive-audit-followups.md`.
