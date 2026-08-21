---
id: TASK-086
aliases: [TASK-086]
title: "add terminal WebSocket lifecycle counters"
status: done
created: 2026-07-04
updated: 2026-07-04
depends_on: []
blocks: []
parallel_safe_with: [TASK-084, TASK-085, TASK-087, TASK-088, TASK-089, TASK-090, TASK-091, TASK-092, TASK-093]
uat: "[[UAT-086]]"
tags: [observability, websocket, terminal, roadmap-016]
---

# TASK-086 — add terminal WebSocket lifecycle counters

## Objective

Track focused terminal WebSocket connection lifecycle and message health.

## Approach

Add `terminalWebSocket` counters in `host-server/index.ts` for active/opened/closed connections, messages, acknowledgements, echoes, and errors.

## Steps

- [x] Increment counters on terminal WebSocket open, message, error, and close.
- [x] Emit `terminal_ws_open` and `terminal_ws_close` records to `logs/observability.jsonl`.
- [x] Include WebSocket counters in benchmark output.

## Acceptance Criteria

- [x] `/api/perf/live-updates` exposes terminal WebSocket counters.
- [x] Lifecycle JSONL records are written best-effort and cannot break the server.

## Verification

- [x] `npm --prefix host-server run typecheck`
- [x] `npm --prefix host-server run lint`
- [x] `npm --prefix host-server run perf:test`

### Roadmap

Implements ROADMAP-016 Phase 2 item "Add terminal WebSocket lifecycle counters".
