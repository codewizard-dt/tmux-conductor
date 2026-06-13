---
id: TASK-029
title: "Postgres migration 001 — users, devices (hashed tokens), pairing_codes"
status: superseded
created: 2026-06-12
updated: 2026-06-13
depends_on: [TASK-027]
blocks: [TASK-030]
parallel_safe_with: []
uat: ""
tags: [portal, postgres, migration, schema, auth, roadmap-002]
---

<!-- SUPERSEDED (2026-06-13): The `simplify-architecture` branch replaced hand-rolled Google OIDC auth
with better-auth. The planned `users`/`devices`/`pairing_codes` schema was replaced by better-auth's
own schema (`user`, `session`, `account`, `verification` tables), generated and applied via
`@better-auth/cli migrate` against the managed Postgres cluster `tmux-conductor-db` (nyc3). The
`app/api/migrate.ts` runner (formerly portal/migrate.ts) remains for future app-specific migrations
but has no SQL files yet. -->

# TASK-029 — Postgres migration 001 — users, devices (hashed tokens), pairing_codes

## Objective

Author the first Postgres migration for the hosted portal: `portal/migrations/001_init.sql`, applied by the `portal/migrate.ts` boot-time runner delivered in TASK-027. It creates the three identity tables that hosted Postgres holds — `users`, `devices`, and `pairing_codes` — plus the `pgcrypto` extension for `gen_random_uuid()` and a partial index on active (non-revoked) devices. This is pure forward DDL: the schema must *support* the device-token and pairing-code security design (token/code stored only as SHA-256 hashes, single-use codes with expiry) without implementing any app logic, which lands in later tasks. All conductor operational data stays local in SQLite; this Postgres schema is identity-only.

This is ROADMAP-002 Phase 2's schema item (`wiki/work/roadmaps/ROADMAP-002-hosted-portal-oauth-relay-installer.md`, Phase 2, line 32). It is the data-layer foundation the OIDC sign-in flow (TASK-030) upserts into, and the pairing/devices APIs (Phase 3) read and write.

## Approach

### Authoritative design source

Implementation plan, Workstream A2 "Postgres schema": `/Users/davidtaylor/.claude/plans/the-time-has-come-peppy-cupcake.md` (referenced from ROADMAP-002 line 19 — relay protocol framing, Postgres DDL, portal route table, installer outline, security checklist). The table definitions below are the contract; follow column names, types, and constraints exactly.

### Migration runner contract (from TASK-027)

`portal/migrate.ts` (created in TASK-027) is the boot-time runner. Its contract, which this migration must honour:

- It discovers `*.sql` files in `portal/migrations/` in lexical order (`001_…`, `002_…`, …).
- It **wraps each migration file in a single transaction** and records the applied version (e.g. in a `schema_migrations` table or equivalent) so each file is applied **exactly once**.
- Therefore `001_init.sql` is **plain forward DDL**. Do **NOT** add `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` "idempotency hacks" on the table/index DDL — the runner already guarantees once-only application, and `IF NOT EXISTS` would mask schema drift (a table that already exists with a different shape would be silently accepted). The **only** acceptable `IF NOT EXISTS` is on the extension (`CREATE EXTENSION IF NOT EXISTS pgcrypto;`), which is a cluster-level object that may legitimately pre-exist and is not part of the drift surface.

> NOTE on grounding: at authoring time `portal/` does not yet exist on disk (TASK-027 is its prerequisite and is not yet complete). The runner contract above is the **interface this task codes against**. Step 1 below re-verifies the runner's actual ordering/transaction behaviour against the delivered `portal/migrate.ts` before writing the SQL, and adapts the file name / version-recording detail to match what TASK-027 actually shipped (e.g. if the runner expects a `-- migrate:up` sentinel or a specific filename regex).

### Extension choice — pgcrypto

`gen_random_uuid()` requires an extension. Two options exist (`pgcrypto` and `uuid-ossp`). Use **`pgcrypto`** — it is the preferred/available choice on DigitalOcean Managed Postgres (the deploy target, ROADMAP-002 Phase 2 line 34) and exposes `gen_random_uuid()` directly. Emit `CREATE EXTENSION IF NOT EXISTS pgcrypto;` as the first statement in the file.

### Table definitions (the contract)

**`users`** — one row per Google-authenticated person; populated by the OIDC upsert (TASK-030).

| column | type | constraints |
|--------|------|-------------|
| `id` | `uuid` | PK, `default gen_random_uuid()` |
| `google_sub` | `text` | `unique not null` — the Google `sub` claim (stable subject id) |
| `email` | `text` | `unique not null` |
| `name` | `text` | nullable |
| `picture_url` | `text` | nullable |
| `is_allowed` | `boolean` | `not null default false` — email-allowlist gate; new users default to NOT allowed |
| `created_at` | `timestamptz` | `not null default now()` |
| `last_login_at` | `timestamptz` | nullable |

**`devices`** — one row per paired machine; the token is shown once at redemption and stored only hashed.

| column | type | constraints |
|--------|------|-------------|
| `id` | `uuid` | PK, `default gen_random_uuid()` |
| `user_id` | `uuid` | `not null references users(id) on delete cascade` |
| `name` | `text` | nullable (user-assigned device label) |
| `token_hash` | `bytea` | `unique not null` — SHA-256 of the device token (raw 32-byte digest), GitHub-PAT scheme |
| `created_at` | `timestamptz` | `not null default now()` |
| `last_seen_at` | `timestamptz` | nullable (relay heartbeat updates it) |
| `revoked_at` | `timestamptz` | nullable; non-null means revoked |

Plus a **partial index on active devices**:
`create index <name> on devices (user_id) where revoked_at is null;`
This keeps "list a user's active devices" and the per-user active-device lookups fast while excluding revoked rows from the index. (Pick a clear index name, e.g. `devices_user_id_active_idx`.)

**`pairing_codes`** — short-lived single-use codes that bind a redeeming machine to a user; the code is stored only hashed.

| column | type | constraints |
|--------|------|-------------|
| `id` | `uuid` | PK, `default gen_random_uuid()` |
| `user_id` | `uuid` | `not null references users(id) on delete cascade` |
| `code_hash` | `bytea` | `unique not null` — SHA-256 of the pairing code |
| `expires_at` | `timestamptz` | `not null` — 10-minute TTL set at creation by app logic |
| `redeemed_at` | `timestamptz` | nullable; non-null means consumed |
| `device_id` | `uuid` | `references devices(id)` — set to the device created on redemption (nullable until then) |
| `created_at` | `timestamptz` | `not null default now()` |

### Security design the schema must SUPPORT (documented here; app logic is LATER tasks)

This migration creates only the storage; the following behaviours are why the columns are shaped this way, and are implemented in Phase 3 (pairing/devices APIs), not here:

- **Device token** — generated app-side as `tcd_` + `base64url(randomBytes(32))`; stored **SHA-256 hashed** (GitHub-PAT scheme — never store the plaintext token); shown to the user exactly once at redemption. → hence `token_hash bytea unique not null` (raw 32-byte digest, not hex text).
- **Pairing code** — 8-char Crockford base32, displayed to the user as `XXXX-XXXX`; **10-minute expiry**; **single-use** via an atomic claim, e.g. `UPDATE pairing_codes SET redeemed_at = now(), device_id = $1 WHERE code_hash = $2 AND redeemed_at IS NULL AND expires_at > now() RETURNING user_id;` (the `WHERE redeemed_at IS NULL AND expires_at > now()` guard plus `RETURNING` makes redemption atomic and race-free); **≤5 outstanding (unredeemed, unexpired) codes per user** enforced in app logic. → hence `code_hash bytea unique not null`, `expires_at timestamptz not null`, `redeemed_at timestamptz` nullable, and the nullable `device_id` FK.

Cross-link: this schema is consumed by `wiki/work/tasks/TASK-030-…` (Google OIDC sign-in upserts into `users`) and the Phase 3 pairing/device APIs.

## Steps

### 1. Verify the TASK-027 runner contract & migrations layout  <!-- agent: general-purpose -->

- [x] Confirm TASK-027 has shipped: `portal/migrate.ts` exists and `portal/migrations/` is the directory it scans. Use Serena (`mcp__serena__find_file` for `migrate.ts` under `portal/`, `mcp__serena__get_symbols_overview` on it) — do NOT use `find`/`cat`/`grep`. <!-- Completed: 2026-06-13 -->
- [x] Read `portal/migrate.ts` to confirm: (a) the filename pattern / ordering it expects (so `001_init.sql` is named to match), (b) that it wraps each file in a transaction, (c) how it records applied versions, and (d) whether it expects any in-file sentinel (e.g. `-- migrate:up` / a statement delimiter). Adapt the SQL file name and any required header comment to the actual runner. <!-- Completed: 2026-06-13 — plain SQL, no sentinel, filename used as version key, lexical sort, each file in a transaction -->
- [x] Confirm the `pg` `Pool` is the connection used and that the target is Postgres (so `bytea`, `timestamptz`, `gen_random_uuid()`, partial indexes are all valid). If TASK-027 is NOT yet present, STOP and surface that the dependency is unmet (this task is blocked on TASK-027). <!-- Completed: 2026-06-13 — pg.Pool confirmed, advisory lock on 4711n, migrations/ has only .gitkeep -->

### 2. Write portal/migrations/001_init.sql  <!-- agent: general-purpose -->

- [ ] Create `portal/migrations/001_init.sql` using the `Write` tool (it is a `.sql` source file, not markdown/config — `Write` is appropriate here; do NOT use `sed`/`awk`/`echo >>`).
- [ ] First statement: `CREATE EXTENSION IF NOT EXISTS pgcrypto;` (the only permitted `IF NOT EXISTS` — see Approach).
- [ ] `CREATE TABLE users (...)` exactly per the Approach table (id/google_sub/email/name/picture_url/is_allowed/created_at/last_login_at, with the unique + not-null + default constraints listed).
- [ ] `CREATE TABLE devices (...)` exactly per the Approach table, including `user_id uuid not null references users(id) on delete cascade` and `token_hash bytea unique not null`.
- [ ] `CREATE INDEX devices_user_id_active_idx ON devices (user_id) WHERE revoked_at IS NULL;` (partial index on active devices).
- [ ] `CREATE TABLE pairing_codes (...)` exactly per the Approach table, including both FKs (`user_id … on delete cascade`, `device_id … references devices(id)`), `code_hash bytea unique not null`, `expires_at timestamptz not null`, `redeemed_at timestamptz`.
- [ ] Plain forward DDL only — NO `IF NOT EXISTS` on tables/indexes. Add concise SQL comments above each table summarising its role and the security rationale for the hashed columns (mirror the Approach "security design" notes so the schema is self-documenting).
- [ ] If the runner (Step 1) requires a header sentinel or specific delimiter, include it.

### 3. Apply & verify against a real Postgres  <!-- agent: general-purpose -->

- [ ] Run the migration via the TASK-027 runner against a local/dev Postgres (use the runner's documented invocation, e.g. an npm script in `portal/package.json` or `node portal/migrate.ts`). Run from the correct workspace. Capture output; confirm `001_init.sql` is reported applied and recorded in the runner's version table.
- [ ] Verify the schema: connect with `psql` (or the runner's verify path) and check `\d users`, `\d devices`, `\d pairing_codes` show the exact columns/types/constraints; confirm `devices_user_id_active_idx` exists and is partial (`WHERE revoked_at IS NULL`); confirm both FKs and the `on delete cascade` on `user_id`.
- [ ] Idempotency-of-runner check: run the migration command a **second** time and confirm it is a **no-op** (the runner skips already-applied `001_init.sql`, does not error, does not re-run DDL). This validates the "runner guarantees once-only" contract this file relies on.
- [ ] Negative check: confirm inserting a `devices` row with a duplicate `token_hash` is rejected (unique) and that a `pairing_codes` row requires a non-null `expires_at`. (Throwaway rows; clean up after.) Host scratch (any dump/log) goes under `./tmp/` per CLAUDE.md — never `/tmp` or `mktemp -d`.

### 4. Wire the migration into the portal package (if not already)  <!-- agent: general-purpose -->

- [ ] Confirm `portal/migrate.ts` automatically picks up `portal/migrations/001_init.sql` (it should, by directory scan). If TASK-027 left a manifest/list of migrations to register, add `001_init.sql` to it.
- [ ] Confirm the boot path runs migrations (Phase 2's "boot-time migrations" — the portal scaffold from the sibling Phase 2 item runs `migrate` on startup). No app code beyond the migration file is in scope for THIS task; just ensure the file is in the path the runner scans.

## Dependencies

- **DEPENDS ON [TASK-027]** — the `portal/migrate.ts` boot-time migration runner, the `portal/migrations/` directory, and the `pg` `Pool` connection. This task authors the first migration file that runner applies; it cannot be written or verified until TASK-027 ships the runner and directory. (TASK-027 is the sibling ROADMAP-002 Phase 2 item "Scaffold portal/ … boot-time migrations" — line 31.)
- **BLOCKS [TASK-030]** — Google OIDC sign-in, which upserts authenticated users into the `users` table (`INSERT … ON CONFLICT (google_sub) …`) and reads `is_allowed` for the email-allowlist gate. TASK-030 cannot run until `users` exists. (TASK-030 is the ROADMAP-002 Phase 2 item "Google OIDC sign-in … /api/me" — line 33.)

### Roadmap

Implements ROADMAP-002 Phase 2, item "Postgres migration 001: users, devices (hashed tokens), pairing_codes" — `wiki/work/roadmaps/ROADMAP-002-hosted-portal-oauth-relay-installer.md` (line 32). Per instruction, this task file does not flip the roadmap checkbox; the roadmap reference is recorded here for traceability only.
