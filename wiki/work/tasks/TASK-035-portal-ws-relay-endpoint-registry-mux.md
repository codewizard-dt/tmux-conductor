---
id: TASK-035
title: "Portal WS relay endpoint, user-first connection registry, and mux (request lifecycle, fail-all-pending on drop, in-flight caps, timeouts)"
status: todo
created: 2026-06-13
updated: 2026-06-13
depends_on: [TASK-033, TASK-034]
blocks: []
parallel_safe_with: []
uat: ""
tags: [portal, relay, websocket, mux, registry, roadmap-002]
---

# TASK-035 — Portal WS relay endpoint, user-first connection registry, and mux (request lifecycle, fail-all-pending on drop, in-flight caps, timeouts)

## Objective

Add the portal's WebSocket relay infrastructure (ROADMAP-002 Phase 4, second item): a `GET /relay/:deviceId` WebSocket upgrade endpoint (authenticated: the daemon connects here after pairing, presenting its device token as a Bearer token in the `Authorization` header), a user-first in-memory connection registry (one active connection per device; a second connect for the same device closes the first), and a request multiplexer that fans out incoming HTTP requests from browser clients (`GET /relay/:deviceId/...`) over the WS channel to the daemon and streams responses back — tracking in-flight correlation IDs, enforcing per-connection in-flight caps, handling timeouts, and failing all pending requests when the WS drops.

This task also replaces the stubs in `portal/relay/registry.ts` (from TASK-033) with the real `isDeviceConnected` and `closeRelayConnection` implementations.

## Approach

**Device auth on WS upgrade**: the daemon sends `Authorization: Bearer <deviceToken>` on the WS handshake. The portal validates it: SHA-256 hash the raw token, query `SELECT id, user_id FROM devices WHERE token_hash = $1 AND revoked_at IS NULL`, reject with 401/403 if not found or revoked.

**Connection registry** (`portal/relay/registry.ts` — replaces stubs):
- `Map<deviceId, WebSocket>` — one active WS per device.
- `register(deviceId, ws)` — if a prior WS for this device exists, close it (sends a `relay:error` frame for all in-flight, then `ws.close()`), then store the new one.
- `deregister(deviceId)` — removes the entry.
- `isDeviceConnected(deviceId)` — checks the Map (replaces stub).
- `closeRelayConnection(deviceId)` — closes the WS if present and deregisters (replaces stub).

**Request mux** (`portal/relay/mux.ts`): HTTP requests to `GET|POST|... /relay/:deviceId/<path>` are forwarded to the registered daemon WS:
1. Look up the device's WS in the registry — 503 if not connected.
2. Generate a `correlationId` (UUID v4).
3. Send a `relay:request` frame: `{ type, correlationId, method, path, headers, body? }`. Body is read as a Buffer and base64-encoded.
4. Register the `correlationId` in an in-flight Map: `{ resolve, reject, timeout, statusCode, headersSet }`.
5. Enforce per-device in-flight cap (e.g. 20 concurrent requests) — 503 if exceeded.
6. Set a per-request timeout (e.g. 30s) — on expiry send `relay:cancel` and reject with 504.
7. On incoming `relay:response:head` for this `correlationId`: set response status + headers on the Fastify reply, begin streaming.
8. On `relay:body:chunk`: decode base64 and write to the reply.
9. On `relay:response:end`: close the reply stream; remove from in-flight.
10. On `relay:error`: reject with 502; remove from in-flight.
11. On WS close: fail all pending requests for that device with 503; call `deregister(deviceId)`.

**`@fastify/websocket`** is the Fastify plugin for WS upgrade handling — add it to `portal/package.json`.

**Single-instance constraint**: the registry is in-process memory. `deploy/do-app.yaml` already sets `instance_count: 1`; add a comment here referencing that.

## Steps

### 1. Confirm prerequisites  <!-- agent: general-purpose -->

- [ ] Use Serena `list_dir` on `portal/relay/` to confirm `registry.ts` stub from TASK-033 exists. Note the current `isDeviceConnected` and `closeRelayConnection` stub signatures.
- [ ] Use Serena `list_dir` on `portal/` to confirm the app entry (`portal/index.ts`), and that `@fastify/cookie` + `jose` are in `portal/package.json` (from TASK-030 — needed to parse the `tc_session` cookie on WS upgrades too).
- [ ] Check whether `@fastify/websocket` is already in `portal/package.json`; if not, add it in Step 2.
- [ ] Confirm `shared/relay-protocol.ts` from TASK-034 exists.

### 2. Add `@fastify/websocket` dependency  <!-- agent: general-purpose -->

- [ ] Edit `portal/package.json` to add `"@fastify/websocket": "^8"` (or latest `^8.x`) to `dependencies`.
- [ ] Run `npm install` in `portal/` to update the lockfile.

### 3. Implement `portal/relay/registry.ts` (replace stubs)  <!-- agent: general-purpose -->

- [ ] Rewrite `portal/relay/registry.ts` with a module-level `Map<string, WebSocket>` and `Map<string, Map<string, InFlightEntry>>` (correlationId → {resolve, reject, timeout}) for in-flight requests.
- [ ] Export: `register(deviceId: string, ws: WebSocket): void`, `deregister(deviceId: string): void`, `isDeviceConnected(deviceId: string): boolean`, `closeRelayConnection(deviceId: string): void`, `getDeviceWs(deviceId: string): WebSocket | undefined`.
- [ ] In `register`: if a prior WS exists for `deviceId`, send a `relay:error` frame for each pending in-flight correlation (reject them with a 503 error), then call `ws.close()` on the old WS before storing the new one.
- [ ] Add a comment: `// Single-instance only — registry is in-memory; deploy/do-app.yaml instance_count:1. Phase 5 pub/sub required before horizontal scale.`
- [ ] Import `WebSocket` from `@fastify/websocket` or `ws` (whichever `@fastify/websocket` re-exports); import relay frame types from `shared/relay-protocol.js`.

### 4. Implement `portal/relay/mux.ts` (request forwarding)  <!-- agent: general-purpose -->

- [ ] Create `portal/relay/mux.ts` exporting `async function relayRequest(deviceId: string, req: FastifyRequest, reply: FastifyReply): Promise<void>`.
- [ ] Look up WS via `getDeviceWs(deviceId)` — if absent, return 503 `{error: 'device_not_connected'}`.
- [ ] Enforce in-flight cap (20) per device — 503 `{error: 'too_many_in_flight'}` if exceeded.
- [ ] Generate `correlationId = crypto.randomUUID()`.
- [ ] Read request body as Buffer (Fastify's `req.body` in raw mode); base64-encode if present.
- [ ] Send `relay:request` frame via `ws.send(JSON.stringify(frame))`.
- [ ] Register the correlation in the in-flight map with a 30-second `setTimeout` that sends `relay:cancel` and rejects with 504.
- [ ] Return a `Promise` that resolves by streaming the response chunks back to `reply` using Fastify's reply pipe (or `reply.raw.write` / `reply.raw.end` for streaming). On `relay:response:head` set status + headers; on `relay:body:chunk` decode + write; on `relay:response:end` end the stream; on `relay:error` call `reply.code(502).send(...)`.

### 5. Implement the WS relay endpoint in `portal/routes/relay.ts`  <!-- agent: general-purpose -->

- [ ] Create `portal/routes/relay.ts` as a Fastify plugin using `@fastify/websocket`.
- [ ] Register `GET /relay/:deviceId` as a WebSocket route.
- [ ] In the connection handler: extract `Authorization: Bearer <token>` from `connection.socket.upgradeReq.headers` (or the handshake req). Hash the token and validate against `devices` table (same query as TASK-031 credentialing). On failure, `socket.close(1008, 'Unauthorized')` and return.
- [ ] On successful auth: call `registry.register(deviceId, socket)`.
- [ ] On `message` (incoming frame from daemon): parse JSON, validate with `isInboundRelayFrame` — if invalid, log + ignore. Route `relay:response:head` / `relay:body:chunk` / `relay:response:end` / `relay:error` to the matching in-flight entry in the mux.
- [ ] On `close`: call `registry.deregister(deviceId)` and fail all pending in-flight for that device with 503.
- [ ] Register HTTP catch-all: `app.all('/relay/:deviceId/*', relayRequest)` — the mux forwards to the daemon.
- [ ] Register the plugin in `portal/index.ts`.

### 6. Typecheck  <!-- agent: general-purpose -->

- [ ] Run `npx tsc --noEmit` from `portal/` — zero type errors.

### 7. Integration smoke test (if a live daemon connection is available)  <!-- agent: general-purpose -->

- [ ] Boot the portal with `DATABASE_URL` and a seeded device row.
- [ ] Connect a mock WS client (e.g. `wscat` or a small Node script in `./tmp/relay-smoke/`) presenting a valid `Authorization: Bearer <token>` → confirm connection accepted (no close).
- [ ] Confirm `isDeviceConnected(deviceId)` returns `true` via `GET /api/devices` response.
- [ ] Send a synthetic `relay:request` frame to the mock client; have it reply with `relay:response:head` + `relay:response:end` → confirm the HTTP caller gets a 200.
- [ ] Disconnect the mock WS → confirm `isDeviceConnected(deviceId)` returns `false` and any pending in-flight requests return 503.
- [ ] Scratch output under `./tmp/relay-smoke/`. Never `/tmp`.

## Acceptance Criteria

- [ ] `GET /relay/:deviceId` upgrades to WebSocket; authenticates via `token_hash`; rejects with 401/403 for unknown/revoked devices.
- [ ] Registry stores one WS per device; a second connection for the same device closes the first and fails its in-flight requests.
- [ ] `relayRequest` forwards HTTP requests as `relay:request` frames; streams `relay:body:chunk` data back; completes on `relay:response:end`; 502 on `relay:error`; 504 on 30s timeout.
- [ ] WS close fails all pending in-flight with 503 and deregisters the device.
- [ ] `isDeviceConnected` and `closeRelayConnection` in `portal/relay/registry.ts` are real implementations (stubs replaced).
- [ ] `npx tsc --noEmit` passes with zero errors.

## Dependencies

- **DEPENDS ON [TASK-033](TASK-033-portal-devices-api.md)** — `portal/relay/registry.ts` stub exists; `devices` table + device token validation query pattern.
- **DEPENDS ON [TASK-034](TASK-034-shared-relay-protocol-ts.md)** — `shared/relay-protocol.ts` frame types and `isInboundRelayFrame` guard.

### Roadmap

Implements ROADMAP-002 Phase 4, item "Portal WS endpoint, user-first connection registry, and mux (request lifecycle, fail-all-pending on drop, in-flight caps, timeouts)" — `wiki/work/roadmaps/ROADMAP-002-hosted-portal-oauth-relay-installer.md`.
