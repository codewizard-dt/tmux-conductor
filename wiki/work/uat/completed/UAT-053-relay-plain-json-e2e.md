---
id: UAT-053
title: "UAT: Relay plain JSON request/response working end-to-end"
status: passed
task: TASK-053
created: 2026-06-15
updated: 2026-06-15
---

# UAT-053 — UAT: Relay plain JSON request/response working end-to-end

implements::[[TASK-053]]

> **Source task**: [[TASK-053]]
> **Generated**: 2026-06-15

This UAT locks in the relay validation milestone (ROADMAP-002 Phase 4): a plain JSON request round-trips `browser/curl → app/api (relay) → outbound WSS → daemon connector → host-server → back`. It also guards the regression fixed during this milestone in `app/api/relay/mux.ts`, where the streaming response path never propagated the upstream status code / `content-type` because `reply.send()` was never called (fixed with `reply.hijack()` + `reply.raw.writeHead()`).

---

## Environment notes (this machine)

- **app/api runs on port 8090, NOT 8080** (8080 is occupied by an unrelated service). All relay curls below target `http://localhost:8090`.
- **host-server** runs on port **8788**; `GET /api/status` is the direct baseline.
- The connector allowlist permits only `/api` and `/api/*`; everything else is `forbidden`.
- Full reproducible run book and prior captures: `./tmp/relay-e2e/README.md`.

---

## Prerequisites

- [ ] host-server is running on port 8788 and `curl http://127.0.0.1:8788/api/status` returns the conductor status JSON (HTTP 200, `content-type: application/json; charset=utf-8`).
- [ ] app/api is running on port 8090 with a live `DATABASE_URL` and the relay routes mounted (`/relay/:deviceId/*`).
- [ ] A test device is seeded/paired and its UUID is exported as `DEVICE_ID` (see `./tmp/relay-e2e/README.md`; the device used during the milestone was `fad7cf38-91a7-4c3e-8ea9-d8c9c68adabe`, captured in `./tmp/relay-e2e/device-id.txt`).
- [ ] For happy-path and blocked tests: the daemon connector is running and `./tmp/relay-e2e/connector.log` shows `[relay] connected` (start via `npx tsx tmp/relay-e2e/run-connector.ts` with `CONDUCTOR_HOME=./tmp/relay-e2e/conductor-home`).
- [ ] `jq` is available for body-shape assertions.

---

## Test Cases

### UAT-API-001: Direct host-server baseline returns status JSON
- **Endpoint**: `GET http://127.0.0.1:8788/api/status`
- **Description**: Establishes the baseline the relay must match. Confirms the host-server serves the status JSON directly with the expected content-type before involving the relay.
- **Steps**:
  1. Ensure the host-server is up on 8788.
  2. Run the curl command below as-is.
- **Command**:
  ```bash
  curl -sS -D - 'http://127.0.0.1:8788/api/status' -o /dev/null
  ```
- **Expected Result**: HTTP 200, response header `content-type: application/json; charset=utf-8`. (This is the reference; the relay round-trip in UAT-API-002/003 must reproduce the same status and content-type.)
- [x] Pass <!-- 2026-06-15 -->

### UAT-API-002: Happy-path relay round-trip returns matching status, content-type, and JSON body
- **Endpoint**: `GET http://localhost:8090/relay/$DEVICE_ID/api/status`
- **Description**: Core milestone assertion. A plain JSON request relayed through `app/api → WSS → daemon → host-server` returns HTTP 200, `content-type: application/json; charset=utf-8`, and a well-formed status JSON body (the `mux.ts` head-propagation fix is what makes the status/content-type survive). The connector strips the `/relay/:deviceId` prefix so the inner path forwarded is `/api/status`.
- **Steps**:
  1. Confirm the connector is connected (`[relay] connected` in `./tmp/relay-e2e/connector.log`).
  2. Export the device id: `DEVICE_ID=$(cat ./tmp/relay-e2e/device-id.txt)`.
  3. Run the curl command below as-is.
- **Command**:
  ```bash
  curl -sS -D - "http://localhost:8090/relay/$DEVICE_ID/api/status" -o /dev/null
  ```
- **Expected Result**: HTTP **200** with header `content-type: application/json; charset=utf-8` (propagated from the host-server, NOT a bare Fastify default with missing content-type — this is the regression guard).
- [x] Pass <!-- 2026-06-15 -->

### UAT-API-003: Relayed body is valid status JSON with expected top-level keys
- **Endpoint**: `GET http://localhost:8090/relay/$DEVICE_ID/api/status`
- **Description**: Verifies the relayed body is the host-server's actual status JSON (not an error envelope), by asserting the presence of the documented top-level fields `session`, `agents`, and `timestamp`.
- **Steps**:
  1. Confirm the connector is connected.
  2. Export `DEVICE_ID=$(cat ./tmp/relay-e2e/device-id.txt)`.
  3. Run the curl command below as-is.
- **Command**:
  ```bash
  curl -sS "http://localhost:8090/relay/$DEVICE_ID/api/status" | jq '{session, agents: (.agents | type), timestamp}'
  ```
- **Expected Result**: `jq` emits an object where `session` is a string (e.g. `"conductor"`), `agents` is `"array"`, and `timestamp` is a non-null ISO string. No `error` key. The shape matches the direct baseline body in `./tmp/relay-e2e/direct-status.json`.
- [x] Pass <!-- 2026-06-15 -->

### UAT-EDGE-001: Offline device returns 503 device_not_connected
- **Scenario**: The relay is hit for a device whose daemon connector is not connected. `getDeviceWs` returns undefined, so the mux short-circuits before forwarding.
- **Steps**:
  1. Stop the connector: `pkill -f "tmp/relay-e2e/run-connector.ts"` (and confirm no `[relay] connected` socket remains).
  2. Export `DEVICE_ID=$(cat ./tmp/relay-e2e/device-id.txt)`.
  3. Run the curl command below as-is.
- **Command**:
  ```bash
  curl -sS -o /dev/null -w '%{http_code}' "http://localhost:8090/relay/$DEVICE_ID/api/status"
  ```
- **Expected Result**: HTTP **503**. The body (fetch separately if desired) is `{"error":"device_not_connected"}` with `content-type: application/json; charset=utf-8`. The request is never forwarded to the host-server.
- [x] Pass <!-- 2026-06-15 -->

### UAT-EDGE-002: Non-allowlisted path is blocked by the connector (502 / forbidden), never forwarded
- **Scenario**: With the daemon connected, a path outside the `/api` allowlist (`/secret`) is requested. The connector's path map returns forbidden, replies with `relay:error code=forbidden`, and the request is never proxied to the host-server. The mux surfaces this as a 502.
- **Steps**:
  1. Restart the connector and confirm `[relay] connected` in `./tmp/relay-e2e/connector.log`.
  2. Export `DEVICE_ID=$(cat ./tmp/relay-e2e/device-id.txt)`.
  3. Run the curl command below as-is.
  4. (Optional) Confirm `./tmp/relay-e2e/connector.log` shows `[relay] forbidden path: GET /secret`.
- **Command**:
  ```bash
  curl -sS -w '\n%{http_code}\n' "http://localhost:8090/relay/$DEVICE_ID/secret"
  ```
- **Expected Result**: HTTP **502** with body `{"error":"path not allowed: /secret","code":"forbidden"}`. The connector logs a `forbidden path: GET /secret` entry; the host-server never sees the request.
- [x] Pass <!-- 2026-06-15 -->

---

## Gaps / Not Covered

- The browser (Playwright) variant of the happy path is verified equivalently by UAT-API-002/003 over curl; no separate browser test is included since the assertion (status + content-type + body) is identical and the original milestone confirmed the Playwright fetch matched curl.
- Timeout (504) and in-flight-cap (`too_many_in_flight`, 503) paths in `mux.ts` are out of scope for this validation milestone (no-new-feature checkpoint) and not asserted here.
