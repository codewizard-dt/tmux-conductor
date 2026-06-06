# 036 — Move `scripts/dashboard/ui/` → `frontend/`

> **Depends on**: none
> **Blocks**: none
> **Parallel-safe with**: [035-move-server-to-backend](035-move-server-to-backend.md)

## Objective

Move the Astro+React dashboard UI package from `scripts/dashboard/ui/` to a top-level `frontend/` directory and update every path reference that breaks: `docker-compose.build.yml`, `Makefile`, `CLAUDE.md`, `README.md`, and `scripts/README.md`.

## Approach

Use `git mv` to preserve history, then patch every file that references the old path. The UI package itself (`package.json`, `astro.config.mjs`, source files) needs no internal changes — only the containing path changes.

---

## Steps

### 1. Move the directory  <!-- agent: general-purpose -->

- [ ] Run `git mv scripts/dashboard/ui frontend` from repo root
- [ ] Confirm `frontend/` now exists at repo root with all UI files intact (`package.json`, `package-lock.json`, `astro.config.mjs`, `tsconfig.json`, `.env`, `.env.example`, `src/`, `public/`)

### 2. Update `docker-compose.build.yml`  <!-- agent: general-purpose -->

File: `docker-compose.build.yml`

- [ ] Change `context: scripts/dashboard/ui` → `context: frontend`
- [ ] Change `./scripts/dashboard/ui:/app` → `./frontend:/app` in the `volumes` block

### 3. Update `Makefile`  <!-- agent: general-purpose -->

File: `Makefile`

- [ ] Verify: `grep -n 'dashboard/ui' Makefile` — patch any matches to `frontend`
- [ ] The `push` target context is `scripts/dashboard` (covers both server and ui subdirs). After this move the prod Dockerfile build context will need revisiting in a later task; no Makefile change required here unless direct `scripts/dashboard/ui` references exist.

### 4. Update `CLAUDE.md`  <!-- agent: general-purpose -->

File: `CLAUDE.md`

- [ ] Replace every occurrence of `scripts/dashboard/ui/` with `frontend/`
- [ ] Replace every occurrence of `scripts/dashboard/ui` (no trailing slash) with `frontend`

### 5. Update root `README.md`  <!-- agent: general-purpose -->

File: `README.md`

- [ ] Replace every occurrence of `scripts/dashboard/ui` with `frontend`

### 6. Update `scripts/README.md`  <!-- agent: general-purpose -->

File: `scripts/README.md`

- [ ] Replace every occurrence of `scripts/dashboard/ui` with `frontend`
- [ ] Update any prose describing the UI as living under `scripts/dashboard/` to reflect the new `frontend/` location

### 7. Verification  <!-- agent: general-purpose -->

- [ ] `frontend/src/` exists and `scripts/dashboard/ui/` no longer exists
- [ ] `docker-compose.build.yml` contains `context: frontend` and `./frontend:/app`
- [ ] `grep -rn 'scripts/dashboard/ui' CLAUDE.md README.md scripts/README.md docker-compose.build.yml Makefile` returns no matches
- [ ] `cd frontend && npm install` succeeds

---
**UAT**: [`.docs/uat/036-move-ui-to-frontend.uat.md`](../uat/036-move-ui-to-frontend.uat.md)
