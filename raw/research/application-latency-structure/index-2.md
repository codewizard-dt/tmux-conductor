---
topic: "Observability addendum for application latency structure assessment"
slug: application-latency-structure
researched: 2026-07-04
sources: [./sources-2.md]
builds_on: [./index.md]
---

# Research Update: Observability Improvements

> Builds on [index.md](index.md). This update covers observability only: what the app can already see, what it cannot see, and what to add so latency, terminal input stalls, duplicate capture, and agent-state confusion become diagnosable instead of anecdotal.

## Research Questions

- What observability exists today across host-server, monitor scripts, hooks, frontend, and terminal transport?
- Which missing signals would explain "terminal input appears stuck until reopen"?
- What low-overhead metrics/logging should be added before larger transport or state refactors?
- Should the project use ad hoc metrics, Fastify structured logging, or OpenTelemetry?

## Current State (Codebase)

The host-server has a single in-memory metrics surface at `GET /api/perf/live-updates`. It tracks active SSE connections, SSE opens/closes, broadcast counts by event, and timing summaries for status ticks, terminal ticks, focused terminal ticks, tmux capture calls, SSE broadcasts, and tail requests [S1].

The current performance guard is static: `scripts/test-host-performance.mjs` checks that the metric names and timed loop hooks exist, not that runtime latency stays below a measured threshold [S2].

Fastify request logging is disabled via `Fastify({ logger: false })`; most host-server logs are plain `console.log`, `console.warn`, and `console.error` statements without request ids or structured fields [S3].

The shell monitor writes timestamped text logs plus `dispatch.jsonl` records. Dispatch records include agent, command, state, state age, detection source, queue metadata, and pane tail [S4].

Claude hooks append `hooks.jsonl` records with timestamp, agent, event, previous state, and new state. Hook logging is best-effort and intentionally never breaks the agent [S5].

Background-process windows use `tmux pipe-pane` to append output to `bg-<name>.log`, and the dashboard surfaces log paths/state paths for background processes [S6].

There is no durable metrics history, no request/response latency logging, no event-loop delay metric, no WebSocket connection/input/output counters, no tmux command error/timeout counter, and no correlation id tying a browser keypress to WebSocket receipt, `tmux send-keys`, next capture, and xterm repaint. These are inferences from the inspected code and existing metrics list [S1, S3].

## Key Findings

### F1 - The most important missing metric is event-loop delay

The main report identified synchronous tmux subprocesses as the likely source of UI stalls. Node exposes `monitorEventLoopDelay()` and `eventLoopUtilization()` in `perf_hooks`, including an example showing blocking `spawnSync` reflected in utilization [S7]. Add these to `/api/perf/live-updates` so every latency investigation can answer: "was Node blocked while input appeared stuck?"

Recommended fields:

- `eventLoopDelayMs.p50`
- `eventLoopDelayMs.p95`
- `eventLoopDelayMs.p99`
- `eventLoopDelayMs.max`
- `eventLoopUtilization.utilization`
- `eventLoopUtilization.activeMs`
- `eventLoopUtilization.idleMs`

### F2 - Add tmux operation-level metrics, not just aggregate capture metrics

The current metrics count `tmuxCaptureTail` and `tmuxCaptureTailRaw`, but they do not identify timeout/error rate, target agent, command type, or duplicate owner. Add a small wrapper around all tmux calls with:

- operation: `capture-plain`, `capture-raw`, `display-message`, `send-keys`, `set-buffer`, `paste-buffer`, `list-windows`, `has-session`
- agent/window
- duration
- status code
- timeout/error flag
- output bytes for capture paths
- caller/owner: `status-loop`, `tail-loop`, `focused-sse-loop`, `focused-ws-loop`, `direct-input`, `mode-switch`

This directly exposes duplicate focused capture and input send delays.

### F3 - Add WebSocket lifecycle and input latency metrics

The WebSocket path currently sends output and input but does not publish metrics beyond indirect capture counts. Add:

- `activeTerminalWsConnections`
- `terminalWsConnections.opened/closed/error`
- `terminalWsMessages.input/output/ack/error`
- `terminalWsOutput.bytes`
- `terminalWsBufferedAmount.max`
- `terminalWsInputLatencyMs`: time from browser send timestamp to backend ack
- `terminalEchoLatencyMs`: time from backend input receipt to first changed output snapshot after input

The browser can include a `clientMessageId` and `clientSentAt` in input frames. The backend can echo those in `ack` and in the first output frame after the input.

### F4 - Enable Fastify structured request logging in development and perf runs

Fastify uses Pino and can emit structured request/response logs with request ids, status codes, and response times [S8]. The project currently disables this [S3]. A practical change is an env-gated logger:

- `HOST_LOG_LEVEL=info|debug|silent`
- redact request bodies by default
- disable request logging for `/api/healthz` and optionally `/api/perf/live-updates`
- include request id in explicit route logs

This should replace ad hoc `console.*` for route failures, slow loops, WebSocket close reasons, and tmux timeouts.

### F5 - Add a focused-terminal debug overlay or downloadable trace

For the specific "input appears stuck" report, the UI should be able to show or export a short trace:

- focused agent id/name
- WebSocket state and reconnect count
- active transport: `ws` or `rest+sse-fallback`
- last input message id/time
- last backend ack time
- last output frame time
- last xterm repaint time
- last EventSource event time
- current focus/interacting state
- whether fallback SSE is active

This does not need to be visible by default. A `?debugTerminal=1` flag or keyboard shortcut can reveal it.

### F6 - Persist a rolling metrics snapshot for post-incident analysis

`/api/perf/live-updates` is in-memory and point-in-time [S1]. Add a repo-local rolling JSONL file, for example `logs/perf-live-updates.jsonl`, sampled every 5-10 seconds and on slow-loop warnings. Keep the last N MB or rotate daily. Capture:

- live-update metrics summary
- event-loop delay/utilization
- active agents/focused agents/WebSocket connections/SSE connections
- tmux timeout/error counts
- slow loop names and durations

This gives evidence after a stall has already happened.

### F7 - Observability should include state-transition evidence

Agent status confusion is a UX issue and a latency issue: users wait or interact based on whether the dashboard says `busy`, `awaiting`, `stalled`, or `idle`. Add an `agent-status-transition` JSONL stream or structured log fields:

- agent id/window
- previous status/current status
- reason: `state-file`, `busy-recovered`, `awaiting-pattern`, `pane-dead`, `regex-fallback`, `inventory-timeout`
- state file age
- pattern profile: `claude`, `codex`, `custom`
- whether a pane capture was needed
- detection duration

This can later feed the simplified backend-owned status contract recommended in the main report.

## Constraints

- The app is local-first, so observability should be useful without requiring hosted infrastructure.
- Metrics must not add meaningful overhead to the already hot tmux paths.
- Logs may contain prompts, pane tails, paths, model/session metadata, and task commands. Keep sensitive fields opt-in or redacted; do not add broad request body logging.
- `raw/` files are immutable after creation; this is an additive `index-2.md` update rather than an edit to the prior report.

## Solution Comparison

| Criteria | Extend Current Metrics + JSONL | Fastify Pino Structured Logs | OpenTelemetry |
|---|---|---|---|
| Approach | Add event-loop, tmux, WebSocket, and status metrics to `/api/perf/live-updates` and rotating JSONL. | Enable Fastify logger with request ids and response times; migrate `console.*` to structured logs. | Instrument traces/metrics with OTEL SDK/exporters. |
| Pros | Lowest overhead; immediately useful; fits existing local workflow. | Built-in framework support; improves route/error correlation. | Standard ecosystem; can export to Jaeger/Tempo/Prometheus later. |
| Cons | Custom schema; no distributed traces. | Request logs alone do not explain tmux/event-loop stalls. | More dependencies and setup; likely too heavy before basic signals exist. |
| Complexity | Low/Medium | Low | Medium/High |
| Codebase fit | Strong | Strong | Later-stage fit |
| Recommendation | Do first | Do first, env-gated | Defer until local metrics prove insufficient |

## Recommendation

Implement observability in three stages:

1. **Immediate low-risk metrics:** event-loop delay/utilization, active terminal WebSocket count, WebSocket input/output/ack counters, tmux timeout/error counts, and focused capture owner labels.
2. **Structured logs and traces for incidents:** enable env-gated Fastify/Pino logging; add JSONL records for WebSocket lifecycle, direct input, focused output snapshot sends, slow loops, tmux timeouts, and status transitions.
3. **Developer-facing diagnosis:** add a hidden terminal debug overlay plus a command/script that captures `/api/perf/live-updates`, recent `perf-live-updates.jsonl`, recent `dispatch.jsonl`, recent `hooks.jsonl`, and host-server version/config knobs into one local diagnostic bundle.

Defer full OpenTelemetry until the local metrics answer whether the remaining bottleneck is event-loop blocking, tmux subprocess duration, WebSocket proxy/fallback behavior, React effect churn, or state detection.

## Next Steps

- To create a task: `/task-add Add event-loop, tmux operation, WebSocket, and focused-terminal observability metrics`
- To create a task: `/task-add Enable env-gated Fastify structured request logging and replace host-server console logs`
- To create a task: `/task-add Add focused terminal debug overlay and diagnostic bundle command`
