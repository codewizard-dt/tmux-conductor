---
id: TASK-072
aliases: [TASK-072]
title: "live-update timing instrumentation and counters"
status: done
created: 2026-06-28
updated: 2026-06-28
depends_on: []
blocks: [TASK-073, TASK-074, TASK-075, TASK-078, TASK-080, TASK-081]
parallel_safe_with: []
uat: "[[UAT-072]]"
tags: [performance, instrumentation, roadmap-014]
---

# TASK-072 — live-update timing instrumentation and counters

## Objective

Add lightweight live-update instrumentation to the host server so dashboard update loops, tmux capture calls, SSE broadcasts, and direct terminal reads expose measurable counters and timings without changing normal behavior.

## Approach

Keep instrumentation in-process and dependency-free. Add a small metrics helper in `host-server/index.ts` or a local helper module, wrap the existing status loop, terminal-output loops, `capturePaneTail`/`capturePaneTailRaw` call sites, `/events` connection tracking, and `/agents/:agent/tail`. Expose a JSON endpoint that can be consumed by benchmarks and tests.

## Steps

### 1. Map live update paths  <!-- agent: general-purpose -->

- [x] Read `host-server/index.ts`, `host-server/state.ts`, `frontend/src/hooks/useSSE.ts`, `frontend/src/lib/useAgents.ts`, `frontend/src/components/AgentList.tsx`, and `frontend/src/components/LogTail.tsx`.
- [x] Identify every host-server path that periodically emits dashboard state or terminal output.

### 2. Add server-side metrics  <!-- agent: general-purpose -->

- [x] In `host-server/index.ts` or a new `host-server/perf.ts`, add counters and timing summaries for status ticks, terminal broadcast ticks, focused terminal ticks, tmux capture calls, SSE broadcasts, active SSE connections, and `/agents/:agent/tail` calls.
- [x] Track count, total duration, max duration, and last duration for timed operations using `performance.now()`.
- [x] Keep all metric updates synchronous and low overhead.

### 3. Instrument existing paths  <!-- agent: general-purpose -->

- [x] Wrap the status polling loop near the bottom of `host-server/index.ts`.
- [x] Wrap the normal and focused terminal output loops near `broadcastSSE('terminal-output'...)` and `broadcastSSE('terminal-output-focus'...)`.
- [x] Increment capture counters around host-server call sites to `capturePaneTail` and `capturePaneTailRaw`.
- [x] Count `/events` connect/disconnect and per-event broadcasts.
- [x] Count `/agents/:agent/tail` requests.

### 4. Expose metrics  <!-- agent: general-purpose -->

- [x] Add `GET /api/perf/live-updates` returning the live metrics object and a server timestamp.
- [x] Add a reset query or route only if needed by tests; if added, keep it development-safe and documented in code.
- [x] Run `npm --prefix host-server run typecheck`.

## Acceptance Criteria

- [x] `GET /api/perf/live-updates` reports live-update counters and timing summaries.
- [x] Existing dashboard SSE and terminal behavior is unchanged.
- [x] Metrics include status ticks, terminal ticks, focused terminal ticks, capture calls, SSE connections, SSE broadcasts, and tail requests.
- [x] `npm --prefix host-server run typecheck` passes.

<!-- Updated: 2026-06-28 02:42 -->

## Dependencies

None.

### Roadmap

Implements ROADMAP-014 Phase 1, item "Add live-update timing instrumentation and counters" — `wiki/work/roadmaps/ROADMAP-014-dashboard-performance-websockets.md`.
