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
