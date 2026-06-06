# UAT: Move UI to frontend/

> **Source task**: [`.docs/tasks/036-move-ui-to-frontend.md`](../tasks/036-move-ui-to-frontend.md)
> **Generated**: 2026-06-06

---

## Prerequisites

- [ ] You are in the repo root (`tmux-conductor/`)
- [ ] Node.js >= 18 is available (`node --version`)

---

## Filesystem Tests

### UAT-FS-001: `frontend/` exists at repo root with all expected files
- **Description**: Verify the UI package was moved to `frontend/` and all key files are present
- **Steps**:
  1. Run the command below
- **Command**:
  ```bash
  ls frontend/package.json frontend/astro.config.mjs frontend/tsconfig.json frontend/.env.example frontend/src frontend/public 2>&1 && echo OK
  ```
- **Expected Result**: All six paths are listed without error, followed by `OK`
- [x] Pass <!-- 2026-06-06 -->

### UAT-FS-002: `scripts/dashboard/ui/` no longer exists
- **Description**: Verify the old path has been removed
- **Steps**:
  1. Run the command below
- **Command**:
  ```bash
  test ! -e scripts/dashboard/ui && echo "GONE" || echo "STILL EXISTS"
  ```
- **Expected Result**: `GONE`
- [x] Pass <!-- 2026-06-06 -->

### UAT-FS-003: `frontend/src/` subdirectories are intact
- **Description**: Verify source tree moved cleanly (components, pages, styles, lib)
- **Steps**:
  1. Run the command below
- **Command**:
  ```bash
  ls frontend/src/ 2>&1 && echo OK
  ```
- **Expected Result**: Output lists `components`, `pages`, `styles`, and `lib` (or equivalent source subdirectories), followed by `OK`
- [x] Pass <!-- 2026-06-06 -->

---

## Config File Tests

### UAT-CFG-001: `docker-compose.build.yml` uses `frontend` build context
- **Description**: Verify the `ui` service build context was updated from `scripts/dashboard/ui` to `frontend`
- **Steps**:
  1. Run the command below
- **Command**:
  ```bash
  grep -c 'context: frontend' docker-compose.build.yml
  ```
- **Expected Result**: `1`
- [x] Pass <!-- 2026-06-06 -->

### UAT-CFG-002: `docker-compose.build.yml` volume mount uses `./frontend`
- **Description**: Verify the volume bind-mount path was updated
- **Steps**:
  1. Run the command below
- **Command**:
  ```bash
  grep -c './frontend:/app' docker-compose.build.yml
  ```
- **Expected Result**: `1`
- [x] Pass <!-- 2026-06-06 -->

### UAT-CFG-003: No `scripts/dashboard/ui` references remain in patched files
- **Description**: Verify all path references were replaced across `CLAUDE.md`, `README.md`, `scripts/README.md`, `docker-compose.build.yml`, and `Makefile`
- **Steps**:
  1. Run the command below
- **Command**:
  ```bash
  grep -rn 'scripts/dashboard/ui' CLAUDE.md README.md scripts/README.md docker-compose.build.yml Makefile; echo "EXIT:$?"
  ```
- **Expected Result**: No matching lines are printed; the final line is `EXIT:1` (grep exits 1 when there are no matches)
- [x] Pass <!-- 2026-06-06 -->

---

## Dependency & Build Tests

### UAT-DEP-001: `npm install` succeeds in `frontend/`
- **Description**: Verify the package is self-contained and installs cleanly from its new location
- **Steps**:
  1. Run the command below (installs into `frontend/node_modules`; safe to re-run)
- **Command**:
  ```bash
  cd frontend && npm install 2>&1; echo "EXIT:$?"
  ```
- **Expected Result**: `npm install` completes without fatal errors; the final line is `EXIT:0`
- [x] Pass <!-- 2026-06-06 -->

### UAT-DEP-002: `npm run build` succeeds in `frontend/`
- **Description**: Verify the Astro production build runs correctly from the new path
- **Steps**:
  1. Ensure `npm install` has been run in `frontend/` (UAT-DEP-001 above)
  2. Run the command below
- **Command**:
  ```bash
  cd frontend && npm run build 2>&1; echo "EXIT:$?"
  ```
- **Expected Result**: Build completes without error; `frontend/dist/index.html` is produced; the final line is `EXIT:0`
- [x] Pass <!-- 2026-06-06 -->

---

## Integration Tests

### UAT-INT-001: `scripts/README.md` describes the UI under `frontend/`
- **Description**: Verify the prose in `scripts/README.md` was updated to reflect the new location
- **Steps**:
  1. Run the command below
- **Command**:
  ```bash
  grep -c 'frontend' scripts/README.md
  ```
- **Expected Result**: `1` or more (at least one reference to `frontend` exists in the file)
- [x] Pass <!-- 2026-06-06 -->

### UAT-INT-002: `CLAUDE.md` reflects `frontend/` instead of old path
- **Description**: Verify CLAUDE.md was updated and no stale path remains
- **Steps**:
  1. Run the command below
- **Command**:
  ```bash
  grep -c 'frontend/' CLAUDE.md
  ```
- **Expected Result**: `1` or more
- [x] Pass <!-- 2026-06-06 -->

### UAT-INT-003: Git history is preserved for moved files
- **Description**: Verify `git mv` was used (not a delete + add) so file history is intact
- **Steps**:
  1. Run the command below to check history for a representative moved file
- **Command**:
  ```bash
  git log --oneline --follow frontend/package.json 2>&1 | head -5
  ```
- **Expected Result**: At least one commit is listed (history is not empty, confirming `git mv` rather than a fresh add)
- [x] Pass <!-- 2026-06-06 -->
