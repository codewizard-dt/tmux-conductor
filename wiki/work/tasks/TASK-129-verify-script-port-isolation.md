---
id: TASK-129
aliases: [TASK-129]
title: "Port isolation for scripts/verify-sqlite-migration.sh — stop the readiness probe from false-positiving against a live dev host-server"
status: todo
created: 2026-08-15
updated: 2026-08-15
depends_on: []
blocks: []
parallel_safe_with: []
uat: ""
tags: [scripts, verification, safety, host-server]
---

# TASK-129 — Port isolation for scripts/verify-sqlite-migration.sh — stop the readiness probe from false-positiving against a live dev host-server

## Objective

`scripts/verify-sqlite-migration.sh` exists to safely verify SQLite migration/pop/dispatch/schedule/backlog behavior against a scratch DB, explicitly documented as never touching the real `./data/conductor.db`. It currently cannot run safely on a normal developer machine, because it hardcodes `http://localhost:8788` in 16 places with no port override, and its readiness probe cannot tell its own spawned process apart from an unrelated server already listening on that port. On any machine with `make dev` running (the normal state during active development), this script will silently write to the live `./data/conductor.db` while believing it's using its own scratch DB — the opposite of what the script exists to guarantee.

## Background — how this was found

Discovered 2026-08-15 while fixing an unrelated, smaller bug in the same script: `start_backend()` still `cd`'d into a stale `backend/` directory left over from the 2026-06-22 architecture revert that moved everything to `host-server/` (`backend/` today holds only a stray `node_modules/`). That path fix (`cd "$REPO/backend"` → `cd "$REPO/host-server"`) has **already landed** — do not redo it; the fix is a one-liner at `start_backend()`'s `cd` line and was verified by static cross-check against `host-server/package.json`'s own `"start"` script (`node --import tsx/esm index.ts`, the exact invocation the verify script runs) and confirmed with `bash -n`.

Attempting to actually *run* the freshly-patched script surfaced this separate, more serious defect: port 8788 was already bound by the live dev host-server (the same one driving this whole session). This is exactly why TASK-125's own Step 5 could only reason through `verify-sqlite-migration.sh`'s `check_pop_race`/`check_backlog` checks by re-reading source, rather than executing them — the script was unrunnable both because of the stale path (now fixed) and because of this port hazard (not yet fixed).

### The concrete failure mode (why this is a real bug, not a hypothetical)

1. Developer has `make dev` running — `host-server/index.ts` is live on `127.0.0.1:8788`, backed by the real `./data/conductor.db`.
2. Developer (or an agent) runs `bash scripts/verify-sqlite-migration.sh`.
3. `start_backend()` spawns its own `node --import tsx/esm index.ts` with `CONDUCTOR_DB` pointed at the scratch path (`$VERIFY_DIR/conductor-verify.db`). This spawn **fails to bind** port 8788 (`EADDRINUSE`) — the process never actually starts against the scratch DB.
4. `start_backend()`'s readiness loop only checks `curl -sf http://localhost:8788/api/status` — which returns `200` immediately, because the **already-running live server** answers on that port. The loop declares success and records a `BACKEND_PID` for a process that already exited.
5. Every subsequent curl call in the script (`check_dispatch`'s task enqueue, `check_schedule`'s schedule/agent creation, `check_backlog`'s agent setup) hits `http://localhost:8788/...` — routed to the **live server**, which is backed by the **real `./data/conductor.db`**, not the scratch DB the script's own logging and cleanup code believes it's using.
6. The script proceeds to insert/update/delete real rows in the developer's live database, under a script whose entire stated purpose (see its own header comment: "Real data/conductor.db is NEVER touched") is to guarantee exactly the opposite.

This is strictly worse than the stale-path bug it was found alongside: the stale path failed loudly (script errors out, `cd` target doesn't exist). This fails silently and reports success while writing to production data.

## Approach

Two changes, both scoped to `scripts/verify-sqlite-migration.sh` only. `host-server/index.ts` already honors `BACKEND_PORT`/`PORT` env vars (confirmed at `host-server/index.ts` — `const port = parseInt(process.env['PORT'] || process.env['BACKEND_PORT'] || '8788', 10);`) — the server side needs **no** changes; this is purely the verify script catching up to a capability the server already has.

1. **Parameterize the port.** Add a script-level variable (e.g. `VERIFY_PORT="${VERIFY_PORT:-18788}"` — a high scratch default chosen specifically so it can never collide with the default dev port 8788) near the top of the script alongside the existing `VERIFY_DIR`/`CONDUCTOR_DB` setup. Replace all 16 hardcoded `http://localhost:8788` occurrences (`start_backend`'s readiness curl; `check_dispatch`'s task-enqueue curl; `check_schedule`'s project/schedule POST and DELETE calls, including the duplicate DELETE-on-every-failure-branch calls; `check_backlog`'s project/agent POST calls) with `http://localhost:$VERIFY_PORT`. Pass `BACKEND_PORT="$VERIFY_PORT"` alongside the existing `CONDUCTOR_DB="$CONDUCTOR_DB"` env-var prefix when `start_backend()` spawns `node --import tsx/esm index.ts`.

2. **Fix the readiness probe itself — this is the actual bug, not just a convenience.** `curl -sf .../api/status` returning `200` proves *a* server is listening on that port; it does not prove the script's own spawned process is the one answering. Even with the port parameterized to a high scratch value, the probe should not trust an HTTP 200 alone — a second script (or a stray process from a previous crashed run) could still be squatting on the scratch port. Update `start_backend()`'s readiness loop to also confirm the child process is actually alive and is the one serving the request:
   - After spawning, capture `BACKEND_PID=$!` as today, but add an explicit `kill -0 "$BACKEND_PID"` check inside the readiness loop — if the process has already died (e.g. failed to bind, crashed on startup), fail fast with a clear "spawned process exited before becoming ready" error instead of continuing to poll a port that might be answered by something else.
   - Additionally verify the port is actually held by the spawned PID before declaring readiness — e.g. `lsof -nP -iTCP:$VERIFY_PORT -sTCP:LISTEN -t` and cross-check the returned PID(s) include `$BACKEND_PID` (or a descendant, since `node --import tsx/esm` may exec through an intermediate process — verify the actual PID chain empirically rather than assuming a 1:1 match). If the listening PID doesn't trace back to `$BACKEND_PID`, treat it as "port occupied by an unrelated process" and fail loudly rather than proceeding.
   - The combination (own scratch port + liveness-and-identity-checked readiness, not just an HTTP 200) closes both the "wrong port" and "right port, wrong process" versions of this hazard.

3. Leave `CONDUCTOR_DB`'s existing scratch-path handling untouched — that part of the script was already correct; only the port/readiness layer was unsafe.

## Steps

### 1. Parameterize the port across scripts/verify-sqlite-migration.sh  <!-- agent: general-purpose -->

- [ ] Add `VERIFY_PORT="${VERIFY_PORT:-18788}"` near the top of `scripts/verify-sqlite-migration.sh`, alongside the existing `VERIFY_DIR`/`CONDUCTOR_DB` setup (after `export CONDUCTOR_DB=...`, before `sqlc()`)
  - Note: use `${VERIFY_PORT:-18788}` (env-overridable with a scratch default), not a bare hardcoded `18788`, so a CI runner or a second concurrent verify run can still override it
- [ ] Replace all 16 hardcoded `http://localhost:8788` occurrences with `http://localhost:$VERIFY_PORT` — confirm the exact set via `mcp__serena__search_for_pattern(substring_pattern="8788", relative_path="scripts/verify-sqlite-migration.sh")` before editing, since line numbers will have shifted since this task was written; this must cover `start_backend()`'s readiness curl, `check_dispatch()`'s task-enqueue curl, `check_schedule()`'s project/schedule POST + every DELETE cleanup branch, and `check_backlog()`'s project/agent POST calls
- [ ] In `start_backend()`, add `BACKEND_PORT="$VERIFY_PORT"` to the env-var prefix on the `node --import tsx/esm index.ts` spawn line, alongside the existing `CONDUCTOR_DB="$CONDUCTOR_DB"`
- [ ] `bash -n scripts/verify-sqlite-migration.sh` after editing — must stay clean

### 2. Harden the readiness probe to verify process identity, not just port response  <!-- agent: general-purpose -->

- [ ] In `start_backend()`'s readiness loop, add a `kill -0 "$BACKEND_PID" 2>/dev/null` check each iteration — if the spawned process has already exited, break out of the loop immediately with a clear error ("spawned backend process exited before becoming ready — check $VERIFY_DIR/backend.log") rather than continuing to poll
- [ ] Before declaring readiness (on the `curl -sf` success branch), cross-check that the process actually listening on `$VERIFY_PORT` traces back to `$BACKEND_PID` — e.g. via `lsof -nP -iTCP:$VERIFY_PORT -sTCP:LISTEN -t`, comparing the returned PID(s) against `$BACKEND_PID` (empirically verify whether `node --import tsx/esm` execs in-place or forks a child before trusting a direct PID match — adjust the comparison accordingly, e.g. checking the parent PID chain if it's not a direct match)
  - If the listening PID doesn't trace back to `$BACKEND_PID`, treat it as "port occupied by an unrelated process," fail the readiness check loudly, and do not proceed to run any of the check_* functions
- [ ] `bash -n scripts/verify-sqlite-migration.sh` after editing — must stay clean

### 3. Verify end-to-end against a scratch port, without touching the live dev server  <!-- agent: general-purpose -->

- [ ] Confirm the live dev host-server (if running) is still bound to its normal port 8788 and untouched throughout this step — do not stop it
- [ ] Run `bash scripts/verify-sqlite-migration.sh` end-to-end with the new default `VERIFY_PORT=18788` (which will not collide with a dev server on 8788) and confirm it completes with all its `check_*` functions reporting PASS
- [ ] Confirm via `lsof -nP -iTCP:8788` (or equivalent) that the live dev server's connection count/PID on port 8788 is unaffected by the run
- [ ] Confirm `./data/conductor.db`'s row counts (e.g. `sqlite3 ./data/conductor.db "SELECT COUNT(*) FROM tasks"` compared before/after) are unchanged by the run — this is the actual acceptance bar for this task, not just "the script exits 0"
- [ ] `[DEFERRED-TO-UAT]` if a live run cannot be completed safely during `/tackle` static-gate scope — this task's whole purpose is runtime verification, so this step is expected to require UAT-phase (or explicitly authorized) execution rather than being provable by static analysis alone

## Notes

No roadmap link — this is verification-script infrastructure, same precedent as TASK-127 (vitest harness) and TASK-128 (monitor.sh lockfile guard), neither of which is tracked on an active roadmap.
