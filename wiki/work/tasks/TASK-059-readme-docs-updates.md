---
id: TASK-059
title: "README install one-liner + docs updates (CLAUDE.md, scripts/README, .env.example)"
status: todo
created: 2026-06-14
updated: 2026-06-14
depends_on: [TASK-058]
blocks: []
parallel_safe_with: []
uat: ""
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

### 1. Read current docs + env  <!-- agent: general-purpose -->

- [ ] Read `README.md`, `CLAUDE.md`, `scripts/README.md`, and `.env.example`.
- [ ] Note current architecture wording and which envs are already documented vs introduced in TASK-055/056/058.

### 2. Update the README  <!-- agent: general-purpose -->

- [ ] Add the `curl | bash` install one-liner.
- [ ] Document the onboarding flow: invite-code signup (TASK-049) → install → `conductor pair <code>` (TASK-031/057).

### 3. Update CLAUDE.md + scripts/README  <!-- agent: general-purpose -->

- [ ] Update the architecture sections for the `host-server` / `app/{api,frontend}` layout.
- [ ] Describe the relay data path (browser → app/api → WSS → daemon → host-server) and invite-code signup gating.

### 4. Update .env.example  <!-- agent: general-purpose -->

- [ ] Add/confirm `BOOTSTRAP_ADMIN_EMAIL` and any `VITE_MODE` / relay vars, each with a brief comment.

### 5. Verify links  <!-- agent: general-purpose -->

- [ ] Verify internal markdown links in the edited docs resolve.

## Acceptance Criteria

- [ ] README has a working `curl | bash` install one-liner and the invite-code + pairing onboarding flow.
- [ ] CLAUDE.md and scripts/README describe the current `host-server` / `app/{api,frontend}` architecture and the relay data path.
- [ ] `.env.example` documents all new envs (`BOOTSTRAP_ADMIN_EMAIL`, `VITE_MODE`/relay vars) completely.
- [ ] Internal links in the edited docs resolve.

## Dependencies

- **DEPENDS ON [TASK-058](TASK-058-security-hardening-logs-heartbeat.md)** — docs reflect the hardened relay + onboarding behavior finalized in Phase 5.

### Roadmap

Implements ROADMAP-002 Phase 5, item "README install one-liner + docs updates" — `wiki/work/roadmaps/ROADMAP-002-hosted-portal-oauth-relay-installer.md`.
