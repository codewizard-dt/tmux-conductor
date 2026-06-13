---
id: ROADMAP-002
title: Hosted portal with Google OAuth, device relay, and installer
status: active
created: 2026-06-12
updated: 2026-06-13
owner: David
linked_requirements: []
linked_decisions: []
tags: [portal, auth, relay, installer]
---

# Roadmap 002: Hosted portal with Google OAuth, device relay, and installer

## Goal

A portal app on DigitalOcean App Platform where allowlisted Google users sign in, pair their machine via a curl|bash installer, and operate their local conductor from any browser through a secure outbound WebSocket relay — no inbound ports or tunnels on user machines; all conductor data stays local in SQLite, hosted Postgres holds identity only (users, hashed device tokens, pairing codes).

Design reference: implementation plan at `/Users/davidtaylor/.claude/plans/the-time-has-come-peppy-cupcake.md` (relay protocol framing, Postgres DDL, portal route table, installer outline, security checklist).

## Phase 1: Installer & local foundation

- [x] Complete ROADMAP-001 Phase 1 (SQLite foundation) — prerequisite, tracked in [ROADMAP-001](ROADMAP-001-sqlite-data-layer-projects-schedules.md) <!-- Satisfied: ROADMAP-001 Phase 1 (TASK-002/003/004) complete 2026-06-12 -->
- [x] [TASK-019: Parameterize daemon plist + add systemd user-unit template](../tasks/TASK-019-parameterize-daemon-plist-systemd.md) <!-- Completed: 2026-06-12 -->
- [x] [TASK-020: Sync `bin/conductor daemon install` to rendered-template + bootout/bootstrap](../tasks/TASK-020-daemon-install-render-bootstrap.md) <!-- Completed: 2026-06-12 -->
- [x] [TASK-021: Write install.sh (bash-3.2-safe, idempotent curl|bash)](../tasks/TASK-021-install-sh-curl-bash.md) <!-- Completed: 2026-06-12 -->
- [x] [TASK-022: Verify installer end-to-end into scratch CONDUCTOR_HOME on macOS](../tasks/TASK-022-verify-installer-e2e-macos.md) <!-- Completed: 2026-06-12 (scoped-live PASS; launchctl-live + /healthz await throwaway-$HOME/CI run) -->

## Phase 2: Portal foundation

- [x] [TASK-027: Scaffold portal/ (Fastify, env validation, pg Pool, boot-time migrations) with /healthz](../tasks/TASK-027-scaffold-portal-foundation.md)
- [ ] [TASK-029: Postgres migration 001 — users, devices (hashed tokens), pairing_codes](../tasks/TASK-029-portal-pg-migration-001.md)
- [ ] [TASK-030: Google OIDC sign-in, JWT session cookie, email allowlist, /api/me](../tasks/TASK-030-portal-google-oidc-session-allowlist.md)
- [ ] [TASK-028: Dockerfile.portal + deploy/do-app.yaml](../tasks/TASK-028-portal-dockerfile-do-app-deploy.md) — live DO deploy + Google OAuth client are deferred manual steps

## Phase 3: Pairing & devices

- [ ] [TASK-031: Portal pairing-code creation API + rate-limited /pair/redeem (hashed, single-use, 10-min expiry)](../tasks/TASK-031-portal-pairing-code-api-redeem.md)
- [ ] [TASK-032: daemon/pair.ts + daemon/credentials.ts; conductor pair / conductor unpair CLI](../tasks/TASK-032-daemon-pair-credentials-cli.md)
- [ ] [TASK-033: Portal Devices API: list with connected flag, rename, revoke (ownership-404 semantics, revoke closes live connection)](../tasks/TASK-033-portal-devices-api.md)

## Phase 4: Relay

- [x] [TASK-034: shared/relay-protocol.ts frame contract (req/res/body chunks/cancel/err, correlation ids)](../tasks/TASK-034-shared-relay-protocol-ts.md) <!-- completed 2026-06-13 -->
- [ ] [TASK-035: Portal WS endpoint, user-first connection registry, and mux (request lifecycle, fail-all-pending on drop, in-flight caps, timeouts)](../tasks/TASK-035-portal-ws-relay-endpoint-registry-mux.md)
- [ ] daemon/connector.ts: outbound WSS with reconnect/backoff, path-allowlisted proxying to backend :8788 and the daemon Unix socket
- [ ] Plain JSON request/response relay working end-to-end (/api/status in a browser via /relay/:deviceId)
- [ ] Streaming: SSE pass-through, image-upload request bodies, cancel/backpressure — validated through the DO edge

## Phase 5: Frontend & hardening

- [ ] frontend runtime.ts mode detection (local vs relay) + API_BASE rewire
- [ ] Landing (sign-in / request-access), DevicePicker (pairing-code panel, revoke), Onboarding (install instructions for users with no device)
- [ ] Security checklist pass (plan §Security checklist) + structured logs + device last-seen heartbeat
- [ ] README install one-liner + docs updates (CLAUDE.md, scripts/README)

## Prior Art

- **[ROADMAP-005](ROADMAP-005-ngrok-tunnel-daemon.md)** (tunnel): A chisel/frp reverse-tunnel approach was the previous design for remote dashboard access — a separately-hosted tunnel server with a client daemon on the conductor host. Superseded by the outbound WSS relay here: no inbound ports on user machines, no separately-provisioned tunnel server, auth handled by the portal rather than tunnel-level SSH keys. The chisel research notes in ROADMAP-005 remain useful context.
- **[ROADMAP-006](ROADMAP-006-deploy-do-app-platform-oauth-proxy.md)** (oauth-proxy deploy): An oauth2-proxy sidecar + DO App Platform deploy was the previous auth/deploy plan. Superseded by the first-party Google OIDC flow in Phase 2 of this roadmap. The Phase 1 bootstrap artefacts it generated (`Dockerfile.prod`, `docker-compose.yml`, `.github/workflows/build.yml + security.yml`) are still in the repo and remain useful scaffolding for Phase 2 deployment here.

## Notes
