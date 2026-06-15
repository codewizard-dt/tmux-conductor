---
id: UAT-027
title: "UAT: Scaffold portal/ (Fastify, env validation, pg Pool, boot-time migrations) with /healthz"
status: passed
task: TASK-027
created: 2026-06-13
updated: 2026-06-13
---

# UAT-027 — UAT: Scaffold portal/ (Fastify, env validation, pg Pool, boot-time migrations) with /healthz

implements::[[TASK-027]]

> **Source task**: [`wiki/work/tasks/TASK-027-scaffold-portal-foundation.md`](../tasks/TASK-027-scaffold-portal-foundation.md)
> **Generated**: 2026-06-13

---

## Prerequisites

- [ ] Node.js >= 22 installed on the host
- [ ] `portal/node_modules` populated: run `npm install` inside `portal/` if not already done
- [ ] For migration and boot tests: a reachable Postgres instance with `DATABASE_URL` exported (e.g. a local `postgres://` or DO dev DB)
- [ ] For env-validation tests: no `DATABASE_URL` or session vars set in the shell (use one-shot `env -i` invocations as shown per test)

---

## Test Cases

---

### UAT-STATIC-001: portal/ directory contains all required scaffolding files

- **Description**: Verifies the portal/ package was scaffolded with every required file and no prohibited artifacts (no `001_init.sql`).
- **Steps**:
  1. From the repo root, check that each expected file exists and the prohibited one does not.
- **Command**:
  ```bash
  ls portal/package.json portal/tsconfig.json portal/env.ts portal/db.ts portal/migrate.ts portal/index.ts portal/migrations/.gitkeep && echo "all present" && ! ls portal/migrations/001_init.sql 2>/dev/null && echo "001_init.sql absent (correct)"
  ```
- **Expected Result**: All seven paths print without error, "all present" is echoed, and "001_init.sql absent (correct)" is echoed. No `ls: cannot access` or similar error lines appear.
- [x] Pass <!-- 2026-06-13 -->

---

### UAT-STATIC-002: npx tsc --noEmit passes with zero type errors

- **Description**: Verifies the strict TypeScript config (ES2022 / NodeNext / strict / noUncheckedIndexedAccess / exactOptionalPropertyTypes) compiles cleanly.
- **Steps**:
  1. From the `portal/` directory, run the type-check.
- **Command**:
  ```bash
  cd /Users/davidtaylor/Repositories/tmux-conductor/portal && npx tsc --noEmit
  ```
- **Expected Result**: Exit code 0 with no diagnostic output (no errors, no warnings).
- [x] Pass <!-- 2026-06-13 -->

---

### UAT-ENV-001: Process exits non-zero when DATABASE_URL is not set

- **Description**: Verifies the fail-fast tiered env validation: `DATABASE_URL` is hard-required; a missing value causes the process to print a single collected-error message to stderr and exit non-zero before the server starts.
- **Steps**:
  1. Start the portal with no environment variables set (use `env -i` to strip the shell environment).
  2. Capture stderr and the exit code.
- **Command**:
  ```bash
  env -i PATH="$PATH" node --import tsx/esm /Users/davidtaylor/Repositories/tmux-conductor/portal/index.ts 2>&1; echo "exit:$?"
  ```
- **Expected Result**:
  - Output contains the line `[portal] Environment validation failed:`
  - Output contains `- DATABASE_URL is required but not set`
  - The final `exit:N` line shows a non-zero value (e.g. `exit:1`)
  - No Fastify server binds (no "Server listening" or similar line)
- [x] Pass <!-- 2026-06-13 -->

---

### UAT-ENV-002: Process exits non-zero when SESSION_SECRET is set but shorter than 32 bytes

- **Description**: Verifies that a present-but-too-short `SESSION_SECRET` is collected as a hard error (not a warning) and causes a non-zero exit alongside the collected error message.
- **Steps**:
  1. Supply a valid `DATABASE_URL` and a `SESSION_SECRET` shorter than 32 bytes.
  2. Observe stderr and exit code.
- **Command**:
  ```bash
  DATABASE_URL="$DATABASE_URL" SESSION_SECRET="tooshort" node --import tsx/esm /Users/davidtaylor/Repositories/tmux-conductor/portal/index.ts 2>&1; echo "exit:$?"
  ```
- **Expected Result**:
  - Output contains `[portal] Environment validation failed:`
  - Output contains `SESSION_SECRET is set but too short` (and the byte count + `must be ≥32 bytes`)
  - Final `exit:N` is non-zero
- [x] Pass <!-- 2026-06-13 -->

---

### UAT-ENV-003: Process boots with warning when auth vars (SESSION_SECRET, Google vars) are absent

- **Description**: Verifies the permissive-with-warning behaviour: when only `DATABASE_URL` is present and all auth vars are absent, the process continues (does not exit), prints a single warning, and the server becomes reachable.
- **Steps**:
  1. Start the portal with only `DATABASE_URL` set and no auth vars. Wait ~3 s for Fastify to listen.
  2. In a second terminal (or using `&` with a brief sleep), curl `/healthz`.
- **Command** (start server in background, probe, then kill):
  ```bash
  DATABASE_URL="$DATABASE_URL" node --import tsx/esm /Users/davidtaylor/Repositories/tmux-conductor/portal/index.ts > /tmp/portal-env003.log 2>&1 & PID=$!; sleep 4; curl -sS 'http://localhost:8080/healthz'; kill $PID 2>/dev/null; grep 'auth not fully configured' /tmp/portal-env003.log && echo "warning present"
  ```
- **Expected Result**:
  - `curl` returns `{"ok":true}`
  - Server log contains `[portal] auth not fully configured — /healthz boots but OAuth disabled (see TASK-025)`
  - "warning present" is echoed
  - Process does not exit before being killed
- [x] Pass <!-- 2026-06-13 -->

---

### UAT-API-001: GET /healthz returns HTTP 200 with { "ok": true }

- **Description**: Verifies the liveness endpoint returns the correct status code and JSON body, and does not touch the database.
- **Prerequisites**: Portal server is running (`DATABASE_URL` set, server listening on port 8080).
- **Steps**:
  1. Start the portal: `DATABASE_URL="$DATABASE_URL" node --import tsx/esm portal/index.ts` (from repo root) and wait for it to listen.
  2. Issue the request below and observe the HTTP status and body.
- **Command**:
  ```bash
  curl -sS -w '\nHTTP_STATUS:%{http_code}' 'http://localhost:8080/healthz'
  ```
- **Expected Result**:
  - Response body is `{"ok":true}` (exact JSON)
  - `HTTP_STATUS:200` appears on the trailing line
- [x] Pass <!-- 2026-06-13 -->

---

### UAT-API-002: GET /healthz on a non-existent path returns 404

- **Description**: Verifies Fastify's default 404 behaviour for unregistered routes — the scaffold must not accidentally match all routes.
- **Prerequisites**: Portal server running on port 8080.
- **Steps**:
  1. Request a path that is not registered.
- **Command**:
  ```bash
  curl -sS -w '\nHTTP_STATUS:%{http_code}' 'http://localhost:8080/notfound'
  ```
- **Expected Result**:
  - `HTTP_STATUS:404` appears on the trailing line
  - Response body contains a Fastify 404 error object (e.g. `"statusCode":404`)
- [x] Pass <!-- 2026-06-13 -->

---

### UAT-MIGRATE-001: runMigrations logs "no migrations to apply" and exits 0 when migrations/ is empty

- **Description**: Verifies the migration runner tolerates zero `.sql` files (only `.gitkeep` present in `portal/migrations/`) and exits cleanly — no error, no spurious DB writes.
- **Prerequisites**: `DATABASE_URL` is set to a reachable Postgres DB.
- **Steps**:
  1. Confirm `portal/migrations/` contains only `.gitkeep` (no `.sql` files).
  2. Run the migrate script via npm.
- **Command**:
  ```bash
  cd /Users/davidtaylor/Repositories/tmux-conductor/portal && DATABASE_URL="$DATABASE_URL" npm run migrate 2>&1; echo "exit:$?"
  ```
- **Expected Result**:
  - Output contains `[portal] no migrations to apply`
  - Final `exit:0` line confirms clean exit
  - No error stack traces appear
- [x] Pass <!-- 2026-06-13 -->

---

### UAT-MIGRATE-002: schema_migrations table is created after runMigrations runs

- **Description**: Verifies that even when zero migration files exist, the runner still creates (or confirms) the `schema_migrations` table with the correct schema.
- **Prerequisites**: `DATABASE_URL` set; `npm run migrate` has been run at least once (UAT-MIGRATE-001 passed).
- **Steps**:
  1. Query the Postgres DB to verify the table and its column names.
- **Command**:
  ```bash
  psql "$DATABASE_URL" -c '\d schema_migrations' 2>&1
  ```
- **Expected Result**:
  - Table `schema_migrations` exists
  - Columns include `version text` (PRIMARY KEY) and `applied_at timestamptz`
  - No error line like `ERROR: relation "schema_migrations" does not exist`
- [x] Pass <!-- 2026-06-13 -->

---

### UAT-MIGRATE-003: runMigrations is idempotent — second run is a no-op

- **Description**: Verifies that running the migration script twice against a DB that already has `schema_migrations` populated produces a clean second run with no errors and no duplicate inserts.
- **Prerequisites**: `DATABASE_URL` set; first run (UAT-MIGRATE-001) already completed.
- **Steps**:
  1. Run the migrate script a second time.
- **Command**:
  ```bash
  cd /Users/davidtaylor/Repositories/tmux-conductor/portal && DATABASE_URL="$DATABASE_URL" npm run migrate 2>&1; echo "exit:$?"
  ```
- **Expected Result**:
  - Output contains `[portal] no migrations to apply` (same as first run — zero `.sql` files)
  - Final `exit:0`
  - No "duplicate key" or SQL error lines
- [x] Pass <!-- 2026-06-13 -->

---

### UAT-EDGE-001: Process exits non-zero with clear message when DATABASE_URL is unreachable

- **Description**: Verifies that a `DATABASE_URL` that is syntactically valid but points to an unreachable host causes the portal to print a clear error and exit non-zero (rather than hang indefinitely).
- **Steps**:
  1. Set `DATABASE_URL` to a valid-looking but unreachable connection string.
  2. Start the portal and observe its output within 30 seconds.
- **Command**:
  ```bash
  DATABASE_URL='postgres://nobody:wrong@127.0.0.1:5499/nonexistent' node --import tsx/esm /Users/davidtaylor/Repositories/tmux-conductor/portal/index.ts 2>&1; echo "exit:$?"
  ```
- **Expected Result**:
  - Output contains `[portal] failed to run migrations — is DATABASE_URL reachable?`
  - Final `exit:N` is non-zero (typically `exit:1`)
  - Process exits within ~30 s (pg default connect timeout); does not hang
- [x] Pass <!-- 2026-06-13 -->

---

### UAT-EDGE-002: PORT env var is respected — server listens on the specified port

- **Description**: Verifies that `PORT` overrides the default 8080 and the server binds on the specified port.
- **Prerequisites**: `DATABASE_URL` set to a reachable DB; chosen port (e.g. 9090) is free.
- **Steps**:
  1. Start the portal with `PORT=9090`, wait for it to listen.
  2. Probe `/healthz` on port 9090 (not 8080).
- **Command**:
  ```bash
  DATABASE_URL="$DATABASE_URL" PORT=9090 node --import tsx/esm /Users/davidtaylor/Repositories/tmux-conductor/portal/index.ts > /tmp/portal-edge002.log 2>&1 & PID=$!; sleep 4; curl -sS -w '\nHTTP_STATUS:%{http_code}' 'http://localhost:9090/healthz'; kill $PID 2>/dev/null
  ```
- **Expected Result**:
  - Response body `{"ok":true}` with `HTTP_STATUS:200` on port 9090
  - Curl to port 8080 would fail (not tested here, but implied by the successful 9090 response)
- [x] Pass <!-- 2026-06-13 -->

---

### UAT-EDGE-003: Invalid PORT value (non-integer) causes exit non-zero

- **Description**: Verifies that a non-integer `PORT` value is collected as a hard validation error and exits non-zero.
- **Steps**:
  1. Supply a syntactically invalid port value alongside a valid `DATABASE_URL`.
- **Command**:
  ```bash
  DATABASE_URL="$DATABASE_URL" PORT=notanumber node --import tsx/esm /Users/davidtaylor/Repositories/tmux-conductor/portal/index.ts 2>&1; echo "exit:$?"
  ```
- **Expected Result**:
  - Output contains `[portal] Environment validation failed:`
  - Output contains `PORT must be a valid integer, got: notanumber`
  - Final `exit:N` is non-zero
- [x] Pass <!-- 2026-06-13 -->
