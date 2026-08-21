---
id: TASK-116
aliases: [TASK-116]
title: "Verify real task-start latency drops from ~15s worst-case to ~2s under a live agent session"
status: todo
created: 2026-08-15
updated: 2026-08-15
depends_on: [TASK-120, TASK-121]
blocks: []
parallel_safe_with: []
uat: ""
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

- [ ] If TASK-120/121 have already landed on the branch being measured, capture the baseline from a scratch worktree checked out at the commit immediately before TASK-120 (`git log --oneline` to find it), run under `./tmp/` per the repo's scratch-directory convention — not `/tmp`. Otherwise (if run before TASK-120/121 land), capture the baseline directly against `main`.
- [ ] Run the Step-by-step protocol above for 10 trials against that pre-collapse build. Record each trial's `Δt` and the min/median/max in this task file (append a table under "Results" below the Acceptance Criteria section once complete).

### 2. Capture the "after" measurement  <!-- agent: general-purpose -->

- [ ] Against the current branch (TASK-120 + TASK-121 landed), run the same protocol for 10 trials.
- [ ] Record each trial's `Δt` and the min/median/max.

### 3. Compare and report  <!-- agent: general-purpose -->

- [ ] Compute the before/after median and max `Δt`, and confirm they meet the judgeable acceptance bar above.
- [ ] Append a "Results" section to this task file with both trial tables and the computed medians/maxes, plus a one-line verdict (met bar / did not — and if not, whether the shortfall is in TASK-120/121's implementation or in this task's measurement methodology).
- [ ] Update `wiki/work/roadmaps/ROADMAP-017-competitive-audit-followups.md`'s Phase 1 checklist item for this measurement to reflect the recorded result (leave the roadmap checkbox flip itself to whichever process closes this task — `/tackle`/UAT convention in this repo).

## Acceptance Criteria

- [ ] Before/after `Δt` distributions are captured with the documented protocol (idle-write timestamp → matching `dispatch.jsonl` record timestamp), not estimated.
- [ ] "Before" max `Δt` is materially bounded by the old 15s `POLL_INTERVAL` (i.e. the ~15s worst-case claim is substantiated with a real number, not assumed).
- [ ] "After" median `Δt` is ≤ `STATUS_POLL_MS` (2000ms) + ~1.5s margin, and "after" max `Δt` stays within a couple seconds of `STATUS_POLL_MS` across all 10 trials.
- [ ] Results are recorded in this task file (or linked from it) so the roadmap claim is auditable after the fact.

## Dependencies

- **DEPENDS ON [TASK-120](TASK-120-collapse-dispatch-into-status-poll.md)** — the host-server idle-transition dispatch trigger being measured.
- **DEPENDS ON [TASK-121](TASK-121-remove-redundant-monitor-dispatch.md)** — measuring against a single, non-redundant dispatch path avoids ambiguity about which trigger actually fired for a given trial.

### Roadmap

Implements ROADMAP-017 Phase 1, item "Verify real task-start latency drops from ~15s worst-case to ~2s under a live agent session" — `wiki/work/roadmaps/ROADMAP-017-competitive-audit-followups.md`.
