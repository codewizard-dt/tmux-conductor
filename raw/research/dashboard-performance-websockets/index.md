---
topic: "Instrument and reduce dashboard live-update capture overhead then implement websockets -- improve performance across the board and create some performance tests"
slug: dashboard-performance-websockets
researched: 2026-06-28
sources: [./sources.md]
---

# Research: Dashboard Performance + WebSockets Roadmap

> This roadmap should start with measurement, not WebSockets. Prior research found WebSockets are compatible but not the primary fix: the hot path is synchronous tmux capture work and multiple event clients. The execution plan should baseline current behavior, reduce capture and SSE fanout overhead, add repeatable performance tests that fail on regressions, and then implement a narrow WebSocket terminal channel for the focused interactive path.

## Research Questions

- What should be measured before changing the transport?
- Which current code paths are most likely to create live-update overhead?
- What testing layer can catch regressions without requiring a full agent session?
- Where do WebSockets fit after capture and SSE cleanup?

## Current State (Codebase)

The current dashboard has three recurring server loops relevant to live updates: status polling every 2s, unfocused terminal tail polling every 2s, and focused terminal tail polling every 200ms. Focused terminal captures request 500 lines and use raw tmux capture with cursor metadata [S1, S2].

The frontend has a shared SSE hook for terminal events, but `useAgents.ts` and `AgentList.tsx` still create their own `EventSource` instances. This means common dashboard views can hold multiple `/events` streams and increase broadcast fanout [S3].

`TASK-012` previously moved terminal output from client polling to server-side SSE push, which reduces repeated HTTP tail requests but centralizes recurring tmux capture work in the host-server [S4].

The prior WebSocket research concluded that Fastify/Vite are compatible with WebSockets, but a transport swap alone will not remove capture cost. Its recommended sequence was instrumentation, EventSource consolidation, capture pressure reduction, then a focused WebSocket terminal channel if needed [S5].

## Key Findings

### F1 — Performance instrumentation can be implemented with Node stdlib

Node's `perf_hooks` supports `performance.mark()`, `performance.measure()`, `PerformanceObserver`, and `timerify()` for measuring function duration [S6]. This is enough to add low-dependency timing around capture loops and broadcast fanout before introducing a benchmark dependency.

### F2 — Tests should isolate capture/fanout behavior before full UI E2E

The most useful early tests are host-server-level regression tests around timing counters, loop behavior, and event-client consolidation. Full browser E2E can follow, but it is expensive and brittle if the test suite first needs real tmux agents producing output. A useful first target is mockable capture functions plus a synthetic SSE/WebSocket client harness. *(Inference from codebase shape; no current test framework exists in `host-server/package.json`.)*

### F3 — WebSockets should be sequenced after optimization gates

A focused WebSocket terminal route is valuable only after the baseline can show whether capture/fanout work is under control. Otherwise, WebSockets risk hiding the symptom while the host-server still blocks on synchronous `tmux` calls. The WebSocket phase should have a performance acceptance gate comparing focused terminal latency, server loop duration, and connection count before/after [S5].

## Constraints

- Do not replace all `/api/events` state updates with WebSockets by default; SSE matches one-way dashboard state [S5].
- Keep plain capture for status regex paths and raw ANSI capture for display paths separate [S2].
- Add tests before or alongside optimization so performance changes are measurable and protected.
- The roadmap should create task-sized placeholders only; implementation details belong in downstream tasks.

## Recommendation

Create a four-phase roadmap:

| Phase | Purpose |
|---|---|
| Baseline | Add timing, counters, and a reproducible benchmark scenario for current dashboard live updates. |
| Optimize | Consolidate EventSource clients and reduce/adapt capture work while preserving current SSE behavior. |
| Guardrails | Add automated performance tests for capture loops, event fanout, and focused terminal latency. |
| WebSocket | Implement a focused bidirectional terminal WebSocket and compare it against the optimized SSE path. |

The first tasks should not be WebSocket implementation tasks. They should define metrics and produce a baseline report so subsequent work has a pass/fail target.

## Next Steps

- Create a roadmap with inline placeholders for the four phases above.
- Use `roadmap-next` to turn the first inline item into a task for instrumentation and baseline measurement.
- Consider a later decision record if the team wants to formally commit to "SSE for dashboard state, WebSocket for focused terminal input/output."
