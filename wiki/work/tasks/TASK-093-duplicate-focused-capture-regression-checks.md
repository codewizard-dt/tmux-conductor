---
id: TASK-093
title: "duplicate focused-capture regression checks"
status: done
created: 2026-07-04
updated: 2026-07-04
depends_on: [TASK-085, TASK-086, TASK-088, TASK-089, TASK-090]
blocks: []
parallel_safe_with: [TASK-094]
uat: "[[UAT-093]]"
tags: [tests, performance, terminal, roadmap-015]
---

# TASK-093 — duplicate focused-capture regression checks

## Objective

Add regression checks that fail if focused WebSocket and focused SSE capture paths run concurrently for the same focused pane.

## Approach

Extend the existing performance guardrails to assert the ownership contract. Prefer static checks plus lightweight unit/integration-style checks that do not require a long-running live tmux session.

## Steps

### 1. Inspect existing guardrails  <!-- agent: general-purpose -->

- [x] Inspect `scripts/test-host-performance.mjs`.
- [x] Inspect package scripts for host-server performance checks.
- [x] Inspect current metrics names in `host-server/index.ts`.

### 2. Add duplicate-capture checks  <!-- agent: general-purpose -->

- [x] Add a static or runtime check proving focused SSE capture is skipped when WebSocket owns a focused agent.
- [x] Assert metrics expose enough owner-specific data to detect duplicate focused capture.
- [x] Wire the check into the existing performance test script or package script.

### 3. Verify  <!-- agent: general-purpose -->

- [x] Run the performance guardrail command.
- [x] Run host-server typecheck if the checks import TypeScript-visible symbols.

## Acceptance Criteria

- [x] A regression check fails on duplicate focused SSE plus focused WebSocket capture ownership.
- [x] The check is wired into existing host performance verification.
- [x] Performance guardrail verification passes.

## Dependencies

- **DEPENDS ON [TASK-085](TASK-085-focused-transport-ownership-criteria.md)**.
- **DEPENDS ON [TASK-086](TASK-086-focused-websocket-exclusive-path.md)**.
- **DEPENDS ON [TASK-088](TASK-088-coalesce-focused-websocket-output.md)**.
- **DEPENDS ON [TASK-089](TASK-089-live-update-runtime-knobs.md)**.
- **DEPENDS ON [TASK-090](TASK-090-tune-focused-capture-defaults.md)**.

### Roadmap

Implements ROADMAP-015 Phase 5, item "Add duplicate focused-capture regression checks" — `wiki/work/roadmaps/ROADMAP-015-latency-improvements.md`.
