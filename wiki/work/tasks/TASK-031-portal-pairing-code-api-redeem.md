---
id: TASK-031
title: "Portal pairing-code creation API + rate-limited /pair/redeem (hashed, single-use, 10-min expiry)"
status: todo
created: 2026-06-13
updated: 2026-06-13
depends_on: [TASK-027, TASK-029, TASK-030]
blocks: []
parallel_safe_with: []
uat: ""
tags: [portal, pairing, auth, api, security, roadmap-002]
---

# TASK-031 — Portal pairing-code creation API + rate-limited /pair/redeem (hashed, single-use, 10-min expiry)

## Objective

Add the two portal API endpoints that drive device pairing (ROADMAP-002 Phase 3, first item): `POST /api/pair/code` — generates an 8-char Crockford base32 pairing code for the signed-in allowlisted user, enforces a ≤5 outstanding-codes-per-user rate limit, stores only the SHA-256 hash in `pairing_codes`, and returns the code formatted as `XXXX-XXXX`; and `POST /api/pair/redeem` — accepts the code, atomically redeems it (single-use, 10-minute expiry), creates a `devices` row with a one-time device token stored only hashed, and returns the plaintext token to the caller exactly once. Both endpoints are built on the portal scaffold (TASK-027), the Postgres schema (TASK-029), and the auth guards (TASK-030).

## Approach

**Code generation**: Crockford base32 uses the alphabet `0123456789ABCDEFGHJKMNPQRSTVWXYZ` (32 chars, case-insensitive, no O/I/L/U). Generate 5 random bytes via `crypto.getRandomValues` or Node `crypto.randomBytes(5)` (gives 40 bits → 8 base32 chars). Format display string as `XXXX-XXXX` (strip dash on inbound). Normalise input by uppercasing and removing dashes before hashing.

**Device token format**: `tcd_` prefix + base64url of 32 random bytes (`crypto.randomBytes(32).toString('base64url')`). Show once at redemption, never stored plaintext. Stored as SHA-256 raw digest in `devices.token_hash` (bytea).

**Hashing**: Node `crypto.createHash('sha256').update(value).digest()` → `Buffer` (32 bytes) for Postgres `bytea`. Consistent for both pairing codes and device tokens — always hash the normalised (uppercased, dash-stripped) code.

**Rate limit (≤5 outstanding codes)**: Before inserting, query `SELECT count(*) FROM pairing_codes WHERE user_id = $1 AND redeemed_at IS NULL AND expires_at > now()`. If ≥5, return 429 with `{error: 'too_many_pending_codes'}`.

**Atomic redemption**: Single `UPDATE … WHERE code_hash = $hash AND redeemed_at IS NULL AND expires_at > now() RETURNING user_id` in a transaction. If 0 rows updated → 400 `{error: 'invalid_or_expired_code'}`. Then insert device row + update `pairing_codes.device_id` in the same transaction. The `WHERE redeemed_at IS NULL AND expires_at > now()` guard + `RETURNING` makes this race-free.

**Route organisation**: Create `portal/routes/pair.ts` and register it on the app in `portal/index.ts`. Authentication: `POST /api/pair/code` requires `requireSession` + `requireAllowed` (signed-in, allowlisted user). `POST /api/pair/redeem` is UNAUTHENTICATED (the daemon calls this with only the short-lived pairing code, before it has a device token).

**Expiry**: `expires_at = now() + INTERVAL '10 minutes'` — passed as JS `new Date(Date.now() + 10 * 60 * 1000)` to the pg query param.

## Steps

### 1. Confirm prerequisites  <!-- agent: general-purpose -->

- [ ] Use Serena `list_dir` on `portal/` to confirm TASK-027 produced the scaffold (`index.ts`, `env.ts`, `db.ts`, `migrate.ts`).
- [ ] Use Serena `find_file` for `001_init.sql` under `portal/migrations/` to confirm TASK-029 landed the schema.
- [ ] Use Serena `search_for_pattern` for `requireSession` in `portal/` to confirm TASK-030 auth guards exist; note the import path.
- [ ] Note the app entry file (likely `portal/index.ts`) and how routes are registered (plugin or direct `app.register`).
- [ ] If any prerequisite is missing, STOP and report which task is unmet.

### 2. Implement `portal/lib/crypto.ts` — shared hashing and code-generation utilities  <!-- agent: general-purpose -->

- [ ] Create `portal/lib/crypto.ts` with the following exports (no side effects at import time):
  - `CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'` — the 32-char alphabet.
  - `generatePairingCode(): string` — returns an 8-char string from the Crockford alphabet (use `crypto.randomBytes(5)`, map each 5-bit chunk via modulo-32 index into CROCKFORD). No dashes in the raw code — caller formats as `XXXX-XXXX`.
  - `formatPairingCode(code: string): string` — inserts a `-` after char 4: `code.slice(0,4) + '-' + code.slice(4)`.
  - `normalisePairingCode(input: string): string` — uppercase, strip all non-Crockford characters (i.e. strip `-` and spaces), 8 chars result; throw `Error('invalid_pairing_code')` if result length ≠ 8 or any char not in CROCKFORD.
  - `sha256(data: Buffer | string): Buffer` — `createHash('sha256').update(data).digest()` returning a raw 32-byte Buffer (NOT hex string — Postgres bytea).
  - `generateDeviceToken(): string` — returns `'tcd_' + randomBytes(32).toString('base64url')`.
- [ ] All functions use Node `node:crypto` (builtin) — no new npm dependency.

### 3. Implement `portal/routes/pair.ts`  <!-- agent: general-purpose -->

- [ ] Create `portal/routes/pair.ts` exporting a Fastify plugin (async function receiving `app, opts`) that registers the two endpoints.

**`POST /api/pair/code`** (generates a pairing code for the signed-in allowlisted user):
- [ ] Apply `requireSession` + `requireAllowed` preHandlers (imported from `portal/auth/guards.ts`, confirming the import path from Step 1).
- [ ] Rate-limit check: query `SELECT count(*)::int AS cnt FROM pairing_codes WHERE user_id = $1 AND redeemed_at IS NULL AND expires_at > now()` with `[req.user.id]`. If `cnt >= 5` return status 429 `{ error: 'too_many_pending_codes', message: 'You have 5 unredeemed pairing codes. Wait for them to expire or use one first.' }`.
- [ ] Generate code: `const raw = generatePairingCode()` (from `portal/lib/crypto.ts`); compute `const hash = sha256(raw)`.
- [ ] Insert: `INSERT INTO pairing_codes (user_id, code_hash, expires_at) VALUES ($1, $2, $3)` with `[req.user.id, hash, new Date(Date.now() + 10 * 60 * 1000)]`.
- [ ] Return 200 `{ code: formatPairingCode(raw), expiresAt: <iso string, now + 10min> }`. Never return the raw hash.

**`POST /api/pair/redeem`** (redeems a code; unauthenticated — called by daemon with only the code):
- [ ] Parse body `{ code: string }` — if missing/not string return 400 `{ error: 'missing_code' }`.
- [ ] Normalise: `normalisePairingCode(body.code)` — catch the `invalid_pairing_code` error and return 400 `{ error: 'invalid_or_expired_code' }` (do not leak why it failed).
- [ ] Compute `const hash = sha256(normalised)`.
- [ ] Open a pg client via `getPool().connect()` and begin a transaction.
- [ ] Atomic redemption: `UPDATE pairing_codes SET redeemed_at = now() WHERE code_hash = $1 AND redeemed_at IS NULL AND expires_at > now() RETURNING id, user_id` with `[hash]`. If `rowCount === 0` → ROLLBACK + 400 `{ error: 'invalid_or_expired_code' }`.
- [ ] Generate device token: `const token = generateDeviceToken()`; compute `const tokenHash = sha256(token)`.
- [ ] Insert device: `INSERT INTO devices (user_id, token_hash) VALUES ($1, $2) RETURNING id` with `[user_id, tokenHash]`.
- [ ] Update pairing code: `UPDATE pairing_codes SET device_id = $1 WHERE id = $2` with `[deviceId, pairingCodeId]`.
- [ ] COMMIT.
- [ ] Return 200 `{ token, deviceId }`. The `token` is the plaintext device token shown exactly once; `deviceId` is the UUID for the new device row. Never log the plaintext token.
- [ ] In the `catch` block: ROLLBACK + release client + rethrow (Fastify's error handler returns 500).
- [ ] In a `finally`: `client.release()`.

### 4. Register routes and verify types  <!-- agent: general-purpose -->

- [ ] In `portal/index.ts` (the app entry from Step 1), add `app.register(import('./routes/pair.js'))` (or the equivalent ESM import pattern used by existing route registrations — mirror that pattern exactly).
- [ ] Run `npx tsc --noEmit` from `portal/` — zero type errors. Fix any type issues before proceeding.

### 5. Integration verification  <!-- agent: general-purpose -->

- [ ] Boot the portal with `DATABASE_URL` pointing at a dev Postgres that has the Phase 1 migrations applied (`portal/migrations/001_init.sql` via `npm run migrate`).
- [ ] Create a test user row directly: `INSERT INTO users (google_sub, email, is_allowed) VALUES ('test-sub', 'test@example.com', true) RETURNING id;` — save the returned `id`.
- [ ] Simulate the `/api/pair/code` call. Because the endpoint requires `requireSession`, use a test JWT or a short-circuit approach (e.g. insert a session via the test user's id and sign a `tc_session` manually using the `signSession` helper from `portal/auth/session.ts`). Check: 200 response contains `{ code: 'XXXX-XXXX', expiresAt: '...' }`.
- [ ] Call `/api/pair/redeem` with `{ code: <the code from above> }`. Confirm: 200 response contains `{ token: 'tcd_...', deviceId: '<uuid>' }`.
- [ ] Second redeem attempt with the same code → 400 `invalid_or_expired_code`.
- [ ] Rate-limit test: call `/api/pair/code` 5 more times (4 succeeds, 5th returns 429 since the first code is still unredeemed — or adjust test to have ≥5 outstanding). Confirm 429 body matches `too_many_pending_codes`.
- [ ] Scratch output (JQ-formatted curl responses, psql query snapshots) goes under `./tmp/pair-verify/`. Never `/tmp`.

## Acceptance Criteria

- [ ] `portal/lib/crypto.ts` exports `generatePairingCode`, `formatPairingCode`, `normalisePairingCode`, `sha256`, `generateDeviceToken` using Node `node:crypto` only.
- [ ] `POST /api/pair/code` is guarded by `requireSession` + `requireAllowed`, enforces ≤5 outstanding codes per user (429), inserts a `pairing_codes` row with a hashed code and 10-minute expiry, and returns `{ code: 'XXXX-XXXX', expiresAt }`. The plaintext code is never persisted.
- [ ] `POST /api/pair/redeem` is unauthenticated, atomically redeems the code in a transaction (`WHERE redeemed_at IS NULL AND expires_at > now()`), creates a `devices` row with a hashed device token, returns `{ token: 'tcd_...', deviceId }` exactly once. The plaintext token is never persisted or logged.
- [ ] A second redemption of the same code returns 400.
- [ ] `npx tsc --noEmit` passes from `portal/` with zero errors.
- [ ] Integration verification in Step 5 passes.

## Dependencies

- **DEPENDS ON [TASK-027](TASK-027-scaffold-portal-foundation.md)** — portal Fastify scaffold, `env.ts`, `db.ts` (`getPool`), `index.ts` route registration entry point.
- **DEPENDS ON [TASK-029](TASK-029-portal-pg-migration-001.md)** — `pairing_codes` and `devices` tables in Postgres.
- **DEPENDS ON [TASK-030](TASK-030-portal-google-oidc-session-allowlist.md)** — `requireSession` and `requireAllowed` guards, `req.user` shape.

### Roadmap

Implements ROADMAP-002 Phase 3, item "Pairing-code creation API + rate-limited /pair/redeem (hashed, single-use, 10-min expiry)" — `wiki/work/roadmaps/ROADMAP-002-hosted-portal-oauth-relay-installer.md`.
