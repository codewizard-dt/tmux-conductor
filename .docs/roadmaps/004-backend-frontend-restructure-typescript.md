# Roadmap 004: Promote Dashboard to Top-Level Backend & Frontend with TypeScript

> Elevate the dashboard from a nested scripts sub-folder into a first-class monorepo structure with strict TypeScript, unified root env, and wired-up typecheck tooling.

- **Status**: active
- **Created**: 2026-06-06
- **Last updated**: 2026-06-06
- **Owner**: David Taylor
- **Linked PRD**: —
- **Linked ADRs**: —
- **Tags**: infra, typescript, dx

## Goal

The dashboard's server and UI sub-packages are promoted from `scripts/dashboard/{server,ui}/` to first-class top-level directories (`backend/` and `frontend/`). All `.js` backend files are converted to TypeScript. Both apps read a single root `.env`. Strict type-checking and ESLint are wired up via `make typecheck`.

## Phase 1: Restructure

> Move both sub-packages to the repo root and patch every path reference that breaks.

- [ ] Move `scripts/dashboard/server/` → `backend/` at repo root and update all references (Makefile, docker-compose files, CLAUDE.md, README.md, scripts/README.md)
- [ ] Move `scripts/dashboard/ui/` → `frontend/` at repo root and update all references

## Phase 2: Env

> Consolidate env into a single root `.env`; both apps read from there.

- [ ] Create root `.env` and `.env.example` with all shared vars (`PORT`, `UI_PORT`, `CORS_ORIGIN`)
- [ ] Update backend to load `.env` from repo root instead of its own directory
- [ ] Update frontend/Astro env consumption to point at root `.env`

## Phase 3: TypeScript

> Convert backend to TypeScript and apply strict configs + ESLint to both apps.

- [ ] Convert `backend/index.js` → `index.ts`, `config.js` → `config.ts`, `state.js` → `state.ts`
- [ ] Add `backend/tsconfig.json` with `NodeNext`/`NodeNext` module resolution and full strict flags
- [ ] Add ESLint flat config (`eslint.config.mjs`) with `strictTypeChecked` to backend
- [ ] Update `frontend/tsconfig.json` to layer full strict flags on top of the Astro base
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
