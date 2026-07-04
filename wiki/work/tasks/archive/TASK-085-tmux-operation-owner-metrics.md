---
id: TASK-085
title: "add tmux operation metrics with owner labels"
status: done
created: 2026-07-04
updated: 2026-07-04
depends_on: []
blocks: []
parallel_safe_with: [TASK-084, TASK-086, TASK-087, TASK-088, TASK-089, TASK-090, TASK-091, TASK-092, TASK-093]
uat: "[[UAT-085]]"
tags: [observability, tmux, metrics, roadmap-016]
---

# TASK-085 — add tmux operation metrics with owner labels

## Objective

Make synchronous tmux work attributable to the backend owner that triggered it.

## Approach

Extend the existing capture timing wrappers in `host-server/index.ts` with `owner:operation` metrics and timeout/error counters.

## Steps

- [x] Add `tmuxOperations` metrics to the live-update metrics object.
- [x] Label capture owners such as `status`, `snapshot`, `terminal-loop`, `terminal-ws`, and `focused-terminal-loop`.
- [x] Label direct input tmux sends as `direct-input`.

## Acceptance Criteria

- [x] `/api/perf/live-updates` includes tmux operation metrics by owner.
- [x] `scripts/measure-dashboard-performance.sh` reports the tmux operation table.

## Verification

- [x] `npm --prefix host-server run typecheck`
- [x] `npm --prefix host-server run perf:test`
- [x] `bash -n scripts/measure-dashboard-performance.sh`

### Roadmap

Implements ROADMAP-016 Phase 1 item "Add tmux operation metrics with owner labels".
