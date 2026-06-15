---
id: UAT-049
title: "UAT: Invite codes frontend — two-step signup + admin list/create UI"
status: passed
task: TASK-049
created: 2026-06-14
updated: 2026-06-14
---

# UAT-049 — UAT: Invite codes frontend — two-step signup + admin list/create UI

implements::[[TASK-049]]

> **Source task**: [[TASK-049]]
> **Generated**: 2026-06-14

---

## Prerequisites

- [ ] `app/api` running on port **8080** (Postgres reachable via `DATABASE_URL`; `invite_codes` table migrated per TASK-047).
- [ ] `app/frontend` dev server running (default port **4321**) with `VITE_ADMIN_EMAIL` set to the bootstrap admin email.
- [ ] `BOOTSTRAP_ADMIN_EMAIL` in the API env matches `VITE_ADMIN_EMAIL` in the frontend env.
- [ ] An admin account exists whose email equals `BOOTSTRAP_ADMIN_EMAIL`, and a non-admin account exists for the negative tests.
- [ ] For UI tests: a browser; for API tests: `curl` and a valid admin session cookie exported as needed.
- [ ] `UAT_AUTH_TOKEN` / admin session cookie available for the admin API tests (see uat-auth).

> **Contract note (read before running API tests):** The invite-codes routes are served by **`app/api` on port 8080** (`app/api/routes/invite-codes.ts`). The Vite dev proxy in `app/frontend/vite.config.ts` forwards `/api/*` (other than `/api/auth`) to `BACKEND_PORT` (host-server, **8788**), which does **not** implement these routes. The direct-curl API tests below therefore hit **`http://localhost:8080`** directly. The browser/UI tests exercise the proxy path — see UAT-EDGE-006 which captures this routing gap explicitly.

---

## Test Cases

### UAT-API-001: Validate a usable invite code returns `{valid:true}`
- **Endpoint**: `POST /api/invite-codes/validate`
- **Description**: A code that exists, is not expired, and has remaining uses validates as usable. No mutation to `used_count`.
- **Steps**:
  1. Ensure a usable code exists (e.g. create one via UAT-API-004 first, or seed `code='UATGOOD'` with `usage_limit=5, used_count=0, expires_at=NULL`).
  2. Run the curl command below as-is.
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8080/api/invite-codes/validate' -H 'Content-Type: application/json' -d '{"code":"UATGOOD"}'
  ```
- **Expected Result**: HTTP 200, body `{"valid":true}`. `used_count` for the code is unchanged.
- [FAIL: auto-judge: seed code UATGOOD not present and not provisionable headlessly (admin token / DATABASE_URL unavailable); cannot produce runtime {valid:true} evidence] <!-- 2026-06-14 -->

### UAT-API-002: Validate an unknown code returns `{valid:false,error:"invalid"}`
- **Endpoint**: `POST /api/invite-codes/validate`
- **Description**: A code with no matching row returns the `invalid` verdict.
- **Steps**:
  1. Use a code string guaranteed not to exist.
  2. Run the curl command.
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8080/api/invite-codes/validate' -H 'Content-Type: application/json' -d '{"code":"NOPE-DOES-NOT-EXIST"}'
  ```
- **Expected Result**: HTTP 200, body `{"valid":false,"error":"invalid"}`.
- [x] Pass <!-- 2026-06-14 -->

### UAT-API-003: Validate an exhausted code returns `{valid:false,error:"exhausted"}`
- **Endpoint**: `POST /api/invite-codes/validate`
- **Description**: A code whose `used_count >= usage_limit` returns the `exhausted` verdict.
- **Steps**:
  1. Seed/ensure a code `code='UATEXHAUSTED'` with `usage_limit=1, used_count=1, expires_at=NULL`.
  2. Run the curl command.
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8080/api/invite-codes/validate' -H 'Content-Type: application/json' -d '{"code":"UATEXHAUSTED"}'
  ```
- **Expected Result**: HTTP 200, body `{"valid":false,"error":"exhausted"}`.
- [FAIL: auto-judge: seed code UATEXHAUSTED not present and not provisionable headlessly (admin token / DATABASE_URL unavailable); cannot produce runtime exhausted evidence] <!-- 2026-06-14 -->

### UAT-API-004: Validate an expired code returns `{valid:false,error:"expired"}`
- **Endpoint**: `POST /api/invite-codes/validate`
- **Description**: A code with a non-null `expires_at` in the past returns the `expired` verdict.
- **Steps**:
  1. Seed/ensure a code `code='UATEXPIRED'` with `expires_at` set to a past timestamp and `used_count < usage_limit`.
  2. Run the curl command.
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8080/api/invite-codes/validate' -H 'Content-Type: application/json' -d '{"code":"UATEXPIRED"}'
  ```
- **Expected Result**: HTTP 200, body `{"valid":false,"error":"expired"}`.
- [FAIL: auto-judge: seed code UATEXPIRED not present and not provisionable headlessly (admin token / DATABASE_URL unavailable); cannot produce runtime expired evidence] <!-- 2026-06-14 -->

### UAT-API-005: Admin create invite code returns 201 with generated id
- **Endpoint**: `POST /api/admin/invite-codes`
- **Description**: An admin session can mint a code; the response carries a generated `id`, `created_by`, and `used_count=0`.
- **Auth-Required**: true
- **Auth-Role**: admin
- **Steps**:
  1. Authenticate as the admin (email = `BOOTSTRAP_ADMIN_EMAIL`); obtain the session cookie/token.
  2. Run the curl command (replace `$UAT_AUTH_TOKEN` with the admin session bearer/cookie as your harness requires).
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8080/api/admin/invite-codes' -H 'Content-Type: application/json' -H "Authorization: Bearer $UAT_AUTH_TOKEN" -d '{"code":"UATMINT01","usageLimit":3}'
  ```
- **Expected Result**: HTTP 201, body is the created row with a UUID `id`, `code:"UATMINT01"`, `usage_limit:3`, `used_count:0`, `expires_at:null`, non-null `created_by` and `created_at`.
- [FAIL: auto-judge: auth token missing ($UAT_AUTH_TOKEN unset; admin session unavailable headlessly)] <!-- 2026-06-14 -->

### UAT-API-006: Admin list invite codes returns array ordered by created_at DESC
- **Endpoint**: `GET /api/admin/invite-codes`
- **Description**: An admin session can list all codes, newest first.
- **Auth-Required**: true
- **Auth-Role**: admin
- **Steps**:
  1. Authenticate as the admin.
  2. Run the curl command.
- **Command**:
  ```bash
  curl -sS 'http://localhost:8080/api/admin/invite-codes' -H "Authorization: Bearer $UAT_AUTH_TOKEN" | jq '.[0]'
  ```
- **Expected Result**: HTTP 200, a JSON array; each row has `id, code, usage_limit, used_count, expires_at, created_by, created_at`. The just-created `UATMINT01` appears first (most recent).
- [FAIL: auto-judge: auth token missing ($UAT_AUTH_TOKEN unset; admin session unavailable headlessly)] <!-- 2026-06-14 -->

### UAT-API-007: Admin create duplicate code returns 409 duplicate_code
- **Endpoint**: `POST /api/admin/invite-codes`
- **Description**: Re-creating a code with an existing `code` value maps the pg UNIQUE violation (23505) to a 409.
- **Auth-Required**: true
- **Auth-Role**: admin
- **Steps**:
  1. Ensure `UATMINT01` already exists (from UAT-API-005).
  2. Run the curl command with the same `code`.
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8080/api/admin/invite-codes' -H 'Content-Type: application/json' -H "Authorization: Bearer $UAT_AUTH_TOKEN" -d '{"code":"UATMINT01","usageLimit":1}'
  ```
- **Expected Result**: HTTP 409, body `{"error":"duplicate_code"}`.
- [FAIL: auto-judge: auth token missing ($UAT_AUTH_TOKEN unset; admin session unavailable headlessly)] <!-- 2026-06-14 -->

### UAT-API-008: Admin create with too-short code is rejected by schema
- **Endpoint**: `POST /api/admin/invite-codes`
- **Description**: `code` shorter than 4 chars fails the Fastify JSON-schema validation (minLength 4).
- **Auth-Required**: true
- **Auth-Role**: admin
- **Steps**:
  1. Authenticate as the admin.
  2. Run the curl command with a 2-char code.
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8080/api/admin/invite-codes' -H 'Content-Type: application/json' -H "Authorization: Bearer $UAT_AUTH_TOKEN" -d '{"code":"ab","usageLimit":1}'
  ```
- **Expected Result**: HTTP 400 (schema validation error; body references `code`/`minLength`). No row created.
- [FAIL: auto-judge: auth token missing ($UAT_AUTH_TOKEN unset; admin guard runs before schema, so 401 returns without a session)] <!-- 2026-06-14 -->

### UAT-API-009: Admin revoke invite code returns 200 and removes it
- **Endpoint**: `DELETE /api/admin/invite-codes/:id`
- **Description**: An admin can revoke (delete) a code by id.
- **Auth-Required**: true
- **Auth-Role**: admin
- **Steps**:
  1. From UAT-API-006, capture the `id` of `UATMINT01`.
  2. Run the curl command, substituting that id for `<ID>`.
- **Command**:
  ```bash
  curl -sS -X DELETE 'http://localhost:8080/api/admin/invite-codes/<ID>' -H "Authorization: Bearer $UAT_AUTH_TOKEN"
  ```
- **Expected Result**: HTTP 200, body `{"deleted":true}`. The code no longer appears in the list.
- [FAIL: auto-judge: auth token missing ($UAT_AUTH_TOKEN unset; admin session unavailable headlessly)] <!-- 2026-06-14 -->

### UAT-API-010: Admin revoke a non-existent id returns 404
- **Endpoint**: `DELETE /api/admin/invite-codes/:id`
- **Description**: Deleting an id with no matching row returns 404.
- **Auth-Required**: true
- **Auth-Role**: admin
- **Steps**:
  1. Authenticate as the admin.
  2. Run the curl command with a random UUID that does not exist.
- **Command**:
  ```bash
  curl -sS -X DELETE 'http://localhost:8080/api/admin/invite-codes/00000000-0000-0000-0000-000000000000' -H "Authorization: Bearer $UAT_AUTH_TOKEN"
  ```
- **Expected Result**: HTTP 404, body `{"error":"not_found"}`.
- [FAIL: auto-judge: auth token missing ($UAT_AUTH_TOKEN unset; admin guard returns 401 before reaching the delete handler)] <!-- 2026-06-14 -->

### UAT-API-011: Admin route with no session returns 401
- **Endpoint**: `GET /api/admin/invite-codes`
- **Description**: With no session cookie/token, the admin guard returns 401.
- **Steps**:
  1. Run the curl command with no auth header/cookie.
- **Command**:
  ```bash
  curl -sS 'http://localhost:8080/api/admin/invite-codes'
  ```
- **Expected Result**: HTTP 401, body `{"error":"unauthorized"}`.
- [x] Pass <!-- 2026-06-14 -->

### UAT-API-012: Admin route with a non-admin session returns 403
- **Endpoint**: `GET /api/admin/invite-codes`
- **Description**: A valid session whose `user.email !== BOOTSTRAP_ADMIN_EMAIL` is forbidden.
- **Auth-Required**: true
- **Auth-Role**: user
- **Steps**:
  1. Authenticate as a NON-admin user; obtain that session.
  2. Run the curl command with the non-admin session bearer/cookie.
- **Command**:
  ```bash
  curl -sS 'http://localhost:8080/api/admin/invite-codes' -H "Authorization: Bearer $UAT_AUTH_TOKEN"
  ```
- **Expected Result**: HTTP 403, body `{"error":"forbidden"}`.
- [FAIL: auto-judge: auth token missing (no non-admin $UAT_AUTH_TOKEN; cannot present a valid non-admin session headlessly)] <!-- 2026-06-14 -->

### UAT-UI-001: Signup step 1 rejects an invalid invite code
- **Page**: `/signup`
- **Component**: `app/frontend/src/pages/SignupPage.tsx`
- **Description**: On step 1, an invalid code shows the mapped error and does not advance to step 2.
- **Steps**:
  1. While logged out, navigate to `/signup`. The card header reads "Enter invite code".
  2. Type an invalid code (e.g. `NOPE-DOES-NOT-EXIST`) into the "Invite code" input.
  3. Click "Continue".
- **Expected Result**: The button shows "Checking…" then returns; an error message "This invite code is invalid." appears. The form stays on step 1 (header still "Enter invite code"; no Name/Email/Password fields).
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-14 -->

### UAT-UI-002: Signup step 1 accepts a valid code and advances to step 2
- **Page**: `/signup`
- **Component**: `app/frontend/src/pages/SignupPage.tsx`
- **Description**: A valid code advances to the "Create account" step with Name/Email/Password fields, retaining the code in component state.
- **Steps**:
  1. While logged out, navigate to `/signup`.
  2. Enter a known-usable code (e.g. `UATGOOD`) and click "Continue".
- **Expected Result**: The card header changes to "Create account"; Name, Email, and Password inputs and a "Create account" button are shown.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-14 -->

### UAT-UI-003: Signup step 2 creates an account and lands in the authed shell
- **Page**: `/signup`
- **Component**: `app/frontend/src/pages/SignupPage.tsx`
- **Description**: Submitting step 2 calls `signUp.email` with the `X-Invite-Code` header and, on success, redirects to `/`.
- **Steps**:
  1. Complete step 1 with a usable code (UAT-UI-002).
  2. Fill Name, a fresh unique Email, and a Password; click "Create account".
  3. (Optional) In DevTools Network, inspect the `POST /api/auth/sign-up/email` request headers.
- **Expected Result**: Account is created; the app navigates to `/` (Agents page in the authed shell). The sign-up request carries an `X-Invite-Code` header equal to the code entered in step 1.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-14 -->

### UAT-UI-004: Login ↔ Signup cross-links work
- **Page**: `/login` and `/signup`
- **Components**: `app/frontend/src/pages/LoginPage.tsx`, `SignupPage.tsx`
- **Description**: The login page links to signup and the signup page links back to login.
- **Steps**:
  1. While logged out, go to `/login`; click the "Sign up →" link.
  2. On `/signup`, click the "Sign in →" link.
- **Expected Result**: Step 1 lands on `/signup` (header "Enter invite code"); step 2 returns to `/login` (header "Sign in").
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-14 -->

### UAT-UI-005: Admin sees the Invite Codes nav entry and list page
- **Page**: `/admin/invite-codes`
- **Components**: `app/frontend/src/components/NavBar.tsx`, `app/frontend/src/pages/admin/InviteCodesPage.tsx`
- **Description**: Logged in as the admin, the "Invite Codes" nav link is visible and the list page renders the table with the required columns.
- **Steps**:
  1. Log in as the admin (email = `VITE_ADMIN_EMAIL`).
  2. Confirm an "Invite Codes" link appears in the top nav; click it.
- **Expected Result**: Navigates to `/admin/invite-codes`. A table renders with columns Code, Limit, Used, Expires, Active, and a Revoke action column. An "active" indicator (green dot) shows for usable codes; a muted dot for expired/exhausted ones.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-14 -->

### UAT-UI-006: Admin creates a code via the New form and returns to the list
- **Page**: `/admin/invite-codes/new`
- **Component**: `app/frontend/src/pages/admin/CreateInviteCodePage.tsx`
- **Description**: The create form posts `{code, usageLimit, expiresAt?}` and navigates back to the list on success.
- **Steps**:
  1. As admin, on `/admin/invite-codes` click "New invite code".
  2. Enter a unique Code, a Usage limit (e.g. 5), optionally an Expires-at date; click "Create invite code".
- **Expected Result**: Navigates back to `/admin/invite-codes`; the new code appears in the list (newest first) with Used = 0 and an Active indicator.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-14 -->

### UAT-UI-007: Admin create surfaces duplicate-code error inline
- **Page**: `/admin/invite-codes/new`
- **Component**: `app/frontend/src/pages/admin/CreateInviteCodePage.tsx`
- **Description**: Creating a code whose value already exists shows the inline 409 message and stays on the form.
- **Steps**:
  1. As admin, create a code (UAT-UI-006), then open "New invite code" again.
  2. Enter the SAME code value and submit.
- **Expected Result**: An inline error "A code with that name already exists." appears; no navigation occurs.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-14 -->

### UAT-UI-008: Admin revokes a code from the list
- **Page**: `/admin/invite-codes`
- **Component**: `app/frontend/src/pages/admin/InviteCodesPage.tsx`
- **Description**: Clicking Revoke deletes the code and refreshes the list.
- **Steps**:
  1. As admin on `/admin/invite-codes`, click "Revoke" on a code row.
- **Expected Result**: The row disappears after the list re-fetches; if it was the last row, "No invite codes yet." is shown.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-14 -->

### UAT-UI-009: Non-admin cannot reach the admin UI (redirect + hidden nav)
- **Page**: `/admin/invite-codes`
- **Components**: `app/frontend/src/App.tsx` (`AdminGuard`), `NavBar.tsx`
- **Description**: A logged-in non-admin has no "Invite Codes" nav entry and is redirected away from the admin route.
- **Steps**:
  1. Log in as a NON-admin user (email ≠ `VITE_ADMIN_EMAIL`).
  2. Confirm there is no "Invite Codes" link in the nav.
  3. Manually navigate to `/admin/invite-codes`.
- **Expected Result**: No "Invite Codes" nav link is shown; navigating to `/admin/invite-codes` redirects to `/` (AdminGuard replace-redirect) and the admin page content never renders.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-06-14 -->

### UAT-EDGE-001: Unauthenticated visit to /admin/invite-codes redirects to /login
- **Scenario**: A logged-out user hits the admin route directly.
- **Components**: `App.tsx` `AuthGuard` wrapping the `/*` Dashboard route; `AdminGuard`.
- **Steps**:
  1. While logged out, navigate directly to `/admin/invite-codes`.
- **Expected Result**: AuthGuard redirects to `/login` (no admin content, no flash of the table).
- [FAIL: auto-judge: manual test requires human verification] <!-- 2026-06-14 -->

### UAT-EDGE-002: Logged-in user visiting /signup is bounced to /
- **Scenario**: An already-authenticated user opens `/signup`.
- **Component**: `SignupPage.tsx` (effect: `if (!isLoading && user) navigate('/', {replace:true})`).
- **Steps**:
  1. Log in.
  2. Navigate to `/signup`.
- **Expected Result**: Immediately redirected to `/` (Agents page); the signup form does not stay rendered.
- [FAIL: auto-judge: manual test requires human verification] <!-- 2026-06-14 -->

### UAT-EDGE-003: Signup step 2 surfaces a server sign-up error
- **Scenario**: Step 2 submission fails server-side (e.g. duplicate email / weak password rejected by better-auth).
- **Component**: `SignupPage.tsx` `handleSignup` catch → `signupError`.
- **Steps**:
  1. Complete step 1 with a usable code.
  2. In step 2, enter an email that already has an account (or a password the server rejects) and submit.
- **Expected Result**: An inline red error message (the server message or "Sign up failed") appears; the user stays on step 2 and is not navigated away.
- [FAIL: auto-judge: manual test requires human verification] <!-- 2026-06-14 -->

### UAT-EDGE-004: Expired/exhausted code shows the correct mapped message at step 1
- **Scenario**: Step 1 maps each verdict to its specific copy.
- **Component**: `SignupPage.tsx` `INVITE_ERROR_MAP`.
- **Steps**:
  1. On `/signup`, enter an expired code (e.g. `UATEXPIRED`) → Continue.
  2. Then enter an exhausted code (e.g. `UATEXHAUSTED`) → Continue.
- **Expected Result**: Expired shows "This invite code has expired."; exhausted shows "This invite code has been fully used." Neither advances to step 2.
- [FAIL: auto-judge: manual test requires human verification] <!-- 2026-06-14 -->

### UAT-EDGE-005: validate route ignores unknown body fields / requires `code`
- **Scenario**: The validate endpoint requires `code` per its JSON schema.
- **Endpoint**: `POST /api/invite-codes/validate`
- **Steps**:
  1. Run the curl command with a body missing `code`.
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8080/api/invite-codes/validate' -H 'Content-Type: application/json' -d '{"notcode":"x"}'
  ```
- **Expected Result**: HTTP 400 schema validation error (required property `code` missing).
- [x] Pass <!-- 2026-06-14 -->

### UAT-EDGE-006: Dev-proxy routing for invite-codes (known gap check)
- **Scenario**: Verify whether browser calls to `/api/invite-codes/*` and `/api/admin/invite-codes` actually reach `app/api` (8080) through the Vite dev proxy.
- **Components**: `app/frontend/vite.config.ts`, `app/api/routes/invite-codes.ts`.
- **Steps**:
  1. With both the frontend dev server and `app/api` running, perform UAT-UI-002 (valid code at step 1).
  2. In DevTools Network, inspect the `POST /api/invite-codes/validate` request: note which upstream served it (200 from app/api vs 404 from host-server on 8788).
- **Expected Result**: The validate (and admin) calls succeed (served by `app/api` on 8080). If they 404, the Vite proxy is routing `/api` to the host-server (8788) which lacks these routes — record as a FAIL and see the gap note below.
- [FAIL: auto-judge: manual test requires human verification (browser DevTools network inspection)] <!-- 2026-06-14 -->

---

## Gaps / Notes (not covered by tests)

- **Google OAuth invite-code stash NOT implemented.** TASK-049's approach calls for `sessionStorage.setItem('pendingInviteCode', code)` before a Google OAuth redirect (and a "Sign up with Google" affordance). `SignupPage.tsx` contains no Google button and no `sessionStorage` write. No UI test asserts this because the code path does not exist. **This is a gap against the task's stated approach** (the approach scoped it as "only if Google `socialProviders` is configured"). Acceptance criterion "Google OAuth signup stashes the code in `sessionStorage['pendingInviteCode']`" is therefore unverifiable in the current build — flag for the implementer.
- **Admin gating is env-derived, not session-derived.** The task approach said "admin = current session `user.email === BOOTSTRAP_ADMIN_EMAIL`" derived from the session. The implementation instead reads a build-time `VITE_ADMIN_EMAIL` env var (`App.tsx` `AdminGuard`, `NavBar.tsx`). Functionally equivalent for gating, but it requires `VITE_ADMIN_EMAIL` to be set and to match `BOOTSTRAP_ADMIN_EMAIL`; tests above assume this is configured (see Prerequisites).
- **Dev-proxy mismatch (see UAT-EDGE-006).** `vite.config.ts` proxies `/api` (non-auth) to `BACKEND_PORT` (host-server 8788), but the invite-codes routes live on `app/api` (8080, `API_PORT`). In local Vite dev the browser invite-codes calls may not reach the implementing server. The direct-curl API tests bypass this by targeting 8080 explicitly.
