---
id: TASK-078
title: "host-server performance regression tests"
status: done
created: 2026-06-28
updated: 2026-06-28
depends_on: [TASK-072, TASK-074, TASK-076, TASK-077]
blocks: []
parallel_safe_with: [TASK-079, TASK-080]
uat: "[[UAT-078]]"
tags: [tests, performance, host-server, roadmap-014]
---

# TASK-078 — host-server performance regression tests

## Objective

Add automated host-server checks that fail when live-update capture or broadcast work exceeds the budgets defined for ROADMAP-014.

## Approach

Use existing npm scripts where possible. If the repo has no test runner, add a lightweight Node script under `host-server/` or `scripts/` that exercises exported helpers and metrics snapshots without requiring a real tmux session.

## Steps

### 1. Inspect test setup  <!-- agent: general-purpose -->

- [x] Read `host-server/package.json`, `host-server/tsconfig.json`, and existing scripts under `scripts/`.
- [x] Read `host-server/perfBudgets.ts` from TASK-074 and metrics code from TASK-072.

### 2. Add regression checks  <!-- agent: general-purpose -->

- [x] Create `host-server/perf-regression.test.ts` or `scripts/test-host-performance.mjs`, matching repo conventions.
- [x] Assert metric summary helpers calculate deltas and rates correctly.
- [x] Assert exported budgets are present and positive.
- [x] Add a simulated snapshot check that would fail on excessive capture count per agent per interval.

### 3. Wire command  <!-- agent: general-purpose -->

- [x] Add an npm script in `host-server/package.json` for the performance test if no suitable test command exists.
- [x] Keep command deterministic and not dependent on a live tmux session.

### 4. Verify  <!-- agent: general-purpose -->

- [x] Run the new host-server performance test command.
- [x] Run `npm --prefix host-server run typecheck`.

## Acceptance Criteria

- [x] Host-server performance regression checks exist and are deterministic.
- [x] Checks use TASK-074 budget constants.
- [x] The test command is documented in package scripts or benchmark docs.
- [x] New test command and typecheck pass.

## Dependencies

Depends on TASK-072, TASK-074, TASK-076, and TASK-077.

### Roadmap

Implements ROADMAP-014 Phase 3, item "Add host-server performance regression tests" — `wiki/work/roadmaps/ROADMAP-014-dashboard-performance-websockets.md`.
