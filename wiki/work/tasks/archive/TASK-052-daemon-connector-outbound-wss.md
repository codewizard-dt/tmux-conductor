---
id: TASK-052
title: "Daemon connector: outbound WSS client to app/api relay with reconnect/backoff and path-allowlisted proxying"
status: done
created: 2026-06-14
updated: 2026-06-14
depends_on: [TASK-032, TASK-035]
blocks: []
parallel_safe_with: []
uat: "[[UAT-052]]"
tags: [daemon, relay, websocket, connector, roadmap-002]
---

# TASK-052 — Daemon connector: outbound WSS client to app/api relay with reconnect/backoff and path-allowlisted proxying

## Objective

Implement `daemon/connector.ts` — the outbound WebSocket Secure (WSS) client that runs on the user's machine and dials `app/api`'s `GET /relay/:deviceId` endpoint (built in TASK-035). Because the connection is outbound, no inbound ports are needed on the user's machine. The connector authenticates with the device token (from `daemon/credentials.ts`, TASK-032) as an `Authorization: Bearer` header, maintains the connection with reconnect/backoff and silence-based reconnection, and proxies relayed requests to the local host-server (`http://127.0.0.1:8788`) and the daemon Unix socket — but only for path-allowlisted prefixes. It streams responses back to the portal per the `shared/relay-protocol.ts` frame contract (TASK-034), honoring cancel and backpressure.

## Approach

**Dial + auth**: connect to the portal WS using the device token (read via `daemon/credentials.ts`, TASK-032) in the `Authorization: Bearer <deviceToken>` header. The URL targets `GET /relay/:deviceId` on `app/api`.

**Reconnect/backoff**: reconnect with exponential backoff starting at 1s, capped at 60s, with jitter. Also reconnect on >75s of silence — this matches the portal's keepalive policy (30s ping / 2 missed pongs ≈ 60-75s). Track last-message time; if no frame (including ping/pong) arrives within the silence window, treat the socket as dead and reconnect.

**Path-allowlisted proxying**: on each inbound `relay:request` frame, enforce a path allowlist before doing any local fetch:
- `/api/*` → `http://127.0.0.1:8788` (host-server)
- `/daemon/*` → the daemon Unix socket
- any other path → reject with `relay:error` (code `forbidden` or similar); never forward.

**Streaming responses back**: perform the local fetch and stream the response to the portal as `relay:response:head` (status + headers) followed by `relay:body:chunk` frames (base64-encoded) and a terminal `relay:response:end`. For SSE responses (`text/event-stream`), flush `relay:response:head` immediately and stream chunks as they arrive — never send `relay:response:end` for a live SSE stream (it stays open until cancel/close).

**Cancel**: on an inbound `relay:cancel` frame, abort the matching in-flight local request via an `AbortController` keyed by `correlationId`.

**Backpressure**: pause reading from the local response when `ws.bufferedAmount` is high (above a threshold), and resume once it drains, so a slow portal/edge link doesn't cause unbounded memory growth.

**Errors**: send `relay:error` with an appropriate `code` (`unreachable` when the local target is down, `timeout` on local request timeout, `aborted` when cancelled) on any failure, then clean up the in-flight entry.

## Steps

### 1. Confirm prerequisites  <!-- agent: general-purpose --> <!-- Completed: 2026-06-14 -->

- [x] Use Serena `get_symbols_overview` / `list_dir` on `daemon/` to confirm `index.ts`, `launch.ts`, and `registry.ts` exist, and to learn the daemon startup wiring and Unix-socket server shape.
- [x] Read `shared/relay-protocol.ts` (TASK-034) to confirm the frame types (`RelayRequestFrame`, `RelayResponseHeadFrame`, `RelayBodyChunkFrame`, `RelayResponseEndFrame`, `RelayCancelFrame`, `RelayErrorFrame`) and guards (`isRelayFrame`, `isInboundRelayFrame`).
- [x] Read the TASK-032 deliverables (`daemon/credentials.ts`, `daemon/pair.ts`, `conductor pair`/`unpair` CLI) to confirm how the device token + portal URL are read.
- [x] Read the TASK-035 file to confirm the portal `GET /relay/:deviceId` handshake (Bearer device token), the ping/pong keepalive policy, and the inbound/outbound frame direction expected of the daemon.

<!-- Findings: daemon/ is ESM (type:module), runs via tsx with .ts-extension imports, NodeNext, strict + exactOptionalPropertyTypes + noPropertyAccessFromIndexSignature + noUncheckedIndexedAccess. Unix socket = ~/.local/share/tmux-conductor/daemon.sock (Fastify, chmod 600), SOCKET_PATH exported from index.ts. credentials.ts: readCredentials(): {portalUrl, deviceId, token} | null (device.json, portalUrl stored without trailing slash). relay-protocol.ts: discriminant field `type`; daemon RECEIVES relay:request/relay:cancel (isInboundRelayFrame), SENDS relay:response:head/relay:body:chunk/relay:response:end/relay:error. Portal route GET /relay/:deviceId ({websocket:true}); auth = Authorization: Bearer <token>, SHA-256 hash lookup, deviceId in URL must match credential. GAPS: (a) `ws` not yet a daemon dep; (b) NO ping/pong keepalive on portal side currently — connector must self-keepalive via ws ping; (c) daemon tsconfig include is ["*.ts"] only — shared import is ../shared/relay-protocol.ts, may need include update to typecheck. -->


### 2. Add the `ws` dependency  <!-- agent: general-purpose --> <!-- Completed: 2026-06-14 -->

- [x] Edit `daemon/package.json` to add `"ws": "^8"` (or latest `^8.x`) to `dependencies` (and `@types/ws` to `devDependencies` if the daemon is typed against DefinitelyTyped). <!-- ws@8.21.0, @types/ws@8.18.1 -->
- [x] Run `npm install` in `daemon/` to update the lockfile.

### 3. Implement `daemon/connector.ts`  <!-- agent: general-purpose --> <!-- Completed: 2026-06-14 -->

- [x] Create `daemon/connector.ts` exporting a `startConnector(opts)` / `RelayConnector` class that owns the WS lifecycle.
- [x] On start, read the device token + portal relay URL via `daemon/credentials.ts`; dial `GET /relay/:deviceId` with `Authorization: Bearer <deviceToken>`.
- [x] Implement exponential backoff (1s → 60s, with jitter) on close/error, and a silence watchdog that reconnects after >75s without any inbound frame.
- [x] On `message`: parse + validate with `isInboundRelayFrame`; route `relay:request` and `relay:cancel`. Ignore/log invalid frames.
- [x] Maintain a `Map<correlationId, AbortController>` for in-flight local requests.
- [x] On `relay:request`: enforce the path allowlist (`/api/*` → `http://127.0.0.1:8788`, `/daemon/*` → daemon Unix socket; reject all else with `relay:error`). Perform the local fetch with the request method/headers/body (base64-decoded), passing the `AbortController.signal`.
- [x] Stream the local response back as `relay:response:head` + `relay:body:chunk` (base64) + `relay:response:end`. For `text/event-stream`, flush head immediately and never send `relay:response:end` until the stream truly ends/cancels.
- [x] On `relay:cancel`: abort the matching `AbortController` and clean up.
- [x] Implement backpressure: pause local-response reading while `ws.bufferedAmount` exceeds a threshold; resume on drain.
- [x] Send `relay:error` with `code` (`unreachable`/`timeout`/`aborted`) on failures; remove the in-flight entry.

<!-- Decisions: /api/* forwarded as-is to host-server :8788 (host-server registers routes under prefix '/api'); /daemon/* strips the /daemon prefix → bare /sessions, /healthz on the unix socket. host-server target uses global fetch; unix-socket target uses http.request({socketPath}). Client sends ws ping every 30s; silence watchdog (15s tick) terminates after >75s without any inbound frame (portal has no server-side ping). Backpressure threshold 1 MiB. Also modified daemon/tsconfig.json: added ../shared/**/*.ts to include and changed rootDir "." → ".." (mirrors app/api/tsconfig.json) so the shared import typechecks. -->


### 4. Wire the connector into daemon startup  <!-- agent: general-purpose --> <!-- Completed: 2026-06-14 -->

- [x] In `daemon/index.ts` (or `launch.ts`), start the connector after the Unix-socket server is up, but only when a device token is present (i.e. the daemon has been paired via TASK-032). If unpaired, log and skip starting the connector.
- [x] Ensure clean shutdown stops the connector (clears timers, closes the WS).

<!-- daemon/index.ts: after fastify.listen+chmod, gate on readCredentials() !== null → startConnector() (held in module-scoped var), else log skip. Added idempotent SIGINT/SIGTERM shutdown handlers (none existed) that call connector?.stop() then await fastify.close(). -->


### 5. Typecheck  <!-- agent: general-purpose --> <!-- Completed: 2026-06-14 -->

- [x] Run `npx tsc --noEmit` from `daemon/` — zero type errors. <!-- exit 0, clean -->
<!-- Updated: 2026-06-14 -->

## Acceptance Criteria

- [ ] The connector dials `app/api` `GET /relay/:deviceId` and authenticates with the device token as `Authorization: Bearer`.
- [ ] After a drop, the connector reconnects with exponential backoff (1s → 60s + jitter), and reconnects after >75s of silence.
- [ ] Only allowlisted paths are proxied: `/api/*` → host-server :8788, `/daemon/*` → daemon Unix socket; all other paths are rejected with `relay:error`.
- [ ] Responses stream back as `relay:response:head` + `relay:body:chunk` + `relay:response:end`; SSE flushes head immediately and never sends `relay:response:end` until close.
- [ ] `relay:cancel` aborts the matching in-flight local request via `AbortController`.
- [ ] Backpressure: local read pauses when `ws.bufferedAmount` is high and resumes on drain.
- [ ] `npx tsc --noEmit` passes with zero errors.

## Dependencies

- **DEPENDS ON [TASK-032](TASK-032-daemon-pair-credentials-cli.md)** — `daemon/credentials.ts` (device token + portal URL) and the `conductor pair`/`unpair` CLI that provisions them.
- **DEPENDS ON [TASK-035](TASK-035-portal-ws-relay-endpoint-registry-mux.md)** — the portal `GET /relay/:deviceId` WS endpoint, registry, and mux the connector dials into.

### Roadmap

Implements ROADMAP-002 Phase 4, item "daemon/connector.ts: outbound WSS with reconnect/backoff, path-allowlisted proxying" — `wiki/work/roadmaps/ROADMAP-002-hosted-portal-oauth-relay-installer.md`.
