---
id: TASK-049
title: "Invite codes frontend — two-step signup page + admin list/create UI (react-router-dom)"
status: done
created: 2026-06-14
updated: 2026-06-14 <!-- Updated: 2026-06-14 -->
depends_on: [TASK-048]
blocks: []
parallel_safe_with: []
uat: "[[UAT-049]]"
tags: [portal, frontend, invite-codes, signup, react-router, roadmap-002]
---

# TASK-049 — Invite codes frontend — two-step signup page + admin list/create UI (react-router-dom)

## Objective

Build the `app/frontend` UI for the invite-codes port, adapting the jarvis TanStack Router pages to react-router-dom under the existing AuthGuard / NavBar shell. Add a public two-step **Signup** page (`/signup`): step 1 validates an invite code against `POST /api/invite-codes/validate`; step 2 collects name/email/password and creates the account via better-auth `signUp.email` carrying an `X-Invite-Code` header. Add **admin** invite-codes pages (`/admin/invite-codes` list + `/admin/invite-codes/new` create) guarded and shown only to the admin, plus a nav entry. For Google OAuth signup, stash the code in `sessionStorage['pendingInviteCode']` before redirect (so a Google sign-up still carries a code through the round-trip).

## Approach

**`src/lib/auth.ts`** — extend the existing helper (which calls `/api/auth/*` with `credentials: 'include'`) with a `signUp(...)` helper that posts to better-auth's email sign-up endpoint and sets the `X-Invite-Code` header. Add a small `validateInviteCode(code)` calling `POST /api/invite-codes/validate`. Keep the existing `getSession`/`signIn`/`signOut` intact.

**Signup page** (`src/pages/SignupPage.tsx`, route `/signup`, **unguarded**, sibling of `/login`):
- Step 1: invite-code text input → `validateInviteCode`. On `{valid:false}` show the mapped error (`invalid`/`expired`/`exhausted`); on `{valid:true}` advance to step 2 and retain the code in component state.
- Step 2: name / email / password → `signUp.email` with the `X-Invite-Code: <code>` header. On success, redirect into the authed shell (same post-login destination as LoginPage).
- Google OAuth (only if `socialProviders` Google is configured): before initiating the OAuth redirect, `sessionStorage.setItem('pendingInviteCode', code)`. (The server-side consumption of the stashed code on OAuth return is the redemption hook's concern from TASK-047; the frontend's job is to stash + forward it — note this boundary.)
- Add a "Sign up" link from LoginPage → `/signup` and back.

**Admin pages** (guarded, admin-only):
- `src/pages/admin/InviteCodesPage.tsx` (route `/admin/invite-codes`): `GET /api/admin/invite-codes` → table with columns code, usage_limit, used_count, expires_at, an **active** flag (derived: not expired and `used_count < usage_limit`), and a **Revoke** button calling `DELETE /api/admin/invite-codes/:id`.
- `src/pages/admin/CreateInviteCodePage.tsx` (route `/admin/invite-codes/new`): create form (code, usageLimit, optional expiresAt) → `POST /api/admin/invite-codes`; on success navigate back to the list. Surface the `409 duplicate_code` error inline.
- **Admin gating**: admin = current session `user.email === BOOTSTRAP_ADMIN_EMAIL`. Since the frontend can't read the server env directly, derive admin from the session (the API enforces the real guard, returning 403). Wrap the admin routes in `AuthGuard` and additionally hide/redirect for non-admins; add the nav link conditionally in `NavBar` only when the user is admin.

**Routing**: add `/signup`, `/admin/invite-codes`, `/admin/invite-codes/new` to `createBrowserRouter` in `src/App.tsx`, reusing the existing layout/guard wrappers.

## Steps

### 1. Confirm prerequisites  <!-- agent: general-purpose -->

- [x] Read `src/lib/auth.ts` to confirm the `getSession`/`signIn`/`signOut` shapes and the `credentials: 'include'` fetch pattern to mirror in `signUp` + `validateInviteCode`.
- [x] Read `src/App.tsx` to confirm the `createBrowserRouter` route table and the existing AuthGuard/layout wrappers; note how `/login` is wired (unguarded) to copy for `/signup`.
- [x] Read `src/contexts/AuthContext.tsx` and `src/components/AuthGuard.tsx` to confirm how the session/user is exposed (for the admin check) and how guarding redirects.
- [x] Read `src/components/NavBar.tsx` / `AuthBadge` to find where to add the conditional admin nav entry.
- [x] Read `src/pages/LoginPage.tsx` for the form/styling pattern to match in SignupPage and the post-auth redirect destination.

### 2. Extend `src/lib/auth.ts`  <!-- agent: general-purpose -->

- [x] Add `validateInviteCode(code)` → `POST /api/invite-codes/validate` returning `{valid, error?}`.
- [x] Add `signUp({ name, email, password, inviteCode })` posting to the better-auth email sign-up endpoint with `credentials:'include'` and an `X-Invite-Code` header.

### 3. Build the Signup page  <!-- agent: general-purpose -->

- [x] Create `src/pages/SignupPage.tsx` with the two-step flow (validate code → create account) matching LoginPage styling.
- [x] Wire Google OAuth (if configured) to `sessionStorage.setItem('pendingInviteCode', code)` before redirect.
- [x] Add a `/login` ↔ `/signup` cross-link.

### 4. Build the admin invite-codes pages  <!-- agent: general-purpose -->

- [x] Create `src/pages/admin/InviteCodesPage.tsx` (list table + Revoke).
- [x] Create `src/pages/admin/CreateInviteCodePage.tsx` (create form; inline duplicate/validation errors).
- [x] Add a conditional admin nav entry in `NavBar` shown only when the session user is the admin.

### 5. Wire routes  <!-- agent: general-purpose -->

- [x] Add `/signup` (unguarded) and `/admin/invite-codes` + `/admin/invite-codes/new` (guarded, admin-only) to `createBrowserRouter` in `src/App.tsx`.

### 6. Typecheck + build  <!-- agent: general-purpose -->

- [x] Run `npx tsc --noEmit` from `app/frontend/` — zero type errors.
- [x] Run `npm run build` in `app/frontend/` — succeeds.

### 7. Manual UI smoke (note)  <!-- agent: general-purpose -->

- [ ] With the API running, manually verify: an invalid code is rejected at step 1; a valid code lets you complete signup; the admin can mint/list/revoke codes; a non-admin cannot reach `/admin/invite-codes` (redirected / 403 from API). Capture any scratch under `./tmp/`. [DEFERRED-TO-UAT]

## Acceptance Criteria

- [ ] An unauthenticated user can sign up only after entering a valid invite code; signup posts `signUp.email` with the `X-Invite-Code` header.
- [ ] Google OAuth signup stashes the code in `sessionStorage['pendingInviteCode']` before redirect.
- [ ] An admin can mint, list, and revoke invite codes via `/admin/invite-codes` and `/admin/invite-codes/new`; the list shows code, usage_limit, used_count, expires_at, and an active flag.
- [ ] A non-admin cannot reach the admin UI (guarded route + hidden nav entry; API enforces 403).
- [ ] `/signup`, `/admin/invite-codes`, `/admin/invite-codes/new` are registered in `createBrowserRouter`.
- [ ] `npx tsc --noEmit` and `npm run build` both pass cleanly.

## Dependencies

- **DEPENDS ON [TASK-048](TASK-048-invite-codes-admin-validate-routes.md)** — the public validate endpoint and the admin CRUD API must exist for the signup flow and admin UI to call.

### Roadmap

Implements ROADMAP-002 Phase 2 "allowlist gating" item, re-scoped as the jarvis invite-codes port (this task delivers the signup + admin frontend) — `wiki/work/roadmaps/ROADMAP-002-hosted-portal-oauth-relay-installer.md`.
