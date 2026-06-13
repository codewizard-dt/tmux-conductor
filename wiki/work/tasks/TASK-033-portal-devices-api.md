---
id: TASK-033
title: "Portal Devices API: list with connected flag, rename, revoke (ownership-404 semantics, revoke closes live connection)"
status: todo
created: 2026-06-13
updated: 2026-06-13
depends_on: [TASK-029, TASK-030]
blocks: []
parallel_safe_with: [TASK-031]
uat: ""
tags: [portal, devices, api, auth, relay, roadmap-002]
---

# TASK-033 — Portal Devices API: list with connected flag, rename, revoke (ownership-404 semantics, revoke closes live connection)

## Objective

Add the portal's device management API (ROADMAP-002 Phase 3, third item): `GET /api/devices` (list the signed-in user's devices with a live-connected flag), `PATCH /api/devices/:id` (rename a device), and `DELETE /api/devices/:id` (revoke a device — marks `revoked_at`, closes any live relay connection from that device). All endpoints enforce ownership: a user may only see and manage their own devices (404 for any device that exists but belongs to a different user — avoids leaking existence to other users). The "connected" flag is provided by the relay connection registry (Phase 4) — in this task it is wired via a stub/interface so the endpoint compiles and the test path works; Phase 4 replaces the stub with the real registry.

## Approach

**Route group**: create `portal/routes/devices.ts` as a Fastify plugin registered at `/api/devices`. All routes require `requireSession` + `requireAllowed`.

**Ownership-404**: `WHERE id = $1 AND user_id = $2` on every query. Never reveal whether a device exists to a different user — always 404, never 403.

**Connected flag**: Phase 4 will expose a `isDeviceConnected(deviceId: string): boolean` registry function. In this task, define the interface in `portal/relay/registry.ts` (or a minimal stub) and have `GET /api/devices` call it. For now the stub returns `false` for all devices. Phase 4 replaces the stub body without changing the call site.

**Revoke and close**: `DELETE /api/devices/:id` sets `revoked_at = now()` on the device row. After the DB write, call `closeRelayConnection(deviceId)` (from the same registry interface/stub — Phase 4 implements the actual close). Return 204 No Content.

**Response shape for `GET /api/devices`**:
```json
[
  {
    "id": "<uuid>",
    "name": "<string|null>",
    "createdAt": "<iso>",
    "lastSeenAt": "<iso|null>",
    "revokedAt": "<iso|null>",
    "connected": false
  }
]
```
Only active (non-revoked) devices by default; add `?include_revoked=1` query param to include revoked rows (useful for the device management UI).

**`PATCH /api/devices/:id`** body: `{ name: string }` (1–100 chars). Return the updated device row.

## Steps

### 1. Confirm prerequisites  <!-- agent: general-purpose -->

- [ ] Use Serena `list_dir` on `portal/` to confirm TASK-027 scaffold and TASK-029 migration (devices table) are present.
- [ ] Use Serena `search_for_pattern` for `requireSession` in `portal/` to confirm TASK-030 guards exist; note the import path.
- [ ] Note the route registration pattern in `portal/index.ts` used by existing routes (e.g. TASK-031's `pair.ts`).

### 2. Create `portal/relay/registry.ts` stub  <!-- agent: general-purpose -->

- [ ] Create `portal/relay/registry.ts` exporting:
  - `function isDeviceConnected(deviceId: string): boolean` — returns `false` (stub; Phase 4 replaces the body).
  - `function closeRelayConnection(deviceId: string): void` — no-op (stub; Phase 4 closes the live WS).
  - Add a top-of-file comment: `// Phase 4 relay connector replaces these stub bodies with the real connection registry.`

### 3. Implement `portal/routes/devices.ts`  <!-- agent: general-purpose -->

- [ ] Create `portal/routes/devices.ts` as a Fastify plugin.
- [ ] Apply `requireSession` + `requireAllowed` to all routes via `preHandler`.

**`GET /api/devices`**:
- [ ] Parse optional `?include_revoked=1` query param.
- [ ] Query: `SELECT id, name, created_at, last_seen_at, revoked_at FROM devices WHERE user_id = $1 AND ($2 OR revoked_at IS NULL) ORDER BY created_at DESC` (pass `[req.user.id, includeRevoked]`).
- [ ] Map rows: add `connected: isDeviceConnected(row.id)` (import from `portal/relay/registry.ts`).
- [ ] Return 200 array of device objects (camelCase keys from snake_case columns).

**`PATCH /api/devices/:id`**:
- [ ] Parse body `{ name: string }` — validate: non-empty, ≤100 chars, else 400.
- [ ] `UPDATE devices SET name = $1 WHERE id = $2 AND user_id = $3 RETURNING id, name, created_at, last_seen_at, revoked_at`. If `rowCount === 0` → 404.
- [ ] Return 200 updated device object + `connected` flag.

**`DELETE /api/devices/:id`**:
- [ ] `UPDATE devices SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL RETURNING id`. If `rowCount === 0` → 404 (either doesn't exist, belongs to other user, or already revoked).
- [ ] Call `closeRelayConnection(id)` after the DB write.
- [ ] Return 204 No Content.

### 4. Register routes and typecheck  <!-- agent: general-purpose -->

- [ ] Register `portal/routes/devices.ts` in `portal/index.ts` (mirror the pattern used by pair.ts from TASK-031).
- [ ] Run `npx tsc --noEmit` from `portal/` — zero type errors.

### 5. Integration verification  <!-- agent: general-purpose -->

- [ ] With a dev Postgres running (migrations applied), create a test user and two paired devices (via `portal/routes/pair.ts` or direct SQL inserts into `devices`).
- [ ] `GET /api/devices` returns both devices with `connected: false`.
- [ ] `PATCH /api/devices/:id` with `{name: "My Laptop"}` returns 200 with updated name; confirm DB row updated.
- [ ] `DELETE /api/devices/:id` returns 204; confirm `revoked_at IS NOT NULL` in DB.
- [ ] Cross-ownership: attempt GET/PATCH/DELETE with a device owned by a different user → 404.
- [ ] Scratch output under `./tmp/devices-verify/`. Never `/tmp`.

## Acceptance Criteria

- [ ] `GET /api/devices` returns only the signed-in user's devices (ownership enforced), with `connected: false` stub; supports `?include_revoked=1`.
- [ ] `PATCH /api/devices/:id` renames the device; returns 404 for non-existent or other-user's device.
- [ ] `DELETE /api/devices/:id` sets `revoked_at`, calls `closeRelayConnection` (stub no-op now, real in Phase 4), returns 204; returns 404 for already-revoked or other-user's device.
- [ ] `portal/relay/registry.ts` stubs `isDeviceConnected` and `closeRelayConnection` with Phase 4 replacement comment.
- [ ] `npx tsc --noEmit` passes; integration verification in Step 5 passes.

## Dependencies

- **DEPENDS ON [TASK-029](TASK-029-portal-pg-migration-001.md)** — `devices` table.
- **DEPENDS ON [TASK-030](TASK-030-portal-google-oidc-session-allowlist.md)** — `requireSession`/`requireAllowed` guards, `req.user`.
- **parallel_safe_with [TASK-031]** — both add portal routes but touch different files.

### Roadmap

Implements ROADMAP-002 Phase 3, item "Devices API: list with connected flag, rename, revoke (ownership-404 semantics, revoke closes live connection)" — `wiki/work/roadmaps/ROADMAP-002-hosted-portal-oauth-relay-installer.md`.
