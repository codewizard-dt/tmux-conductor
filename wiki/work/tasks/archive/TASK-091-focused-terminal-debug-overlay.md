---
id: TASK-091
title: "add focused terminal debug overlay"
status: done
created: 2026-07-04
updated: 2026-07-04
depends_on: []
blocks: []
parallel_safe_with: [TASK-084, TASK-085, TASK-086, TASK-087, TASK-088, TASK-089, TASK-090, TASK-092, TASK-093]
uat: "[[UAT-091]]"
tags: [observability, frontend, terminal, roadmap-016]
---

# TASK-091 — add focused terminal debug overlay

## Objective

Expose focused terminal transport health directly in the dashboard when diagnosing stalls.

## Approach

Add a compact `Debug` details panel to `frontend/src/components/LogTail.tsx` that shows WebSocket state, last ack latency, last echo latency, and output snapshot metadata.

## Steps

- [x] Track WebSocket debug state in `LogTail`.
- [x] Render the debug panel only for focused terminal views.
- [x] Keep state updates compatible with React lint rules.

## Acceptance Criteria

- [x] Debug overlay renders from WebSocket ack/echo/output frames.
- [x] Frontend typecheck, lint, and build pass.

## Verification

- [x] `npm --prefix frontend run typecheck`
- [x] `npm --prefix frontend run lint`
- [x] `npm --prefix frontend run build`

### Roadmap

Implements ROADMAP-016 Phase 4 item "Add focused terminal debug overlay".
