---
id: UAT-055
title: "UAT: Wire app/frontend to call conductor endpoints through app/api (the relay) in prod"
status: passed
task: TASK-055
created: 2026-06-14
updated: 2026-06-14
---

# UAT-055 — UAT: Wire app/frontend to call conductor endpoints through app/api (the relay) in prod

implements::[[TASK-055]]

> **Source task**: [[TASK-055]]
> **Generated**: 2026-06-14

---

## Scope

TASK-055 is **build-level plumbing only** (no runtime mode detection — that is TASK-056). The change lives entirely in `app/frontend/src/lib/api.ts`:

- `getApiBase()` returns `/relay/<deviceId>/api` in relay mode (with a device id), else the dev default `VITE_API_URL ?? '/api'`.
- `setRelayConfig(cfg)` is the injection seam; it recomputes the `API_BASE` live binding.
- Auth/admin/invite calls (`/api/auth/*`) hard-code their paths and never import `API_BASE`, so they are excluded from relay prefixing.
- New env vars `VITE_API_MODE` and `VITE_DEVICE_ID` exist in `.env.example` only.

Tests below verify base resolution per mode, auth-exclusion, the unchanged dev default, and a clean production build. These are unit/build checks — there is no running server endpoint to hit (app/api runs on port 8090 if a service-level check is later needed; not required here).

---

## Prerequisites

- [ ] Repo checked out at the TASK-055 commit; working directory clean enough to build.
- [ ] Node >= 22.12 and `npm` available.
- [ ] `app/frontend` dependencies installed (`cd app/frontend && npm ci` if `node_modules` is missing).
- [ ] `tsx` available to run the inline import harness (`npx tsx ...` will fetch it if absent).
- [ ] Scratch dir `./tmp/` exists for the harness script (repo-local; never `/tmp`).

---

## Test Cases

### UAT-UNIT-001: Relay base resolves to /relay/<deviceId>/api in relay mode
- **File under test**: `app/frontend/src/lib/api.ts` (`getApiBase`, `setRelayConfig`)
- **Description**: With relay mode and a device id injected via `setRelayConfig`, `getApiBase()` must return the device's relay path on app/api.
- **Steps**:
  1. Create the harness `./tmp/uat055-base.mts` with the contents shown below (one-time, reused by UNIT-001..004).
  2. Run the command below; read the JSON line tagged `relay`.
- **Harness file** (`./tmp/uat055-base.mts`):
  ```ts
  import { getApiBase, setRelayConfig } from '../app/frontend/src/lib/api.ts'

  // default (env unset under tsx) -> direct
  console.log(JSON.stringify({ tag: 'default', base: getApiBase() }))

  // relay mode with a device id
  setRelayConfig({ mode: 'relay', deviceId: 'dev-abc123' })
  console.log(JSON.stringify({ tag: 'relay', base: getApiBase() }))

  // relay mode but NO device id -> must fall back to direct
  setRelayConfig({ mode: 'relay', deviceId: null })
  console.log(JSON.stringify({ tag: 'relay-no-device', base: getApiBase() }))

  // flip back to direct
  setRelayConfig({ mode: 'direct', deviceId: null })
  console.log(JSON.stringify({ tag: 'back-to-direct', base: getApiBase() }))
  ```
- **Command**:
  ```bash
  npx --yes tsx /Users/davidtaylor/Repositories/tmux-conductor/tmp/uat055-base.mts
  ```
- **Expected Result**: The `relay`-tagged line is `{"tag":"relay","base":"/relay/dev-abc123/api"}` — i.e. `getApiBase()` returns `/relay/dev-abc123/api`.
- [x] Pass <!-- 2026-06-14 -->

### UAT-UNIT-002: Dev default unchanged when env unset (direct mode)
- **File under test**: `app/frontend/src/lib/api.ts` (`getApiBase`, `DIRECT_BASE`)
- **Description**: With no env vars set, the module defaults to `direct` mode and `getApiBase()` returns `/api` (the dev Vite-proxy default), preserving local-dev behavior.
- **Steps**:
  1. Reuse `./tmp/uat055-base.mts` from UNIT-001.
  2. Run the command below; read the `default`-tagged line.
- **Command**:
  ```bash
  npx --yes tsx /Users/davidtaylor/Repositories/tmux-conductor/tmp/uat055-base.mts
  ```
- **Expected Result**: The `default`-tagged line is `{"tag":"default","base":"/api"}` — initial mode is `direct` and base is `/api` (since `VITE_API_URL`/`VITE_API_MODE` are unset under tsx).
- [x] Pass <!-- 2026-06-14 -->

### UAT-UNIT-003: Relay mode without a device id falls back to the direct base
- **File under test**: `app/frontend/src/lib/api.ts` (`getApiBase`)
- **Description**: Relay mode requires a device id. With `deviceId: null`, `getApiBase()` must NOT emit a malformed `/relay/null/api` path — it falls back to the direct base. Guards against TASK-056 wiring relay mode before a device is selected.
- **Steps**:
  1. Reuse `./tmp/uat055-base.mts` from UNIT-001.
  2. Run the command below; read the `relay-no-device`-tagged line.
- **Command**:
  ```bash
  npx --yes tsx /Users/davidtaylor/Repositories/tmux-conductor/tmp/uat055-base.mts
  ```
- **Expected Result**: The `relay-no-device`-tagged line is `{"tag":"relay-no-device","base":"/api"}` — falls back to `/api`, never `/relay/null/api`.
- [x] Pass <!-- 2026-06-14 -->

### UAT-UNIT-004: setRelayConfig live-updates the exported API_BASE binding
- **File under test**: `app/frontend/src/lib/api.ts` (`setRelayConfig`, `API_BASE`)
- **Description**: `setRelayConfig` must recompute the exported `API_BASE` live binding so existing `${API_BASE}/...` call sites pick up the new base on the next read (the seam TASK-056 relies on).
- **Steps**:
  1. Create `./tmp/uat055-binding.mts` with the contents below.
  2. Run the command.
- **Harness file** (`./tmp/uat055-binding.mts`):
  ```ts
  import * as api from '../app/frontend/src/lib/api.ts'

  console.log(JSON.stringify({ tag: 'before', base: api.API_BASE }))
  api.setRelayConfig({ mode: 'relay', deviceId: 'dev-xyz' })
  console.log(JSON.stringify({ tag: 'after', base: api.API_BASE }))
  ```
- **Command**:
  ```bash
  npx --yes tsx /Users/davidtaylor/Repositories/tmux-conductor/tmp/uat055-binding.mts
  ```
- **Expected Result**: Two lines: `{"tag":"before","base":"/api"}` then `{"tag":"after","base":"/relay/dev-xyz/api"}` — the live binding reflects the new config without re-importing.
- [x] Pass <!-- 2026-06-14 -->

### UAT-UNIT-005: Auth calls are excluded from the relay base
- **File under test**: `app/frontend/src/lib/auth.ts`
- **Description**: Auth requests must always hit app/api directly at `/api/auth/*` and never be relay-prefixed. Verify `auth.ts` hard-codes `/api/auth/...` and does not import `API_BASE`/`getApiBase` from the api module.
- **Steps**:
  1. Run the command below (single grep over `auth.ts`).
- **Command**:
  ```bash
  grep -nE "API_BASE|getApiBase|/api/auth/" /Users/davidtaylor/Repositories/tmux-conductor/app/frontend/src/lib/auth.ts
  ```
- **Expected Result**: Matches show literal `/api/auth/...` paths (e.g. `get-session`, `sign-in/email`, `sign-out`, `sign-up/email`) and NO match for `API_BASE` or `getApiBase` — confirming auth never imports the relay base and stays on `/api/auth`.
- [x] Pass <!-- 2026-06-14 -->

### UAT-UNIT-006: New env vars present in .env.example only
- **File under test**: `.env.example`
- **Description**: TASK-055 adds `VITE_API_MODE` and `VITE_DEVICE_ID` stubs to `.env.example` (config only; no real `.env` touched).
- **Steps**:
  1. Run the command below.
- **Command**:
  ```bash
  grep -nE "VITE_API_MODE|VITE_DEVICE_ID" /Users/davidtaylor/Repositories/tmux-conductor/.env.example
  ```
- **Expected Result**: Both `VITE_API_MODE` and `VITE_DEVICE_ID` appear in `.env.example`.
- [x] Pass <!-- 2026-06-14 -->

### UAT-BUILD-001: TypeScript typechecks cleanly
- **File under test**: `app/frontend`
- **Description**: `tsc --noEmit` passes with zero type errors (the `const`→`let` change on `API_BASE` and the new types must typecheck).
- **Steps**:
  1. Run the command below from the repo (uses an absolute `--project` path).
- **Command**:
  ```bash
  npx --yes --prefix /Users/davidtaylor/Repositories/tmux-conductor/app/frontend tsc --noEmit --project /Users/davidtaylor/Repositories/tmux-conductor/app/frontend/tsconfig.json
  ```
- **Expected Result**: Exit code 0, no diagnostics printed.
- [x] Pass <!-- 2026-06-14 -->

### UAT-BUILD-002: Production build succeeds
- **File under test**: `app/frontend`
- **Description**: `npm run build` (`tsc && vite build`) produces a clean production bundle, proving the relay seam compiles and bundles for prod.
- **Steps**:
  1. Run the command below.
- **Command**:
  ```bash
  npm --prefix /Users/davidtaylor/Repositories/tmux-conductor/app/frontend run build
  ```
- **Expected Result**: Exit code 0; Vite reports modules transformed and emits `dist/` (e.g. `dist/index.html` + assets). No type or bundle errors.
- [x] Pass <!-- 2026-06-14 -->

---

## Notes

- The harness scripts under `./tmp/` import `api.ts` directly; tsx transpiles the TS/JSX-free module. `import.meta.env` is undefined under tsx, so env-derived values resolve to their `?? '/api'` / `'direct'` defaults — which is exactly what UNIT-002 asserts.
- Runtime mode-detection and device selection (flipping to relay mode in a live browser) are out of scope here — they land in TASK-056 and will get their own UAT.
