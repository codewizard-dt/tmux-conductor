---
id: UAT-128
aliases: [UAT-128]
title: "UAT: monitor.sh single-instance startup guard — PID lockfile keyed on STATE_DIR"
status: pending
task: TASK-128
created: 2026-09-13
updated: 2026-09-13
---

# UAT-128 — UAT: monitor.sh single-instance startup guard — PID lockfile keyed on STATE_DIR

implements::[[TASK-128]]

> **Source task**: [[TASK-128]]
> **Generated**: 2026-09-13

**⚠️ Safety note — do not run these tests against the live conductor.** This machine has a real `monitor.sh` currently running against `./conductor.conf` (`STATE_DIR=./logs/state`, `DB_PATH=./data/conductor.db`, `SESSION_NAME=conductor`), driving many real active agents. Starting a second real instance against that same config — exactly the scenario this task fixes — is the wrong way to test it. Every test case below runs against an **isolated scratch copy** of `scripts/monitor.sh` + `scripts/lib/db.sh` with its own `conductor.conf` (different `SESSION_NAME`, `DB_PATH`, `STATE_DIR`, `LOG_DIR`, all under `./tmp/`), built once in Prerequisites. Never point any of these tests at the repo's real `conductor.conf`.

`scripts/monitor.sh` has no bash test harness in this repo (same constraint noted in TASK-113/UAT-113) — every case here is a Manual scenario; none are promotable to a repeatable unit test (no JS/TS/Python code was touched by this task, and there is no bash test runner to add one to).

---

## Prerequisites

- [ ] A scratch harness exists at `./tmp/uat-128-scratch/` mirroring the real relative layout so `monitor.sh`'s `$SCRIPT_DIR/../conductor.conf` resolution finds the scratch config instead of the real one:
  ```bash
  mkdir -p ./tmp/uat-128-scratch/scripts/lib ./tmp/uat-128-scratch/data ./tmp/uat-128-scratch/logs/state ./tmp/uat-128-scratch/bin
  cp scripts/monitor.sh ./tmp/uat-128-scratch/scripts/monitor.sh
  cp scripts/lib/db.sh ./tmp/uat-128-scratch/scripts/lib/db.sh
  cp conductor.conf ./tmp/uat-128-scratch/conductor.conf
  ```
- [ ] Edit `./tmp/uat-128-scratch/conductor.conf` so it never touches the real session/DB/state: change `SESSION_NAME="conductor"` → `SESSION_NAME="uat-128-scratch"`, `DB_PATH="./data/conductor.db"` → `DB_PATH="./data/scratch.db"` (already relative to the scratch root, unchanged path shape), `LOG_DIR="./logs"` (unchanged shape, resolves under the scratch root), `STATE_DIR="./logs/state"` (unchanged shape, resolves under the scratch root). Leave every other tuning value (POLL_INTERVAL, patterns, etc.) as copied — they're irrelevant to the lock guard and this way nothing is missing under `set -u`.
- [ ] Confirm the scratch DB doesn't need a real schema for these tests: `load_agents`/`load_bg` (`scripts/lib/db.sh:44,71`) query `agents`/`bg_processes` via a `sqlite3` process substitution (`while read ... done < <(sql ...)`); if the scratch DB file is empty/missing those tables, the query fails but the substitution's own exit status isn't checked by `set -e` in this construct, so the loop arrays just come back empty — the script proceeds with zero agents rather than crashing. Confirmed safe for these tests, which only need the process to stay alive past the lock-acquire block at the top of the script.
- [ ] Confirm `bash -n ./tmp/uat-128-scratch/scripts/monitor.sh` passes (sanity check the copy is intact).
- [ ] Have two terminal panes/windows available (or use `run_in_background` + polling) since several cases need to observe one running instance while starting a second.

> **Two things discovered while attempting this harness under `/uat-auto-plus` on 2026-09-13 — read before running any case:**
> 1. **Always invoke the scratch script via `bash` resolved from `PATH`, never `/bin/bash` directly.** This repo's `monitor.sh` (since TASK-144) uses `declare -gA` at its top, which requires Bash ≥4.2. macOS ships `/bin/bash` at 3.2 (`declare: -g: invalid option`), matching the prerequisite already documented in root `CLAUDE.md` ("bash >= 4.0 ... macOS default is 3.2"). A Homebrew `bash` (`which bash` → `/opt/homebrew/bin/bash` or similar, ≥4.2) must be first on `PATH`. Confirmed: `bash scripts/monitor.sh` (PATH-resolved 5.3.9) starts cleanly past this point; `/bin/bash scripts/monitor.sh` does not.
> 2. **A scratch DB with zero agent rows is not sufficient — it triggers an unrelated, pre-existing auto-teardown within ~1s, before any lock scenario can be exercised.** `scripts/monitor.sh`'s main loop initializes `all_idle=true`/`all_usage_hit=true` and only flips them inside the per-agent loop body (`scripts/monitor.sh:~500-552`); with an empty `agents` table, that loop body never runs, so both flags stay at their vacuously-true defaults and `if $all_usage_hit && $all_idle` (`scripts/monitor.sh:583`) fires immediately, calling `teardown.sh` and exiting — a documented class of bug already flagged in a neighboring code comment about transiently-absent windows (`scripts/monitor.sh:~516-519`), not something introduced by TASK-128 and explicitly out of TASK-128's scope to fix (the guarded surface is `scripts/monitor.sh`'s main loop, reserved for TASK-120/TASK-121). **Before running any case below**, seed the scratch DB with at least one `agents` row that will never read as `idle` (e.g. a fake agent with no matching tmux window, so `is_idle` calls it `exited`/never-idle rather than idle) — or accept that each instance under test will self-terminate within ~1s and time every observation accordingly. This needs the real `agents` table schema (`host-server/db.ts:290`), which `scripts/lib/db.sh` alone does not create; the simplest path is running `host-server`'s own migration once against the scratch `DB_PATH` before starting `monitor.sh`, not hand-authoring `CREATE TABLE` statements.
> Consider filing the zero-agent auto-teardown behavior as its own bug if it also surprises a real (non-scratch) empty-fleet startup — out of scope for TASK-128/UAT-128 either way.

---

## Test Cases

### UAT-EDGE-001: A second instance refuses to start while a confirmed live monitor.sh holds the lock
- **Scenario**: The lock file exists, names a PID that is alive, and that PID's command line contains `monitor.sh` — the "confirmed live monitor.sh" branch (`scripts/monitor.sh:63-66`).
- **Steps**:
  1. `cd ./tmp/uat-128-scratch && bash scripts/monitor.sh > ./first-instance.out 2>&1 &` — capture its PID as `FIRST_PID`.
  2. Wait ~1s, then confirm `./tmp/uat-128-scratch/logs/state/monitor.pid` exists and contains `$FIRST_PID`.
  3. From the same scratch directory, run a second instance in the foreground: `bash scripts/monitor.sh`.
  4. Observe the second instance's output and exit code; confirm the first instance (`kill -0 $FIRST_PID`) is still alive and unaffected.
  5. Clean up: `kill $FIRST_PID` (or Ctrl-C its pane).
- **Expected Result**: The second instance logs a `FATAL: another monitor.sh instance appears to be running (PID $FIRST_PID, lock file .../monitor.pid). Confirm no other conductor is running against this STATE_DIR, then remove the lock file manually before restarting.` line and exits non-zero (`echo $?` → `1`) without ever reaching `load_agents`. The first instance's PID is unchanged and it keeps running after the second exits.
- **Repeatable Unit Test**: Not applicable: no bash test harness exists in this repo (matches the TASK-113/UAT-113 precedent); this task touched only `scripts/monitor.sh`.
- [FAIL: auto-fix-declined: no extractable single **Command**: field — this case is a multi-step OS process lifecycle (spawn a background instance, inspect its PID/lock file, start a second instance, compare exit codes) that /uat-auto-plus's live-command oracle cannot judge as one Bash invocation; a real attempt also surfaced that a zero-agent scratch DB self-terminates via an unrelated pre-existing auto-teardown before this scenario can even be reached (see Prerequisites note above) — fixing that would mean touching scripts/monitor.sh's main loop, out of TASK-128's scope. Requires /uat-walk.] <!-- 2026-09-13 -->

### UAT-EDGE-002: A stale lock (dead PID) is cleared automatically, not treated as a conflict
- **Scenario**: The lock file exists but names a PID that is no longer running — the stale-lock branch (`scripts/monitor.sh:78-80`).
- **Steps**:
  1. In `./tmp/uat-128-scratch/logs/state/`, write a lock file with a PID guaranteed to be dead: `echo 999999 > ./tmp/uat-128-scratch/logs/state/monitor.pid` (verify `kill -0 999999` fails on this machine first — pick another clearly-unused high PID if it doesn't).
  2. Run `cd ./tmp/uat-128-scratch && bash scripts/monitor.sh > ./stale-instance.out 2>&1 &` and capture its PID.
  3. Wait ~1s, then inspect the newest `./tmp/uat-128-scratch/logs/monitor-*.log`.
  4. Inspect `./tmp/uat-128-scratch/logs/state/monitor.pid` — confirm it now contains the *new* process's own PID, not `999999`.
  5. Clean up: kill the instance started in step 2.
- **Expected Result**: The log contains `NOTICE: stale lock found (PID 999999 not running), clearing` and the instance starts normally (no `FATAL`, no non-zero exit) — the lock file is overwritten with the new process's real PID.
- **Repeatable Unit Test**: Not applicable: no bash test harness exists in this repo.
- [FAIL: auto-fix-declined: no extractable single **Command**: field — same multi-step-process-lifecycle limitation as UAT-EDGE-001; also blocked by the zero-agent auto-teardown noted in Prerequisites. Requires /uat-walk.] <!-- 2026-09-13 -->

### UAT-EDGE-003: A lock file naming a live but non-monitor.sh PID (recycled PID) is overridden, not treated as a conflict
- **Scenario**: The lock file's PID is alive, but its command line does not contain `monitor.sh` — the "recycled PID" branch (`scripts/monitor.sh:67-69`).
- **Steps**:
  1. Start a long-lived, easily identifiable placeholder process: `sleep 300 & OTHER_PID=$!`.
  2. `echo $OTHER_PID > ./tmp/uat-128-scratch/logs/state/monitor.pid`.
  3. Run `cd ./tmp/uat-128-scratch && bash scripts/monitor.sh > ./recycled-instance.out 2>&1 &` and capture its own PID.
  4. Wait ~1s, inspect the newest `./tmp/uat-128-scratch/logs/monitor-*.log`.
  5. Inspect the lock file again — confirm it now contains the new monitor.sh instance's own PID, not `$OTHER_PID`.
  6. Clean up: `kill $OTHER_PID`; kill the monitor.sh instance started in step 3.
- **Expected Result**: The log contains a line like `WARNING: lock file .../monitor.pid names live PID $OTHER_PID, but its command ('sleep 300') does not look like monitor.sh (recycled PID) - overriding stale lock and proceeding.` and the instance starts normally (no refusal, no non-zero exit).
- **Repeatable Unit Test**: Not applicable: no bash test harness exists in this repo.
- [FAIL: auto-fix-declined: no extractable single **Command**: field — same multi-step-process-lifecycle limitation as UAT-EDGE-001; also blocked by the zero-agent auto-teardown noted in Prerequisites. Requires /uat-walk.] <!-- 2026-09-13 -->

### UAT-EDGE-004: An inconclusive identity check (ps failure) fails open toward starting, never toward refusing
- **Scenario**: `ps -p "$PID" -o command=` returns nothing/fails even though the PID is alive — the fail-open branch (`scripts/monitor.sh:71-77`). This is the load-bearing safety property of the whole task: this branch must never be reachable via a normal `ps` failure turning into a boot-blocker.
- **Steps**:
  1. Build a stub `ps` that always fails, to force the inconclusive path deterministically (real `ps` almost never fails, so this must be simulated): `printf '#!/usr/bin/env bash\nexit 1\n' > ./tmp/uat-128-scratch/bin/ps && chmod +x ./tmp/uat-128-scratch/bin/ps`.
  2. Start a live placeholder process and point the lock file at it, same as UAT-EDGE-003 steps 1-2 (`sleep 300 & OTHER_PID=$!`; `echo $OTHER_PID > .../monitor.pid`).
  3. Run monitor.sh with the stub `ps` shadowing the real one: `cd ./tmp/uat-128-scratch && PATH="./bin:$PATH" bash scripts/monitor.sh > ./failopen-instance.out 2>&1 &`.
  4. Wait ~1s, inspect the newest `./tmp/uat-128-scratch/logs/monitor-*.log`.
  5. Clean up: `kill $OTHER_PID`; kill the instance started in step 3; `rm ./tmp/uat-128-scratch/bin/ps`.
- **Expected Result**: The log contains `WARNING: lock file .../monitor.pid names live PID $OTHER_PID, but its identity could not be verified (ps failed or returned nothing) - proceeding (fail-open).` and the instance starts normally — it must NOT refuse to start on an inconclusive check.
- **Repeatable Unit Test**: Not applicable: no bash test harness exists in this repo.
- [FAIL: auto-fix-declined: no extractable single **Command**: field — same multi-step-process-lifecycle limitation as UAT-EDGE-001 (this one also relies on a stub `ps` on `PATH`, further from a single-command oracle); also blocked by the zero-agent auto-teardown noted in Prerequisites. Requires /uat-walk.] <!-- 2026-09-13 -->

### UAT-EDGE-005: A clean shutdown removes the lock file, leaving no stale-lock warning on the next start
- **Scenario**: The `trap 'rm -f "$LOCK_FILE"' EXIT` (`scripts/monitor.sh:83`) fires on a normal exit.
- **Steps**:
  1. Run `cd ./tmp/uat-128-scratch && bash scripts/monitor.sh > ./clean-instance.out 2>&1 &` and capture its PID.
  2. Wait ~1s, confirm `./tmp/uat-128-scratch/logs/state/monitor.pid` exists.
  3. Send a clean shutdown signal: `kill -TERM $PID` (or `kill -INT $PID` to emulate Ctrl-C) and wait for the process to exit (`wait $PID` or poll `kill -0 $PID`).
  4. Confirm `./tmp/uat-128-scratch/logs/state/monitor.pid` no longer exists.
  5. Start a fresh instance and confirm its log has **no** `NOTICE: stale lock` or `WARNING:` line at all — a clean prior exit must leave nothing behind to warn about.
  6. Clean up: kill the instance started in step 5.
- **Expected Result**: Lock file is removed after the clean exit in step 3; the fresh start in step 5 is silent on the lock front (starts exactly as it would on a first-ever run).
- **Repeatable Unit Test**: Not applicable: no bash test harness exists in this repo.
- [FAIL: auto-fix-declined: no extractable single **Command**: field — same multi-step-process-lifecycle limitation as UAT-EDGE-001; also blocked by the zero-agent auto-teardown noted in Prerequisites. Requires /uat-walk.] <!-- 2026-09-13 -->

### UAT-EDGE-006: Two separate STATE_DIRs never contend with each other's locks
- **Scenario**: Two independent conductor setups (different `conductor.conf` → different `STATE_DIR`) on the same machine must not block each other, since the lock is keyed on `STATE_DIR`, not global.
- **Steps**:
  1. Duplicate the scratch harness into a second, sibling scratch root: `cp -r ./tmp/uat-128-scratch ./tmp/uat-128-scratch-2`.
  2. In `./tmp/uat-128-scratch-2/conductor.conf`, change `SESSION_NAME` to `uat-128-scratch-2` and `STATE_DIR`/`LOG_DIR`/`DB_PATH` remain the same relative shape (they'll resolve under the second scratch root, so they're already distinct absolute paths from the first harness — confirm this by checking `readlink -f`/`cd` resolution before running).
  3. Start an instance from `./tmp/uat-128-scratch` (harness 1) and leave it running.
  4. Start an instance from `./tmp/uat-128-scratch-2` (harness 2) while harness 1's instance is still running.
  5. Confirm both instances stay running simultaneously with no `FATAL`/refusal in either log, and each has its own `monitor.pid` file under its own `STATE_DIR` naming its own PID.
  6. Clean up: kill both instances; `rm -rf ./tmp/uat-128-scratch-2`.
- **Expected Result**: Neither instance refuses to start or logs anything about the other — the two lock files are entirely independent, confirming the `STATE_DIR`-keyed (not global) lock design.
- **Repeatable Unit Test**: Not applicable: no bash test harness exists in this repo.
- [FAIL: auto-fix-declined: no extractable single **Command**: field — same multi-step-process-lifecycle limitation as UAT-EDGE-001, compounded here by needing two independent scratch harnesses running concurrently; also blocked by the zero-agent auto-teardown noted in Prerequisites. Requires /uat-walk.] <!-- 2026-09-13 -->

---

## Cleanup

- [ ] `rm -rf ./tmp/uat-128-scratch ./tmp/uat-128-scratch-2` once all cases are recorded — this repo's convention is `./tmp/` scratch, never left behind after a UAT pass.
- [ ] Confirm the real conductor (`./conductor.conf`, `SESSION_NAME=conductor`, the live tmux `conductor` session) was never touched by any step above — no real agent's pane should show any activity caused by this UAT.
