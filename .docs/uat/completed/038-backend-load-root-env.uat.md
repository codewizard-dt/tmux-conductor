# UAT: Backend loads `.env` from repo root

> **Source task**: [`.docs/tasks/038-backend-load-root-env.md`](../tasks/038-backend-load-root-env.md)
> **Generated**: 2026-06-06

---

## Prerequisites

- [ ] Repo root `.env` file exists (copy from `.env.example` if needed) with at minimum `PORT=8788` and `CORS_ORIGIN=http://localhost:4321`
- [ ] `dotenv` is listed under `dependencies` in `backend/package.json`
- [ ] `cd backend && npm install` has been run (node_modules present)
- [ ] No other process is already bound to port 8788
- [ ] Backend is started from the `backend/` directory: `cd backend && node index.js` — keep it running for all tests below

---

## Verification Tests

### UAT-VER-001: `dotenv` present in `backend/package.json` dependencies

- **Description**: Verify `dotenv` is declared as a runtime dependency (not missing), so `npm install` in a fresh checkout installs it automatically.
- **Steps**:
  1. Open `backend/package.json`
  2. Confirm `"dotenv"` appears under the `"dependencies"` key (not `devDependencies`)
- **Expected Result**: `backend/package.json` contains `"dotenv"` in `"dependencies"` with a semver range (e.g. `"^16.4.7"` or later)
- [x] Pass <!-- 2026-06-06 -->

### UAT-VER-002: No `__dirname` reference in `backend/index.js`

- **Description**: The old broken dotenv pattern relied on `__dirname`, which is undefined in ESM. Confirm it has been removed.
- **Steps**:
  1. Open `backend/index.js`
  2. Search for the string `__dirname`
- **Expected Result**: `__dirname` does not appear anywhere in `backend/index.js`
- [x] Pass <!-- 2026-06-06 -->

### UAT-VER-003: Syntax check passes

- **Description**: Confirm `backend/index.js` is syntactically valid after the changes.
- **Steps**:
  1. Run the command below from the repo root
- **Command**:
  ```bash
  node --check backend/index.js
  ```
- **Expected Result**: Command exits 0 with no output (no syntax errors)
- [x] Pass <!-- 2026-06-06 -->

---

## API Tests

### UAT-API-001: Backend starts and binds on the port from root `.env`

- **Description**: Verify the backend reads `PORT` from the repo-root `.env` and listens on the correct port (8788 by default). If dotenv loading is broken, the fallback default `8788` in code would mask the failure; this test checks the explicit env var is read by confirming the port matches `.env`.
- **Steps**:
  1. Ensure `PORT=8788` is set in the repo-root `.env`
  2. Start the backend: `cd backend && node index.js` — confirm startup log shows `http://127.0.0.1:8788`
  3. Run the curl command below
- **Command**:
  ```bash
  curl -sS 'http://localhost:8788/api/healthz'
  ```
- **Expected Result**: `200 OK` with body `{"ok":true}` — confirms the server started on port 8788 as specified in `.env`
- [x] Pass <!-- 2026-06-06 -->

### UAT-API-002: `CORS_ORIGIN` from root `.env` is applied to API responses

- **Description**: Verify the backend reads `CORS_ORIGIN` from the repo-root `.env`. The `/api/healthz` response should include `Access-Control-Allow-Origin: http://localhost:4321` (the value set in `.env`), proving dotenv loaded the root env file rather than falling back to the wildcard default `*`.
- **Steps**:
  1. Confirm `CORS_ORIGIN=http://localhost:4321` is set in the repo-root `.env`
  2. Ensure the backend from UAT-API-001 is still running
  3. Run the curl command below
- **Command**:
  ```bash
  curl -sS -I -X GET 'http://localhost:8788/api/healthz' -H 'Origin: http://localhost:4321'
  ```
- **Expected Result**: Response headers include `access-control-allow-origin: http://localhost:4321` (not `*`). This confirms `CORS_ORIGIN` was loaded from root `.env`.
- [x] Pass <!-- 2026-06-06 -->

---

## Edge Case Tests

### UAT-EDGE-001: Backend falls back gracefully when root `.env` is absent

- **Description**: Verify the backend still starts (does not crash) when the root `.env` file is temporarily absent, using code defaults (`PORT=8788`, `CORS_ORIGIN=*`). `dotenv.config()` does not throw when the file is missing — it silently no-ops.
- **Steps**:
  1. Stop the running backend (Ctrl-C)
  2. Temporarily rename the root `.env` to `.env.bak`: `mv .env .env.bak`
  3. Start the backend: `cd backend && node index.js`
  4. Run the curl command below
  5. After verifying, restore: `mv .env.bak .env` and restart the backend
- **Command**:
  ```bash
  curl -sS 'http://localhost:8788/api/healthz'
  ```
- **Expected Result**: Backend starts without error and responds `{"ok":true}`. No crash or unhandled exception in the terminal. CORS header falls back to `*` when `CORS_ORIGIN` is unset.
- [x] Pass <!-- 2026-06-06 -->

### UAT-EDGE-002: `PORT` env var from root `.env` overrides the in-code default

- **Description**: Confirm that a non-default `PORT` value in root `.env` is actually picked up (proving dotenv loads the file, not just relying on the hardcoded `8788` fallback).
- **Steps**:
  1. Stop the running backend
  2. Edit the root `.env`: change `PORT=8788` to `PORT=8790`
  3. Start the backend: `cd backend && node index.js` — startup log should show `http://127.0.0.1:8790`
  4. Run the curl command below
  5. Restore `.env` to `PORT=8788` and restart the backend when done
- **Command**:
  ```bash
  curl -sS 'http://localhost:8790/api/healthz'
  ```
- **Expected Result**: `200 OK` with `{"ok":true}` on port 8790. Confirms the backend read `PORT` from root `.env` (not just the fallback default).
- [x] Pass <!-- 2026-06-06 -->
