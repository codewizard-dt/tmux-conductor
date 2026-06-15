-- 001_invite_codes.sql
-- Creates the invite_codes table used by the better-auth redemption hook in auth.ts.
--
-- FK ordering note: created_by references better-auth's "user" table (quoted, lowercase).
-- better-auth provisions its own schema on first boot via `npm run auth:generate` / the
-- built-in Kysely adapter. This migration must therefore run AFTER better-auth has
-- applied its schema (i.e. after the "user" table exists). In the normal boot sequence
-- runMigrations() is called from index.ts AFTER the auth singleton is constructed,
-- which is sufficient on a fresh database because betterAuth() runs its own DDL
-- synchronously during construction. On an empty DB, call `npm run auth:generate` once
-- before `npm run migrate` if running migrations in isolation.

CREATE TABLE IF NOT EXISTS invite_codes (
  id          text        PRIMARY KEY,
  code        text        NOT NULL UNIQUE,
  usage_limit integer     NOT NULL,
  used_count  integer     NOT NULL DEFAULT 0,
  expires_at  timestamptz NULL,
  created_by  text        NOT NULL REFERENCES "user"(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invite_codes_code_idx ON invite_codes (code);
CREATE INDEX IF NOT EXISTS invite_codes_created_by_idx ON invite_codes (created_by);
