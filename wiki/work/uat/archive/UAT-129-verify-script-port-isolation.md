---
id: UAT-129
aliases: [UAT-129]
title: "UAT: Port isolation for scripts/verify-sqlite-migration.sh"
status: passed
task: TASK-129
created: 2026-09-17
updated: 2026-09-17
---

# UAT-129 — UAT: Port isolation for scripts/verify-sqlite-migration.sh

implements::[[TASK-129]]

> **Source task**: [[TASK-129]]
> **Generated**: 2026-09-17

---

## Prerequisites

- [ ] `sqlite3` CLI available (for the before/after row-count check).
- [ ] `lsof` available (for the port-ownership check).
- [ ] The live dev host-server does not need to be running for this to pass, but this UAT is most meaningful when it IS running (the exact hazard scenario TASK-129 fixes) — this run was executed with a live host-server already bound to :8788.

---

## Test Cases

### UAT-EDGE-001: Running the verify script against the live dev environment leaves the real conductor.db and the live host-server's port untouched
- **Scenario**: This is the actual acceptance bar TASK-129 was written to satisfy — not "the script exits 0," but that a full run, executed while a live dev host-server already occupies :8788, produces zero observable change to the real `./data/conductor.db` or the live server's port ownership.
- **Steps** (executed live, not simulated):
  1. Captured baseline row counts in `./data/conductor.db` across `agents`, `projects`, `tasks`, `schedules`, `bg_processes` via `sqlite3`.
  2. Captured the PID holding `:8788` via `lsof -nP -iTCP:8788 -sTCP:LISTEN`.
  3. Ran `bash scripts/verify-sqlite-migration.sh` end-to-end from the repo root, with the live dev host-server left running throughout.
  4. Re-captured the same row counts and the same port-ownership check.
- **Expected Result**: Row counts identical before/after; the PID holding `:8788` identical before/after; the script's own cleanup log line confirms `Real data/conductor.db was NOT touched.`
- **Actual Result**: Baseline `agents=8, projects=9, tasks=15, schedules=0, bg_processes=1` — identical after the run. Port `:8788` held by PID `78669` both before and after — unchanged. Script's own log: `[cleanup] Real data/conductor.db was NOT touched.`
- **Repeatable Unit Test**: Not applicable: this is an integration-level, real-process, real-filesystem guarantee (no fork/port collision against a real live server) — not expressible as a unit test without spinning up two real server processes, which is exactly what this live run already did once, deliberately and carefully (baseline captured first, specific to this task's actual safety concern).
- [x] Pass <!-- 2026-09-17: executed live per the steps above -->

---

### UAT-EDGE-002: The readiness probe's port-parameterization and identity-check code is present and correctly shaped
- **Scenario**: Static regression guard — confirms the actual source changes from tackle steps 1-2 are present (VERIFY_PORT parameterization, all curl calls pointed at the scratch port, liveness + PID-identity checks in the readiness loop) independent of the live-run evidence in UAT-EDGE-001.
- **Steps**: Covered by direct source inspection during tackle (see TASK-129's own step notes) — `VERIFY_PORT="${VERIFY_PORT:-18788}"`, `BACKEND_PORT="$VERIFY_PORT"` on the spawn line, `kill -0 "$BACKEND_PID"` liveness check, and an `lsof`-based PID cross-check against `$BACKEND_PID` before declaring readiness.
- **Expected Result**: All of the above present in `scripts/verify-sqlite-migration.sh`; `bash -n` clean throughout.
- **Repeatable Unit Test**: Not applicable: this is a shell script with no unit-test framework in this repo's convention (host-server/frontend use vitest/node:test for TS/JS; shell scripts are verified via `bash -n` + live execution, per this repo's existing pattern for `scripts/*.sh`).
- [x] Pass <!-- 2026-09-17: confirmed present during tackle steps 1-2, bash -n clean both times -->

---

### UAT-EDGE-003 (discovered, out of scope): 3 of the script's 5 check_* functions fail on a clean run — filed as BUG-0011
- **Scenario**: The same live run that proved UAT-EDGE-001 also surfaced that `pop-race-and-precedence`, `fake-dispatch`, and `backlog-restore` all report `FAIL` — including a genuine SQL string-interpolation bug in `check_backlog` (`t.agent_id = demo-1` parsed as a bare column reference, not a quoted string). These failures are unrelated to TASK-129's port-isolation scope; only `seed-import` and `schedule-fire` passed.
- **Expected Result relative to TASK-129's own scope**: N/A — this case exists only to record that the discovery was made and handled, not to gate TASK-129's own pass/fail. TASK-129 only needed to prove no live-DB/port impact (UAT-EDGE-001), which it did.
- **Disposition**: Filed as `[[BUG-0011]]` rather than silently fixed or ignored — out of TASK-129's scope, and fixing `check_backlog`'s SQL bug live (or attempting to diagnose the `fake-dispatch` timeout) risked expanding this task well beyond its own acceptance bar.
- [x] Pass <!-- 2026-09-17: correctly handled per scope discipline — filed, not silently absorbed or ignored -->

---

## Gaps

- `fake-dispatch`'s and `pop-race-and-precedence`'s specific failure modes were not captured in full transcript detail in this run (only `fake-dispatch`'s and `check_backlog`'s were) — `BUG-0011` flags this as a re-run-and-capture follow-up for whoever triages it.
