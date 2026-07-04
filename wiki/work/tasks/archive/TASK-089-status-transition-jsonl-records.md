---
id: TASK-089
title: "add status-transition JSONL records"
status: done
created: 2026-07-04
updated: 2026-07-04
depends_on: []
blocks: []
parallel_safe_with: [TASK-084, TASK-085, TASK-086, TASK-087, TASK-088, TASK-090, TASK-091, TASK-092, TASK-093]
uat: "[[UAT-089]]"
tags: [observability, logging, status, roadmap-016]
---

# TASK-089 — add status-transition JSONL records

## Objective

Persist agent status transitions so a local stall can be diagnosed after the fact.

## Approach

When `pollAndDiff()` detects an agent state change, increment a transition counter and append a `status_transition` record to `logs/observability.jsonl`.

## Steps

- [x] Add `statusTransitions` counters to live metrics.
- [x] Append structured transition records with agent id, agent name, previous state, and next state.
- [x] Include the log file in the diagnostic bundle.

## Acceptance Criteria

- [x] Status transitions are visible in metrics and JSONL.
- [x] Logging is best-effort and does not affect SSE broadcasting.

## Verification

- [x] `npm --prefix host-server run typecheck`
- [x] `npm --prefix host-server run perf:test`

### Roadmap

Implements ROADMAP-016 Phase 3 item "Add status-transition JSONL records".
