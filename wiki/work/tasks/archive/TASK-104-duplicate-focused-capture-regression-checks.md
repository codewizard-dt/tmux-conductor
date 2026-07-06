---
id: TASK-104
title: "duplicate focused-capture regression checks"
status: done
created: 2026-07-04
updated: 2026-07-04
depends_on: [TASK-096, TASK-097, TASK-099, TASK-100, TASK-101]
blocks: []
parallel_safe_with: [TASK-105]
uat: "[[UAT-104]]"
tags: [tests, performance, terminal, roadmap-015]
---

# TASK-104 — duplicate focused-capture regression checks

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

- **DEPENDS ON [TASK-096](TASK-096-focused-transport-ownership-criteria.md)**.
- **DEPENDS ON [TASK-097](TASK-097-focused-websocket-exclusive-path.md)**.
- **DEPENDS ON [TASK-099](TASK-099-coalesce-focused-websocket-output.md)**.
- **DEPENDS ON [TASK-100](TASK-100-live-update-runtime-knobs.md)**.
- **DEPENDS ON [TASK-101](TASK-101-tune-focused-capture-defaults.md)**.

### Roadmap

Implements ROADMAP-015 Phase 5, item "Add duplicate focused-capture regression checks" — `wiki/work/roadmaps/ROADMAP-015-latency-improvements.md`.

### Renumbering note

Originally filed as `TASK-093`. Renumbered to `TASK-104` on 2026-07-06 to resolve an ID collision with an unrelated ROADMAP-016 task ("extend performance scripts and metric threshold docs") that was independently assigned the same number the same day. See `wiki/log.md` for the full renumbering record.
