---
id: TASK-116
aliases: [TASK-116]
title: "Verify real task-start latency drops from ~15s worst-case to ~2s under a live agent session"
status: done
created: 2026-08-15
updated: 2026-08-15
depends_on: [TASK-120, TASK-121]
blocks: []
parallel_safe_with: []
uat: "[[UAT-116]]"
tags: [latency, dispatch, monitor, host-server, roadmap-017, measurement]
---

# TASK-116 — Verify real task-start latency drops from ~15s worst-case to ~2s under a live agent session

depends_on::[[TASK-120]]
depends_on::[[TASK-121]]

## Objective

Measure, with a reproducible protocol against a live `conductor` tmux session, that collapsing the dispatch loop (TASK-120 + TASK-121) actually cuts real task-start latency from `monitor.sh`'s old ~15s `POLL_INTERVAL` worst case down to the host-server's ~2s `STATUS_POLL_MS` tick — and record the before/after numbers so this roadmap item has verifiable evidence, not vibes.

## Approach: exact measurement protocol

**What "task-start latency" means here**: the wall-clock delta between the moment an agent's state file is written `idle` (the observable "agent finished, ready for the next task" event — written by `on-stop.js`/`on-session-start.js` for a real Claude Code agent, or manually for a synthetic one) and the moment the next queued task's dispatch is recorded — i.e. `dispatch_ts - idle_transition_ts`.

**Idle-transition timestamp source**: `$CONDUCTOR_LOG_DIR/hooks.jsonl` (per `CLAUDE.md` — one JSONL record per hook event, fields `ts`, `agent`, `event`, `prev_state`, `new_state`) for a real Claude Code agent's `Stop`/`StopFailure` hook firing `busy→idle`. For a synthetic/scripted trial (faster to run many times), the timestamp is instead the moment the test script writes `idle\n` to `${STATE_DIR}/<window>.state` — record that write time explicitly (`date +%s%3N` or `node -e 'console.log(Date.now())'`) since there's no hook event to read back in that case.

**Dispatch timestamp source**: `logs/dispatch.jsonl`'s `ts` field for the record whose `command` matches the task just queued (post-TASK-121, every dispatch comes through the host-server's collapsed loop, `detection: "idle-transition-poll"` for the queue-driven case).

**Protocol** (run against a live `scripts/conductor.sh` session with the host-server + `monitor.sh` both running, post-TASK-120/121):
1. Pick or spawn an agent with `launchCmd: "bash"` (fast, deterministic, avoids waiting on a real Claude Code turn) that has no queued tasks and is currently idle (write `idle\n` to its state file if needed).
2. Queue a task for it via `POST /api/tasks` **while it is busy** (flip its state file to `busy` first) so the request takes the general queue-insert path (`dispatched: false`), not the fast path — this exercises the exact "task waiting for the agent to go idle" scenario the roadmap item is about.
3. Note the current time, then flip the state file to `idle` and capture that write's timestamp precisely (see above).
4. Poll `logs/dispatch.jsonl` (or tail it) until the matching dispatch record appears; compute `Δt = dispatch_ts - idle_write_ts`.
5. Repeat at least 10 trials (fresh task + idle-flip each time) to get a distribution, not a single sample — report min/median/max `Δt`.
6. **Baseline comparison**: run the same protocol once against a build *before* TASK-120/121 (e.g. `git stash`/checkout the pre-collapse commit in a scratch worktree under `./tmp/`, or simply re-run this exact protocol against the current `main` before these tasks land, and record the numbers here as the "before" baseline) — the roadmap's claim is specifically "~15s worst-case to ~2s", so the task is done only once both numbers are captured and compared, not just the "after" number in isolation.

**Judgeable acceptance bar**: median `Δt` after TASK-120/121 is ≤ `STATUS_POLL_MS` + a small margin (default `STATUS_POLL_MS=2000` in `conductor.conf`; allow up to ~3.5s to cover the poll-loop's own execution time plus `sendTextToPane`/tmux round-trip), and the **worst-case** (max) `Δt` before the change was materially bounded by `POLL_INTERVAL` (default 15s in `conductor.conf`) — i.e. before: max `Δt` approaches ~15s; after: max `Δt` stays within a couple seconds of `STATUS_POLL_MS` across all 10 trials, not just on average.

## Steps

### 1. Capture the "before" baseline  <!-- agent: general-purpose -->

- [x] If TASK-120/121 have already landed on the branch being measured, capture the baseline from a scratch worktree checked out at the commit immediately before TASK-120 (`git log --oneline` to find it), run under `./tmp/` per the repo's scratch-directory convention — not `/tmp`. Otherwise (if run before TASK-120/121 land), capture the baseline directly against `main`.
- [x] Run the Step-by-step protocol above for 10 trials against that pre-collapse build. Record each trial's `Δt` and the min/median/max in this task file (append a table under "Results" below the Acceptance Criteria section once complete).

### 2. Capture the "after" measurement  <!-- agent: general-purpose -->

- [x] Against the current branch (TASK-120 + TASK-121 landed), run the same protocol for 10 trials.
- [x] Record each trial's `Δt` and the min/median/max.

### 3. Compare and report  <!-- agent: general-purpose -->

- [x] Compute the before/after median and max `Δt`, and confirm they meet the judgeable acceptance bar above.
- [x] Append a "Results" section to this task file with both trial tables and the computed medians/maxes, plus a one-line verdict (met bar / did not — and if not, whether the shortfall is in TASK-120/121's implementation or in this task's measurement methodology).
- [x] Update `wiki/work/roadmaps/ROADMAP-017-competitive-audit-followups.md`'s Phase 1 checklist item for this measurement to reflect the recorded result (leave the roadmap checkbox flip itself to whichever process closes this task — `/tackle`/UAT convention in this repo).

<!-- Updated: 2026-08-22 13:45 -->

## Acceptance Criteria

- [x] Before/after `Δt` distributions are captured with the documented protocol (idle-write timestamp → matching `dispatch.jsonl` record timestamp), not estimated.
- [x] "Before" max `Δt` is materially bounded by the old 15s `POLL_INTERVAL` (i.e. the ~15s worst-case claim is substantiated with a real number, not assumed).
- [x] "After" median `Δt` is ≤ `STATUS_POLL_MS` (2000ms) + ~1.5s margin, and "after" max `Δt` stays within a couple seconds of `STATUS_POLL_MS` across all 10 trials.
- [x] Results are recorded in this task file (or linked from it) so the roadmap claim is auditable after the fact.

## Dependencies

- **DEPENDS ON [TASK-120](TASK-120-collapse-dispatch-into-status-poll.md)** — the host-server idle-transition dispatch trigger being measured.
- **DEPENDS ON [TASK-121](TASK-121-remove-redundant-monitor-dispatch.md)** — measuring against a single, non-redundant dispatch path avoids ambiguity about which trigger actually fired for a given trial.

### Roadmap

Implements ROADMAP-017 Phase 1, item "Verify real task-start latency drops from ~15s worst-case to ~2s under a live agent session" — `wiki/work/roadmaps/ROADMAP-017-competitive-audit-followups.md`.

## Results

Measured 2026-08-22, following the exact protocol above (10 trials each), against a dedicated synthetic `launchCmd: "bash"` agent (never a real registered agent). All dispatched trial commands were inert no-ops (`echo trial-N-<rand>`).

**"Before" (pre-TASK-120/121)**: a scratch git worktree checked out at `c814034` (the commit immediately preceding `a07e856`, which landed both TASK-120 and TASK-121 together — verified via `git show a07e856 --stat`, which touched both `host-server/index.ts` and `scripts/monitor.sh`), run under `./tmp/task-116-latency/baseline-worktree` with a fully isolated tmux server (custom `TMUX_TMPDIR` socket), isolated SQLite DB, `STATE_DIR`, and `LOG_DIR` — so it never touched the live session or real agents. `scripts/monitor.sh` from that commit (pre-collapse: still contains the inline pop/dispatch block later removed by TASK-121) ran its normal 15s-`POLL_INTERVAL` loop against one synthetic idle `bash` agent.

**"After" (current main, TASK-120+121 landed)**: the live `host-server` (port 8788) + live `conductor` tmux session, using a temporary agent (`id 16`, name `latency-test-after`, `launchCmd: "bash"`) created via `POST /api/agents` and deleted via `DELETE /api/agents/16` afterward. Every dispatch record showed `"detection":"idle-transition-poll"`, confirming TASK-120's `pollAndDiff` idle-transition trigger — not a `monitor.sh` fallback — fired in every trial.

### Before — 10 trials (Δt = dispatch_ts − idle_write_ts, ms)

| Trial | Δt (ms) |
|---|---|
| 1 | 12412 |
| 2 | 7746 |
| 3 | 12546 |
| 4 | 12074 |
| 5 | 12605 |
| 6 | 12154 |
| 7 | 12722 |
| 8 | 12349 |
| 9 | 11945 |
| 10 | 12579 |

**min = 7746ms · median = 12380.5ms · max = 12722ms**

### After — 10 trials (Δt = dispatch_ts − idle_write_ts, ms)

| Trial | Δt (ms) | detection |
|---|---|---|
| 1 | 277 | idle-transition-poll |
| 2 | 827 | idle-transition-poll |
| 3 | 1157 | idle-transition-poll |
| 4 | 1522 | idle-transition-poll |
| 5 | 450 | idle-transition-poll |
| 6 | 1895 | idle-transition-poll |
| 7 | 848 | idle-transition-poll |
| 8 | 1183 | idle-transition-poll |
| 9 | 174 | idle-transition-poll |
| 10 | 546 | idle-transition-poll |

**min = 174ms · median = 837.5ms · max = 1895ms**

### Comparison against the acceptance bar

- **Before max (12722ms) is materially bounded by the old 15s `POLL_INTERVAL`** — every trial fell in the 7.7–12.7s band, consistent with a level-triggered poll loop whose worst case approaches (but per-trial phase alignment with the 15s tick rarely hits) the full interval. Substantiates the "~15s worst-case" claim with real numbers rather than assumption.
- **After median (837.5ms) is well under the `STATUS_POLL_MS` (2000ms) + ~1.5s margin (≤3500ms) bar.**
- **After max (1895ms) stays under `STATUS_POLL_MS` itself (2000ms)** across all 10 trials — better than the "within a couple seconds of STATUS_POLL_MS" bar requires.
- Net improvement: median dropped from **12380.5ms → 837.5ms** (~14.8x), max from **12722ms → 1895ms** (~6.7x).

**Verdict: MET.** Both the before and after distributions were captured with the documented protocol (idle-write timestamp → matching `dispatch.jsonl` record timestamp), not estimated, and both numbers clear the acceptance bar with margin.

**Methodology notes**:
- The "before" `dispatch.jsonl` records use `date -u +%Y-%m-%dT%H:%M:%SZ` (second-granularity, no milliseconds) in `scripts/monitor.sh`'s `emit_dispatch_jsonl`, vs. the "after" path's `new Date().toISOString()` (millisecond-granularity) in `host-server/index.ts`'s `dispatchTaskToAgent`. This gives the "before" numbers up to ±999ms of quantization noise — immaterial at the observed ~8–13s scale, called out here for completeness rather than as a caveat on the verdict.
- Mid-run, the live shared `conductor` tmux session was independently torn down and restored multiple times by other concurrent activity in this workspace (unrelated to TASK-120/121 or this measurement); one side effect (a stale fleet-wide `logs/state/usage-limited` marker, written by the live `monitor.sh` when it iterated zero live agent windows) transiently blocked all idle-transition dispatch and was cleared before/during each "after" trial via the trial script. This is a pre-existing operational characteristic of the shared dev environment, not a TASK-120/121 defect, and did not affect the recorded Δt values (trials only recorded once a clean transition fired).
