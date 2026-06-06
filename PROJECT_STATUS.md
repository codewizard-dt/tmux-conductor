# Project Status

**Last updated:** 2026-06-06

## Current Focus

- [TASK-008: Publish Base Image](.docs/tasks/008-publish-base-image.md) — Build + publish multi-arch `ghcr.io/codewizard-dt/tmux-conductor-base` (blocked on Docker + push to main)

## Active Tasks

| # | Task | Objective |
|---|------|-----------|
| 008 | [Publish Base Image](.docs/tasks/008-publish-base-image.md) | Build + publish multi-arch `ghcr.io/codewizard-dt/tmux-conductor-base` with Chromium + Claude Code + uv preinstalled |

## Recently Completed

- TASK-046: Write `.claude/skills/typecheck/SKILL.md` (Roadmap 004, Phase 4)
- TASK-045: Add `make typecheck`, `make typecheck-backend`, `make typecheck-frontend` targets (Roadmap 004, Phase 4)
- TASK-044: Add ESLint flat config with `strictTypeChecked` + React plugin to frontend
- TASK-042: Add ESLint flat config with `strictTypeChecked` to backend
- TASK-043: Update `frontend/tsconfig.json` with full strict flags
- TASK-041: Add `backend/tsconfig.json` with strict NodeNext config
- TASK-040: Convert backend JS source files to TypeScript
- TASK-039: Update frontend to read `.env` from repo root
- TASK-038: Update backend to load `.env` from repo root
- TASK-037: Create root `.env` and `.env.example`
- TASK-036: Move `scripts/dashboard/ui/` → `frontend/`
- TASK-035: Move `scripts/dashboard/server/` → `backend/`
