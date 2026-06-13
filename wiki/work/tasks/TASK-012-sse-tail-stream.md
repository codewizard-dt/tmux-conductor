---
id: TASK-012
title: "Replace tail polling with SSE push for terminal output"
status: in-progress
created: 2026-06-12
updated: 2026-06-12
depends_on: []
blocks: []
parallel_safe_with: [TASK-001, TASK-009, TASK-010, TASK-011]
uat: "../uat/UAT-012-sse-tail-stream.md"
tags: [frontend, backend, sse, performance]
---

# TASK-012 — Replace tail polling with SSE push for terminal output

## Objective

Replace the interval-based polling in `LogTail.tsx` (100ms in modal, 500ms in interact mode, 3000ms in card view) with a server-side push model. The backend adds a tail-diff loop that runs `capture-pane` centrally and broadcasts `terminal-output` SSE events through the existing `GET /events` stream whenever an agent's visible output changes. The frontend drops its `setInterval` and instead listens to those events. The `<pre>` renderer is unchanged; xterm.js is explicitly out of scope.

## Approach

**Transport**: Multiplex `terminal-output` events through the existing `GET /events` SSE endpoint rather than opening per-agent SSE streams. The EventSource connection is already open on that endpoint; no new HTTP connections are needed, and the existing `sseClients` Set, `broadcastSSE`, and 15 s heartbeat infrastructure all carry over unchanged.

**Backend polling cadence**: Add a dedicated `tailPollLoop` at ~200 ms (configurable constant). This replaces N client polls (each at 100–500 ms) with a single server-side poll, centralising load. The loop captures up to 100 lines per live agent, diffs against the previous snapshot, and broadcasts only on change.

**Full-snapshot push**: Each `terminal-output` event carries the full current tail text, not a delta. The frontend replaces its display buffer on receipt — no client-side line accounting needed.

**Initial backfill**: On component mount, `LogTail.tsx` still fires one `GET /agents/:agent/tail` fetch to populate the view immediately (before the first SSE push arrives). After that, SSE events replace the poll interval.

**Interact mode**: No special-casing needed. Keystrokes cause immediate pane output changes; the 200 ms server loop will catch them and push within one cycle. The `interacting` prop drives UI chrome only; the input path (`POST /agents/:agent/keys`) is unchanged.

**DO App Platform idle-timeout note**: The existing SSE heartbeat (`: ping\n\n` every 15 s) already keeps the connection alive on App Platform. No additional keepalive work is required.

## Steps

### 1. Add tail diff state and `tailPollLoop` to the backend  <!-- agent: general-purpose --> <!-- Completed: 2026-06-12 -->

File: `backend/index.ts`

- [x] Declare `const prevTailMap = new Map<string, string>()` near the existing `prevSnapshot` declaration (around line 1183).
- [x] Add constant `const TAIL_POLL_MS = 200` near the other interval constants.
- [x] Add constant `const TAIL_LINES = 100` for the lines captured per push.
- [x] Write a `tailPollLoop` function that:
  1. Reads `readConductorConf()` (same call already in `pollAndDiff`).
  2. Iterates `listAgents(db)` — filter to agents where `isTmuxWindowPresent(conf.sessionName, a.name)` is true.
  3. For each live agent, calls `capturePaneTailRaw(conf.sessionName, a.name, TAIL_LINES)` (already exported from `backend/state.ts`).
  4. Compares result against `prevTailMap.get(a.name)`. If different (or first run), calls `broadcastSSE('terminal-output', { agent: a.name, text, lines: TAIL_LINES })` and updates the map.
  5. Wraps the body in try/catch (same pattern as `pollAndDiff`).
- [x] After the existing `setInterval(pollAndDiff, 2000)` call (around line 1263), add `setInterval(tailPollLoop, TAIL_POLL_MS)`.
- [x] Run `cd backend && npx tsc --noEmit` to confirm no type errors.

### 2. Update the backend SSE event type declarations (if typed)  <!-- agent: general-purpose --> <!-- N/A: 2026-06-12 -->

File: `backend/index.ts` (or a `types.ts` if event types are centralised — check with `mcp__serena__search_for_pattern` for `broadcastSSE`)

- [x] If `broadcastSSE` uses a discriminated union or string-literal type for event names, add `'terminal-output'` as a valid event name. <!-- N/A: broadcastSSE is fully untyped (eventName: string, data: unknown) — no event-name union or payload type exists to extend. -->
- [x] If the payload is typed, define `TerminalOutputPayload: { agent: string; text: string; lines: number }`. <!-- N/A: payload param is typed `unknown`; no centralised payload types. -->

> Step 2 verified as N/A by the Step 1 agent: `broadcastSSE(eventName: string, data: unknown)` is fully untyped. No type declarations to update.

### 3. Expose the EventSource in a shared frontend hook  <!-- agent: general-purpose --> <!-- Completed: 2026-06-12 -->

Files: `frontend/src/` — first use `mcp__serena__search_for_pattern` to find where `EventSource` is constructed (likely a `useSSE`, `useEvents`, or similar hook/context).

- [x] If a shared `EventSource` hook/context already exists (e.g. `useSSE.ts`, `EventsContext.tsx`), confirm it forwards arbitrary `MessageEvent` types and add `terminal-output` to its event map if the map is typed. <!-- None existed; created a new hook below. -->
- [x] Created `frontend/src/hooks/useSSE.ts` that:
  - Opens `new EventSource(`${API_BASE}/events`)` (module-level singleton, lazily opened on first subscriber, ref-counted, closed after last unsubscribe).
  - Exposes `useSSEEvent<T>(eventName, callback)` — callback receives the already-`JSON.parse`d payload.
  - Cleans up on unmount.
  - All `LogTail` instances collapse onto ONE shared connection. (Two legacy EventSource instances remain in `useAgents.ts` and `AgentList.tsx` — migrating them is out of scope for TASK-012.)

### 4. Replace the polling loop in `LogTail.tsx` with SSE subscription  <!-- agent: general-purpose --> <!-- Completed: 2026-06-12 -->

File: `frontend/src/components/LogTail.tsx`

- [x] Keep the initial one-shot `fetch` on mount (the `load()` call before `setInterval`) — this provides immediate backfill.
- [x] Remove the `setInterval(load, pollMs ?? ...)` call and its cleanup `clearInterval`.
- [x] Remove the `POLL_MS`, `INTERACT_POLL_MS` constants if no longer referenced anywhere else in the file. <!-- Both removed; referenced only in the deleted setInterval. -->
- [x] Remove the `pollMs` prop from the component's props interface. <!-- Removed from interface + destructure; call-site removal is Step 5. -->
- [x] Subscribe to `terminal-output` SSE events via `useSSEEvent('terminal-output', ...)`. Filter by `payload.agent === agentName`. On match, call `setTail({ agent: agentName, lines: payload.lines, windowPresent: true, text: payload.text })`.
- [x] Subscription teardown handled by `useSSEEvent` (ref-counted singleton) on unmount.
- [x] Keep the `failed` and `setFailed` state for the initial fetch error path; on SSE delivery, errors don't apply — omit error handling for the push path.

### 5. Remove the `pollMs` prop from all `LogTail` call sites  <!-- agent: general-purpose --> <!-- Completed: 2026-06-12 -->

File: `frontend/src/components/AgentList.tsx` (the known caller that passed `pollMs={100}` for the modal)

- [x] Use `mcp__serena__find_referencing_symbols` on `LogTail` to locate every usage. <!-- 2 usages, both in AgentList.tsx (lines 436, 667); only line 436 passed pollMs. -->
- [x] Remove `pollMs={...}` from each call site. <!-- Removed pollMs={100} from the AgentDetailModal LogTail. -->
- [x] Interact-chrome props (`interactSignal`/`onInteractChange`) preserved; only `pollMs` removed. Frontend + backend tsc both zero errors.

### 6. End-to-end smoke test  <!-- agent: general-purpose --> <!-- DEFERRED-TO-UAT: 2026-06-12 -->

- [DEFERRED-TO-UAT] Start the backend with `cd backend && npm run dev` (or `tsx watch index.ts`).
- [DEFERRED-TO-UAT] Start the frontend with `cd frontend && npm run dev`.
- [DEFERRED-TO-UAT] Open the dashboard in a browser; verify agent cards load with correct terminal output.
- [DEFERRED-TO-UAT] Open the browser DevTools → Network → `events` stream; confirm `terminal-output` events appear at ~200 ms intervals when an agent is active.
- [DEFERRED-TO-UAT] Open the modal detail view; confirm the `<pre>` still updates in real time without any polling requests in the Network tab.
- [DEFERRED-TO-UAT] Verify interact mode (`POST /keys`) still works — type into an agent pane and confirm the pane output updates live.
- [DEFERRED-TO-UAT] Confirm no `GET /agents/:agent/tail` requests appear repeatedly in the Network tab after initial page load (only the one-shot backfill fetch on mount).
- [x] Run `cd backend && npx tsc --noEmit` and `cd frontend && npx tsc --noEmit` to confirm no type errors. <!-- Both zero errors (confirmed by Step 5 agent). Runtime/browser checks above deferred to UAT per /tackle verification split. -->

> Step 6 is runtime/E2E verification (dev servers, browser, Network tab) — out of scope for `/tackle`, which runs static gates only. Deferred to the UAT phase. The static gate (frontend + backend tsc) is green.
