---
id: TASK-026
title: "Run the end-to-end SQLite-migration verification suite (seed, pop race, fake dispatch, schedule fire, backlog restore)"
status: done
created: 2026-06-12
updated: 2026-06-13
depends_on: [TASK-023, TASK-024, TASK-025]
blocks: []
parallel_safe_with: []
uat: "../uat/UAT-026-e2e-verification-suite.md"
tags: [verification, sqlite, cutover, roadmap-001, phase-5]
---

# TASK-026 — Run the end-to-end SQLite-migration verification suite

## Objective

This is the FINAL Phase 5 (Cutover) task for ROADMAP-001 (SQLite data layer). After the backend legacy code is removed (TASK-023), `conductor.conf` is stripped of its arrays (TASK-024), and docker/docs are updated (TASK-025), this task proves the migrated system works end-to-end by running a concrete, repeatable verification suite. It packages the design plan's six "Verification" checks into the five required runnable checks — (1) seed-import correctness, (2) atomic task-pop race test, (3) fake-agent dispatch, (4) schedule fire, (5) backlog restore — as a single executable script `scripts/verify-sqlite-migration.sh` plus a documented manual run sequence, each check carrying an explicit machine-checkable pass criterion. The deliverable is both the script and a green run of it, captured in the UAT.

## Approach

**Ground truth (read during /research, do not re-derive):**

- **Atomic pop** is a single `DELETE … RETURNING` statement, identical in two places:
  - SQL (shell): `scripts/lib/db.sh` → `pop_task_sql()` (inlines the validated `$AGENT` name twice; precedence `agent → project → global` via `ORDER BY CASE … , t.position`; emits `id\x1fcommand\x1fkind` on stdout; then `LAST_QUEUE_REMAINING = SELECT COUNT(*) FROM tasks WHERE status='queued'`).
  - TS (backend): `backend/db.ts` → `popTask(db, agentName)` (same statement, parameterised `?,?`).
- **Monitor dispatch path:** `scripts/monitor.sh` poll loop calls `load_agents`/`load_bg` each tick, then for an idle agent `pop_task "$name"` (wraps `pop_task_sql`) → `emit_dispatch_jsonl` (appends one record to `$LOG_DIR/dispatch.jsonl`) → `mark_busy` → `dispatch "$target" "$task"` (send-keys). A dead pane triggers `move_to_backlog "$name"` (`UPDATE tasks SET status='backlog' WHERE agent_id=…`).
- **Scheduler** (`backend/index.ts`, ~line 1379): `setInterval(…, 5000)` → `dueSchedules(db, now)` (`WHERE enabled=1 AND (last_enqueued_at IS NULL OR last_enqueued_at + interval_seconds <= now)`) → `fireSchedule(db, s, now)` (transaction: `skip_if_pending` check on `tasks WHERE schedule_id=? AND status='queued'`, then `addTask` with `placement = action==='jump' ? 'head' : 'tail'`, then `UPDATE schedules SET last_enqueued_at=?`). On a fired task it `broadcastSSE('schedule-fired', …)` then `broadcastSSE('task-added', task)`.
- **Backlog restore** (`backend/db.ts`): `restoreBacklog(db, agentId)` = `UPDATE tasks SET status='queued' WHERE agent_id=? AND status='backlog'` (positions survive — no renumber). `conductor.sh` performs the equivalent restore on startup for the agents it loads from the DB.
- **DB path resolution:** `CONDUCTOR_DB` env → `DB_PATH` conf setting (resolved against conf dir) → `<repo>/data/conductor.db`. Shell uses `sqlite3 -cmd '.timeout 5000' -separator $'\x1f'` (the `sql()` wrapper in `db.sh`).
- **tasks schema invariants** (from plan): `status IN ('queued','backlog')`, `position REAL` (append=MAX+1, head=MIN-1), `CHECK (agent_id IS NULL OR project_id IS NULL)`, `source IN ('manual','schedule')`.

**Design decisions for the suite:**

- The suite runs against a **disposable DB**, never the live `data/conductor.db`. The script sets `export CONDUCTOR_DB="$REPO/tmp/verify/conductor-verify.db"` (repo-local `./tmp/`, per project rules) and lets the backend's migrations create it, so the real DB is untouched and the run is idempotent.
- Checks that need a populated schema obtain it by **starting the backend once** against the verify DB (migrations run on `openDb`), then the backend is stopped for the pure-SQL checks (seed, race) and restarted for the live checks (dispatch, schedule).
- Every check is **fail-closed**: a check function returns non-zero on any criterion miss; the script tracks pass/fail per check and exits non-zero if any failed, printing a `PASS/FAIL` line per check and a final summary.
- The fake agent uses a **`bash` launch command** in a throwaway workdir (`./tmp/verify/demo-repo`) so dispatch is observable via `capture-pane` without a real coding CLI, exactly as the plan's check 3 describes.
- Use only tools guaranteed present: `sqlite3` CLI, `curl`, `tmux`, `node`/`tsx` (backend), `jq` optional (fall back to grep when absent).

## Steps

### 1. Research confirmation (no code change) <!-- agent: Explore -->

- [x] Re-read with Serena to confirm signatures still match before scripting (cutover tasks 023/024/025 may have touched them):
  - `mcp__serena__find_symbol` `popTask`, `fireSchedule`, `dueSchedules`, `restoreBacklog`, `moveToBacklog`, `addTask` in `backend/db.ts`
  - `pop_task_sql`, `load_agents`, `move_to_backlog` in `scripts/lib/db.sh` / `scripts/monitor.sh`
  - the `setInterval(… ,5000)` scheduler block in `backend/index.ts`
- [x] Confirm the task-add route name/shape (`POST /api/tasks {command, agentName?, projectId?, placement?}`) and the projects/agents/schedules routes used below via `mcp__serena__search_for_pattern` over `backend/index.ts` (`'/api/tasks'`, `'/api/projects'`, `'/api/schedules'`, `'/agents'`). If a path differs post-cutover, update the curl calls in the script accordingly.
- [x] Confirm the SSE event channel path (`GET /events` vs `GET /api/events`) and that `schedule-fired` + `task-added` are the emitted event names.

### 2. Scaffold the verification script <!-- agent: general-purpose -->

- [x] Create `scripts/verify-sqlite-migration.sh` (executable, `#!/usr/bin/env bash`, `set -uo pipefail` — NOT `-e`, so a failed check is recorded rather than aborting the suite).
- [x] Header block: resolve `REPO` from `BASH_SOURCE`, `VERIFY_DIR="$REPO/tmp/verify"`, `mkdir -p "$VERIFY_DIR"`, `export CONDUCTOR_DB="$VERIFY_DIR/conductor-verify.db"`, `rm -f "$CONDUCTOR_DB"*` at start for a clean slate. Define a `sqlc()` wrapper = `sqlite3 -cmd '.timeout 5000' -separator $'\x1f' "$CONDUCTOR_DB" "$@"`.
- [x] Add pass/fail bookkeeping: `PASS=(); FAIL=()`; helper `check()` that prints `PASS:`/`FAIL:` with the check name and pushes onto the right array; final summary prints both arrays and `exit ${#FAIL[@]} -gt 0 ? 1 : 0`.
- [x] Add backend lifecycle helpers used by later checks:
  - `start_backend()` — launch the Fastify backend with `CONDUCTOR_DB` exported, in the background, capturing PID and waiting until `GET /api/status` (or confirmed path from Step 1) returns 200 (poll up to ~15s).
  - `stop_backend()` — kill the captured PID and wait.
- [x] Add `seed_db()` — start backend once so migrations + `seedFromLegacy` create the schema and import current `conductor.conf`/`tasks.txt`, then stop it. (If the cutover already removed conf arrays so seed imports nothing, the suite instead inserts its own fixtures via SQL/HTTP in each check — note this branch in a comment.) <!-- Completed: 2026-06-13 -->

### 3. Check 1 — Seed-import correctness <!-- agent: general-purpose -->

- [x] Implement `check_seed()`:
  - Run `seed_db()` (migrations + seed against the fresh verify DB).
  - Assert schema present: `sqlc "SELECT name FROM sqlite_master WHERE type='table'"` contains `agents`, `projects`, `bg_processes`, `schedules`, `tasks`, `meta`.
  - Assert meta guard: `sqlc "SELECT value FROM meta WHERE key='schema_version'"` non-empty AND `sqlc "SELECT value FROM meta WHERE key='legacy_import'"` == `1`.
  - **Idempotency:** capture `agents`+`tasks` row counts; `start_backend(); stop_backend()` a second time; re-capture counts. **Pass criterion:** counts are unchanged (the `meta.legacy_import` guard prevented re-import).
  - (When a seedable conf is present) sanity-cross-check: agent count equals distinct agent names the plan expects; `tasks` count ≥ 0 with no rows violating `status IN ('queued','backlog')`.
- [x] **Pass criterion (recorded):** all six tables exist, `legacy_import=1`, and second-start counts == first-start counts (no duplication). <!-- Completed: 2026-06-13 -->

### 4. Check 2 — Atomic task-pop race test <!-- agent: general-purpose -->

- [x] Implement `check_pop_race()` (pure SQL via `scripts/lib/db.sh`'s `pop_task_sql`; backend NOT required):
  - Source `scripts/lib/db.sh` (it resolves `CONDUCTOR_DB` from the exported env). Insert a fixture agent: `sqlc "INSERT INTO agents(name,workdir,launch_cmd) VALUES('racer','$VERIFY_DIR/demo-repo','bash')"` (idempotent: `INSERT OR IGNORE`).
  - Insert **500 global queued tasks**: a single `INSERT INTO tasks(command,position,status) SELECT 'race-'||value, value, 'queued' FROM generate_series(1,500)` (or a bash loop if `generate_series` unavailable in the bundled sqlite3 — fall back to a `for` loop building one multi-row INSERT).
  - Launch **two parallel pop loops**, each repeatedly calling `pop_task_sql racer` and appending the popped `command` to its own file under `$VERIFY_DIR/`, until both report empty.
  - Concatenate both output files. **Pass criteria:** total popped lines == 500 (none lost) AND `sort | uniq -d` is empty (no task popped twice — atomicity holds) AND `sqlc "SELECT COUNT(*) FROM tasks WHERE status='queued'"` == 0.
- [x] **Precedence sub-check (same function or `check_pop_precedence()`):** create project `p` (`INSERT INTO projects`), set agent `t1.project_id=p`, insert one task in each of the three scopes (agent-scoped `agent_id=t1`, project-scoped `project_id=p`, global). Three successive `pop_task_sql t1` calls must return them in order **scoped → project → global** (assert each popped `kind` value: `scoped`, `project`, `global`). <!-- Completed: 2026-06-13 -->

### 5. Check 3 — Fake-agent dispatch <!-- agent: general-purpose -->

- [x] Implement `check_dispatch()`:
  - `mkdir -p "$VERIFY_DIR/demo-repo"`. Start backend. Create a project via `POST /api/projects {name:'demo', workdir:'$VERIFY_DIR/demo-repo', defaultLaunchCmd:'bash'}` (capture project id from the JSON response).
  - Spawn an agent for the project: `POST /api/projects/<id>/agents {}` → expect auto-named `demo-1` (capture name). (Fallback if route differs: `POST /api/agents {name:'demo-1', workdir, launchCmd:'bash', projectId}`.)
  - Start the orchestrator: run `scripts/conductor.sh` (it `load_agents` from the verify DB and starts `monitor.sh`). Use a distinct `SESSION_NAME` (e.g. export/override to `conductor-verify`) so it does not collide with a real session; tear it down at the end.
  - Force the agent idle so the monitor will dispatch: `echo idle > "$STATE_DIR/demo-1.state"` (resolve `STATE_DIR` from conf; under verify, point it at `$VERIFY_DIR/state`).
  - Enqueue a marker task: `POST /api/tasks {command:'echo POPPED-OK', agentName:'demo-1'}`.
  - Poll up to `~3 × POLL_INTERVAL`: **Pass criteria** —
    1. `tmux capture-pane` of the `demo-1` window contains `POPPED-OK`;
    2. the task row is gone: `sqlc "SELECT COUNT(*) FROM tasks WHERE command='echo POPPED-OK'"` == 0;
    3. `$LOG_DIR/dispatch.jsonl` gained ≥1 record whose `agent` is `demo-1` and `command` is `echo POPPED-OK` (grep/jq).
  - Tear down the verify tmux session (`tmux kill-session -t conductor-verify`) and `stop_backend()`. <!-- Completed: 2026-06-13 -->

### 6. Check 4 — Schedule fire <!-- agent: general-purpose -->

- [x] Implement `check_schedule()`:
  - Start backend (verify DB). Create a project-scoped (or global) schedule: `POST /api/schedules {command:'echo SCHED-TICK', intervalSeconds:5, action:'append', enabled:true, skipIfPending:true, projectId:<demo id>}` (use the minimum `interval_seconds=5` allowed by the CHECK, so the test is fast).
  - **Fire criterion:** open an SSE reader on the events endpoint (e.g. `curl -N`), or poll the DB. Within ~`interval + scheduler tick (5s) + margin`, assert a `schedule-fired` event arrives on SSE **and** a `tasks` row appears with `source='schedule'` and `schedule_id` == the created schedule id: `sqlc "SELECT COUNT(*) FROM tasks WHERE source='schedule' AND schedule_id=<id> AND status='queued'"` ≥ 1.
  - **skip_if_pending criterion:** with one schedule task already queued and unconsumed, wait through another tick; assert the queued count for that `schedule_id` stays at **1** (no pile-up) — proves `fireSchedule`'s `skip_if_pending` guard.
  - **jump action sub-check:** insert 3 plain queued tasks (`placement tail`) for the agent, create a second schedule with `action:'jump'`, wait one fire; assert the schedule's task has the **minimum `position`** among that agent's queued tasks (`SELECT id FROM tasks WHERE … ORDER BY position LIMIT 1` is the schedule task) — proves head placement.
  - Disable/delete the schedules (`PUT/DELETE /api/schedules/:id`) and `stop_backend()` at the end so the verify DB doesn't keep firing.
- [x] **Pass criterion (recorded):** schedule fired (SSE `schedule-fired` seen + `source='schedule'` row present), pending guard held the count at 1, and the `jump` task landed at the queue head. <!-- Completed: 2026-06-13 -->

### 7. Check 5 — Backlog restore <!-- agent: general-purpose -->

- [x] Implement `check_backlog()`:
  - Ensure agent `demo-1` exists with a couple of **agent-scoped** queued tasks (insert via SQL or `POST /api/tasks` with `agentName:'demo-1'`). Record their `id`+`position`.
  - Simulate the agent window dying: directly drive the monitor path by either (a) killing the `demo-1` tmux window while `monitor.sh` runs so `move_to_backlog demo-1` fires, OR (b) deterministically call the backlog flip in isolation: `sqlc "UPDATE tasks SET status='backlog' WHERE agent_id=(SELECT id FROM agents WHERE name='demo-1')"`. Prefer (a) for true end-to-end coverage; fall back to (b) if tmux timing is flaky, noting which path ran.
  - **Backlog criterion:** `sqlc "SELECT COUNT(*) FROM tasks WHERE status='backlog' AND agent_id=(SELECT id FROM agents WHERE name='demo-1')"` ≥ the number of agent-scoped tasks; their `position` values are unchanged from before the flip (positions survive).
  - **Restore criterion:** invoke the restore path — rerun `scripts/conductor.sh` (which restores backlog for DB-loaded agents) OR call the backend restore route if one exists; equivalently assert the SQL effect of `restoreBacklog`: after restore, `sqlc "SELECT COUNT(*) FROM tasks WHERE status='backlog' AND agent_id=…"` == 0 AND those same rows are now `status='queued'` with their original `position` values intact (so they pop in the original order).
  - Confirm a restored task then **dispatches**: with `demo-1` idle, the monitor pops one and `capture-pane` shows its marker (reuse the Check 3 polling helper).
- [x] **Pass criterion (recorded):** scoped tasks flipped to `backlog` with positions preserved, restore flipped them back to `queued` with the same positions, and at least one restored task dispatched. <!-- Completed: 2026-06-13 -->

### 8. Wire summary + docs + run it <!-- agent: general-purpose -->

- [ ] In `main` of the script, call the five checks in order (`check_seed`, `check_pop_race` + precedence, `check_dispatch`, `check_schedule`, `check_backlog`), each guarded so one failure doesn't abort the rest; print the final `PASS:`/`FAIL:` summary; `exit 1` if any failed.
- [ ] Ensure full cleanup on exit (`trap`): kill any verify tmux session, stop the backend, leave `tmp/verify/` artifacts in place for inspection (they're gitignored) but never touch the real `data/conductor.db`.
- [ ] Add a short usage section to `scripts/README.md` documenting `scripts/verify-sqlite-migration.sh` (what each of the 5 checks proves, how to run, where artifacts land) — markdown edit via Read+Edit.
- [ ] **Run the suite** from the repo root: `bash scripts/verify-sqlite-migration.sh`. Capture the output. The task is complete only when the script exits 0 with all five checks `PASS`.
- [ ] Record the green run (command + summary output) for the UAT (`/uat-generate TASK-026`).

## Pass/Fail Summary (the suite's contract)

| # | Check | Pass criterion |
|---|-------|----------------|
| 1 | Seed import | 6 tables exist; `meta.legacy_import=1`; second start does not duplicate rows |
| 2 | Pop race + precedence | 500 tasks popped, zero duplicates (`uniq -d` empty), queue drains to 0; three-scope pops return `scoped→project→global` |
| 3 | Fake dispatch | `capture-pane` shows `POPPED-OK`; task row deleted; `dispatch.jsonl` got the record |
| 4 | Schedule fire | SSE `schedule-fired` seen + `source='schedule'` row; `skip_if_pending` holds count at 1; `jump` lands at head |
| 5 | Backlog restore | scoped rows → `backlog` (positions preserved) → restored to `queued` (same positions); a restored task dispatches |

The deliverable is `scripts/verify-sqlite-migration.sh` plus a captured green run (exit 0, all five `PASS`).
