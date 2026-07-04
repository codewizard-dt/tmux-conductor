---
id: local-observability
title: Local Observability
aliases: [Local Metrics, Observability]
updated: 2026-07-04
sources:
  - ../../raw/research/application-latency-structure/index-2.md
tags: [observability, metrics, logging, performance]
---

# Local Observability

tmux-conductor is local-first, so observability should work without hosted infrastructure. The current useful surfaces are `/api/perf/live-updates`, monitor `dispatch.jsonl`, hook `hooks.jsonl`, background-process logs, and static performance guardrails. The missing signals are the ones that explain perceived terminal freezes: event-loop delay/utilization, tmux operation latency/error/timeout counts, WebSocket lifecycle counters, input latency, output frame timing, and focused transport state.

The preferred order is: extend the current in-memory metrics, persist a rolling local JSONL metrics snapshot, enable env-gated Fastify structured request logs, and add a focused-terminal debug overlay or diagnostic bundle. Full OpenTelemetry is a later option, not the first step.

The key metric is event-loop delay. Since synchronous tmux subprocesses can block the Node event loop, event-loop delay and utilization should be included in `/api/perf/live-updates` and sampled into a rolling `logs/perf-live-updates.jsonl` file.

relates_to::[[Focused Terminal Transport]]
relates_to::[[Dashboard Performance Benchmarking]]
relates_to::[[Agent State Determination]]
