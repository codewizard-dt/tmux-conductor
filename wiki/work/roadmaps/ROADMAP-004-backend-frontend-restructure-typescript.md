---
id: ROADMAP-004
title: Backend/Frontend Restructure to TypeScript
status: done
created: 2026-06-06
updated: 2026-06-12
owner: David Taylor
linked_requirements: []
linked_decisions: []
tags: [infra, typescript, dx]
---

# Roadmap 004: Backend/Frontend Restructure to TypeScript

> Elevate the dashboard from a nested scripts sub-folder into a first-class monorepo structure with strict TypeScript, unified root env, and wired-up typecheck tooling.

## Goal

The dashboard's server and UI sub-packages are promoted from `scripts/dashboard/{server,ui}/` to first-class top-level directories (`backend/` and `frontend/`). All `.js` backend files are converted to TypeScript. Both apps read a single root `.env`. Strict type-checking and ESLint are wired up via `make typecheck`.

## Phase 1: Restructure

> Move both sub-packages to the repo root and patch every path reference that breaks.

- [x] TASK-035: Move `scripts/dashboard/server/` → `backend/`
- [x] TASK-036: Move `scripts/dashboard/ui/` → `frontend/`

## Phase 2: Env

> Consolidate env into a single root `.env`; both apps read from there.

- [x] TASK-037: Create root `.env` and `.env.example`
- [x] TASK-038: Update backend to load `.env` from repo root
- [x] TASK-039: Update frontend to read `.env` from repo root

## Phase 3: TypeScript

> Convert backend to TypeScript and apply strict configs + ESLint to both apps.

- [x] TASK-040: Convert backend JS source files to TypeScript
- [x] TASK-041: Add `backend/tsconfig.json` with strict NodeNext config
- [x] TASK-042: Add ESLint flat config with `strictTypeChecked` to backend
- [x] TASK-043: Update `frontend/tsconfig.json` with full strict flags
- [x] TASK-044: Add ESLint flat config with `strictTypeChecked` + React plugin to frontend

## Phase 4: Typecheck CI

> Wire typecheck into the Makefile and install the `/typecheck` skill.

- [x] TASK-045: Add `make typecheck`, `make typecheck-backend`, `make typecheck-frontend` targets to root Makefile
- [x] TASK-046: Write `.claude/skills/typecheck/SKILL.md`

## Notes

- Backend uses `npm` (has `package-lock.json`). Frontend also uses `npm`.
- Backend is pure ESM (`"type": "module"` in package.json) — use `NodeNext`/`NodeNext` tsconfig, not `bundler`.
- Frontend already extends `astro/tsconfigs/strict` — only needs additional strict flags layered on top.
- `dotenv` was imported in `backend/index.js` but not listed in `package.json` dependencies — added during Phase 2.

## Migration Note

Migrated 2026-06-12 from `.docs/roadmaps/completed/004-backend-frontend-restructure-typescript.md` (pre-wiki task system). Task links have been inlined as names — original task files lived under `.docs/tasks/completed/`.
