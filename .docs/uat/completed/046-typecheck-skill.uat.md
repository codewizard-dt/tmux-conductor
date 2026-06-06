# UAT: typecheck skill file

> **Source task**: [`.docs/tasks/046-typecheck-skill.md`](../tasks/046-typecheck-skill.md)
> **Generated**: 2026-06-06

---

## Prerequisites

- [ ] Repository is checked out at project root
- [ ] `make` is available in `PATH`
- [ ] Node.js >= 18 is installed (required for `npx tsc`)
- [ ] `backend/` and `frontend/` directories exist with their respective `tsconfig.json` files

---

## Edge Case Tests

### UAT-EDGE-001: Skill file exists at the correct path

- **Scenario**: The skill file must be present at `.claude/skills/typecheck/SKILL.md`
- **Steps**:
  1. Run the command below from the repo root
- **Command**:
  ```bash
  ls -1 .claude/skills/typecheck/SKILL.md
  ```
- **Expected Result**: Command exits 0 and prints `.claude/skills/typecheck/SKILL.md`
- [x] Pass <!-- 2026-06-06 -->

### UAT-EDGE-002: Skill file contains the Commands section with all three make targets

- **Scenario**: The file must document `make typecheck`, `make typecheck-backend`, and `make typecheck-frontend`
- **Steps**:
  1. Run the command below from the repo root
- **Command**:
  ```bash
  grep -c 'make typecheck' .claude/skills/typecheck/SKILL.md
  ```
- **Expected Result**: Prints `3` (one match per target)
- [x] Pass <!-- 2026-06-06 -->

### UAT-EDGE-003: Skill file contains the Details section

- **Scenario**: The `## Details` section must be present and explain each target
- **Steps**:
  1. Run the command below from the repo root
- **Command**:
  ```bash
  grep -c '## Details' .claude/skills/typecheck/SKILL.md
  ```
- **Expected Result**: Prints `1`
- [x] Pass <!-- 2026-06-06 -->

### UAT-EDGE-004: Skill file contains the When to use section

- **Scenario**: The `## When to use` section must be present with usage guidance
- **Steps**:
  1. Run the command below from the repo root
- **Command**:
  ```bash
  grep -c '## When to use' .claude/skills/typecheck/SKILL.md
  ```
- **Expected Result**: Prints `1`
- [x] Pass <!-- 2026-06-06 -->

### UAT-EDGE-005: `make typecheck` runs without error

- **Scenario**: The composite `make typecheck` target (from task 045) must exit 0 with no type errors
- **Steps**:
  1. Run the command below from the repo root
- **Command**:
  ```bash
  make typecheck
  ```
- **Expected Result**: Command exits 0; output includes `cd backend && npx tsc --noEmit` and `cd frontend && npx tsc --noEmit` with no error lines
- [x] Pass <!-- 2026-06-06 -->

### UAT-EDGE-006: `make typecheck-backend` runs without error

- **Scenario**: The backend-only target must exit 0
- **Steps**:
  1. Run the command below from the repo root
- **Command**:
  ```bash
  make typecheck-backend
  ```
- **Expected Result**: Command exits 0; no TypeScript errors reported
- [x] Pass <!-- 2026-06-06 -->

### UAT-EDGE-007: `make typecheck-frontend` runs without error

- **Scenario**: The frontend-only target must exit 0
- **Steps**:
  1. Run the command below from the repo root
- **Command**:
  ```bash
  make typecheck-frontend
  ```
- **Expected Result**: Command exits 0; no TypeScript errors reported
- [x] Pass <!-- 2026-06-06 -->
