---
id: ROADMAP-002
title: Hosted portal with Google OAuth, device relay, and installer
status: active
created: 2026-06-12
updated: 2026-06-14
owner: David
linked_requirements: []
linked_decisions: []
tags: [portal, auth, relay, installer]
---

# Roadmap 002: Hosted portal with Google OAuth, device relay, and installer

## Goal

A hosted app on DigitalOcean App Platform where allowlisted users sign in, pair their machine via a curl|bash installer, and operate their local conductor from any browser through a secure outbound WebSocket relay — no inbound ports or tunnels on user machines; all conductor data stays local in SQLite, hosted Postgres holds identity only (users, hashed device tokens, pairing codes).

> **Architecture update (2026-06-13, `simplify-architecture` branch).** The standalone `portal/` service was merged into a unified `app/` (frontend + API): `app/api/` (Fastify + **better-auth**, App Platform Docker service) and `app/frontend/` (App Platform static site). The conductor API was renamed `backend/` → `host-server/` (native-only, never Dockerized, port 8788). **Auth is now `better-auth`** (email/password + optional Google) on managed Postgres, replacing the hand-rolled `openid-client`/`jose` OIDC flow. App Platform deploys via push-to-deploy (`deploy/app.yaml`); the host-server deploys natively via `make deploy` + systemd (`deploy/host-server.service`). Throughout this roadmap, read "portal" as `app/api` and "backend :8788" as `host-server :8788`.

Design reference: implementation plan at `/Users/davidtaylor/.claude/plans/the-time-has-come-peppy-cupcake.md` (relay protocol framing, Postgres DDL, portal route table, installer outline, security checklist). Architecture-simplification plan: `/Users/davidtaylor/.claude/plans/create-a-comprehensive-plan-cached-hartmanis.md`.

## Phase 1: Installer & local foundation

- [x] Complete ROADMAP-001 Phase 1 (SQLite foundation) — prerequisite, tracked in [ROADMAP-001](ROADMAP-001-sqlite-data-layer-projects-schedules.md) <!-- Satisfied: ROADMAP-001 Phase 1 (TASK-002/003/004) complete 2026-06-12 -->
- [x] [TASK-019: Parameterize daemon plist + add systemd user-unit template](../tasks/TASK-019-parameterize-daemon-plist-systemd.md) <!-- Completed: 2026-06-12 -->
- [x] [TASK-020: Sync `bin/conductor daemon install` to rendered-template + bootout/bootstrap](../tasks/TASK-020-daemon-install-render-bootstrap.md) <!-- Completed: 2026-06-12 -->
- [x] [TASK-021: Write install.sh (bash-3.2-safe, idempotent curl|bash)](../tasks/TASK-021-install-sh-curl-bash.md) <!-- Completed: 2026-06-12 -->
- [x] [TASK-022: Verify installer end-to-end into scratch CONDUCTOR_HOME on macOS](../tasks/TASK-022-verify-installer-e2e-macos.md) <!-- Completed: 2026-06-12 (scoped-live PASS; launchctl-live + /healthz await throwaway-$HOME/CI run) -->

## Phase 2: App foundation (✅ delivered via `simplify-architecture`, 2026-06-13)

The original Phase 2 tasks were largely delivered or superseded by the architecture simplification:

- [x] [TASK-027: Scaffold the Fastify API (env validation, pg Pool, boot-time migrations) with /healthz](../tasks/TASK-027-scaffold-portal-foundation.md) — built as `portal/`, now lives at `app/api/`
- [x] ~~[TASK-029: Postgres migration 001 — users, devices, pairing_codes]~~ **superseded** — replaced by **better-auth's** own schema (`user`, `session`, `account`, `verification`), generated via `@better-auth/cli migrate`. App-specific tables (devices, pairing_codes) move to Phase 3, re-grounded on better-auth's `user.id`.
- [x] ~~[TASK-030: Google OIDC sign-in, JWT session, allowlist, /api/me]~~ **superseded** — replaced by **better-auth** (email/password + optional Google `socialProviders`) mounted at `/api/auth/*` in `app/api`. See `app/api/auth.ts`.
- [x] ~~[TASK-028: Dockerfile.portal + deploy/do-app.yaml]~~ **superseded** — replaced by `app/api/Dockerfile` + `deploy/app.yaml` (App Platform native build, push-to-deploy). Managed Postgres `tmux-conductor-db` (pg17, nyc3) provisioned; CA pinned in `deploy/do-ca-certificate.crt`.
- [ ] [TASK-050: App Platform live deploy runbook](../tasks/TASK-050-app-platform-live-deploy-runbook.md) — replace `OWNER` in `deploy/app.yaml`, set secrets, optional Google OAuth client, migrations, `/healthz` verify (manual cloud steps)
- [ ] **Signup gating — invite codes (replaces the email-allowlist plan).** Ported from jarvis (same better-auth + Postgres stack). Single-user first, multi-user via codes later:
  - [x] [TASK-047: invite_codes migration + better-auth redemption hook](../tasks/completed/TASK-047-invite-codes-migration-redemption-hook.md) — `x-invite-code` header, atomic `used_count` increment; drops `ALLOWLIST_EMAILS`, adds `BOOTSTRAP_ADMIN_EMAIL` bypass
  - [x] [TASK-048: invite-codes admin CRUD + public validate routes](../tasks/archive/TASK-048-invite-codes-admin-validate-routes.md) — Fastify on `app/api`, admin-gated create/list/revoke + public `/validate`
  - [x] [TASK-049: invite-codes signup + admin UI](../tasks/completed/TASK-049-invite-codes-signup-admin-ui.md) — `app/frontend` two-step signup + admin mint/list/revoke <!-- Completed: 2026-06-14 (UAT-049 auto: API-002/011 + EDGE-005 pass; UI/manual tests need /uat-walk; Google OAuth stash out-of-scope) -->

## Phase 3: Pairing & devices

> **Re-ground on better-auth.** The `devices` + `pairing_codes` tables (and their hashed-token / single-use design) are still needed, but now reference **better-auth's `user.id`** instead of the superseded custom `users` table. Author them as an `app/api` migration (`app/api/migrations/NNN_*.sql`, applied by `app/api/migrate.ts`) and protect the pairing/devices routes with better-auth session middleware rather than the planned hand-rolled `requireSession` guard. The TASK-031/032/033 step bodies remain valid for the pairing/device *logic*; only the auth/user-table substrate changes. **[TASK-051](../tasks/TASK-051-reground-portal-tasks-to-app-api.md)** mechanically applies this re-grounding (and the `portal/` → `app/api/` path rename) to the TASK-031/032/033/035 files.

- [x] [TASK-031: Pairing-code creation API + rate-limited /pair/redeem (hashed, single-use, 10-min expiry)](../tasks/completed/TASK-031-portal-pairing-code-api-redeem.md) — on `app/api`, behind better-auth session
- [x] [TASK-032: daemon/pair.ts + daemon/credentials.ts; conductor pair / conductor unpair CLI](../tasks/archive/TASK-032-daemon-pair-credentials-cli.md)
- [x] [TASK-033: Devices API: list with connected flag, rename, revoke (ownership-404 semantics, revoke closes live connection)](../tasks/completed/TASK-033-portal-devices-api.md) — on `app/api`, devices FK → better-auth `user.id`

## Phase 4: Relay

> This is the key open seam from the architecture simplification: today the browser reaches `host-server :8788` directly (via the Vite proxy in dev). The relay makes `app/api` funnel conductor traffic to the host-server over an outbound WSS, so the hosted app works without inbound ports on user machines.

- [x] [TASK-034: shared/relay-protocol.ts frame contract (req/res/body chunks/cancel/err, correlation ids)](../tasks/TASK-034-shared-relay-protocol-ts.md) <!-- completed 2026-06-13 -->
- [x] [TASK-035: `app/api` WS endpoint, user-first connection registry, and mux (request lifecycle, fail-all-pending on drop, in-flight caps, timeouts)](../tasks/completed/TASK-035-portal-ws-relay-endpoint-registry-mux.md) <!-- completed 2026-06-14 -->
- [x] [TASK-052: daemon/connector.ts — outbound WSS](../tasks/archive/TASK-052-daemon-connector-outbound-wss.md) — reconnect/backoff, path-allowlisted proxying to **host-server :8788** and the daemon Unix socket <!-- completed 2026-06-14 -->
- [x] [TASK-053: Plain JSON request/response relay end-to-end](../tasks/completed/TASK-053-relay-plain-json-e2e.md) — `/api/status` in a browser via `/relay/:deviceId` <!-- completed 2026-06-15 · UAT-053 passed (auto) 2026-06-15 -->
- [x] [TASK-054: Relay streaming — SSE, upload, cancel/backpressure](../tasks/completed/TASK-054-relay-streaming-sse-upload-cancel.md) — SSE pass-through, image-upload request bodies, cancel/backpressure — validated through the DO edge <!-- completed 2026-06-14 · UAT-054 passed (auto) 2026-06-14 · EDGE-003/004 observational, deferred to /uat-walk; DO-edge validation deferred to TASK-050 -->
- [x] [TASK-055: Wire `app/frontend` through `app/api` relay in prod](../tasks/completed/TASK-055-frontend-relay-prod-wiring.md) — replaces the direct host-server proxy used in dev <!-- completed 2026-06-14 · UAT-055 passed (auto) 2026-06-14 -->

## Phase 5: Frontend & hardening

- [x] [TASK-056: `app/frontend` runtime mode detection (local-direct vs relay) + API_BASE rewire](../tasks/completed/TASK-056-frontend-runtime-mode-detection.md) — replaces the planned `frontend/runtime.ts`
- [x] [TASK-057: DevicePicker (pairing-code panel, revoke) + Onboarding (install instructions)](../tasks/completed/TASK-057-device-picker-onboarding-ui.md) — sign-in / invite-code entry covered by [TASK-049](../tasks/completed/TASK-049-invite-codes-signup-admin-ui.md) <!-- completed 2026-06-14 · UAT-057 API/proxy/data tests passed (auto); 8 UI tests defer to /uat-walk -->
- [x] [TASK-058: Security checklist pass + structured logs + device last-seen heartbeat](../tasks/completed/TASK-058-security-hardening-logs-heartbeat.md) — plan §Security checklist <!-- completed 2026-06-15 · UAT-058 passed (auto) 2026-06-15 · all 16 tests (9 API + 7 relay/daemon edge) verified; fixed pair.ts rate-limit 500→429 -->

- [x] [TASK-059: README install one-liner + docs updates](../tasks/archive/TASK-059-readme-docs-updates.md) — CLAUDE.md, scripts/README; note `host-server` / `app/` split <!-- completed 2026-06-14 · UAT-059 passed (auto) 2026-06-14 · all 14 tests verified -->


## Prior Art

- **[ROADMAP-005](ROADMAP-005-ngrok-tunnel-daemon.md)** (tunnel): A chisel/frp reverse-tunnel approach was the previous design for remote dashboard access — a separately-hosted tunnel server with a client daemon on the conductor host. Superseded by the outbound WSS relay here: no inbound ports on user machines, no separately-provisioned tunnel server, auth handled by the portal rather than tunnel-level SSH keys. The chisel research notes in ROADMAP-005 remain useful context.
- **[ROADMAP-006](ROADMAP-006-deploy-do-app-platform-oauth-proxy.md)** (oauth-proxy deploy): An oauth2-proxy sidecar + DO App Platform deploy was the previous auth/deploy plan. Superseded twice: first by first-party Google OIDC, then by **better-auth** in this roadmap's Phase 2. Its Phase 1 bootstrap artefacts (`Dockerfile.prod`, `docker-compose.yml`, `.github/workflows/build.yml`) were **deleted** in the 2026-06-13 `simplify-architecture` cleanup; deployment now uses `deploy/app.yaml` (App Platform native build) and `.github/workflows/ci.yml` (typecheck/lint). `.github/workflows/security.yml` survives.

## Notes
