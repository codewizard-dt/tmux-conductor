# Skill: typecheck

Run TypeScript type-checking across the monorepo (no emit — type errors only).

## Commands

| Scope | Command |
|-------|---------|
| Both packages | `make typecheck` |
| Backend only | `make typecheck-backend` |
| Frontend only | `make typecheck-frontend` |

## Details

- **Backend target** — runs `cd backend && npx tsc --noEmit` against `backend/tsconfig.json` (NodeNext/strict)
- **Frontend target** — runs `cd frontend && npx tsc --noEmit` against `frontend/tsconfig.json` (extends `astro/tsconfigs/strict` plus additional strict flags)
- **Composite target** — runs backend then frontend in sequence

## When to use

- After editing TypeScript source in `backend/` or `frontend/`
- Before committing or opening a PR
- When diagnosing a type error reported by an agent or CI
