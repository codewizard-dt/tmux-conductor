---
id: UAT-031
title: "UAT: app/api pairing-code creation API + rate-limited /pair/redeem (hashed, single-use, 10-min expiry)"
status: passed
task: TASK-031
created: 2026-06-14
updated: 2026-06-14
---

# UAT-031 — UAT: app/api pairing-code creation API + rate-limited /pair/redeem

implements::[[TASK-031]]

> **Source task**: [[TASK-031]]
> **Generated**: 2026-06-14

---

## Prerequisites

- [ ] `app/api` service is running and reachable at `http://localhost:8080` (e.g. `cd app/api && npm run dev`)
- [ ] A Postgres database is running and reachable via `DATABASE_URL`
- [ ] `npm run migrate` has been run from `app/api/` to apply both `001_invite_codes.sql` and `002_pairing_devices.sql`
- [ ] better-auth schema has been applied (`npm run auth:generate` or `@better-auth/cli migrate`)
- [ ] A test user exists in the better-auth `"user"` table with email `testuser@example.com` and a known password (see UAT-API-001 for sign-up or use DB direct insert)
- [ ] `BOOTSTRAP_ADMIN_EMAIL` is set in `.env` (used to bypass the invite-code gate if needed to create the test user)
- [ ] Scratch directory `./tmp/pair-verify/` exists (or will be created automatically)

---

## Test Cases

### UAT-API-001: Sign in and obtain a session cookie for subsequent auth-gated tests

- **Endpoint**: `POST /api/auth/sign-in/email`
- **Description**: Obtain a better-auth session cookie for a valid user — required for all `POST /api/pair/code` tests. The test user must already exist (register via `POST /api/auth/sign-up/email` or ensure `BOOTSTRAP_ADMIN_EMAIL` matches the test email).
- **Steps**:
  1. Ensure the test user `testuser@example.com` exists. If not, register them first:
     ```bash
     curl -sS -X POST 'http://localhost:8080/api/auth/sign-up/email' -H 'Content-Type: application/json' -d '{"email":"testuser@example.com","password":"Test1234!","name":"Test User"}'
     ```
  2. Sign in to obtain the session cookie:
- **Command**:
  ```bash
  curl -sS -c ./tmp/pair-verify/cookies.txt -X POST 'http://localhost:8080/api/auth/sign-in/email' -H 'Content-Type: application/json' -d '{"email":"testuser@example.com","password":"Test1234!"}' | jq .
  ```
- **Expected Result**: HTTP 200 with a JSON body containing a `user` object (including `id` and `email`). The `./tmp/pair-verify/cookies.txt` file is created and contains a `better-auth.session_token` (or equivalent) cookie. This cookie jar is used by all subsequent auth-gated tests.
- [FAIL: auto-judge: prerequisite not satisfied — app/api service not running at localhost:8080] <!-- 2026-06-14 -->

---

### UAT-API-002: POST /api/pair/code — happy path generates formatted pairing code

- **Endpoint**: `POST /api/pair/code`
- **Description**: A signed-in, allowlisted user requests a pairing code. The response contains a dash-formatted 8-char Crockford base32 code and an expiry ~10 minutes in the future. No plaintext code is stored in the DB.
- **Auth-Required**: true
- **Auth-Role**: user (session from UAT-API-001)
- **Steps**:
  1. Ensure the cookies file from UAT-API-001 exists at `./tmp/pair-verify/cookies.txt`.
  2. Run the command below.
  3. Save the returned `code` value (e.g. `ABCD-EFGH`) for use in UAT-API-004 and UAT-API-005.
- **Command**:
  ```bash
  curl -sS -b ./tmp/pair-verify/cookies.txt -X POST 'http://localhost:8080/api/pair/code' -H 'Content-Type: application/json' | jq .
  ```
- **Expected Result**: HTTP 200. Body is `{ "code": "<4chars>-<4chars>", "expiresAt": "<ISO 8601 timestamp>" }`. The `code` field matches the pattern `^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$` (Crockford base32, no O/I/L/U). The `expiresAt` is within 10–11 minutes of the current time.
- [FAIL: auto-judge: prerequisite not satisfied — app/api service not running at localhost:8080] <!-- 2026-06-14 -->

---

### UAT-API-003: POST /api/pair/code — rejects unauthenticated requests with 401

- **Endpoint**: `POST /api/pair/code`
- **Description**: Calling the code-generation endpoint without a session cookie returns 401 unauthenticated.
- **Steps**:
  1. Run the command below (no cookies).
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8080/api/pair/code' -H 'Content-Type: application/json' | jq .
  ```
- **Expected Result**: HTTP 401. Body is `{ "error": "unauthenticated" }`.
- [FAIL: auto-judge: prerequisite not satisfied — app/api service not running at localhost:8080] <!-- 2026-06-14 -->

---

### UAT-API-004: POST /api/pair/redeem — happy path redeems code, returns device token

- **Endpoint**: `POST /api/pair/redeem`
- **Description**: An unauthenticated caller redeems a valid, unexpired pairing code. The response contains a one-time plaintext device token (prefixed `tcd_`) and a UUID for the new device row. The pairing code is marked redeemed and a devices row is created.
- **Steps**:
  1. Obtain a fresh pairing code using UAT-API-002 and note the value (e.g. `ABCD-EFGH`). Substitute it in the command below.
  2. Run the command (no cookies required — this endpoint is unauthenticated).
  3. Save the returned `token` and `deviceId` for verification.
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8080/api/pair/redeem' -H 'Content-Type: application/json' -d '{"code":"ABCD-EFGH"}' | jq .
  ```
  *(Replace `ABCD-EFGH` with the actual code from UAT-API-002.)*
- **Expected Result**: HTTP 200. Body is `{ "token": "tcd_<base64url>", "deviceId": "<uuid>" }`. The `token` starts with `tcd_` followed by a base64url string of ~43 chars (32 bytes base64url-encoded). The `deviceId` is a UUID v4.
- [FAIL: auto-judge: prerequisite not satisfied — app/api service not running at localhost:8080] <!-- 2026-06-14 -->

---

### UAT-API-005: POST /api/pair/redeem — single-use: second redemption of same code returns 400

- **Endpoint**: `POST /api/pair/redeem`
- **Description**: Attempting to redeem a code that has already been redeemed returns 400 with `invalid_or_expired_code`. This verifies the atomic single-use guard.
- **Steps**:
  1. Use the same pairing code that was successfully redeemed in UAT-API-004.
  2. Run the command below a second time with that same code.
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8080/api/pair/redeem' -H 'Content-Type: application/json' -d '{"code":"ABCD-EFGH"}' | jq .
  ```
  *(Replace `ABCD-EFGH` with the same code used in UAT-API-004.)*
- **Expected Result**: HTTP 400. Body is `{ "error": "invalid_or_expired_code" }`.
- [FAIL: auto-judge: prerequisite not satisfied — app/api service not running at localhost:8080] <!-- 2026-06-14 -->

---

### UAT-API-006: POST /api/pair/redeem — missing `code` field returns 400 missing_code

- **Endpoint**: `POST /api/pair/redeem`
- **Description**: Calling /pair/redeem with no `code` field in the body returns 400 with `missing_code`.
- **Steps**:
  1. Run the command below with an empty body.
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8080/api/pair/redeem' -H 'Content-Type: application/json' -d '{}' | jq .
  ```
- **Expected Result**: HTTP 400. Body is `{ "error": "missing_code" }`.
- [FAIL: auto-judge: prerequisite not satisfied — app/api service not running at localhost:8080] <!-- 2026-06-14 -->

---

### UAT-API-007: POST /api/pair/redeem — invalid format code returns 400 invalid_or_expired_code

- **Endpoint**: `POST /api/pair/redeem`
- **Description**: Submitting a code that fails normalisation (wrong length, disallowed characters, or plain garbage) returns 400. The error message does not leak which validation failed.
- **Steps**:
  1. Run the command below with a malformed code.
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8080/api/pair/redeem' -H 'Content-Type: application/json' -d '{"code":"INVALID"}' | jq .
  ```
- **Expected Result**: HTTP 400. Body is `{ "error": "invalid_or_expired_code" }` (not `missing_code`, not a stack trace or validation detail).
- [FAIL: auto-judge: prerequisite not satisfied — app/api service not running at localhost:8080] <!-- 2026-06-14 -->

---

### UAT-API-008: POST /api/pair/redeem — non-existent (but validly-formatted) code returns 400

- **Endpoint**: `POST /api/pair/redeem`
- **Description**: A correctly-formatted 8-char Crockford code that does not exist in the database (or has expired) returns 400 rather than 500.
- **Steps**:
  1. Run the command below with a code that has never been issued.
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8080/api/pair/redeem' -H 'Content-Type: application/json' -d '{"code":"ZZZZZZZZ"}' | jq .
  ```
- **Expected Result**: HTTP 400. Body is `{ "error": "invalid_or_expired_code" }`.
- [FAIL: auto-judge: prerequisite not satisfied — app/api service not running at localhost:8080] <!-- 2026-06-14 -->

---

### UAT-API-009: POST /api/pair/redeem — accepts code with or without dash formatting

- **Endpoint**: `POST /api/pair/redeem`
- **Description**: The endpoint normalises the code by stripping dashes and uppercasing before hashing, so `XXXX-XXXX`, `xxxxxxxx`, and `XXXXXXXX` all resolve to the same hash. Verify the dash-stripped lower-cased form is accepted.
- **Steps**:
  1. Generate a fresh pairing code via UAT-API-002. Note the displayed format (e.g. `ABCD-EFGH`).
  2. Strip the dash and lowercase the code (e.g. `abcdefgh`), then use it in the command below.
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8080/api/pair/redeem' -H 'Content-Type: application/json' -d '{"code":"abcdefgh"}' | jq .
  ```
  *(Replace `abcdefgh` with the lowercased, dash-stripped form of the fresh code.)*
- **Expected Result**: HTTP 200. Body is `{ "token": "tcd_<base64url>", "deviceId": "<uuid>" }` — same as UAT-API-004. The code is accepted regardless of dash or case.
- [FAIL: auto-judge: prerequisite not satisfied — app/api service not running at localhost:8080] <!-- 2026-06-14 -->

---

### UAT-API-010: POST /api/pair/code — rate limit: 5th outstanding code triggers 429

- **Endpoint**: `POST /api/pair/code`
- **Description**: A user may not have more than 5 unredeemed, non-expired pairing codes at once. The 6th request (with 5 still outstanding) returns 429 with `too_many_pending_codes`.
- **Auth-Required**: true
- **Auth-Role**: user (session from UAT-API-001)
- **Steps**:
  1. Ensure the test user has 0 outstanding codes (redeem or wait for existing codes to expire, or create a fresh test user).
  2. Call `POST /api/pair/code` five times in sequence to generate 5 unredeemed codes:
     ```bash
     for i in 1 2 3 4 5; do curl -sS -b ./tmp/pair-verify/cookies.txt -X POST 'http://localhost:8080/api/pair/code' -H 'Content-Type: application/json' | jq -r '.code'; done
     ```
  3. Attempt a 6th call:
- **Command**:
  ```bash
  curl -sS -b ./tmp/pair-verify/cookies.txt -X POST 'http://localhost:8080/api/pair/code' -H 'Content-Type: application/json' | jq .
  ```
- **Expected Result**: HTTP 429. Body is `{ "error": "too_many_pending_codes", "message": "You have 5 unredeemed pairing codes. Wait for them to expire or use one first." }`.
- [FAIL: auto-judge: prerequisite not satisfied — app/api service not running at localhost:8080] <!-- 2026-06-14 -->

---

### UAT-EDGE-001: POST /api/pair/code — rate limit resets after a code is redeemed

- **Scenario**: After a user hits the 5-code limit and redeems one of the outstanding codes, they can generate a new code.
- **Steps**:
  1. Start from the state at the end of UAT-API-010 (5 outstanding codes, 6th blocked).
  2. Redeem one of the 5 codes via `POST /api/pair/redeem` using the command from UAT-API-004.
  3. Immediately call `POST /api/pair/code` again:
     ```bash
     curl -sS -b ./tmp/pair-verify/cookies.txt -X POST 'http://localhost:8080/api/pair/code' -H 'Content-Type: application/json' | jq .
     ```
- **Expected Result**: HTTP 200 with a new `{ code, expiresAt }` body — the rate-limit gate is cleared because the redeemed code no longer counts toward the 5-outstanding limit.
- [FAIL: auto-judge: manual test requires human verification] <!-- 2026-06-14 -->

---

### UAT-EDGE-002: POST /api/pair/redeem — no `code` key in JSON (non-string value) returns 400 missing_code

- **Scenario**: Body contains a `code` key but its value is not a string (e.g. `null` or a number).
- **Steps**:
  1. Run the commands below.
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8080/api/pair/redeem' -H 'Content-Type: application/json' -d '{"code":null}' | jq .
  ```
- **Expected Result**: HTTP 400. Body is `{ "error": "missing_code" }` (the `typeof body.code !== 'string'` guard fires for `null`).
- [FAIL: auto-judge: prerequisite not satisfied — app/api service not running at localhost:8080] <!-- 2026-06-14 -->

---

### UAT-EDGE-003: Plaintext token is not stored — only hash is persisted in devices table

- **Scenario**: After a successful redemption, verify that the plaintext token is not stored in the database; only the SHA-256 hash (bytea) appears in `devices.token_hash`.
- **Steps**:
  1. Perform a successful redemption (UAT-API-004) and note the returned `token` (e.g. `tcd_abc123…`) and `deviceId`.
  2. Query the database directly:
     ```bash
     psql "$DATABASE_URL" -c "SELECT id, length(token_hash) AS hash_len, token_hash IS NOT NULL AS has_hash FROM devices WHERE id = '<deviceId>';"
     ```
     *(Replace `<deviceId>` with the UUID from UAT-API-004.)*
  3. Verify: `hash_len` should be 32 (SHA-256 = 32 bytes). The raw token value `tcd_abc123…` must not appear anywhere in the row.
- **Expected Result**: The `devices` row has `hash_len = 32`, `has_hash = true`. A search of the `token_hash` bytea column for the literal string `tcd_` returns no results — confirming the plaintext is never stored.
- [FAIL: auto-judge: manual test requires human verification] <!-- 2026-06-14 -->

---

### UAT-EDGE-004: Pairing code hash is not stored in plaintext — only SHA-256 hash in pairing_codes

- **Scenario**: After a code is generated, the `pairing_codes` table must contain only the hash, not the raw code string.
- **Steps**:
  1. Generate a pairing code (UAT-API-002) and note the code value (e.g. `ABCD-EFGH`).
  2. Query the database directly:
     ```bash
     psql "$DATABASE_URL" -c "SELECT id, length(code_hash) AS hash_len, redeemed_at, expires_at FROM pairing_codes ORDER BY created_at DESC LIMIT 1;"
     ```
  3. Confirm `hash_len = 32` and that the raw code characters do not appear in any column.
- **Expected Result**: `hash_len = 32`, `redeemed_at` is NULL (not yet redeemed), `expires_at` is approximately 10 minutes after `created_at`. The code value (e.g. `ABCD`) does not appear in any text column of the row.
- [FAIL: auto-judge: manual test requires human verification] <!-- 2026-06-14 -->
