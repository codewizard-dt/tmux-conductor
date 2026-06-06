# 025 — SSE Live State Stream (GET /events)

> **Depends on**: [022-fastify-status-server](022-fastify-status-server.md)
> **Blocks**: none
> **Parallel-safe with**: [023-task-queue-crud-api](023-task-queue-crud-api.md), [024-agent-management-api](024-agent-management-api.md)

## Objective

Add `GET /events` to the Fastify server — a Server-Sent Events (SSE) stream that pushes per-agent state updates to connected clients without polling. The UI subscribes once and receives diffs whenever any agent's state, queue length, or window presence changes.

## Approach

Use a poll-and-diff loop server-side (every 2 seconds): read current agent states, compare to previous snapshot, emit SSE events only for changes. This is simpler than `fs.watch` on individual state files and doesn't require inotify. SSE uses Fastify's raw reply stream with `Content-Type: text/event-stream`. No external pub/sub needed.

---

## Steps

### 1. Add SSE helpers to `scripts/dashboard/server/index.js`  <!-- agent: general-purpose -->

- [ ] Maintain a `Set<WritableStream>` of active SSE clients: `const sseClients = new Set()`
- [ ] Implement `broadcastSSE(eventName, data)`:
  ```js
  function broadcastSSE(eventName, data) {
    const msg = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`
    for (const reply of sseClients) {
      try { reply.raw.write(msg) } catch { sseClients.delete(reply) }
    }
  }
  ```

### 2. Register `GET /events` route  <!-- agent: general-purpose -->

- [ ] Set headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`
- [ ] Disable Fastify's automatic JSON serializer for this route
- [ ] Write initial comment `": connected\n\n"` to confirm stream is live
- [ ] Add `reply` to `sseClients`; remove on `req.raw` `close` event
- [ ] Never resolve the reply (keep connection open)
- [ ] Send a heartbeat comment `": ping\n\n"` every 15 seconds to prevent proxy timeouts

### 3. State polling loop  <!-- agent: general-purpose -->

- [ ] On server start, begin a `setInterval(pollAndDiff, 2000)` loop:
  - Call `buildStatusPayload()` (same logic as `GET /status`)
  - Compare to `prevSnapshot` (deep equality per agent)
  - For each agent whose state changed, call:
    ```js
    broadcastSSE('agent-update', { name, state, queuedTasks, windowPresent })
    ```
  - If session liveness changed, call:
    ```js
    broadcastSSE('session-update', { sessionAlive })
    ```
  - Update `prevSnapshot`
- [ ] Clear the interval when the process exits (`process.on('SIGTERM', ...)`)

### 4. Verification  <!-- agent: general-purpose -->

- [ ] `curl -N http://127.0.0.1:8788/events` stays open and prints `: connected`
- [ ] Manually write `busy` to a state file → within 3 seconds, the curl stream receives an `agent-update` event
- [ ] Write `idle` to the state file → another `agent-update` event arrives
- [ ] Disconnect the curl client → server removes it from `sseClients` without error
- [ ] Two simultaneous curl clients both receive the same events

---
**UAT**: [`.docs/uat/pending/025-sse-live-state-stream.uat.md`](../uat/pending/025-sse-live-state-stream.uat.md)
