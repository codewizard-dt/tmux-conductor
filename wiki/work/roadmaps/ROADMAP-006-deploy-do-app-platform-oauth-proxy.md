---
id: ROADMAP-006
title: Deploy Dashboard to DO App Platform with oauth2-proxy
status: done
created: 2026-06-06
updated: 2026-06-13
owner: David Taylor
linked_requirements: []
linked_decisions: []
tags: [infra, auth, deploy]
---

# Roadmap 006: Deploy Dashboard to DO App Platform with oauth2-proxy

> Deploy the tmux-conductor dashboard to DigitalOcean App Platform, accessible only to a configured list of authorized Google accounts via an oauth2-proxy sidecar.

## Superseded

The oauth2-proxy sidecar approach was superseded **twice**: first by a first-party Google OIDC implementation, then by **better-auth** (email/password + optional Google) as part of the 2026-06-13 `simplify-architecture` work. Authentication now lives in `app/api` (the renamed/merged portal) mounted at `/api/auth/*`, on managed Postgres — no sidecar, no hand-rolled OIDC. See [ROADMAP-002](ROADMAP-002-hosted-portal-oauth-relay-installer.md) Phase 2.

**The deploy model also changed.** This roadmap assumed a GHCR pre-built image deployed to App Platform with an oauth2-proxy sidecar, automated by `.github/workflows/build.yml`. That is no longer the approach:

- **Deleted** in `simplify-architecture`: `Dockerfile.prod`, `docker-compose.yml`, `docker-compose.build.yml`, `.github/workflows/build.yml`, `.github/workflows/base-image.yml`. The Phase 1 bootstrap artefacts this roadmap created **no longer exist** — they are NOT useful scaffolding anymore.
- **Current deploy:** App Platform **native build** (push-to-deploy) via `deploy/app.yaml` — no GHCR/DOCR image, no self-hosted runner. The `host-server` (conductor API, formerly `backend/`) is **never** deployed to App Platform; it runs natively on a VPS via `make deploy` + systemd (`deploy/host-server.service`).
- **Surviving CI:** `.github/workflows/security.yml` (CodeQL + gitleaks) and the new `.github/workflows/ci.yml` (typecheck + lint).

This roadmap is retained for historical context only; all of its remaining `[ ]` items are obsolete.

## Goal

The dashboard Fastify server is running on DO App Platform behind Google OAuth. Only email addresses on the authorized list can log in. Deployment is automated via GitHub Actions on push to main. Secrets (OAuth client secret, cookie secret) are stored as encrypted env vars in the DO app spec.

## Phase 1: Foundation

> Containerization and CI scaffolding — completed by `npx bootstrap deployment .`.

- [x] Run `npx bootstrap deployment .` — scaffolds Dockerfile.prod, docker-compose.yml, .github/workflows/build.yml + security.yml, Makefile

## Phase 2: Auth

> Wire Google OAuth via oauth2-proxy so only authorized emails can reach the dashboard.

- [ ] Create Google OAuth2 credentials — register OAuth app in Google Cloud Console, get client ID + secret, set authorized redirect URI to the DO App Platform URL
- [ ] Add oauth2-proxy to docker-compose.yml as a sidecar service with `--email-domain=*` and `OAUTH2_PROXY_AUTHENTICATED_EMAILS_FILE` (or inline env var) pointing at the allowed emails list
- [ ] Define authorized emails list — env var or config file committed to repo
- [ ] Local smoke test — `make dev` stack with oauth2-proxy; verify only allowed email passes

## Phase 3: Deploy

> Publish to DO App Platform using the app spec and encrypted secrets.

- [ ] Write `.do/app.yaml` — service from GHCR image, HTTP port 8788, health check `/healthz`, encrypted env vars for `OAUTH2_PROXY_CLIENT_ID`, `OAUTH2_PROXY_CLIENT_SECRET`, `OAUTH2_PROXY_COOKIE_SECRET`
- [ ] Create app on DO App Platform — `doctl apps create --spec .do/app.yaml` or via control panel; first deploy from GHCR image
- [ ] Set encrypted secrets in DO App Platform (`type: SECRET`) for all OAuth env vars
- [ ] Configure custom domain and update Google OAuth redirect URI (optional)

## Phase 4: Validate

> Confirm the deployed app is gated correctly end-to-end.

- [ ] Smoke test: open deployed URL, confirm redirect to Google OAuth consent screen
- [ ] Smoke test: log in with authorized email, confirm dashboard loads
- [ ] Smoke test: log in with unauthorized email, confirm 403/sign-out page
- [ ] Update docs — CLAUDE.md or README with how to add an email to the allowed list, rotate the cookie secret, and redeploy

## Notes

Phase 1 was pre-checked — bootstrap ran before this roadmap was created. Its artefacts (Dockerfile.prod, docker-compose.yml, .github/workflows/build.yml) were **deleted** in the 2026-06-13 `simplify-architecture` cleanup; see the Superseded section. Deployment now uses `deploy/app.yaml` (App Platform native build).
oauth2-proxy approach was chosen over in-app auth middleware: battle-tested, no Fastify code changes needed. Superseded before Phase 2 work began — ultimately replaced by in-app **better-auth**, the opposite of the original rationale.

## Migration Note

Migrated 2026-06-12 from `.docs/roadmaps/003-deploy-do-app-platform-oauth.md` (pre-wiki, was marked `active`). Phase 1 item remains `[x]` — the bootstrap artefacts are real and in the repo. Remaining items stay `[ ]` to reflect that no further work was done before supersession.
