# UAT: Update frontend to read `.env` from repo root

> **Source task**: [`.docs/tasks/039-frontend-root-env.md`](../tasks/039-frontend-root-env.md)
> **Generated**: 2026-06-06

---

## Prerequisites

- [ ] Working directory is the repo root (`tmux-conductor/`)
- [ ] Node.js >= 18 is available (`node --version`)
- [ ] `frontend/` directory exists and `npm install` has been run inside it
- [ ] A `.env` file exists at the repo root containing at least `PUBLIC_API_URL=http://localhost:8788/api` (copy from `.env.example` if not present)
- [ ] No `.env` file exists inside `frontend/` (the task removes it; a stale one would shadow root env vars)

---

## Configuration Tests

### UAT-CFG-001: `envDir` is set to `'..'` in `frontend/astro.config.mjs`
- **File**: `frontend/astro.config.mjs`
- **Description**: Verify the Vite `envDir` option points one level up (repo root) so Astro/Vite loads `.env` from the repo root rather than `frontend/`.
- **Steps**:
  1. Open `frontend/astro.config.mjs` and inspect the `vite` block.
  2. Confirm the file contains `envDir: '..'` as a direct property of the `vite` object (not inside `vite.server`).
- **Expected Result**: The `vite` block reads:
  ```js
  vite: {
    envDir: '..',
    server: {
      proxy: {
        '/api': 'http://localhost:8788',
      },
    },
  }
  ```
  `envDir: '..'` is present and correctly scoped inside `vite`.
- [x] Pass <!-- 2026-06-06 -->

### UAT-CFG-002: `server.port` reads from `FRONTEND_PORT` env var with fallback
- **File**: `frontend/astro.config.mjs`
- **Description**: Verify the dev-server port is driven by `process.env.FRONTEND_PORT` (falls back to `4321`) rather than being hardcoded.
- **Steps**:
  1. Open `frontend/astro.config.mjs` and inspect the `server` key at the top level of `defineConfig`.
  2. Confirm it uses `parseInt(process.env.FRONTEND_PORT || '4321', 10)`.
- **Expected Result**: `server: { port: parseInt(process.env.FRONTEND_PORT || '4321', 10) }` — not a bare numeric literal.
- [x] Pass <!-- 2026-06-06 -->

### UAT-CFG-003: No `frontend/.env` file exists
- **File**: `frontend/.env`
- **Description**: Confirm there is no `.env` file inside the `frontend/` directory. A stale `frontend/.env` would be loaded by Vite before the root `.env` (since Vite resolves `envDir` relative to the project root, which is `frontend/` when running `astro dev` from that directory) and would shadow the root vars.
- **Steps**:
  1. From the repo root run:
     ```bash
     ls frontend/.env 2>&1
     ```
  2. The command should report that the file does not exist.
- **Expected Result**: Output is `ls: frontend/.env: No such file or directory` (or equivalent on your OS). The file must not exist.
- [x] Pass <!-- 2026-06-06 -->

---

## Build / Environment Tests

### UAT-ENV-001: `PUBLIC_API_URL` is available during Astro build
- **Description**: Verify that Astro's build process picks up `PUBLIC_API_URL` from the root `.env` (via `envDir: '..'`) and does not error with an undefined env var.
- **Steps**:
  1. Ensure a root `.env` contains `PUBLIC_API_URL=http://localhost:8788/api`.
  2. From the **repo root** run:
     ```bash
     cd frontend && npm run build 2>&1 | tail -20
     ```
  3. Observe the build output.
- **Expected Result**: Build completes with exit code 0 (`Build complete` or similar Astro success message). No errors referencing `PUBLIC_API_URL` or missing environment variables.
- [x] Pass <!-- 2026-06-06 -->

### UAT-ENV-002: Dev server starts on default port 4321 when `FRONTEND_PORT` is unset
- **Description**: Verify the Astro dev server binds to port 4321 (the fallback) when `FRONTEND_PORT` is not set in the environment.
- **Steps**:
  1. Unset `FRONTEND_PORT` in the current shell: `unset FRONTEND_PORT`
  2. Start the dev server in a separate terminal from inside `frontend/`:
     ```bash
     cd frontend && npm run dev
     ```
  3. Wait for the server to print its listening URL.
- **Expected Result**: Output includes `http://localhost:4321` (not any other port). The server starts without errors.
- [x] Pass <!-- 2026-06-06 -->

### UAT-ENV-003: Dev server starts on custom port when `FRONTEND_PORT` is set
- **Description**: Verify `FRONTEND_PORT` overrides the default port 4321.
- **Steps**:
  1. Export a custom port in the current shell: `export FRONTEND_PORT=4399`
  2. Start the dev server from inside `frontend/`:
     ```bash
     cd frontend && npm run dev
     ```
  3. Wait for the server to print its listening URL.
- **Expected Result**: Output includes `http://localhost:4399`. The server starts without errors on the custom port.
- [x] Pass <!-- 2026-06-06 -->

---

## Integration Tests

### UAT-INT-001: `API_BASE` in `frontend/src/lib/api.ts` resolves to root `.env` value at runtime
- **Description**: Verify that `API_BASE` exported from `frontend/src/lib/api.ts` picks up `PUBLIC_API_URL` from the root `.env` (not the hardcoded fallback), confirming end-to-end env var propagation from root `.env` → Vite → runtime module.
- **Components**: Root `.env`, `frontend/astro.config.mjs` (`envDir: '..'`), `frontend/src/lib/api.ts`
- **Flow**:
  1. Root `.env` defines `PUBLIC_API_URL=http://localhost:8788/api`.
  2. Astro/Vite reads it via `envDir: '..'`.
  3. `frontend/src/lib/api.ts` exports `API_BASE = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:8788/api'`.
  4. At runtime in the browser, `API_BASE` should equal the value from root `.env`.
- **Steps**:
  1. Ensure root `.env` contains `PUBLIC_API_URL=http://localhost:8788/api`.
  2. Start the dev server: `cd frontend && npm run dev`
  3. Open the browser dev console at `http://localhost:4321`.
  4. In the console, evaluate:
     ```js
     // Inspect via the network tab — or check the bundle:
     // The api.ts module is bundled; open DevTools → Sources, find api.ts or search for API_BASE
     ```
     Alternatively, temporarily add `console.log(import.meta.env.PUBLIC_API_URL)` to any page component, reload, and check the browser console.
  5. Confirm the logged value equals `http://localhost:8788/api` (the value from root `.env`), not `undefined`.
- **Expected Result**: `import.meta.env.PUBLIC_API_URL` resolves to `"http://localhost:8788/api"` in the browser. `API_BASE` is therefore `"http://localhost:8788/api"` (not falling through to the hardcoded default, which would indicate env vars were not loaded).
- [x] Pass <!-- 2026-06-06 -->
