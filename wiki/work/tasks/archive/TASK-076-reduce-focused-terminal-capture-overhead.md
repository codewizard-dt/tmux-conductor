---
id: TASK-076
title: "reduce focused terminal capture overhead"
status: done
created: 2026-06-28
updated: 2026-06-28
depends_on: [TASK-072, TASK-073]
blocks: [TASK-077, TASK-078, TASK-083]
parallel_safe_with: [TASK-075]
uat: "[[UAT-076]]"
tags: [terminal, tmux, performance, roadmap-014]
---

# TASK-076 — reduce focused terminal capture overhead

## Objective

Reduce the cost of focused terminal updates while preserving the full xterm.js mirror behavior users expect in the agent detail modal.

## Approach

Tune the focused capture loop in `host-server/index.ts` and related capture helpers in `host-server/state.ts`. Prefer avoiding unchanged broadcasts and unnecessary deep captures over changing terminal semantics.

## Steps

### 1. Inspect focused terminal path  <!-- agent: general-purpose -->

- [x] Read `host-server/index.ts` around focused agent registration and `terminal-output-focus` broadcasting.
- [x] Read `host-server/state.ts` functions `capturePaneTailRaw` and related tmux helpers.
- [x] Read `frontend/src/components/LogTail.tsx` focused subscription behavior.

### 2. Avoid redundant work  <!-- agent: general-purpose -->

- [x] Add per-agent last snapshot tracking for focused terminal output in the host server.
- [x] Only broadcast focused terminal output when text changes or when a focused client first subscribes.
- [x] Ensure cleanup happens when focus is removed.

### 3. Tune capture parameters  <!-- agent: general-purpose -->

- [x] Review `TAIL_LINES_FOCUS` and loop interval constants in `host-server/index.ts`.
- [x] Adjust constants only if baseline evidence supports it, and document the choice in comments.
- [x] Preserve cursor-position escape behavior from `capturePaneTailRaw`.

### 4. Verify  <!-- agent: general-purpose -->

- [x] Run `npm --prefix host-server run typecheck`.
- [x] Run `npm --prefix frontend run typecheck`.

## Acceptance Criteria

- [x] Focused terminal broadcasts are suppressed when the focused pane snapshot is unchanged.
- [x] Opening and closing a focused terminal does not leak per-agent cache state.
- [x] Focused terminal display and direct input behavior remain intact.
- [x] Host-server and frontend typechecks pass.

## Dependencies

Depends on TASK-072 and TASK-073.

### Roadmap

Implements ROADMAP-014 Phase 2, item "Reduce focused terminal capture overhead" — `wiki/work/roadmaps/ROADMAP-014-dashboard-performance-websockets.md`.
