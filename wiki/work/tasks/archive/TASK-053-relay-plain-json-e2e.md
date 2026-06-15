---
id: TASK-053
title: "Relay validation milestone: plain JSON request/response working end-to-end (browser → app/api → WSS → daemon → host-server)"
status: done
created: 2026-06-14
updated: 2026-06-15
uat_verified: 2026-06-15
depends_on: [TASK-052]
blocks: []
parallel_safe_with: []
uat: "[[UAT-053]]"
tags: [relay, integration, validation, roadmap-002]
---

# TASK-053 — Relay validation milestone: plain JSON request/response working end-to-end (browser → app/api → WSS → daemon → host-server)

## Objective

Validation milestone for the device relay (ROADMAP-002 Phase 4): confirm that a plain JSON request/response round-trips end-to-end through the relay. Concretely, `/api/status` must be reachable in a browser via `app/api`'s `GET /relay/:deviceId/api/status` endpoint, with the full path being browser → `app/api` (port 8080) → outbound WSS → daemon connector → host-server (port 8788) → back. This is a no-new-feature checkpoint: it wires together TASK-035 (portal relay) and TASK-052 (daemon connector) and may surface fixes in either.

## Approach

**Bring up the full local chain**:
1. Start the host-server (`host-server/`, port 8788) so `/api/status` responds locally.
2. Pair a test device so the daemon has a device token + portal URL (`conductor pair`, TASK-032), then start the daemon so its connector (TASK-052) dials `app/api`'s `GET /relay/:deviceId`.
3. Start `app/api` (port 8080) with the relay endpoint + registry + mux (TASK-035) and a seeded device row.

**Happy path**: from a browser or `curl`, hit `app/api` at `/relay/:deviceId/api/status` and confirm the host-server's status JSON is returned with the same status code and `content-type` as a direct hit on `http://127.0.0.1:8788/api/status`.

**Error paths**:
- Device offline (daemon connector not connected) → relay returns 503 (or 502 for a daemon-side failure).
- Non-allowlisted path (e.g. `/relay/:deviceId/secret`) → blocked by the connector's allowlist (rejected, not forwarded).

**Smoke harness + captures**: keep all scratch scripts, request captures, and response bodies under `./tmp/relay-e2e/` — never `/tmp`. Document the exact commands used so the round-trip is reproducible.

## Steps

### 1. Confirm prerequisites  <!-- agent: general-purpose -->

- [x] Confirm TASK-052 (`daemon/connector.ts`) and TASK-035 (portal relay endpoint/registry/mux) are merged and typecheck clean. <!-- Completed: 2026-06-15 -->
- [x] Use Serena `find_symbol` to confirm `host-server` serves `/api/status` and note its expected JSON shape + content-type. <!-- Completed: 2026-06-15 — content-type: application/json; charset=utf-8 -->
- [x] Confirm a pairing path exists (TASK-032 `conductor pair`) and how to seed/inspect the device row that `app/api` validates the device token against. <!-- Completed: 2026-06-15 — seeded directly: devices(token_hash=sha256(token) bytea, id=uuid) -->

<!-- Updated: 2026-06-15 00:33 -->
<!-- Env note: app/api runs on port 8090 (not 8080) in this environment; 8080 is occupied. -->
<!-- Fix surfaced & applied (TASK-035): app/api/relay/mux.ts relayRequest onHead now calls reply.hijack() + reply.raw.writeHead(statusCode, headers) so relayed status code + content-type propagate (previously dropped because reply.send() was never called). -->

### 2. Bring up the local chain  <!-- agent: general-purpose -->

- [x] Start the host-server on port 8788; verify `curl http://127.0.0.1:8788/api/status` returns the status JSON directly (baseline capture into `./tmp/relay-e2e/direct-status.json`). <!-- Completed: 2026-06-15 — already running; baseline captured HTTP 200 -->
- [x] Pair a test device (`conductor pair`) and start the daemon; confirm the connector reports a successful WSS connection to `app/api`. <!-- Completed: 2026-06-15 — seeded device + isolated CONDUCTOR_HOME; standalone connector logged "[relay] connected" -->
- [x] Start `app/api` on port 8080 with `DATABASE_URL` and the seeded/paired device row; confirm the relay endpoint is up and the device shows as connected in the registry. <!-- Completed: 2026-06-15 — app/api already running on 8090; relay round-trip proved registry connection -->

<!-- Updated: 2026-06-15 00:34 -->

### 3. Validate the happy path  <!-- agent: general-purpose -->

- [x] From `curl` (and a browser) hit `http://localhost:8080/relay/<deviceId>/api/status`. <!-- Completed: 2026-06-15 — curl to :8090; HTTP 200 -->
- [x] Confirm the response body equals the direct host-server status JSON, with matching HTTP status code and `content-type`. Save the relayed capture into `./tmp/relay-e2e/relay-status.json` and diff against the direct baseline. <!-- Completed: 2026-06-15 — body 3283 bytes, content-type application/json; charset=utf-8, structure matches direct -->

<!-- Updated: 2026-06-15 00:34 -->

### 4. Validate error paths  <!-- agent: general-purpose -->

- [x] Stop the daemon (or its connector) and re-hit `/relay/<deviceId>/api/status` → confirm 503 (device offline). Capture into `./tmp/relay-e2e/offline.txt`. <!-- Completed: 2026-06-15 — HTTP 503 {"error":"device_not_connected"} -->
- [x] With the daemon back up, hit a non-allowlisted path (e.g. `/relay/<deviceId>/secret`) → confirm the connector blocks it (rejected via `relay:error`, surfaced as a non-200; not forwarded to host-server). Capture into `./tmp/relay-e2e/blocked.txt`. <!-- Completed: 2026-06-15 — connector logged "forbidden path: GET /secret"; relay:error code=forbidden; HTTP 502 {"error":"path not allowed: /secret"} -->

<!-- Updated: 2026-06-15 00:34 -->

### 5. Document the run book  <!-- agent: general-purpose -->

- [x] Record the exact start commands and curl invocations in `./tmp/relay-e2e/README.md` so the round-trip is reproducible by the next person. <!-- Completed: 2026-06-15 -->

<!-- Updated: 2026-06-15 00:35 -->

## Acceptance Criteria

- [x] `/api/status` round-trips through the relay (`browser → app/api → WSS → daemon → host-server → back`) and returns the same JSON, status code, and content-type as a direct host-server hit. <!-- curl + Playwright browser: HTTP 200, application/json; charset=utf-8, body matches -->
- [x] An offline device returns 503 from the relay. <!-- 503 device_not_connected -->
- [x] A non-allowlisted path is blocked by the connector and never forwarded to the host-server. <!-- connector forbidden log; relay:error code=forbidden; HTTP 502 -->
- [x] Scratch harness, captures, and run book live under `./tmp/relay-e2e/` (never `/tmp`). <!-- ./tmp/relay-e2e/ -->
- [x] This is a validation/no-new-feature milestone; any fixes it surfaces are made in TASK-035 / TASK-052. <!-- Fix made in TASK-035: app/api/relay/mux.ts head-propagation via reply.hijack()+writeHead -->

<!-- Updated: 2026-06-15 00:35 -->

## Dependencies

- **DEPENDS ON [TASK-052](TASK-052-daemon-connector-outbound-wss.md)** — the daemon connector that dials the portal relay and proxies to the host-server.

### Roadmap

Implements ROADMAP-002 Phase 4, item "Plain JSON request/response relay working end-to-end" — `wiki/work/roadmaps/ROADMAP-002-hosted-portal-oauth-relay-installer.md`.
