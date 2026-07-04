---
id: TASK-080
title: "benchmark documentation and repeatable commands"
status: done
created: 2026-06-28
updated: 2026-06-28
depends_on: [TASK-073, TASK-074]
blocks: [TASK-083]
parallel_safe_with: [TASK-078, TASK-079]
uat: "[[UAT-080]]"
tags: [docs, benchmarks, performance, roadmap-014]
---

# TASK-080 — benchmark documentation and repeatable commands

## Objective

Document repeatable commands for measuring dashboard live-update performance before and after optimization work.

## Approach

Create concise developer documentation that ties together the baseline script, metrics endpoint, budget constants, and regression commands.

## Steps

### 1. Gather commands  <!-- agent: general-purpose -->

- [x] Read `scripts/measure-dashboard-performance.sh`, `host-server/package.json`, `frontend/package.json`, and root `package.json`.
- [x] Read `raw/research/dashboard-performance-websockets/current-baseline.md` and `wiki/knowledge/concepts/dashboard-live-update-performance-budgets.md`.

### 2. Write documentation  <!-- agent: general-purpose -->

- [x] Add `wiki/knowledge/concepts/dashboard-performance-benchmarking.md`.
- [x] Include setup, how to start the app, how to collect live metrics, how to run host-server regression checks, and how to run frontend live-update checks.
- [x] Include guidance for comparing optimized SSE and WebSocket results.

### 3. Link docs  <!-- agent: general-purpose -->

- [ ] Add references from `README.md` or `PROJECT_STATUS.md` only if those files already link similar wiki docs.
- [x] Add a log entry in `wiki/log.md`.

### 4. Verify  <!-- agent: general-purpose -->

- [x] Run markdown/link sanity checks if available.
- [x] Run `bash -n scripts/measure-dashboard-performance.sh`.

## Acceptance Criteria

- [x] Benchmark documentation exists with repeatable commands.
- [x] Documentation covers baseline, budgets, regression checks, and SSE/WebSocket comparison.
- [x] Referenced commands are valid for the current repo.

## Dependencies

Depends on TASK-073 and TASK-074.

### Roadmap

Implements ROADMAP-014 Phase 3, item "Add benchmark documentation and repeatable commands" — `wiki/work/roadmaps/ROADMAP-014-dashboard-performance-websockets.md`.
