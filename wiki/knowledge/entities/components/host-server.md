---
id: host-server
title: Host Server
aliases: [host-server, host-server/index.ts]
updated: 2026-07-04
sources:
  - ../../../raw/research/application-latency-structure/index.md
  - ../../../raw/research/application-latency-structure/index-2.md
tags: [backend, component, fastify, tmux]
---

# Host Server

`host-server/` is the local Fastify backend for tmux-conductor. It owns the dashboard API, SSE live-update stream, focused terminal WebSocket route, SQLite data access, tmux capture/input calls, and periodic status/tail/schedule/context loops.

The latency research identifies this component as the main optimization boundary because synchronous tmux subprocesses share the Node event loop with HTTP, SSE, and WebSocket traffic. The host server already exposes `/api/perf/live-updates`, but should add event-loop delay/utilization, tmux operation-level metrics, WebSocket lifecycle metrics, and structured request logs to make terminal stalls diagnosable.

For agent status, the host-server owns the detection contract. `/api/status` and `agent-update` SSE payloads include the legacy `state` plus a structured `status` object with display state, reason, needs-attention flag, active task, and evidence from tmux liveness and state files. Frontend components should render from that object instead of recreating detection semantics.

uses::[[Fastify]]
relates_to::[[Focused Terminal Transport]]
relates_to::[[Local Observability]]
relates_to::[[Agent State Determination]]
