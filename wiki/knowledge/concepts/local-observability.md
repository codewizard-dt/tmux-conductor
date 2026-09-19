---
id: local-observability
title: Local Observability
aliases: [Local Metrics, Observability]
updated: 2026-09-13
sources:
  - ../../raw/research/application-latency-structure/index-2.md
  - ../../raw/research/transition-observability/index.md
tags: [observability, metrics, logging, performance]
---

# Local Observability

tmux-conductor is local-first, so observability should work without hosted infrastructure. The current useful surfaces are `/api/perf/live-updates`, monitor `dispatch.jsonl`, hook `hooks.jsonl`, background-process logs, and static performance guardrails. The missing signals are the ones that explain perceived terminal freezes: event-loop delay/utilization, tmux operation latency/error/timeout counts, WebSocket lifecycle counters, input latency, output frame timing, and focused transport state.

The preferred order is: extend the current in-memory metrics, persist local JSONL events for the moments that matter, enable env-gated Fastify structured request logs, and add a focused-terminal debug overlay plus a diagnostic bundle. Full OpenTelemetry is a later option, not the first step.

The key metric is event-loop delay. Since synchronous tmux subprocesses can block the Node event loop, event-loop delay and utilization are included in `/api/perf/live-updates` alongside tmux operation timings by owner, terminal WebSocket counters, input-to-ack latency, input-to-echo latency, and status-transition counts. Slow loops, tmux timeouts, terminal WebSocket lifecycle events, and agent status transitions are written to `logs/observability.jsonl`.

## Local Diagnostic Workflow

```bash
npm run diagnostics:bundle
```

The command writes a timestamped bundle under `./tmp/diagnostics/`. It captures the current `/api/perf/live-updates` payload, a markdown summary of event-loop/WebSocket/timing health, tmux session/window listings when tmux is available, and the current local JSONL logs (`observability.jsonl`, `hooks.jsonl`, `dispatch.jsonl`) when present.

Use `FASTIFY_STRUCTURED_LOGS=1` to enable Fastify's structured request logger for a debugging run. Leave it off for normal local development unless request-level traces are needed.

## Interpretation Thresholds

| Signal | Healthy local range | Investigate when |
|---|---:|---|
| Event-loop delay p95 | under 50 ms | p95 repeatedly exceeds 150 ms during idle dashboard use |
| Event-loop utilization | under 0.70 | utilization stays above 0.90 without an intentional workload |
| Focused terminal WebSocket | 0 or 1 active connection per focused terminal | active connections grow after closing modals |
| Input-to-ack latency | under 100 ms | max exceeds 250 ms without tmux timeouts |
| Input-to-echo latency | under 500 ms for interactive panes | echo is absent or repeatedly exceeds 1500 ms |
| Tmux operation timeouts | 0 | any timeout appears in `logs/observability.jsonl` |

`observability.jsonl`'s `status_transition` event (added since this page was first written) is deliberately thin — `{agentId, agent, previousState, nextState}` only, no reason/pattern/pane-text — by design it stays the perf/timing surface. A separate, dedicated `logs/transitions.jsonl` is the recommended home for the richer, occasionally-sensitive (pane-text-bearing) transition-analysis record, so it doesn't dilute this file's perf-metric focus. See [[Observability for Agent Status Transitions]].

relates_to::[[Focused Terminal Transport]]
relates_to::[[Dashboard Performance Benchmarking]]
relates_to::[[Agent State Determination]]
relates_to::[[Observability for Agent Status Transitions]]
