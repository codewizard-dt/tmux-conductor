---
id: TASK-084
aliases: [TASK-084]
title: "add event-loop delay and utilization metrics"
status: done
created: 2026-07-04
updated: 2026-07-04
depends_on: []
blocks: []
parallel_safe_with: [TASK-085, TASK-086, TASK-087, TASK-088, TASK-089, TASK-090, TASK-091, TASK-092, TASK-093]
uat: "[[UAT-084]]"
tags: [observability, metrics, roadmap-016]
---

# TASK-084 — add event-loop delay and utilization metrics

## Objective

Expose Node event-loop delay and utilization through the existing local performance endpoint.

## Approach

Use Node's `monitorEventLoopDelay` and `performance.eventLoopUtilization()` in `host-server/index.ts`, keeping `/api/perf/live-updates` as the single metrics endpoint.

## Steps

- [x] Add event-loop delay histogram collection to `host-server/index.ts`.
- [x] Add event-loop utilization deltas to the `/api/perf/live-updates` response.
- [x] Include event-loop output in `scripts/measure-dashboard-performance.sh`.

## Acceptance Criteria

- [x] `/api/perf/live-updates` includes `eventLoop.delay` and `eventLoop.utilization`.
- [x] Host typecheck and lint pass.

## Verification

- [x] `npm --prefix host-server run typecheck`
- [x] `npm --prefix host-server run lint`
- [x] `npm --prefix host-server run perf:test`

### Roadmap

Implements ROADMAP-016 Phase 1 item "Add event-loop delay and utilization metrics".
