---
id: TASK-081
aliases: [TASK-081]
title: "focused terminal WebSocket transport"
status: done
created: 2026-06-28
updated: 2026-06-28
depends_on: [TASK-072, TASK-073, TASK-074]
blocks: [TASK-082, TASK-083]
parallel_safe_with: []
uat: "[[UAT-081]]"
tags: [websocket, terminal, host-server, frontend, roadmap-014]
---

# TASK-081 — focused terminal WebSocket transport

## Objective

Add an opt-in WebSocket transport for focused terminal sessions so focused terminal output can bypass SSE when a modal is actively attached.

## Approach

Implement a narrow WebSocket route for focused terminal output and input. Keep existing SSE and REST endpoints intact as fallback until comparison proves the WebSocket path is better. Use the repo's Fastify stack and add the smallest necessary dependency if Fastify does not already support WebSockets.

## Steps

### 1. Review research and dependencies  <!-- agent: general-purpose -->

- [x] Read `raw/research/websocket-dashboard-transport/index.md` and `raw/research/dashboard-performance-websockets/index.md`.
- [x] Read `host-server/package.json` to determine whether `@fastify/websocket` is needed.
- [x] Read `host-server/index.ts` focused terminal and direct input endpoints.

### 2. Add server WebSocket endpoint  <!-- agent: general-purpose -->

- [x] Add WebSocket support to `host-server/index.ts` using the Fastify-compatible package.
- [x] Create a focused terminal route such as `/api/agents/:agent/terminal/ws`.
- [x] On connect, validate the agent, register focus, send initial terminal snapshot, then send changed snapshots using existing capture helpers.
- [x] On disconnect, unregister focus and cleanup timers/cache for that client.

### 3. Add client transport helper  <!-- agent: general-purpose -->

- [x] Add `frontend/src/lib/terminalWebSocket.ts` or equivalent.
- [x] Connect to the focused terminal WebSocket route, parse output messages, expose send methods for text and keys, and fall back cleanly on connection errors.

### 4. Verify  <!-- agent: general-purpose -->

- [x] Run `npm install` in the affected workspace if a dependency is added and commit lockfile changes.
- [x] Run `npm --prefix host-server run typecheck`.
- [x] Run `npm --prefix frontend run typecheck`.

## Acceptance Criteria

- [x] Host server exposes an authenticated-by-local-context focused terminal WebSocket endpoint.
- [x] WebSocket clients receive initial and changed focused terminal output.
- [x] Existing SSE and REST terminal paths still work.
- [x] Host-server and frontend typechecks pass.

## Dependencies

Depends on TASK-072, TASK-073, and TASK-074.

### Roadmap

Implements ROADMAP-014 Phase 4, item "Add focused terminal WebSocket transport" — `wiki/work/roadmaps/ROADMAP-014-dashboard-performance-websockets.md`.
