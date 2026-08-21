---
id: TASK-074
aliases: [TASK-074]
title: "identify performance budgets for live updates"
status: done
created: 2026-06-28
updated: 2026-06-28
depends_on: [TASK-072, TASK-073]
blocks: [TASK-078, TASK-079, TASK-080, TASK-081, TASK-083]
parallel_safe_with: []
uat: "[[UAT-074]]"
tags: [performance, budgets, roadmap-014]
---

# TASK-074 — identify performance budgets for live updates

## Objective

Define explicit live-update performance budgets for dashboard status updates, terminal captures, SSE fanout, and focused terminal latency.

## Approach

Use the baseline from TASK-073 and existing research to set practical budgets in documentation and machine-readable constants for tests. Budgets should be loose enough for local development variance but strict enough to catch regressions.

## Steps

### 1. Review evidence  <!-- agent: general-purpose -->

- [x] Read `raw/research/dashboard-performance-websockets/index.md`, `raw/research/websocket-dashboard-transport/index.md`, and `raw/research/dashboard-performance-websockets/current-baseline.md`.
- [x] Read the metrics names from TASK-072.

### 2. Add budgets module  <!-- agent: general-purpose -->

- [x] Create `host-server/perfBudgets.ts` exporting named live-update budget constants.
- [x] Include budgets for max status tick duration, max normal terminal tick duration, max focused terminal tick duration, max capture calls per agent per interval, and max SSE connection count expected from the dashboard.
- [x] Keep values documented with comments tied to the baseline.

### 3. Document budgets  <!-- agent: general-purpose -->

- [x] Add or update `wiki/knowledge/concepts/dashboard-live-update-performance-budgets.md`.
- [x] Include rationale, baseline reference, measurement command, and how to revise budgets.

### 4. Verify  <!-- agent: general-purpose -->

- [x] Run `npm --prefix host-server run typecheck`.

## Acceptance Criteria

- [x] Live-update budgets are documented.
- [x] Host-server exports machine-readable budget constants for regression tests.
- [x] Budget rationale references baseline evidence.
- [x] Host-server typecheck passes.

## Dependencies

Depends on TASK-072 and TASK-073.

### Roadmap

Implements ROADMAP-014 Phase 1, item "Identify performance budgets for live updates" — `wiki/work/roadmaps/ROADMAP-014-dashboard-performance-websockets.md`.
