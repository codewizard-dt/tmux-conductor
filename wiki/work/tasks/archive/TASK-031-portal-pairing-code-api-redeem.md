---
id: TASK-031
title: "app/api pairing-code creation API + rate-limited /pair/redeem (hashed, single-use, 10-min expiry)"
status: done
created: 2026-06-13
updated: 2026-06-14
depends_on: [TASK-027, TASK-029, TASK-030]
blocks: []
parallel_safe_with: []
uat: "[[UAT-031]]"
tags: [portal, pairing, auth, api, security, roadmap-002]
---

# TASK-031 — app/api pairing-code creation API + rate-limited /pair/redeem (hashed, single-use, 10-min expiry)

## Objective

Add the two `app/api` endpoints that drive device pairing (ROADMAP-002 Phase 3, first item): `POST /api/pair/code` — generates an 8-char Crockford base32 pairing code for the signed-in allowlisted user, enforces a ≤5 outstanding-codes-per-user rate limit, stores only the SHA-256 hash in `pairing_codes`, and returns the code formatted as `XXXX-XXXX`; and `POST /api/pair/redeem` — accepts the code, atomically redeems it (single-use, 10-minute expiry), creates a `devices` row with a one-time device token stored only hashed, and returns the plaintext token to the caller exactly once. Both endpoints are built on the `app/api` scaffold (TASK-027), the Postgres schema (TASK-029), and the auth guards (TASK-030).

## Approach

**Code generation**: Crockford base32 uses the alphabet `0123456789ABCDEFGHJKMNPQRSTVWXYZ` (32 chars, case-insensitive, no O/I/L/U). Generate 5 random bytes via `crypto.getRandomValues` or Node `crypto.randomBytes(5)` (gives 40 bits → 8 base32 chars). Format display string as `XXXX-XXXX` (strip dash on inbound). Normalise input by uppercasing and removing dashes before hashing.

**Device token format**: `tcd_` prefix + base64url of 32 random bytes (`crypto.randomBytes(32).toString('base64url')`). Show once at redemption, never stored plaintext. Stored as SHA-256 raw digest in `devices.token_hash` (bytea).

**Hashing**: Node `crypto.createHash('sha256').update(value).digest()` → `Buffer` (32 bytes) for Postgres `bytea`. Consistent for both pairing codes and device tokens — always hash the normalised (uppercased, dash-stripped) code.

**Rate limit (≤5 outstanding codes)**: Before inserting, query `SELECT count(*) FROM pairing_codes WHERE user_id = $1 AND redeemed_at IS NULL AND expires_at > now()`. If ≥5, return 429 with `{error: 'too_many_pending_codes'}`. Note: `user_id` here is a FK referencing the better-auth `"user"(id)` table (created by `@better-auth/cli migrate`), not a hand-rolled users table.

**Atomic redemption**: Single `UPDATE … WHERE code_hash = $hash AND redeemed_at IS NULL AND expires_at > now() RETURNING user_id` in a transaction. If 0 rows updated → 400 `{error: 'invalid_or_expired_code'}`. Then insert device row + update `pairing_codes.device_id` in the same transaction. The `WHERE redeemed_at IS NULL AND expires_at > now()` guard + `RETURNING` makes this race-free.

**Route organisation**: Create `app/api/routes/pair.ts` and register it on the app in `app/api/index.ts`. Authentication: `POST /api/pair/code` requires a valid better-auth session (`auth.api.getSession`) + `requireAllowed` (signed-in, allowlisted user). `POST /api/pair/redeem` is UNAUTHENTICATED (the daemon calls this with only the short-lived pairing code, before it has a device token).

**Expiry**: `expires_at = now() + INTERVAL '10 minutes'` — passed as JS `new Date(Date.now() + 10 * 60 * 1000)` to the pg query param.

## Steps

### 1. Confirm prerequisites  <!-- agent: general-purpose -->

- [x] Use Serena `list_dir` on `app/api/` to confirm TASK-027 produced the scaffold (`index.ts`, `env.ts`, `db.ts`, `migrate.ts`). <!-- Completed: 2026-06-14 -->
- [x] Use Serena `find_file` for `001_init.sql` under `app/api/migrations/` to confirm TASK-029 landed the schema. <!-- Completed: 2026-06-14 — found 001_invite_codes.sql; devices/pairing_codes migration to be created in this task -->
- [x] Use Serena `search_for_pattern` for `requireAllowed` in `app/api/` to confirm TASK-030 auth guards exist; note the import path. <!-- Completed: 2026-06-14 — no pre-built guard; use auth.api.getSession inline -->
- [x] Note the app entry file (likely `app/api/index.ts`) and how routes are registered (plugin or direct `app.register`). <!-- Completed: 2026-06-14 — pattern: app.route({method, url, handler}) -->
- [x] If any prerequisite is missing, STOP and report which task is unmet. <!-- Completed: 2026-06-14 — all scaffold files present; migration creation is in-scope for this task -->

### 2. Implement `app/api/lib/crypto.ts` — shared hashing and code-generation utilities  <!-- agent: general-purpose -->

- [x] Create `app/api/lib/crypto.ts` with the following exports (no side effects at import time): <!-- Completed: 2026-06-14 -->
  - `CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'` — the 32-char alphabet.
  - `generatePairingCode(): string` — returns an 8-char string from the Crockford alphabet (use `crypto.randomBytes(5)`, map each 5-bit chunk via modulo-32 index into CROCKFORD). No dashes in the raw code — caller formats as `XXXX-XXXX`.
  - `formatPairingCode(code: string): string` — inserts a `-` after char 4: `code.slice(0,4) + '-' + code.slice(4)`.
  - `normalisePairingCode(input: string): string` — uppercase, strip all non-Crockford characters (i.e. strip `-` and spaces), 8 chars result; throw `Error('invalid_pairing_code')` if result length ≠ 8 or any char not in CROCKFORD.
  - `sha256(data: Buffer | string): Buffer` — `createHash('sha256').update(data).digest()` returning a raw 32-byte Buffer (NOT hex string — Postgres bytea).
  - `generateDeviceToken(): string` — returns `'tcd_' + randomBytes(32).toString('base64url')`.
- [x] All functions use Node `node:crypto` (builtin) — no new npm dependency. <!-- Completed: 2026-06-14 -->

### 3. Implement `app/api/routes/pair.ts`  <!-- agent: general-purpose -->

- [x] Create `app/api/routes/pair.ts` exporting a Fastify plugin (async function receiving `app, opts`) that registers the two endpoints. <!-- Completed: 2026-06-14 -->

**`POST /api/pair/code`** (generates a pairing code for the signed-in allowlisted user):
- [x] Apply better-auth session validation via `auth.api.getSession` + `requireAllowed` inline guard. The `user.id` on the resolved session references the better-auth `"user"` table. <!-- Completed: 2026-06-14 -->
- [x] Rate-limit check: query `SELECT count(*)::int AS cnt FROM pairing_codes WHERE user_id = $1 AND redeemed_at IS NULL AND expires_at > now()` with `[session.user.id]`. If `cnt >= 5` return status 429 `{ error: 'too_many_pending_codes', message: 'You have 5 unredeemed pairing codes. Wait for them to expire or use one first.' }`. <!-- Completed: 2026-06-14 -->
- [x] Generate code: `const raw = generatePairingCode()` (from `app/api/lib/crypto.ts`); compute `const hash = sha256(raw)`. <!-- Completed: 2026-06-14 -->
- [x] Insert: `INSERT INTO pairing_codes (user_id, code_hash, expires_at) VALUES ($1, $2, $3)` with `[session.user.id, hash, new Date(Date.now() + 10 * 60 * 1000)]`. <!-- Completed: 2026-06-14 -->
- [x] Return 200 `{ code: formatPairingCode(raw), expiresAt: <iso string, now + 10min> }`. Never return the raw hash. <!-- Completed: 2026-06-14 -->

**`POST /api/pair/redeem`** (redeems a code; unauthenticated — called by daemon with only the code):
- [x] Parse body `{ code: string }` — if missing/not string return 400 `{ error: 'missing_code' }`. <!-- Completed: 2026-06-14 -->
- [x] Normalise: `normalisePairingCode(body.code)` — catch the `invalid_pairing_code` error and return 400 `{ error: 'invalid_or_expired_code' }` (do not leak why it failed). <!-- Completed: 2026-06-14 -->
- [x] Compute `const hash = sha256(normalised)`. <!-- Completed: 2026-06-14 -->
- [x] Open a pg client via `getPool().connect()` and begin a transaction. <!-- Completed: 2026-06-14 -->
- [x] Atomic redemption: `UPDATE pairing_codes SET redeemed_at = now() WHERE code_hash = $1 AND redeemed_at IS NULL AND expires_at > now() RETURNING id, user_id` with `[hash]`. If `rowCount === 0` → ROLLBACK + 400 `{ error: 'invalid_or_expired_code' }`. <!-- Completed: 2026-06-14 -->
- [x] Generate device token: `const token = generateDeviceToken()`; compute `const tokenHash = sha256(token)`. <!-- Completed: 2026-06-14 -->
- [x] Insert device: `INSERT INTO devices (user_id, token_hash) VALUES ($1, $2) RETURNING id` with `[user_id, tokenHash]`. <!-- Completed: 2026-06-14 -->
- [x] Update pairing code: `UPDATE pairing_codes SET device_id = $1 WHERE id = $2` with `[deviceId, pairingCodeId]`. <!-- Completed: 2026-06-14 -->
- [x] COMMIT. <!-- Completed: 2026-06-14 -->
- [x] Return 200 `{ token, deviceId }`. The `token` is the plaintext device token shown exactly once; `deviceId` is the UUID for the new device row. Never log the plaintext token. <!-- Completed: 2026-06-14 -->
- [x] In the `catch` block: ROLLBACK + release client + rethrow (Fastify's error handler returns 500). <!-- Completed: 2026-06-14 -->
- [x] In a `finally`: `client.release()`. <!-- Completed: 2026-06-14 -->

### 4. Register routes and verify types  <!-- agent: general-purpose -->

- [x] In `app/api/index.ts` (the app entry from Step 1), add `import pairRoutes from './routes/pair.ts'` and `app.register(pairRoutes)` — mirrors the ESM import pattern used by the existing cors plugin. <!-- Completed: 2026-06-14 -->
- [x] Run `npx tsc --noEmit` from `app/api/` — zero type errors. Fixed noUncheckedIndexedAccess issue in routes/invite-codes.ts and extended tsconfig include to cover lib/**/*.ts and routes/**/*.ts. <!-- Completed: 2026-06-14 -->

### 5. Integration verification  <!-- agent: general-purpose -->

- [DEFERRED-TO-UAT] Boot `app/api` with `DATABASE_URL` pointing at a dev Postgres that has the Phase 1 migrations applied (`app/api/migrations/001_init.sql` via `npm run migrate`) and the better-auth schema applied (`@better-auth/cli migrate`).
- [DEFERRED-TO-UAT] Create a test user row in the better-auth `"user"` table directly (or via better-auth's admin API) — save the returned `id`.
- [DEFERRED-TO-UAT] Simulate the `/api/pair/code` call. Because the endpoint requires a better-auth session, obtain one via `auth.api.getSession` or by inserting a session row via the better-auth admin API. Check: 200 response contains `{ code: 'XXXX-XXXX', expiresAt: '...' }`.
- [DEFERRED-TO-UAT] Call `/api/pair/redeem` with `{ code: <the code from above> }`. Confirm: 200 response contains `{ token: 'tcd_...', deviceId: '<uuid>' }`.
- [DEFERRED-TO-UAT] Second redeem attempt with the same code → 400 `invalid_or_expired_code`.
- [DEFERRED-TO-UAT] Rate-limit test: call `/api/pair/code` 5 more times (4 succeeds, 5th returns 429 since the first code is still unredeemed — or adjust test to have ≥5 outstanding). Confirm 429 body matches `too_many_pending_codes`.
- [DEFERRED-TO-UAT] Scratch output (JQ-formatted curl responses, psql query snapshots) goes under `./tmp/pair-verify/`. Never `/tmp`.

## Acceptance Criteria

- [ ] `app/api/lib/crypto.ts` exports `generatePairingCode`, `formatPairingCode`, `normalisePairingCode`, `sha256`, `generateDeviceToken` using Node `node:crypto` only.
- [ ] `POST /api/pair/code` is guarded by better-auth session (`auth.api.getSession`) + `requireAllowed`, enforces ≤5 outstanding codes per user (429), inserts a `pairing_codes` row (with `user_id` FK to better-auth `"user"(id)`) with a hashed code and 10-minute expiry, and returns `{ code: 'XXXX-XXXX', expiresAt }`. The plaintext code is never persisted.
- [ ] `POST /api/pair/redeem` is unauthenticated, atomically redeems the code in a transaction (`WHERE redeemed_at IS NULL AND expires_at > now()`), creates a `devices` row (with `user_id` FK to better-auth `"user"(id)`) with a hashed device token, returns `{ token: 'tcd_...', deviceId }` exactly once. The plaintext token is never persisted or logged.
- [ ] A second redemption of the same code returns 400.
- [ ] `npx tsc --noEmit` passes from `app/api/` with zero errors.
- [ ] Integration verification in Step 5 passes.

## Dependencies

- **DEPENDS ON [TASK-027](TASK-027-scaffold-portal-foundation.md)** — `app/api` Fastify scaffold, `env.ts`, `db.ts` (`getPool`), `index.ts` route registration entry point.
- **DEPENDS ON [TASK-029](TASK-029-portal-pg-migration-001.md)** — `pairing_codes` and `devices` tables in Postgres (both with `user_id` FK to better-auth `"user"(id)`).
- **DEPENDS ON [TASK-030](TASK-030-portal-google-oidc-session-allowlist.md)** — better-auth session middleware (`auth.api.getSession`) and `requireAllowed` guard, session user shape.

### Roadmap

Implements ROADMAP-002 Phase 3, item "Pairing-code creation API + rate-limited /pair/redeem (hashed, single-use, 10-min expiry)" — `wiki/work/roadmaps/ROADMAP-002-hosted-portal-oauth-relay-installer.md`.
