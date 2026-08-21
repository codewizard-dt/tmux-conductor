---
id: TASK-128
aliases: [TASK-128]
title: "monitor.sh single-instance startup guard — PID lockfile keyed on STATE_DIR"
status: todo
created: 2026-08-15
updated: 2026-08-15
depends_on: []
blocks: []
parallel_safe_with: []
uat: ""
tags: [monitor, dispatch, hardening, infrastructure]
---

# TASK-128 — monitor.sh single-instance startup guard — PID lockfile keyed on STATE_DIR

## Objective

Prevent two concurrent `scripts/monitor.sh` instances from ever running against the same `STATE_DIR`/`DB_PATH`. Today nothing stops this — no lockfile, no pidfile, no single-instance guard of any kind exists in `monitor.sh` (confirmed by search: the only related state, `PAUSED_FILE`, is a manual-stop signal, unconditionally removed on every startup, not a concurrency guard). This was discovered live: two `monitor.sh` processes were observed running simultaneously today (PID 12033, started 07:31, still the live/active one; PID 33557, started ~14:01, gone by the time it was investigated with **no log file ever created for it** — no forensic trail for why it died, just that it did, early and silently). Both processes would have sourced the identical `conductor.conf` (fixed relative path, no per-instance override), so they were not two isolated setups — they were two loops fighting over the same tmux session, SQLite DB, and state directory.

**Why this matters concretely — the corruption mechanism, not just "duplicate work":** the SQL task-pop (`pop_task_sql`, `scripts/lib/db.sh:87-135`) is a single atomic `UPDATE ... WHERE id = (SELECT ... LIMIT 1) RETURNING ...` — SQLite serializes concurrent writers, so two instances can never both claim the same task row. That part is already safe. The real, unmitigated risk is in `scripts/dispatch.sh`:

```bash
tmux send-keys -t "$TARGET" -l "$CMD"
sleep 0.3  # let the UI render before submitting
tmux send-keys -t "$TARGET" Enter
```

That 300ms gap between typing a command's literal text and pressing Enter has no locking around the target pane. If an agent has two genuinely separate queued tasks, two concurrent `monitor.sh` instances can each atomically pop a *different* task row (no SQL race there) and then both call `dispatch()` against the *same* tmux pane in close succession. If the timing overlaps, one process's literal-mode keystrokes can land in the pane during the other's 300ms gap before Enter fires — producing a garbled, merged command string that the live agent actually receives and tries to execute. This is not "duplicate dispatch of one task" (which the SQL layer already prevents) — it's two different tasks' keystrokes interleaved into one corrupted command, a failure mode that would present as inexplicable one-off agent misbehavior rather than an obvious bug, with no log line pointing at the cause.

No evidence this fired today — both live agents (`bootstrap-1`, `general`) had empty queues throughout the observation window, so neither process had anything to race over. The risk is structural and currently unmitigated, not confirmed-exploited.

## Approach

**Lock file location — keyed on `STATE_DIR`, not a single global lock.** Place the lock at `"$STATE_DIR/monitor.pid"`. `STATE_DIR` is already resolved per-`conductor.conf` (absolute path, `conductor.conf`-relative by default), so two genuinely separate conductor setups on the same machine (different `conductor.conf` → different `STATE_DIR`) automatically get separate lock files with zero extra bookkeeping — satisfying the requirement that unrelated setups must not block each other. Do **not** use a fixed path like `/tmp/monitor.pid` or a path outside `STATE_DIR`.

**Startup sequence** (insert after `mkdir -p "$STATE_DIR"`, before `load_agents`/`load_bg`, in `scripts/monitor.sh`'s top-level startup section — re-read the file fresh immediately before editing; line numbers here are from investigation-time and may have shifted):

1. `LOCK_FILE="$STATE_DIR/monitor.pid"`.
2. If `$LOCK_FILE` exists, read the PID it contains.
3. **Liveness check**: `kill -0 "$PID" 2>/dev/null` — if the process doesn't exist, the lock is stale (unclean prior exit). Log a one-line notice ("stale lock found (PID $PID not running), clearing"), overwrite the lock file with the current process's PID, and proceed normally.
4. **Identity check — only when the PID is alive.** A recycled PID belonging to some unrelated process must never block startup. Verify the live process is actually a `monitor.sh` invocation before refusing to start: check its command line for `monitor.sh` (e.g. `ps -p "$PID" -o command=` on both macOS/BSD and Linux/GNU — verify the exact flag is portable across both at implementation time; this repo already handles BSD/GNU `ps`/`stat` differences elsewhere, e.g. `scripts/monitor.sh`'s existing `stat -f %m ... || stat -c %Y ...` pattern — follow that precedent). Match on a substring, not an exact string, so it's tolerant of `bash scripts/monitor.sh`, `./scripts/monitor.sh`, or an absolute path invocation.
   - **Confirmed live monitor.sh process** → refuse to start. Print a clear, actionable error naming the PID, the lock file path, and that the operator should confirm no other conductor is running before removing the lock file manually. Exit non-zero.
   - **Live process but does NOT look like monitor.sh (recycled PID)** → log a warning naming the PID and what the mismatch was, overwrite the lock file with the current process's own PID, and proceed. Do not block startup on this ambiguous case.
   - **`ps` itself fails, returns nothing, or the identity check is otherwise inconclusive** → **fail open toward allowing startup**, with a logged warning. Refuse to start *only* on a confident, positively-verified conflict (PID alive AND positively identified as monitor.sh). This is the load-bearing safety property of this whole task: an uncertain guard must never become "my conductor won't boot" — that failure mode is worse, day-to-day, than the rare corruption risk this guard exists to prevent. (Mirror of the `/bin/true`-doesn't-exist-on-macOS near-miss from the `USAGE_CHECK_CMD` fix earlier this session: verify the guard's own exit-code behavior in every branch before trusting it, don't assume the "obvious" implementation does what it looks like it does.)
5. If no lock file exists, or after clearing a stale/mismatched one: write the current process's PID (`$$`) to `$LOCK_FILE`.
6. Register a cleanup trap so a clean exit removes the lock file: `trap 'rm -f "$LOCK_FILE"' EXIT` (or fold into any existing `trap` in `monitor.sh` if one is found at implementation time — check first, do not blindly overwrite an existing trap). This must cover the normal shutdown paths (Ctrl-C, `teardown.sh`-driven exit, the fleet-wide auto-teardown branch at the end of the main loop) so an ordinary stop-and-restart never trips the stale-lock warning.

**Explicitly out of scope for this task**: do not touch `scripts/monitor.sh`'s dispatch loop, `is_idle`, `check_usage`, or anything in the `for name in "${AGENT_NAMES[@]}"` body (`~394-478`) — that surface belongs to TASK-120/TASK-121, which are deliberately deferred pending their own verification work. This task's edit region (script startup, before the main loop) is physically separate from TASK-120/121's edit region (inside the main loop), but it is the same file — re-read fresh immediately before editing regardless, and do not implement this task and TASK-120/121 in the same working session without re-syncing between them.

## Steps

### 1. Implement the lockfile guard  <!-- agent: general-purpose -->

- [ ] In `scripts/monitor.sh`, add `LOCK_FILE="$STATE_DIR/monitor.pid"` and the check/acquire sequence described in Approach, inserted after the existing `mkdir -p "$STATE_DIR"` line and before `load_agents`/`load_bg`. Re-read the file fresh first — this is a hot file with concurrent sibling edits, and the task's line-number citations may already be stale by the time this is picked up.
- [ ] Implement the three-way branch exactly as specified: confirmed-live-monitor.sh → refuse + exit non-zero; live-but-not-monitor.sh → warn + override + proceed; stale (dead PID) → notice + clear + proceed; `ps` inconclusive → fail open + warn + proceed. Do not collapse any of these branches — the fail-open branch is the one that prevents this guard from becoming a boot-blocking landmine.
- [ ] Add the `trap ... EXIT` (or extend an existing trap) to remove `$LOCK_FILE` on clean exit. Search `scripts/monitor.sh` for any pre-existing `trap` registration first.
- [ ] `bash -n scripts/monitor.sh` — clean syntax check.

### 2. Manual verification (no bash test harness exists in this repo — same constraint as TASK-113/UAT-113)  <!-- agent: general-purpose -->

- [ ] Start `monitor.sh` normally, then attempt to start a second instance against the same `STATE_DIR` — confirm the second refuses with a clear, actionable message and the first instance is unaffected and keeps running.
- [ ] Kill the first instance uncleanly (`kill -9`, bypassing the exit trap) to leave a stale lock file behind, then start `monitor.sh` again — confirm it starts cleanly with a "stale lock cleared" log line, not a refusal.
- [ ] Manually write a lock file containing a PID that is alive but is *not* a `monitor.sh` process (e.g. the current shell's own PID) — confirm `monitor.sh` recognizes the mismatch, logs a warning, and starts anyway (does not refuse).
- [ ] Start and then cleanly stop `monitor.sh` (Ctrl-C, or the normal `teardown.sh` path) — confirm the lock file is removed and a subsequent normal start shows no stale-lock warning at all.
- [ ] Record the observed output of all four scenarios in this task file (append under this step) as the evidence a future `/uat-generate` pass can build cases from.

## Acceptance Criteria

- [ ] A second `monitor.sh` instance started against an already-running instance's `STATE_DIR` refuses to start with a clear message; the first instance is unaffected.
- [ ] A stale lock (dead PID) never blocks startup — `monitor.sh` clears it and proceeds, with a log line explaining why.
- [ ] A lock file whose PID is alive but is not a `monitor.sh` process never blocks startup — treated as a mismatch, overridden, logged.
- [ ] Any ambiguity in the liveness/identity check (e.g. `ps` failing) fails open toward starting, never toward refusing — this guard must never become the reason a legitimate `monitor.sh` fails to boot.
- [ ] A clean shutdown (Ctrl-C, `teardown.sh`, or the fleet-wide auto-teardown branch) removes the lock file, leaving no stale-lock warning on the next normal start.
- [ ] Two separate conductor setups (different `conductor.conf` → different `STATE_DIR`) on the same machine are unaffected by each other's locks.
- [ ] `bash -n scripts/monitor.sh` passes cleanly.
- [ ] No change to `scripts/monitor.sh`'s dispatch loop, `is_idle`, `check_usage`, or any code inside the main `for name in "${AGENT_NAMES[@]}"` body — that surface is reserved for TASK-120/TASK-121.

## Notes

No roadmap link — this is infrastructure/hardening discovered during ad-hoc investigation (dual-monitor-process incident), not a scoped roadmap deliverable, matching the precedent set by TASK-127 (frontend test harness, also filed with no roadmap link).
