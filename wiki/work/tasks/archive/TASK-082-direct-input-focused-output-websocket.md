---
id: TASK-082
aliases: [TASK-082]
title: "move direct input and focused output onto WebSocket path"
status: done
created: 2026-06-28
updated: 2026-06-28
depends_on: [TASK-081]
blocks: [TASK-083]
parallel_safe_with: []
uat: "[[UAT-082]]"
tags: [websocket, terminal, frontend, roadmap-014]
---

# TASK-082 — move direct input and focused output onto WebSocket path

## Objective

Use the focused terminal WebSocket transport for direct terminal input and focused output in the dashboard, while keeping REST/SSE fallback behavior.

## Approach

Update `frontend/src/components/LogTail.tsx` to prefer the WebSocket helper from TASK-081 when `focused` and `interacting` are true. Keep existing `/agents/:agent/keys`, `/agents/:agent/text`, and focused SSE behavior as fallback.

## Steps

### 1. Inspect terminal component  <!-- agent: general-purpose -->

- [x] Read `frontend/src/components/LogTail.tsx`, `frontend/src/lib/api.ts`, and the WebSocket helper from TASK-081.
- [x] Identify key, text, paste, and focused-output paths.

### 2. Wire WebSocket output  <!-- agent: general-purpose -->

- [x] Subscribe focused terminal rendering to WebSocket output messages when connected.
- [x] Fall back to `terminal-output-focus` SSE when WebSocket connection fails or closes unexpectedly.
- [x] Preserve initial `/agents/:agent/tail` behavior if needed for first paint.

### 3. Wire WebSocket input  <!-- agent: general-purpose -->

- [x] Send key and text input over the WebSocket when connected.
- [x] Fall back to existing REST calls from `frontend/src/lib/api.ts` when not connected.
- [x] Preserve image/file drop behavior unless the WebSocket route explicitly supports it.

### 4. Verify  <!-- agent: general-purpose -->

- [x] Run `npm --prefix frontend run typecheck`.
- [x] Run `npm --prefix frontend run lint`.
- [x] Run `npm --prefix host-server run typecheck`.

## Acceptance Criteria

- [x] Focused terminal output uses WebSocket when connected.
- [x] Direct input uses WebSocket when connected.
- [x] REST/SSE fallbacks remain available and tested manually or through UAT.
- [x] Frontend and host-server typechecks pass.

## Dependencies

Depends on TASK-081.

### Roadmap

Implements ROADMAP-014 Phase 4, item "Move direct input and focused output onto the WebSocket path" — `wiki/work/roadmaps/ROADMAP-014-dashboard-performance-websockets.md`.
