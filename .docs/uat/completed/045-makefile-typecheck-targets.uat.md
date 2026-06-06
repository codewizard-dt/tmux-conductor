# UAT: Makefile Typecheck Targets

> **Source task**: [`.docs/tasks/completed/045-makefile-typecheck-targets.md`](../tasks/completed/045-makefile-typecheck-targets.md)
> **Generated**: 2026-06-06

---

## Prerequisites

- [ ] Working directory is the repo root (`tmux-conductor/`)
- [ ] `backend/node_modules` is populated (`npm install` run in `backend/`)
- [ ] `frontend/node_modules` is populated (`npm install` run in `frontend/`)
- [ ] `backend/tsconfig.json` exists (task 041 completed)
- [ ] `frontend/tsconfig.json` exists (task 043 completed)

---

## Integration Tests

### UAT-INT-001: `make typecheck-backend` runs tsc --noEmit in backend and exits 0

- **Components**: root `Makefile`, `backend/tsconfig.json`, `backend/*.ts`
- **Flow**: Invoking `make typecheck-backend` from the repo root changes directory to `backend/` and runs `npx tsc --noEmit`, exiting 0 on success with no compilation errors
- **Steps**:
  1. Run the command below from the repo root
  2. Observe exit code and output
- **Command**:
  ```bash
  make typecheck-backend
  ```
- **Expected Result**: Command outputs `cd backend && npx tsc --noEmit` (or similar make echo), tsc produces no error output, and the process exits with code 0. No `.js` or `.d.ts` files are emitted.
- [x] Pass <!-- 2026-06-06 -->

---

### UAT-INT-002: `make typecheck-frontend` runs tsc --noEmit in frontend and exits 0

- **Components**: root `Makefile`, `frontend/tsconfig.json`, `frontend/src/**/*.ts`
- **Flow**: Invoking `make typecheck-frontend` from the repo root changes directory to `frontend/` and runs `npx tsc --noEmit`, exiting 0 on success with no compilation errors
- **Steps**:
  1. Run the command below from the repo root
  2. Observe exit code and output
- **Command**:
  ```bash
  make typecheck-frontend
  ```
- **Expected Result**: Command outputs `cd frontend && npx tsc --noEmit` (or similar make echo), tsc produces no error output, and the process exits with code 0. No `.js` or `.d.ts` files are emitted.
- [x] Pass <!-- 2026-06-06 -->

---

### UAT-INT-003: `make typecheck` runs both backend and frontend checks and exits 0

- **Components**: root `Makefile`, `backend/tsconfig.json`, `frontend/tsconfig.json`
- **Flow**: Invoking `make typecheck` from the repo root triggers `typecheck-backend` first, then `typecheck-frontend`, and exits 0 only if both succeed
- **Steps**:
  1. Run the command below from the repo root
  2. Observe that both backend and frontend tsc invocations appear in the output
- **Command**:
  ```bash
  make typecheck
  ```
- **Expected Result**: Both `npx tsc --noEmit` invocations run (one for `backend/`, one for `frontend/`), no error output is produced, and the process exits with code 0.
- [x] Pass <!-- 2026-06-06 -->

---

### UAT-INT-004: All three targets are listed as `.PHONY`

- **Components**: root `Makefile`
- **Flow**: `.PHONY` declaration prevents `make` from treating `typecheck`, `typecheck-backend`, and `typecheck-frontend` as file targets, so they always run even if a file with those names exists
- **Steps**:
  1. Run the command below from the repo root
- **Command**:
  ```bash
  make --dry-run typecheck 2>&1 | head -5
  ```
- **Expected Result**: Output includes both `cd backend && npx tsc --noEmit` and `cd frontend && npx tsc --noEmit` lines (dry-run echo), confirming both sub-targets are declared and wired. No "Nothing to be done" message.
- [x] Pass <!-- 2026-06-06 -->
