---
id: TASK-027
title: "Scaffold portal/ (Fastify, env validation, pg Pool, boot-time migrations) with /healthz"
status: done
created: 2026-06-12
updated: 2026-06-13
depends_on: []
blocks: [TASK-028, TASK-029, TASK-030]
parallel_safe_with: []
uat: "../uat/UAT-027-scaffold-portal-foundation.md"
tags: [portal, fastify, postgres, scaffold, migrations, roadmap-002]
---

<!--
NOTE: Originally requested as TASK-023 per ROADMAP-002 Phase 2, but TASK-023/024/025/026
were already taken by the concurrently-created ROADMAP-001 Phase 5 cutover series
(remove-legacy-conf-queue-code / e2e-verification-suite). Renumbered to TASK-027 to keep
stable IDs unique. The intended downstream portal tasks (001_init.sql migration, portal
auth, Dockerfile.portal) should be filed as fresh numbers and back-linked into this task's
`blocks` list once created — see the Dependencies section.
-->

# TASK-027 — Scaffold portal/ (Fastify, env validation, pg Pool, boot-time migrations) with /healthz

## Objective

Stand up the boot skeleton for a new top-level `portal/` service (ROADMAP-002 Phase 2, Workstream A1 + A5): a Fastify 5 + TypeScript app that validates its environment, opens a `pg` Pool against DigitalOcean Managed Postgres, runs ordered SQL migrations at startup under a Postgres advisory lock, and serves `GET /healthz` returning `{ ok: true }`. This is the foundation other Phase 2/4 tasks build on (auth, relay, device/pairing routes, Docker, `001_init.sql`) — none of which are in scope here. The scaffold must boot and pass `/healthz` with `DATABASE_URL` set, even before Google OAuth / session secrets are configured.

## Approach

Conventions mirror the existing `backend/` service: ESM (`"type": "module"`), Fastify 5, TypeScript executed via `tsx` (`tsx watch` for dev, `node --import tsx/esm` for start) with no build step, and a `tsconfig.json` cloned from `backend/tsconfig.json` (target ES2022, `module`/`moduleResolution` NodeNext, `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`, `allowImportingTsExtensions`, `noEmit`). `portal/` and `shared/` are brand-new top-level directories — neither exists today (confirmed via `list_dir` on the repo root). `shared/` is created here only if a genuinely shared type is needed; otherwise defer it to the task that first needs it (auth/relay) — for this scaffold, keep everything inside `portal/` and do NOT pre-create empty `shared/` scaffolding.

Key design decisions:

- **Env validation is fail-fast but tiered.** `DATABASE_URL` is hard-required (boot aborts with a clear message if missing). `SESSION_SECRET` is validated for length (≥32 bytes) *only when present*; `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `PUBLIC_BASE_URL` are permissive-with-warning for the scaffold (auth is a downstream task, TASK-025) — so `/healthz` boots without full secrets. The error path collects ALL missing/invalid required vars and reports them together, never one-at-a-time. `ALLOWLIST_EMAILS` is optional and comma-split into `string[]`. `PORT` defaults to `8080`. Export a single typed frozen `env` object.
- **Postgres SSL: `rejectUnauthorized: false`.** DO Managed Postgres dev DBs present a self-signed CA, so the Pool uses `ssl: { rejectUnauthorized: false }`. Leave a `// TODO(prod): pin CA_CERT instead of disabling verification` so prod promotion (TASK-026 / ROADMAP-006) tightens it.
- **Migration runner is concurrency-safe and idempotent.** Acquire a session-level `pg_advisory_lock(<fixed bigint key>)` on a dedicated client so two portal instances booting together don't double-apply. Ensure a `schema_migrations` table (`version text primary key, applied_at timestamptz default now()`). Read `portal/migrations/NNN_*.sql` in lexical order, skip any `version` already recorded, and apply each remaining file inside a single transaction (`BEGIN; <sql>; INSERT INTO schema_migrations; COMMIT;`). Release the advisory lock in a `finally`. Re-running with no new files is a clean no-op. The runner must tolerate **zero** migration files (the actual `001_init.sql` lands in TASK-024) — create only `portal/migrations/.gitkeep`.
- **`/healthz` is liveness-only and fast.** It returns `{ ok: true }` with HTTP 200 without touching the DB, so DigitalOcean App Platform health checks stay green even under DB latency. DB reachability is enforced at boot (migration runner connects); a separate readiness endpoint is explicitly deferred (note it in code comment, do not implement). On boot, the app: validates env → runs migrations (clear error if DB unreachable in local dev) → registers `/healthz` → listens on `host: '0.0.0.0', port: env.PORT`.

Out of scope (downstream tasks — note in code comments where relevant, do NOT implement): `portal/auth/*` (TASK-025), `portal/relay/*` (Phase 4), `routes/devices` + `routes/pairing`, `Dockerfile.portal` (TASK-026), `do-app.yaml` (ROADMAP-006), and the `001_init.sql` DDL (TASK-024).

## Steps

### 1. Create portal/ package + tsconfig  <!-- agent: general-purpose -->

- [x] Read `backend/package.json` and `backend/tsconfig.json` first to mirror module style and compiler options. <!-- Completed: 2026-06-13 -->
- [x] Create `portal/package.json` (config file — use Write): <!-- Completed: 2026-06-13 -->
  - `"name": "tmux-conductor-portal"`, `"version": "0.1.0"`, `"type": "module"`, `"private": true`.
  - `"engines": { "node": ">=22" }` (matches the "node 22 + tsx/esm" target in the plan; backend pins higher but portal targets the DO App Platform Node 22 runtime).
  - `scripts`: `"dev": "tsx watch index.ts"`, `"start": "node --import tsx/esm index.ts"`, `"migrate": "node --import tsx/esm migrate.ts"`.
  - `dependencies`: `"fastify": "^5.8.5"`, `"pg": "^8"`.
  - `devDependencies`: `"tsx": "^4.0.0"`, `"typescript": "^5.0.0"`, `"@types/node": "^22.0.0"`, `"@types/pg": "^8"`.
- [x] Create `portal/tsconfig.json` cloned from `backend/tsconfig.json` (ES2022 / NodeNext / strict / noUncheckedIndexedAccess / exactOptionalPropertyTypes / allowImportingTsExtensions / noEmit; `"include": ["*.ts"]`, `"exclude": ["node_modules", "dist"]`). <!-- Completed: 2026-06-13 -->

### 2. Implement portal/env.ts (typed, fail-fast, tiered validation)  <!-- agent: general-purpose -->

- [x] Create `portal/env.ts` exporting a typed, `Object.freeze`d `env` object with fields: `DATABASE_URL: string`, `SESSION_SECRET: string | undefined`, `GOOGLE_CLIENT_ID: string | undefined`, `GOOGLE_CLIENT_SECRET: string | undefined`, `PUBLIC_BASE_URL: string | undefined`, `ALLOWLIST_EMAILS: string[]`, `PORT: number`. <!-- Completed: 2026-06-13 -->
- [x] Required check: `DATABASE_URL` must be a non-empty string. Collect ALL missing required vars into an array; if non-empty, `console.error` a single message listing every missing var (one per line) then `process.exit(1)`. <!-- Completed: 2026-06-13 -->
- [x] Length check: if `SESSION_SECRET` is set, require `Buffer.byteLength(SESSION_SECRET, 'utf8') >= 32`; if set-but-too-short, treat as a hard error and add to the collected list. <!-- Completed: 2026-06-13 -->
- [x] Permissive-with-warning: if any of `SESSION_SECRET` / `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `PUBLIC_BASE_URL` is absent, `console.warn` once (e.g. `[portal] auth not fully configured — /healthz boots but OAuth disabled (see TASK-025)`) and continue — do NOT exit. <!-- Completed: 2026-06-13 -->
- [x] `ALLOWLIST_EMAILS`: comma-split, trim, drop empties → `string[]` (default `[]`). <!-- Completed: 2026-06-13 -->
- [x] `PORT`: parse `process.env.PORT` as int; default `8080`; reject NaN with a clear error added to the collected list. <!-- Completed: 2026-06-13 -->
- [x] Add a top-of-file comment noting downstream tasks tighten Google/session vars to hard-required once auth lands (TASK-025). <!-- Completed: 2026-06-13 -->

### 3. Implement portal/db.ts (pg Pool singleton)  <!-- agent: general-purpose -->

- [x] Create `portal/db.ts` importing `Pool` from `pg` and `env` from `./env.ts`. <!-- Completed: 2026-06-13 -->
- [x] Module-level `let pool: Pool | undefined`. Export `getPool(): Pool` that lazily constructs and memoises a `new Pool({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } })`. <!-- Completed: 2026-06-13 -->
  - Add `// TODO(prod): replace rejectUnauthorized:false with a pinned CA_CERT on prod promotion (TASK-026 / ROADMAP-006).`
- [x] Export `async function query<T extends import('pg').QueryResultRow = any>(text: string, params?: unknown[]): Promise<import('pg').QueryResult<T>>` delegating to `getPool().query(...)`. <!-- Completed: 2026-06-13 -->
- [x] Export `async function closePool(): Promise<void>` that ends the pool if constructed (used by graceful shutdown later). <!-- Completed: 2026-06-13 -->

### 4. Implement portal/migrate.ts (advisory-locked, idempotent runner)  <!-- agent: general-purpose -->

- [x] Create `portal/migrations/.gitkeep` (empty) so the directory is tracked with zero migration files. <!-- Completed: 2026-06-13 -->
- [x] Create `portal/migrate.ts` exporting `async function runMigrations(): Promise<void>` and a CLI guard (`if (import.meta.url === ...)` / run when invoked as the `migrate` script) that calls `runMigrations()` then `closePool()` and exits non-zero on error. <!-- Completed: 2026-06-13 -->
- [x] In `runMigrations`: acquire a dedicated client via `getPool().connect()`. Call `await client.query('SELECT pg_advisory_lock($1)', [<fixed bigint, e.g. 4711>])`. Wrap the body in `try/finally`; in `finally` call `pg_advisory_unlock` then `client.release()`. <!-- Completed: 2026-06-13 -->
- [x] Ensure table: `CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`. <!-- Completed: 2026-06-13 -->
- [x] Read `portal/migrations/` via `node:fs` for `*.sql` files, sort lexically (`NNN_*.sql` ordering). If zero files → log `[portal] no migrations to apply` and return cleanly. <!-- Completed: 2026-06-13 -->
- [x] Query existing applied versions into a `Set<string>`. For each file whose `version` (filename) is not applied, run inside a transaction: `BEGIN` → the file's SQL → `INSERT INTO schema_migrations(version) VALUES($1)` → `COMMIT` (`ROLLBACK` + rethrow on error). Log each applied version. <!-- Completed: 2026-06-13 -->
- [x] Re-running with no new files must be a no-op (idempotent). <!-- Completed: 2026-06-13 -->

### 5. Implement portal/index.ts (Fastify boot + /healthz)  <!-- agent: general-purpose -->

- [x] Create `portal/index.ts` importing `Fastify` from `fastify`, `env` from `./env.ts`, `runMigrations` from `./migrate.ts`. <!-- Completed: 2026-06-13 -->
- [x] Construct `const app = Fastify({ logger: true })`. <!-- Completed: 2026-06-13 -->
- [x] Register `GET /healthz` (no auth) returning `{ ok: true }` with status 200 and no DB access. Add a comment: `// liveness only — DB readiness deferred to a future /readyz (ROADMAP-002).` <!-- Completed: 2026-06-13 -->
- [x] In an async `start()` IIFE/function: `await runMigrations()` (wrap so a missing/unreachable DB in local dev surfaces a clear `console.error` and `process.exit(1)`), then `await app.listen({ host: '0.0.0.0', port: env.PORT })`. <!-- Completed: 2026-06-13 -->
- [x] Add a top-of-file comment listing out-of-scope downstream registrations: auth (TASK-025), relay (Phase 4), device/pairing routes — none registered here. <!-- Completed: 2026-06-13 -->

### 6. Verification  <!-- agent: general-purpose -->

- [x] From `portal/`, run `npm install` (or confirm deps resolve) then `npx tsc --noEmit` — zero type errors. <!-- Completed: 2026-06-13 — npm install: 68 packages added; tsc --noEmit: exit 0, no errors -->
- [DEFERRED-TO-UAT] Boot with a reachable `DATABASE_URL` and no auth vars: `DATABASE_URL=... node --import tsx/esm index.ts` → process starts, warning about unconfigured auth is printed, server listens on `:8080`, and `curl localhost:8080/healthz` returns `{"ok":true}` with HTTP 200.
- [DEFERRED-TO-UAT] Boot with `DATABASE_URL` unset → process exits non-zero with a message naming `DATABASE_URL`.
- [DEFERRED-TO-UAT] Run `npm run migrate` twice against the dev DB → first run creates `schema_migrations` and applies zero files cleanly; second run is a no-op (idempotent).
- [x] Confirm `portal/migrations/` contains only `.gitkeep` (no `001_init.sql` — that's TASK-024). <!-- Completed: 2026-06-13 — only .gitkeep created; 001_init.sql deferred to TASK-024 -->

## Acceptance Criteria

- [ ] `portal/` exists with `package.json`, `tsconfig.json`, `env.ts`, `db.ts`, `migrate.ts`, `index.ts`, and `migrations/.gitkeep` — mirroring backend's ESM + Fastify 5 + tsx conventions.
- [ ] `npx tsc --noEmit` passes with the strict tsconfig.
- [ ] `GET /healthz` returns HTTP 200 `{ ok: true }` without touching the DB; server listens on `0.0.0.0:PORT` (default 8080).
- [ ] Env validation hard-fails on missing `DATABASE_URL` (and on a present-but-<32-byte `SESSION_SECRET`), collecting all errors into one message; warns-and-continues when Google/session vars are absent.
- [ ] `pg` Pool uses `ssl: { rejectUnauthorized: false }` with a TODO for prod CA pinning; `getPool()` is a memoised singleton and `query()` delegates to it.
- [ ] `runMigrations()` acquires a `pg_advisory_lock`, ensures `schema_migrations`, applies ordered `NNN_*.sql` in transactions, tolerates zero files, and is idempotent on re-run.
- [ ] No auth/relay/device/pairing/Docker/`001_init.sql` artifacts are created — all explicitly deferred to downstream tasks.

## Dependencies

- **depends_on:** none active. (ROADMAP-001 Phase 1, now complete, established the SQLite data-layer precedent, but the portal uses Postgres + `pg` rather than `better-sqlite3`, so there is no hard task dependency.)
- **blocks:** (frontmatter `blocks` is left empty because the intended portal-series numbers — TASK-024/025/026 — were already claimed by the unrelated ROADMAP-001 Phase 5 cutover series. The portal tasks below should be filed as fresh task numbers and should add this task to their `depends_on`; once created, back-link them here.)
  - **(portal — 001_init.sql migration)** — depends on the `migrate.ts` runner + `portal/migrations/` directory created here.
  - **(portal — auth: Google OAuth / sessions)** — depends on the Fastify app and `db.ts` from this scaffold, and tightens the permissive env vars to hard-required.
  - **(portal — Dockerfile.portal / deploy)** — depends on the `portal/` service existing.
- **parallel_safe_with:** none declared — this is the root scaffold for the portal workstream.
