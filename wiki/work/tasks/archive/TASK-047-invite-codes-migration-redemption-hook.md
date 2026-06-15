---
id: TASK-047
title: "Invite codes Postgres migration + better-auth redemption hook (replace email allowlist gate)"
status: done
created: 2026-06-14
updated: 2026-06-14
completed: 2026-06-14
depends_on: []
blocks: []
parallel_safe_with: []
uat: "[[UAT-047]]"
tags: [portal, auth, invite-codes, migration, better-auth, roadmap-002]
---

# TASK-047 — Invite codes Postgres migration + better-auth redemption hook (replace email allowlist gate)

## Objective

Port the jarvis invite-codes signup gate to `app/api`. Add the `invite_codes` Postgres table as the first real migration (`app/api/migrations/001_invite_codes.sql`) and a better-auth `databaseHooks.user.create.before` redemption hook in `app/api/auth.ts` that consumes an `x-invite-code` header at signup time. This **replaces the email-allowlist signup gate**: drop the `ALLOWLIST_EMAILS` gating intent from `app/api/env.ts` and introduce a single `BOOTSTRAP_ADMIN_EMAIL` env (the one account that bypasses the invite code and is treated as admin).

The hook grandfathers any email that already exists in the `"user"` table (so existing accounts keep working), then for new emails reads `x-invite-code`, validates it (exists, not expired, `used_count < usage_limit`), and atomically increments `used_count` inside a `pg` transaction. It throws on a missing/invalid/expired/exhausted code so better-auth aborts the signup.

## Approach

**Schema** (adapted from jarvis Prisma `InviteCode` → SQL), `app/api/migrations/001_invite_codes.sql`:

```sql
CREATE TABLE IF NOT EXISTS invite_codes (
  id          text PRIMARY KEY,
  code        text NOT NULL UNIQUE,
  usage_limit integer NOT NULL,
  used_count  integer NOT NULL DEFAULT 0,
  expires_at  timestamptz NULL,
  created_by  text NOT NULL REFERENCES "user"(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invite_codes_code_idx ON invite_codes (code);
CREATE INDEX IF NOT EXISTS invite_codes_created_by_idx ON invite_codes (created_by);
```

Note: `created_by` references better-auth's `"user"` table (quoted, lowercase) — better-auth creates the `"user"` table itself, so this migration must run after better-auth has provisioned its schema (or the FK can be added defensively; document the ordering). `id` is a text PK populated by the application (`crypto.randomUUID()`), mirroring jarvis. `code UNIQUE` enforces no duplicate codes.

**Redemption hook** in `app/api/auth.ts` (better-auth `databaseHooks.user.create.before`):

1. Read the lowercased email from the incoming user payload.
2. If `email === BOOTSTRAP_ADMIN_EMAIL` → allow (bypass code).
3. Query `SELECT id FROM "user" WHERE lower(email) = $1` — if a row exists (grandfather), allow without consuming a code.
4. Otherwise read `x-invite-code` from `ctx.request.headers` (the better-auth hook context). Missing → throw `APIError`/`Error` ("invite code required").
5. Open a `pg` client from `getPool()`, `BEGIN`, `SELECT ... FOR UPDATE` the code row by `code`. Validate: row exists, `expires_at IS NULL OR expires_at > now()`, `used_count < usage_limit`. On any failure `ROLLBACK` and throw.
6. `UPDATE invite_codes SET used_count = used_count + 1 WHERE id = $1`, then `COMMIT`. Release the client in a `finally`.

**Env changes** in `app/api/env.ts`: remove the `ALLOWLIST_EMAILS` gating intent (the var may be deleted or left validated-but-unused per the existing validation style — prefer removal), and add `BOOTSTRAP_ADMIN_EMAIL` (required, the single bootstrap admin / code-bypass account). Surface it from the env module the same way the other vars are exported.

## Steps

### 1. Confirm prerequisites  <!-- agent: general-purpose -->

- [x] Use Serena `get_symbols_overview` / `find_symbol` on `app/api/auth.ts` to read the current better-auth config (`emailAndPassword`, `socialProviders`, `database` Pool, `trustedOrigins`) and confirm where `databaseHooks` would be added.
- [x] Read `app/api/db.ts` to confirm `getPool()`, `query<T>(text, params?)`, and `closePool()` signatures (the hook needs a raw client for a transaction).
- [x] Read `app/api/env.ts` to find the current `ALLOWLIST_EMAILS` validation block and the export pattern; note exactly how required vars are validated so `BOOTSTRAP_ADMIN_EMAIL` matches the style.
- [x] Read `app/api/migrate.ts` to confirm the runner reads `app/api/migrations/*.sql` in lexicographic order and tracks `schema_migrations`; confirm `migrations/` currently holds only `.gitkeep`.

### 2. Write the migration SQL  <!-- agent: general-purpose -->

- [x] Create `app/api/migrations/001_invite_codes.sql` with the `invite_codes` table and the `code` + `created_by` indexes (see Approach). Use `timestamptz`, `text` PK, `now()` defaults; FK `created_by REFERENCES "user"(id)`.
- [x] Add a leading SQL comment noting the FK to better-auth's `"user"` table and the run-ordering requirement (better-auth schema must exist first).

### 3. Run the migration  <!-- agent: general-purpose -->

- [x] Run `npm run migrate` in `app/api/` (needs `DATABASE_URL`). No live Postgres available in this environment — migration deferred to first live `npm run migrate`. SQL verified by inspection: valid DDL with timestamptz, text PK, integer counts, FK to "user"(id), and two indexes. <!-- Completed: 2026-06-14 -->

### 4. Implement the redemption hook in `auth.ts`  <!-- agent: general-purpose -->

- [x] Add `databaseHooks.user.create.before` to the better-auth config in `app/api/auth.ts` implementing the grandfather + bootstrap-admin + `x-invite-code` transactional consume flow (see Approach).
- [x] Read `x-invite-code` from the hook's `ctx.request.headers`; throw a clear error on missing/invalid/expired/exhausted so better-auth aborts the signup.
- [x] Use a `pg` client from `getPool()` with `BEGIN` / `SELECT ... FOR UPDATE` / `UPDATE` / `COMMIT`, releasing the client in `finally`.

### 5. Update `env.ts` (drop allowlist gate, add bootstrap admin)  <!-- agent: general-purpose -->

- [x] Remove the `ALLOWLIST_EMAILS` signup-gating intent from `app/api/env.ts`.
- [x] Add required `BOOTSTRAP_ADMIN_EMAIL` validation + export, matching the existing var validation style.
- [x] Update `.env.example` (root) to add `BOOTSTRAP_ADMIN_EMAIL` and remove/annotate `ALLOWLIST_EMAILS` if present.

### 6. Typecheck  <!-- agent: general-purpose -->

- [x] Run `npx tsc --noEmit` from `app/api/` — zero type errors. <!-- Completed: 2026-06-14 -->

## Acceptance Criteria

- [ ] `app/api/migrations/001_invite_codes.sql` applies cleanly and creates the `invite_codes` table plus the `code` index (and `created_by` index), with the `created_by` FK to `"user"(id)`.
- [ ] Signup with no `x-invite-code` (and a non-grandfathered, non-bootstrap email) is rejected.
- [ ] Signup with a valid code succeeds and atomically increments `used_count` by exactly one (transaction-safe under concurrency).
- [ ] Expired (`expires_at <= now()`) and exhausted (`used_count >= usage_limit`) codes are rejected.
- [ ] `BOOTSTRAP_ADMIN_EMAIL` can sign up without a code; existing emails are grandfathered without consuming a code.
- [ ] `ALLOWLIST_EMAILS` signup gating is removed; `BOOTSTRAP_ADMIN_EMAIL` is validated in `env.ts`.
- [ ] `npx tsc --noEmit` passes with zero errors.

## Dependencies

- **DEPENDS ON** nothing — this is the first task in the invite-codes port (it creates the migration and hook the later tasks build on).

### Roadmap

Implements ROADMAP-002 Phase 2 "allowlist gating" item, re-scoped as the jarvis invite-codes port (this task delivers the migration + redemption hook that replaces the email allowlist) — `wiki/work/roadmaps/ROADMAP-002-hosted-portal-oauth-relay-installer.md`.
