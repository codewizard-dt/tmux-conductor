---
id: TASK-088
title: "coalesce focused WebSocket output frames"
status: done
created: 2026-07-04
updated: 2026-07-04
depends_on: [TASK-085, TASK-086]
blocks: [TASK-090, TASK-093, TASK-094]
parallel_safe_with: [TASK-091]
uat: "[[UAT-088]]"
tags: [host-server, websocket, terminal, performance, roadmap-015]
---

# TASK-088 — coalesce focused WebSocket output frames

## Objective

Reduce focused terminal frame churn by coalescing WebSocket output snapshots before sending them to clients.

## Approach

Keep the xterm full-snapshot contract, but avoid sending redundant or overly frequent frames. Reuse existing changed-snapshot tracking where possible, respect WebSocket buffered state, and send only the latest pending snapshot per tick.

## Steps

### 1. Inspect WebSocket send loop  <!-- agent: general-purpose -->

- [x] Inspect `host-server/index.ts` focused terminal WebSocket route.
- [x] Identify where snapshots are captured, compared, and sent.

### 2. Add coalescing  <!-- agent: general-purpose -->

- [x] Track the latest pending focused snapshot per WebSocket client or per focused agent.
- [x] Avoid sending identical snapshots.
- [x] Avoid enqueueing multiple snapshots when `bufferedAmount` or equivalent send state indicates the client is behind.
- [x] Preserve the initial snapshot behavior on connect.

### 3. Verify  <!-- agent: general-purpose -->

- [x] Run host-server typecheck.
- [x] Confirm existing terminal WebSocket tests or static checks still pass.

## Acceptance Criteria

- [x] WebSocket output sends are change-aware and coalesced.
- [x] Slow clients do not accumulate unbounded focused snapshot sends.
- [x] Initial focused terminal render still receives a snapshot promptly.

## Dependencies

- **DEPENDS ON [TASK-085](TASK-085-focused-transport-ownership-criteria.md)**.
- **DEPENDS ON [TASK-086](TASK-086-focused-websocket-exclusive-path.md)**.

### Roadmap

Implements ROADMAP-015 Phase 2, item "Coalesce focused WebSocket output frames" — `wiki/work/roadmaps/ROADMAP-015-latency-improvements.md`.
