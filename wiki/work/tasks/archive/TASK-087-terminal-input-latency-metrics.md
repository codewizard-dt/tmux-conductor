---
id: TASK-087
title: "add input-to-ack and input-to-echo latency metrics"
status: done
created: 2026-07-04
updated: 2026-07-04
depends_on: []
blocks: []
parallel_safe_with: [TASK-084, TASK-085, TASK-086, TASK-088, TASK-089, TASK-090, TASK-091, TASK-092, TASK-093]
uat: "[[UAT-087]]"
tags: [observability, latency, terminal, roadmap-016]
---

# TASK-087 — add input-to-ack and input-to-echo latency metrics

## Objective

Measure focused terminal input latency from browser message to backend acknowledgement and first changed output.

## Approach

Time WebSocket input handling in `host-server/index.ts`, emit ack latency in ack frames, emit echo latency when the next pane snapshot changes, and surface both in frontend debug state.

## Steps

- [x] Add `terminalWsInputAck` timing.
- [x] Add `terminalWsInputEcho` timing.
- [x] Extend `frontend/src/lib/terminalWebSocket.ts` message types for ack/echo latency frames.

## Acceptance Criteria

- [x] Benchmark script reports ack and echo timing rows.
- [x] Frontend typecheck passes with the expanded WebSocket message contract.

## Verification

- [x] `npm --prefix host-server run typecheck`
- [x] `npm --prefix frontend run typecheck`
- [x] `npm --prefix frontend run build`

### Roadmap

Implements ROADMAP-016 Phase 2 item "Add input-to-ack and input-to-echo latency metrics".
