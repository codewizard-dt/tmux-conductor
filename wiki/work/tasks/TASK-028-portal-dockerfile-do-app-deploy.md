---
id: TASK-028
title: "Dockerfile.portal + deploy/do-app.yaml (DO App Platform spec); document the manual DO deploy + Google OAuth client setup"
status: todo
created: 2026-06-12
updated: 2026-06-12
depends_on: [TASK-027]
blocks: []
parallel_safe_with: []
uat: ""
tags: [portal, deploy, docker, digitalocean, oauth, roadmap-002]
---

<!--
NOTE: Requested as TASK-026 with slug portal-dockerfile-do-app-deploy and dependency TASK-023.
At write time the live tree showed TASK-023/024/025/026/027 already taken by concurrently-created
agents (ROADMAP-001 Phase 5 cutover series + the renumbered portal scaffold). Per the task-add
re-verify-number rule, this task was bumped to the next free number TASK-028. The intended
dependency — "Scaffold portal/ … with /healthz" — landed as TASK-027 (itself a renumber of the
originally-requested TASK-023), so depends_on points at TASK-027, the actual portal-scaffold task.
-->

# TASK-028 — Dockerfile.portal + deploy/do-app.yaml (DO App Platform spec); document the manual DO deploy + Google OAuth client setup

## Objective

Author the two deployment artefacts that let the portal skeleton run on DigitalOcean App Platform: a multi-stage `Dockerfile.portal` at the repo root (building the relay-mode frontend and packaging the portal server) and a `deploy/do-app.yaml` App Platform spec (one single-instance `portal` service, a dev Postgres DB, the required env/secret wiring, a Dockerfile-based build, and a `/healthz` health check). This task writes **only the files** — the actual `doctl apps create --spec deploy/do-app.yaml` deploy and the Google Cloud OAuth client + redirect-URI creation are **manual cloud/human actions** documented as explicit, deferred Acceptance Criteria; this run must not call `doctl` or create any cloud resources. A short `deploy/README.md` capturing the manual steps is part of the deliverable.

This is ROADMAP-002 Phase 2's deployment item — `wiki/work/roadmaps/ROADMAP-002-hosted-portal-oauth-relay-installer.md` (Phase 2, line 34: "Dockerfile.portal + deploy/do-app.yaml; deploy the skeleton to DO App Platform (manual: Google OAuth client + redirect URI)").

## Approach

### Authoritative design source

Implementation plan, Workstream F "DO deployment": `/Users/davidtaylor/.claude/plans/the-time-has-come-peppy-cupcake.md` (referenced from ROADMAP-002, line 19). The structure below is the contract.

### Hard constraints (verified against the current tree)

- **`Dockerfile.prod` already exists at the repo root and MUST be left UNTOUCHED.** It is Phase-1 scaffolding from the superseded ROADMAP-006 (see ROADMAP-002 line 60) and is unrelated to the portal image. Create a NEW `Dockerfile.portal`; do not edit, rename, or delete `Dockerfile.prod`.
- **`portal/` is created by [TASK-027](TASK-027-scaffold-portal-foundation.md)** (Phase 2 line 31: "Scaffold portal/ (Fastify, env validation, pg Pool, boot-time migrations) with /healthz"). This task containerizes that scaffold, so it **depends on TASK-027**. If `portal/` is absent when this task runs, the Dockerfile's `COPY portal/ …` lines are still authored correctly (they reference the eventual layout), but the image build cannot succeed until TASK-027 lands — surface that as a dependency note rather than inventing `portal/` contents here.
- **`shared/` (relay-protocol)** is created in Phase 4 (line 44). A `COPY shared/ …` of a not-yet-existing dir fails the build — so copy `shared/` only if the portal genuinely needs it at this phase; if not, omit its COPY and leave a `# TODO (Phase 4): COPY shared/ once relay-protocol lands` comment. Decide based on what TASK-027 actually produces.
- **Frontend relay-mode build flag is `PUBLIC_PORTAL_MODE=1`.** The frontend is an Astro+React app under `frontend/` (per CLAUDE.md). The build stage runs the frontend's build with `PUBLIC_PORTAL_MODE=1` set so it emits relay-mode assets, producing `frontend/dist`. (The `runtime.ts` mode detection that consumes this flag is Phase 5 line 52 — this task only needs the build to accept the env var; if the frontend build does not yet read `PUBLIC_PORTAL_MODE`, the flag is harmless and the assets still build.)
- **Portal serves its UI from `ui/dist` via `@fastify/static` with SPA fallback.** That route is implemented in a **later task** (not this one). The Docker image's only responsibility here is to place the built frontend assets at `portal/ui/dist` inside the image so the eventual static route has files to serve.
- **pg Pool SSL note (from TASK-027 `portal/db.ts`):** DO's dev Postgres uses a self-signed CA, so the Pool is configured with `ssl: { rejectUnauthorized: false }`. This is already handled in the portal scaffold (TASK-027) — this task does NOT re-implement DB code. Record in `deploy/README.md` that production promotion should switch to a pinned `CA_CERT` (DO exposes the cluster CA) instead of `rejectUnauthorized: false`, and note the `CA_CERT` env/path for that future hardening.
- **Single-instance constraint (CRITICAL).** The relay connection registry is **in-memory** (Phase 4, line 45: "user-first connection registry"). Horizontal scaling would split that registry across instances and break relay routing. `deploy/do-app.yaml` MUST set `instance_count: 1` with an explicit comment that scaling out requires future pub/sub work before it is safe.
- **Temp/scratch (host rule):** any scratch needed for dry validation goes under `./tmp/` — never `/tmp`, `$TMPDIR`, or `mktemp -d`.
- **No `sed`/`awk`/`echo >>` to author the markdown/config files.** Use Write/Edit for `Dockerfile.portal`, `deploy/do-app.yaml`, and `deploy/README.md` (they are config/markdown). Use Serena for all exploration.

### SCOPE BOUNDARY — what this task does NOT do

- It does **NOT** run `doctl apps create`, `doctl apps update`, or any `doctl`/DigitalOcean API call. No app is created on App Platform by this run.
- It does **NOT** create the Google Cloud OAuth client, consent screen, or redirect URI. Those live in Google Cloud Console.
- It does **NOT** populate the SECRET env values (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`) — the spec declares them as secrets with placeholder/empty values to be filled at deploy time.

These deferred actions are captured verbatim in the Acceptance Criteria below, each flagged **deferred: requires DigitalOcean account + Google Cloud Console**.

## Steps

### 1. Confirm the TASK-027 portal layout (dependency probe)  <!-- agent: general-purpose -->

- [ ] Use Serena `list_dir` on `portal/` (repo root) to see whether TASK-027 has produced the scaffold yet.
  - If present: note the entry point file (e.g. `portal/index.ts`), the `package.json` location (`portal/package.json`), and whether `portal/db.ts` exists with the `ssl: { rejectUnauthorized: false }` Pool config.
  - If absent: proceed to author the Dockerfile/spec against the **documented** TASK-027 layout (Fastify server, `portal/package.json`, `portal/db.ts`, boot-time migrations, `/healthz` route) and record that the image cannot build until TASK-027 lands.
- [ ] Use Serena `find_file` for `Dockerfile.prod` at the repo root to confirm it exists and note its multi-stage shape (reference only — do NOT modify it).
- [ ] Use Serena `list_dir` on `frontend/` to confirm the Astro+React app and its `package.json` build script; note the build command (`npm run build`) and output dir (`dist`).

### 2. Author `Dockerfile.portal` (repo root)  <!-- agent: general-purpose -->

- [ ] Create a NEW file `Dockerfile.portal` at the repo root (leave `Dockerfile.prod` untouched).
- [ ] **Stage 1 — frontend build** (`AS frontend-build`):
  - Base on a Node image matching the frontend engine floor (`node:22-alpine` is fine; frontend declares `node >=22.12.0`).
  - `WORKDIR /app/frontend`; copy `frontend/package.json` (+ lockfile if present) and `npm ci`; then copy the rest of `frontend/`.
  - Set `ENV PUBLIC_PORTAL_MODE=1` (so the build emits relay-mode assets) and run `npm run build` → produces `/app/frontend/dist`.
- [ ] **Final stage** — `FROM node:22-alpine`:
  - `WORKDIR /app/portal`.
  - Copy `portal/package.json` (+ lockfile) and run `npm ci --omit=dev` for portal deps. (If the portal runs TypeScript directly via `tsx`, ensure `tsx` is a non-dev dependency OR adjust the CMD to a built entry — decide based on TASK-027's `package.json`; see CMD step.)
  - Copy the rest of `portal/` into `/app/portal`.
  - Copy `shared/` into the image **only if** the portal at this phase imports it (Phase 4 artefact). If not yet needed, omit and leave a `# TODO (Phase 4): COPY shared/ once relay-protocol lands` comment so a not-yet-existing dir does not break the build.
  - Copy the built frontend from stage 1 into `portal/ui/dist`: `COPY --from=frontend-build /app/frontend/dist ./ui/dist`.
  - `ENV PORT=8080` and `EXPOSE 8080` (DO App Platform routes to the container's `PORT`; 8080 matches the spec).
  - `CMD`: run the portal. If TASK-027 ships a TS entry run via tsx, use `CMD ["node", "--import", "tsx/esm", "index.ts"]` (with `tsx` present as a runtime dep); if it ships a built JS entry (e.g. `dist/index.js`), use `CMD ["node", "dist/index.js"]`. Pick the form that matches `portal/package.json` from Step 1; if `portal/` is absent, default to the `tsx/esm` form and add a comment to revisit once TASK-027 is final.
- [ ] Add a top-of-file comment noting: serves `ui/dist` via `@fastify/static` SPA fallback (route implemented in a later task — image only stages the assets), and that this image is distinct from `Dockerfile.prod`.

### 3. Author `deploy/do-app.yaml` (App Platform spec)  <!-- agent: general-purpose -->

- [ ] Create `deploy/` and `deploy/do-app.yaml`.
- [ ] Top-level: `name: tmux-conductor-portal` (or similar), `region` (e.g. `nyc`).
- [ ] **One service `portal`:**
  - `instance_count: 1` with an explicit inline comment: `# IMPORTANT: relay connection registry is IN-MEMORY — scaling out requires future pub/sub work; MUST stay single-instance for now.`
  - `instance_size_slug` (e.g. `basic-xxs` / `apps-s-1vcpu-0.5gb` — pick a small dev tier).
  - `dockerfile_path: Dockerfile.portal` and `source_dir: /` (Dockerfile-based build pointing at the new Dockerfile; NOT a buildpack).
  - `http_port: 8080`.
  - `health_check:` with `http_path: /healthz`.
- [ ] **Dev Postgres database:** a `databases:` entry with `engine: PG`, `production: false` (DO dev DB, self-signed CA), a stable `name` (e.g. `db`).
- [ ] **Service envs** (under the `portal` service's `envs:`):
  - `GOOGLE_CLIENT_ID` — `type: SECRET` (value left empty/placeholder; filled at deploy time).
  - `GOOGLE_CLIENT_SECRET` — `type: SECRET`.
  - `SESSION_SECRET` — `type: SECRET` (must be ≥32 bytes; note this in a comment).
  - `ALLOWLIST_EMAILS` — plain env (comma-separated allowlisted Google emails).
  - `DATABASE_URL` — bound to the DB: value `${db.DATABASE_URL}` (matching the `databases` entry name).
  - `PUBLIC_BASE_URL` — value `${APP_URL}` (App Platform substitutes the live app URL).
  - `PORT` — `8080`.
- [ ] Add a header comment block in the YAML pointing at the implementation plan (Workstream F) and noting that `doctl apps create --spec deploy/do-app.yaml` is a manual step (see `deploy/README.md`).

### 4. Author `deploy/README.md` (manual steps runbook)  <!-- agent: general-purpose -->

- [ ] Create `deploy/README.md` documenting the **manual, deferred** steps a human performs after these files exist:
  1. **Google Cloud OAuth client** — in Google Cloud Console: create/configure the OAuth consent screen, create an OAuth 2.0 Client (Web application), record `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, and add the redirect URI `<PUBLIC_BASE_URL>/auth/google/callback` (exact callback path to match TASK-027's OIDC route — confirm against the portal route table in the plan).
  2. **Deploy** — `doctl apps create --spec deploy/do-app.yaml` (first deploy), then set the SECRET env values (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`) via the DO dashboard or `doctl apps update`. Generate `SESSION_SECRET` with `openssl rand -base64 48` (≥32 bytes).
  3. **Redirect URI loop** — after the first deploy the live `APP_URL` is known; set it as the Google redirect URI and (if needed) `PUBLIC_BASE_URL`.
  4. **Prod DB promotion note** — the dev DB uses a self-signed CA (`ssl: { rejectUnauthorized: false }` in `portal/db.ts`); for production, fetch the cluster CA and switch to a pinned `CA_CERT` (document the env/path) instead of disabling cert verification.
- [ ] Mark each cloud action clearly as **deferred: requires DigitalOcean account + Google Cloud Console** so it is unambiguous these are human steps, not automatable in this task.

### 5. Validate the artefacts (no live deploy, no doctl)  <!-- agent: general-purpose -->

- [ ] Lint the YAML for syntax (e.g. parse `deploy/do-app.yaml` with a YAML parser in a scratch Node/`node -e` invocation, output under `./tmp/`) — must parse clean. Do NOT run any `doctl` command.
- [ ] Sanity-check the Dockerfile statically: confirm two `FROM` lines (multi-stage), `ENV PUBLIC_PORTAL_MODE=1` in the build stage, `COPY --from=frontend-build … ./ui/dist`, `ENV PORT=8080`, `EXPOSE 8080`, and a `CMD`. Do NOT run `docker build` (the portal/ scaffold from TASK-027 may not be present; a real build is part of a later verify/UAT once TASK-027 lands).
- [ ] Confirm `Dockerfile.prod` is byte-for-byte unchanged (Serena `find_file` + git diff — it must not appear in the working-tree changes for this task except as untouched).

## Acceptance Criteria

- [ ] `Dockerfile.portal` exists at the repo root, is multi-stage: stage 1 builds the frontend with `PUBLIC_PORTAL_MODE=1` into `frontend/dist`; final stage is `node:22-alpine`, installs portal deps with `npm ci --omit=dev`, copies `portal/` and the built frontend into `portal/ui/dist`, sets `ENV PORT=8080`, `EXPOSE 8080`, and a `CMD` that runs the portal.
- [ ] `Dockerfile.prod` is completely UNTOUCHED (no edits, no rename, no delete).
- [ ] `deploy/do-app.yaml` defines exactly one `portal` service with `instance_count: 1` and an explicit comment that the in-memory relay registry forbids scaling out until pub/sub exists.
- [ ] `deploy/do-app.yaml` declares a dev Postgres database (`production: false`), a Dockerfile-based build pointing at `Dockerfile.portal`, `http_port: 8080`, and a `/healthz` health check.
- [ ] `deploy/do-app.yaml` wires the envs: `GOOGLE_CLIENT_ID` (SECRET), `GOOGLE_CLIENT_SECRET` (SECRET), `SESSION_SECRET` (SECRET, ≥32 bytes), `ALLOWLIST_EMAILS`, `DATABASE_URL: ${db.DATABASE_URL}`, `PUBLIC_BASE_URL: ${APP_URL}`, `PORT: 8080`.
- [ ] `deploy/README.md` documents the manual deploy + OAuth steps and the prod-DB CA-pinning note.
- [ ] `deploy/do-app.yaml` parses as valid YAML; `Dockerfile.portal` passes the static structural checks in Step 5.
- [ ] **deferred: requires DigitalOcean account + Google Cloud Console** — Create the Google Cloud OAuth client (consent screen + Web client), record `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, and register the redirect URI `<PUBLIC_BASE_URL>/auth/google/callback`. (Manual human/cloud action — NOT performed by this autonomous task.)
- [ ] **deferred: requires DigitalOcean account + Google Cloud Console** — Run `doctl apps create --spec deploy/do-app.yaml`, set the SECRET env values, and confirm the deployed skeleton answers `/healthz` over its live `APP_URL`. (Manual human/cloud action — NOT performed by this autonomous task.)

## Dependencies

- **DEPENDS ON [TASK-027](TASK-027-scaffold-portal-foundation.md)** — Scaffold `portal/` (Fastify, env validation, pg Pool, boot-time migrations, `/healthz`). The Dockerfile containerizes `portal/` and the spec health-checks `portal`'s `/healthz`; the image cannot build and the deploy cannot succeed until TASK-027 exists. This task authors the deploy artefacts against the documented TASK-027 layout even if `portal/` is not yet present. (TASK-027 is the renumbered "originally TASK-023" portal-scaffold task; it explicitly anticipates this Dockerfile.portal task in its `blocks` chain.)

### Roadmap

Implements ROADMAP-002 Phase 2, item "Dockerfile.portal + deploy/do-app.yaml; deploy the skeleton to DO App Platform (manual: Google OAuth client + redirect URI)" — `wiki/work/roadmaps/ROADMAP-002-hosted-portal-oauth-relay-installer.md` (line 34). Per instruction (no `--roadmap`), this task file does not flip the roadmap checkbox; the roadmap reference is recorded here for traceability only.
