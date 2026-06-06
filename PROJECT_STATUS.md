# Project Status

**Last updated:** 2026-06-06

## Current Focus

- [TASK-042: Add ESLint flat config with `strictTypeChecked` to backend](.docs/tasks/042-backend-eslint.md) — Add `backend/eslint.config.mjs` with `strictTypeChecked` preset
- [TASK-044: Add ESLint flat config with `strictTypeChecked` + React plugin to frontend](.docs/tasks/044-frontend-eslint.md) — Add `frontend/eslint.config.mjs` with `strictTypeChecked` + React plugin

## Active Tasks

| # | Task | Objective |
|---|------|-----------|
| 008 | [Publish Base Image](.docs/tasks/active/008-publish-base-image.md) | Build + publish multi-arch `ghcr.io/codewizard-dt/tmux-conductor-base` with Chromium + Claude Code + uv preinstalled |
| 042 | [Backend ESLint](.docs/tasks/042-backend-eslint.md) | Add `backend/eslint.config.mjs` with `strictTypeChecked` preset |
| 044 | [Frontend ESLint](.docs/tasks/044-frontend-eslint.md) | Add `frontend/eslint.config.mjs` with `strictTypeChecked` + React plugin |

## Recently Completed

- TASK-043: Update `frontend/tsconfig.json` with full strict flags
- TASK-041: Add `backend/tsconfig.json` with strict NodeNext config
- TASK-040: Convert backend JS source files to TypeScript
- TASK-039: Update frontend to read `.env` from repo root
- TASK-038: Update backend to load `.env` from repo root
- TASK-037: Create root `.env` and `.env.example`
- TASK-036: Move `scripts/dashboard/ui/` → `frontend/`
- TASK-035: Move `scripts/dashboard/server/` → `backend/`

## Upcoming

- TASK-04x: Add `make typecheck`, `make typecheck-backend`, `make typecheck-frontend` targets (Roadmap 004, Phase 4)
- TASK-04x: Write `.claude/skills/typecheck/SKILL.md` (Roadmap 004, Phase 4)
