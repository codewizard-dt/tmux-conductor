---
id: TASK-030
title: "Portal Google OIDC sign-in, JWT session cookie, email allowlist, /api/me"
status: superseded
created: 2026-06-12
updated: 2026-06-13
depends_on: [TASK-027, TASK-029]
blocks: []
parallel_safe_with: []
uat: ""
tags: [portal, auth, oidc, google, session, jwt, allowlist, security]
---

<!-- SUPERSEDED (2026-06-13): The `simplify-architecture` branch replaced the hand-rolled `openid-client`
+ `jose` OIDC implementation with `better-auth` (v1.6.16). better-auth provides email/password auth out
of the box and optional Google OAuth via its `socialProviders.google` config. The old planned artifacts
(`portal/auth/allowlist.ts`, `session.ts`, `oidc.ts`, `guards.ts`) were not built; better-auth manages
sessions via its own `session` and `account` tables in Postgres. See `app/api/auth.ts`. -->

# TASK-030 — Portal Google OIDC sign-in, JWT session cookie, email allowlist, /api/me

## Objective

Add first-party Google OpenID Connect sign-in to the hosted `portal/` app (ROADMAP-002 Phase 2). After this task an allowlisted Google user can complete an OIDC authorization-code flow against Google, land back on the portal with a stateless HS256 JWT session cookie (`tc_session`), and have their identity upserted into the Postgres `users` table with an allowlist decision snapshotted into `users.is_allowed`. A signed-in user (allowlisted or not) can read their own identity from `GET /api/me`, which drives both the authenticated dashboard and the "request access" UI for non-allowlisted users. The session is fully stateless — Postgres holds identity only, never sessions. This is the auth gate that the entire portal (and later the relay) sits behind.

## Approach

**Library choice — `openid-client` v6, NOT `@fastify/oauth2`.** `openid-client` (the panva library) performs OIDC **discovery** against Google's well-known document, generates and verifies **PKCE** code verifier/challenge, manages **state** and **nonce**, and validates the returned **ID token** (signature against Google's JWKS, `iss`/`aud`/`exp`/`nonce` claims) — all built in. `@fastify/oauth2` is a bare OAuth2 helper that would leave us hand-rolling ID-token validation, so it is explicitly rejected here. Add `openid-client` (OIDC client + token validation) and `jose` (HS256 sign/verify for our own session JWT) to `portal/package.json`, plus `@fastify/cookie` for reading/writing the `tc_session` and the short-lived flow cookie.

**Stateless sessions.** The session is a self-contained HS256 JWT signed with `env.SESSION_SECRET` (32+ bytes), carried in a `tc_session` cookie with attributes `HttpOnly; Secure; SameSite=Lax; Path=/` and a 7-day expiry (`exp` claim AND cookie `Max-Age` aligned). There is **no** server-side session table — keeping the DB identity-only is a hard design constraint from the roadmap. On every protected request we verify the JWT and read the user id/email from its claims; the per-request allowlist gate re-reads `users.is_allowed` (or the env allowlist) so revoking access does not require waiting out the 7-day token.

**OIDC flow shape.** `GET /auth/google` runs discovery (cached for the process), generates PKCE + state + nonce, stores `{state, nonce, code_verifier}` in a **short-lived, signed, HttpOnly** flow cookie (e.g. `tc_oidc`, ~10-min Max-Age, `SameSite=Lax`), and 302-redirects to Google's authorization endpoint. `GET /auth/google/callback` reads the flow cookie, exchanges the code (validating `state`), validates the ID token (validating `nonce`), **requires `email_verified === true`** (reject otherwise), upserts the user keyed on `google_sub`, snapshots the allowlist decision into `users.is_allowed`, sets the `tc_session` cookie, clears the flow cookie, and 302-redirects to `/`.

**Allowlist.** `ALLOWLIST_EMAILS` is a comma-separated env list. `allowlist.ts` parses it once into a lowercased `Set<string>` and exposes `isAllowed(email)` doing a **case-insensitive** compare (lowercase + trim both sides). An empty/unset allowlist means **nobody is allowed** (fail-closed) — note this assumption in the code comment so deploy-time misconfig is loud, not silently open.

**CSRF / guards.** `guards.ts` exports (1) an `originGuard` preHandler applied to **all non-GET routes** that rejects when `Sec-Fetch-Site` is `cross-site`/`none` OR the `Origin` header is present and does not match the configured app origin (defense-in-depth alongside `SameSite=Lax`); (2) `requireSession` — verifies `tc_session`, attaches `req.user`, else 401 (for `/api/*`) ; (3) `requireAllowed` — runs after `requireSession` and 403s (or redirects to a request-access page for browser navigations) when the user is not allowlisted. `/api/me` uses `requireSession` only (NOT `requireAllowed`) so a non-allowlisted signed-in user still gets `{isAllowed:false}`.

**Manual deploy-time step (NOTE — do NOT block on this).** A Google Cloud Console OAuth 2.0 client (Web application) with an authorized redirect URI of `https://<app>/auth/google/callback` must be created **by the human**; the client id/secret are supplied via env (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`). The CODE in this task is fully implementable and testable without that console step — discovery, PKCE, state/nonce, JWT session, allowlist, guards, and `/api/me` are all unit-/integration-testable with a mocked or env-quiet OIDC path. Only the live end-to-end Google round-trip is human-verified at deploy time.

> **TASK-027 / TASK-029 dependency:** This task assumes the Fastify app bootstrap, env validation (`portal/env.ts` or equivalent), and pg `Pool` from **TASK-027** (the ROADMAP-002 Phase 2 portal scaffold — originally planned as "TASK-023" but renumbered to 027 because 023–026 were taken by the ROADMAP-001 Phase 5 cutover series) already exist, and that the `users` table (with `google_sub`, `email`, `name`, `picture`, `is_allowed`, `last_login_at`) from TASK-029's migration 001 already exists. If the env validator has no slots for `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`SESSION_SECRET`/`ALLOWLIST_EMAILS`/`APP_ORIGIN`, add them as part of this task. If the `users` table is absent, stop and surface that TASK-029 must complete first — do not author the migration here.

## Steps

### 1. Confirm prerequisites from TASK-027 (scaffold) / TASK-029 (migration)  <!-- agent: general-purpose -->

- [ ] Use Serena `list_dir` on `portal/` to confirm the Fastify app bootstrap from TASK-027 exists (e.g. `portal/server.ts` / `portal/app.ts` / `portal/index.ts`); note the exact entry filename and how plugins/routes are registered
- [ ] Use Serena `get_symbols_overview` / `find_symbol` on the portal env module to confirm the env-validation shape (zod/manual) and where the pg `Pool` is constructed and exported
- [ ] Use Serena `search_for_pattern` for `google_sub` and `is_allowed` across `portal/` (migrations + any db helpers) to confirm TASK-029's `users` table exists with the expected columns; if absent, STOP and report that TASK-029 must complete first (do not author the migration here)
- [ ] Confirm whether `@fastify/cookie` is already registered; if not, it will be added in step 3

### 2. Add dependencies and env slots  <!-- agent: general-purpose -->

- [ ] Edit `portal/package.json` to add runtime deps: `openid-client` (v6), `jose`, and `@fastify/cookie` (use current major versions); keep alphabetical/grouping consistent with the existing file
- [ ] Run the portal's package manager install (npm/pnpm per the lockfile already in `portal/`) so the lockfile updates; confirm `node_modules` resolves `openid-client` and `jose`
- [ ] Extend the portal env validator (the module found in step 1) with required string vars: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET` (min length 32), `APP_ORIGIN` (e.g. `https://app.example.com`, used for the callback redirect URI and Origin checks), and `ALLOWLIST_EMAILS` (allow empty string → fail-closed)
- [ ] Add the same five vars to the portal `.env.example` (or equivalent sample/env doc) with placeholder values and a one-line comment each; note the Google Cloud Console redirect URI = `${APP_ORIGIN}/auth/google/callback`

### 3. Implement `portal/auth/allowlist.ts`  <!-- agent: general-purpose -->

- [ ] Create `portal/auth/allowlist.ts` exporting `parseAllowlist(raw: string): Set<string>` (split on comma, trim, lowercase, drop empties) and `isAllowed(email: string, set: Set<string>): boolean` (lowercase+trim the email before `set.has`)
- [ ] Build the `Set` once from `env.ALLOWLIST_EMAILS` at module init (or export a factory the app wires with env); add a comment that an empty set means nobody is allowed (fail-closed by design)

### 4. Implement `portal/auth/session.ts`  <!-- agent: general-purpose -->

- [ ] Create `portal/auth/session.ts` using `jose`'s `SignJWT` / `jwtVerify` with HS256 and a key derived from `env.SESSION_SECRET` (`new TextEncoder().encode(secret)`)
- [ ] Export `signSession(claims: {sub, email, name?, picture?}): Promise<string>` — set `exp` to 7 days, plus `iat`; export `verifySession(token: string): Promise<SessionClaims | null>` returning null on any verify failure (expired/tampered)
- [ ] Export cookie helpers: the cookie name constant `tc_session`, a `setSessionCookie(reply, token)` that writes `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800`, and `clearSessionCookie(reply)` that expires it (Max-Age=0, same Path)

### 5. Implement `portal/auth/oidc.ts`  <!-- agent: general-purpose -->

- [ ] Create `portal/auth/oidc.ts` that performs `openid-client` v6 discovery against Google's issuer (`https://accounts.google.com`) and caches the resulting config/client for the process (lazy, memoized)
- [ ] Export `buildAuthRedirect(): { url, state, nonce, codeVerifier }` — generate PKCE (`codeVerifier` + S256 `codeChallenge`), random `state` and `nonce`, build the authorization URL with `scope=openid email profile`, `redirect_uri = ${env.APP_ORIGIN}/auth/google/callback`, `access_type` as appropriate, and `prompt` left default
- [ ] Export `handleCallback({ currentUrl, state, nonce, codeVerifier }): Promise<{ sub, email, emailVerified, name?, picture? }>` — exchange the code with state validation, validate the ID token (signature/iss/aud/exp + nonce), and pull `sub`, `email`, `email_verified`, `name`, `picture` claims out
- [ ] Add a short-lived flow-cookie helper (name `tc_oidc`) that signs `{state, nonce, codeVerifier}` (reuse `jose` HS256 with `SESSION_SECRET`) into an `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600` cookie, plus a reader that verifies+parses it and a clearer

### 6. Implement `portal/auth/guards.ts`  <!-- agent: general-purpose -->

- [ ] Create `portal/auth/guards.ts` exporting `originGuard` — a Fastify preHandler that, for non-GET requests, rejects (403) when `sec-fetch-site` is `cross-site` or `none`, OR when an `origin` header is present and !== `env.APP_ORIGIN`
- [ ] Export `requireSession` preHandler — read `tc_session`, `verifySession`; on success attach `req.user = claims`; on failure reply 401 (JSON `{error:'unauthorized'}` for `/api/*`)
- [ ] Export `requireAllowed` preHandler — assumes `requireSession` ran; re-check allowlist (prefer `users.is_allowed` via a small db read keyed on `req.user.sub`, falling back to `isAllowed(email, set)`); on fail reply 403 (JSON for `/api/*`, or 302 to a request-access path for browser navigations)
- [ ] Register `originGuard` globally so it applies to ALL non-GET routes (e.g. an `onRequest`/`preHandler` app-level hook that early-returns for GET/HEAD), per the CSRF-defense requirement

### 7. Wire the auth routes  <!-- agent: general-purpose -->

- [ ] Create a routes module (e.g. `portal/routes/auth.ts`) registered by the app entry from step 1
- [ ] `GET /auth/google` — call `buildAuthRedirect()`, set the `tc_oidc` flow cookie, 302 to the authorization URL
- [ ] `GET /auth/google/callback` — read+verify the `tc_oidc` cookie; call `handleCallback`; **reject with an error page/redirect if `emailVerified !== true`**; upsert the user keyed on `google_sub` (insert, or update `email`/`name`/`picture`/`last_login_at`); compute `isAllowed(email)` and write it to `users.is_allowed`; `signSession` + `setSessionCookie`; clear `tc_oidc`; 302 to `/`
- [ ] `POST /auth/logout` — `clearSessionCookie`, 204 (this is non-GET so `originGuard` applies — verify it does)

### 8. Implement `GET /api/me`  <!-- agent: general-purpose -->

- [ ] Add `GET /api/me` (in `portal/routes/auth.ts` or a `portal/routes/me.ts`) guarded by `requireSession` ONLY (NOT `requireAllowed`)
- [ ] Respond `{ user: { id, email, name, picture }, isAllowed }` where `isAllowed` reflects the current allowlist decision (`users.is_allowed` for this user); a signed-in non-allowlisted user therefore gets `isAllowed:false` to drive the request-access UI

### 9. Implement the SQL upsert  <!-- agent: general-purpose -->

- [ ] Add an upsert query (in a `portal/db/*` helper or inline in the callback) keyed on `google_sub`: `INSERT ... ON CONFLICT (google_sub) DO UPDATE SET email, name, picture, last_login_at = now(), is_allowed = EXCLUDED.is_allowed` returning the user row (`id, email, name, picture, is_allowed`)
- [ ] Ensure `is_allowed` is set from the freshly-computed allowlist decision on BOTH insert and update paths (so removing someone from `ALLOWLIST_EMAILS` flips them to false on their next sign-in)

### 10. Verification  <!-- agent: general-purpose -->

- [ ] Typecheck the portal (`tsc --noEmit` or the portal's typecheck script) — zero errors
- [ ] Add/run a focused test (or a quiet mock path) covering: `parseAllowlist`/`isAllowed` case-insensitivity; `signSession`→`verifySession` round-trip + expired/tampered → null; `originGuard` rejects a cross-site non-GET and passes a same-origin one; `/api/me` returns `isAllowed:false` for a signed-in non-allowlisted user and `true` for an allowlisted one
- [ ] Confirm the `email_verified !== true` branch in the callback rejects (unit test against a mocked claims object)
- [ ] Confirm the app boots with the new env vars present and fails validation loudly when `SESSION_SECRET` is too short or `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are missing

## Acceptance Criteria

- [ ] `openid-client` (v6), `jose`, and `@fastify/cookie` are in `portal/package.json` and installed; `@fastify/oauth2` is NOT used
- [ ] `GET /auth/google` runs Google OIDC discovery, generates PKCE + state + nonce, stores them in a short-lived signed HttpOnly cookie, and 302s to Google's authorization endpoint
- [ ] `GET /auth/google/callback` validates state + nonce + ID token, **requires `email_verified === true`**, upserts on `google_sub` (insert or update email/name/picture/last_login_at), snapshots the allowlist decision into `users.is_allowed`, sets the `tc_session` cookie, and 302s to `/`
- [ ] The session is a stateless HS256 JWT signed with `SESSION_SECRET`, in a `tc_session` cookie with `HttpOnly; Secure; SameSite=Lax; Path=/` and a 7-day expiry; there is NO server-side session table
- [ ] `POST /auth/logout` clears the session cookie
- [ ] `allowlist.ts` parses `ALLOWLIST_EMAILS` (comma-separated) and compares case-insensitively; empty allowlist fails closed
- [ ] `guards.ts` provides an Origin / `Sec-Fetch-Site` check on ALL non-GET routes, plus `requireSession` and `requireAllowed` preHandlers; `requireAllowed` returns 403 (or redirect) for non-allowlisted users
- [ ] `GET /api/me` requires a session but NOT the allowlist, returning `{ user: {id,email,name,picture}, isAllowed }` with `isAllowed:false` for signed-in non-allowlisted users
- [ ] Portal typechecks clean; the auth unit/mock tests in step 10 pass; the live Google round-trip is documented as a human-verified deploy-time step (Google Cloud Console OAuth client + redirect URI), not a blocker for this task

## Dependencies

- **DEPENDS ON [TASK-027](TASK-027-scaffold-portal-foundation.md)** — the ROADMAP-002 Phase 2 portal scaffold ("Scaffold portal/ — Fastify, env validation, pg Pool, boot-time migrations, /healthz"). Provides the portal Fastify app bootstrap, env validation, pg `Pool`, and `/healthz`. This task registers its plugins, routes, and env slots into that app; it cannot run before the app skeleton exists. (NOTE: this was the item the ROADMAP-002 plan called "TASK-023"; it was renumbered to TASK-027 because 023–026 were taken by the concurrently-created ROADMAP-001 Phase 5 cutover series. The unrelated `TASK-023-remove-legacy-conf-queue-code-backend.md` is a backend-cleanup item, NOT this dependency.)
- **DEPENDS ON [TASK-029](TASK-029-portal-pg-migration-001.md)** — provides Postgres migration 001 with the `users` table (`google_sub`, `email`, `name`, `picture`, `is_allowed`, `last_login_at`) that the callback upserts into. The upsert and `/api/me` read against that table. TASK-029 already declares `blocks: [TASK-030]`.
- **BLOCKS Phase 5 frontend Landing / sign-in work** (ROADMAP-002 Phase 5: Landing sign-in / request-access, DevicePicker). The frontend's `/api/me`-driven auth state and request-access UI cannot be built until this auth gate and `/api/me` exist.

## Notes

- **Deploy-time manual step (not a code blocker):** a human must create a Google Cloud Console OAuth 2.0 Web client and register the authorized redirect URI `${APP_ORIGIN}/auth/google/callback`; the resulting client id/secret are injected via `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` env. All code here is implementable and testable without that step via mocked/quiet OIDC paths; only the live Google round-trip is human-verified.
- This task is part of ROADMAP-002 Phase 2 (Portal foundation), Workstream A3 (Auth) + A5 (routes) of the implementation plan.
