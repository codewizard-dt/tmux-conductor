---
topic: "$research perform a full assessment of the overall structure of this application from the lens of performance optimization. Look for any and all ways to reduce latency across the entire stack. Consider subtle changes as well as drastic changes. Particular things of note: the UI is a little unstable and the UX is inconsistent. The 'terminal' sometimes stops accepting input entirely, or appears to, but if you close and reopen the modal the input is there. Consider websocket vs sse vs polling. Consider changes/simplifications to 'agent state' determination. Also consider runtime variables/effects/setup"
slug: application-latency-structure
researched: 2026-07-04
---

# Primary Sources - Application Latency Structure

| ID | Type | Locator | Accessed | What it contributed |
|----|------|---------|----------|---------------------|
| S1 | codebase | `PROJECT_STATUS.md`; `CLAUDE.md` | 2026-07-04 | Current architecture is local single-user Fastify host-server plus Vite React frontend with SQLite and tmux; no hosted relay/auth/Docker path. |
| S2 | codebase | `host-server/perfBudgets.ts`; `scripts/test-host-performance.mjs` | 2026-07-04 | Existing performance budgets and static checks cover status ticks, terminal ticks, focused ticks, tmux capture, SSE broadcasts, and tail requests. |
| S3 | codebase | `host-server/index.ts::sendDirectInput` | 2026-07-04 | Direct terminal input uses synchronous tmux commands and queues REST fallback input to preserve order. |
| S4 | codebase | `host-server/state.ts::capturePaneTailRaw` | 2026-07-04 | Raw terminal display capture uses `tmux capture-pane -p -e -S` plus `tmux display-message` cursor metadata. |
| S5 | codebase | `frontend/src/hooks/useSSE.ts`; `scripts/check-frontend-live-updates.sh` | 2026-07-04 | Frontend EventSource is module-level, shared, reference-counted, and statically guarded against direct construction elsewhere. |
| S6 | codebase | `frontend/src/components/LogTail.tsx`; `frontend/src/lib/terminalWebSocket.ts` | 2026-07-04 | Focused terminal opens WebSocket, sends input over WebSocket when open, also subscribes to focused SSE fallback/event path, and owns xterm/focus effects. |
| S7 | codebase | `host-server/index.ts::tailPollLoopFocus`; `host-server/index.ts::/agents/:id/terminal/ws`; loop constants | 2026-07-04 | Focused WebSocket and focused SSE both capture focused agents on 200 ms cadence with 500-line raw snapshots. |
| S8 | codebase | `frontend/vite.config.ts`; `frontend/src/lib/api.ts` | 2026-07-04 | API base defaults to `/api`; Vite proxy uses string shorthand rather than explicit `ws: true`. |
| S9 | codebase | `frontend/src/main.tsx` | 2026-07-04 | App renders under `React.StrictMode`, so effect cleanup/setup behavior is exercised in development. |
| S10 | codebase | `host-server/config.ts`; `conductor.conf`; `.env.example` | 2026-07-04 | Runtime config includes ports, proxy target, detection regexes, poll interval, stall timeout, context window, and env timeouts; live-update loop constants remain hardcoded. |
| S11 | codebase | `host-server/state.ts::detectAgentStatus`; `host-server/index.ts::buildSnapshot` | 2026-07-04 | Agent state combines state files, tmux liveness, pane-current-command, regex fallback, POSIX grep, status/mode detection, label extraction, active task, and context cache. |
| S12 | codebase | `frontend/src/components/AgentList.tsx::deriveStatus` | 2026-07-04 | UI derives display statuses such as `empty`, `idle-waiting`, `awaiting`, `stalled`, and `busy` from backend state plus queue count and agent type. |
| S13 | codebase | `raw/research/websocket-dashboard-transport/index.md` | 2026-07-04 | Prior research recommended SSE for one-way dashboard state and focused WebSocket only for interactive terminal. |
| S14 | codebase | `raw/research/dashboard-performance-websockets/sse-vs-websocket-comparison.md` | 2026-07-04 | Prior comparison kept SSE as default and noted representative focused-agent latency numbers were not captured. |
| S15 | codebase | `raw/research/web-terminal-emulators/index.md` | 2026-07-04 | Prior terminal research established xterm.js and display-only `tmux capture-pane -e` constraints. |
| S16 | context7 | `/vitejs/vite` - "server.proxy websocket option ws true configuration example" | 2026-07-04 | Vite documents WebSocket proxying with object proxy config using `target: 'ws://...'` and `ws: true`. |
| S17 | context7 | `/reactjs/react.dev` - "useEffect dependencies cleanup runs before every re-render when dependencies change Strict Mode extra setup cleanup cycle" | 2026-07-04 | React Strict Mode runs an extra setup-cleanup-setup effect cycle in development; effect cleanup must mirror setup. |
| S18 | context7 | `/nodejs/node` - "child_process spawnSync execSync synchronous methods block Node.js event loop until child process exits" | 2026-07-04 | Node synchronous child-process APIs block the event loop until the subprocess exits or times out. |
| S19 | web | https://developer.mozilla.org/en-US/docs/Web/API/EventSource | 2026-07-04 | EventSource/SSE is unidirectional server-to-client delivery. |
| S20 | web | https://web.dev/articles/eventsource-basics | 2026-07-04 | SSE streams server-to-client updates and has automatic reconnection/event features. |
| S21 | web | https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API | 2026-07-04 | WebSocket provides two-way interactive browser/server communication without polling. |
| S22 | web | https://developer.mozilla.org/en-US/docs/Web/API/WebSocket | 2026-07-04 | Classic browser WebSocket has no built-in backpressure, so high message rates can buffer or make the app unresponsive. |
| S23 | context7 | `/fastify/fastify-websocket` - "Best practices for websocket route handlers, synchronous event handler attachment" | 2026-07-04 | Fastify WebSocket handlers should attach message handlers synchronously in the route handler. |
| S24 | verification | Commands: `npm --prefix host-server run perf:test`; `npm run check:frontend-live-updates`; `npm --prefix host-server run typecheck`; `npm --prefix frontend run typecheck` | 2026-07-04 | Static performance guard, EventSource guard, and both TypeScript checks passed during this research. |

## Excerpts

### S16 - Vite WebSocket Proxy

https://github.com/vitejs/vite/blob/main/docs/config/server-options.md

> Proxying websockets or socket.io:

> target: 'ws://localhost:5174', ws: true

### S17 - React Strict Mode Effect Cleanup

https://github.com/reactjs/react.dev/blob/main/src/content/reference/react/useEffect.md

> React will run your cleanup function

> one extra development-only setup+cleanup cycle

### S18 - Node Synchronous Child Processes

https://github.com/nodejs/node/blob/main/doc/api/child_process.md

> blocks the Node.js event loop

> until the child process has fully closed

### S19 - MDN EventSource

https://developer.mozilla.org/en-US/docs/Web/API/EventSource

> Unlike WebSockets, server-sent events are unidirectional

> from the server to the client

### S20 - web.dev EventSource Basics

https://web.dev/articles/eventsource-basics

> SSEs open a single unidirectional channel

> automatic reconnection, event IDs

### S21 - MDN WebSocket API

https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API

> two-way interactive communication session

> without having to poll

### S22 - MDN WebSocket

https://developer.mozilla.org/en-US/docs/Web/API/WebSocket

> The WebSocket API has no way to apply backpressure

> become unresponsive due to 100% CPU usage

### S23 - Fastify WebSocket

https://github.com/fastify/fastify-websocket/blob/main/README.md

> Attach WebSocket event handlers synchronously

> prevent message loss
