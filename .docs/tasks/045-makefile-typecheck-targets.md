# 045 — Add `make typecheck`, `make typecheck-backend`, `make typecheck-frontend` targets to root Makefile

> **Depends on**: [041-backend-tsconfig](completed/041-backend-tsconfig.md), [043-frontend-tsconfig-strict](completed/043-frontend-tsconfig-strict.md)
> **Blocks**: [046-typecheck-skill](046-typecheck-skill.md)
> **Parallel-safe with**: [042-backend-eslint](042-backend-eslint.md)

## Objective

Add three `make` targets to the root `Makefile` so TypeScript checking can be invoked from the repo root without entering each sub-package:

| Target | Command |
|--------|---------|
| `make typecheck-backend` | `cd backend && npx tsc --noEmit` |
| `make typecheck-frontend` | `cd frontend && npx tsc --noEmit` |
| `make typecheck` | runs both `typecheck-backend` and `typecheck-frontend` |

This gives CI and agents a single entrypoint for type-correctness verification.

## Approach

Append the three `.PHONY` targets to the root `Makefile`. Keep the same comment-header style (`## target — description`) used by existing targets. List them in `.PHONY`.

---

## Steps

### 1. Add targets to root `Makefile`  <!-- agent: general-purpose -->

File: `Makefile`

- [ ] Add `typecheck`, `typecheck-backend`, `typecheck-frontend` to the `.PHONY` line
- [ ] Append the following block after the existing targets:

```makefile
## typecheck-backend — run tsc --noEmit in backend/
typecheck-backend:
	cd backend && npx tsc --noEmit

## typecheck-frontend — run tsc --noEmit in frontend/
typecheck-frontend:
	cd frontend && npx tsc --noEmit

## typecheck — run tsc --noEmit in both backend/ and frontend/
typecheck: typecheck-backend typecheck-frontend
```

### 2. Verify targets work  <!-- agent: general-purpose -->

- [ ] Run `make typecheck-backend` — should exit 0
- [ ] Run `make typecheck-frontend` — should exit 0
- [ ] Run `make typecheck` — should run both and exit 0

---
**UAT**: pending
