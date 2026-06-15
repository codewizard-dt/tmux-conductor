---
id: TASK-048
title: "Invite codes Fastify routes — public validate + admin CRUD (port jarvis Express routes)"
status: done
created: 2026-06-14
updated: 2026-06-14
depends_on: [TASK-047]
blocks: []
parallel_safe_with: []
uat: "[[UAT-048]]"
tags: [portal, auth, invite-codes, api, fastify, roadmap-002]
---

# TASK-048 — Invite codes Fastify routes — public validate + admin CRUD (port jarvis Express routes)

## Objective

Port the jarvis invite-codes Express routes to Fastify on `app/api`: a public `POST /api/invite-codes/validate` (no mutation — returns `{valid, error?}`) and admin CRUD `GET /api/admin/invite-codes` (list), `POST /api/admin/invite-codes` (create), `DELETE /api/admin/invite-codes/:id` (revoke). The admin routes sit behind a better-auth session check plus an admin guard (admin = the authenticated user's email equals `BOOTSTRAP_ADMIN_EMAIL`). All routes use `query()` from `app/api/db.ts` against the `invite_codes` table created in TASK-047.

## Approach

**Public validate** (`POST /api/invite-codes/validate`, mirrors jarvis `routes/invite-codes.ts`):
- Body `{ code }`. Look up by `code`: `SELECT id, usage_limit, used_count, expires_at FROM invite_codes WHERE code = $1`.
- No row → `{ valid: false, error: 'invalid' }`. Expired (`expires_at` non-null and `<= now()`) → `{ valid: false, error: 'expired' }`. Exhausted (`used_count >= usage_limit`) → `{ valid: false, error: 'exhausted' }`. Otherwise `{ valid: true }`.
- **No mutation** — this only previews validity for the signup UI; actual consumption happens in the TASK-047 redemption hook.

**Admin guard**: read the better-auth session from the request. Reuse better-auth's own session reading — call `auth.api.getSession({ headers: req.headers })` (the better-auth instance exported from `app/api/auth.ts`). No session → `401`. Session whose `user.email !== BOOTSTRAP_ADMIN_EMAIL` → `403`. Factor this into a small `requireAdmin(req, reply)` helper (port of jarvis `requireAdmin` middleware) used by all three admin routes.

**Admin CRUD** (port of jarvis `routes/admin/invite-codes.ts`):
- `GET /` → `SELECT id, code, usage_limit, used_count, expires_at, created_by, created_at FROM invite_codes ORDER BY created_at DESC`.
- `POST /` → validate body (jarvis Zod: `code` 4–64 chars, `usageLimit` int ≥ 1, `expiresAt` optional ISO string). Generate `id = crypto.randomUUID()`, set `created_by = session.user.id`, `INSERT` and return the row. Map `code` UNIQUE violation (pg error code `23505`) to a `409 { error: 'duplicate_code' }`.
- `DELETE /:id` → `DELETE FROM invite_codes WHERE id = $1` (revoke); `404` if no row removed.
- **Validation**: port the jarvis Zod schema. Either add `zod` to `app/api/package.json` (note the new dependency in the step) or hand-roll an equivalent manual validator — pick one and state which; if zod is added, run `npm install`.

**Wiring**: create a Fastify plugin `app/api/routes/invite-codes.ts` exporting the public + admin routes (prefixed `/api/invite-codes` and `/api/admin/invite-codes`) and register it in `app/api/index.ts` alongside the existing `/api/auth/*` catch-all and `/healthz`.

## Approach notes — session reading

The catch-all `/api/auth/*` already forwards to `auth.handler`; for guards we instead call the typed `auth.api.getSession({ headers })`. Confirm the exact export name of the better-auth instance in `app/api/auth.ts` and pass Fastify's `req.headers` (better-auth accepts a `Headers`-like object; convert if needed).

## Steps

### 1. Confirm prerequisites  <!-- agent: general-purpose -->

- [x] Use Serena `find_symbol` on `app/api/auth.ts` to confirm the exported better-auth instance name and that `auth.api.getSession` is available. <!-- Completed: 2026-06-14 --> (auth exported as `auth`; `auth.api.getSession({ headers })` is standard better-auth v1 API)
- [x] Read `app/api/db.ts` to confirm `query<T>(text, params?)` return shape (rows array) used by the routes. <!-- Completed: 2026-06-14 --> (returns `Promise<pg.QueryResult<T>>`; rows via `.rows`)
- [x] Read `app/api/index.ts` to find where plugins/routes are registered (the `/api/auth/*` catch-all, `@fastify/cors`, `/healthz`) so the new plugin registers in the same place. <!-- Completed: 2026-06-14 --> (all at module top level before `start()`)
- [x] Confirm `BOOTSTRAP_ADMIN_EMAIL` is exported from `app/api/env.ts` (added in TASK-047) for the admin guard. <!-- Completed: 2026-06-14 --> (confirmed: `env.BOOTSTRAP_ADMIN_EMAIL`)
- [x] Decide zod vs manual validation; if zod, note it will be added to `app/api/package.json`. <!-- Completed: 2026-06-14 --> (Decision: manual validation — zod not installed, will use Fastify JSON Schema / manual TypeScript checks)

### 2. Implement the public validate route + `requireAdmin` helper  <!-- agent: general-purpose -->

- [x] Create `app/api/routes/invite-codes.ts` as a Fastify plugin. <!-- Completed: 2026-06-14 -->
- [x] Add `POST /api/invite-codes/validate` returning `{ valid, error? }` with the invalid/expired/exhausted verdicts (no mutation). <!-- Completed: 2026-06-14 -->
- [x] Add a `requireAdmin(req, reply)` helper using `auth.api.getSession({ headers: req.headers })`: `401` when no session, `403` when `user.email !== BOOTSTRAP_ADMIN_EMAIL`. <!-- Completed: 2026-06-14 -->

### 3. Implement admin CRUD routes  <!-- agent: general-purpose -->

- [x] `GET /api/admin/invite-codes` — list ordered by `created_at DESC`, guarded by `requireAdmin`. <!-- Completed: 2026-06-14 -->
- [x] `POST /api/admin/invite-codes` — validate body (`code` 4–64, `usageLimit` ≥ 1, optional ISO `expiresAt`), `id = crypto.randomUUID()`, `created_by = session.user.id`, INSERT + return row; map pg `23505` to `409 duplicate_code`. <!-- Completed: 2026-06-14 -->
- [x] `DELETE /api/admin/invite-codes/:id` — revoke; `404` when no row deleted. <!-- Completed: 2026-06-14 -->
- [x] If using zod, add it to `app/api/package.json` and run `npm install` in `app/api/`. <!-- Completed: 2026-06-14 --> (Not needed — manual validation used with Fastify JSON Schema)

### 4. Register the plugin  <!-- agent: general-purpose -->

- [x] Register the `invite-codes.ts` plugin in `app/api/index.ts` next to the existing route registrations. <!-- Completed: 2026-06-14 -->

### 5. Typecheck  <!-- agent: general-purpose -->

- [x] Run `npx tsc --noEmit` from `app/api/` — zero type errors. <!-- Completed: 2026-06-14 -->

## Acceptance Criteria

- [ ] `POST /api/invite-codes/validate` returns `{valid:true}` for a usable code and `{valid:false,error:...}` for invalid/expired/exhausted, with no mutation to `used_count`.
- [ ] `GET /api/admin/invite-codes` lists codes for the admin; `POST` creates a code (with generated `id`, `created_by` from session, duplicate `code` → 409); `DELETE /:id` revokes (404 when absent).
- [ ] All admin routes return `401` with no session and `403` for a non-admin (email ≠ `BOOTSTRAP_ADMIN_EMAIL`).
- [ ] The plugin is registered in `app/api/index.ts`.
- [ ] `npx tsc --noEmit` passes with zero errors.

## Dependencies

- **DEPENDS ON [TASK-047](TASK-047-invite-codes-migration-redemption-hook.md)** — the `invite_codes` table/migration and the `BOOTSTRAP_ADMIN_EMAIL` env (admin guard) must exist first.

### Roadmap

Implements ROADMAP-002 Phase 2 "allowlist gating" item, re-scoped as the jarvis invite-codes port (this task delivers the public validate + admin CRUD API) — `wiki/work/roadmaps/ROADMAP-002-hosted-portal-oauth-relay-installer.md`.
