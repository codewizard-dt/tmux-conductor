---
id: TASK-073
title: "capture current dashboard performance baseline"
status: done
created: 2026-06-28
updated: 2026-06-28
depends_on: [TASK-072]
blocks: [TASK-074, TASK-076, TASK-080, TASK-081]
parallel_safe_with: []
uat: "[[UAT-073]]"
tags: [performance, baseline, roadmap-014]
---

# TASK-073 — capture current dashboard performance baseline

## Objective

Create repeatable baseline measurements for current dashboard live-update behavior using the instrumentation from TASK-072.

## Approach

Add a script under `scripts/` that samples `GET /api/perf/live-updates` before and after a fixed observation window, records deltas, and writes a markdown baseline under `raw/research/dashboard-performance-websockets/` or `wiki/knowledge/` with date, environment, commands, and observed costs.

## Steps

### 1. Review instrumentation shape  <!-- agent: general-purpose -->

- [x] Read `host-server/index.ts` and any helper added by TASK-072.
- [x] Read `raw/research/dashboard-performance-websockets/index.md` for prior notes and terminology.

### 2. Add baseline script  <!-- agent: general-purpose -->

- [x] Create `scripts/measure-dashboard-performance.sh`.
- [x] Accept `HOST_URL` with default `http://localhost:5174/api` or the repo's documented host-server URL.
- [x] Fetch metrics at start and end, wait for a configurable duration, and print count/rate/duration deltas for live-update metrics.
- [x] Fail clearly when the host server is not reachable.

### 3. Record baseline document  <!-- agent: general-purpose -->

- [x] Add `raw/research/dashboard-performance-websockets/current-baseline.md`.
- [x] Include the exact command, date `2026-06-28`, expected environment, and fields to record.
- [x] If a local server is available, run the script and paste the measured output; otherwise document that the command is repeatable but local measurement was unavailable.

### 4. Verify  <!-- agent: general-purpose -->

- [x] Run `bash -n scripts/measure-dashboard-performance.sh`.
- [x] Run `npm --prefix host-server run typecheck`.

## Acceptance Criteria

- [x] A repeatable baseline script exists and reads the live metrics endpoint.
- [x] A baseline markdown document records command, environment, and observed or pending measurement fields.
- [x] Script syntax validation passes.
- [x] Host-server typecheck passes.

## Dependencies

Depends on TASK-072 for the metrics endpoint.

### Roadmap

Implements ROADMAP-014 Phase 1, item "Capture current dashboard performance baseline" — `wiki/work/roadmaps/ROADMAP-014-dashboard-performance-websockets.md`.
