# UAT: Scaffold Astro + React Project

> **Source task**: [`.docs/tasks/completed/026-scaffold-astro-react.md`](../tasks/completed/026-scaffold-astro-react.md)
> **Generated**: 2026-06-06

---

## Prerequisites

- [ ] Node.js >= 22.12.0 is installed
- [ ] Working directory is repo root: `/Users/davidtaylor/Repositories/tmux-conductor`
- [ ] `scripts/dashboard/ui/node_modules/` is populated (run `npm install` in `scripts/dashboard/ui/` if not)

---

## Build & Dev Server Tests

### UAT-BUILD-001: npm run build completes without error
- **Description**: Verify the Astro project builds to static output without errors
- **Steps**:
  1. Run the command below from the repo root
- **Command**:
  ```bash
  cd scripts/dashboard/ui && npm run build 2>&1; echo "EXIT:$?"
  ```
- **Expected Result**: Output contains `[build] Complete!` and ends with `EXIT:0`
- [x] Pass <!-- 2026-06-06 -->

### UAT-BUILD-002: dist/ directory is created after build
- **Description**: Verify `npm run build` produces a `dist/` directory with an `index.html`
- **Steps**:
  1. Ensure UAT-BUILD-001 has run first
  2. Run the command below
- **Command**:
  ```bash
  ls scripts/dashboard/ui/dist/index.html
  ```
- **Expected Result**: `scripts/dashboard/ui/dist/index.html` is listed (file exists)
- [x] Pass <!-- 2026-06-06 -->

### UAT-BUILD-003: Built index.html contains correct page title
- **Description**: Verify the built output contains the required page title
- **Steps**:
  1. Ensure UAT-BUILD-001 has run first
  2. Run the command below
- **Command**:
  ```bash
  grep -c "tmux Conductor Dashboard" scripts/dashboard/ui/dist/index.html
  ```
- **Expected Result**: Outputs `1` or higher (string is present at least once)
- [x] Pass <!-- 2026-06-06 -->

---

## Dev Server Tests

### UAT-DEV-001: npm run dev starts on port 4321
- **Description**: Verify the Astro dev server starts successfully on port 4321
- **Steps**:
  1. In a separate terminal, run: `cd scripts/dashboard/ui && npm run dev`
  2. Wait for `ready in` message in the dev server output
  3. Confirm the output includes `http://127.0.0.1:4321/` or `http://localhost:4321/`
- **Expected Result**: Dev server starts without error and listens on port 4321
- [FAIL: auto-judge: manual test requires human verification] <!-- 2026-06-06 -->

### UAT-DEV-002: curl returns HTML containing page title
- **Description**: Verify the running dev server returns HTML with "tmux Conductor Dashboard"
- **Steps**:
  1. Ensure UAT-DEV-001 dev server is running
  2. Run the command below
- **Command**:
  ```bash
  curl -sS http://localhost:4321/ | grep -c "tmux Conductor Dashboard"
  ```
- **Expected Result**: Outputs `1` or higher (string present in the HTML response)
- [x] Pass <!-- 2026-06-06 -->

### UAT-DEV-003: React component renders in dev HTML output
- **Description**: Verify the Placeholder React component is included in server-rendered HTML
- **Steps**:
  1. Ensure UAT-DEV-001 dev server is running
  2. Run the command below
- **Command**:
  ```bash
  curl -sS http://localhost:4321/ | grep -c "Dashboard coming soon"
  ```
- **Expected Result**: Outputs `1` or higher (Placeholder component text is present)
- [x] Pass <!-- 2026-06-06 -->

---

## Configuration Tests

### UAT-CONF-001: astro.config.mjs includes React integration
- **Description**: Verify `astro.config.mjs` imports and registers `@astrojs/react`
- **Steps**:
  1. Run the command below
- **Command**:
  ```bash
  grep -c "@astrojs/react" scripts/dashboard/ui/astro.config.mjs
  ```
- **Expected Result**: Outputs `1` or higher (React integration is present)
- [x] Pass <!-- 2026-06-06 -->

### UAT-CONF-002: astro.config.mjs configures port 4321
- **Description**: Verify the dev server port is explicitly set to 4321 in config
- **Steps**:
  1. Run the command below
- **Command**:
  ```bash
  grep -c "4321" scripts/dashboard/ui/astro.config.mjs
  ```
- **Expected Result**: Outputs `1` or higher (port 4321 is configured)
- [x] Pass <!-- 2026-06-06 -->

### UAT-CONF-003: .env file exists and contains PUBLIC_API_URL
- **Description**: Verify `.env` exists with the required environment variable
- **Steps**:
  1. Run the command below
- **Command**:
  ```bash
  grep -c "PUBLIC_API_URL=http://127.0.0.1:8788" scripts/dashboard/ui/.env
  ```
- **Expected Result**: Outputs `1` (value is present and correct)
- [x] Pass <!-- 2026-06-06 -->

### UAT-CONF-004: .env.example exists and is committed
- **Description**: Verify `.env.example` exists with the required env var template
- **Steps**:
  1. Run the command below
- **Command**:
  ```bash
  grep -c "PUBLIC_API_URL=http://127.0.0.1:8788" scripts/dashboard/ui/.env.example
  ```
- **Expected Result**: Outputs `1` (value is present)
- [x] Pass <!-- 2026-06-06 -->

---

## Gitignore Tests

### UAT-GIT-001: .env is gitignored
- **Description**: Verify `scripts/dashboard/ui/.env` is excluded from git tracking
- **Steps**:
  1. Run the command below
- **Command**:
  ```bash
  git check-ignore -q scripts/dashboard/ui/.env && echo "IGNORED" || echo "NOT IGNORED"
  ```
- **Expected Result**: Outputs `IGNORED`
- [x] Pass <!-- 2026-06-06 -->

### UAT-GIT-002: node_modules is gitignored
- **Description**: Verify `scripts/dashboard/ui/node_modules` is excluded from git tracking
- **Steps**:
  1. Run the command below
- **Command**:
  ```bash
  git check-ignore -q scripts/dashboard/ui/node_modules && echo "IGNORED" || echo "NOT IGNORED"
  ```
- **Expected Result**: Outputs `IGNORED`
- [x] Pass <!-- 2026-06-06 -->

### UAT-GIT-003: dist/ is gitignored
- **Description**: Verify `scripts/dashboard/ui/dist` is excluded from git tracking
- **Steps**:
  1. Ensure UAT-BUILD-001 has run (so the dist/ directory exists)
  2. Run the command below
- **Command**:
  ```bash
  git check-ignore -q scripts/dashboard/ui/dist && echo "IGNORED" || echo "NOT IGNORED"
  ```
- **Expected Result**: Outputs `IGNORED`
- [x] Pass <!-- 2026-06-06 -->

---

## Component Structure Tests

### UAT-SRC-001: Placeholder.tsx exports a default React component
- **Description**: Verify the component file exists and exports a default function
- **Steps**:
  1. Run the command below
- **Command**:
  ```bash
  grep -c "export default function Placeholder" scripts/dashboard/ui/src/components/Placeholder.tsx
  ```
- **Expected Result**: Outputs `1`
- [x] Pass <!-- 2026-06-06 -->

### UAT-SRC-002: index.astro imports and uses Placeholder with client:load
- **Description**: Verify the index page uses the React component with `client:load` hydration
- **Steps**:
  1. Run the command below
- **Command**:
  ```bash
  grep -c "client:load" scripts/dashboard/ui/src/pages/index.astro
  ```
- **Expected Result**: Outputs `1`
- [x] Pass <!-- 2026-06-06 -->
