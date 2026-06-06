# 035 — Move `scripts/dashboard/server/` → `backend/`

> **Depends on**: none
> **Blocks**: none
> **Parallel-safe with**: [036-move-ui-to-frontend](036-move-ui-to-frontend.md)

## Objective

Move the Fastify dashboard server package from `scripts/dashboard/server/` to a top-level `backend/` directory and update every path reference that breaks: `docker-compose.build.yml`, `Makefile`, `CLAUDE.md`, `README.md`, and `scripts/README.md`.

## Approach

Use `git mv` to preserve history, then patch every file that references the old path. The server package itself (`package.json`, source files) needs no internal changes — only the containing path changes.

---

## Steps

### 1. Move the directory  <!-- agent: general-purpose -->

- [x] Run `git mv scripts/dashboard/server backend` from repo root
- [x] Confirm `backend/` now exists at repo root with all server files intact (`index.js`, `config.js`, `state.js`, `package.json`, `package-lock.json`, `.env`, `Dockerfile.dev`, `Dockerfile.prod`)

### 2. Update `docker-compose.build.yml`  <!-- agent: general-purpose -->

File: `docker-compose.build.yml`

- [x] Change `context: scripts/dashboard/server` → `context: backend`
- [x] Change `./scripts/dashboard/server:/app` → `./backend:/app` in the `volumes` block

### 3. Update `Makefile`  <!-- agent: general-purpose -->

File: `Makefile`

- [x] The `push` target uses `-f scripts/dashboard/Dockerfile.prod` with context `scripts/dashboard` — after this task moves only the server, the prod Dockerfile at `scripts/dashboard/Dockerfile.prod` still references `./server/` subdirectory. Update the `push` target's `-f` flag to `scripts/dashboard/Dockerfile.prod` (unchanged for now — the prod Dockerfile lives in `scripts/dashboard/` and its build context covers the whole dashboard dir). No change needed to the Makefile for this task if the prod Dockerfile remains at `scripts/dashboard/Dockerfile.prod`.
  - Verify: `grep -n 'dashboard/server' Makefile` — if any matches exist, patch them to `backend`

### 4. Update `CLAUDE.md`  <!-- agent: general-purpose -->

File: `CLAUDE.md`

- [x] Replace every occurrence of `scripts/dashboard/server/` with `backend/`
- [x] Replace every occurrence of `scripts/dashboard/server` (no trailing slash) with `backend`

### 5. Update root `README.md`  <!-- agent: general-purpose -->

File: `README.md`

- [x] Replace every occurrence of `scripts/dashboard/server` with `backend`

### 6. Update `scripts/README.md`  <!-- agent: general-purpose -->

File: `scripts/README.md`

- [x] Replace every occurrence of `scripts/dashboard/server` with `backend`
- [x] Update any prose that describes the server as living under `scripts/dashboard/` to reflect the new `backend/` location

### 7. Verification  <!-- agent: general-purpose -->

- [x] `backend/index.js` exists and `scripts/dashboard/server/` no longer exists
- [x] `docker-compose.build.yml` contains `context: backend` and `./backend:/app`
- [x] `grep -rn 'scripts/dashboard/server' CLAUDE.md README.md scripts/README.md docker-compose.build.yml Makefile` returns no matches
- [x] `cd backend && npm install` succeeds (node_modules may need reinstall after move)

---
**UAT**: [`.docs/uat/035-move-server-to-backend.uat.md`](../uat/035-move-server-to-backend.uat.md)
