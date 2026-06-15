---
id: TASK-035
title: "app/api WS relay endpoint, user-first connection registry, and mux (request lifecycle, fail-all-pending on drop, in-flight caps, timeouts)"
status: done
created: 2026-06-13
updated: 2026-06-14
depends_on: [TASK-033, TASK-034]
blocks: []
parallel_safe_with: []
uat: "[[UAT-035]]"
tags: [portal, relay, websocket, mux, registry, roadmap-002]
---

# TASK-035 — app/api WS relay endpoint, user-first connection registry, and mux (request lifecycle, fail-all-pending on drop, in-flight caps, timeouts)

## Objective

Add the `app/api` WebSocket relay infrastructure (ROADMAP-002 Phase 4, second item): a `GET /relay/:deviceId` WebSocket upgrade endpoint (authenticated: the daemon connects here after pairing, presenting its device token as a Bearer token in the `Authorization` header), a user-first in-memory connection registry (one active connection per device; a second connect for the same device closes the first), and a request multiplexer that fans out incoming HTTP requests from browser clients (`GET /relay/:deviceId/...`) over the WS channel to the daemon and streams responses back — tracking in-flight correlation IDs, enforcing per-connection in-flight caps, handling timeouts, and failing all pending requests when the WS drops.

This task also replaces the stubs in `app/api/relay/registry.ts` (from TASK-033) with the real `isDeviceConnected` and `closeRelayConnection` implementations.

## Approach

**Device auth on WS upgrade**: the daemon sends `Authorization: Bearer <deviceToken>` on the WS handshake. `app/api` validates it: SHA-256 hash the raw token, query `SELECT id, user_id FROM devices WHERE token_hash = $1 AND revoked_at IS NULL`, reject with 401/403 if not found or revoked. `user_id` in the `devices` table is a FK to the better-auth `"user"(id)` table.

**Connection registry** (`app/api/relay/registry.ts` — replaces stubs from TASK-033):
- `Map<deviceId, WebSocket>` — one active WS per device.
- `register(deviceId, ws)` — if a prior WS for this device exists, close it (sends a `relay:error` frame for all in-flight, then `ws.close()`), then store the new one.
- `deregister(deviceId)` — removes the entry.
- `isDeviceConnected(deviceId)` — checks the Map (replaces stub).
- `closeRelayConnection(deviceId)` — closes the WS if present and deregisters (replaces stub).

**Request mux** (`app/api/relay/mux.ts`): HTTP requests to `GET|POST|... /relay/:deviceId/<path>` are forwarded to the registered daemon WS:
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

**`@fastify/websocket`** is the Fastify plugin for WS upgrade handling — add it to `app/api/package.json`.

**Single-instance constraint**: the registry is in-process memory. `deploy/do-app.yaml` already sets `instance_count: 1`; add a comment here referencing that.

## Steps

### 1. Confirm prerequisites  <!-- agent: general-purpose -->

- [x] Use Serena `list_dir` on `app/api/relay/` to confirm `registry.ts` stub from TASK-033 exists. Note the current `isDeviceConnected` and `closeRelayConnection` stub signatures.
- [x] Use Serena `list_dir` on `app/api/` to confirm the app entry (`app/api/index.ts`) and that better-auth is wired (from TASK-030 — needed to validate sessions on WS upgrades too).
- [x] Check whether `@fastify/websocket` is already in `app/api/package.json`; if not, add it in Step 2.
- [x] Confirm `shared/relay-protocol.ts` from TASK-034 exists (repo root — did not move).

### 2. Add `@fastify/websocket` dependency  <!-- agent: general-purpose -->

- [x] Edit `app/api/package.json` to add `"@fastify/websocket": "^8"` (or latest `^8.x`) to `dependencies`.
- [x] Run `npm install` in `app/api/` to update the lockfile.

### 3. Implement `app/api/relay/registry.ts` (replace stubs)  <!-- agent: general-purpose -->

- [x] Rewrite `app/api/relay/registry.ts` with a module-level `Map<string, WebSocket>` and `Map<string, Map<string, InFlightEntry>>` (correlationId → {resolve, reject, timeout}) for in-flight requests.
- [x] Export: `register(deviceId: string, ws: WebSocket): void`, `deregister(deviceId: string): void`, `isDeviceConnected(deviceId: string): boolean`, `closeRelayConnection(deviceId: string): void`, `getDeviceWs(deviceId: string): WebSocket | undefined`.
- [x] In `register`: if a prior WS exists for `deviceId`, send a `relay:error` frame for each pending in-flight correlation (reject them with a 503 error), then call `ws.close()` on the old WS before storing the new one.
- [x] Add a comment: `// Single-instance only — registry is in-memory; deploy/app.yaml instance_count:1. Phase 5 pub/sub required before horizontal scale.`
- [x] Import `WebSocket` from `ws` (`@fastify/websocket` re-exports it via `SocketStream.socket`); import relay frame types from `shared/relay-protocol.ts` (repo root — did not move).

### 4. Implement `app/api/relay/mux.ts` (request forwarding)  <!-- agent: general-purpose -->

- [x] Create `app/api/relay/mux.ts` exporting `async function relayRequest(deviceId: string, req: FastifyRequest, reply: FastifyReply): Promise<void>`.
- [x] Look up WS via `getDeviceWs(deviceId)` — if absent, return 503 `{error: 'device_not_connected'}`.
- [x] Enforce in-flight cap (20) per device — 503 `{error: 'too_many_in_flight'}` if exceeded.
- [x] Generate `correlationId = crypto.randomUUID()`.
- [x] Read request body as Buffer (Fastify's `req.body` in raw mode); base64-encode if present.
- [x] Send `relay:request` frame via `ws.send(JSON.stringify(frame))`.
- [x] Register the correlation in the in-flight map with a 30-second `setTimeout` that sends `relay:cancel` and rejects with 504.
- [x] Return a `Promise` that resolves by streaming the response chunks back to `reply` using `reply.raw.write` / `reply.raw.end`. On `relay:response:head` set status + headers; on `relay:body:chunk` decode + write; on `relay:response:end` end the stream; on `relay:error` call `reply.code(502).send(...)`.

### 5. Implement the WS relay endpoint in `app/api/routes/relay.ts`  <!-- agent: general-purpose -->

- [x] Create `app/api/routes/relay.ts` as a Fastify plugin using `@fastify/websocket`.
- [x] Register `GET /relay/:deviceId` as a WebSocket route.
- [x] In the connection handler: extract `Authorization: Bearer <token>` from request headers. Hash the token and validate against `devices` table. On failure, `connection.socket.close(1008, 'Unauthorized')` and return.
- [x] On successful auth: call `registry.register(deviceId, connection.socket)`.
- [x] On `message` (incoming frame from daemon): parse JSON, validate type is OutboundFrame — if invalid, log + ignore. Route `relay:response:head` / `relay:body:chunk` / `relay:response:end` / `relay:error` to the matching in-flight entry in the mux.
- [x] On `close`: call `registry.deregister(deviceId)` and fail all pending in-flight for that device with 503.
- [x] Register HTTP catch-all: `app.route({ method: [...], url: '/relay/:deviceId/*', handler: relayRequest })`.
- [x] Register the plugin in `app/api/index.ts`.

### 6. Typecheck  <!-- agent: general-purpose -->

- [x] Run `npx tsc --noEmit` from `app/api/` — zero type errors.

### 7. Integration smoke test (if a live daemon connection is available)  <!-- agent: general-purpose -->

- [ ] Boot `app/api` with `DATABASE_URL` and a seeded device row (with `user_id` FK referencing a better-auth `"user"` row).
- [ ] Connect a mock WS client (e.g. `wscat` or a small Node script in `./tmp/relay-smoke/`) presenting a valid `Authorization: Bearer <token>` → confirm connection accepted (no close).
- [ ] Confirm `isDeviceConnected(deviceId)` returns `true` via `GET /api/devices` response.
- [ ] Send a synthetic `relay:request` frame to the mock client; have it reply with `relay:response:head` + `relay:response:end` → confirm the HTTP caller gets a 200.
- [ ] Disconnect the mock WS → confirm `isDeviceConnected(deviceId)` returns `false` and any pending in-flight requests return 503.
- [ ] Scratch output under `./tmp/relay-smoke/`. Never `/tmp`.

## Acceptance Criteria

- [x] `GET /relay/:deviceId` upgrades to WebSocket; authenticates via `token_hash`; rejects with 401/403 for unknown/revoked devices.
- [x] Registry stores one WS per device; a second connection for the same device closes the first and fails its in-flight requests.
- [x] `relayRequest` forwards HTTP requests as `relay:request` frames; streams `relay:body:chunk` data back; completes on `relay:response:end`; 502 on `relay:error`; 504 on 30s timeout.
- [x] WS close fails all pending in-flight with 503 and deregisters the device.
- [x] `isDeviceConnected` and `closeRelayConnection` in `app/api/relay/registry.ts` are real implementations (stubs replaced).
- [x] `npx tsc --noEmit` from `app/api/` passes with zero errors.

## Dependencies

- **DEPENDS ON [TASK-033](TASK-033-portal-devices-api.md)** — `app/api/relay/registry.ts` stub exists; `devices` table (with `user_id` FK to better-auth `"user"(id)`) + device token validation query pattern.
- **DEPENDS ON [TASK-034](TASK-034-shared-relay-protocol-ts.md)** — `shared/relay-protocol.ts` frame types and `isInboundRelayFrame` guard (repo root — did not move).

### Roadmap

Implements ROADMAP-002 Phase 4, item "Portal WS endpoint, user-first connection registry, and mux (request lifecycle, fail-all-pending on drop, in-flight caps, timeouts)" — `wiki/work/roadmaps/ROADMAP-002-hosted-portal-oauth-relay-installer.md`.
