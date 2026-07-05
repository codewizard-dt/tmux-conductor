---
topic: "Capture a representative focused-terminal latency baseline"
slug: focused-terminal-latency-baseline
researched: 2026-07-04
---

# Primary Sources — Capture a representative focused-terminal latency baseline

| ID | Type | Locator | Accessed | What it contributed |
|----|------|---------|----------|---------------------|
| S1 | codebase | `frontend/src/components/LogTail.tsx::LogTail` | 2026-07-04 | Focused terminal currently performs initial tail fetch, focus registration, focused WebSocket subscription, focused SSE subscription, and xterm snapshot repaint. |
| S2 | codebase | `frontend/src/lib/terminalWebSocket.ts::connectTerminalWebSocket` | 2026-07-04 | WebSocket URL, JSON frame handling, and direct-input send path. |
| S3 | codebase | `host-server/index.ts::focused terminal constants and route/loop` | 2026-07-04 | Focused capture cadence/depth and duplicate focused WebSocket/SSE capture behavior. |
| S4 | codebase | `host-server/index.ts::liveUpdateMetrics and /perf/live-updates` | 2026-07-04 | Existing server metrics for focused loop, raw capture, SSE broadcast, tail requests, and connection counts. |
| S5 | codebase | `raw/research/dashboard-performance-websockets/index.md` | 2026-07-04 | Prior research recommends measurement before transport changes and notes synchronous tmux capture can remain the hot path. |
| S6 | context7 | `/mdn/content` — "Performance API performance.now performance.mark performance.measure requestAnimationFrame how to measure frontend interaction latency and render timing" | 2026-07-04 | Browser timing APIs suitable for elapsed-time and marker-based measurement. |

## Excerpts

### S1 — Focused LogTail behavior

`frontend/src/components/LogTail.tsx::LogTail`

> `fetch(`${API_BASE}/agents/${agentId.toString()}/tail?lines=${String(TAIL_LINES)}`)`

> `const client = connectTerminalWebSocket(`

> `focused ? 'terminal-output-focus' : 'terminal-output'`

### S2 — Terminal WebSocket client

`frontend/src/lib/terminalWebSocket.ts::connectTerminalWebSocket`

> `new WebSocket(`${websocketBase()}/agents/${agentId.toString()}/terminal/ws`)`

> `ws.send(JSON.stringify({ type: 'input', payload }))`

### S3 — Focused polling and capture

`host-server/index.ts`

> `const TAIL_POLL_FOCUS_MS = 200;`

> `const TAIL_LINES_FOCUS = 500;`

> `setInterval(sendSnapshot, TAIL_POLL_FOCUS_MS)`

> `tailPollLoopFocus`

### S4 — Existing live-update metrics

`host-server/index.ts`

> `api.get('/perf/live-updates'`

> `focusedTerminalTicks: createTimingSummary()`

> `tmuxCaptureTailRaw: createTimingSummary()`

### S5 — Prior dashboard performance research

`raw/research/dashboard-performance-websockets/index.md`

> `This roadmap should start with measurement, not WebSockets.`

> `the hot path is synchronous tmux capture work`

### S6 — MDN Performance API docs via Context7

`/mdn/content`

> `const t0 = performance.now();`

> `performance.measure(`

> `requestAnimationFrame(animate);`
