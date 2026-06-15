---
id: TASK-058
title: "Security checklist pass + structured logs + device last-seen heartbeat"
status: todo
created: 2026-06-14
updated: 2026-06-14
depends_on: [TASK-054, TASK-057]
blocks: []
parallel_safe_with: []
uat: ""
tags: [security, hardening, logging, heartbeat, roadmap-002]
---

# TASK-058 — Security checklist pass + structured logs + device last-seen heartbeat

## Objective

Complete a Security checklist pass across `app/api` + the daemon, add structured request/relay logging, and add a device last-seen heartbeat that drives the DevicePicker connected flag. This hardens the hosted relay trust boundary: the host-server is loopback no-auth, so the relay + better-auth session are the only trust boundary — every gap there is exploitable.

## Approach

Walk the security checklist from the plan (`~/.claude/plans/the-time-has-come-peppy-cupcake.md` §Security checklist), auditing each item against the implemented code, citing gaps, then implementing fixes. Checklist items:

- **Token hashing**: device + pairing tokens hashed SHA-256 at rest; the raw token shown once and never stored or logged.
- **Pairing**: single-use atomic claim; rate-limited; ≤5 outstanding codes per user; uniform error responses (no oracle on validity/expiry).
- **Ownership**: ownership checks return **404 not 403**; no cross-user enumeration of device/code IDs.
- **Revoke**: sets `revoked_at`; closes the relay WS with code **4001**; the daemon stops on revoke.
- **Cookies**: session cookie `HttpOnly` + `Secure` + `SameSite=Lax`; **Origin check** on all mutating requests.
- **Relay header safelist**: both directions; never forward `cookie` or `authorization` to/from the host-server.
- **Daemon path allowlist**: daemon only proxies allowlisted host-server paths.
- **Caps**: 26MB request body cap; 64 in-flight cap; 30s head timeout; mux cleanup on disconnect.
- **email_verified**: gate access on verified email where the plan requires it.

**Structured logging**: emit structured logs across the `app/api` request lifecycle and the relay (request id/correlation id, device id, user id where safe, status, duration) — never log raw tokens, cookies, or authorization headers.

**Last-seen heartbeat**: update `devices.last_seen_at` on relay WS activity (connect + traffic/ping), and use recency of `last_seen_at` (plus active registry membership) to compute the `connected` flag surfaced in DevicePicker (TASK-057).

## Steps

### 1. Audit the checklist against the code  <!-- agent: general-purpose --> <!-- Completed: 2026-06-14 -->

- [x] Read the plan §Security checklist (`~/.claude/plans/the-time-has-come-peppy-cupcake.md`). <!-- Completed: 2026-06-14 -->
- [x] For each checklist item, locate the implementing code in `app/api` (and the daemon, TASK-052/054) using Serena and note **verified** or **gap** with a file:line citation. <!-- Completed: 2026-06-14 -->
- [x] Produce a per-item audit note (in the task/PR description) before changing code. <!-- Completed: 2026-06-14 -->

#### Audit findings (2026-06-14)

> Correction: actual `app/api` port is **8080** (`app/api/env.ts:27`), not 8090. The relay uses **standard WS close codes** (1000/1001/1008/1011) today — no 4001/4002 constants exist. The daemon lives at repo-root `daemon/connector.ts`.

1. **Token hashing — VERIFIED.** Pairing codes + device tokens SHA-256 at rest, raw shown once, never logged (`app/api/routes/pair.ts:95-176`, `app/api/lib/crypto.ts:63-65`, verify at `app/api/routes/relay.ts:38-45`).
2. **Pairing — PARTIAL.** Atomic single-use claim VERIFIED (`pair.ts:135-176`); ≤5 outstanding VERIFIED (`pair.ts:79-92`); uniform errors VERIFIED (`pair.ts:131,158`). **GAP: no rate limiting** on `POST /api/pair/redeem` (no `@fastify/rate-limit` installed).
3. **Ownership 404 — VERIFIED** (`devices.ts:135-145,162-175`; relay mismatch closes 1008 `relay.ts:108-114`).
4. **Revoke — PARTIAL.** Sets `revoked_at` + closes WS (`devices.ts:166-178`) but with code **1000 not 4001** (`registry.ts:116`); **GAP: daemon reconnects forever** on any close code (`daemon/connector.ts:163-195`).
5. **Cookies + Origin — GAP.** No explicit cookie attrs (relies on better-auth defaults, `auth.ts:23-38`); **no Origin/Sec-Fetch-Site check** on custom mutating routes.
6. **Relay header safelist — GAP both directions.** mux denylist omits `cookie`/`authorization` (`mux.ts:27-30,79-85,193-198`); daemon `sanitizeHeaders` strips only host/connection/content-length (`connector.ts:536-561`).
7. **Daemon path allowlist — VERIFIED** (`connector.ts:62-72,271-277`).
8. **Caps — GAP.** No 26MB bodyLimit (Fastify default 1MB, `index.ts:17`); in-flight cap is **20 not 64** (`mux.ts:23`); 30s timer is idle/rearmed not hard time-to-head (`mux.ts:24,152-155`); mux cleanup-on-disconnect VERIFIED (`relay.ts:164-172`, `mux.ts:157-257`).
9. **email_verified — GAP.** No `requireEmailVerification`, no verified-email gate anywhere (`auth.ts:35-37`).
10. **Structured logging — PARTIAL.** `logger: true` gives request ids but no relay device/user/status/duration line; no pino `redact`; `relay.ts:124` logs the full parsed frame (can carry base64 body/headers).
11. **last_seen_at heartbeat — GAP.** Column exists (`002_pairing_devices.sql:17`), only ever read (`devices.ts`), never UPDATEd; no registry/relay heartbeat.

Deferred (operational/deploy-only, cannot be done locally): live TLS termination (DO edge), `Secure` cookie enforcement depends on prod https `PUBLIC_BASE_URL`, DO App Platform LB idle-timeout/WS keepalive tuning, Google OAuth redirect URI registration.

### 2. Implement token + pairing hardening  <!-- agent: general-purpose --> <!-- Completed: 2026-06-14 -->

- [x] Ensure device + pairing tokens are SHA-256 hashed at rest and the raw value is shown once (never persisted/logged). <!-- Verified already-holding, no change -->
- [x] Make pairing claim single-use atomic, rate-limited, ≤5 outstanding per user, with uniform error responses. <!-- Added @fastify/rate-limit@^10; POST /api/pair/redeem = 10/min/IP, generic 429 -->

> Done: added `@fastify/rate-limit@^10.3.0`, registered `{ global: false }` in `index.ts`, per-route `config.rateLimit` (max 10/1min, `errorResponseBuilder` → `{error:'too_many_requests'}`) on `POST /api/pair/redeem`. Atomic claim/≤5/uniform-errors/hashing already in place. `tsc --noEmit` clean.

### 3. Implement ownership + revoke hardening  <!-- agent: general-purpose -->

- [ ] Convert ownership failures to 404 (not 403); remove any cross-user enumeration.
- [ ] Ensure revoke sets `revoked_at`, closes the relay WS with 4001, and causes the daemon to stop.

### 4. Implement transport hardening  <!-- agent: general-purpose -->

- [ ] Enforce cookie attributes (HttpOnly/Secure/SameSite=Lax) and an Origin check on mutating requests.
- [ ] Apply the relay header safelist in both directions (never forward cookie/authorization).
- [ ] Enforce the daemon path allowlist.
- [ ] Enforce caps: 26MB body, 64 in-flight, 30s head timeout, mux cleanup on disconnect.
- [ ] Gate on `email_verified` where required.

### 5. Add structured logging  <!-- agent: general-purpose -->

- [ ] Add structured logs across the `app/api` request lifecycle and the relay (ids, status, duration), redacting tokens/cookies/authorization.

### 6. Add device last-seen heartbeat  <!-- agent: general-purpose -->

- [ ] Update `devices.last_seen_at` on relay WS connect + activity.
- [ ] Compute the DevicePicker `connected` flag from registry membership + `last_seen_at` recency.

### 7. Typecheck  <!-- agent: general-purpose -->

- [ ] Run `npx tsc --noEmit` in `app/api/` (and the daemon package if touched) — zero errors.

## Acceptance Criteria

- [ ] Every checklist item is verified or fixed, each with a per-item note (file:line citation).
- [ ] Tokens are SHA-256 at rest, shown once, never logged; pairing is single-use/atomic/rate-limited/≤5-outstanding with uniform errors.
- [ ] Ownership failures return 404 with no cross-user enumeration; revoke closes the WS with 4001 and stops the daemon.
- [ ] Cookies are HttpOnly/Secure/Lax with Origin checks on mutations; relay header safelist holds both directions; daemon path allowlist enforced; caps (26MB / 64 in-flight / 30s head timeout / mux cleanup) enforced; `email_verified` gating applied.
- [ ] Structured logs are emitted across the `app/api` request lifecycle and relay, with tokens/cookies/authorization redacted.
- [ ] `devices.last_seen_at` updates on relay activity and drives the connected flag.
- [ ] `npx tsc --noEmit` passes cleanly.

## Dependencies

- **DEPENDS ON [TASK-054](TASK-054-relay-streaming.md)** — relay streaming/mux through which the caps, header safelist, and heartbeat activity are enforced.
- **DEPENDS ON [TASK-057](TASK-057-device-picker-onboarding-ui.md)** — DevicePicker surfaces the connected flag this heartbeat drives.

### Roadmap

Implements ROADMAP-002 Phase 5, item "Security checklist pass + structured logs + device last-seen heartbeat" — `wiki/work/roadmaps/ROADMAP-002-hosted-portal-oauth-relay-installer.md`.
