---
id: application-latency-observability-addendum
title: Application Latency Observability Addendum
aliases: [Application Latency Observability]
updated: 2026-07-04
sources:
  - ../../raw/research/application-latency-structure/index-2.md
tags: [observability, performance, latency, terminal]
---

# Application Latency Observability Addendum

This source extends the latency assessment with observability-specific findings. It says the app currently has useful but narrow in-memory metrics at `/api/perf/live-updates`, plus JSONL dispatch and hook logs. What is missing is the evidence needed to explain the reported terminal stall: event-loop delay, tmux operation duration/error/timeout metrics, WebSocket lifecycle counters, input-to-ack latency, input-to-echo latency, and focused-terminal transport state.

The recommended first move is **not full OpenTelemetry**. The addendum recommends extending the current local metrics and JSONL approach first, then enabling env-gated Fastify/Pino structured request logs. OpenTelemetry can wait until local metrics prove insufficient.

The addendum also recommends a hidden focused-terminal debug overlay or diagnostic bundle showing WebSocket state, last input id/time, backend ack time, last output frame time, xterm repaint time, EventSource fallback state, and current direct-input focus state.

relates_to::[[Local Observability]]
relates_to::[[Focused Terminal Transport]]
relates_to::[[Dashboard Performance Benchmarking]]
relates_to::[[Agent State Determination]]
