---
id: UAT-026
title: "UAT: End-to-end SQLite migration verification suite"
status: passed
task: TASK-026
created: 2026-06-13
updated: 2026-06-13
---

# UAT-026 — UAT: End-to-end SQLite migration verification suite

implements::[[TASK-026]]

> **Source task**: [`wiki/work/tasks/TASK-026-e2e-verification-suite.md`](../tasks/TASK-026-e2e-verification-suite.md)
> **Generated**: 2026-06-13

---

## Prerequisites

- [ ] No tmux sessions running (`tmux list-sessions` returns no server or empty)
- [ ] No backend server running on port 8788
- [ ] `sqlite3` CLI available (`sqlite3 --version`)
- [ ] `tmux` available (`tmux -V`)
- [ ] `tsx` available (`node --import tsx/esm --version` or `npx tsx --version`)
- [ ] Run from repo root: `/Users/davidtaylor/Repositories/tmux-conductor`
- [ ] `tmp/verify/` will be created by the script — no pre-setup needed
- [ ] Real `data/conductor.db` is never touched (the script uses `tmp/verify/conductor-verify.db`)

---

## Test Cases

### UAT-SCRIPT-001: Verification script exists and is executable

- **Description**: Confirms the deliverable file was created and has execute permissions.
- **Steps**:
  1. From repo root, run:
     ```bash
     ls -l scripts/verify-sqlite-migration.sh
     ```
  2. Check the output shows `-rwx` permissions and the file exists.
- **Expected Result**: File exists, first character group is `-rwx` (executable bit set). File begins with `#!/usr/bin/env bash`.
- [x] Pass <!-- 2026-06-13 -->

---

### UAT-RUN-001: Suite runs to exit 0 with all five checks PASS

- **Description**: The primary acceptance criterion — the suite exits 0 and prints `PASS` for all five checks. This is a self-contained run; the script manages its own backend lifecycle.
- **Steps**:
  1. Ensure no backend or tmux sessions are running.
  2. Run from repo root:
     ```bash
     bash scripts/verify-sqlite-migration.sh
     ```
  3. Observe output for each check line.
- **Expected Result**:
  - `PASS: seed-import` appears in output
  - `PASS: pop-race-and-precedence` appears in output
  - `PASS: fake-dispatch` appears in output
  - `PASS: schedule-fire` appears in output
  - `PASS: backlog-restore` appears in output
  - Final summary prints `All checks PASSED!`
  - Script exits with code `0` (`echo $?` == `0`)
  - No `FAIL:` lines appear anywhere in output
- [x] Pass <!-- 2026-06-13 -->

---

### UAT-CHECK-001: Check 1 — Schema initialization (seed-import)

- **Description**: Verifies that `openDb` runs migrations and creates all required tables; a second start does not duplicate data.
- **Steps**:
  1. After running UAT-RUN-001 (or independently), inspect `tmp/verify/conductor-verify.db`:
     ```bash
     sqlite3 tmp/verify/conductor-verify.db "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
     ```
  2. Check `meta` table:
     ```bash
     sqlite3 tmp/verify/conductor-verify.db "SELECT key, value FROM meta"
     ```
- **Expected Result**:
  - Tables present: `agents`, `bg_processes`, `meta`, `projects`, `schedules`, `tasks`
  - `meta` contains a `schema_version` row with a non-empty value
  - No task rows have `status` outside `('queued','backlog')`
- [x] Pass <!-- 2026-06-13 -->

---

### UAT-CHECK-002: Check 2 — Atomic pop and precedence

- **Description**: Verifies `pop_task_sql` in `scripts/lib/db.sh` is atomic (no duplicates under concurrent pops) and respects agent→project→global priority order.
- **Steps**:
  1. The suite runs this check automatically. To verify the precedence logic in isolation, inspect `scripts/lib/db.sh` `pop_task_sql()` and confirm the `ORDER BY CASE` clause: `agent_id IS NOT NULL → 0`, `project_id IS NOT NULL → 1`, else `2`.
  2. After UAT-RUN-001, confirm the suite printed both:
     - `500 tasks popped (none lost)`
     - `No duplicates (atomicity confirmed)`
     - `Precedence: scoped->project->global confirmed`
- **Expected Result**:
  - 500 global tasks popped with zero duplicates across two concurrent pop loops
  - Queue drained to 0 (no orphaned `queued` global tasks)
  - Three successive `pop_task_sql t1` calls return kind `scoped` → `project` → `global` in that order
- [x] Pass <!-- 2026-06-13 -->

---

### UAT-CHECK-003: Check 3 — Fake-agent dispatch

- **Description**: Verifies the full monitor→dispatch→capture-pane path using a `bash` fake agent in a throwaway tmux session.
- **Steps**:
  1. The suite creates a `conductor-verify` tmux session automatically. After UAT-RUN-001, confirm the output included:
     - `capture-pane shows POPPED-OK`
     - `Task row deleted from DB`
  2. Optionally check `logs/dispatch.jsonl` for a record with `"agent":"demo-1"` and `"command":"echo POPPED-OK"`.
- **Expected Result**:
  - `tmux capture-pane` of the agent window showed `POPPED-OK` within `3 × POLL_INTERVAL + 10s`
  - The task row was deleted from the `tasks` table after dispatch
  - `logs/dispatch.jsonl` gained a record for the dispatched task (non-fatal if absent)
  - The `conductor-verify` tmux session was torn down by the script
- [x] Pass <!-- 2026-06-13 -->

---

### UAT-CHECK-004: Check 4 — Schedule fire, skip_if_pending, jump placement

- **Description**: Verifies `fireSchedule` enqueues on tick, `skipIfPending` prevents pile-up, and `action='jump'` places the task at queue head.
- **Steps**:
  1. The suite runs this check automatically (takes ~30s due to tick waits). After UAT-RUN-001, confirm the output included:
     - `Schedule fired: 1 task(s) queued`
     - `skip_if_pending confirmed: count stayed at 1`
     - `Jump task is at queue head — confirmed`
- **Expected Result**:
  - A `source='schedule'` task row appeared within 15s of schedule creation
  - After a second scheduler tick the queued count for that schedule remained at 1 (not 2)
  - A schedule with `action='jump'` produced a task with the minimum `position` among all queued tasks for its project
- [x] Pass <!-- 2026-06-13 -->

---

### UAT-CHECK-005: Check 5 — Backlog restore

- **Description**: Verifies `moveToBacklog` flips agent-scoped tasks with positions intact, `restoreBacklog` returns them to `queued` with the same positions, and a restored task can be popped.
- **Steps**:
  1. The suite runs this check automatically. After UAT-RUN-001, confirm the output included:
     - `Backlog positions preserved`
     - `Restore positions intact`
     - `Popped restored task:` (with a non-empty task command)
- **Expected Result**:
  - Tasks moved to `backlog` retained their original `position` values
  - After restore, `status='backlog'` count for that agent is 0
  - Restored tasks have the same `position` values as before the backlog flip
  - `pop_task_sql demo-1` successfully returned one of the restored tasks
- [x] Pass <!-- 2026-06-13 -->

---

### UAT-IDEMPOTENT-001: Suite is idempotent (second run also exits 0)

- **Description**: Verifies the suite cleans up state between runs — a second `bash scripts/verify-sqlite-migration.sh` also exits 0.
- **Steps**:
  1. Run the suite a second time immediately after UAT-RUN-001:
     ```bash
     bash scripts/verify-sqlite-migration.sh
     ```
- **Expected Result**: Exit code 0, all five checks PASS, no errors from stale DB state (the script deletes `tmp/verify/conductor-verify.db` at startup).
- [x] Pass <!-- 2026-06-13 -->

---

### UAT-ISOLATION-001: Real database is untouched

- **Description**: Verifies the suite never writes to `data/conductor.db`.
- **Steps**:
  1. Before running the suite, note the modification time of `data/conductor.db` (if it exists):
     ```bash
     stat data/conductor.db 2>/dev/null || echo "does not exist"
     ```
  2. Run the suite.
  3. Re-check the modification time:
     ```bash
     stat data/conductor.db 2>/dev/null || echo "does not exist"
     ```
- **Expected Result**: `data/conductor.db` modification time is unchanged (or it still does not exist). Only `tmp/verify/conductor-verify.db` was written.
- [x] Pass <!-- 2026-06-13 -->
