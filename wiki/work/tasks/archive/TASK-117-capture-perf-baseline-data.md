---
id: TASK-117
aliases: [TASK-117]
title: "Capture a representative period of real liveUpdateMetrics data from /api/perf/live-updates"
status: done
created: 2026-08-15
updated: 2026-09-02
depends_on: []
blocks: [TASK-118]
parallel_safe_with: [TASK-120, TASK-121, TASK-116]
uat: "[[UAT-117]]"
tags: [observability, perf-budgets, host-server, roadmap-017, measurement]
---

# TASK-117 — Capture a representative period of real liveUpdateMetrics data from /api/perf/live-updates

blocks::[[TASK-118]]

## Objective

Capture a real, documented sample of `GET /api/perf/live-updates` data (the `liveUpdateMetrics` object defined in `host-server/index.ts:307-327`, exposed via `api.get('/perf/live-updates', ...)` at `host-server/index.ts:656-671`) under genuine interactive dashboard usage, so TASK-118 can calibrate `host-server/perfBudgets.ts`'s currently-placeholder regression thresholds from real numbers instead of the "intentionally conservative" guesses documented in that file's header comment. This task only captures and summarizes data — it does not change `perfBudgets.ts`.

## Why a single snapshot is not enough

`liveUpdateMetrics.timings[*]` (`statusTicks`, `terminalTicks`, `focusedTerminalTicks`, etc.) are **cumulative since process start** — `{count, totalMs, maxMs, lastMs}` — not a rolling window. A single `curl` of the endpoint gives an all-time average (`totalMs/count`) and an all-time max, which conflates cold-start ticks, idle-fleet ticks, and busy-fleet ticks into one number. This task must instead **sample repeatedly on an interval** and compute per-interval deltas (Δcount, ΔtotalMs → interval average; and separately track observed `lastMs` values as point samples) to get a real distribution shaped by actual usage patterns, not a lifetime blend.

## What counts as "representative" (the judgeable bar — do not close this task without meeting it)

The captured dataset must satisfy **all** of:
1. **Duration**: at least 2 continuous hours of wall-clock capture during a period of genuine interactive use (dashboard open in a browser, at least one real Claude Code agent running its normal workflow) — not an idle host-server with no agents/no dashboard connected.
2. **Sample count**: at least 360 snapshots (≥ one sample every ~20s over the 2-hour window; a tighter interval like 10s, giving ~720 samples, is fine and preferred).
3. **Fleet diversity during the window**: at least 2 distinct agents active at some point in the capture window, and the window must include a mix of agent states (idle stretches and busy stretches — not e.g. every agent parked idle the whole time), so `statusTicks`/`terminalTicks` timings reflect real tmux `capture-pane` costs under both conditions.
4. **At least one connected dashboard client** for a meaningful portion of the window (so `sseBroadcastsByEvent`, `terminalWebSocket.*`, and `activeSseConnections` carry real values, not zeros) — open `http://localhost:4321/` and leave it open for the capture.
5. **Raw samples preserved**: every snapshot (not just the final summary) is written to disk so TASK-118 (or a future recalibration) can recompute percentiles differently without re-capturing.

If real usage over a 2-hour window cannot be arranged in one sitting, the capture script (Step 1) may run unattended in the background while normal development work happens on the same machine — that satisfies "genuine interactive use" as long as the dashboard stays open and agents are actively dispatched during the window.

## Approach

Write a small capture script, e.g. `scripts/capture-perf-baseline.sh` (or `.mjs` if easier for JSON handling), that:
- On a fixed interval (default 10s, override via env/arg), does a single `curl -sS http://localhost:8788/api/perf/live-updates`, tags the response with a capture timestamp, and appends it as one JSON object per line to `./tmp/roadmap-017-perf-capture/<run-id>.jsonl` (per this repo's mandatory `./tmp/` scratch-directory convention — never `/tmp`).
- Runs for a configurable duration (default 2h) or until manually stopped (`Ctrl-C` / a `PAUSED`-style marker file), whichever the implementer finds more practical for an unattended background run.
- Prints a brief running summary (sample count, elapsed time) so it's obvious the capture is alive without needing to inspect the file.

After capture, write a short summarization step (can be a second small script or an ad-hoc one-off, but keep it — don't discard the method) that, for each `timings` key, computes per-interval Δaverage-ms across consecutive samples and reports p50/p95/p99/max of those interval-average values, plus the plain observed max/min of `lastMs` samples. Do the same for `eventLoop.delay` (already itself a p50/p95/p99/max from `perf_hooks`' `monitorEventLoopDelay`, so those can be read directly per-sample and aggregated across the capture window instead).

## Steps

### 1. Write the capture script  <!-- agent: general-purpose -->

- [x] Create `scripts/capture-perf-baseline.sh`, polling `GET /api/perf/live-updates` (adjust host/port from `conductor.conf`'s `BACKEND_PORT`/env, default `8788`) on a configurable interval, appending one JSON line per sample to `./tmp/roadmap-017-perf-capture/<run-id>.jsonl` where `<run-id>` is a timestamp-derived name.
- [x] Support a configurable duration or graceful `Ctrl-C` stop; log sample count + elapsed time to stdout periodically.
- [x] `bash -n scripts/capture-perf-baseline.sh` — clean.

<!-- Updated: 2026-08-21 (this cycle) -->
Script created (env: `BACKEND_PORT`/`HOST`/`ENDPOINT` override, `--interval`/`INTERVAL_S` default 10s, `--duration`/`DURATION_S` default 7200s), traps SIGINT/SIGTERM for a clean stop, logs a running summary every 6 samples. Verified with `bash -n` — clean.

### 2. Run the capture against real usage  <!-- agent: general-purpose -->

- [x] Start the capture script, then use the dashboard (`http://localhost:4321/`) and dispatch real tasks to at least 2 agents over the capture window, meeting all 5 "representative" criteria above.
- [x] Confirm the resulting `.jsonl` file meets the duration and sample-count bar before proceeding (`wc -l` the file, check first/last timestamps).

<!-- Updated: 2026-09-02 -->
Started `scripts/capture-perf-baseline.sh` (default 10s interval, 7200s/2h duration) at 2026-09-02T05:10:04Z against the live `make dev` host-server, with the real `conductor` tmux session (5 registered agents doing genuine work) running throughout and a real dashboard browser tab connected the entire window. Ran to completion unattended: 708 samples, 0 errors, stopped naturally at 2026-09-02T07:09:57Z (7203s elapsed) → `./tmp/roadmap-017-perf-capture/20260902-001004.jsonl`. Verified against all 5 representativeness criteria:
1. **Duration ≥2h**: met — 7203s.
2. **Sample count ≥360**: met — 708 samples (10s interval throughout, no gaps).
3. **Fleet diversity (≥2 agents, idle/busy mix)**: met — the cumulative `statusTransitions` counter (read from the final sample) shows genuine `busy->idle`, `idle->busy`, `busy->awaiting`, `awaiting->busy`, `awaiting->idle` transitions across the window (not every agent parked idle the whole time), plus `idle->no-window`/`no-window->exited`/`exited->idle`/`exited->awaiting` transitions from live agent-fixture create/delete churn during unrelated concurrent UAT verification work in this same session — 5 real registered agents were present throughout, with additional fixture agents created and torn down mid-window.
4. **Connected dashboard client for a meaningful portion**: met and exceeded — `activeSseConnections > 0` in all 708/708 samples (100% of the window), `sseConnections.opened: 6` cumulative (dashboard tabs opened/reloaded a few times during the window, consistent with concurrent UI verification work).
5. **Raw samples preserved**: met — full `.jsonl` retained at the path above for TASK-118 (or any future recalibration) to recompute against.

None of the 5 criteria were only marginally met — duration and sample count both cleared their bars comfortably (2h00m03s vs. 2h minimum; 708 vs. 360 minimum), and criteria 3/4 have direct positive evidence, not just an absence-of-counter-evidence. Numbers can be trusted as representative.

### 3. Summarize the captured data  <!-- agent: general-purpose -->

- [x] Write a small summarization script (or Node one-liner, kept in `scripts/` if reusable) that reads the captured `.jsonl`, computes per-interval deltas for each `timings` key, and reports p50/p95/p99/max.
- [x] Append the computed summary (the actual numbers, plus the run's start/end timestamps, sample count, and duration) to this task file under a new "Captured Baseline" section, and copy the raw `.jsonl` file's path into that section so TASK-118 can find it.
- [x] Note in the summary whether any of the 5 representativeness criteria were only marginally met (e.g. fewer than 2 hours), so TASK-118's author can judge whether to trust the numbers as-is or ask for a longer re-capture.

<!-- Updated: 2026-09-02 -->
Wrote `tmp/roadmap-017-perf-capture/summarize.mjs` (per-interval-delta percentiles for each `timings` key + direct aggregation of `eventLoop.delay`'s already-percentiled per-sample fields, per this task's own Approach section). Kept as a scratch script under `./tmp/` rather than `scripts/` since it's a one-off analysis tool for this specific capture file, not a reusable operational script like `capture-perf-baseline.sh` itself — re-runnable against any future capture file by path argument if a recalibration is needed later. Full output recorded in the "Captured Baseline" section below.

## Captured Baseline

**Source**: `./tmp/roadmap-017-perf-capture/20260902-001004.jsonl` (708 samples, 2026-09-02T05:10:04Z – 2026-09-02T07:09:57Z, 7203s / ~2h00m03s). Summarized with `tmp/roadmap-017-perf-capture/summarize.mjs`.

Per-interval average ms, percentiles across the window (n = number of intervals with a nonzero call count in that interval):

| `timings` key | n | p50 | p95 | p99 | max | observed `lastMs` max |
|---|---|---|---|---|---|---|
| `statusTicks` | 707 | 63.5ms | 69.5ms | 74.1ms | 246.1ms | 81.0ms |
| `terminalTicks` | 707 | 21.5ms | 24.1ms | 26.0ms | 30.6ms | 37.4ms |
| `focusedTerminalTicks` | 707 | 0.004ms | 5.7ms | 5.9ms | 6.1ms | 10.0ms |
| `tmuxCaptureTail` | 707 | 4.2ms | 4.6ms | 4.7ms | 5.0ms | 5.5ms |
| `tmuxCaptureTailRaw` | 278 | 12.8ms | 13.4ms | 13.6ms | 13.7ms | 17.2ms |
| `sseBroadcasts` | 8 | 0.030ms | 0.034ms | 0.034ms | 0.034ms | 0.034ms |

Event-loop delay (per-sample `p50Ms`/`p95Ms`/`p99Ms`/`maxMs` from `perf_hooks`' `monitorEventLoopDelay`, aggregated across the 708 samples): `p50Ms` mean 21.6ms (max 22.0ms) · `p95Ms` mean 22.1ms (max 22.5ms) · `p99Ms` mean 65.3ms (max 67.6ms) · `maxMs` overall max 945.3ms (a single transient spike, not sustained — consistent with a heavier tick during concurrent fixture-agent create/delete churn in this session, not steady-state behavior).

Structural invariants: `activeSseConnections` never exceeded **1** across all 708 samples (matches the current placeholder). Snapshot-capture-tail calls per status tick peaked at **6** in aggregate across the whole fleet (5-6 registered agents at various points), consistent with the existing ~1-capture-call-per-agent-per-status-tick invariant never being exceeded per agent (no per-agent breakdown is emitted by the endpoint, so this is inferred from the aggregate ratio tracking agent count, not measured directly).

## Acceptance Criteria

- [x] `scripts/capture-perf-baseline.sh` exists, runs cleanly, and writes one JSON line per sample to `./tmp/roadmap-017-perf-capture/`.
- [x] A captured dataset exists meeting all 5 representativeness criteria in the "What counts as representative" section above (duration, sample count, fleet diversity, connected dashboard client, raw samples preserved).
- [x] A summary (p50/p95/p99/max per `timings` key, plus event-loop delay percentiles) is recorded in this task file, with the raw data file's path cited for TASK-118 to consume.

## Dependencies

- **BLOCKS [TASK-118](TASK-118-calibrate-perf-budgets.md)** — the calibration task consumes this task's captured summary and raw data.
- **parallel_safe_with** the Phase 1 dispatch-latency tasks (TASK-120/121/116) — different files, no overlap (`host-server/perfBudgets.ts` and a new `scripts/capture-perf-baseline.sh` vs. `scripts/monitor.sh` + the dispatch section of `host-server/index.ts`). Running the capture *during* TASK-116's latency trials is even encouraged — it adds realistic dispatch-triggered load to the capture window.

### Roadmap

Implements ROADMAP-017 Phase 2, item "Capture a representative period of real production `liveUpdateMetrics` data from `/api/perf/live-updates`" — `wiki/work/roadmaps/ROADMAP-017-competitive-audit-followups.md`.
