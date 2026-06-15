---
id: UAT-025
title: "UAT: Update docker-compose mounts, Dockerfile native-build step, and docs for the SQLite data layer"
status: passed
task: TASK-025
created: 2026-06-13
updated: 2026-06-13
---

# UAT-025 — UAT: Update docker-compose mounts, Dockerfile native-build step, and docs for the SQLite data layer

implements::[[TASK-025]]

> **Source task**: [`wiki/work/tasks/TASK-025-update-docker-dockerfile-docs.md`](../tasks/TASK-025-update-docker-dockerfile-docs.md)
> **Generated**: 2026-06-13

---

## Prerequisites

- [ ] Working directory is the repo root (`tmux-conductor/`)
- [ ] All commands below are run from the repo root

---

## Test Cases

### UAT-INFRA-001: docker-compose.yml mounts `./data` for SQLite persistence
- **File**: `docker-compose.yml`
- **Description**: Verifies the `dashboard` service has the `./data:/app/data` volume mount so the SQLite DB survives container restarts.
- **Steps**:
  1. From the repo root, run the command below.
- **Command**:
  ```bash
  grep './data:/app/data' docker-compose.yml
  ```
- **Expected Result**: Outputs a line containing `- ./data:/app/data` (no blank output).
- [x] Pass <!-- 2026-06-13 -->

---

### UAT-INFRA-002: docker-compose.yml does NOT mount `tasks.txt`
- **File**: `docker-compose.yml`
- **Description**: Verifies the obsolete `- ./tasks.txt:/app/tasks.txt` volume line has been removed from the `dashboard` service.
- **Steps**:
  1. From the repo root, run the command below.
- **Command**:
  ```bash
  grep 'tasks.txt' docker-compose.yml || echo "NOT FOUND"
  ```
- **Expected Result**: Outputs `NOT FOUND` — no `tasks.txt` reference exists in the file.
- [x] Pass <!-- 2026-06-13 -->

---

### UAT-INFRA-003: Dockerfile.prod (root) Stage 2 installs native-build toolchain
- **File**: `Dockerfile.prod`
- **Description**: Verifies the `server-deps` stage wraps `npm install --omit=dev` with the Alpine virtual build-deps toolchain so `better-sqlite3` compiles correctly on musl libc.
- **Steps**:
  1. From the repo root, run the command below.
- **Command**:
  ```bash
  grep -A2 'virtual .build-deps' Dockerfile.prod
  ```
- **Expected Result**: Output contains all three lines of the pattern — `apk add --no-cache --virtual .build-deps python3 make g++`, then `&& npm install --omit=dev`, then `&& apk del .build-deps`.
- [x] Pass <!-- 2026-06-13 -->

---

### UAT-INFRA-004: backend/Dockerfile.prod Stage 1 installs native-build toolchain
- **File**: `backend/Dockerfile.prod`
- **Description**: Verifies the `builder` stage in the backend-only prod image wraps `npm install --omit=dev` with the same virtual build-deps pattern.
- **Steps**:
  1. From the repo root, run the command below.
- **Command**:
  ```bash
  grep -A2 'virtual .build-deps' backend/Dockerfile.prod
  ```
- **Expected Result**: Output contains `apk add --no-cache --virtual .build-deps python3 make g++`, then `&& npm install --omit=dev`, then `&& apk del .build-deps`.
- [x] Pass <!-- 2026-06-13 -->

---

### UAT-INFRA-005: backend/Dockerfile.dev installs native-build toolchain without --omit-dev
- **File**: `backend/Dockerfile.dev`
- **Description**: Verifies the dev image wraps `npm install` (no `--omit=dev`) with the virtual build-deps toolchain so devDependencies are still available and `better-sqlite3` compiles correctly.
- **Steps**:
  1. From the repo root, run the command below.
- **Command**:
  ```bash
  grep -A2 'virtual .build-deps' backend/Dockerfile.dev
  ```
- **Expected Result**: Output contains `apk add --no-cache --virtual .build-deps python3 make g++`, then `&& npm install` (WITHOUT `--omit=dev`), then `&& apk del .build-deps`.
- [x] Pass <!-- 2026-06-13 -->

---

### UAT-DOC-001: README.md has no old flat-file model references
- **File**: `README.md`
- **Description**: Verifies the README contains no references to the obsolete flat-file queue model: `tasks.txt`, `TASK_QUEUE`, `BG_PROCESSES=`, or `AGENTS=`.
- **Steps**:
  1. From the repo root, run the command below.
- **Command**:
  ```bash
  grep -E 'tasks\.txt|TASK_QUEUE|BG_PROCESSES=|AGENTS=' README.md || echo "CLEAN"
  ```
- **Expected Result**: Outputs `CLEAN` — no old-model references remain.
- [x] Pass <!-- 2026-06-13 -->

---

### UAT-DOC-002: README.md describes the SQLite data layer
- **File**: `README.md`
- **Description**: Verifies the README positively describes SQLite as the data store, including `data/conductor.db` and the tasks table.
- **Steps**:
  1. From the repo root, run the command below.
- **Command**:
  ```bash
  grep -c 'conductor\.db\|tasks table' README.md
  ```
- **Expected Result**: Outputs a number greater than 0 (multiple SQLite references exist).
- [x] Pass <!-- 2026-06-13 -->

---

### UAT-DOC-003: CLAUDE.md has no old flat-file model references
- **File**: `CLAUDE.md`
- **Description**: Verifies CLAUDE.md contains no references to the old model: `tasks.txt`, `TASK_QUEUE`, `BG_PROCESSES=`, or `AGENTS=` as live data sources.
- **Steps**:
  1. From the repo root, run the command below.
- **Command**:
  ```bash
  grep -E 'tasks\.txt|TASK_QUEUE|BG_PROCESSES=|AGENTS=' CLAUDE.md || echo "CLEAN"
  ```
- **Expected Result**: Outputs `CLEAN` — no old-model references remain.
- [x] Pass <!-- 2026-06-13 -->

---

### UAT-DOC-004: CLAUDE.md describes the conf-is-tuning-only / data-in-SQLite split
- **File**: `CLAUDE.md`
- **Description**: Verifies CLAUDE.md's architecture section states that `conductor.conf` holds tuning settings only and all operational data lives in SQLite.
- **Steps**:
  1. From the repo root, run the command below.
- **Command**:
  ```bash
  grep 'tuning settings only' CLAUDE.md
  ```
- **Expected Result**: Outputs at least one line containing `tuning settings only` — confirming the conf-is-tuning-only / SQLite-is-data split is documented.
- [x] Pass <!-- 2026-06-13 -->

---

### UAT-DOC-005: scripts/README.md has no old flat-file model references
- **File**: `scripts/README.md`
- **Description**: Verifies scripts/README.md contains no references to the old flat-file queue: `tasks.txt`, `TASK_QUEUE`, `BG_PROCESSES=`, or `AGENTS=`.
- **Steps**:
  1. From the repo root, run the command below.
- **Command**:
  ```bash
  grep -E 'tasks\.txt|TASK_QUEUE|BG_PROCESSES=|AGENTS=' scripts/README.md || echo "CLEAN"
  ```
- **Expected Result**: Outputs `CLEAN` — no old-model references remain.
- [x] Pass <!-- 2026-06-13 -->

---

### UAT-DOC-006: scripts/README.md references SQLite as the task store
- **File**: `scripts/README.md`
- **Description**: Verifies scripts/README.md positively describes the queue as SQL-backed (flowchart node and monitor description both reference SQLite).
- **Steps**:
  1. From the repo root, run the command below.
- **Command**:
  ```bash
  grep -c 'SQLite\|conductor\.db' scripts/README.md
  ```
- **Expected Result**: Outputs a number greater than 0 (at least the flowchart node and monitor description reference SQLite).
- [x] Pass <!-- 2026-06-13 -->

---

### UAT-EDGE-001: frontend/Dockerfile.dev was NOT modified (no build-deps toolchain)
- **Scenario**: The frontend has no native dependencies, so its dev Dockerfile must not have the `python3 make g++` toolchain added.
- **Steps**:
  1. From the repo root, run the command below.
- **Command**:
  ```bash
  grep '.build-deps' frontend/Dockerfile.dev || echo "NOT PRESENT"
  ```
- **Expected Result**: Outputs `NOT PRESENT` — the virtual build-deps pattern was correctly omitted from the frontend image.
- [x] Pass <!-- 2026-06-13 -->

---

### UAT-EDGE-002: docker-compose.build.yml was NOT modified
- **Scenario**: The dev compose (`docker-compose.build.yml`) bind-mounts source and needs no `./data` mount or `tasks.txt` removal, so it must remain unchanged.
- **Steps**:
  1. From the repo root, run the command below.
- **Command**:
  ```bash
  grep -E '\./data|tasks\.txt' docker-compose.build.yml || echo "NOT PRESENT"
  ```
- **Expected Result**: Outputs `NOT PRESENT` — no `./data` volume or `tasks.txt` reference was added to the dev compose file.
- [x] Pass <!-- 2026-06-13 -->
