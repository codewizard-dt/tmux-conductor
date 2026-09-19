---
id: UAT-155
aliases: [UAT-155]
title: "UAT: Add a Bash ≥4 self-check guard to scripts/lib/db.sh"
status: passed
task: TASK-155
created: 2026-09-17
updated: 2026-09-17
---

# UAT-155 — UAT: Add a Bash ≥4 self-check guard to scripts/lib/db.sh

implements::[[TASK-155]]

> **Source task**: [[TASK-155]]
> **Generated**: 2026-09-17

---

## Prerequisites

- [ ] macOS's stock system bash (`/bin/bash`, typically 3.2) available for the failure-path case.
- [ ] A PATH-resolved bash ≥4 (e.g. Homebrew's `/opt/homebrew/bin/bash`) available for the success-path case.

---

## Test Cases

### UAT-EDGE-001: Sourcing scripts/lib/db.sh under bash < 4 fails fast with a clear FATAL/Remedy message, not bash's cryptic native error
- **Scenario**: Before this fix, sourcing `db.sh` under bash 3.2 would eventually hit `load_agents()`/`load_bg()`'s `declare -gA` and fail with bash's own bare `declare: -g: invalid option` — no mention of bash version, no path to the fix. The new guard must fail immediately at source time with an actionable message instead.
- **Steps** (executed live, not simulated):
  1. Confirmed `/bin/bash --version` is `3.2.57(1)-release` on this machine.
  2. Ran `/bin/bash -c 'source .../scripts/lib/db.sh'`.
- **Expected Result**: Exits non-zero immediately, printing `FATAL: this script requires bash >= 4 (found: 3.2.57(1)-release).` and a `Remedy:` line — not the old cryptic `declare: -g: invalid option`, and without reaching any DB-touching code.
- **Actual Result** (2026-09-17): Exactly as expected — `FATAL: this script requires bash >= 4 (found: 3.2.57(1)-release).` / `Remedy: install bash >= 4 via your package manager (macOS: brew install bash) and ensure it precedes any older bash on PATH.`, exit code 1.
- [x] Pass <!-- 2026-09-17: verified live against the real macOS system bash on this machine -->

---

### UAT-EDGE-002: Sourcing scripts/lib/db.sh under bash >= 4 succeeds exactly as before, unchanged
- **Scenario**: Regression guard — the new guard must be a pure no-op for any bash that already satisfies it; sourcing must still resolve `CONDUCTOR_DB` and define `sql()`/`sql_one()` etc. exactly as before this change.
- **Steps** (executed live, not simulated):
  1. Confirmed PATH-resolved `bash --version` is `5.3.9(1)-release` on this machine (`/opt/homebrew/bin/bash`).
  2. Ran a throwaway `./tmp/` scratch script sourcing `scripts/lib/db.sh` and echoing `$CONDUCTOR_DB`.
- **Expected Result**: Exits 0, `CONDUCTOR_DB` resolves to the real conductor.db path exactly as `db.sh`'s existing DB-path-resolution logic (untouched by this task) already did before the guard was added.
- **Actual Result** (2026-09-17): Exit 0, `CONDUCTOR_DB=/Users/davidtaylor/Repositories/tmux-conductor/data/conductor.db` — resolved correctly. Scratch script deleted after.
- [x] Pass <!-- 2026-09-17 -->

---

### UAT-EDGE-003: All 8 scripts/*.sh entry points that source db.sh remain syntactically valid
- **Scenario**: Regression guard — inserting the guard into the shared library must not introduce a syntax error rippling into any of the 8 scripts that source it.
- **Steps**: `bash -n` run against `scripts/lib/db.sh` and each of `scripts/monitor.sh`, `scripts/conductor.sh`, `scripts/spawn.sh`, `scripts/teardown.sh`, `scripts/add-task.sh`, `scripts/broadcast.sh`, `scripts/verify-sqlite-migration.sh`, `scripts/verify-task-pop-soft-flip.sh` (syntax-check only — none were executed, since several would interact with the real live conductor session if run).
- **Expected Result**: All 9 files (`db.sh` + the 8 sourcing scripts) pass `bash -n` cleanly.
- **Actual Result** (2026-09-17): All 9 clean, no output from any.
- **Repeatable Unit Test**: Not applicable: these are shell scripts with no unit-test framework in this repo's convention — `bash -n` is itself the repo's established static-verification method for shell scripts.
- [x] Pass <!-- 2026-09-17 -->

---

## Gaps

None — every case in this task's own acceptance criteria (including both `[DEFERRED-TO-UAT]` manual-verification bullets) was verified live and safely, by sourcing `db.sh` in isolation rather than invoking a full entry-point script, avoiding any interaction with this environment's real live conductor session.
