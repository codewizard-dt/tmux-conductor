---
id: TASK-059
title: "README install one-liner + docs updates (CLAUDE.md, scripts/README, .env.example)"
status: done
created: 2026-06-14
updated: 2026-06-14
depends_on: [TASK-058]
blocks: []
parallel_safe_with: []
uat: "[[UAT-059]]"
tags: [docs, readme, roadmap-002]
---

# TASK-059 — README install one-liner + docs updates (CLAUDE.md, scripts/README, .env.example)

## Objective

Add the README install one-liner and update the docs (CLAUDE.md, scripts/README, .env.example) to reflect the `host-server` / `app/{api,frontend}` split, the relay data path, and invite-code onboarding. This is the documentation close-out of ROADMAP-002 Phase 5: a new user should be able to read the README, run a single install command, and pair a daemon using an invite code.

## Approach

- **README**: add the `curl | bash` install one-liner and document the full first-run onboarding flow — invite-code signup gate (TASK-049), install, then `conductor pair <code>` pairing (TASK-031/057).
- **CLAUDE.md + scripts/README**: update the architecture descriptions for the `host-server` / `app/{api,frontend}` layout, the relay data path (browser → app/api → WSS → daemon → host-server), and invite-code signup gating.
- **.env.example**: ensure all new envs are documented (e.g. `BOOTSTRAP_ADMIN_EMAIL`, any `VITE_MODE` / relay vars introduced by TASK-055/056).

Keep edits accurate to the as-built code; verify internal links resolve.

## Steps

### 1. Read current docs + env  <!-- agent: general-purpose --> <!-- Completed: 2026-06-14 -->

- [x] Read `README.md`, `CLAUDE.md`, `scripts/README.md`, and `.env.example`. <!-- Completed: 2026-06-14 -->
- [x] Note current architecture wording and which envs are already documented vs introduced in TASK-055/056/058. <!-- Completed: 2026-06-14 -->

<!-- Findings (2026-06-14):
  - Repo owner confirmed via git remote: codewizard-dt. Install one-liner finalized:
    curl -fsSL https://raw.githubusercontent.com/codewizard-dt/tmux-conductor/main/install.sh | bash
  - README.md + scripts/README.md are stale (Docker/Astro/daemon era); CLAUDE.md is the accurate reference.
  - SCOPE NOTE: conductor pair/unpair CLI, device.json, install.sh, and the daemon relay
    connector do NOT exist in the repo yet. The SERVER half exists (app/api routes/pair.ts,
    routes/relay.ts, routes/devices.ts, routes/invite-codes.ts). Docs describe the as-built
    server flow and finalize the install URL; the client CLI/connector is flagged as planned.
  - Code-only undocumented vars to surface in .env.example: VITE_API_URL, AUTH_PROXY_TARGET.
-->


### 2. Update the README  <!-- agent: general-purpose --> <!-- Completed: 2026-06-14 -->

- [x] Add the `curl | bash` install one-liner. <!-- Completed: 2026-06-14 -->
- [x] Document the onboarding flow: invite-code signup (TASK-049) → install → `conductor pair <code>` (TASK-031/057). <!-- Completed: 2026-06-14 -->
<!-- Also de-staled README (host-server/app/{api,frontend} layout, relay path, App Platform deploy). Client pairing CLI marked planned. -->


### 3. Update CLAUDE.md + scripts/README  <!-- agent: general-purpose --> <!-- Completed: 2026-06-14 -->

- [x] Update the architecture sections for the `host-server` / `app/{api,frontend}` layout. <!-- Completed: 2026-06-14 -->
- [x] Describe the relay data path (browser → app/api → WSS → daemon → host-server) and invite-code signup gating. <!-- Completed: 2026-06-14 -->
<!-- CLAUDE.md: new "Relay data path & onboarding" subsection (relay path, invite-code gating, dual-source admin gotcha, tsx-watch caveat, Vite /api/* split). scripts/README.md: de-staled backend->host-server, Astro->Vite, fixed broken .docs link. -->


### 4. Update .env.example  <!-- agent: general-purpose --> <!-- Completed: 2026-06-14 -->

- [x] Add/confirm `BOOTSTRAP_ADMIN_EMAIL` and any `VITE_MODE` / relay vars, each with a brief comment. <!-- Completed: 2026-06-14 -->
<!-- Documented all current vars grouped (host-server/app/api/app/frontend/deploy), incl. code-only VITE_API_URL + AUTH_PROXY_TARGET. Dual-source admin-email note + tsx-watch no-reload caveat added. No real secrets. -->


### 5. Verify links  <!-- agent: general-purpose --> <!-- Completed: 2026-06-14 -->

- [x] Verify internal markdown links in the edited docs resolve. <!-- Completed: 2026-06-14 — all 18 internal links across README/CLAUDE/scripts-README resolve; 0 broken. -->


## Acceptance Criteria

- [x] README has a working `curl | bash` install one-liner and the invite-code + pairing onboarding flow. <!-- Completed: 2026-06-14 -->
- [x] CLAUDE.md and scripts/README describe the current `host-server` / `app/{api,frontend}` architecture and the relay data path. <!-- Completed: 2026-06-14 -->
- [x] `.env.example` documents all new envs (`BOOTSTRAP_ADMIN_EMAIL`, `VITE_MODE`/relay vars) completely. <!-- Completed: 2026-06-14 -->
- [x] Internal links in the edited docs resolve. <!-- Completed: 2026-06-14 -->

## Dependencies

- **DEPENDS ON [TASK-058](TASK-058-security-hardening-logs-heartbeat.md)** — docs reflect the hardened relay + onboarding behavior finalized in Phase 5.

### Roadmap

Implements ROADMAP-002 Phase 5, item "README install one-liner + docs updates" — `wiki/work/roadmaps/ROADMAP-002-hosted-portal-oauth-relay-installer.md`.
