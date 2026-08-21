---
id: TASK-117
aliases: [TASK-117]
title: "Capture a representative period of real liveUpdateMetrics data from /api/perf/live-updates"
status: in-progress
created: 2026-08-15
updated: 2026-08-15
depends_on: []
blocks: [TASK-118]
parallel_safe_with: [TASK-120, TASK-121, TASK-116]
uat: ""
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

- [BLOCKED: no live host-server/dashboard session available] Start the capture script, then use the dashboard (`http://localhost:4321/`) and dispatch real tasks to at least 2 agents over the capture window, meeting all 5 "representative" criteria above.
- [BLOCKED: depends on above] Confirm the resulting `.jsonl` file meets the duration and sample-count bar before proceeding (`wc -l` the file, check first/last timestamps).

<!-- Updated: 2026-08-21 (this cycle) -->
Verified `curl -sS http://localhost:8788/api/perf/live-updates` and `curl -sS http://localhost:4321/` both fail to connect (exit 7, "Couldn't connect to server") — neither the host-server nor the dashboard is currently running in this environment. This step's own bar (2+ continuous hours of genuine interactive use, ≥2 distinct agents, a connected dashboard client) cannot be satisfied by an autonomous agent turn; it requires the user to run `make dev`, open `http://localhost:4321/`, and dispatch real work to ≥2 agents over a live 2-hour window, ideally with `scripts/capture-perf-baseline.sh` running in the background for that same window (e.g. `nohup scripts/capture-perf-baseline.sh > ./tmp/roadmap-017-perf-capture/run.log 2>&1 &`, or backgrounded in its own tmux/terminal pane). Leaving this step BLOCKED rather than fabricating a capture run.

### 3. Summarize the captured data  <!-- agent: general-purpose -->

- [BLOCKED: depends on step 2's raw .jsonl data] Write a small summarization script (or Node one-liner, kept in `scripts/` if reusable) that reads the captured `.jsonl`, computes per-interval deltas for each `timings` key, and reports p50/p95/p99/max.
- [BLOCKED: depends on step 2] Append the computed summary (the actual numbers, plus the run's start/end timestamps, sample count, and duration) to this task file under a new "Captured Baseline" section, and copy the raw `.jsonl` file's path into that section so TASK-118 can find it.
- [BLOCKED: depends on step 2] Note in the summary whether any of the 5 representativeness criteria were only marginally met (e.g. fewer than 2 hours), so TASK-118's author can judge whether to trust the numbers as-is or ask for a longer re-capture.

<!-- Updated: 2026-08-21 (this cycle) -->
Not started — no raw capture data exists yet (see Step 2). The summarization script itself is straightforward (per-sample deltas on `timings[*].{count,totalMs}`, percentile of interval averages, plus direct aggregation of `eventLoop.delay`'s already-percentiled fields) and can be written as soon as a real `.jsonl` file exists to develop/validate it against.

## Acceptance Criteria

- [ ] `scripts/capture-perf-baseline.sh` exists, runs cleanly, and writes one JSON line per sample to `./tmp/roadmap-017-perf-capture/`.
- [ ] A captured dataset exists meeting all 5 representativeness criteria in the "What counts as representative" section above (duration, sample count, fleet diversity, connected dashboard client, raw samples preserved).
- [ ] A summary (p50/p95/p99/max per `timings` key, plus event-loop delay percentiles) is recorded in this task file, with the raw data file's path cited for TASK-118 to consume.

## Dependencies

- **BLOCKS [TASK-118](TASK-118-calibrate-perf-budgets.md)** — the calibration task consumes this task's captured summary and raw data.
- **parallel_safe_with** the Phase 1 dispatch-latency tasks (TASK-120/121/116) — different files, no overlap (`host-server/perfBudgets.ts` and a new `scripts/capture-perf-baseline.sh` vs. `scripts/monitor.sh` + the dispatch section of `host-server/index.ts`). Running the capture *during* TASK-116's latency trials is even encouraged — it adds realistic dispatch-triggered load to the capture window.

### Roadmap

Implements ROADMAP-017 Phase 2, item "Capture a representative period of real production `liveUpdateMetrics` data from `/api/perf/live-updates`" — `wiki/work/roadmaps/ROADMAP-017-competitive-audit-followups.md`.
