# UAT: Create root `.env` and `.env.example`

> **Source task**: [`.docs/tasks/037-create-root-env.md`](../tasks/037-create-root-env.md)
> **Generated**: 2026-06-06

---

## Prerequisites

- [ ] Working directory is the repo root (`/path/to/tmux-conductor`)
- [ ] Shell has no conflicting `BACKEND_PORT`, `FRONTEND_PORT`, `CORS_ORIGIN`, or `PUBLIC_API_URL` exports already set

---

## File Existence Tests

### UAT-FILE-001: Root `.env` exists with all four required variables

- **Description**: Verify the root `.env` file exists and contains all four required variables with the correct default values.
- **Steps**:
  1. From the repo root, run the command below
- **Command**:
  ```bash
  grep -E '^(BACKEND_PORT|FRONTEND_PORT|CORS_ORIGIN|PUBLIC_API_URL)=' .env | sort
  ```
- **Expected Result**: Exactly four lines printed, in sorted order:
  ```
  CORS_ORIGIN=http://localhost:4321
  BACKEND_PORT=8788
  PUBLIC_API_URL=http://localhost:8788/api
  FRONTEND_PORT=4321
  ```
- [x] Pass <!-- 2026-06-06 -->

### UAT-FILE-002: Root `.env.example` exists with all four variables and comments

- **Description**: Verify `.env.example` exists at the repo root, contains all four variables, and has inline comments.
- **Steps**:
  1. From the repo root, run the command below
- **Command**:
  ```bash
  grep -cE '^#' .env.example && grep -E '^(BACKEND_PORT|FRONTEND_PORT|CORS_ORIGIN|PUBLIC_API_URL)=' .env.example | sort
  ```
- **Expected Result**: First line is a count `>= 4` (there are comment lines); then four variable lines in sorted order:
  ```
  CORS_ORIGIN=http://localhost:4321
  BACKEND_PORT=8788
  PUBLIC_API_URL=http://localhost:8788/api
  FRONTEND_PORT=4321
  ```
- [x] Pass <!-- 2026-06-06 -->

### UAT-FILE-003: `.env.example` is not gitignored

- **Description**: Verify that `.env.example` is tracked by git (not excluded by `.gitignore`).
- **Steps**:
  1. From the repo root, run the command below
- **Command**:
  ```bash
  git check-ignore -v .env.example
  ```
- **Expected Result**: No output and exit code `1` (meaning git does NOT ignore `.env.example`)
- [x] Pass <!-- 2026-06-06 -->

---

## Gitignore Tests

### UAT-GIT-001: Root `.env` is ignored by git

- **Description**: Verify the root `.env` is listed in `.gitignore` so secrets are never committed.
- **Steps**:
  1. From the repo root, run the command below
- **Command**:
  ```bash
  git check-ignore -v .env
  ```
- **Expected Result**: Output includes `.gitignore` and the matching pattern (e.g. `.env`), confirming the file is ignored
- [x] Pass <!-- 2026-06-06 -->

### UAT-GIT-002: Root `.env` does not appear in git-tracked files

- **Description**: Verify that `.env` is not being tracked by git (was never committed).
- **Steps**:
  1. From the repo root, run the command below
- **Command**:
  ```bash
  git ls-files .env
  ```
- **Expected Result**: Empty output — `.env` is not tracked
- [x] Pass <!-- 2026-06-06 -->

---

## Per-package `.env` Removal Tests

### UAT-RM-001: `backend/.env` does not exist

- **Description**: Verify the per-package backend `.env` has been removed; its vars now live at root.
- **Steps**:
  1. From the repo root, run the command below
- **Command**:
  ```bash
  test ! -f backend/.env && echo "absent" || echo "PRESENT — should be removed"
  ```
- **Expected Result**: `absent`
- [x] Pass <!-- 2026-06-06 -->

### UAT-RM-002: `frontend/.env` does not exist

- **Description**: Verify the per-package frontend `.env` has been removed; its vars now live at root.
- **Steps**:
  1. From the repo root, run the command below
- **Command**:
  ```bash
  test ! -f frontend/.env && echo "absent" || echo "PRESENT — should be removed"
  ```
- **Expected Result**: `absent`
- [x] Pass <!-- 2026-06-06 -->

---

## Makefile Integration Test

### UAT-MAKE-001: `make ports` picks up root `.env` variables

- **Description**: Verify that the Makefile's `-include .env` + `export` causes `make ports` to read `BACKEND_PORT` and `FRONTEND_PORT` from the root `.env` rather than falling back to defaults.
- **Steps**:
  1. From the repo root, run the command below (unsets any shell-level overrides first)
- **Command**:
  ```bash
  env -i HOME="$HOME" PATH="$PATH" make ports
  ```
- **Expected Result**: Output contains both lines using the `.env` values (not the `:-` fallback defaults, which are the same values — but the variables must be sourced from the file):
  ```
  Dashboard API: http://localhost:8788
  Dashboard UI:  http://localhost:4321 (dev) | http://localhost:8788 (prod)
  ```
- [x] Pass <!-- 2026-06-06 -->
