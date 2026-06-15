---
id: UAT-048
title: "UAT: Invite codes Fastify routes — public validate + admin CRUD"
status: passed
task: TASK-048
created: 2026-06-14
updated: 2026-06-14
---

# UAT-048 — UAT: Invite codes Fastify routes — public validate + admin CRUD

implements::[[TASK-048]]

> **Source task**: [[TASK-048]]
> **Generated**: 2026-06-14

---

## Prerequisites

- [ ] `app/api` is running on port 8080 (`cd app/api && npm run dev` or `make dev`)
- [ ] A Postgres database is reachable and `DATABASE_URL` is set
- [ ] `BOOTSTRAP_ADMIN_EMAIL` env var is set (the admin email for guard tests)
- [ ] The `invite_codes` table exists (TASK-047 migration ran)
- [ ] An admin session cookie is available for admin-route tests — obtain by signing in as `BOOTSTRAP_ADMIN_EMAIL` via better-auth and exporting the session value as `UAT_ADMIN_COOKIE`
- [ ] A non-admin session cookie is available for 403 tests — sign in as a different email and export as `UAT_USER_COOKIE`

---

## Test Cases

### UAT-API-001: Validate — unknown code returns `{valid:false, error:'invalid'}`
- **Endpoint**: `POST /api/invite-codes/validate`
- **Description**: A code that does not exist in `invite_codes` returns a 200 with `valid: false` and `error: 'invalid'`. No auth required.
- **Steps**:
  1. Ensure no row with `code = 'DOESNOTEXIST9999'` is present in `invite_codes`.
  2. Run the curl command below.
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8080/api/invite-codes/validate' -H 'Content-Type: application/json' -d '{"code":"DOESNOTEXIST9999"}'
  ```
- **Expected Result**: HTTP 200, body `{"valid":false,"error":"invalid"}`
- [x] Pass <!-- 2026-06-14 -->

---

### UAT-API-002: Validate — valid usable code returns `{valid:true}`
- **Endpoint**: `POST /api/invite-codes/validate`
- **Description**: A code that exists, has not expired, and has remaining uses returns `{valid:true}` with no mutation to `used_count`.
- **Steps**:
  1. Insert a test invite code directly into the DB (or via UAT-API-006 after admin create is passing): `code = 'UAT-VALID-001'`, `usage_limit = 10`, `used_count = 0`, `expires_at = NULL`.
  2. Note the current `used_count` for the row.
  3. Run the curl command below.
  4. Re-query `used_count` from the DB and confirm it is unchanged.
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8080/api/invite-codes/validate' -H 'Content-Type: application/json' -d '{"code":"UAT-VALID-001"}'
  ```
- **Expected Result**: HTTP 200, body `{"valid":true}`. `used_count` in the DB is unchanged from before the request.
- [x] Pass <!-- 2026-06-14 -->

---

### UAT-API-003: Validate — expired code returns `{valid:false, error:'expired'}`
- **Endpoint**: `POST /api/invite-codes/validate`
- **Description**: A code whose `expires_at` is in the past returns `{valid:false, error:'expired'}`.
- **Steps**:
  1. Insert (or ensure) a row with `code = 'UAT-EXPIRED-001'`, `usage_limit = 10`, `used_count = 0`, `expires_at` = a timestamp in the past (e.g. `2020-01-01T00:00:00Z`).
  2. Run the curl command below.
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8080/api/invite-codes/validate' -H 'Content-Type: application/json' -d '{"code":"UAT-EXPIRED-001"}'
  ```
- **Expected Result**: HTTP 200, body `{"valid":false,"error":"expired"}`
- [x] Pass <!-- 2026-06-14 -->

---

### UAT-API-004: Validate — exhausted code returns `{valid:false, error:'exhausted'}`
- **Endpoint**: `POST /api/invite-codes/validate`
- **Description**: A code where `used_count >= usage_limit` returns `{valid:false, error:'exhausted'}`.
- **Steps**:
  1. Insert (or ensure) a row with `code = 'UAT-EXHAUSTED-001'`, `usage_limit = 2`, `used_count = 2`, `expires_at = NULL`.
  2. Run the curl command below.
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8080/api/invite-codes/validate' -H 'Content-Type: application/json' -d '{"code":"UAT-EXHAUSTED-001"}'
  ```
- **Expected Result**: HTTP 200, body `{"valid":false,"error":"exhausted"}`
- [x] Pass <!-- 2026-06-14 -->

---

### UAT-API-005: Validate — missing `code` field returns 400
- **Endpoint**: `POST /api/invite-codes/validate`
- **Description**: Fastify JSON Schema validation rejects requests missing the required `code` field.
- **Steps**:
  1. Run the curl command below (body omits `code`).
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8080/api/invite-codes/validate' -H 'Content-Type: application/json' -d '{}'
  ```
- **Expected Result**: HTTP 400. Body contains a Fastify validation error (e.g. `{"statusCode":400,...}`).
- [x] Pass <!-- 2026-06-14 -->

---

### UAT-API-006: Admin — create invite code (happy path)
- **Endpoint**: `POST /api/admin/invite-codes`
- **Auth-Required**: true
- **Auth-Role**: admin (BOOTSTRAP_ADMIN_EMAIL session)
- **Description**: Admin can create a new invite code. Response is 201 with the full row including generated `id` and `created_by`.
- **Steps**:
  1. Export admin session cookie: `export UAT_ADMIN_COOKIE="<session-cookie-from-login>"`
  2. Run the curl command below.
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8080/api/admin/invite-codes' -H 'Content-Type: application/json' -H "Cookie: $UAT_ADMIN_COOKIE" -d '{"code":"UAT-ADMIN-CREATE-001","usageLimit":5}'
  ```
- **Expected Result**: HTTP 201. Body is a JSON object containing `id` (a UUID), `code: "UAT-ADMIN-CREATE-001"`, `usage_limit: 5`, `used_count: 0`, `expires_at: null`, `created_by` (the admin user's id), `created_at` (a timestamp).
- [x] Pass <!-- 2026-06-14 -->

---

### UAT-API-007: Admin — create invite code with `expiresAt`
- **Endpoint**: `POST /api/admin/invite-codes`
- **Auth-Required**: true
- **Auth-Role**: admin
- **Description**: Admin can create a code with an optional `expiresAt` ISO string; the value is stored in `expires_at`.
- **Steps**:
  1. Run the curl command below (with a future expiry date).
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8080/api/admin/invite-codes' -H 'Content-Type: application/json' -H "Cookie: $UAT_ADMIN_COOKIE" -d '{"code":"UAT-EXPIRES-001","usageLimit":1,"expiresAt":"2099-12-31T23:59:59Z"}'
  ```
- **Expected Result**: HTTP 201. Body contains `expires_at` equal to (or equivalent to) `2099-12-31T23:59:59Z`. Running validate with `code = 'UAT-EXPIRES-001'` returns `{"valid":true}`.
- [x] Pass <!-- 2026-06-14 -->

---

### UAT-API-008: Admin — list invite codes
- **Endpoint**: `GET /api/admin/invite-codes`
- **Auth-Required**: true
- **Auth-Role**: admin
- **Description**: Admin receives an array of all invite codes ordered by `created_at DESC`.
- **Steps**:
  1. Run the curl command below (assumes at least one code was created in UAT-API-006).
- **Command**:
  ```bash
  curl -sS 'http://localhost:8080/api/admin/invite-codes' -H "Cookie: $UAT_ADMIN_COOKIE"
  ```
- **Expected Result**: HTTP 200. Body is a JSON array. Each element has `id`, `code`, `usage_limit`, `used_count`, `expires_at`, `created_by`, `created_at`. Array is ordered newest first.
- [x] Pass <!-- 2026-06-14 -->

---

### UAT-API-009: Admin — duplicate code returns 409
- **Endpoint**: `POST /api/admin/invite-codes`
- **Auth-Required**: true
- **Auth-Role**: admin
- **Description**: Creating a code with a `code` value that already exists returns 409 `{error:'duplicate_code'}`.
- **Steps**:
  1. Ensure `UAT-ADMIN-CREATE-001` already exists (created in UAT-API-006).
  2. Run the curl command below (same code value).
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8080/api/admin/invite-codes' -H 'Content-Type: application/json' -H "Cookie: $UAT_ADMIN_COOKIE" -d '{"code":"UAT-ADMIN-CREATE-001","usageLimit":1}'
  ```
- **Expected Result**: HTTP 409, body `{"error":"duplicate_code"}`
- [x] Pass <!-- 2026-06-14 -->

---

### UAT-API-010: Admin — create with invalid body (code too short) returns 400
- **Endpoint**: `POST /api/admin/invite-codes`
- **Auth-Required**: true
- **Auth-Role**: admin
- **Description**: Fastify JSON Schema rejects `code` shorter than 4 characters.
- **Steps**:
  1. Run the curl command below (`code` is 3 chars).
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8080/api/admin/invite-codes' -H 'Content-Type: application/json' -H "Cookie: $UAT_ADMIN_COOKIE" -d '{"code":"AB","usageLimit":1}'
  ```
- **Expected Result**: HTTP 400. Body contains a Fastify validation error referencing the `code` field.
- [x] Pass <!-- 2026-06-14 -->

---

### UAT-API-011: Admin — create with `usageLimit` < 1 returns 400
- **Endpoint**: `POST /api/admin/invite-codes`
- **Auth-Required**: true
- **Auth-Role**: admin
- **Description**: Fastify JSON Schema rejects `usageLimit` of 0.
- **Steps**:
  1. Run the curl command below.
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8080/api/admin/invite-codes' -H 'Content-Type: application/json' -H "Cookie: $UAT_ADMIN_COOKIE" -d '{"code":"UAT-BADLIMIT","usageLimit":0}'
  ```
- **Expected Result**: HTTP 400. Body contains a Fastify validation error referencing the `usageLimit` field.
- [x] Pass <!-- 2026-06-14 -->

---

### UAT-API-012: Admin — delete (revoke) invite code
- **Endpoint**: `DELETE /api/admin/invite-codes/:id`
- **Auth-Required**: true
- **Auth-Role**: admin
- **Description**: Admin can revoke an invite code by its UUID `id`; returns `{deleted:true}` and the row is gone from the DB.
- **Steps**:
  1. Create a code to delete: run UAT-API-006 with `code = 'UAT-TO-DELETE-001'` and capture the `id` from the response.
  2. Export: `export UAT_CODE_ID="<id-from-step-1>"`
  3. Run the curl command below.
  4. Confirm the row is gone by re-running UAT-API-001 with code `'UAT-TO-DELETE-001'` — it should return `{valid:false,error:'invalid'}`.
- **Command**:
  ```bash
  curl -sS -X DELETE "http://localhost:8080/api/admin/invite-codes/$UAT_CODE_ID" -H "Cookie: $UAT_ADMIN_COOKIE"
  ```
- **Expected Result**: HTTP 200, body `{"deleted":true}`. Subsequent validate for that code returns `{"valid":false,"error":"invalid"}`.
- [x] Pass <!-- 2026-06-14 -->

---

### UAT-EDGE-001: Delete non-existent id returns 404
- **Scenario**: Admin requests deletion of an id that does not exist in `invite_codes`.
- **Auth-Required**: true
- **Auth-Role**: admin
- **Steps**:
  1. Use a UUID that is guaranteed not to exist.
  2. Run the curl command below.
- **Command**:
  ```bash
  curl -sS -X DELETE 'http://localhost:8080/api/admin/invite-codes/00000000-0000-0000-0000-000000000000' -H "Cookie: $UAT_ADMIN_COOKIE"
  ```
- **Expected Result**: HTTP 404, body `{"error":"not_found"}`
- [x] Pass <!-- 2026-06-14 -->

---

### UAT-EDGE-002: Admin route returns 401 with no session
- **Scenario**: All three admin routes return `401` when no session cookie is provided.
- **Steps**:
  1. Run each curl command below (no Cookie header).
- **Command**:
  ```bash
  curl -sS 'http://localhost:8080/api/admin/invite-codes'
  ```
- **Expected Result**: HTTP 401, body `{"error":"unauthorized"}`. Verify for GET, POST, and DELETE by substituting the corresponding method/path.
- [x] Pass <!-- 2026-06-14 -->

---

### UAT-EDGE-003: Admin route returns 403 for authenticated non-admin
- **Scenario**: A valid session whose `user.email` does not equal `BOOTSTRAP_ADMIN_EMAIL` receives a 403.
- **Auth-Required**: true
- **Auth-Role**: non-admin user
- **Steps**:
  1. Export non-admin session cookie: `export UAT_USER_COOKIE="<session-cookie-from-non-admin-login>"`
  2. Run the curl command below.
- **Command**:
  ```bash
  curl -sS 'http://localhost:8080/api/admin/invite-codes' -H "Cookie: $UAT_USER_COOKIE"
  ```
- **Expected Result**: HTTP 403, body `{"error":"forbidden"}`
- [x] Pass <!-- 2026-06-14 -->

---

### UAT-EDGE-004: Plugin registration — routes are reachable (not 404)
- **Scenario**: The `inviteCodesRoutes` plugin is registered in `app/api/index.ts`; validate and admin list endpoints return something other than 404.
- **Steps**:
  1. Run the validate curl (no auth needed).
  2. Run the admin list curl (with admin cookie).
- **Command**:
  ```bash
  curl -sS -o /dev/null -w '%{http_code}' -X POST 'http://localhost:8080/api/invite-codes/validate' -H 'Content-Type: application/json' -d '{"code":"probe"}'
  ```
- **Expected Result**: HTTP status is **not** 404. (Expect 200 since `probe` is not a known code, returning `{valid:false,error:'invalid'}`.)
- [x] Pass <!-- 2026-06-14 -->
