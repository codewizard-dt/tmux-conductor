---
id: dashboard-performance-benchmarking
title: Dashboard Performance Benchmarking
aliases: [Dashboard Benchmarking]
updated: 2026-07-04
sources:
  - ../../raw/research/dashboard-performance-websockets/current-baseline.md
  - ../../raw/research/dashboard-performance-websockets/sse-vs-websocket-comparison.md
  - ../../raw/research/application-latency-structure/index.md
  - ../../raw/research/application-latency-structure/index-2.md
tags: [dashboard, performance, benchmarking]
---

# Dashboard Performance Benchmarking

Source tasks: [[TASK-073]], [[TASK-078]], [[TASK-079]], [[TASK-080]]

## Start the App

```bash
npm run dev
```

The host server defaults to `http://localhost:8788/api`.

## Capture Live Metrics

```bash
HOST_URL=http://localhost:8788/api DURATION_SECONDS=30 bash scripts/measure-dashboard-performance.sh
```

Run once with no focused terminal and once with an agent detail terminal focused. Record agent count, open browser tabs, and terminal dimensions with the output.

## Run Guardrails

```bash
npm --prefix host-server run perf:test
npm run check:frontend-live-updates
npm --prefix host-server run typecheck
npm --prefix frontend run typecheck
```

## Compare SSE and WebSocket

Use the same agent/session for both measurements. First measure optimized SSE with the WebSocket client disconnected or disabled, then measure the focused WebSocket path. Compare:

- active SSE connections
- focused terminal tick count and max duration
- raw capture count
- message or broadcast count
- observed input echo latency

Store the final comparison in `raw/research/dashboard-performance-websockets/sse-vs-websocket-comparison.md`.

Current comparison artifact: `raw/research/dashboard-performance-websockets/sse-vs-websocket-comparison.md`.

## 2026-07 Latency Research Update

Future benchmark runs should explicitly record whether focused terminal output is WebSocket-owned or SSE-owned. The comparison should include event-loop delay/utilization, tmux operation counts by owner (`status-loop`, `focused-ws-loop`, `focused-sse-loop`, `direct-input`), WebSocket buffered amount, input-to-ack latency, and input-to-echo latency.

The observability addendum recommends persisting rolling local metrics so a stall can be diagnosed after it happens, not only during an active benchmark window.

relates_to::[[Focused Terminal Transport]]
relates_to::[[Local Observability]]
relates_to::[[Agent State Determination]]
