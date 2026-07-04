---
topic: "We made a bunch of changes to polling and tried to optimize some performance issues, but now there have been introduced other performance issues. I was thinking maybe we could switch to WebSockets. Firm.t, can you look into that and see if our setup would be compatible with that and if it would improve performance?"
slug: websocket-dashboard-transport
researched: 2026-06-28
---

# Primary Sources — WebSocket Dashboard Transport

| ID | Type | Locator | Accessed | What it contributed |
|----|------|---------|----------|---------------------|
| S1 | codebase | `PROJECT_STATUS.md` lines 5-8 | 2026-06-28 | Current architecture is local-only `host-server/` + `frontend/`; hosted portal/relay were removed. |
| S2 | codebase | `host-server/package.json` lines 14-20 | 2026-06-28 | Host server currently uses Fastify, CORS, static, SQLite, dotenv; no WebSocket plugin installed. |
| S3 | codebase | `frontend/vite.config.ts` lines 7-12 | 2026-06-28 | Vite dev server proxies `/api` to host-server using string shorthand. |
| S4 | codebase | `host-server/index.ts` lines 1445-1492 | 2026-06-28 | SSE route uses `text/event-stream`, heartbeat, raw response hijack, and tracks clients. |
| S5 | codebase | `host-server/index.ts` lines 269-281 | 2026-06-28 | SSE broadcast writes each named JSON event to every connected reply. |
| S6 | codebase | `host-server/index.ts` lines 114-120 | 2026-06-28 | Tail polling constants: 2s normal, 200ms focused, 100/500 line capture sizes. |
| S7 | codebase | `host-server/index.ts` lines 1508-1551 | 2026-06-28 | Snapshot loop captures a 15-line pane tail per live agent for status/mode. |
| S8 | codebase | `host-server/index.ts` lines 1643-1685 and 1811-1813 | 2026-06-28 | Server runs status, normal tail, and focused tail loops; focused loop captures raw 500-line tails every 200ms for focused agents. |
| S9 | codebase | `host-server/state.ts` lines 51-97 and 248-315 | 2026-06-28 | Plain and raw tmux capture functions are separate; raw capture uses `-e -S` and a cursor metadata tmux call; status detection uses plain text. |
| S10 | codebase | `frontend/src/hooks/useSSE.ts` lines 4-15 and 87-115 | 2026-06-28 | Shared EventSource exists for terminal-output subscribers but explicitly excludes `useAgents.ts` and `AgentList.tsx`. |
| S11 | codebase | `frontend/src/lib/useAgents.ts` lines 12-16 and 40-73 | 2026-06-28 | `useAgents` opens its own `/events` EventSource. |
| S12 | codebase | `frontend/src/components/AgentList.tsx` lines 1035-1041 | 2026-06-28 | `AgentList` opens another `/events` EventSource. |
| S13 | context7 | `/fastify/fastify-websocket` — "How to register @fastify/websocket with Fastify 5..." | 2026-06-28 | Fastify WebSocket support requires registering the plugin, using `websocket: true`, and attaching handlers synchronously. |
| S14 | context7 | `/vitejs/vite` — "Vite server proxy configuration websocket ws option..." | 2026-06-28 | Vite proxy can proxy WebSockets with an object target and `ws: true`. |
| S15 | codebase | `wiki/work/tasks/TASK-012-sse-tail-stream.md` lines 16-32 and 94-103 | 2026-06-28 | Prior performance task replaced client tail polling with server-side SSE push and deferred browser runtime verification. |
| S16 | web | https://developer.mozilla.org/en-US/docs/Web/API/EventSource | 2026-06-28 | EventSource/SSE is unidirectional server-to-client delivery. |
| S17 | web | https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API | 2026-06-28 | WebSocket API supports two-way interactive browser/server communication without polling. |
| S18 | npm | `npm view @fastify/websocket version peerDependencies dependencies --json` | 2026-06-28 | Current package version is 11.2.0; dependencies include `ws`, `duplexify`, and `fastify-plugin`. |

## Excerpts

### S1 — Project Status

`PROJECT_STATUS.md`

> Reverted to a simple single-user, fully-local system: `host-server/` (native tmux + SQLite on :8788) and `frontend/` (Vite SPA on :4321, talking directly to the host-server via the Vite `/api` proxy).

### S2 — Host Server Dependencies

`host-server/package.json`

> `"fastify": "^5.8.5"`

### S3 — Vite Proxy

`frontend/vite.config.ts`

> `'/api': process.env['PROXY_TARGET'] ?? \`http://localhost:${process.env['BACKEND_PORT'] ?? '8788'}\``

### S4 — SSE Route

`host-server/index.ts`

> `reply.raw.setHeader('Content-Type', 'text/event-stream');`

> `const heartbeat = setInterval(() => { try { reply.raw.write(': ping\n\n'); } catch { /* ignore */ } }, 15000);`

### S5 — SSE Fanout

`host-server/index.ts`

> `for (const reply of sseClients) { try { reply.raw.write(msg); } catch { sseClients.delete(reply); } }`

### S6 — Tail Constants

`host-server/index.ts`

> `const TAIL_POLL_MS = 2000;`

> `const TAIL_POLL_FOCUS_MS = 200;`

> `const TAIL_LINES_FOCUS = 500;`

### S7 — Snapshot Capture

`host-server/index.ts`

> `const tail15 = windowPresent ? capturePaneTail(sessionName, wn, 15) : '';`

### S8 — Tail Loops

`host-server/index.ts`

> `const text = capturePaneTailRaw(conf.sessionName, wn, TAIL_LINES_FOCUS);`

> `startManagedLoop('focused tail poll', TAIL_POLL_FOCUS_MS, tailPollLoopFocus, { warnAfterMs: 150, backoffMs: 1000 });`

### S9 — Capture Helpers

`host-server/state.ts`

> `['capture-pane', '-t', target, '-p', '-e', '-S', \`-${String(n)}\`]`

> `['display-message', '-p', '-t', target, '-F', '#{cursor_y} #{cursor_x} #{pane_height}']`

### S10 — Shared SSE Hook

`frontend/src/hooks/useSSE.ts`

> A single module-level EventSource is opened lazily on the first subscription.

> `useAgents.ts` and `AgentList.tsx` still open their own EventSource.

### S11 — `useAgents` EventSource

`frontend/src/lib/useAgents.ts`

> `const es = new EventSource(\`${API_BASE}/events\`)`

### S12 — `AgentList` EventSource

`frontend/src/components/AgentList.tsx`

> `const es = new EventSource(\`${apiUrl}/events\`)`

### S13 — Context7 Fastify WebSocket Docs

`/fastify/fastify-websocket`

> Register the @fastify/websocket plugin and define a GET route with `websocket: true` to handle WebSocket connections.

> Attach WebSocket message handlers synchronously within the route handler, before any asynchronous operations.

### S14 — Context7 Vite Proxy Docs

`/vitejs/vite`

> Proxying websockets or socket.io:

> `'/socket.io': { target: 'ws://localhost:5174', ws: true, rewriteWsOrigin: true }`

### S15 — Existing SSE Tail Task

`wiki/work/tasks/TASK-012-sse-tail-stream.md`

> Replace the interval-based polling in `LogTail.tsx` ... with a server-side push model.

> `terminal-output` events appear at ~200 ms intervals when an agent is active.

### S16 — MDN EventSource

https://developer.mozilla.org/en-US/docs/Web/API/EventSource

> Unlike WebSockets, server-sent events are unidirectional; that is, data messages are delivered in one direction, from the server to the client.

### S17 — MDN WebSocket API

https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API

> The WebSocket API makes it possible to open a two-way interactive communication session between the user's browser and a server.

### S18 — npm view @fastify/websocket

Command: `npm view @fastify/websocket version peerDependencies dependencies --json`

> `"version": "11.2.0"`

> `"ws": "^8.16.0"`
