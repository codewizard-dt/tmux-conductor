---
topic: "Capture a representative focused-terminal latency baseline"
slug: focused-terminal-latency-baseline
researched: 2026-07-04
sources: [./sources.md]
---

# Research: Capture a representative focused-terminal latency baseline

> Capture the baseline before changing focused transport or defaults. The current focused terminal path already has overlapping delivery routes: the modal opens a focused WebSocket, also subscribes to focused SSE, and the backend polls focused panes every 200 ms with 500-line raw tmux captures. The task should produce a repeatable measurement artifact using existing `/api/perf/live-updates` server timings plus browser-side Performance marks around receipt-to-xterm repaint latency.

## Research Questions

- What current code paths deliver focused terminal output and input?
- Which existing metrics can be reused for the first baseline?
- What browser-side timing should be added to observe user-visible latency?
- What output artifact should downstream roadmap items consume?

## Current State (Codebase)

`frontend/src/components/LogTail.tsx::LogTail` fetches an initial tail from `/agents/:id/tail`, creates an xterm.js terminal, registers focus with `POST /agents/:id/focus`, opens `connectTerminalWebSocket()` when `focused` is true, and still subscribes to `terminal-output-focus` SSE. Both WebSocket and SSE payloads call `applySnapshot()` when follow mode is active [S1].

`frontend/src/lib/terminalWebSocket.ts::connectTerminalWebSocket` opens `/agents/:id/terminal/ws`, parses JSON frames, and sends direct input over the same socket when it is open [S2].

`host-server/index.ts` hard-codes focused live-update settings today: `TAIL_POLL_FOCUS_MS = 200` and `TAIL_LINES_FOCUS = 500`. The focused WebSocket route also uses a 200 ms `setInterval(sendSnapshot, TAIL_POLL_FOCUS_MS)`, while the focused SSE loop runs `tailPollLoopFocus()` on the same 200 ms cadence. Both capture the same 500-line raw pane snapshot [S3].

The host-server already exposes `/api/perf/live-updates`, backed by `liveUpdateMetrics`, with counters/timings for `focusedTerminalTicks`, `tmuxCaptureTailRaw`, `sseBroadcasts`, `tailRequests`, and connection counts [S4].

Prior dashboard-performance research explicitly recommended measurement before WebSocket-first changes, because synchronous tmux capture/fanout can remain the hot path even after a transport swap [S5].

## Key Findings

- The baseline must distinguish transport latency from capture cost. Current focused WebSocket and focused SSE both depend on the same raw tmux capture function and 200 ms polling cadence, so a WebSocket-only measurement would miss shared backend cost [S1, S3].
- Existing server metrics are sufficient for a first baseline without adding a new dependency: capture timing, focused loop timing, SSE broadcast timing, and connection counters are already available from `/api/perf/live-updates` [S4].
- Browser-side receipt-to-render latency should use `performance.now()`, `performance.mark()`, `performance.measure()`, and a `requestAnimationFrame()` boundary after `term.write()`/snapshot application. MDN documents these APIs for measuring elapsed time and named marker durations [S6].
- The output should be a durable markdown report plus raw JSON/CSV captures under `raw/research/focused-terminal-latency-baseline/`, because later roadmap items tune defaults from measured data and need a stable before snapshot. *(Inference from roadmap structure and existing raw research layout.)*

## Constraints

- Do not change transport ownership in the baseline task; ROADMAP-015 has separate later tasks for exclusive WebSocket ownership and default tuning.
- Do not rely on `/tmp` for artifacts. Repo instructions require host-side scratch/captures under `./tmp/`, while persisted research belongs under `raw/research/<slug>/`.
- Avoid `.env` reads/writes. Commands may source env variables, but no task step should inspect `.env` contents.
- Because focused WebSocket and focused SSE currently run together, the task must record both routes as observed current-state behavior, not treat one as the only source of truth.

## Recommendation

Create a task that produces a reproducible focused-terminal latency baseline with three layers:

| Layer | What to measure | Suggested source |
|---|---|---|
| Backend cost | focused loop duration, raw tmux capture duration, SSE broadcast duration, event counts, open SSE clients | `GET /api/perf/live-updates` before/during/after the run |
| Browser receipt/render | timestamp when focused WebSocket or SSE output arrives, timestamp after `applySnapshot()` completes and a `requestAnimationFrame()` has passed | temporary/debug-only browser instrumentation in `frontend/src/components/LogTail.tsx` |
| User scenario | open focused agent detail, send a small direct-input marker, observe echo/update across several runs | local conductor session with one representative agent |

The task should ask implementers to add temporary, reviewable instrumentation or a dev-only helper, capture at least 30 focused update samples, summarize median/p95/max, and write the results to `raw/research/focused-terminal-latency-baseline/`. It should not tune intervals, remove duplicate focused capture, or change WebSocket/SSE ownership.

## Next Steps

- Create `TASK-072` for the baseline capture and link it to ROADMAP-015 Phase 1.
- Later ROADMAP-015 tasks should consume the baseline report before changing focused transport, capture depth, or polling defaults.
