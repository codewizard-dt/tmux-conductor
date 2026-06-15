---
id: UAT-057
title: "UAT: DevicePicker (pairing code + device list/rename/revoke) and Onboarding UI"
status: passed
task: TASK-057
created: 2026-06-14
updated: 2026-06-14
---

# UAT-057 — UAT: DevicePicker (pairing code + device list/rename/revoke) and Onboarding UI

implements::[[TASK-057]]

> **Source task**: [[TASK-057]]
> **Generated**: 2026-06-14

---

## Prerequisites

- [ ] `app/api` is running and reachable (default `API_PORT=8080` per `.env.example`; the TASK-057 build notes describe it on **8090**). Set `APIPORT` below to whichever your env uses: `export APIPORT=8080` (or `8090`).
- [ ] `host-server` is running on port **8788** (needed to confirm proxy routing sends device/pairing paths to app/api, *not* host-server).
- [ ] `app/frontend` Vite dev server is running on **4321** (`npm run dev` in `app/frontend/`), proxying `/api/devices` and `/api/pair` to app/api and the `/api` catch-all to host-server.
- [ ] Postgres reachable by app/api (`DATABASE_URL`) with the `devices`, `pairing_codes`, and `user` tables migrated.
- [ ] A test user account exists and can sign in via better-auth (Google OAuth or the existing flow). The browser session cookie is required for every device/pair call (`credentials: 'include'`).
- [ ] For the curl API tests: a valid better-auth **session cookie** for the test user, exported as `export COOKIE='better-auth.session_token=...'` (copy from the browser dev-tools after signing in). The device/pair routes are session-cookie gated, not bearer-token gated.
- [ ] A clean device list for the test user when exercising the Onboarding empty-state (no non-revoked devices), and at least one paired device for the populated-list tests (pair one via `conductor pair` / `POST /api/pair/redeem`).

---

## Test Cases

### UAT-API-001: List devices returns an array for an authenticated user
- **Endpoint**: `GET /api/devices`
- Auth-Required: true
- Auth-Role: user
- **Description**: Verifies `listDevices()`'s endpoint returns the signed-in user's non-revoked devices as a JSON array, each with the documented field shape (`id`, `name`, `createdAt`, `lastSeenAt`, `revokedAt`, `connected`).
- **Steps**:
  1. Ensure the test user has at least one paired device.
  2. Run the curl command below as-is (with `$COOKIE` and `$APIPORT` exported).
- **Command**:
  ```bash
  curl -sS 'http://localhost:'"$APIPORT"'/api/devices' -H "Cookie: $COOKIE" | jq '.[0] | {id, name, createdAt, lastSeenAt, revokedAt, connected}'
  ```
- **Expected Result**: HTTP 200, a JSON array. Each element has string `id`, `name` (string or null), ISO `createdAt`, `lastSeenAt`/`revokedAt` (ISO or null), and boolean `connected`. Revoked devices are absent by default. (Known stub: `connected` is currently always `false` from the relay registry stub.)
- [x] Pass <!-- 2026-06-14 -->

### UAT-API-002: Generate a pairing code returns XXXX-XXXX + expiry
- **Endpoint**: `POST /api/pair/code`
- Auth-Required: true
- Auth-Role: user
- **Description**: Verifies `createPairingCode()`'s endpoint mints a one-time code formatted `XXXX-XXXX` with a future `expiresAt`.
- **Steps**:
  1. Run the curl command below (no request body required).
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:'"$APIPORT"'/api/pair/code' -H "Cookie: $COOKIE" | jq '{code, expiresAt, codeOk: (.code | test("^[A-Z0-9]{4}-[A-Z0-9]{4}$"))}'
  ```
- **Expected Result**: HTTP 200, body `{ code, expiresAt }`. `code` matches `XXXX-XXXX` (`codeOk` is `true`); `expiresAt` is an ISO timestamp ~10 minutes in the future.
- [x] Pass <!-- 2026-06-14 -->

### UAT-API-003: Rename a device updates the name and returns the device
- **Endpoint**: `PATCH /api/devices/:id`
- Auth-Required: true
- Auth-Role: user
- **Description**: Verifies `renameDevice(id, name)`'s endpoint updates a name (1–100 chars) and returns the updated device object.
- **Steps**:
  1. Pick an owned device id from UAT-API-001; export it: `export DEVID=<id>`.
  2. Run the curl command below.
- **Command**:
  ```bash
  curl -sS -X PATCH 'http://localhost:'"$APIPORT"'/api/devices/'"$DEVID" -H "Cookie: $COOKIE" -H 'Content-Type: application/json' -d '{"name":"UAT Renamed Device"}' | jq '{id, name, connected}'
  ```
- **Expected Result**: HTTP 200, body is the updated device with `name` = `"UAT Renamed Device"` and the same `id`.
- [x] Pass <!-- 2026-06-14 -->

### UAT-API-004: Revoke a device returns 204 and removes it from the default list
- **Endpoint**: `DELETE /api/devices/:id`
- Auth-Required: true
- Auth-Role: user
- **Description**: Verifies `revokeDevice(id)`'s endpoint marks a device revoked (returns 204) so it no longer appears in the default `GET /api/devices` list.
- **Steps**:
  1. Pick an owned, non-revoked device id; export it: `export DEVID=<id>`.
  2. Run the curl command below; observe the response status.
  3. Re-run UAT-API-001 and confirm the device is gone from the default list.
- **Command**:
  ```bash
  curl -sS -o /dev/null -w '%{http_code}' -X DELETE 'http://localhost:'"$APIPORT"'/api/devices/'"$DEVID" -H "Cookie: $COOKIE"
  ```
- **Expected Result**: HTTP `204` (no body). The device is excluded from a subsequent default `GET /api/devices`. (Backend also calls `closeRelayConnection(id)` to drop the live connection per TASK-033.)
- [x] Pass <!-- 2026-06-14 -->

### UAT-EDGE-001: Unauthenticated device list is rejected with 401
- **Scenario**: `GET /api/devices` with no session cookie.
- Auth-Required: false
- **Steps**: Run the curl command below with no `Cookie` header.
- **Command**:
  ```bash
  curl -sS -o /dev/null -w '%{http_code}' 'http://localhost:'"$APIPORT"'/api/devices'
  ```
- **Expected Result**: HTTP `401` (body `{ "error": "unauthenticated" }`). Confirms session gating.
- [x] Pass <!-- 2026-06-14 -->

### UAT-EDGE-002: Rename with an empty name is rejected with 400
- **Scenario**: `PATCH /api/devices/:id` with a blank name (trimmed to length 0).
- Auth-Required: true
- Auth-Role: user
- **Steps**: Use an owned device id (`$DEVID`); send a whitespace-only name.
- **Command**:
  ```bash
  curl -sS -X PATCH 'http://localhost:'"$APIPORT"'/api/devices/'"$DEVID" -H "Cookie: $COOKIE" -H 'Content-Type: application/json' -d '{"name":"   "}' | jq '{error, message}'
  ```
- **Expected Result**: HTTP `400`, body `{ "error": "invalid_name", "message": "name must be between 1 and 100 characters" }`.
- [x] Pass <!-- 2026-06-14 -->

### UAT-EDGE-003: Operating on another user's / nonexistent device returns 404
- **Scenario**: `PATCH`/`DELETE /api/devices/:id` for an id the user does not own (ownership-scoped query returns 0 rows).
- Auth-Required: true
- Auth-Role: user
- **Steps**: Use a random UUID that is not one of the user's devices.
- **Command**:
  ```bash
  curl -sS -o /dev/null -w '%{http_code}' -X DELETE 'http://localhost:'"$APIPORT"'/api/devices/00000000-0000-0000-0000-000000000000' -H "Cookie: $COOKIE"
  ```
- **Expected Result**: HTTP `404` (body `{ "error": "not_found" }`). Confirms existence is not leaked across users.
- [x] Pass <!-- 2026-06-14 -->

### UAT-EDGE-004: Pairing-code rate limit returns 429 after 5 pending codes
- **Scenario**: `POST /api/pair/code` called repeatedly without redeeming — the 6th unredeemed, non-expired code is rejected.
- Auth-Required: true
- Auth-Role: user
- **Steps**:
  1. Starting from a user with 0 pending codes, call the endpoint 6 times.
  2. The command below issues the 6th call; ensure 5 unredeemed codes already exist (run UAT-API-002 five times first).
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:'"$APIPORT"'/api/pair/code' -H "Cookie: $COOKIE" | jq '{error, message}'
  ```
- **Expected Result**: On the 6th call, HTTP `429`, body `{ "error": "too_many_pending_codes", "message": "You have 5 unredeemed pairing codes. ..." }`.
- [x] Pass <!-- 2026-06-14 -->

### UAT-PROXY-001: /api/devices is proxied to app/api, not host-server
- **Endpoint**: `GET /api/devices` via the Vite dev proxy on port 4321.
- Auth-Required: true
- Auth-Role: user
- **Description**: Confirms the vite.config.ts `/api/devices` proxy entry (above the `/api` catch-all) routes device calls to app/api. host-server (8788) has no `/api/devices` route, so reaching it would 404/500 differently. A 200 with a JSON array (or 401 when unauthenticated) proves it landed on app/api.
- **Steps**:
  1. Hit the path through the **frontend** origin (4321), not app/api directly.
  2. Compare against host-server directly (next command) to confirm host-server does NOT serve this route.
- **Command**:
  ```bash
  curl -sS -o /dev/null -w '%{http_code}' 'http://localhost:4321/api/devices' -H "Cookie: $COOKIE"
  ```
- **Expected Result**: HTTP `200` (array) for an authenticated user, or `401` if the cookie is omitted — either response proves app/api handled it. A direct `curl http://localhost:8788/api/devices` returns a 404/not-handled response, confirming the host-server is NOT the device backend.
- [x] Pass <!-- 2026-06-14 -->

### UAT-PROXY-002: /api/pair is proxied to app/api, not host-server
- **Endpoint**: `POST /api/pair/code` via the Vite dev proxy on port 4321.
- Auth-Required: true
- Auth-Role: user
- **Description**: Confirms the `/api/pair` proxy entry routes pairing calls to app/api.
- **Steps**: Hit the pairing endpoint through the frontend origin (4321).
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:4321/api/pair/code' -H "Cookie: $COOKIE" | jq '{code, expiresAt}'
  ```
- **Expected Result**: HTTP `200`, `{ code, expiresAt }` with `code` formatted `XXXX-XXXX` — proving the pairing route was served by app/api through the proxy.
- [x] Pass <!-- 2026-06-14 -->

### UAT-PROXY-003: Conductor /api/* paths still route to host-server (catch-all unaffected)
- **Endpoint**: `GET /api/healthz` (or `/api/status`) via the Vite dev proxy on port 4321.
- **Description**: Regression check — adding the device/pair proxy entries must not divert the generic conductor `/api` catch-all away from host-server.
- **Steps**: Hit a host-server conductor path through the frontend origin.
- **Command**:
  ```bash
  curl -sS -o /dev/null -w '%{http_code}' 'http://localhost:4321/api/healthz'
  ```
- **Expected Result**: HTTP `200` from the host-server (8788). Confirms `/api/healthz` (and conductor data routes) still reach host-server, i.e. the new entries did not shadow the catch-all.
- [x] Pass <!-- 2026-06-14 -->

### UAT-UI-001: Onboarding shows for a user with zero devices
- **Page**: `http://localhost:4321/devices`
- Auth-Required: true
- Auth-Role: user
- **Description**: `DevicesPage` renders `Onboarding` (not `DevicePicker`) when `listDevices()` returns an empty array. **Requires human verification** — no RTL/Playwright harness exists in this repo for this component.
- **Steps**:
  1. Sign in as a user with **no** paired (non-revoked) devices.
  2. Navigate to `/devices`.
  3. Observe the page content.
- **Expected Result**: The "No devices yet" / "Get started" empty state renders with: the install one-liner (`curl -fsSL https://raw.githubusercontent.com/.../install.sh | bash`) in a code block, a **Copy** button, and a "Pair the device" section showing `conductor pair`. `DevicePicker` (the device list / radio rows) is NOT shown.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-14 -->

### UAT-UI-002: Copy button copies the install one-liner
- **Page**: `http://localhost:4321/devices` (Onboarding view)
- Auth-Required: true
- Auth-Role: user
- **Description**: The Onboarding **Copy** button writes the install command to the clipboard and flips its label to "Copied" for ~2s. **Requires human verification** (clipboard + timed UI state; no automated harness).
- **Steps**:
  1. On the Onboarding view, click **Copy**.
  2. Observe the button label, then paste into a text field.
- **Expected Result**: Button label changes to "Copied" for ~2 seconds then reverts; clipboard contains `curl -fsSL https://raw.githubusercontent.com/codewizard-dt/tmux-conductor/main/install.sh | bash`.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-14 -->

### UAT-UI-003: DevicePicker lists devices with connected/offline badge
- **Page**: `http://localhost:4321/devices`
- Auth-Required: true
- Auth-Role: user
- **Description**: When the user has ≥1 device, `DevicePicker` renders the list with each device's name, a radio for active selection, and a connected/offline badge driven by the `connected` flag. **Requires human verification**.
- **Steps**:
  1. Sign in as a user with at least one paired device.
  2. Navigate to `/devices`.
  3. Observe each device row.
- **Expected Result**: Each device shows its name (or "Unnamed device"), a radio button, and a badge: green dot + "connected" when `connected` is true, grey dot + "offline" when false. (With the current relay stub, all devices render "offline".)
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-14 -->

### UAT-UI-004: Selecting the active device persists and repoints conductor calls
- **Page**: `http://localhost:4321/devices`
- Auth-Required: true
- Auth-Role: user
- **Description**: Choosing a device's radio calls `setSelectedDeviceId()` (TASK-056), persisting to `localStorage` under `tmux-conductor:selected-device` and (in relay mode) re-applying the relay config. **Requires human verification**.
- **Steps**:
  1. On `/devices` with ≥2 devices, click the radio for a device.
  2. Open dev-tools → Application → Local Storage and inspect `tmux-conductor:selected-device`.
  3. Reload the page.
- **Expected Result**: `localStorage['tmux-conductor:selected-device']` equals the selected device id; the radio remains selected after reload. (In relay mode, subsequent conductor calls route to `/relay/<deviceId>/api/...`.)
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-14 -->

### UAT-UI-005: Generate pairing code shows XXXX-XXXX + expiry in the picker
- **Page**: `http://localhost:4321/devices` (DevicePicker view)
- Auth-Required: true
- Auth-Role: user
- **Description**: The "Generate pairing code" button calls `POST /api/pair/code` and renders the returned `XXXX-XXXX` code with its expiry. **Requires human verification**.
- **Steps**:
  1. On the DevicePicker, click **Generate pairing code**.
  2. Observe the rendered code block.
- **Expected Result**: A monospace `XXXX-XXXX` code appears with an "Expires …" line showing a localized future timestamp. Button shows "Generating…" while in flight.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-14 -->

### UAT-UI-006: Inline rename updates the device name
- **Page**: `http://localhost:4321/devices` (DevicePicker view)
- Auth-Required: true
- Auth-Role: user
- **Description**: Clicking **Rename** opens an inline text input; Enter or **Save** calls `renameDevice()` and the list refreshes with the new name. **Requires human verification**.
- **Steps**:
  1. Click **Rename** on a device row.
  2. Type a new name and press Enter (or click **Save**).
- **Expected Result**: The row exits edit mode and displays the new name after refresh. Pressing Escape (or submitting an empty/whitespace name) cancels without changing the name.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-14 -->

### UAT-UI-007: Two-click revoke removes the device and clears active selection
- **Page**: `http://localhost:4321/devices` (DevicePicker view)
- Auth-Required: true
- Auth-Role: user
- **Description**: **Revoke** requires a confirmation click ("Confirm revoke") before calling `revokeDevice()`; if the revoked device was the active selection, the selection is cleared. **Requires human verification**.
- **Steps**:
  1. Select a device as active (radio), then click **Revoke** → button changes to **Confirm revoke**.
  2. Click **Confirm revoke**.
  3. Inspect `localStorage['tmux-conductor:selected-device']`.
- **Expected Result**: The device disappears from the list after refresh; because it was the active device, `localStorage['tmux-conductor:selected-device']` is cleared (removed). A single click of **Revoke** (without confirming) does not delete anything.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-14 -->

### UAT-UI-008: Devices nav link is present and not admin-gated
- **Page**: any authenticated page (NavBar)
- Auth-Required: true
- Auth-Role: user
- **Description**: The NavBar shows a **Devices** link (after Projects) for all signed-in users, routing to `/devices`. **Requires human verification**.
- **Steps**:
  1. Sign in as a **non-admin** user.
  2. Inspect the top NavBar.
  3. Click **Devices**.
- **Expected Result**: A "Devices" link is visible (not gated behind admin email, unlike "Invite Codes") and navigates to `/devices`.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-14 -->

---

## Notes / Known Gaps

- **`connected` flag is a stub**: `GET /api/devices` derives `connected` from `isDeviceConnected()` in the relay registry, which currently always returns `false`. UAT-API-001 and UAT-UI-003 assert the *shape and rendering* of the flag; live-connected verification is deferred until the relay is wired (post-TASK-033 relay work).
- **No frontend test harness**: this repo has no RTL/Jest/Vitest component tests nor a Playwright config for these components, so all `UAT-UI-*` cases are marked **requires human verification**. They could be automated later with Playwright (available as an MCP tool) once a signed-in session can be scripted.
- **Port ambiguity**: `.env.example` defaults `API_PORT=8080`; the TASK-057 build notes reference app/api on **8090**. Tests use `$APIPORT` so they work against either — set it to match your running env.
- **Auth is session-cookie based**, not bearer-token: the device/pair routes validate a better-auth session via `Cookie`, so curl tests use `-H "Cookie: $COOKIE"` rather than `Authorization: Bearer`.
