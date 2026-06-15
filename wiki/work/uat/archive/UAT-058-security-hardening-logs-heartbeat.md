---
id: UAT-058
title: "UAT: Security checklist pass + structured logs + device last-seen heartbeat"
status: passed
task: TASK-058
created: 2026-06-14
updated: 2026-06-15
---

# UAT-058 — UAT: Security checklist pass + structured logs + device last-seen heartbeat

implements::[[TASK-058]]

> **Source task**: [[TASK-058]]
> **Generated**: 2026-06-14

---

## Prerequisites

- [ ] `app/api` is running locally on port **8090** (`API_PORT=8090`), reachable at `http://localhost:8090`. Confirm with `curl -sS http://localhost:8090/healthz`.
- [ ] host-server is running on port **8788** (only needed for relay/daemon-dependent tests).
- [ ] Postgres is reachable (`DATABASE_URL`) and migrations have run (`devices`, `pairing_codes`, `invite_codes`, better-auth `user`/`session` tables exist).
- [ ] A valid better-auth session cookie/token exported as `$UAT_AUTH_TOKEN` for session-gated tests (see `/uat-auth`).
- [ ] At least one invite code seeded for the Origin-check validate test, OR accept that an unknown code returns `{ "valid": false, "error": "invalid" }` (the route still proves the Origin gate either way).
- [ ] `NODE_ENV` is **not** `production` locally (Secure-cookie enforcement is deploy-only and out of scope here — see Deferred).
- [ ] For relay/daemon tests: a paired device with a live daemon WS connection (`POST /api/pair/code` → daemon redeems → daemon connects `GET /relay/:deviceId`). These tests are marked **Setup-heavy** and require the daemon running against this `app/api`.

---

## Test Cases

### UAT-API-001: Pairing redeem is rate-limited (429 after 10/min/IP)
- **Endpoint**: `POST /api/pair/redeem`
- **Description**: The unauthenticated redeem endpoint throttles at max 10 requests per minute per IP and returns a generic 429 body (`{"error":"too_many_requests"}`) that does not leak code validity. Verifies `pair.ts` `config.rateLimit` + `index.ts` `rateLimit { global: false }`.
- **Steps**:
  1. From a single IP within one minute, run the command below **11 times in quick succession**.
  2. Observe the response on each call. Calls 1–10 return `400 {"error":"invalid_or_expired_code"}` (a bogus code is rejected uniformly). The **11th** call returns `429 {"error":"too_many_requests"}`.
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8090/api/pair/redeem' -H 'Content-Type: application/json' -d '{"code":"AAAA-BBBB-CCCC"}'
  ```
- **Expected Result**: First 10 calls → `400 {"error":"invalid_or_expired_code"}`. 11th call within the window → `429 {"error":"too_many_requests"}`. The 429 body carries no information about whether the code was valid (no oracle).
- [x] Pass <!-- 2026-06-14 -->

### UAT-API-002: Cross-site mutation is blocked (403) by the Origin check
- **Endpoint**: `POST /api/invite-codes/validate`
- **Description**: A mutating request carrying a foreign `Origin` header (and no same-site `Sec-Fetch-Site`) is rejected by the global `onRequest` Origin hook before the route runs. Verifies `security.ts` `isCrossSiteMutation` + `index.ts` `onRequest`. This route is chosen because it is public (no session needed) yet mutating (POST), so the 403 is unambiguously from the Origin gate.
- **Steps**:
  1. Run the command below with an `Origin` header pointing at an evil cross-site origin and **no** `Sec-Fetch-Site` header.
  2. Observe the response.
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8090/api/invite-codes/validate' -H 'Content-Type: application/json' -H 'Origin: https://evil.example.com' -d '{"code":"whatever"}'
  ```
- **Expected Result**: `403 {"error":"cross_site_request_blocked"}`. The request never reaches the invite-code validator (no `valid` field in the body).
- [x] Pass <!-- 2026-06-14 -->

### UAT-API-003: Same-site mutation passes the Origin check (Sec-Fetch-Site)
- **Endpoint**: `POST /api/invite-codes/validate`
- **Description**: A mutating request asserting `Sec-Fetch-Site: same-origin` passes the Origin gate even with a foreign `Origin` header present, because the browser-asserted `Sec-Fetch-Site` is trusted first. Verifies the early-return branch in `isCrossSiteMutation`.
- **Steps**:
  1. Run the command below with `Sec-Fetch-Site: same-origin`.
  2. Observe the response reaches the validator.
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8090/api/invite-codes/validate' -H 'Content-Type: application/json' -H 'Origin: https://evil.example.com' -H 'Sec-Fetch-Site: same-origin' -d '{"code":"whatever"}'
  ```
- **Expected Result**: `200` with a body shaped `{"valid":false,"error":"invalid"}` (or `{"valid":true}` if `whatever` happens to be a real seeded code). The key signal: **NOT** `403 cross_site_request_blocked` — the request passed the Origin gate and reached the route.
- [x] Pass <!-- 2026-06-14 -->

### UAT-API-004: Missing-Origin mutation passes (non-browser clients)
- **Endpoint**: `POST /api/invite-codes/validate`
- **Description**: A mutating request with **no** `Origin` header and no `Sec-Fetch-Site` (a plain non-browser client like curl) is allowed through — the gate only rejects when an Origin is present and not allowlisted. Verifies the `originHeader` absent branch in `isCrossSiteMutation`.
- **Steps**:
  1. Run the command below with no `Origin` and no `Sec-Fetch-Site` header.
  2. Observe the response reaches the validator.
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8090/api/invite-codes/validate' -H 'Content-Type: application/json' -d '{"code":"whatever"}'
  ```
- **Expected Result**: `200 {"valid":false,"error":"invalid"}` (or `{"valid":true}` for a real code). **NOT** `403`.
- [x] Pass <!-- 2026-06-14 -->

### UAT-API-005: better-auth routes are exempt from the Origin gate
- **Endpoint**: `POST /api/auth/sign-in/email`
- **Description**: `/api/auth/*` is explicitly skipped by the global Origin hook (better-auth has its own `trustedOrigins` CSRF protection), so a cross-site `Origin` on an auth route does NOT produce the custom `cross_site_request_blocked` 403. Verifies the `request.url.startsWith('/api/auth/')` early return in `index.ts`.
- **Steps**:
  1. Run the command below with a foreign `Origin` against an auth route, using deliberately bogus credentials.
  2. Confirm the response is an auth-layer error (401/400/422-style from better-auth), **not** the custom `cross_site_request_blocked` 403.
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8090/api/auth/sign-in/email' -H 'Content-Type: application/json' -H 'Origin: https://evil.example.com' -d '{"email":"nobody@example.com","password":"wrong-password"}'
  ```
- **Expected Result**: A better-auth response (e.g. `401`/`400` invalid credentials, or a better-auth `INVALID_ORIGIN` if its own trustedOrigins rejects it). The body is **NOT** `{"error":"cross_site_request_blocked"}` — proving the custom gate did not fire on this path.
- [x] Pass <!-- 2026-06-14 -->

### UAT-API-006: Request body cap rejects oversized payloads (413)
- **Endpoint**: `POST /api/invite-codes/validate`
- **Description**: Fastify is configured with `bodyLimit = 27_262_976` (26 MiB). A body exceeding that is rejected with `413 Payload Too Large` before the handler runs. Verifies `BODY_LIMIT_BYTES` in `index.ts`. (Use a same-site header so the Origin gate does not pre-empt the body-limit check.)
- **Steps**:
  1. Generate a >26 MiB JSON body and POST it.
  2. Observe the 413 response.
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8090/api/invite-codes/validate' -H 'Content-Type: application/json' -H 'Sec-Fetch-Site: same-origin' --data-binary @<(python3 -c "print('{\"code\":\"' + 'A'*27300000 + '\"}')")
  ```
- **Expected Result**: `413` with a Fastify payload-too-large error (`{"statusCode":413,...,"message":"Request body is too large"}` or similar `FST_ERR_CTP_BODY_TOO_LARGE`). The request is rejected by the body cap, not processed.
- [x] Pass <!-- 2026-06-14 -->

### UAT-API-007: Unauthenticated device listing returns 401
- **Endpoint**: `GET /api/devices`
- **Description**: The devices routes require a better-auth session; with no session the guard returns `401 {"error":"unauthenticated"}`. Establishes the auth baseline that the 404-ownership test builds on. Verifies `requireAllowed` in `devices.ts`.
- **Steps**:
  1. Run the command below with no auth.
  2. Observe the 401.
- **Command**:
  ```bash
  curl -sS 'http://localhost:8090/api/devices'
  ```
- **Expected Result**: `401 {"error":"unauthenticated"}`.
- [x] Pass <!-- 2026-06-14 -->

### UAT-API-008: Device ownership failure returns 404 (no enumeration)
- **Endpoint**: `DELETE /api/devices/:id`
- **Description**: Revoking a device that does not belong to the signed-in user (non-existent or owned by another user) returns `404 {"error":"not_found"}` — never 403 — so existence is not leaked across users. Verifies the `WHERE id = $1 AND user_id = $2` ownership scope returning uniform 404 in `devices.ts`.
- **Auth-Required**: true
- **Auth-Role**: user
- **Steps**:
  1. Authenticate and export `$UAT_AUTH_TOKEN` (see `/uat-auth`).
  2. Run the command below against a random UUID that the signed-in user does not own.
  3. Observe the uniform 404.
- **Command**:
  ```bash
  curl -sS -X DELETE 'http://localhost:8090/api/devices/00000000-0000-0000-0000-000000000000' -H "Authorization: Bearer $UAT_AUTH_TOKEN" -H 'Sec-Fetch-Site: same-origin'
  ```
- **Expected Result**: `404 {"error":"not_found"}` (same response shape whether the id is non-existent or owned by another user — no 403, no oracle).
- [x] Pass <!-- 2026-06-14 -->

### UAT-API-009: Admin-only invite-code listing forbids non-admin sessions (403)
- **Endpoint**: `GET /api/admin/invite-codes`
- **Description**: The admin invite-code routes gate on the session email matching `BOOTSTRAP_ADMIN_EMAIL`; a valid non-admin session gets `403 {"error":"forbidden"}`, and no session gets `401`. Verifies `requireAdmin` in `invite-codes.ts` gates on session + admin email only (NOT on emailVerified — confirm no `email_not_verified` error appears).
- **Auth-Required**: true
- **Auth-Role**: user
- **Steps**:
  1. Authenticate as a **non-admin** user and export `$UAT_AUTH_TOKEN`.
  2. Run the command below.
  3. Confirm the error is `forbidden`, NOT `email_not_verified`.
- **Command**:
  ```bash
  curl -sS 'http://localhost:8090/api/admin/invite-codes' -H "Authorization: Bearer $UAT_AUTH_TOKEN"
  ```
- **Expected Result**: `403 {"error":"forbidden"}` for a non-admin session (or `401 {"error":"unauthorized"}` if the token is absent/invalid). The body is **never** `{"error":"email_not_verified"}` — the removed email-verification gate must not be present.
- [x] Pass <!-- 2026-06-14 -->

### UAT-EDGE-001: Relay strips Cookie/Authorization/Set-Cookie in both directions
- **Endpoint**: `GET /relay/:deviceId/api/status` (forwarded to host-server via the daemon)
- **Description**: The relay header safelist (`HOP_BY_HOP` in `mux.ts`, `sanitizeHeaders` in `daemon/connector.ts`) must drop `cookie` + `authorization` on the request leg (portal → daemon → host-server) and `set-cookie` + `authorization` on the response leg. Verifies neither credential leaks across the relay boundary.
- **Setup-heavy**: requires a paired device + live daemon connected to this `app/api`, and a host-server endpoint that echoes received request headers (or daemon-side logging of the headers it re-issues).
- **Auth-Required**: true
- **Auth-Role**: user
- **Steps**:
  1. Pair a device and bring up the daemon so `GET /api/devices` shows it `connected: true`.
  2. Issue a relayed request through the portal carrying a `Cookie` and `Authorization` header.
  3. On the host-server side (or daemon re-issue logging), inspect the headers actually received.
  4. Inspect the response headers returned to the original caller for any `Set-Cookie`.
- **Command**:
  ```bash
  curl -sS -i 'http://localhost:8090/relay/REPLACE_DEVICE_ID/api/status' -H "Authorization: Bearer $UAT_AUTH_TOKEN" -H 'Cookie: better-auth.session_token=fake; other=1' -H 'Sec-Fetch-Site: same-origin'
  ```
- **Expected Result**: The host-server receives the forwarded request with **no** `cookie` and **no** `authorization` header. The response returned to curl contains **no** `set-cookie` header. The relayed request itself still succeeds (status from host-server, e.g. 200) — only the sensitive headers are stripped.
- [x] Pass <!-- 2026-06-14 -->

### UAT-EDGE-002: Revoke closes the relay WS with code 4001 and the daemon stops
- **Endpoint**: `DELETE /api/devices/:id` (own device)
- **Description**: Revoking an owned, connected device sets `revoked_at`, closes its live relay WS with application close code **4001** (`RELAY_CLOSE_REVOKED`), and the daemon stops without reconnecting. Verifies `closeRelayConnection` (`registry.ts`) uses 4001 and the daemon's `ws.on('close')` handler stops on 4001 (`daemon/connector.ts`).
- **Setup-heavy**: requires a paired device with a live daemon connection.
- **Auth-Required**: true
- **Auth-Role**: user
- **Steps**:
  1. Pair + connect a device; confirm `GET /api/devices` shows `connected: true` for it.
  2. Tail the daemon logs.
  3. Run the revoke command below for that device id.
  4. Observe the daemon disconnect log and that it does NOT schedule a reconnect.
- **Command**:
  ```bash
  curl -sS -X DELETE 'http://localhost:8090/api/devices/REPLACE_DEVICE_ID' -H "Authorization: Bearer $UAT_AUTH_TOKEN" -H 'Sec-Fetch-Site: same-origin'
  ```
- **Expected Result**: `204 No Content`. The daemon logs `[relay] disconnected (code 4001)` then `[relay] device revoked, stopping`, and there is **no** subsequent `[relay] reconnecting in …` line. A second `DELETE` of the same id returns `404 {"error":"not_found"}` (idempotent revoke).
- [x] Pass <!-- 2026-06-14 -->

### UAT-EDGE-003: In-flight cap rejects the 65th concurrent relayed request (503)
- **Endpoint**: `GET /relay/:deviceId/...` (concurrent)
- **Description**: The mux enforces `MAX_IN_FLIGHT = 64` per device; the 65th concurrent in-flight relayed request is rejected with `503 {"error":"too_many_in_flight"}`. Verifies the in-flight cap in `mux.ts`.
- **Setup-heavy**: requires a paired+connected device and a host-server endpoint slow enough to hold 64 requests open concurrently (e.g. a long-poll / SSE path).
- **Auth-Required**: true
- **Auth-Role**: user
- **Steps**:
  1. Pair + connect a device.
  2. Open 64 concurrent relayed requests to a slow/long-lived host-server path so they stay in-flight.
  3. Fire a 65th relayed request while the 64 are still open.
- **Command**:
  ```bash
  curl -sS 'http://localhost:8090/relay/REPLACE_DEVICE_ID/api/events' -H "Authorization: Bearer $UAT_AUTH_TOKEN" -H 'Sec-Fetch-Site: same-origin'
  ```
- **Expected Result**: With 64 already in-flight, the 65th returns `503 {"error":"too_many_in_flight"}`. (A request to a device with no live daemon returns `503 {"error":"device_not_connected"}` instead — distinct error code.)
- [x] Pass <!-- 2026-06-14 -->

### UAT-EDGE-004: Hard time-to-head timeout fires at ~30s (504) without a head frame
- **Endpoint**: `GET /relay/:deviceId/...` (no response head)
- **Description**: A relayed request that never receives a `relay:response:head` within `HEAD_TIMEOUT_MS = 30_000` is cancelled (a `relay:cancel` is sent to the daemon) and the caller receives `504 {"error":"relay_timeout",...}`. The timer is cleared (not rearmed) once a head arrives, so streaming bodies are not killed. Verifies `onTimeout` + `HEAD_TIMEOUT_MS` in `mux.ts`.
- **Setup-heavy**: requires a paired+connected device and a host-server path that stalls before producing any response head for ≥30s.
- **Auth-Required**: true
- **Auth-Role**: user
- **Steps**:
  1. Pair + connect a device whose host-server stalls a target path before sending any head.
  2. Issue the relayed request and wait ~30s.
- **Command**:
  ```bash
  curl -sS --max-time 40 'http://localhost:8090/relay/REPLACE_DEVICE_ID/api/slow-no-head' -H "Authorization: Bearer $UAT_AUTH_TOKEN" -H 'Sec-Fetch-Site: same-origin'
  ```
- **Expected Result**: After ~30s the caller receives `504 {"error":"relay_timeout","correlationId":"..."}`. By contrast, a path that produces a head quickly then streams a slow body for >30s is NOT cut off (the timer is cleared on the head frame).
- [x] Pass <!-- 2026-06-14 -->

### UAT-EDGE-005: last_seen_at heartbeat updates and drives the connected flag
- **Endpoint**: `GET /api/devices` + DB inspection
- **Description**: On relay WS connect (force-write), ongoing traffic (throttled 30s), and disconnect (force-write), `touchDeviceLastSeen` writes `devices.last_seen_at = now()`. The `connected` flag in `GET /api/devices` is `isDeviceConnected(id) || last_seen within 60s` (`CONNECTED_RECENCY_MS = HEARTBEAT_THROTTLE_MS * 2`). Verifies `registry.ts` heartbeat + `devices.ts` `formatDevice`.
- **Setup-heavy**: requires a paired device and the ability to connect/disconnect its daemon WS.
- **Auth-Required**: true
- **Auth-Role**: user
- **Steps**:
  1. With the device daemon **connected**, run the command below; note `connected: true` and a recent `lastSeenAt`.
  2. Confirm `last_seen_at` advanced in the DB: `SELECT last_seen_at FROM devices WHERE id = '<id>';` shows a fresh timestamp after connect.
  3. Stop the daemon WS. Within 60s of the last heartbeat, re-run the command: `connected` may still be `true` via the recency window even though the registry no longer holds the socket.
  4. Wait >60s after the disconnect heartbeat with the daemon down, re-run: `connected` is now `false`.
- **Command**:
  ```bash
  curl -sS 'http://localhost:8090/api/devices' -H "Authorization: Bearer $UAT_AUTH_TOKEN" | jq '.[] | {id, connected, lastSeenAt}'
  ```
- **Expected Result**: While the daemon is connected, the device shows `connected: true` and a `lastSeenAt` within the last few seconds, and `SELECT last_seen_at` advances on connect. After the daemon disconnects, `connected` stays `true` for up to ~60s (recency window) then flips to `false`. `last_seen_at` is never NULL once a device has connected at least once.
- [x] Pass <!-- 2026-06-14 -->

### UAT-EDGE-006: Logs redact secrets — no tokens/cookies/authorization in output
- **Endpoint**: process log inspection (all routes)
- **Description**: The pino logger is configured with `redact { remove: true }` over cookie/authorization/set-cookie (req+res headers and bare keys) plus `token`/`code`/`password`/`secret` (top-level + one-level-nested). The relay frame-leak is fixed: bad frames log only `{deviceId, frameType}`, never the full frame; `relay:request` lines carry only `{deviceId, correlationId, method, path, status, durationMs}`. Verifies the `logger.redact` config in `index.ts`, `relay.ts` bad-frame logging, and `mux.ts` completion logging.
- **Steps**:
  1. Tail the `app/api` server stdout while running the earlier tests (especially UAT-API-001 redeem, UAT-API-005 auth sign-in, and any relay request).
  2. Search the captured log output for the literal request `Cookie` value, the `Authorization` bearer value, any pairing `code`, and any device `token`.
  3. Inspect the relay request-completion log lines.
- **Expected Result**: Captured log lines contain **no** raw cookie values, **no** `Authorization` bearer token, **no** pairing code, and **no** device token. The `req.headers.cookie` / `req.headers.authorization` fields are absent (removed, not `[Redacted]` placeholder). Relay logs show only the safe correlation fields (deviceId/correlationId/method/path/status/durationMs) and never a full frame, base64 body, or header map.
- [x] Pass <!-- 2026-06-14 -->

### UAT-EDGE-007: Daemon path allowlist rejects non-allowlisted relay paths
- **Endpoint**: `GET /relay/:deviceId/<forbidden-path>`
- **Description**: The daemon only proxies allowlisted host-server path prefixes (`/api`, `/daemon`); a relayed request for a path outside the allowlist is refused by the daemon (returns a relay:error → the portal surfaces 502/forbidden), never reaching arbitrary host-server paths. Verifies `resolveTarget` allowlist in `daemon/connector.ts`.
- **Setup-heavy**: requires a paired+connected device.
- **Auth-Required**: true
- **Auth-Role**: user
- **Steps**:
  1. Pair + connect a device.
  2. Issue a relayed request for a path outside the `/api` and `/daemon` prefixes.
- **Command**:
  ```bash
  curl -sS -i 'http://localhost:8090/relay/REPLACE_DEVICE_ID/etc/passwd' -H "Authorization: Bearer $UAT_AUTH_TOKEN" -H 'Sec-Fetch-Site: same-origin'
  ```
- **Expected Result**: The relayed request is refused by the daemon allowlist (relay:error → portal returns `502` with an error body, e.g. `{"error":"forbidden_path"}` or the daemon's error string). The forbidden host path is never fetched.
- [x] Pass <!-- 2026-06-14 -->

---

## Deferred — not locally testable (deploy-only)

These checklist items depend on the production deployment surface and are out of scope for local UAT. Confirm them during/after a DigitalOcean App Platform deploy, not here.

- **Live TLS termination** at the DO edge — local dev runs plain http.
- **`Secure` cookie enforcement in production** — `auth.ts` gates `useSecureCookies` on `NODE_ENV === 'production'`; real enforcement requires the prod https `PUBLIC_BASE_URL` and TLS at the edge. Locally the Secure attribute is intentionally off so http dev cookies are not dropped.
- **DO App Platform LB idle-timeout / WebSocket keepalive tuning** for the long-lived relay WS.
- **Google OAuth redirect URI registration** in the Google console for the prod domain.

---

## Notes

- **No `email_not_verified` test exists by design.** An emailVerified gate was added then intentionally removed from `pair.ts` / `devices.ts` / `invite-codes.ts` because no email-verification flow is wired (it would be a permanent lockout). Those routes gate only on session-present (401), admin-email match (403 for invite-code admin), ownership-404 (devices), and rate-limiting. UAT-API-009 explicitly asserts the absence of `email_not_verified`.
- The Origin-check tests use `POST /api/invite-codes/validate` because it is public + mutating, isolating the Origin gate from session auth. The same 403 behaviour applies to `POST /api/pair/*`, `PATCH/DELETE /api/devices/*`, and relay forwards.
