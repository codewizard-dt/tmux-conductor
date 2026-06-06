# 046 — Write `.claude/skills/typecheck/SKILL.md`

> **Depends on**: [045-makefile-typecheck-targets](045-makefile-typecheck-targets.md)
> **Blocks**: none
> **Parallel-safe with**: none

## Objective

Create a Claude Code skill file at `.claude/skills/typecheck/SKILL.md` that documents how to run TypeScript type-checking in this project. Agents and developers can invoke `/typecheck` to know the correct commands.

## Approach

Create the directory `.claude/skills/typecheck/` and write `SKILL.md` following the pattern of other skill files in `.claude/`. The file should document the three `make` targets and note when to use each one.

---

## Steps

### 1. Create skill directory and file  <!-- agent: general-purpose -->

- [ ] Create directory `.claude/skills/typecheck/`
- [ ] Write `.claude/skills/typecheck/SKILL.md` with the following content:

```markdown
# Skill: typecheck

Run TypeScript type-checking across the monorepo (no emit — type errors only).

## Commands

| Scope | Command |
|-------|---------|
| Both packages | `make typecheck` |
| Backend only | `make typecheck-backend` |
| Frontend only | `make typecheck-frontend` |

## Details

- **`make typecheck-backend`** — runs `cd backend && npx tsc --noEmit` against `backend/tsconfig.json` (NodeNext/strict)
- **`make typecheck-frontend`** — runs `cd frontend && npx tsc --noEmit` against `frontend/tsconfig.json` (extends `astro/tsconfigs/strict` plus additional strict flags)
- **`make typecheck`** — composite target; runs backend then frontend in sequence

## When to use

- After editing TypeScript source in `backend/` or `frontend/`
- Before committing or opening a PR
- When diagnosing a type error reported by an agent or CI
```

### 2. Verify skill file is reachable  <!-- agent: general-purpose -->

- [ ] Confirm `.claude/skills/typecheck/SKILL.md` exists
- [ ] Confirm `make typecheck` (from task 045) still exits 0

---
**UAT**: [`.docs/uat/046-typecheck-skill.uat.md`](../uat/046-typecheck-skill.uat.md)
