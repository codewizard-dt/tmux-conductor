---
topic: "We made a bunch of changes to polling and tried to optimize some performance issues, but now there have been introduced other performance issues. I was thinking maybe we could switch to WebSockets. Firm.t, can you look into that and see if our setup would be compatible with that and if it would improve performance?"
slug: websocket-dashboard-transport
researched: 2026-06-28
sources: [./sources.md]
---

# Research: WebSocket Dashboard Transport

> The current setup is compatible with WebSockets, but a transport swap by itself is unlikely to fix the new performance issues. The expensive part is not mainly SSE framing; it is repeated synchronous `tmux capture-pane` work, including a 2s status capture per live agent, a 2s terminal capture for unfocused agents, and a 200ms raw 500-line capture for focused agents. Keep SSE for one-way state updates, first consolidate the three frontend `/events` connections and reduce capture work, then consider one focused WebSocket terminal channel if direct input and terminal output should share a single low-latency bidirectional stream.

## Research Questions

- Is the current Fastify/Vite/React setup compatible with WebSockets?
- Would WebSockets remove the current performance bottleneck, or only change the transport?
- Which current loops and frontend connections are likely contributing to the regression?
- What should remain SSE, and what, if anything, should move to WebSockets?
- What implementation path minimizes risk if WebSockets are adopted?

## Current State (Codebase)

The project is currently a fully local, single-user system: `host-server/` runs Fastify + SQLite on `:8788`, and `frontend/` runs Vite on `:4321` through a `/api` proxy. The hosted portal, relay daemon, auth, Docker, and App Platform deployment were removed in the June 21 simplification [S1].

`host-server` already depends on Fastify 5.8.5 but does not include `@fastify/websocket`; adding WebSocket support would be a new backend dependency [S2]. The frontend Vite proxy currently uses string shorthand for `/api`, which works for HTTP/SSE but would need an object proxy with `ws: true` if the browser connects through the dev server instead of directly to `:8788` [S3, S14].

The live dashboard transport is currently SSE:
- `GET /api/events` hijacks the Fastify reply, sets `text/event-stream`, keeps a `Set<FastifyReply>`, sends a 15s heartbeat, and broadcasts named JSON events [S4].
- `broadcastSSE` writes each event to every connected response [S5].
- `useSSEEvent` is a shared frontend EventSource for terminal events, but its own comment says `useAgents.ts` and `AgentList.tsx` still open separate EventSource connections [S10].
- `useAgents.ts` opens one additional EventSource [S11].
- `AgentList.tsx` opens another EventSource [S12].

The hot work is server-side polling and synchronous tmux capture:
- `TAIL_POLL_MS` is 2000ms, `TAIL_POLL_FOCUS_MS` is 200ms, and focused captures request 500 lines [S6].
- `pollAndDiff` runs every 2s and `buildSnapshot` performs one plain `capturePaneTail(..., 15)` per live agent for status/mode detection [S7].
- `tailPollLoop` runs every 2s for unfocused agents and captures 100 lines; `tailPollLoopFocus` runs every 200ms for focused agents and captures 500 raw lines [S8].
- `capturePaneTailRaw` runs `tmux capture-pane -p -e -S -N` and a second synchronous `tmux display-message` call to mirror cursor position [S9].

`TASK-012` already attempted to replace client tail polling with SSE push. Its objective was explicitly to centralize polling into a server-side tail-diff loop over the existing `/events` stream [S15]. That achieved fewer browser HTTP tail requests, but it also moved recurring capture work into the server. The task text expected a 200ms tail loop, while current code uses 2s for unfocused and 200ms only for focused agents [S6, S15].

## Key Findings

### F1 — WebSocket compatibility is good, but not zero-cost

Fastify supports WebSocket routes through `@fastify/websocket` using `fastify.register(...)` and `fastify.get('/ws', { websocket: true }, ...)`; message handlers should be attached synchronously, and the plugin must be registered before WebSocket routes [S13]. The package currently resolves to `@fastify/websocket` 11.2.0 with `ws` as a dependency [S18]. Vite can proxy WebSockets with `server.proxy['/path'] = { target: 'ws://...', ws: true }`, so the local dev topology is compatible after changing the proxy shape [S14].

### F2 — SSE is still the better default for one-way dashboard state

The dashboard's agent/session/background/task updates are server-to-client notifications. MDN documents EventSource as unidirectional server-to-client delivery [S16]. This matches the existing status stream well and includes browser-managed reconnection behavior. WebSockets become more compelling only where the client must also send frequent messages on the same live channel.

### F3 — A pure SSE-to-WebSocket rewrite would not eliminate the main cost

The current performance-sensitive loops are producing data by spawning synchronous tmux commands. A WebSocket would still need the same data source unless the implementation changes from "poll capture-pane and push snapshots" to a more event-driven terminal stream. The current `capturePaneTailRaw` path can run two synchronous tmux commands per focused capture, every 200ms per focused agent [S8, S9]. Moving the resulting JSON from SSE to WebSocket changes framing, not that capture cost.

### F4 — There is low-hanging fruit before WebSockets

The frontend currently has at least three `/events` EventSource connections in common dashboard flows: the shared terminal hook plus `useAgents.ts` plus `AgentList.tsx` [S10, S11, S12]. Consolidating all event consumers onto one shared event client would reduce per-event write fanout and duplicate initial state handling without changing protocol. Separately, focus-mode capture should be gated more tightly: 500 raw lines every 200ms is expensive for a modal/detail affordance, especially because each raw capture also asks tmux for cursor metadata [S8, S9].

### F5 — The strongest WebSocket case is the interactive terminal, not global events

The browser direct-input path currently sends keystrokes over REST while terminal output arrives over SSE. MDN describes WebSocket as a two-way interactive browser/server session without polling [S17]. If the product direction is closer to a real remote terminal, a focused WebSocket route for one active `LogTail` can carry both input frames and output snapshots/terminal frames. That gives a single ordered bidirectional channel for the active terminal, while keeping the simpler SSE stream for global dashboard state.

## Constraints

- The app is local-first and single-user right now; the old hosted WebSocket relay architecture was removed [S1].
- Status detection currently depends on plain text captures and regex matching; `capturePaneTail` should remain separate from raw ANSI display captures [S7, S9].
- The host-server uses synchronous `spawnSync` for tmux calls; frequent polling can block the Node event loop long enough to affect HTTP/SSE responsiveness [S8, S9]. This is an inference from Node's synchronous child process behavior and the code's use of `spawnSync`; no runtime profile was collected in this research.
- Vite proxy config must be changed if frontend code uses `ws://localhost:4321/api/...` rather than direct `ws://localhost:8788/api/...` [S3, S14].
- `@fastify/websocket` adds `ws` and `duplexify` dependencies [S18].
- No Serena MCP endpoint was available in this session, so codebase research used local shell inspection instead of the research skill's preferred Serena tools.

## Solution Comparison

| Criteria | Keep SSE, optimize capture + clients | Add WebSocket for focused terminal only | Replace all `/events` SSE with WebSocket |
|---|---|---|---|
| **Approach** | Consolidate frontend event consumers; reduce focused capture cadence/depth; avoid duplicate captures; keep SSE for server push. | Keep SSE for global state, add `/api/terminal/:id/ws` for one focused terminal carrying input + output. | Move all snapshot/task/terminal events to a single WS protocol. |
| **Pros** | Lowest risk; no new backend dependency; targets the likely bottleneck directly; preserves EventSource reconnection. | Gives bidirectional low-latency terminal UX; can replace REST keys + focused SSE with one channel; limits WS complexity to the path that benefits. | One live connection for everything; custom protocol can support request/response and subscriptions. |
| **Cons** | Still polling tmux; no unified input/output ordering for terminal. | New dependency and protocol; still needs capture optimization unless output source changes; needs reconnect/backfill logic. | More invasive; must rebuild reconnect/resync behavior; easy to regress simple state updates. |
| **Complexity** | Low/Medium | Medium | High |
| **Dependencies** | None | `@fastify/websocket` | `@fastify/websocket` |
| **Codebase fit** | Best fit with current architecture and `TASK-012` direction. | Good fit for interactive terminal/detail modal. | Poor fit for current local dashboard unless broader realtime protocol work is desired. |
| **Maintenance** | Low | Medium | High |

## Recommendation

Do not switch the whole dashboard to WebSockets as the next move. The setup is compatible, but the likely performance issue is the current polling/capture design, not SSE itself.

Recommended order:

1. **Instrument first**: add timing counters around `pollAndDiff`, `tailPollLoop`, `tailPollLoopFocus`, `capturePaneTail`, `capturePaneTailRaw`, and `broadcastSSE` fanout. Log agent count, focused count, payload byte length, and elapsed time.
2. **Consolidate frontend `/events` connections**: migrate `useAgents.ts` and `AgentList.tsx` onto the existing shared `useSSEEvent`/event-client pattern so the browser holds one EventSource for dashboard events.
3. **Reduce capture pressure**: keep `pollAndDiff` at 2s, but make focused terminal capture adaptive. For example: 250-500ms only while the user is actively typing or the pane changed recently, then decay to 1000-2000ms; consider lowering focused history from 500 lines or sending a one-shot 500-line backfill plus smaller live snapshots.
4. **Only then add a focused WebSocket terminal channel if needed**: implement `GET /api/agents/:id/terminal` as a WebSocket route for the active modal. Frames can be `{type:"focus"}`, `{type:"keys"}`, `{type:"resize"}`, `{type:"tail"}`, and `{type:"error"}`. Keep `/api/events` SSE for global agent/session/task updates.

Risks and mitigations:

- **Risk: WebSocket route accepts upgrade before auth/validation logic.** Current app is local and unauthenticated, but if auth returns, validate immediately and close with a policy code; `@fastify/websocket` handlers must attach listeners synchronously [S13].
- **Risk: reconnect loses terminal state.** Keep `/agents/:id/tail` as an HTTP backfill or send a full initial tail frame on WebSocket open.
- **Risk: capture work still blocks.** WebSocket does not fix this. If instrumentation shows `spawnSync` is the cost, the real fix is async tmux calls, less frequent capture, or an append-only terminal log source written by hooks/monitor.
- **Risk: Vite WS proxy mismatch.** Add an explicit proxy entry with `ws: true` if using the dev server path [S14].

## Next Steps

- To create a task: `/task-add Instrument and reduce dashboard live-update capture overhead before introducing WebSockets`
- If a decision is needed: `/decision-create Keep SSE for dashboard state; optionally add a focused WebSocket terminal channel for interactive input/output`
- If proceeding with WebSockets, start with a narrow proof of concept on the focused terminal modal, not a full replacement of `/api/events`.
