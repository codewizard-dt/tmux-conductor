---
id: TASK-083
title: "compare optimized SSE and WebSocket performance"
status: done
created: 2026-06-28
updated: 2026-06-28
depends_on: [TASK-074, TASK-075, TASK-076, TASK-077, TASK-080, TASK-081, TASK-082]
blocks: []
parallel_safe_with: []
uat: "[[UAT-083]]"
tags: [performance, websocket, sse, roadmap-014]
---

# TASK-083 — compare optimized SSE and WebSocket performance

## Objective

Compare optimized SSE performance against the focused terminal WebSocket path and record an evidence-based rollout recommendation.

## Approach

Use the benchmark commands and metrics from earlier ROADMAP-014 tasks. Produce a concise comparison document with measurements, trade-offs, and a recommendation for default behavior or continued opt-in rollout.

## Steps

### 1. Gather measurement setup  <!-- agent: general-purpose -->

- [x] Read `wiki/knowledge/concepts/dashboard-performance-benchmarking.md`.
- [x] Read `raw/research/dashboard-performance-websockets/current-baseline.md`.
- [x] Confirm optimized SSE and WebSocket paths are implemented.

### 2. Run comparison  <!-- agent: general-purpose -->

- [x] Measure optimized SSE focused terminal behavior with the WebSocket path disabled or disconnected.
- [x] Measure focused terminal WebSocket behavior with the same agent/session conditions.
- [x] Capture metrics endpoint deltas, connection count, capture count, broadcast/message count, and observed latency notes.

### 3. Document recommendation  <!-- agent: general-purpose -->

- [x] Add `raw/research/dashboard-performance-websockets/sse-vs-websocket-comparison.md`.
- [x] Include commands, environment, results table, interpretation, and rollout recommendation.
- [x] Update `wiki/knowledge/concepts/dashboard-performance-benchmarking.md` with a link to the comparison.

### 4. Verify  <!-- agent: general-purpose -->

- [x] Run host-server and frontend typechecks.
- [x] Run available performance regression commands.

## Acceptance Criteria

- [x] SSE vs WebSocket comparison document exists.
- [x] Recommendation is based on repeatable metrics and notes.
- [x] Documentation links to the comparison.
- [x] Typechecks and available performance checks pass.

## Dependencies

Depends on optimized SSE, benchmark docs, and WebSocket implementation tasks.

### Roadmap

Implements ROADMAP-014 Phase 4, item "Compare optimized SSE and WebSocket performance before rollout" — `wiki/work/roadmaps/ROADMAP-014-dashboard-performance-websockets.md`.
