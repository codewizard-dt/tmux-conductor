# 037 — Create root `.env` and `.env.example`

> **Depends on**: [035-move-server-to-backend](035-move-server-to-backend.md), [036-move-ui-to-frontend](036-move-ui-to-frontend.md)
> **Blocks**: none
> **Parallel-safe with**: none

## Objective

Create a single root `.env` and `.env.example` at the repo root consolidating all shared environment variables (`BACKEND_PORT`, `FRONTEND_PORT`, `CORS_ORIGIN`, `PUBLIC_API_URL`) so both `backend/` and `frontend/` read from one place.

## Approach

The root `Makefile` already has `-include .env` and `export`, so make targets will pick up the root `.env` automatically. Create the files and ensure `.env` is in `.gitignore`. The existing per-package `.env` files in `backend/` and `frontend/` will be removed (their values now live at root).

---

## Steps

### 1. Create root `.env`  <!-- agent: general-purpose -->

Create file `.env` at repo root with:
```
BACKEND_PORT=8788
FRONTEND_PORT=4321
CORS_ORIGIN=http://localhost:4321
PUBLIC_API_URL=http://localhost:8788/api
```

- [x] Write `.env` at repo root with the four vars above

### 2. Create root `.env.example`  <!-- agent: general-purpose -->

Create file `.env.example` at repo root:
```
# Fastify backend port
BACKEND_PORT=8788

# Astro dev server port
FRONTEND_PORT=4321

# Allowed CORS origin for the backend (should match UI dev server URL)
CORS_ORIGIN=http://localhost:4321

# Backend API base URL consumed by the frontend (Vite public var)
PUBLIC_API_URL=http://localhost:8788/api
```

- [x] Write `.env.example` at repo root

### 3. Verify `.gitignore` covers root `.env`  <!-- agent: general-purpose -->

- [x] Read `.gitignore` and confirm `.env` is listed (not `.env.example`)
- [x] If `.env` is not listed, add it

### 4. Remove per-package `.env` files  <!-- agent: general-purpose -->

- [x] Delete `backend/.env` (its vars are now in root `.env`)
- [x] Delete `frontend/.env` (its vars are now in root `.env`)
- [x] Keep `frontend/.env.example` if it documents Astro-specific vars; otherwise delete it too (root `.env.example` supersedes it)

### 5. Verification  <!-- agent: general-purpose -->

- [x] Root `.env` exists with all four vars
- [x] Root `.env.example` exists with comments
- [x] `.gitignore` lists `.env` at or near root scope
- [x] `backend/.env` and `frontend/.env` no longer exist

---
**UAT**: [`.docs/uat/037-create-root-env.uat.md`](../uat/037-create-root-env.uat.md)
