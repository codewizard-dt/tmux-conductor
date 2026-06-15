---
id: TASK-057
title: "DevicePicker (pairing code + device list/rename/revoke) and Onboarding UI"
status: done
created: 2026-06-14
updated: 2026-06-14
depends_on: [TASK-033, TASK-056]
blocks: []
parallel_safe_with: []
uat: "[[UAT-057]]"
tags: [frontend, devices, onboarding, pairing, roadmap-002]
---

# TASK-057 — DevicePicker (pairing code + device list/rename/revoke) and Onboarding UI

## Objective

Build the `app/frontend` **DevicePicker** (pairing-code panel + device list with connected flag + rename + revoke) and the **Onboarding** view (install instructions for users with no paired device). This is the DevicePicker + Onboarding portion of ROADMAP-002 Phase 5's "Landing/DevicePicker/Onboarding" item. Sign-in / request-access and invite-code entry are already covered by TASK-049 and must NOT be duplicated here.

## Approach

**DevicePicker** lives under the existing AuthGuard/NavBar shell and:
- lists the user's devices from `GET /api/devices` (TASK-033), surfacing each device's live `connected` flag;
- lets the user pick the **active device**, which drives the selected-device state from TASK-056 (repointing conductor calls);
- generates a pairing code via `POST /api/pair/code` (TASK-031), displayed as `XXXX-XXXX`;
- renames a device and revokes a device (revoke closes the live connection per TASK-033).

**Onboarding** is shown to users with **zero devices**: it presents the `curl | bash` install one-liner plus the `conductor pair <code>` instructions so a first-time user can get a daemon paired.

Add a nav/menu entry (alongside the existing NavBar/AuthBadge) and a route so the DevicePicker is reachable. Keep components small and typed; reuse existing `apiFetch` so auth + mode resolution flow through TASK-056.

## Steps

### 1. Read contracts + existing shell  <!-- agent: general-purpose --> <!-- Completed: 2026-06-14 -->

- [x] Read TASK-031 (`POST /api/pair/code`) and TASK-033 (`GET /api/devices`, rename, revoke) for exact request/response shapes and the connected flag semantics. <!-- Completed: 2026-06-14 -->
- [x] Use Serena `get_symbols_overview` on `app/frontend/src/components/NavBar.tsx` (and `AuthBadge`) and `app/frontend/src/components/AuthGuard.tsx` to match the shell/menu conventions. <!-- Completed: 2026-06-14 -->
- [x] Confirm the selected-device setter exposed by TASK-056 and how to call it. <!-- Completed: 2026-06-14 -->

<!-- Findings: app/api routes at app/api/routes/{pair,devices}.ts. POST /api/pair/code -> {code:'XXXX-XXXX', expiresAt} (no body); 429 too_many_pending_codes. GET /api/devices -> [{id,name,createdAt,lastSeenAt,revokedAt,connected}] (connected currently always false stub). PATCH /api/devices/:id body {name} 1-100 chars -> updated device; DELETE -> 204; ownership-404. Frontend uses react-router-dom createBrowserRouter in App.tsx; Dashboard() has nested <Routes> + <NavBar>, re-keyed on runtimeKey. NavBar uses <NavLink to className={linkCls}>. AuthGuard redirects to /login. runtime.ts exports: subscribeRuntime(fn)->unsub, getSelectedDeviceId():string|null, setSelectedDeviceId(id|null), getResolvedMode, initRuntimeMode. Device/pairing calls MUST mirror lib/auth.ts: hard-coded /api/... + credentials:'include', NOT apiFetch/API_BASE. Tailwind styling; tokens ink/muted/canvas/line/accent; sectionCls='rounded-card border border-line bg-white px-5 py-5 shadow-card'. Vite proxy needs /api/devices + /api/pair added above /api catch-all. Install one-liner not yet canonical (TASK-059); use curl -fsSL .../install.sh | bash + conductor pair. ProfilePage has a 'Devices — Coming soon' placeholder to replace/anchor. -->


### 2. Build the DevicePicker component  <!-- agent: general-purpose --> <!-- Completed: 2026-06-14 -->

- [x] Create a DevicePicker component that lists devices from `GET /api/devices` with their live `connected` flag. <!-- Completed: 2026-06-14 -->
- [x] Add active-device selection that calls the TASK-056 selection setter (repointing conductor calls). <!-- Completed: 2026-06-14 -->
- [x] Add a "generate pairing code" action calling `POST /api/pair/code`, displaying the result formatted as `XXXX-XXXX`. <!-- Completed: 2026-06-14 -->
- [x] Add rename (per TASK-033) and revoke (per TASK-033; revoke closes the live connection) actions with confirmation on revoke. <!-- Completed: 2026-06-14 -->

<!-- Done: vite proxy entries /api/devices + /api/pair added above catch-all; new lib/devices.ts (listDevices/createPairingCode/renameDevice/revokeDevice, mirrors auth.ts pattern with credentials:'include'); new components/DevicePicker.tsx (default export, connected badge, radio active-select via setSelectedDeviceId + subscribeRuntime, generate code, inline rename, two-click revoke). tsc --noEmit clean. -->


### 3. Build the Onboarding view  <!-- agent: general-purpose --> <!-- Completed: 2026-06-14 -->

- [x] Create an Onboarding view shown when the user has zero devices, presenting the `curl | bash` install one-liner and the `conductor pair <code>` instructions. <!-- Completed: 2026-06-14 -->
- [x] Gate display on the empty device list (fall through to DevicePicker once a device exists). <!-- Completed: 2026-06-14 -->

<!-- Done: components/Onboarding.tsx (no-devices empty state, install one-liner curl -fsSL .../install.sh | bash with copy button, conductor pair instructions; URL note re TASK-059). pages/DevicesPage.tsx gates: listDevices() empty -> Onboarding, else DevicePicker. tsc clean. -->


### 4. Wire route + nav entry  <!-- agent: general-purpose --> <!-- Completed: 2026-06-14 -->

- [x] Add a route for the DevicePicker/Onboarding under the AuthGuard/NavBar shell. <!-- Completed: 2026-06-14 -->
- [x] Add a nav/menu entry matching existing NavBar conventions. <!-- Completed: 2026-06-14 -->

<!-- Done: App.tsx imports DevicesPage + <Route path="/devices" element={<DevicesPage />} /> in Dashboard nested Routes; NavBar.tsx <NavLink to="/devices" className={linkCls}>Devices</NavLink> after Projects, not admin-gated. tsc clean. -->


### 5. Typecheck + build + smoke note  <!-- agent: general-purpose --> <!-- Completed: 2026-06-14 -->

- [x] Run `npx tsc --noEmit` (or project typecheck) in `app/frontend/` — zero errors. <!-- Completed: 2026-06-14 -->
- [x] Run `npm run build` in `app/frontend/` — clean build. <!-- Completed: 2026-06-14 (vite build ✓ 78 modules, 759ms, no warnings) -->
- [ ] Record a brief manual smoke note (device list renders, code generates/displays, rename/revoke wired) under `./tmp/` if a backend is available. <!-- [DEFERRED-TO-UAT]: runtime smoke belongs to the UAT phase per /tackle rules -->


## Acceptance Criteria

- [ ] Device list renders from `GET /api/devices` with live `connected` flags.
- [ ] User can pick the active device, repointing conductor calls (via TASK-056 selection state).
- [ ] User can generate and see a pairing code formatted as `XXXX-XXXX`.
- [ ] User can rename and revoke a device; revoke closes the live connection (per TASK-033).
- [ ] Onboarding view with the install one-liner + `conductor pair <code>` is shown when the user has no devices.
- [ ] No duplication of sign-in / request-access / invite entry (those remain in TASK-049).
- [ ] `npx tsc --noEmit` and `npm run build` pass cleanly in `app/frontend/`.

## Dependencies

- **DEPENDS ON [TASK-033](TASK-033-portal-devices-api.md)** — `GET /api/devices` (connected flag), rename, and revoke endpoints; revoke closes the live connection.
- **DEPENDS ON [TASK-056](TASK-056-frontend-runtime-mode-detection.md)** — selected-device state + base resolution that the active-device picker drives.

### Roadmap

Implements ROADMAP-002 Phase 5, item "Landing/DevicePicker/Onboarding" (DevicePicker + Onboarding portion; sign-in/invite covered by TASK-049) — `wiki/work/roadmaps/ROADMAP-002-hosted-portal-oauth-relay-installer.md`.
