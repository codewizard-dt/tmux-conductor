---
id: ROADMAP-002
title: Hosted portal with Google OAuth, device relay, and installer
status: active
created: 2026-06-12
updated: 2026-06-12
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

- [ ] Complete ROADMAP-001 Phase 1 (SQLite foundation) — prerequisite, tracked in [ROADMAP-001](ROADMAP-001-sqlite-data-layer-projects-schedules.md)
- [ ] Parameterize com.tmux-conductor.daemon.plist (log path, node path) and add a systemd user-unit template
- [ ] Sync `bin/conductor daemon install` to the rendered-template + bootout/bootstrap flow
- [ ] Write install.sh (bash-3.2-safe, idempotent: prereq checks, clone/update, npm installs, db:migrate, hooks, daemon service, pairing step)
- [ ] Verify the installer end-to-end into a scratch CONDUCTOR_HOME on macOS

## Phase 2: Portal foundation

- [ ] Scaffold portal/ (Fastify, env validation, pg Pool, boot-time migrations) with /healthz
- [ ] Postgres migration 001: users, devices (hashed tokens), pairing_codes
- [ ] Google OIDC sign-in, JWT session cookie, email allowlist, /api/me
- [ ] Dockerfile.portal + deploy/do-app.yaml; deploy the skeleton to DO App Platform (manual: Google OAuth client + redirect URI)

## Phase 3: Pairing & devices

- [ ] Pairing-code creation API + rate-limited /pair/redeem (hashed, single-use, 10-min expiry)
- [ ] daemon/pair.ts + daemon/credentials.ts; `conductor pair` / `conductor unpair` CLI
- [ ] Devices API: list with connected flag, rename, revoke (ownership-404 semantics, revoke closes live connection)

## Phase 4: Relay

- [ ] shared/relay-protocol.ts frame contract (req/res/body chunks/cancel/err, correlation ids)
- [ ] Portal WS endpoint, user-first connection registry, and mux (request lifecycle, fail-all-pending on drop, in-flight caps, timeouts)
- [ ] daemon/connector.ts: outbound WSS with reconnect/backoff, path-allowlisted proxying to backend :8788 and the daemon Unix socket
- [ ] Plain JSON request/response relay working end-to-end (/api/status in a browser via /relay/:deviceId)
- [ ] Streaming: SSE pass-through, image-upload request bodies, cancel/backpressure — validated through the DO edge

## Phase 5: Frontend & hardening

- [ ] frontend runtime.ts mode detection (local vs relay) + API_BASE rewire
- [ ] Landing (sign-in / request-access), DevicePicker (pairing-code panel, revoke), Onboarding (install instructions for users with no device)
- [ ] Security checklist pass (plan §Security checklist) + structured logs + device last-seen heartbeat
- [ ] README install one-liner + docs updates (CLAUDE.md, scripts/README)

## Notes
