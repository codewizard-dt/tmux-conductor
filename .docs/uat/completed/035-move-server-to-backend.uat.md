# UAT: Move `scripts/dashboard/server/` → `backend/`

> **Source task**: [`.docs/tasks/035-move-server-to-backend.md`](../tasks/035-move-server-to-backend.md)
> **Generated**: 2026-06-06

---

## Prerequisites

- [ ] Node.js >= 18 is installed
- [ ] Working directory is the repo root (`/Users/davidtaylor/Repositories/tmux-conductor` or equivalent)
- [ ] `./tmp/uat-035/` directory exists (create with `mkdir -p ./tmp/uat-035`)

---

## Static / Filesystem Tests

### UAT-STATIC-001: `backend/` directory exists at repo root

- **Description**: Confirm `backend/` was created at the repo root with all expected server files after the `git mv`.
- **Steps**:
  1. Run the command below from the repo root
- **Command**:
  ```bash
  ls backend/index.js backend/config.js backend/state.js backend/package.json backend/.env backend/Dockerfile.dev
  ```
- **Expected Result**: All six files are listed with no errors — `backend/index.js`, `backend/config.js`, `backend/state.js`, `backend/package.json`, `backend/.env`, `backend/Dockerfile.dev` all appear.
- [x] Pass <!-- 2026-06-06 -->

### UAT-STATIC-002: `scripts/dashboard/server/` no longer exists

- **Description**: Confirm the old path was fully removed by the move.
- **Steps**:
  1. Run the command below from the repo root
- **Command**:
  ```bash
  test ! -d scripts/dashboard/server && echo "PASS: old path gone" || echo "FAIL: old path still exists"
  ```
- **Expected Result**: Prints `PASS: old path gone`.
- [x] Pass <!-- 2026-06-06 -->

### UAT-STATIC-003: No stale `scripts/dashboard/server` references in patched files

- **Description**: Confirm `CLAUDE.md`, `README.md`, `scripts/README.md`, `docker-compose.build.yml`, and `Makefile` contain no lingering references to the old path. (Note: the Makefile's `push` target intentionally still references `scripts/dashboard/Dockerfile.prod` and `scripts/dashboard` as the prod build context — that is the dashboard-level directory, not the server sub-directory, so it is correct.)
- **Steps**:
  1. Run the command below from the repo root
- **Command**:
  ```bash
  grep -rn 'scripts/dashboard/server' CLAUDE.md README.md scripts/README.md docker-compose.build.yml Makefile
  ```
- **Expected Result**: No output (exit code 1 from grep, meaning zero matches). A blank result confirms the move is complete.
- [x] Pass <!-- 2026-06-06 -->

### UAT-STATIC-004: `docker-compose.build.yml` references `backend` context and volume

- **Description**: Confirm the Docker Compose file was updated to use the new `backend/` path for both the build context and the bind mount.
- **Steps**:
  1. Run the command below from the repo root
- **Command**:
  ```bash
  grep -n 'context: backend\|./backend:/app' docker-compose.build.yml
  ```
- **Expected Result**: At least two matches — one line with `context: backend` and one line with `./backend:/app`.
- [x] Pass <!-- 2026-06-06 -->

### UAT-STATIC-005: `CLAUDE.md` script table references `backend/index.js`

- **Description**: Confirm the main project guide now lists `backend/index.js` (not the old path) as the Fastify backend entry point.
- **Steps**:
  1. Run the command below from the repo root
- **Command**:
  ```bash
  grep -n 'backend/index.js' CLAUDE.md
  ```
- **Expected Result**: At least one match listing `backend/index.js` as the Fastify backend on port 8788.
- [x] Pass <!-- 2026-06-06 -->

### UAT-STATIC-006: `scripts/README.md` describes `backend/` as the server location

- **Description**: Confirm `scripts/README.md` was updated so its server section heading and script table rows reference `backend/` rather than the old path.
- **Steps**:
  1. Run the command below from the repo root
- **Command**:
  ```bash
  grep -n 'backend/' scripts/README.md
  ```
- **Expected Result**: Multiple matches including `backend/index.js`, `backend/config.js`, and `backend/state.js` appearing in the server documentation section.
- [x] Pass <!-- 2026-06-06 -->

### UAT-STATIC-007: `README.md` quick-start references `cd backend`

- **Description**: Confirm the root README quick-start block was updated to reflect the new launch command.
- **Steps**:
  1. Run the command below from the repo root
- **Command**:
  ```bash
  grep -n 'cd backend' README.md
  ```
- **Expected Result**: At least one match showing `cd backend && node index.js` (or similar) as the Fastify backend start command.
- [x] Pass <!-- 2026-06-06 -->

---

## Runtime Tests

### UAT-RUNTIME-001: `npm install` succeeds inside `backend/`

- **Description**: Confirm Node.js package installation works from the new location. This validates that `package.json` and `package-lock.json` are intact after the move.
- **Steps**:
  1. Run the command below from the repo root
- **Command**:
  ```bash
  cd backend && npm install --prefer-offline 2>&1 | tail -5
  ```
- **Expected Result**: Exits with code 0. Output shows either `up to date` or `added N packages`. No fatal errors.
- [x] Pass <!-- 2026-06-06 -->

### UAT-RUNTIME-002: Node syntax check passes on all three source files

- **Description**: Confirm `index.js`, `config.js`, and `state.js` parse without syntax errors from their new location.
- **Steps**:
  1. Run the command below from the repo root
- **Command**:
  ```bash
  node --check backend/index.js backend/config.js backend/state.js && echo "Syntax OK"
  ```
- **Expected Result**: Prints `Syntax OK` — no syntax errors reported.
- [x] Pass <!-- 2026-06-06 -->

### UAT-RUNTIME-003: `backend/index.js` starts and listens on port 8799 (uat-isolated port)

- **Description**: Confirm the server can be launched from the new `backend/` path. Uses a non-default port to avoid colliding with a live dashboard instance.
- **Steps**:
  1. Create the scratch directory: `mkdir -p ./tmp/uat-035`
  2. Copy conductor config into scratch: `cp conductor.conf ./tmp/uat-035/conductor.conf`
  3. Run the command below from the repo root
- **Command**:
  ```bash
  BACKEND_PORT=8799 CONDUCTOR_CONF=./tmp/uat-035/conductor.conf node backend/index.js > ./tmp/uat-035/server.log 2>&1 & SERVER_PID=$! ; sleep 1 ; grep -i 'listening\|127.0.0.1\|8799' ./tmp/uat-035/server.log && kill $SERVER_PID 2>/dev/null
  ```
- **Expected Result**: The log contains a line like `Dashboard server listening on http://127.0.0.1:8799`. The process is then killed cleanly.
- [x] Pass <!-- 2026-06-06 -->

### UAT-RUNTIME-004: `GET /api/healthz` returns `{"ok":true}` from the new location

- **Description**: Confirm the health-check endpoint responds correctly when the server is started from `backend/`.
- **Steps**:
  1. Start the server in the background (UAT-RUNTIME-003 setup steps apply — port 8799, scratch conf)
  2. Run the command below (server must be running; if it was killed in 003, restart it first):
     `BACKEND_PORT=8799 CONDUCTOR_CONF=./tmp/uat-035/conductor.conf node backend/index.js &`
  3. After 1 second, run:
- **Command**:
  ```bash
  curl -sS 'http://127.0.0.1:8799/api/healthz'
  ```
- **Expected Result**: `{"ok":true}`
- [x] Pass <!-- 2026-06-06 -->

---

## Integration Test

### UAT-INT-001: `git log --follow backend/index.js` shows history from the original `scripts/dashboard/server/index.js`

- **Description**: Confirm that `git mv` was used (not a copy-delete), so the file history is preserved. This is the key correctness signal for the move approach specified in the task.
- **Steps**:
  1. Run the command below from the repo root
- **Command**:
  ```bash
  git log --follow --oneline backend/index.js | head -5
  ```
- **Expected Result**: At least one commit is listed that predates the 035 task commit (i.e., the log includes the original `scripts/dashboard/server/index.js` commit messages, proving `--follow` crosses the rename boundary). The output should contain multiple commits, not just the move commit.
- [FAIL: auto-judge: git log --follow backend/index.js returns no output because the rename is staged but not yet committed; git status confirms RM rename is staged correctly but --follow only traverses committed history] <!-- 2026-06-06 -->

---

**UAT**: [`.docs/uat/035-move-server-to-backend.uat.md`](../uat/035-move-server-to-backend.uat.md)
