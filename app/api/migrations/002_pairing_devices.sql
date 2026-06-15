-- 002_pairing_devices.sql
-- Creates the devices and pairing_codes tables used by the pairing flow.
--
-- Both tables reference better-auth's "user"(id) column (quoted, lowercase).
-- This migration must run AFTER better-auth has applied its own schema so that
-- the "user" table exists. In the normal boot sequence this is guaranteed because
-- runMigrations() fires after the auth singleton is constructed in index.ts.
-- On a fresh database, run `npm run auth:generate` (or `@better-auth/cli migrate`)
-- before `npm run migrate` if running migrations in isolation.

CREATE TABLE IF NOT EXISTS devices (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       text        NOT NULL REFERENCES "user"(id),
  token_hash    bytea       NOT NULL,
  name          text        NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NULL,
  revoked_at    timestamptz NULL
);

CREATE INDEX IF NOT EXISTS devices_user_id_idx ON devices (user_id);

CREATE TABLE IF NOT EXISTS pairing_codes (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      text        NOT NULL REFERENCES "user"(id),
  code_hash    bytea       NOT NULL,
  device_id    uuid        NULL REFERENCES devices(id),
  expires_at   timestamptz NOT NULL,
  redeemed_at  timestamptz NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pairing_codes_user_id_idx ON pairing_codes (user_id);
-- Used for the fast atomic redemption lookup:
CREATE INDEX IF NOT EXISTS pairing_codes_code_hash_idx ON pairing_codes (code_hash);
-- Used for the outstanding-codes rate-limit count query:
CREATE INDEX IF NOT EXISTS pairing_codes_user_pending_idx ON pairing_codes (user_id) WHERE redeemed_at IS NULL;
