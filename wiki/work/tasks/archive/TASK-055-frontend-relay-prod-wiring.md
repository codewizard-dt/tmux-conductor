---
id: TASK-055
title: "Wire app/frontend to call conductor endpoints through app/api (the relay) in prod, replacing the dev-only host-server Vite proxy"
status: done
created: 2026-06-14
updated: 2026-06-14
depends_on: [TASK-053]
blocks: []
parallel_safe_with: []
uat: "[[UAT-055]]"
tags: [frontend, relay, prod, api-base, roadmap-002]
---

# TASK-055 — Wire app/frontend to call conductor endpoints through app/api (the relay) in prod, replacing the dev-only host-server Vite proxy

## Objective

Wire `app/frontend` to address the conductor API through `app/api`'s relay in production (ROADMAP-002 Phase 4). Today the browser reaches `host-server :8788` directly via the Vite dev proxy — that only works in local dev. In prod, conductor calls must go through `app/api` at `/relay/:deviceId/api/...`, while auth calls (`/api/auth/*`) continue to hit `app/api` directly. This task does the prod wiring/plumbing in `src/lib/api.ts`; the local-vs-relay runtime mode detection and device selection are handled separately in TASK-056 — this task should leave a clean seam for that.

## Approach

**Current state**: `src/lib/api.ts` uses `API_BASE = VITE_API_URL ?? '/api'`, and `vite.config.ts` dev-proxies `/api/auth` → `app/api:8080` and `/api` → host-server:8788. That direct host-server proxy is dev-only.

**Prod routing**: in prod, conductor calls must be prefixed with the selected device's relay path on `app/api` — i.e. `<app/api origin>/relay/<deviceId>/api/...` — instead of the dev `/api` host-server proxy. Auth calls (`/api/auth/*`) must keep pointing at `app/api` directly (never through the relay).

**Relay-aware base**: introduce an API base / fetch layer that:
- In relay mode, prefixes conductor (`/api/...`, excluding `/api/auth/*`) requests with the selected device's relay path on `app/api`.
- Keeps `/api/auth/*` pointed at `app/api` directly.
- Leaves the existing dev direct-proxy path unchanged (so local dev keeps hitting host-server via Vite proxy).
- Exposes a clean seam (e.g. an injectable device id / mode) so TASK-056 can plug in runtime mode detection + device selection without re-plumbing.

Update the `API_BASE` / `apiFetch` layer in `src/lib/api.ts` accordingly; typecheck and build.

## Steps

### 1. Read the current API layer  <!-- agent: general-purpose --> <!-- Completed: 2026-06-14 -->

- [x] Use Serena `get_symbols_overview` on `app/frontend/src/lib/api.ts` to map `API_BASE`, `apiFetch`, and all call sites' assumptions. <!-- API_BASE = VITE_API_URL ?? '/api', plain string prefix used in ~30 sites across 8 files; apiFetch is a thin wrapper that does NOT prepend API_BASE (callers build full URL) -->
- [x] Read `app/frontend/vite.config.ts` to confirm the dev proxy mapping (`/api/auth` → app/api:8080, `/api` → host-server:8788) that must remain intact for dev. <!-- Confirmed; envDir '../..'; /api/auth → API_PORT (8080 default), /api → BACKEND_PORT (8788 default) -->
- [x] Read the TASK-053 outcome to confirm the working relay path shape (`/relay/<deviceId>/api/...`) on `app/api`. <!-- Relay catch-all is /relay/:deviceId/* ; inner path forwarded WITH /api prefix intact. So API_BASE → /relay/<deviceId>/api works directly -->

**Key findings for Step 2:** API_BASE is the single lever (used in api.ts + AgentList/LogTail/ModeSwitcher/useSSE/useAgents/useGitRoot). Auth/admin/invite calls hard-code `/api/...` and must NEVER be relay-prefixed. The relay forwards the inner path including `/api`, so relay base = `/relay/<deviceId>/api`. No existing device/mode/relay notion in frontend src.

### 2. Implement the relay-aware API base  <!-- agent: general-purpose --> <!-- Completed: 2026-06-14 -->

- [x] In `src/lib/api.ts`, introduce a relay-aware base that, in relay mode, prefixes conductor calls with the selected device's relay path on `app/api` while routing `/api/auth/*` to `app/api` directly. <!-- getApiBase() returns `/relay/${deviceId}/api` in relay mode -->
- [x] Keep the dev direct-proxy path (`VITE_API_URL ?? '/api'`) unchanged so local dev behavior is identical. <!-- DIRECT_BASE = VITE_API_URL ?? '/api'; default mode 'direct' -->
- [x] Expose a clean injection seam (device id + mode) for TASK-056 to wire runtime detection + device selection; default/stub it so this task compiles and builds on its own. <!-- ApiMode/RelayConfig types + setRelayConfig() setter; API_BASE changed const→let for ES live-binding update; env stubs VITE_API_MODE/VITE_DEVICE_ID added to root .env.example -->
- [x] Ensure auth requests are always excluded from relay prefixing. <!-- auth/admin/invite calls hard-code /api/... and never import API_BASE, so unaffected by relay base -->

**Note for TASK-056:** `AgentList.tsx:907` captures `const apiUrl = API_BASE` at render time (not module-load), so `setRelayConfig` propagates on next re-render — sound, but TASK-056 should trigger a re-render when flipping mode.

### 3. Typecheck and build  <!-- agent: general-purpose --> <!-- Completed: 2026-06-14 -->

- [x] Run `npx tsc --noEmit` from `app/frontend/` — zero type errors. <!-- TSC_EXIT=0 -->
- [x] Run `npm run build` in `app/frontend/` — clean production build. <!-- vite v6.4.3, 73 modules, dist/ emitted, BUILD_EXIT=0 -->

<!-- Updated: 2026-06-14 19:43 -->


## Acceptance Criteria

- [x] In a prod build, conductor calls are addressed through `app/api`'s relay (`/relay/:deviceId/api/...`) for the selected device. <!-- getApiBase() → `/relay/${deviceId}/api` in relay mode -->
- [x] `/api/auth/*` calls still hit `app/api` directly (never through the relay). <!-- auth/admin/invite calls never import API_BASE -->
- [x] The dev direct-proxy path (Vite `/api` → host-server:8788) is unchanged. <!-- DIRECT_BASE = VITE_API_URL ?? '/api'; default mode direct -->
- [x] A clean seam exists for TASK-056 (runtime local-vs-relay mode detection + device selection) to plug into. <!-- setRelayConfig() + API_BASE live binding -->
- [x] `npx tsc --noEmit` and `npm run build` both pass cleanly.

## Dependencies

- **DEPENDS ON [TASK-053](TASK-053-relay-plain-json-e2e.md)** — the proven relay path shape (`/relay/:deviceId/api/...`) on `app/api` that the frontend addresses.

### Roadmap

Implements ROADMAP-002 Phase 4, item "Wire app/frontend to call conductor endpoints through app/api (relay) in prod" — `wiki/work/roadmaps/ROADMAP-002-hosted-portal-oauth-relay-installer.md`.
