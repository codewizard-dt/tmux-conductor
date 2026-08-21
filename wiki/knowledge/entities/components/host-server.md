---
id: host-server
title: Host Server
aliases: [host-server, host-server/index.ts]
updated: 2026-08-15
sources:
  - ../../../raw/research/application-latency-structure/index.md
  - ../../../raw/research/application-latency-structure/index-2.md
  - ../../../raw/research/context-window-accuracy/index.md
tags: [backend, component, fastify, tmux]
---

# Host Server

`host-server/` is the local Fastify backend for tmux-conductor. It owns the dashboard API, SSE live-update stream, focused terminal WebSocket route, SQLite data access, tmux capture/input calls, and periodic status/tail/schedule/context loops.

The latency research identifies this component as the main optimization boundary because synchronous tmux subprocesses share the Node event loop with HTTP, SSE, and WebSocket traffic. The host server already exposes `/api/perf/live-updates`, but should add event-loop delay/utilization, tmux operation-level metrics, WebSocket lifecycle metrics, and structured request logs to make terminal stalls diagnosable.

For agent status, the host-server owns the detection contract. `/api/status` and `agent-update` SSE payloads include the legacy `state` plus a structured `status` object with display state, reason, needs-attention flag, active task, and evidence from tmux liveness and state files. Frontend components should render from that object instead of recreating detection semantics.

`context.ts`'s `modelContextLimit()` is a known-stale, family-substring model→context-window map (only special-cases `"opus"` → 1M) — it currently misclassifies Sonnet 5 as 200k when it is actually 1M. See `relates_to::[[context-window-accuracy]]` for the root cause and recommended exact-model-ID fix.

uses::[[Fastify]]
relates_to::[[Focused Terminal Transport]]
relates_to::[[Local Observability]]
relates_to::[[Agent State Determination]]
relates_to::[[context-window-accuracy]]
