---
id: BUG-0011
aliases: [BUG-0011]
title: "scripts/verify-sqlite-migration.sh: 3 of 5 check_* functions fail (SQL string-interpolation bug in check_backlog; timeouts in fake-dispatch and pop-race-and-precedence)"
status: in-progress
severity: medium
priority: P3
created: 2026-09-17
updated: 2026-09-17
reporter: David Taylor
assignee: David Taylor
tags: scripts, verification, sqlite, host-server
impact: "The verify script's own self-test coverage for pop_task_sql precedence and backlog-restore positions was unreliable — both check_* functions failed on a clean run, so this script could not be trusted as a regression gate for those two behaviors. Never affected production data or the live host-server (confirmed via before/after row-count checks on ./data/conductor.db across every run in this investigation, both before and after the fix). The third originally-reported symptom (fake-dispatch) turned out to be a distinct, unrelated defect — split off to [[BUG-0012]] rather than bundled into this fix."
workaround: "None was needed — fixed same-session."
linked_task: "—"
---

# BUG-0011 — scripts/verify-sqlite-migration.sh: 3 of 5 check_* functions fail

## Environment

- OS: macOS (Darwin 25.3.0)
- App: tmux-conductor @ `ac0bf01` (main branch)
- Runtime: `scripts/verify-sqlite-migration.sh`, run via `bash scripts/verify-sqlite-migration.sh`
- Config: default, `VERIFY_PORT` at its new default (18788) — TASK-129's port-isolation fix was applied immediately before this run and confirmed working (real `./data/conductor.db` row counts and the live host-server's PID/port were unchanged before vs. after)

## Steps to Reproduce

1. On a machine with the live dev host-server already running on :8788 (or not — not required to reproduce this specific bug, only relevant to the port-isolation fix this run was actually verifying).
2. Run `bash scripts/verify-sqlite-migration.sh` from the repo root.
3. Observe the `Summary` block at the end.

## Expected Behavior

All 5 `check_*` functions (`seed-import`, `pop-race-and-precedence`, `fake-dispatch`, `schedule-fire`, `backlog-restore`) report `PASS`.

## Actual Behavior

```
================================================
 Summary
================================================
PASS (2): seed-import schedule-fire
FAIL (3): pop-race-and-precedence fake-dispatch backlog-restore
```

- **`check_backlog` (backlog-restore)**: fails with a SQLite error before completing:
  ```
  Error: in prepare, no such column: demo
             (t.agent_id IS NOT NULL AND t.agent_id = demo-1)       OR (t.project_
                                        error here ---^
  [check_backlog] FAIL: pop_task_sql failed on restored task
  ```
  The agent id/name value `demo-1` appears to be spliced into the SQL as a bare (unquoted) identifier rather than a quoted string literal or bound parameter — SQLite parses `demo` as a column reference and stops at the `-1`.

- **`fake-dispatch`**: polls `capture-pane` output for up to 55 seconds waiting for a `POPPED-OK` marker that never appears, then fails:
  ```
  [check_dispatch] FAIL: capture-pane did not show POPPED-OK within 55s
  [check_dispatch] Final pane output:
  (capture failed)
  [check_dispatch] DB tasks still queued: echo POPPED-OKqueued
  [check_dispatch] DB task count: 501
  [check_dispatch] FAIL: task row still in DB (count=1)
  ```
  (`(capture failed)` and a task count of `501` both look like separate, possibly-related oddities worth investigating alongside the timeout itself.)

- **`pop-race-and-precedence`**: also reported as `FAIL` in the summary; not separately captured in this report's transcript excerpt — re-run and capture its specific output before triage.

## Reproducibility

`always` (observed on a single run; not yet re-run to confirm determinism vs. environmental flakiness — `fake-dispatch`'s tmux capture-pane timeout in particular could plausibly be environment/timing-sensitive rather than a deterministic code bug, unlike `check_backlog`'s SQL-quoting issue which reads as a straightforward, reproducible bug from the error text alone).

## Root Cause Analysis

**`check_backlog` (backlog-restore)**: `scripts/verify-sqlite-migration.sh:768` called `pop_task_sql "demo-1"` — a literal hardcoded agent *name* — even though the very same function already had the agent's resolved numeric id in scope (`local agent_id; agent_id="$(sqlc "SELECT id FROM agents WHERE name='demo-1' LIMIT 1")"` a few lines earlier, per `scripts/lib/db.sh:679`). `pop_task_sql()` (`scripts/lib/db.sh:102-136`) inlines its `$1` argument directly into a WHERE clause (`t.agent_id = ${agent_id}`) unquoted, by design — its own comment documents that this is safe *only* because callers are expected to pass the numeric id `load_agents()` resolves (`AGENT_IDS["$name"]`), never a bare name. Passing `"demo-1"` made SQLite parse `demo` as a bare (nonexistent) column reference and stop at the `-1`, producing `no such column: demo`. `db.sh` itself was correct and untouched; this was purely a misuse bug in the verify script's own test code.

**`check_pop_race` (pop-race-and-precedence)** had two separate instances of the same class of misuse, plus one more subtle bug once the first was fixed:
1. The two parallel race-pop subshells (`scripts/verify-sqlite-migration.sh`, originally ~line 256/267) called `pop_task_sql 'racer'` — the bare agent name, never resolved to an id — producing `no such column: racer` for the same reason as above.
2. The precedence sub-check (~line 330/336/343) called `pop_task_sql "t1"` — again a bare name, even though `t1_id` was already resolved a few lines earlier (~line 319).
3. After fixing (1) and (2) to use the resolved numeric ids, a **third**, previously-masked bug surfaced: none of the three precedence calls ever passed `pop_task_sql`'s optional second argument (`project_id`). `pop_task_sql`'s project-scoped WHERE branch (`t.project_id IS NOT NULL AND ${project_pred}`) is gated entirely on that second argument — omitted, `project_pred` defaults to the literal `'0'`, permanently disabling that branch. This silently made "pop2" (intended to exercise the project-scoped `prec-project` task) fall through to the third (global) branch instead and consume `prec-global` early, leaving "pop3" with nothing left to pop and no correct assertion coverage for project-scoped precedence had ever actually run.

## Resolution

Fixed in `scripts/verify-sqlite-migration.sh`:
- `check_dispatch`'s hardcoded `"demo-1"` → `"$agent_id"` (the already-resolved local variable).
- `check_pop_race`: added `local racer_id; racer_id="$(sqlc "SELECT id FROM agents WHERE name='racer'")"` right after the agent's `INSERT OR IGNORE`, and used `"$racer_id"` in both parallel pop-loop subshells (interpolated into the `bash -c "..."` string at construction time, same pattern the file already uses for `$db_sh`/`$out1`/`$out2`).
- `check_pop_race`'s precedence sub-check: all three `pop_task_sql` calls changed from `"t1"` to `"$t1_id" "$proj_id"` (both the id fix and the missing second-argument fix), with a comment explaining why both arguments matter.

**Regression test**: the fix's own verification *is* the regression test — re-ran the full script live, twice, against the real conductor session (with before/after `sqlite3` row-count checks each time confirming zero impact on `./data/conductor.db`, and an `lsof` check confirming the live host-server's port/PID were untouched): `pop-race-and-precedence` now reports `PASS` with the precedence order explicitly confirmed (`scoped(prec-scoped) -> project(prec-project) -> global(prec-global)`), and `backlog-restore` now reports `PASS`. `bash -n` clean throughout.

**Fix commit**: not yet committed — the fix is a verified working-tree change to `scripts/verify-sqlite-migration.sh`. Left `status: in-progress` rather than `closed` because this repo's bug lifecycle requires a fix-commit reference to close, and creating a commit is a deliberate action reserved for when the user asks for it, not something this unattended loop does on its own. **Next step for the user**: review the diff and commit it, then run `/bug-close BUG-0011` to formally close with the commit hash recorded.

## Related

- Split off [[BUG-0012]] for the third originally-reported symptom (`fake-dispatch`'s 55s timeout) — investigation revealed it's an unrelated defect (likely a window-name mismatch or a separate dispatch-path issue), not fixable by the same SQL-argument fix, and deserving its own root-cause investigation.
