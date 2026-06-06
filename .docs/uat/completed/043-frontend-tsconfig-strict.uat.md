# UAT: Update `frontend/tsconfig.json` with full strict flags

> **Source task**: [`.docs/tasks/043-frontend-tsconfig-strict.md`](../tasks/043-frontend-tsconfig-strict.md)
> **Generated**: 2026-06-06

---

## Prerequisites

- [ ] Repository cloned and `frontend/` directory exists (from task 036)
- [ ] Node.js >= 18 installed
- [ ] `cd frontend && npm install` (or `pnpm install`) has been run so `astro/tsconfigs/strict` is resolvable

---

## Shell / Config Tests

### UAT-SHELL-001: tsconfig contains `noUncheckedIndexedAccess`
- **File**: `frontend/tsconfig.json`
- **Description**: Verify that `noUncheckedIndexedAccess: true` is present in `compilerOptions`
- **Steps**:
  1. Run the command below from the repo root
- **Command**:
  ```bash
  node -e "const c=require('./frontend/tsconfig.json');console.log(c.compilerOptions.noUncheckedIndexedAccess)"
  ```
- **Expected Result**: Prints `true`
- [x] Pass <!-- 2026-06-06 -->

### UAT-SHELL-002: tsconfig contains `exactOptionalPropertyTypes`
- **File**: `frontend/tsconfig.json`
- **Description**: Verify that `exactOptionalPropertyTypes: true` is present in `compilerOptions`
- **Steps**:
  1. Run the command below from the repo root
- **Command**:
  ```bash
  node -e "const c=require('./frontend/tsconfig.json');console.log(c.compilerOptions.exactOptionalPropertyTypes)"
  ```
- **Expected Result**: Prints `true`
- [x] Pass <!-- 2026-06-06 -->

### UAT-SHELL-003: tsconfig contains `noImplicitOverride`
- **File**: `frontend/tsconfig.json`
- **Description**: Verify that `noImplicitOverride: true` is present in `compilerOptions`
- **Steps**:
  1. Run the command below from the repo root
- **Command**:
  ```bash
  node -e "const c=require('./frontend/tsconfig.json');console.log(c.compilerOptions.noImplicitOverride)"
  ```
- **Expected Result**: Prints `true`
- [x] Pass <!-- 2026-06-06 -->

### UAT-SHELL-004: tsconfig contains `noPropertyAccessFromIndexSignature`
- **File**: `frontend/tsconfig.json`
- **Description**: Verify that `noPropertyAccessFromIndexSignature: true` is present in `compilerOptions`
- **Steps**:
  1. Run the command below from the repo root
- **Command**:
  ```bash
  node -e "const c=require('./frontend/tsconfig.json');console.log(c.compilerOptions.noPropertyAccessFromIndexSignature)"
  ```
- **Expected Result**: Prints `true`
- [x] Pass <!-- 2026-06-06 -->

### UAT-SHELL-005: tsconfig still extends `astro/tsconfigs/strict`
- **File**: `frontend/tsconfig.json`
- **Description**: Verify the Astro base config extension is preserved
- **Steps**:
  1. Run the command below from the repo root
- **Command**:
  ```bash
  node -e "const c=require('./frontend/tsconfig.json');console.log(c.extends)"
  ```
- **Expected Result**: Prints `astro/tsconfigs/strict`
- [x] Pass <!-- 2026-06-06 -->

### UAT-SHELL-006: `tsc --noEmit` exits zero
- **Description**: Verify that all TypeScript source files in `frontend/` type-check cleanly with the stricter flags applied — no type errors allowed
- **Steps**:
  1. Run the command below from the repo root
- **Command**:
  ```bash
  cd frontend && npx tsc --noEmit; echo "exit:$?"
  ```
- **Expected Result**: Output ends with `exit:0` (no type errors printed above it)
- [x] Pass <!-- 2026-06-06 -->
