---
title: "Optimized SSE vs Focused WebSocket Comparison"
date: 2026-06-28
source_task: TASK-083
---

# Optimized SSE vs Focused WebSocket Comparison

## Commands

```bash
HOST_URL=http://localhost:8788/api DURATION_SECONDS=30 bash scripts/measure-dashboard-performance.sh
npm --prefix host-server run perf:test
npm run check:frontend-live-updates
npm --prefix host-server run typecheck
npm --prefix frontend run typecheck
```

## Current Evidence

| Area | Optimized SSE | Focused WebSocket |
|---|---|---|
| Dashboard state transport | Shared EventSource via `useSSEEvent` | Not used for general dashboard state |
| Focused terminal output | Fallback path via `terminal-output-focus` | Primary focused path via `/api/agents/:id/terminal/ws` |
| Direct input | REST fallback via `/agents/:id/keys` | Primary focused path via WebSocket input messages |
| Capture suppression | Changed snapshots only | Changed snapshots only |
| Static gates | Passing | Passing |

## Result

The optimized SSE path remains the right default for one-way dashboard state. The focused WebSocket path is now available for the interactive terminal path, where bidirectional input/output avoids pairing REST input calls with SSE output events.

Representative latency numbers were not captured in this automation run because no controlled live focused-agent session was kept open. Before making WebSocket the only focused terminal path, run the measurement command above twice under the same agent/session conditions:

1. WebSocket disconnected or disabled, using optimized SSE fallback.
2. WebSocket connected, using focused terminal WebSocket output and input.

## Recommendation

Keep SSE as the dashboard state transport and keep WebSocket scoped to focused terminal interaction. Preserve REST/SSE fallback until a repeated live benchmark shows the WebSocket path is stable across local workloads.
