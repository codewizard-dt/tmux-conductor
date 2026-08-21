---
id: TASK-090
aliases: [TASK-090]
title: "add slow-loop and tmux-timeout JSONL records"
status: done
created: 2026-07-04
updated: 2026-07-04
depends_on: []
blocks: []
parallel_safe_with: [TASK-084, TASK-085, TASK-086, TASK-087, TASK-088, TASK-089, TASK-091, TASK-092, TASK-093]
uat: "[[UAT-090]]"
tags: [observability, logging, tmux, roadmap-016]
---

# TASK-090 — add slow-loop and tmux-timeout JSONL records

## Objective

Record backend loop stalls and tmux timeouts in a local structured log.

## Approach

Extend `startManagedLoop()` slow-loop warnings and tmux timing wrappers to append `slow_loop` and `tmux_timeout` records to `logs/observability.jsonl`.

## Steps

- [x] Append `slow_loop` records with loop name, elapsed time, threshold, and next delay.
- [x] Append `tmux_timeout` records with operation, owner, and duration.
- [x] Include these records in static host performance guardrails.

## Acceptance Criteria

- [x] Slow-loop and tmux-timeout hooks are present in `host-server/index.ts`.
- [x] `scripts/test-host-performance.mjs` asserts the observability hooks remain wired.

## Verification

- [x] `npm --prefix host-server run typecheck`
- [x] `npm --prefix host-server run lint`
- [x] `npm --prefix host-server run perf:test`

### Roadmap

Implements ROADMAP-016 Phase 3 item "Add slow-loop and tmux-timeout JSONL records".
