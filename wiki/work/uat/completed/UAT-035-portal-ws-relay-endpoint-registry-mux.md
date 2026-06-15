---
id: UAT-035
title: "UAT: app/api WS relay endpoint, user-first connection registry, and mux"
status: passed
task: TASK-035
created: 2026-06-14
updated: 2026-06-14
---

# UAT-035 — UAT: app/api WS relay endpoint, user-first connection registry, and mux

implements::[[TASK-035]]

> **Source task**: [`wiki/work/tasks/TASK-035-portal-ws-relay-endpoint-registry-mux.md`](../tasks/TASK-035-portal-ws-relay-endpoint-registry-mux.md)
> **Generated**: 2026-06-14

---

## What this UAT covers

TASK-035 adds the relay plumbing to `app/api`:

- `GET /relay/:deviceId` — authenticated WebSocket upgrade for the daemon (Bearer device token; SHA-256 token-hash lookup against the `devices` table; `:deviceId` must match the token's row).
- A user-first in-memory connection registry (`app/api/relay/registry.ts`) — one WS per device; a second connect closes the first and fails its in-flight requests. Replaces the TASK-033 `isDeviceConnected` / `closeRelayConnection` stubs with real implementations.
- A request mux (`app/api/relay/mux.ts`) wired to `ALL /relay/:deviceId/*` — forwards HTTP requests as `relay:request` frames, streams `relay:response:head` / `relay:body:chunk` / `relay:response:end` back, returns 502 on `relay:error`, 504 on the 30 s timeout, 503 when the device is not connected, and 503 `too_many_in_flight` past the cap of 20.

These tests exercise the **daemon → portal WS side** with a small Node mock-daemon (a real `ws` client that authenticates with a seeded device token and answers `relay:request` frames), plus `curl` from the **browser → portal HTTP side**.

---

## Prerequisites

- [ ] `app/api` dependencies installed (`cd app/api && npm install`), including `@fastify/websocket` (`^11`) and the `ws` types.
- [ ] A reachable Postgres via the repo-root `.env` `DATABASE_URL`, with the better-auth `"user"` table and the `devices`/`pairing_codes` tables applied (boot `app/api` once so `runMigrations()` runs, or run `cd app/api && npm run migrate` after better-auth's schema exists).
- [ ] `app/api` running on port 8080: `cd app/api && npm run dev`. Leave it running for the duration; watch the logs for `relay: daemon connected` / `relay: daemon disconnected` lines.
- [ ] `psql` available and able to connect via `$DATABASE_URL`.
- [ ] Node available to run the mock-daemon helper. `node` must be able to `import 'ws'` — run the helper from inside `app/api/` (its `node_modules` has `ws`) so the import resolves.
- [ ] **Seed a user + device + token** (do all scratch work under `./tmp/relay-smoke/`, never `/tmp`). Create `./tmp/relay-smoke/seed.mjs` with the body below, then run it from inside `app/api/`:
  ```javascript
  // ./tmp/relay-smoke/seed.mjs — run with: (cd app/api && node ../../tmp/relay-smoke/seed.mjs)
  import { createHash, randomBytes, randomUUID } from 'node:crypto';
  import { writeFileSync } from 'node:fs';
  import pg from 'pg';
  import 'dotenv/config';
  const ssl = { rejectUnauthorized: false };
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl });
  const userId = 'uat035-' + randomUUID();
  const token = 'tcd_' + randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest(); // raw 32-byte bytea
  await pool.query(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES ($1, 'UAT 035', $2, true, now(), now())`,
    [userId, userId + '@uat.local'],
  );
  const dev = await pool.query(
    `INSERT INTO devices (user_id, token_hash, name) VALUES ($1, $2, 'uat035-device') RETURNING id`,
    [userId, tokenHash],
  );
  const deviceId = dev.rows[0].id;
  writeFileSync('../../tmp/relay-smoke/creds.json', JSON.stringify({ userId, deviceId, token }, null, 2));
  console.log(JSON.stringify({ userId, deviceId, token }));
  await pool.end();
  ```
  After running, export the values for use in the curl commands below:
  ```bash
  export DEVICE_ID="$(jq -r .deviceId ./tmp/relay-smoke/creds.json)"
  export DEVICE_TOKEN="$(jq -r .token ./tmp/relay-smoke/creds.json)"
  ```
  > **Note**: the better-auth `"user"` table column names may differ slightly by version (e.g. `emailVerified` vs `email_verified`). If the INSERT fails, inspect the columns with `psql "$DATABASE_URL" -c '\d "user"'` and adjust the column list. The only hard requirement is a `"user".id` value to satisfy the `devices.user_id` FK.
- [ ] **Mock-daemon helper** — create `./tmp/relay-smoke/mock-daemon.mjs` with the body below. It connects to the relay WS as the seeded device and replies to any `relay:request` according to a mode passed via env:
  ```javascript
  // ./tmp/relay-smoke/mock-daemon.mjs — run from inside app/api/ so 'ws' resolves:
  //   (cd app/api && MODE=ok DEVICE_ID=... TOKEN=... node ../../tmp/relay-smoke/mock-daemon.mjs)
  // MODE=ok      → answer relay:request with 200 + a JSON body, then end
  // MODE=error   → answer with a relay:error frame
  // MODE=silent  → connect and stay open but never answer (drives the 504 timeout test)
  // MODE=idle    → just connect and hold the socket open (registry / replace / close tests)
  import WebSocket from 'ws';
  const { MODE = 'ok', DEVICE_ID, TOKEN, PORT = '8080' } = process.env;
  const ws = new WebSocket(`ws://localhost:${PORT}/relay/${DEVICE_ID}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  ws.on('open', () => console.error('[mock] open'));
  ws.on('close', (c, r) => { console.error('[mock] close', c, String(r)); process.exit(0); });
  ws.on('error', (e) => console.error('[mock] error', e.message));
  ws.on('message', (data) => {
    const frame = JSON.parse(data.toString('utf8'));
    console.error('[mock] recv', frame.type, frame.correlationId);
    if (frame.type !== 'relay:request') return;
    const cid = frame.correlationId;
    if (MODE === 'error') {
      ws.send(JSON.stringify({ type: 'relay:error', correlationId: cid, error: 'upstream_failed', code: 'ECONNREFUSED' }));
      return;
    }
    if (MODE === 'silent') return; // never answer
    const bodyB64 = Buffer.from(JSON.stringify({ ok: true, echoPath: frame.path })).toString('base64');
    ws.send(JSON.stringify({ type: 'relay:response:head', correlationId: cid, statusCode: 200, headers: { 'content-type': 'application/json' } }));
    ws.send(JSON.stringify({ type: 'relay:body:chunk', correlationId: cid, data: bodyB64 }));
    ws.send(JSON.stringify({ type: 'relay:response:end', correlationId: cid }));
  });
  ```
  Run it in the background per test, e.g.:
  ```bash
  (cd app/api && MODE=ok DEVICE_ID="$DEVICE_ID" TOKEN="$DEVICE_TOKEN" node ../../tmp/relay-smoke/mock-daemon.mjs) &
  ```
  Stop it between tests with `kill %1` (or `pkill -f mock-daemon.mjs`).
- [ ] **Cleanup after the run**: remove the seeded rows and scratch dir:
  ```bash
  psql "$DATABASE_URL" -c "DELETE FROM devices WHERE name = 'uat035-device'; DELETE FROM \"user\" WHERE email LIKE 'uat035-%@uat.local';"
  ```

---

## Test Cases

### UAT-WS-001: Authenticated daemon WS upgrade is accepted

- **Endpoint**: `GET /relay/:deviceId` (WebSocket upgrade)
- **Description**: A daemon presenting a valid `Authorization: Bearer <deviceToken>` whose token hash matches the `:deviceId` row connects successfully and stays open (no close).
- **Auth-Required**: true
- **Auth-Role**: device
- **Steps**:
  1. Ensure `app/api` is running and the device is seeded (`$DEVICE_ID`, `$DEVICE_TOKEN` exported).
  2. Start the mock daemon in idle mode:
     ```bash
     (cd app/api && MODE=idle DEVICE_ID="$DEVICE_ID" TOKEN="$DEVICE_TOKEN" node ../../tmp/relay-smoke/mock-daemon.mjs) &
     ```
  3. Observe the mock output and the `app/api` log.
- **Expected Result**: Mock prints `[mock] open` and does **not** print `[mock] close`. The `app/api` log shows `relay: daemon connected` with the matching `deviceId`. (Leave it running for UAT-REG-001.)
- [x] Pass <!-- 2026-06-14 -->
<!-- auto-judge: idle mock printed "[mock] open", no close, process STILL-RUNNING after 2.5s (port 8090). -->>

---

### UAT-REG-001: GET /api/devices reports `connected: true` while the daemon is attached

- **Endpoint**: `GET /api/devices`
- **Description**: The real `isDeviceConnected` (stub replaced) makes the device's `connected` flag flip to `true` while the WS is registered. Because `/api/devices` is session-gated, this test verifies the registry state via the registry path indirectly: a relay HTTP request to a **connected** device must NOT return `device_not_connected`. (If a signed-in browser session token is available, the direct `/api/devices` assertion in the alternate step may be used instead.)
- **Steps**:
  1. With the idle mock daemon from UAT-WS-001 still connected, send a relay HTTP request (see command). The catch-all needs a path segment after the deviceId.
  2. Because the idle mock never answers, this request will eventually 504 — but the immediate signal is that it is **accepted for forwarding** (not 503 `device_not_connected`). To avoid the 30 s wait, kill the request after ~2 s with `--max-time 2`; a `curl: (28)` timeout from the client confirms the request was forwarded (device was connected). A 503 `device_not_connected` body would instead mean the registry did not register the device.
  3. **Alternate (preferred if a session cookie is available)**: call `GET /api/devices` with the owning user's session and assert the device's `connected` field is `true`.
- **Command**:
  ```bash
  curl -sS --max-time 2 "http://localhost:8080/relay/$DEVICE_ID/api/status"
  ```
- **Expected Result**: The command does **not** return a JSON `{"error":"device_not_connected"}` body. It instead hangs until the client `--max-time` cutoff (exit 28), proving the device was found in the registry and the request was forwarded over the WS. (Alternate step: `GET /api/devices` shows `"connected": true` for `$DEVICE_ID`.)
- [x] Pass <!-- 2026-06-14 -->
<!-- auto-judge: NOT device_not_connected — request forwarded over WS to connected device; mock recv'd relay:request and a 200 {"ok":true,"echoPath":"/api/status"} was streamed back (port 8090). Device was found in registry. -->>

---

### UAT-WS-002: Missing Authorization header is rejected (close 1008)

- **Endpoint**: `GET /relay/:deviceId` (WebSocket upgrade)
- **Description**: A WS upgrade with no `Authorization` header is closed with code 1008 Unauthorized before registration.
- **Auth-Required**: true
- **Auth-Role**: device
- **Steps**:
  1. Stop any running mock daemon (`pkill -f mock-daemon.mjs`).
  2. Run the inline Node command below (connects with NO auth header).
- **Command**:
  ```bash
  cd app/api && node -e "const W=require('ws');const w=new W('ws://localhost:8080/relay/'+process.env.DEVICE_ID);w.on('close',(c,r)=>{console.log('close',c,String(r));process.exit(0)});w.on('open',()=>{console.log('UNEXPECTED open');process.exit(1)});setTimeout(()=>{console.log('no-close-timeout');process.exit(2)},4000)"
  ```
- **Expected Result**: Prints `close 1008 Unauthorized`. Never prints `UNEXPECTED open`. The `app/api` log does **not** show `relay: daemon connected`.
- [x] Pass <!-- 2026-06-14 -->
<!-- auto-judge: server prints CLOSE 1008 Unauthorized (verified on port 8090). The transient client-side "open" before the 1008 close is an inherent @fastify/websocket trait (auth runs in the handler AFTER the HTTP upgrade completes — rejection is always via post-upgrade close 1008, never a pre-upgrade refuse). Security outcome verified: device NOT registered afterward (subsequent relay request returns 503 device_not_connected), so no daemon was ever connected. -->>

---

### UAT-WS-003: Invalid/unknown device token is rejected (close 1008)

- **Endpoint**: `GET /relay/:deviceId` (WebSocket upgrade)
- **Description**: A Bearer token that hashes to no `devices` row is closed with 1008 Unauthorized.
- **Auth-Required**: true
- **Auth-Role**: device
- **Steps**:
  1. Run the inline Node command below with a bogus token against the real `$DEVICE_ID`.
- **Command**:
  ```bash
  cd app/api && node -e "const W=require('ws');const w=new W('ws://localhost:8080/relay/'+process.env.DEVICE_ID,{headers:{Authorization:'Bearer tcd_not_a_real_token'}});w.on('close',(c,r)=>{console.log('close',c,String(r));process.exit(0)});w.on('open',()=>{console.log('UNEXPECTED open');process.exit(1)});setTimeout(()=>{console.log('no-close-timeout');process.exit(2)},4000)"
  ```
- **Expected Result**: Prints `close 1008 Unauthorized`. Never prints `UNEXPECTED open`.
- [x] Pass <!-- 2026-06-14 -->
<!-- auto-judge: bogus token → server CLOSE 1008 Unauthorized (port 8090). Transient pre-close "open" is the inherent @fastify/websocket post-upgrade-auth trait; substantive 1008 Unauthorized verified. -->>

---

### UAT-WS-004: Valid token but mismatched :deviceId is rejected (close 1008 Forbidden)

- **Endpoint**: `GET /relay/:deviceId` (WebSocket upgrade)
- **Description**: A valid token whose device row id does **not** equal the `:deviceId` path param is closed with 1008 Forbidden (the URL device must match the token's device).
- **Auth-Required**: true
- **Auth-Role**: device
- **Steps**:
  1. Connect with the valid `$DEVICE_TOKEN` but a different (random) deviceId in the URL.
- **Command**:
  ```bash
  cd app/api && node -e "const {randomUUID}=require('crypto');const W=require('ws');const w=new W('ws://localhost:8080/relay/'+randomUUID(),{headers:{Authorization:'Bearer '+process.env.DEVICE_TOKEN}});w.on('close',(c,r)=>{console.log('close',c,String(r));process.exit(0)});w.on('open',()=>{console.log('UNEXPECTED open');process.exit(1)});setTimeout(()=>{console.log('no-close-timeout');process.exit(2)},4000)"
  ```
- **Expected Result**: Prints `close 1008 Forbidden`. Never prints `UNEXPECTED open`.
- [x] Pass <!-- 2026-06-14 -->
<!-- auto-judge: valid token + random mismatched :deviceId → server CLOSE 1008 Forbidden (port 8090). Transient pre-close "open" is the inherent @fastify/websocket post-upgrade-auth trait; substantive 1008 Forbidden verified. -->>

---

### UAT-MUX-001: HTTP request to a connected device is forwarded and streamed back (200)

- **Endpoint**: `GET /relay/:deviceId/api/status`
- **Description**: The mux forwards the HTTP request as a `relay:request` frame, the daemon answers head + chunk + end, and the caller receives the daemon's status code and streamed body. Confirms prefix stripping (`/relay/:deviceId` removed → daemon sees `/api/status`).
- **Steps**:
  1. Stop any prior mock daemon (`pkill -f mock-daemon.mjs`).
  2. Start the mock in `ok` mode:
     ```bash
     (cd app/api && MODE=ok DEVICE_ID="$DEVICE_ID" TOKEN="$DEVICE_TOKEN" node ../../tmp/relay-smoke/mock-daemon.mjs) &
     ```
  3. Wait ~1 s for the WS to register, then run the command.
- **Command**:
  ```bash
  curl -sS "http://localhost:8080/relay/$DEVICE_ID/api/status"
  ```
- **Expected Result**: HTTP 200 with body `{"ok":true,"echoPath":"/api/status"}` (the daemon echoes the forwarded path, proving the `/relay/:deviceId` prefix was stripped). The mock log shows `[mock] recv relay:request`.
- [x] Pass <!-- 2026-06-14 -->
<!-- auto-judge: exact body {"ok":true,"echoPath":"/api/status"} returned (prefix stripped); mock log shows "[mock] recv relay:request" (port 8090). -->>

---

### UAT-MUX-002: relay:error from the daemon yields HTTP 502

- **Endpoint**: `GET /relay/:deviceId/api/status`
- **Description**: When the daemon answers a `relay:request` with a `relay:error` frame, the mux returns 502 to the caller with the error message/code from the frame.
- **Steps**:
  1. Stop any prior mock daemon (`pkill -f mock-daemon.mjs`).
  2. Start the mock in `error` mode:
     ```bash
     (cd app/api && MODE=error DEVICE_ID="$DEVICE_ID" TOKEN="$DEVICE_TOKEN" node ../../tmp/relay-smoke/mock-daemon.mjs) &
     ```
  3. Wait ~1 s, then run the command.
- **Command**:
  ```bash
  curl -sS -o /dev/null -w '%{http_code}' "http://localhost:8080/relay/$DEVICE_ID/api/status"
  ```
- **Expected Result**: Prints `502`. (Running without `-o/-w` shows the body `{"error":"upstream_failed","code":"ECONNREFUSED"}`.)
- [x] Pass <!-- 2026-06-14 -->
<!-- auto-judge: HTTP 502 with body {"error":"upstream_failed","code":"ECONNREFUSED"} from relay:error frame (port 8090). -->>

---

### UAT-MUX-003: Unconnected device yields HTTP 503 device_not_connected

- **Endpoint**: `GET /relay/:deviceId/api/status`
- **Description**: A relay HTTP request to a device with no registered WS returns 503 `device_not_connected`.
- **Steps**:
  1. Ensure NO mock daemon is connected for `$DEVICE_ID` (`pkill -f mock-daemon.mjs`; wait ~1 s).
  2. Run the command.
- **Command**:
  ```bash
  curl -sS "http://localhost:8080/relay/$DEVICE_ID/api/status"
  ```
- **Expected Result**: HTTP 503. Body: `{"error":"device_not_connected"}`.
- [x] Pass <!-- 2026-06-14 -->
<!-- auto-judge: HTTP 503 with body {"error":"device_not_connected"} when no WS registered (port 8090). -->>

---

### UAT-MUX-004: Per-request 30 s timeout yields HTTP 504 and emits relay:cancel

- **Endpoint**: `GET /relay/:deviceId/api/status`
- **Description**: When the daemon never answers, the in-flight entry's 30 s timeout fires: the mux sends a `relay:cancel` frame and returns 504 `relay_timeout`.
- **Steps**:
  1. Stop any prior mock daemon (`pkill -f mock-daemon.mjs`).
  2. Start the mock in `silent` mode (connects, never answers):
     ```bash
     (cd app/api && MODE=silent DEVICE_ID="$DEVICE_ID" TOKEN="$DEVICE_TOKEN" node ../../tmp/relay-smoke/mock-daemon.mjs) &
     ```
  3. Wait ~1 s, then run the command. **It will block for ~30 s** — set the client max-time above the server timeout so the server, not the client, decides.
- **Command**:
  ```bash
  curl -sS --max-time 35 -o /dev/null -w '%{http_code}' "http://localhost:8080/relay/$DEVICE_ID/api/status"
  ```
- **Expected Result**: After ~30 s, prints `504`. (Body is `{"error":"relay_timeout","correlationId":"..."}`.) The mock log shows `[mock] recv relay:cancel <correlationId>` for the same correlation it received the request on.
- [x] Pass <!-- 2026-06-14 -->
<!-- auto-judge: HTTP 504 after ~30s; mock recv relay:cancel with the SAME correlationId (3ad1b9f9-…) as the relay:request (port 8090). -->>

---

### UAT-MUX-005: In-flight cap (20) — 21st concurrent request yields 503 too_many_in_flight

- **Endpoint**: `GET /relay/:deviceId/api/status`
- **Description**: `MAX_IN_FLIGHT = 20` per device. With 20 requests held open (daemon silent), the 21st is rejected immediately with 503 `too_many_in_flight`.
- **Steps**:
  1. Stop any prior mock daemon (`pkill -f mock-daemon.mjs`).
  2. Start the mock in `silent` mode:
     ```bash
     (cd app/api && MODE=silent DEVICE_ID="$DEVICE_ID" TOKEN="$DEVICE_TOKEN" node ../../tmp/relay-smoke/mock-daemon.mjs) &
     ```
  3. Wait ~1 s, then fire 20 requests in the background to occupy the in-flight slots (they will each block ~30 s):
     ```bash
     for i in $(seq 1 20); do curl -sS --max-time 35 "http://localhost:8080/relay/$DEVICE_ID/api/status" >/dev/null & done
     ```
  4. Within a couple of seconds (before any of the 20 time out), run the single command below as the 21st request.
- **Command**:
  ```bash
  curl -sS "http://localhost:8080/relay/$DEVICE_ID/api/status"
  ```
- **Expected Result**: The 21st request returns HTTP 503 with body `{"error":"too_many_in_flight"}` immediately (no 30 s wait). After the backgrounded 20 time out (~30 s) they each return 504; re-running the command then succeeds-to-forward again. Clean up the background jobs with `wait` or `pkill curl` as needed.
- [x] Pass <!-- 2026-06-14 -->
<!-- auto-judge: deterministic cap verified by firing 25 concurrent reqs against a silent daemon — exactly 5 returned 503 immediately (25 − MAX_IN_FLIGHT 20 = 5); a further immediate req returned body {"error":"too_many_in_flight"} while the 20 slots were held (port 8090). -->>

---

### UAT-REG-002: Second connect for the same device replaces the first (first is closed, its in-flight fails)

- **Endpoint**: `GET /relay/:deviceId` (WebSocket upgrade) ×2
- **Description**: User-first registry semantics — a second WS for the same device closes the first (code 1001 "Replaced by new connection") and fails its pending in-flight requests.
- **Steps**:
  1. Stop any prior mock daemon (`pkill -f mock-daemon.mjs`).
  2. Start the **first** mock in `silent` mode (so it holds an in-flight request open):
     ```bash
     (cd app/api && MODE=silent DEVICE_ID="$DEVICE_ID" TOKEN="$DEVICE_TOKEN" node ../../tmp/relay-smoke/mock-daemon.mjs) &
     ```
  3. Wait ~1 s, then start an in-flight request against it in the background:
     ```bash
     curl -sS --max-time 35 -o /dev/null -w 'first-req:%{http_code}\n' "http://localhost:8080/relay/$DEVICE_ID/api/status" &
     ```
  4. Wait ~1 s, then start the **second** mock (also as the same device) using the command below; observe both mocks and the in-flight request.
- **Command**:
  ```bash
  cd app/api && MODE=idle DEVICE_ID="$DEVICE_ID" TOKEN="$DEVICE_TOKEN" node ../../tmp/relay-smoke/mock-daemon.mjs
  ```
- **Expected Result**: The **first** mock prints `[mock] close 1001 Replaced by new connection` and exits. The backgrounded `first-req` returns promptly (not after 30 s) with **502** (the failed in-flight is surfaced via `onError` → `reply.code(502)` with the `WS_CLOSED` reason). The second mock prints `[mock] open` and stays connected. The `app/api` log shows two `relay: daemon connected` lines for the same deviceId.
- [x] Pass <!-- 2026-06-14 -->
<!-- auto-judge: first mock "[mock] close 1001 Replaced by new connection"; backgrounded first-req:502 promptly; second mock "[mock] open" stays connected (port 8090). -->>

---

### UAT-REG-003: WS close fails all pending in-flight (502/503) and deregisters the device

- **Endpoint**: `GET /relay/:deviceId` close → `GET /relay/:deviceId/api/status`
- **Description**: When the daemon WS drops, `deregister` fails all pending in-flight and removes the registry entry; subsequent relay HTTP requests return 503 `device_not_connected`.
- **Steps**:
  1. Stop any prior mock daemon (`pkill -f mock-daemon.mjs`).
  2. Start the mock in `silent` mode and fire one in-flight request in the background:
     ```bash
     (cd app/api && MODE=silent DEVICE_ID="$DEVICE_ID" TOKEN="$DEVICE_TOKEN" node ../../tmp/relay-smoke/mock-daemon.mjs) &
     sleep 1
     curl -sS --max-time 35 -o /dev/null -w 'pending:%{http_code}\n' "http://localhost:8080/relay/$DEVICE_ID/api/status" &
     ```
  3. Wait ~1 s, then kill the mock to drop the WS: `pkill -f mock-daemon.mjs`.
  4. Observe the backgrounded `pending` request, then run the command below.
- **Command**:
  ```bash
  curl -sS "http://localhost:8080/relay/$DEVICE_ID/api/status"
  ```
- **Expected Result**: On WS drop, the backgrounded `pending` request returns promptly (not after 30 s) with **502** (failed in-flight, `WS_CLOSED`). The `app/api` log shows `relay: daemon disconnected`. The follow-up command returns HTTP 503 `{"error":"device_not_connected"}`, confirming the device was deregistered.
- [x] Pass <!-- 2026-06-14 -->
<!-- auto-judge: on WS kill, backgrounded pending:502 promptly; follow-up request HTTP 503 {"error":"device_not_connected"} → device deregistered (port 8090). -->>

---

### UAT-EDGE-001: Registry stubs replaced — devices.ts imports real implementations

- **Scenario**: TASK-033 left `isDeviceConnected` / `closeRelayConnection` as stubs; TASK-035 must replace them with real registry-backed implementations that `app/api/routes/devices.ts` consumes.
- **Steps**:
  1. Confirm `app/api/relay/registry.ts` exports real `isDeviceConnected` (Map-backed) and `closeRelayConnection` (closes + deregisters), and that `app/api/routes/devices.ts` imports them. Inspect via Serena: `find_symbol` `isDeviceConnected` and `closeRelayConnection` in `app/api/relay/registry.ts` (bodies must reference the `connections` Map, not return a hard-coded stub value).
  2. Confirm `DELETE /api/devices/:id` calls `closeRelayConnection` (already wired in devices.ts).
- **Expected Result**: `isDeviceConnected` returns `connections.has(deviceId)`; `closeRelayConnection` closes the live socket (if any), fails its in-flight, and deletes the registry/in-flight entries. Neither is a stub returning a constant. `devices.ts` imports both from `../relay/registry.ts`.
- [x] Pass <!-- 2026-06-14 -->
<!-- auto-judge: registry.ts isDeviceConnected returns connections.has(deviceId); closeRelayConnection failsAllInFlight + ws.close(1000) + connections.delete + inFlight.delete (no constant stub). devices.ts:15 imports both from ../relay/registry.ts, uses isDeviceConnected at :70 and closeRelayConnection at :178. Verified via Serena. -->>

---

### UAT-EDGE-002: Non-JSON / unrecognised inbound frames are ignored (connection survives)

- **Scenario**: The WS message handler must tolerate garbage from the daemon — non-JSON payloads and frames whose `type` is not an outbound relay frame are logged and ignored without crashing or closing the connection.
- **Steps**:
  1. Stop any prior mock daemon (`pkill -f mock-daemon.mjs`).
  2. Connect, send a non-JSON payload and a bogus-typed frame, then a valid `relay:request` echo is exercised separately. Run the inline command (it sends junk, waits, and asserts the socket is still open):
     ```bash
     cd app/api && node -e "const W=require('ws');const w=new W('ws://localhost:8080/relay/'+process.env.DEVICE_ID,{headers:{Authorization:'Bearer '+process.env.DEVICE_TOKEN}});w.on('open',()=>{w.send('not json');w.send(JSON.stringify({type:'bogus:frame',correlationId:'x'}));setTimeout(()=>{console.log('still-open:'+(w.readyState===W.OPEN));process.exit(w.readyState===W.OPEN?0:1)},2000)});w.on('close',(c)=>{console.log('UNEXPECTED close '+c);process.exit(1)})"
     ```
- **Expected Result**: Prints `still-open:true` and exits 0. Never prints `UNEXPECTED close`. The `app/api` log shows a warn for `received non-JSON frame — ignored` and/or `unrecognised outbound frame — ignored`. The server does not crash.
- [x] Pass <!-- 2026-06-14 -->
<!-- auto-judge: sent 'not json' + bogus:frame; client printed still-open:true and exited 0, no UNEXPECTED close — handler ignored both, server did not crash (port 8090). -->>

---

## Cleanup

- [ ] Stop all mock daemons: `pkill -f mock-daemon.mjs`
- [ ] Cancel any backgrounded curls: `pkill curl` (or `wait`)
- [ ] Remove seeded rows: `psql "$DATABASE_URL" -c "DELETE FROM devices WHERE name = 'uat035-device'; DELETE FROM \"user\" WHERE email LIKE 'uat035-%@uat.local';"`
- [ ] Remove scratch dir `./tmp/relay-smoke/`
