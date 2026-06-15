---
id: TASK-056
title: "Frontend runtime mode detection (local-direct vs relay) + API_BASE rewire"
status: done
created: 2026-06-14
updated: 2026-06-14
depends_on: [TASK-055]
blocks: []
parallel_safe_with: []
uat: "[[UAT-056]]"
tags: [frontend, relay, mode-detection, api-base, roadmap-002]
---

# TASK-056 — Frontend runtime mode detection (local-direct vs relay) + API_BASE rewire

## Objective

Add `app/frontend` runtime mode detection (local-direct vs relay) and rewire `API_BASE` — the logic currently absent in `src/lib/api.ts`. The frontend must transparently choose between two run modes at runtime:

- **LOCAL-DIRECT**: the browser talks to the host-server (`:8788`) directly via the `/api` proxy (dev/self-hosted). Conductor calls go straight through.
- **RELAY**: the browser talks to `app/api`, which tunnels conductor calls over WSS to a paired daemon and on to the host-server (the hosted multi-user deployment). Conductor calls go through `app/api`'s `/relay/:deviceId/api/...` (built in TASK-055) for the currently selected device.

`/api/auth/*` must always point at `app/api` regardless of mode. This task replaces the planned `frontend/runtime.ts` with a mode resolver + device selection state wired into the existing `apiFetch` wrapper.

## Approach

**Mode resolution**: detect mode at runtime. Options (pick the simplest robust path during implementation, may combine):
- a build/env flag `VITE_MODE` (`local-direct` | `relay`) as an explicit override;
- a probe of the host-server's `/healthz` (or `/status`) through the direct `/api` proxy — if reachable, default to local-direct; if not, fall back to relay;
- presence of a selected/paired device implies relay.

**Device selection state**: in relay mode the conductor base depends on which device is active. Add a device selection store/context (the selected `deviceId`), persisted (e.g. `localStorage`) so a reload restores it. TASK-057 (DevicePicker) drives this selection; this task only provides the state + base resolution.

**Base rewire**: `apiFetch` currently uses `API_BASE = VITE_API_URL ?? '/api'`. Rewire so that:
- conductor calls resolve to `'/api'` (or `VITE_API_URL`) in local-direct, and to `${API_URL}/relay/${selectedDeviceId}/api` in relay;
- `/api/auth/*` calls always resolve to `app/api` (unchanged from today);
- the existing `auth:unauthorized` dispatch on 401 is preserved.

Keep the resolver pure/testable and the change confined to `src/lib/api.ts` plus a small selection context/store.

## Steps

### 1. Read current API + auth wiring  <!-- agent: general-purpose -->

- [x] Use Serena `get_symbols_overview` on `app/frontend/src/lib/api.ts` to note `API_BASE`, `apiFetch`, and the `auth:unauthorized` dispatch.
- [x] Read `app/frontend/src/contexts/AuthContext.tsx` and `app/frontend/vite.config.ts` to confirm the dev-proxy split (`/api/auth` → app/api, `/api` → host-server:8788).
- [x] Confirm whether TASK-055's `/relay/:deviceId/api/...` path shape is final; note the exact prefix to build against. CONFIRMED: `app/api/routes/relay.ts` registers `ALL /relay/:deviceId/*`; `app/api/relay/mux.ts` strips the `/relay/:deviceId` prefix and forwards the inner path. So `/relay/<id>/api/agents` forwards `/api/agents` to host-server — exactly what `getApiBase()` already builds.

### 2. Implement the mode resolver  <!-- agent: general-purpose -->

- [x] Added `app/frontend/src/lib/runtime.ts` (replaces the planned `frontend/runtime.ts`). `initRuntimeMode()` returns `'direct' | 'relay'` (matches the existing `ApiMode` seam type), honoring the `VITE_API_MODE` override, otherwise probing `/api/healthz` through the direct proxy (reachable → direct; unreachable/timeout → relay).
- [x] Resolution is memoized in module state (`resolvedMode`); `initRuntimeMode()` is idempotent and `getResolvedMode()` exposes the cached value.

### 3. Add device selection state  <!-- agent: general-purpose -->

- [x] `runtime.ts` holds the selected device in `localStorage` (`tmux-conductor:selected-device`) via `getSelectedDeviceId()` / `setSelectedDeviceId()`; `setSelectedDeviceId()` re-applies the relay config and notifies subscribers (`subscribeRuntime`) for TASK-057.
- [x] On load `initRuntimeMode()` restores the persisted selection (falling back to `VITE_DEVICE_ID`) when in relay mode.

### 4. Rewire `apiFetch` base resolution  <!-- agent: general-purpose -->

- [x] Base resolution reuses the TASK-055 seam: `initRuntimeMode()` calls `setRelayConfig()`, which recomputes the `API_BASE` live binding — `'/api'` (or `VITE_API_URL`) in direct, `/relay/<deviceId>/api` in relay. No changes to call sites needed.
- [x] `/api/auth/*` calls (in `src/lib/auth.ts`) hard-code their path and never import `API_BASE`, so they always hit app/api — unchanged.
- [x] `apiFetch`'s `auth:unauthorized` 401 dispatch is untouched.
- [x] Re-render on flip: `App.tsx` gates router mount until `initRuntimeMode()` resolves (first render captures the correct base), and `Dashboard` re-keys its conductor subtree on `subscribeRuntime` so a device switch forces a fresh `API_BASE` capture.

### 5. Typecheck + build  <!-- agent: general-purpose -->

- [x] `npx tsc --noEmit` in `app/frontend/` — exit 0, zero errors.
- [x] `npm run build` in `app/frontend/` — clean build (74 modules, built in ~0.8s).

## Acceptance Criteria

- [x] The app auto-selects local-direct when the host-server is reachable and relay otherwise (with `VITE_API_MODE` override honored).
- [x] In relay mode, switching the selected device repoints conductor calls to that device's `/relay/:deviceId/api/...` (via `setSelectedDeviceId` → `setRelayConfig` + subtree re-key).
- [x] `/api/auth/*` continues to hit `app/api` in both modes; the `auth:unauthorized` 401 behavior is unchanged.
- [x] Selected device persists across reload (localStorage, restored in `initRuntimeMode`).
- [x] `npx tsc --noEmit` and `npm run build` pass cleanly in `app/frontend/`.

## Dependencies

- **DEPENDS ON [TASK-055](TASK-055-relay-prod-wiring.md)** — provides the production relay wiring and the `app/api` `/relay/:deviceId/api/...` data path this resolver targets.

### Roadmap

Implements ROADMAP-002 Phase 5, item "app/frontend runtime mode detection (local-direct vs relay) + API_BASE rewire" — `wiki/work/roadmaps/ROADMAP-002-hosted-portal-oauth-relay-installer.md`.
