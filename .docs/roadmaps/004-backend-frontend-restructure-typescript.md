# Roadmap 004: Promote Dashboard to Top-Level Backend & Frontend with TypeScript

> Elevate the dashboard from a nested scripts sub-folder into a first-class monorepo structure with strict TypeScript, unified root env, and wired-up typecheck tooling.

- **Status**: active
- **Created**: 2026-06-06
- **Last updated**: 2026-06-06 (UAT 041, 043 completed)
- **Owner**: David Taylor
- **Linked PRD**: —
- **Linked ADRs**: —
- **Tags**: infra, typescript, dx

## Goal

The dashboard's server and UI sub-packages are promoted from `scripts/dashboard/{server,ui}/` to first-class top-level directories (`backend/` and `frontend/`). All `.js` backend files are converted to TypeScript. Both apps read a single root `.env`. Strict type-checking and ESLint are wired up via `make typecheck`.

## Phase 1: Restructure

> Move both sub-packages to the repo root and patch every path reference that breaks.

- [x] [TASK-035: Move `scripts/dashboard/server/` → `backend/`](../tasks/completed/035-move-server-to-backend.md)
- [x] [TASK-036: Move `scripts/dashboard/ui/` → `frontend/`](../tasks/completed/036-move-ui-to-frontend.md)

## Phase 2: Env

> Consolidate env into a single root `.env`; both apps read from there.

- [x] [TASK-037: Create root `.env` and `.env.example`](../tasks/completed/037-create-root-env.md)
- [ ] [TASK-038: Update backend to load `.env` from repo root](../tasks/038-backend-load-root-env.md)
- [ ] [TASK-039: Update frontend to read `.env` from repo root](../tasks/039-frontend-root-env.md)

## Phase 3: TypeScript

> Convert backend to TypeScript and apply strict configs + ESLint to both apps.

- [ ] [TASK-040: Convert backend JS source files to TypeScript](../tasks/040-backend-convert-to-typescript.md)
- [x] [TASK-041: Add `backend/tsconfig.json` with strict NodeNext config](../tasks/completed/041-backend-tsconfig.md)
- [ ] [TASK-042: Add ESLint flat config with `strictTypeChecked` to backend](../tasks/042-backend-eslint.md)
- [x] [TASK-043: Update `frontend/tsconfig.json` with full strict flags](../tasks/completed/043-frontend-tsconfig-strict.md)
- [ ] Add ESLint flat config (`eslint.config.mjs`) with `strictTypeChecked` + React plugin to frontend

## Phase 4: Typecheck CI

> Wire typecheck into the Makefile and install the `/typecheck` skill.

- [ ] Add `make typecheck`, `make typecheck-backend`, `make typecheck-frontend` targets to root Makefile
- [ ] Write `.claude/skills/typecheck/SKILL.md` per the setup-strict-typechecks template

## Notes

- Backend uses `npm` (has `package-lock.json`). Frontend also uses `npm`.
- Backend is pure ESM (`"type": "module"` in package.json) — use `NodeNext`/`NodeNext` tsconfig, not `bundler`.
- Frontend already extends `astro/tsconfigs/strict` — only needs additional strict flags layered on top.
- `dotenv` is imported in `backend/index.js` but not listed in `package.json` dependencies — add it during Phase 2.
