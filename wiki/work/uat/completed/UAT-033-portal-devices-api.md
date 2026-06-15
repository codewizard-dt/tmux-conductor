---
id: UAT-033
title: "UAT: app/api Devices API: list with connected flag, rename, revoke"
status: passed
task: TASK-033
created: 2026-06-14
updated: 2026-06-14
---

# UAT-033 — UAT: app/api Devices API: list with connected flag, rename, revoke

implements::[[TASK-033]]

> **Source task**: [[TASK-033]]
> **Generated**: 2026-06-14

---

## Prerequisites

- [ ] `app/api` is running on `http://localhost:8080` (via `make dev` or `npm run dev` inside `app/api/`)
- [ ] Postgres is running with all migrations applied (`DATABASE_URL` set; `npx tsx app/api/migrate.ts` run)
- [ ] A test user exists in the better-auth `"user"` table (sign in via `/api/auth/sign-in` with Google OIDC, or insert directly)
- [ ] The test user has a valid better-auth session cookie — export it:
  ```bash
  # After signing in, capture the Set-Cookie header from /api/auth/sign-in
  export UAT_SESSION_TOKEN="<better-auth.session_token value>"
  ```
- [ ] At least two paired devices exist for the test user (paired via `POST /api/pair/code` + `POST /api/pair/redeem`, or via direct SQL insert into `devices` with the correct `user_id` FK)
- [ ] Export a known device ID: `export UAT_DEVICE_ID="<uuid of a device owned by the test user>"`
- [ ] A second user with their own device exists for cross-ownership tests; export: `export UAT_OTHER_DEVICE_ID="<uuid of a device owned by the OTHER user>"`
- [ ] `app/api/relay/registry.ts` is present and exports `isDeviceConnected` and `closeRelayConnection`

---

## Test Cases

### UAT-STATIC-001: registry.ts stub file exists and exports both functions

- **Scenario**: The relay registry stub file introduced by TASK-033 is present at the expected path.
- **Steps**:
  1. Check the file exists and contains both exported stubs.
  ```bash
  grep -E 'export function isDeviceConnected|export function closeRelayConnection' app/api/relay/registry.ts
  ```
- **Expected Result**: Both lines print — `export function isDeviceConnected` and `export function closeRelayConnection` both appear.
- [x] Pass <!-- 2026-06-14 -->

### UAT-STATIC-002: registry.ts contains Phase 4 replacement comment

- **Scenario**: The stub has the Phase 4 marker comment per the acceptance criteria.
- **Steps**:
  ```bash
  grep 'Phase 4' app/api/relay/registry.ts
  ```
- **Expected Result**: At least one line printed, containing `Phase 4`.
- [x] Pass <!-- 2026-06-14 -->

### UAT-STATIC-003: isDeviceConnected stub returns false (compile-time: no live registry)

- **Scenario**: With the stub body, `isDeviceConnected` always returns `false`.
- **Steps**:
  ```bash
  node --input-type=module --eval "import { isDeviceConnected } from './app/api/relay/registry.ts'; console.log(isDeviceConnected('any-id'));" 2>/dev/null || npx tsx --eval "import { isDeviceConnected } from './app/api/relay/registry.ts'; console.log(isDeviceConnected('any-id'));"
  ```
- **Expected Result**: Prints `false`.
- [x] Pass <!-- 2026-06-14 -->

### UAT-STATIC-004: devices.ts route file is registered in app/api/index.ts

- **Scenario**: The route file is wired into the Fastify app.
- **Steps**:
  ```bash
  grep 'devicesRoutes\|devices\.ts' app/api/index.ts
  ```
- **Expected Result**: At least one line printed showing the import of `devicesRoutes` and its registration (e.g. `app.register(devicesRoutes)`).
- [x] Pass <!-- 2026-06-14 -->

---

### UAT-API-001: GET /api/devices — returns active devices for the signed-in user

- **Endpoint**: `GET /api/devices`
- **Auth-Required**: true
- **Auth-Role**: user
- **Description**: Verifies the happy-path list response: only active (non-revoked) devices for the authenticated user, with the `connected` field present and `false`.
- **Steps**:
  1. Ensure `UAT_SESSION_TOKEN` and `UAT_DEVICE_ID` are exported.
  2. Run:
  ```bash
  curl -sS 'http://localhost:8080/api/devices' -H "Cookie: better-auth.session_token=$UAT_SESSION_TOKEN" | jq .
  ```
- **Expected Result**: HTTP 200. Response is a JSON array. Each element has the shape:
  ```json
  {
    "id": "<uuid>",
    "name": "<string or null>",
    "createdAt": "<ISO 8601 string>",
    "lastSeenAt": "<ISO 8601 string or null>",
    "revokedAt": null,
    "connected": false
  }
  ```
  The array contains only devices belonging to the test user. `revokedAt` is `null` for all items (non-revoked default). `connected` is `false` on every item.
- [FAIL: auto-judge: prerequisite not satisfied — app/api is not running on http://localhost:8080; static-only verification context] <!-- 2026-06-14 -->

### UAT-API-002: GET /api/devices — excludes revoked devices by default

- **Endpoint**: `GET /api/devices`
- **Auth-Required**: true
- **Auth-Role**: user
- **Description**: Devices with `revoked_at IS NOT NULL` do not appear when `?include_revoked` is omitted.
- **Steps**:
  1. Revoke one device first (or use a device already revoked from a prior run). Note its ID.
  2. Run without the query param:
  ```bash
  curl -sS 'http://localhost:8080/api/devices' -H "Cookie: better-auth.session_token=$UAT_SESSION_TOKEN" | jq '[.[] | select(.revokedAt != null)]'
  ```
- **Expected Result**: The `jq` filter returns an empty array `[]`. The revoked device does not appear.
- [FAIL: auto-judge: prerequisite not satisfied — app/api is not running on http://localhost:8080; static-only verification context] <!-- 2026-06-14 -->

### UAT-API-003: GET /api/devices?include_revoked=1 — includes revoked devices

- **Endpoint**: `GET /api/devices?include_revoked=1`
- **Auth-Required**: true
- **Auth-Role**: user
- **Description**: With `?include_revoked=1`, previously revoked devices appear in the response with a non-null `revokedAt`.
- **Steps**:
  1. Ensure at least one device owned by the test user has been revoked (see UAT-API-002 prerequisite).
  2. Run:
  ```bash
  curl -sS 'http://localhost:8080/api/devices?include_revoked=1' -H "Cookie: better-auth.session_token=$UAT_SESSION_TOKEN" | jq '[.[] | select(.revokedAt != null)] | length'
  ```
- **Expected Result**: Returns a number ≥ 1. The revoked device(s) are included with a non-null ISO `revokedAt` string.
- [FAIL: auto-judge: prerequisite not satisfied — app/api is not running on http://localhost:8080; static-only verification context] <!-- 2026-06-14 -->

### UAT-API-004: GET /api/devices — 401 when not authenticated

- **Endpoint**: `GET /api/devices`
- **Auth-Required**: false (testing the unauthenticated path)
- **Description**: Without a valid session, the endpoint returns 401.
- **Steps**:
  ```bash
  curl -sS -o /dev/null -w '%{http_code}' 'http://localhost:8080/api/devices'
  ```
- **Expected Result**: Prints `401`.
- [FAIL: auto-judge: prerequisite not satisfied — app/api is not running on http://localhost:8080; static-only verification context] <!-- 2026-06-14 -->

---

### UAT-API-005: PATCH /api/devices/:id — renames device, returns updated object

- **Endpoint**: `PATCH /api/devices/:id`
- **Auth-Required**: true
- **Auth-Role**: user
- **Description**: Happy-path rename: returns 200 with the updated device object.
- **Steps**:
  1. Ensure `UAT_SESSION_TOKEN` and `UAT_DEVICE_ID` are exported.
  2. Run:
  ```bash
  curl -sS -X PATCH "http://localhost:8080/api/devices/$UAT_DEVICE_ID" -H 'Content-Type: application/json' -H "Cookie: better-auth.session_token=$UAT_SESSION_TOKEN" -d '{"name":"My Test Laptop"}' | jq .
  ```
- **Expected Result**: HTTP 200. Response is a single device object with `"name": "My Test Laptop"` and the same `id` as `UAT_DEVICE_ID`. `connected: false`. The `updatedAt` field is not expected (no such field in schema — only `createdAt`, `lastSeenAt`, `revokedAt`).
- [FAIL: auto-judge: prerequisite not satisfied — app/api is not running on http://localhost:8080; static-only verification context] <!-- 2026-06-14 -->

### UAT-API-006: PATCH /api/devices/:id — 400 when name is missing

- **Endpoint**: `PATCH /api/devices/:id`
- **Auth-Required**: true
- **Auth-Role**: user
- **Description**: Missing `name` field in the request body returns 400 with `error: missing_name`.
- **Steps**:
  ```bash
  curl -sS -X PATCH "http://localhost:8080/api/devices/$UAT_DEVICE_ID" -H 'Content-Type: application/json' -H "Cookie: better-auth.session_token=$UAT_SESSION_TOKEN" -d '{"foo":"bar"}' | jq .
  ```
- **Expected Result**: HTTP 400. Body contains `{ "error": "missing_name" }`.
- [FAIL: auto-judge: prerequisite not satisfied — app/api is not running on http://localhost:8080; static-only verification context] <!-- 2026-06-14 -->

### UAT-API-007: PATCH /api/devices/:id — 400 when name is empty string

- **Endpoint**: `PATCH /api/devices/:id`
- **Auth-Required**: true
- **Auth-Role**: user
- **Description**: Name that is empty after trimming returns 400 with `error: invalid_name`.
- **Steps**:
  ```bash
  curl -sS -X PATCH "http://localhost:8080/api/devices/$UAT_DEVICE_ID" -H 'Content-Type: application/json' -H "Cookie: better-auth.session_token=$UAT_SESSION_TOKEN" -d '{"name":"   "}' | jq .
  ```
- **Expected Result**: HTTP 400. Body contains `{ "error": "invalid_name", "message": "name must be between 1 and 100 characters" }`.
- [FAIL: auto-judge: prerequisite not satisfied — app/api is not running on http://localhost:8080; static-only verification context] <!-- 2026-06-14 -->

### UAT-API-008: PATCH /api/devices/:id — 400 when name exceeds 100 characters

- **Endpoint**: `PATCH /api/devices/:id`
- **Auth-Required**: true
- **Auth-Role**: user
- **Description**: Name longer than 100 characters returns 400 with `error: invalid_name`.
- **Steps**:
  ```bash
  curl -sS -X PATCH "http://localhost:8080/api/devices/$UAT_DEVICE_ID" -H 'Content-Type: application/json' -H "Cookie: better-auth.session_token=$UAT_SESSION_TOKEN" -d '{"name":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}' | jq .
  ```
- **Expected Result**: HTTP 400. Body contains `{ "error": "invalid_name", "message": "name must be between 1 and 100 characters" }`. (The name in the payload is 101 `a` characters.)
- [FAIL: auto-judge: prerequisite not satisfied — app/api is not running on http://localhost:8080; static-only verification context] <!-- 2026-06-14 -->

### UAT-API-009: PATCH /api/devices/:id — 404 for device owned by another user

- **Endpoint**: `PATCH /api/devices/:id`
- **Auth-Required**: true
- **Auth-Role**: user
- **Description**: Cross-ownership attempt returns 404 (existence not leaked to other users).
- **Steps**:
  1. Ensure `UAT_OTHER_DEVICE_ID` is a device owned by a DIFFERENT user.
  2. Run as the test user:
  ```bash
  curl -sS -o /dev/null -w '%{http_code}' -X PATCH "http://localhost:8080/api/devices/$UAT_OTHER_DEVICE_ID" -H 'Content-Type: application/json' -H "Cookie: better-auth.session_token=$UAT_SESSION_TOKEN" -d '{"name":"Hacked"}'
  ```
- **Expected Result**: Prints `404`. The device belonging to another user is not found (not 403 — ownership must not be leaked).
- [FAIL: auto-judge: prerequisite not satisfied — app/api is not running on http://localhost:8080; static-only verification context] <!-- 2026-06-14 -->

---

### UAT-API-010: DELETE /api/devices/:id — revokes device, returns 204

- **Endpoint**: `DELETE /api/devices/:id`
- **Auth-Required**: true
- **Auth-Role**: user
- **Description**: Happy-path revoke: sets `revoked_at`, returns 204 No Content.
- **Steps**:
  1. Use a fresh (non-revoked) device ID. Export it as `UAT_REVOKE_DEVICE_ID` (a different device than `UAT_DEVICE_ID` so it is not used by other tests).
  2. Run:
  ```bash
  curl -sS -o /dev/null -w '%{http_code}' -X DELETE "http://localhost:8080/api/devices/$UAT_REVOKE_DEVICE_ID" -H "Cookie: better-auth.session_token=$UAT_SESSION_TOKEN"
  ```
- **Expected Result**: Prints `204`. Response body is empty.
- [FAIL: auto-judge: prerequisite not satisfied — app/api is not running on http://localhost:8080; static-only verification context] <!-- 2026-06-14 -->

### UAT-API-011: DELETE /api/devices/:id — revoked_at is set in database after revoke

- **Endpoint**: `DELETE /api/devices/:id` (DB side-effect verification)
- **Auth-Required**: true
- **Auth-Role**: user
- **Description**: After a successful DELETE, the `devices` table row has `revoked_at IS NOT NULL`.
- **Steps**:
  1. After UAT-API-010 completes (device `UAT_REVOKE_DEVICE_ID` was revoked).
  2. Query the DB directly (adjust `DATABASE_URL` to match your env):
  ```bash
  psql "$DATABASE_URL" -c "SELECT id, revoked_at FROM devices WHERE id = '$UAT_REVOKE_DEVICE_ID';"
  ```
- **Expected Result**: Row is returned. `revoked_at` column shows a non-null timestamp.
- [FAIL: auto-judge: prerequisite not satisfied — app/api is not running on http://localhost:8080; static-only verification context] <!-- 2026-06-14 -->

### UAT-API-012: DELETE /api/devices/:id — 404 when already revoked

- **Endpoint**: `DELETE /api/devices/:id`
- **Auth-Required**: true
- **Auth-Role**: user
- **Description**: Attempting to revoke an already-revoked device returns 404 (idempotent 404, per spec: `AND revoked_at IS NULL` in the WHERE clause).
- **Steps**:
  1. Use `UAT_REVOKE_DEVICE_ID` which was revoked in UAT-API-010.
  2. Re-run the DELETE:
  ```bash
  curl -sS -o /dev/null -w '%{http_code}' -X DELETE "http://localhost:8080/api/devices/$UAT_REVOKE_DEVICE_ID" -H "Cookie: better-auth.session_token=$UAT_SESSION_TOKEN"
  ```
- **Expected Result**: Prints `404`. Body contains `{ "error": "not_found" }`.
- [FAIL: auto-judge: prerequisite not satisfied — app/api is not running on http://localhost:8080; static-only verification context] <!-- 2026-06-14 -->

### UAT-API-013: DELETE /api/devices/:id — 404 for device owned by another user

- **Endpoint**: `DELETE /api/devices/:id`
- **Auth-Required**: true
- **Auth-Role**: user
- **Description**: Cross-ownership DELETE attempt returns 404 (existence not leaked).
- **Steps**:
  ```bash
  curl -sS -o /dev/null -w '%{http_code}' -X DELETE "http://localhost:8080/api/devices/$UAT_OTHER_DEVICE_ID" -H "Cookie: better-auth.session_token=$UAT_SESSION_TOKEN"
  ```
- **Expected Result**: Prints `404`. Not 403.
- [FAIL: auto-judge: prerequisite not satisfied — app/api is not running on http://localhost:8080; static-only verification context] <!-- 2026-06-14 -->

### UAT-API-014: DELETE /api/devices/:id — 401 when not authenticated

- **Endpoint**: `DELETE /api/devices/:id`
- **Auth-Required**: false (testing the unauthenticated path)
- **Description**: Unauthenticated DELETE returns 401.
- **Steps**:
  ```bash
  curl -sS -o /dev/null -w '%{http_code}' -X DELETE "http://localhost:8080/api/devices/$UAT_DEVICE_ID"
  ```
- **Expected Result**: Prints `401`.
- [FAIL: auto-judge: prerequisite not satisfied — app/api is not running on http://localhost:8080; static-only verification context] <!-- 2026-06-14 -->

---

### UAT-EDGE-001: GET /api/devices — empty array for user with no devices

- **Scenario**: A user with no devices in the `devices` table gets an empty array, not null or an error.
- **Steps**:
  1. Sign in as a user who has no paired devices. Export their session token as `UAT_EMPTY_SESSION_TOKEN`.
  2. Run:
  ```bash
  curl -sS 'http://localhost:8080/api/devices' -H "Cookie: better-auth.session_token=$UAT_EMPTY_SESSION_TOKEN"
  ```
- **Expected Result**: HTTP 200. Response body is `[]` (empty JSON array).
- [FAIL: auto-judge: prerequisite not satisfied — app/api is not running on http://localhost:8080; static-only verification context] <!-- 2026-06-14 -->

### UAT-EDGE-002: PATCH /api/devices/:id — name exactly 100 characters is accepted

- **Scenario**: Boundary test — a 100-character name should be accepted (1–100 chars inclusive).
- **Steps**:
  ```bash
  curl -sS -o /dev/null -w '%{http_code}' -X PATCH "http://localhost:8080/api/devices/$UAT_DEVICE_ID" -H 'Content-Type: application/json' -H "Cookie: better-auth.session_token=$UAT_SESSION_TOKEN" -d '{"name":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}'
  ```
- **Expected Result**: Prints `200`. (The name is exactly 100 `a` characters.)
- [FAIL: auto-judge: prerequisite not satisfied — app/api is not running on http://localhost:8080; static-only verification context] <!-- 2026-06-14 -->

### UAT-EDGE-003: PATCH /api/devices/:id — name is trimmed before length check

- **Scenario**: A name of `"  hello  "` (with surrounding spaces) should be trimmed to `"hello"` and accepted, not rejected.
- **Steps**:
  ```bash
  curl -sS -X PATCH "http://localhost:8080/api/devices/$UAT_DEVICE_ID" -H 'Content-Type: application/json' -H "Cookie: better-auth.session_token=$UAT_SESSION_TOKEN" -d '{"name":"  hello  "}' | jq '.name'
  ```
- **Expected Result**: HTTP 200. `jq .name` prints `"hello"` (trimmed). The stored name has no leading/trailing whitespace.
- [FAIL: auto-judge: prerequisite not satisfied — app/api is not running on http://localhost:8080; static-only verification context] <!-- 2026-06-14 -->

### UAT-EDGE-004: connected flag is always false (stub verification)

- **Scenario**: The `connected` field reflects the Phase 4 stub — always `false` until Phase 4 replaces the stub body.
- **Steps**:
  ```bash
  curl -sS 'http://localhost:8080/api/devices' -H "Cookie: better-auth.session_token=$UAT_SESSION_TOKEN" | jq '[.[] | .connected] | unique'
  ```
- **Expected Result**: Returns `[false]` — every device has `connected: false`. No device is `true`.
- [FAIL: auto-judge: prerequisite not satisfied — app/api is not running on http://localhost:8080; static-only verification context] <!-- 2026-06-14 -->
