---
id: TASK-050
title: "App Platform live deploy runbook for app/ (api + frontend), invite-gated signups from day one"
status: todo
created: 2026-06-14
updated: 2026-06-14
depends_on: [TASK-047, TASK-048]
blocks: []
parallel_safe_with: []
uat: ""
tags: [portal, deploy, app-platform, digitalocean, runbook, roadmap-002]
---

# TASK-050 — App Platform live deploy runbook for app/ (api + frontend), invite-gated signups from day one

## Objective

Capture and execute the manual DigitalOcean App Platform cloud steps for the first **live** deploy of `app/` (the `api` service + `frontend` static site) as a concrete checklist/runbook. The deploy must be gated so that signups require an invite code from day one — no open self-service registration. This task is partly **manual** (cloud console / `doctl` / `gh`) and partly **verifiable** (HTTP checks against the live URLs). The DigitalOcean MCP tools (`apps-*`, `db-cluster-*`, `apps-get-deployment-status`, `apps-get-logs`) are available to assist with provisioning, deploy, and verification.

## Approach

The App Platform spec is `deploy/app.yaml` (an `api` service built from `app/api/Dockerfile`, a `frontend` static site built with `npm ci && npm run build`, and a managed Postgres `tmux-conductor-db`, pg17, nyc3; `deploy_on_push: true`). The managed-DB CA is pinned at `deploy/do-ca-certificate.crt`. Migrations are applied via `app/api/migrate.ts` (`npm run migrate`, runs `app/api/migrations/*.sql`) plus the better-auth schema migration (`@better-auth/cli migrate`). Required app env/secrets: `DATABASE_URL`, `BETTER_AUTH_SECRET` (≥32 bytes), `PUBLIC_BASE_URL` (the api's public URL), `CORS_ORIGIN` (the frontend's public URL), `BOOTSTRAP_ADMIN_EMAIL`, and optionally `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.

Work top-to-bottom: fix the spec placeholder, provision/confirm the DB, set secrets, configure OAuth (if used), run migrations, trigger the deploy, then verify the live app and the invite gating. Each numbered step is a discrete checklist item; several require the operator to read a value back from the DO console or `doctl`/MCP output and feed it into a later step.

## Steps

### 1. Fix the spec placeholder  <!-- agent: general-purpose -->

- [ ] Edit `deploy/app.yaml` and replace the `OWNER` placeholder in the GitHub repo source with the actual GitHub repo owner (e.g. `github.com/<owner>/tmux-conductor`).
- [ ] Confirm `deploy_on_push: true` is set on the `api` service and `frontend` static site so pushes to `main` redeploy.
- [ ] Confirm the `frontend` build command is `npm ci && npm run build` and the `api` service builds from `app/api/Dockerfile`.

### 2. Provision / confirm managed Postgres, capture DATABASE_URL + CA  <!-- agent: general-purpose -->

- [ ] Use the DigitalOcean MCP `db-cluster-list` / `db-cluster-get` (or `doctl databases list`) to confirm the managed Postgres `tmux-conductor-db` (pg17, nyc3) exists, or provision it via `db-cluster-create` if not.
- [ ] Capture the full connection string into `DATABASE_URL` (must include `?sslmode=require` and reference the pinned CA).
- [ ] Confirm `deploy/do-ca-certificate.crt` matches the cluster CA via `db-cluster-get-ca` (download and diff if unsure).

### 3. Set App Platform secrets  <!-- agent: general-purpose -->

- [ ] Set `DATABASE_URL` (from Step 2) as an App Platform secret on the `api` service.
- [ ] Generate `BETTER_AUTH_SECRET` with `openssl rand -base64 32` (≥32 bytes) and set it as a secret.
- [ ] Set `PUBLIC_BASE_URL` to the api's public URL (the App Platform-assigned URL or custom domain for the `api` service).
- [ ] Set `CORS_ORIGIN` to the frontend's public URL (the static site URL or custom domain).
- [ ] Set `BOOTSTRAP_ADMIN_EMAIL` to the email that will become the first admin (used to bootstrap the invite system).
- [ ] Optionally set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` if enabling Google sign-in (see Step 4).
- [ ] Confirm the `frontend` static site has the api base URL it needs at build time (build-time env), pointing at `PUBLIC_BASE_URL`.

### 4. Create the Google OAuth client (if using Google)  <!-- agent: general-purpose -->

- [ ] In the Google Cloud console, create an OAuth 2.0 client (Web application).
- [ ] Add the authorized redirect URI `<PUBLIC_BASE_URL>/api/auth/callback/google`.
- [ ] Add the authorized JavaScript origin = the frontend's public URL (`CORS_ORIGIN`).
- [ ] Copy the client ID + secret into the `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` secrets from Step 3.
- [ ] If not using Google for the first deploy, skip this step — email/password (invite-gated) is sufficient.

### 5. Run migrations against managed Postgres  <!-- agent: general-purpose -->

- [ ] With `DATABASE_URL` pointed at the managed cluster, run the better-auth schema migration: `npx @better-auth/cli migrate` (creates the better-auth `"user"`, `session`, `account`, etc. tables).
- [ ] Run the app migrations: `npm run migrate` (executes `app/api/migrate.ts` over `app/api/migrations/*.sql`).
- [ ] Confirm the invite-code and admin-bootstrap tables/columns exist after migration.
- [ ] Run migrations from a trusted network with the CA available (`deploy/do-ca-certificate.crt`); the managed DB requires `sslmode=require`.

### 6. Trigger the deploy  <!-- agent: general-purpose -->

- [ ] Push to `main` (relies on `deploy_on_push: true`) **or** force a deploy via `make deploy-app` / `doctl apps create-deployment` / the MCP `apps-create-app-from-spec` + `apps-update`.
- [ ] Poll `apps-get-deployment-status` (or `doctl apps get-deployment`) until the deployment is `ACTIVE`.
- [ ] On failure, inspect `apps-get-logs` (build + run logs) for the `api` service and the `frontend` build.

### 7. Verify the live app  <!-- agent: general-purpose -->

- [ ] `curl -fsS <PUBLIC_BASE_URL>/healthz` returns a healthy response (green).
- [ ] Open the frontend URL in a browser — the SPA loads with no console errors and reaches the api.
- [ ] Complete a sign-in round-trip (email/password or Google) and confirm a session is established.
- [ ] Attempt a signup **without** an invite code → confirm it is **blocked** (signup is gated from day one).

### 8. Mint the first invite code as the bootstrap admin  <!-- agent: general-purpose -->

- [ ] Sign in / promote the `BOOTSTRAP_ADMIN_EMAIL` account to admin (via the bootstrap path).
- [ ] As the bootstrap admin, mint a first invite code.
- [ ] Confirm a fresh signup **with** that invite code succeeds, and that the code is consumed/invalidated as expected.

## Acceptance Criteria

- [ ] `deploy/app.yaml` has no `OWNER` placeholder; `deploy_on_push: true` is set.
- [ ] The app is reachable at its public URLs (api + frontend) and the deployment is `ACTIVE`.
- [ ] `<PUBLIC_BASE_URL>/healthz` returns green.
- [ ] An auth round-trip (sign-in) works end to end against the live deploy.
- [ ] Signup is gated by invite code — an unauthenticated signup with no code is blocked.
- [ ] The bootstrap admin can mint invite codes, and a signup with a valid code succeeds.

## Dependencies

- **DEPENDS ON TASK-047** — prerequisite portal/app work that must land before a live deploy is meaningful.
- **DEPENDS ON TASK-048** — prerequisite portal/app work that must land before a live deploy is meaningful.

### Roadmap

Implements ROADMAP-002 Phase 2 item "Remaining: live App Platform deploy of app/" — `wiki/work/roadmaps/ROADMAP-002-hosted-portal-oauth-relay-installer.md`.
