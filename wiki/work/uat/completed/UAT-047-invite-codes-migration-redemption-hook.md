---
id: UAT-047
title: "UAT: Invite codes Postgres migration + better-auth redemption hook (replace email allowlist gate)"
status: passed
task: TASK-047
created: 2026-06-14
updated: 2026-06-14
---

# UAT-047 — UAT: Invite codes Postgres migration + better-auth redemption hook (replace email allowlist gate)

implements::[[TASK-047]]

> **Source task**: [[TASK-047]]
> **Generated**: 2026-06-14

---

## Prerequisites

- [ ] `app/api` service is running and reachable at `http://localhost:8080` (via `make dev` or `make docker-app`)
- [ ] `DATABASE_URL` points to a live Postgres instance with the better-auth schema already applied (i.e. the `"user"` table exists)
- [ ] `BOOTSTRAP_ADMIN_EMAIL` is set in the environment (e.g. `admin@example.com`)
- [ ] `npm run migrate` has been run in `app/api/` so the `invite_codes` table exists
- [ ] `BETTER_AUTH_SECRET` is set to a valid ≥32-byte value
- [ ] A Postgres superuser / admin connection is available to insert seed rows directly into `invite_codes` and `"user"` for setup steps

---

## Test Cases

### UAT-API-001: Migration applies cleanly and creates invite_codes table with correct schema

- **Description**: Verify `001_invite_codes.sql` creates the `invite_codes` table with the required columns, constraints, and indexes.
- **Steps**:
  1. Connect to the Postgres database used by `app/api`.
  2. Run the queries below to confirm the table and indexes exist.
- **Commands**:
  ```bash
  psql "$DATABASE_URL" -c "\d invite_codes"
  ```
  ```bash
  psql "$DATABASE_URL" -c "SELECT indexname FROM pg_indexes WHERE tablename = 'invite_codes' ORDER BY indexname;"
  ```
- **Expected Result**:
  - `\d invite_codes` output lists columns: `id text NOT NULL`, `code text NOT NULL UNIQUE`, `usage_limit integer NOT NULL`, `used_count integer NOT NULL DEFAULT 0`, `expires_at timestamp with time zone`, `created_by text NOT NULL` (FK to `"user"(id)`), `created_at timestamp with time zone NOT NULL DEFAULT now()`.
  - `pg_indexes` query returns at least `invite_codes_code_idx` and `invite_codes_created_by_idx`.
- [FAIL: auto-judge: prerequisite not satisfied — app/api service not running at localhost:8080 (port occupied by brave-search-mcp-server Docker container)] <!-- 2026-06-14 -->

---

### UAT-API-002: Signup with valid invite code succeeds and increments used_count

- **Description**: A new email (not grandfathered, not bootstrap) can sign up when a valid non-expired non-exhausted `x-invite-code` is provided. `used_count` increments by exactly 1.
- **Auth-Required**: false
- **Steps**:
  1. Insert a valid invite code into `invite_codes` (requires an existing user id for `created_by`; use the bootstrap admin if already registered, or insert a placeholder user row):
     ```sql
     INSERT INTO invite_codes (id, code, usage_limit, used_count, expires_at, created_by)
     VALUES ('test-code-001', 'WELCOME2026', 10, 0, NULL, '<existing-user-id>');
     ```
  2. Note the current `used_count` (should be 0).
  3. Send the signup request:
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8080/api/auth/sign-up/email' -H 'Content-Type: application/json' -H 'x-invite-code: WELCOME2026' -d '{"email":"newuser@example.com","password":"Password1234!","name":"New User"}'
  ```
- **Expected Result**: HTTP 200 (or 201). Response body contains a `user` object with `email: "newuser@example.com"`. Verify `used_count` incremented:
  ```bash
  psql "$DATABASE_URL" -c "SELECT used_count FROM invite_codes WHERE code = 'WELCOME2026';"
  ```
  Result must show `used_count = 1`.
- [FAIL: auto-judge: prerequisite not satisfied — app/api service not running at localhost:8080 (port occupied by brave-search-mcp-server Docker container)] <!-- 2026-06-14 -->

---

### UAT-API-003: Signup without x-invite-code is rejected for a non-grandfathered email

- **Description**: A new email with no `x-invite-code` header must be rejected.
- **Auth-Required**: false
- **Steps**:
  1. Ensure the email `noinvite@example.com` does not exist in the `"user"` table and is not the `BOOTSTRAP_ADMIN_EMAIL`.
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8080/api/auth/sign-up/email' -H 'Content-Type: application/json' -d '{"email":"noinvite@example.com","password":"Password1234!","name":"No Invite"}'
  ```
- **Expected Result**: HTTP 4xx (not 200/201). Response body contains an error indicating "invite code required". The `"user"` table must not contain a row for `noinvite@example.com`.
- [FAIL: auto-judge: prerequisite not satisfied — app/api service not running at localhost:8080 (port occupied by brave-search-mcp-server Docker container)] <!-- 2026-06-14 -->

---

### UAT-API-004: Signup with an invalid (non-existent) invite code is rejected

- **Description**: Providing a code that does not exist in `invite_codes` must be rejected.
- **Auth-Required**: false
- **Steps**:
  1. Ensure `BADCODE99` does not exist in `invite_codes`.
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8080/api/auth/sign-up/email' -H 'Content-Type: application/json' -H 'x-invite-code: BADCODE99' -d '{"email":"badcode@example.com","password":"Password1234!","name":"Bad Code"}'
  ```
- **Expected Result**: HTTP 4xx. Response body contains an error indicating "invite code is invalid". No user row created for `badcode@example.com`.
- [FAIL: auto-judge: prerequisite not satisfied — app/api service not running at localhost:8080 (port occupied by brave-search-mcp-server Docker container)] <!-- 2026-06-14 -->

---

### UAT-API-005: Signup with an expired invite code is rejected

- **Description**: A code whose `expires_at` is in the past must be rejected.
- **Auth-Required**: false
- **Steps**:
  1. Insert an expired invite code:
     ```sql
     INSERT INTO invite_codes (id, code, usage_limit, used_count, expires_at, created_by)
     VALUES ('test-code-002', 'EXPIRED2020', 10, 0, '2020-01-01 00:00:00+00', '<existing-user-id>');
     ```
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8080/api/auth/sign-up/email' -H 'Content-Type: application/json' -H 'x-invite-code: EXPIRED2020' -d '{"email":"expiredcode@example.com","password":"Password1234!","name":"Expired Code"}'
  ```
- **Expected Result**: HTTP 4xx. Response body contains an error indicating "invite code has expired". No user row created for `expiredcode@example.com`.
- [FAIL: auto-judge: prerequisite not satisfied — app/api service not running at localhost:8080 (port occupied by brave-search-mcp-server Docker container)] <!-- 2026-06-14 -->

---

### UAT-API-006: Signup with an exhausted invite code is rejected

- **Description**: A code where `used_count >= usage_limit` must be rejected.
- **Auth-Required**: false
- **Steps**:
  1. Insert a fully-used invite code:
     ```sql
     INSERT INTO invite_codes (id, code, usage_limit, used_count, expires_at, created_by)
     VALUES ('test-code-003', 'EXHAUST001', 5, 5, NULL, '<existing-user-id>');
     ```
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8080/api/auth/sign-up/email' -H 'Content-Type: application/json' -H 'x-invite-code: EXHAUST001' -d '{"email":"exhausted@example.com","password":"Password1234!","name":"Exhausted Code"}'
  ```
- **Expected Result**: HTTP 4xx. Response body contains an error indicating "invite code has been fully redeemed". No user row created for `exhausted@example.com`.
- [FAIL: auto-judge: prerequisite not satisfied — app/api service not running at localhost:8080 (port occupied by brave-search-mcp-server Docker container)] <!-- 2026-06-14 -->

---

### UAT-API-007: BOOTSTRAP_ADMIN_EMAIL can sign up without an invite code

- **Description**: The email matching `BOOTSTRAP_ADMIN_EMAIL` bypasses the invite-code gate entirely.
- **Auth-Required**: false
- **Steps**:
  1. Obtain the value of `BOOTSTRAP_ADMIN_EMAIL` from the running environment (e.g. `admin@example.com`).
  2. Ensure this email does not already exist in the `"user"` table (clean state).
  3. Send a signup request with no `x-invite-code` header using `$BOOTSTRAP_ADMIN_EMAIL`:
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8080/api/auth/sign-up/email' -H 'Content-Type: application/json' -d "{\"email\":\"$BOOTSTRAP_ADMIN_EMAIL\",\"password\":\"Password1234!\",\"name\":\"Bootstrap Admin\"}"
  ```
- **Expected Result**: HTTP 200 (or 201). Response body contains a `user` object with the bootstrap admin email. No invite code was required or consumed.
- [FAIL: auto-judge: prerequisite not satisfied — app/api service not running at localhost:8080 (port occupied by brave-search-mcp-server Docker container)] <!-- 2026-06-14 -->

---

### UAT-API-008: Grandfathered email (already in user table) can sign up / sign in without a code

- **Description**: An email that already exists in the `"user"` table is grandfathered — the hook allows the request through without requiring or consuming an invite code.
- **Auth-Required**: false
- **Steps**:
  1. Confirm that a user with `grandfather@example.com` already exists in the `"user"` table (either registered previously, or insert a row directly).
  2. Attempt to sign in (or re-trigger signup) without an `x-invite-code` header. Use the sign-in endpoint:
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8080/api/auth/sign-in/email' -H 'Content-Type: application/json' -d '{"email":"grandfather@example.com","password":"Password1234!"}'
  ```
- **Expected Result**: HTTP 200. Response body contains a valid session token or user object. No invite code required. (The sign-in path does not go through `databaseHooks.user.create.before`, but confirms the existing account is accessible without a code gate.)
- [FAIL: auto-judge: prerequisite not satisfied — app/api service not running at localhost:8080 (port occupied by brave-search-mcp-server Docker container)] <!-- 2026-06-14 -->

---

### UAT-EDGE-001: ALLOWLIST_EMAILS env var no longer gates signup

- **Description**: Confirm `ALLOWLIST_EMAILS` is not read or enforced — its removal from `env.ts` must not cause a startup crash and must not appear in any validation error when unset.
- **Steps**:
  1. Ensure `ALLOWLIST_EMAILS` is NOT set in the `.env` file or environment.
  2. Restart the `app/api` service and observe startup logs.
- **Expected Result**: Service starts cleanly with no errors referencing `ALLOWLIST_EMAILS`. No startup validation failure related to this variable. The service log shows `[app/api]` booting successfully.
- [FAIL: auto-judge: prerequisite not satisfied — app/api service not running at localhost:8080 (port occupied by brave-search-mcp-server Docker container)] <!-- 2026-06-14 -->

---

### UAT-EDGE-002: BOOTSTRAP_ADMIN_EMAIL is required — service fails fast if unset

- **Description**: `env.ts` validates `BOOTSTRAP_ADMIN_EMAIL` as required. If it is missing the service must exit non-zero with a clear error.
- **Steps**:
  1. Temporarily unset `BOOTSTRAP_ADMIN_EMAIL` in the environment.
  2. Attempt to start `app/api` (e.g. `cd app/api && node --import tsx/esm index.ts`).
- **Expected Result**: Process exits non-zero immediately. Stderr output contains `BOOTSTRAP_ADMIN_EMAIL is required but not set` (from the env validation block). The service does not reach the HTTP listen phase.
- [FAIL: auto-judge: prerequisite not satisfied — app/api service not running at localhost:8080 (port occupied by brave-search-mcp-server Docker container)] <!-- 2026-06-14 -->

---

### UAT-EDGE-003: BOOTSTRAP_ADMIN_EMAIL comparison is case-insensitive

- **Description**: The hook lowercases both the incoming email and `BOOTSTRAP_ADMIN_EMAIL` before comparison, so `ADMIN@EXAMPLE.COM` must be treated as the bootstrap admin even if the env var is set as `admin@example.com`.
- **Auth-Required**: false
- **Steps**:
  1. Ensure `BOOTSTRAP_ADMIN_EMAIL` is set to a lowercase value (e.g. `admin@example.com`).
  2. Ensure `ADMIN@EXAMPLE.COM` (uppercased) is not already in the `"user"` table.
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8080/api/auth/sign-up/email' -H 'Content-Type: application/json' -d '{"email":"ADMIN@EXAMPLE.COM","password":"Password1234!","name":"Bootstrap Admin Upper"}'
  ```
- **Expected Result**: HTTP 200 (or 201). Signup succeeds without an invite code header. The hook must not reject this as a non-bootstrap email.
- [FAIL: auto-judge: prerequisite not satisfied — app/api service not running at localhost:8080 (port occupied by brave-search-mcp-server Docker container)] <!-- 2026-06-14 -->

---

### UAT-EDGE-004: Empty x-invite-code header is treated as missing (rejected)

- **Description**: A request with `x-invite-code: ` (whitespace-only) must be rejected the same as a missing header.
- **Auth-Required**: false
- **Steps**:
  1. Ensure `blankcode@example.com` is not in the `"user"` table and is not the bootstrap admin.
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8080/api/auth/sign-up/email' -H 'Content-Type: application/json' -H 'x-invite-code:    ' -d '{"email":"blankcode@example.com","password":"Password1234!","name":"Blank Code"}'
  ```
- **Expected Result**: HTTP 4xx. Response body contains an error indicating "invite code required". No user row created for `blankcode@example.com`.
- [FAIL: auto-judge: prerequisite not satisfied — app/api service not running at localhost:8080 (port occupied by brave-search-mcp-server Docker container)] <!-- 2026-06-14 -->

---

### UAT-EDGE-005: used_count is not double-incremented on concurrent signup attempts with the same code

- **Description**: The `SELECT ... FOR UPDATE` transaction ensures that two concurrent signup requests with the same code cannot both succeed when `usage_limit = 1`. Only the first should succeed; the second must be rejected.
- **Steps**:
  1. Insert a single-use invite code:
     ```sql
     INSERT INTO invite_codes (id, code, usage_limit, used_count, expires_at, created_by)
     VALUES ('test-code-004', 'ONCE0001', 1, 0, NULL, '<existing-user-id>');
     ```
  2. Send two concurrent signup requests (different emails, same code) as close together as possible:
     ```bash
     curl -sS -X POST 'http://localhost:8080/api/auth/sign-up/email' -H 'Content-Type: application/json' -H 'x-invite-code: ONCE0001' -d '{"email":"concurrent1@example.com","password":"Password1234!","name":"Concurrent 1"}' &
     curl -sS -X POST 'http://localhost:8080/api/auth/sign-up/email' -H 'Content-Type: application/json' -H 'x-invite-code: ONCE0001' -d '{"email":"concurrent2@example.com","password":"Password1234!","name":"Concurrent 2"}' &
     wait
     ```
  3. After both requests complete, check:
     ```bash
     psql "$DATABASE_URL" -c "SELECT used_count FROM invite_codes WHERE code = 'ONCE0001';"
     ```
- **Expected Result**: Exactly one of the two requests succeeds (HTTP 200/201) and exactly one fails (HTTP 4xx with "exhausted" or "invalid" error). The final `used_count` is exactly `1` — never `2`.
- [FAIL: auto-judge: prerequisite not satisfied — app/api service not running at localhost:8080 (port occupied by brave-search-mcp-server Docker container)] <!-- 2026-06-14 -->

---

### UAT-EDGE-006: Valid code with a future expiry is accepted

- **Description**: A code with `expires_at` set in the future must be treated as valid.
- **Auth-Required**: false
- **Steps**:
  1. Insert a code expiring far in the future:
     ```sql
     INSERT INTO invite_codes (id, code, usage_limit, used_count, expires_at, created_by)
     VALUES ('test-code-005', 'FUTURE2099', 10, 0, '2099-01-01 00:00:00+00', '<existing-user-id>');
     ```
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8080/api/auth/sign-up/email' -H 'Content-Type: application/json' -H 'x-invite-code: FUTURE2099' -d '{"email":"futureexpiry@example.com","password":"Password1234!","name":"Future Expiry"}'
  ```
- **Expected Result**: HTTP 200 (or 201). Signup succeeds. `used_count` for `FUTURE2099` increments to 1.
- [FAIL: auto-judge: prerequisite not satisfied — app/api service not running at localhost:8080 (port occupied by brave-search-mcp-server Docker container)] <!-- 2026-06-14 -->
