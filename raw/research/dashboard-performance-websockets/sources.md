---
topic: "Instrument and reduce dashboard live-update capture overhead then implement websockets -- improve performance across the board and create some performance tests"
slug: dashboard-performance-websockets
researched: 2026-06-28
---

# Primary Sources — Dashboard Performance + WebSockets Roadmap

| ID | Type | Locator | Accessed | What it contributed |
|----|------|---------|----------|---------------------|
| S1 | codebase | `host-server/index.ts` lines 114-120, 1811-1813 | 2026-06-28 | Current polling intervals and capture sizes: 2s status/tail, 200ms focused tail, 100/500 lines. |
| S2 | codebase | `host-server/state.ts` lines 51-97, 248-315 | 2026-06-28 | Plain capture and raw ANSI capture are separate; raw capture uses tmux capture plus cursor metadata. |
| S3 | codebase | `frontend/src/hooks/useSSE.ts`, `frontend/src/lib/useAgents.ts`, `frontend/src/components/AgentList.tsx` | 2026-06-28 | Frontend has a shared EventSource hook, but two other components still open their own EventSource connections. |
| S4 | codebase | `wiki/work/tasks/TASK-012-sse-tail-stream.md` lines 16-32 | 2026-06-28 | Prior SSE task moved client polling to server-side SSE tail push. |
| S5 | raw research | `raw/research/websocket-dashboard-transport/index.md` | 2026-06-28 | WebSockets are compatible, but capture/fanout optimization should come first; use focused WebSocket terminal only if needed. |
| S6 | context7 | `/nodejs/node` — "perf_hooks performance timerify PerformanceObserver mark measure API..." | 2026-06-28 | Node stdlib can measure function durations with `performance.measure()` and `timerify()`. |

## Excerpts

### S1 — Polling Constants

`host-server/index.ts`

> `const TAIL_POLL_MS = 2000;`

> `const TAIL_POLL_FOCUS_MS = 200;`

> `const TAIL_LINES_FOCUS = 500;`

### S2 — Raw Capture

`host-server/state.ts`

> `['capture-pane', '-t', target, '-p', '-e', '-S', \`-${String(n)}\`]`

> `['display-message', '-p', '-t', target, '-F', '#{cursor_y} #{cursor_x} #{pane_height}']`

### S3 — Frontend EventSource Connections

`frontend/src/hooks/useSSE.ts`

> `useAgents.ts` and `AgentList.tsx` still open their own EventSource.

`frontend/src/lib/useAgents.ts`

> `const es = new EventSource(\`${API_BASE}/events\`)`

`frontend/src/components/AgentList.tsx`

> `const es = new EventSource(\`${apiUrl}/events\`)`

### S4 — Existing SSE Tail Task

`wiki/work/tasks/TASK-012-sse-tail-stream.md`

> Replace the interval-based polling in `LogTail.tsx` ... with a server-side push model.

### S5 — Prior Research

`raw/research/websocket-dashboard-transport/index.md`

> The setup is compatible, but the likely performance issue is the current polling/capture design, not SSE itself.

### S6 — Node perf_hooks

`/nodejs/node`

> Use `perf_hooks.timerify()` to wrap a function and measure its execution duration.

> `performance.measure()` creates a new `PerformanceMeasure` entry in the Performance Timeline.
