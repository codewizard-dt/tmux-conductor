---
id: TASK-097
title: "focused terminal WebSocket exclusive output and input path"
status: done
created: 2026-07-04
updated: 2026-07-04
depends_on: [TASK-095, TASK-096]
blocks: [TASK-099, TASK-101, TASK-103, TASK-104, TASK-105]
parallel_safe_with: [TASK-098, TASK-102]
uat: "[[UAT-097]]"
tags: [frontend, host-server, websocket, terminal, roadmap-015]
---

# TASK-097 — focused terminal WebSocket exclusive output and input path

## Objective

Make the focused terminal WebSocket the exclusive focused output and direct-input path whenever it is connected, while preserving SSE/REST fallback when WebSocket is unavailable.

## Approach

Move focused ownership into one explicit client state. `LogTail` should not subscribe to `terminal-output-focus` while the focused WebSocket is connected. Direct terminal text/keys should use the WebSocket send path while available and fall back to the REST key endpoint only after WebSocket failure. The backend should avoid running the focused SSE capture loop for panes with active focused WebSocket clients.

## Steps

### 1. Inspect current focused paths  <!-- agent: general-purpose -->

- [x] Inspect `frontend/src/components/LogTail.tsx` focused EventSource subscription and `connectTerminalWebSocket()` usage.
- [x] Inspect `frontend/src/lib/terminalWebSocket.ts`.
- [x] Inspect `host-server/index.ts` focused client registry, focused SSE loop, and terminal WebSocket route.

### 2. Make client ownership explicit  <!-- agent: general-purpose -->

- [x] In `LogTail.tsx`, track focused WebSocket connection state separately from fallback state.
- [x] Suppress `terminal-output-focus` handling while the focused WebSocket is connected.
- [x] Route direct text and key input through the WebSocket when connected.
- [x] Keep REST/SSE fallback behavior when WebSocket connection fails, closes, or is not focused.

### 3. Make backend capture ownership explicit  <!-- agent: general-purpose -->

- [x] In `host-server/index.ts`, track active WebSocket-focused agents.
- [x] Skip focused SSE capture/broadcast for agents currently owned by focused WebSocket clients.
- [x] Keep normal unfocused terminal events and status SSE unchanged.

### 4. Verify  <!-- agent: general-purpose -->

- [x] Run host-server and frontend typechecks.
- [x] Confirm fallback paths still compile and are reachable.

## Acceptance Criteria

- [x] Focused WebSocket-connected terminals do not also consume focused SSE output.
- [x] Focused WebSocket-connected agents do not run duplicate focused SSE capture for the same pane.
- [x] Focused direct input uses WebSocket while connected and falls back cleanly otherwise.
- [x] Host-server and frontend typechecks pass.

## Dependencies

- **DEPENDS ON [TASK-095](TASK-095-focused-terminal-latency-baseline.md)** — baseline should be captured first.
- **DEPENDS ON [TASK-096](TASK-096-focused-transport-ownership-criteria.md)** — ownership contract must be defined first.

### Roadmap

Implements ROADMAP-015 Phase 2, item "Make focused terminal WebSocket the exclusive focused output/input path" — `wiki/work/roadmaps/ROADMAP-015-latency-improvements.md`.

### Renumbering note

Originally filed as `TASK-086`. Renumbered to `TASK-097` on 2026-07-06 to resolve an ID collision with an unrelated ROADMAP-016 task that was independently assigned the same number the same day. See `wiki/log.md` for the full renumbering record.
