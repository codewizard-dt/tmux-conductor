---
id: TASK-0206
aliases: [TASK-0206]
title: "Add a Restart action with confirmation on each process in the Background tab and on the existing bg process tile"
status: pending-uat
created: 2026-09-20
updated: 2026-09-20
depends_on: [TASK-0190, TASK-0193, TASK-0194, TASK-0196, TASK-0205]
blocks: [TASK-0207, TASK-0208]
parallel_safe_with: [TASK-0202, TASK-0203, TASK-0204]
uat: "[[UAT-0206]]"
tags: [bg-processes, frontend, dashboard, restart, roadmap-0024]
---

# TASK-0206 — Add a Restart action with confirmation on each process in the Background tab and on the existing bg process tile

relates_to::[[ROADMAP-0024]]
relates_to::[[bg-process-agent-access]]
relates_to::[[background-process-registry]]
depends_on::[[TASK-0190]]
depends_on::[[TASK-0193]]
depends_on::[[TASK-0194]]
depends_on::[[TASK-0196]]
depends_on::[[TASK-0205]]
blocks::[[TASK-0207]]
blocks::[[TASK-0208]]

> ROADMAP-0024 Phase 4 (Dashboard & Verify). Needs the server route (`TASK-0190`), which is guarded and audited by `TASK-0193`/`TASK-0194` (a header-less dashboard request is a `human` caller: allowed, cooldown-exempt, still audit-logged), the slug identity (`TASK-0196`), and the Background tab from `TASK-0205`, whose component this task extends. Runs before `TASK-0207`, which edits the same rows.

## Objective

Restart exists only as an agent-facing script. A human looking at the dashboard can only `Close window` then `Open window` (two calls, non-atomic; `POST .../window` returns 409 if the window still exists). Add a **Restart** action, with a confirmation step, on every process row in the agent detail **Background** tab and on the existing bg process tile (`BgProcessRow`), both calling the single server-side `POST /api/bg-processes/:slug/restart`, so the dashboard and agents share one code path.

## Approach

- **API helper.** In `frontend/src/lib/api.ts` add `restartBgProcess(slug: string): Promise<BgRestartResult>` (`{ ok: true, name, restartedAt, mechanism }`), following `updateBgProcess`/`bgTail`: `apiFetch`, `encodeURIComponent(slug)`, no body, no `X-Conductor-Agent` header (a human/dashboard caller; the server exempts it from the agent cooldown). On non-OK throw an `Error` whose message maps known statuses to readable text: `409` "The conductor tmux session is not running", `404` "Process no longer exists (it may have been removed)", `500` "Restart failed at step <step>: <error>", `429` (defensive, should not happen for dashboard callers) "Restarted too recently, try again in <retryAfterS>s", otherwise the server's `error` or `HTTP <status>`.
- **Shared button component.** New `frontend/src/components/BgRestartButton.tsx`, props `{ slug, label, windowPresent, projectName, onRestarted?: (result) => void, className? }`, so the tab row and the tile do not diverge. It owns: idle/`restarting`/`error` state, a `ConfirmDialog` (existing component, `frontend/src/components/ConfirmDialog.tsx`), an in-flight guard (button disabled while restarting, a second click or Enter cannot fire a second request), and the inline error text (`role="alert"`).
- **Confirmation copy** (a shared dev server is a shared resource, say so): title `Restart <name>?`, message "Stops the running process and starts it again with its saved launch command. Everyone in project <project> who is using it will be interrupted. Its earlier output is kept in the log, with a restart marker." Confirm label `Restart`; when the window is absent the action is a start, copy adapts ("Starts <name>; its window is not running.") and the label reads `Start`.
- **Where it appears.**
  - Background tab (`BackgroundProcessesTab.tsx` from `TASK-0205`): one button per process row, always present (label `Restart` when a window exists, `Start` when `stopped`; a `stopped` process has no other action in this tab). `aria-label` `Restart <name>`.
  - Tile (`BgProcessRow` in `AgentList.tsx`): shown only when `bg.windowPresent`, placed between `Edit` and `Close window`; when the window is missing the existing `Open window` button already covers it, so do not add a duplicate `Start` there.
- **After success.** Call `onRestarted`; the parent applies an optimistic patch (`liveness: 'running'`, `windowPresent: true`, via the existing `handleBgUpdated` in `AgentList`), which the `bg-update` SSE from `pollAndDiff` then reconciles (the server also broadcasts after a restart per `TASK-0190`). Show a transient inline `Restarted` confirmation (about 3 s, `aria-live="polite"`), and if the Background tab's selected process is the restarted one, its tail poll (`TASK-0205`) picks up the `--- restart <ts> ---` marker on its next tick (trigger one immediate refresh via an optional `onRestarted` callback in the tab to make it feel instant).
- **Failure never leaves the UI stuck**: always clear `restarting` in `finally`; keep the error visible until the next attempt or dismiss; a network failure reads "Could not reach the host-server".
- **No auth/scoping in the UI**: the dashboard is a human caller by design (`TASK-0194` allows it); the button is not hidden per project.
- Reuse existing theme tokens/classes from the neighbouring buttons (`h-7 ... rounded-[7px] border border-line bg-card` secondary style for Restart; the confirm dialog's own primary button); no new colours.

## Steps

### 1. Confirm inputs  <!-- agent: Explore -->

- [x] With Serena `find_symbol`, read the merged restart route in `host-server/index.ts` (`POST /bg-processes/:name/restart`: statuses and body shapes for 200/404/409/429/500) and `TASK-0193`'s dashboard-caller rule; read `apiFetch` and `updateBgProcess`/`bgTail` in `frontend/src/lib/api.ts`; read `BackgroundProcessesTab.tsx` (from `TASK-0205`), `BgProcessRow` (`AgentList.tsx` ~1353-1567) and `ConfirmDialog.tsx`; note the final key field (`slug`)

### 2. API and component  <!-- agent: general-purpose -->

- [x] Add `BgRestartResult` and `restartBgProcess` to `frontend/src/lib/api.ts` with the status-to-message mapping above
- [x] Create `frontend/src/components/BgRestartButton.tsx` (button + `ConfirmDialog`, restarting/error/success states, in-flight guard, adaptive Start/Restart copy)

### 3. Wire in  <!-- agent: general-purpose -->

- [x] `BackgroundProcessesTab.tsx`: render `<BgRestartButton>` on every row; pass `onRestarted` to trigger an immediate tail refresh and forward to a new optional prop `onBgRestarted(slug)`
- [x] `AgentList.tsx`: in `BgProcessRow` render `<BgRestartButton>` when `bg.windowPresent`; add the optimistic `handleBgUpdated` patch for both entry points (a small `handleBgRestarted(slug)` next to `handleBgUpdated`, ~2105) and thread `onBgRestarted` down through `AgentDetailView` (`projectBgs` prop added by `TASK-0205`) and `BgProcessSection`

### 4. Tests  <!-- agent: general-purpose -->

- [x] `frontend/src/components/BgRestartButton.test.tsx` (vitest + Testing Library, `afterEach(cleanup)`, mock `fetch`/`restartBgProcess`): click opens the dialog and sends nothing; Cancel/Escape closes without a request; Confirm sends `POST /api/bg-processes/<encoded slug>/restart` with **no** `X-Conductor-Agent` header; button disabled and label `Restarting…` in flight and a second click does not send a second request; success calls `onRestarted` and shows `Restarted`; 409/404/500/network failures render the mapped message with `role="alert"` and re-enable the button; label is `Start` with adapted copy when `windowPresent` is false
- [x] Extend `frontend/src/components/AgentList.test.tsx` and `BackgroundProcessesTab.test.tsx`: tile shows Restart only when the window is present; Restart appears on every tab row (including a `stopped` process as `Start`); a successful restart optimistically flips the badge to `running`
- [x] Add a `restartBgProcess` case to the api-layer tests if `frontend/src/lib/` has a sibling test convention (mock `fetch`, assert URL/method/headers/error mapping)
- [x] Run `cd frontend && npx tsc --noEmit`, the frontend unit tests, and eslint on the touched files
- [x] Record a live UI recipe marked `[DEFERRED-TO-UAT]` (owned by `TASK-0208`'s UAT): restart a throwaway bg process from the tab and from the tile, cancel once, confirm the log gains a `--- restart <ts> ---` marker and `logs/bg-restarts.jsonl` gets a `dashboard` record

## Files touched

- New: `frontend/src/components/BgRestartButton.tsx`, `frontend/src/components/BgRestartButton.test.tsx`
- Edited: `frontend/src/lib/api.ts`, `frontend/src/components/BackgroundProcessesTab.tsx` (+ its test), `frontend/src/components/AgentList.tsx`, `frontend/src/components/AgentList.test.tsx`
- No `host-server/` edits. Collision notes: `AgentList.tsx`/`api.ts` are hot (also `TASK-0196`, `TASK-0201`, other frontend agents); `BackgroundProcessesTab.tsx` and the tile are shared with `TASK-0205` (before) and `TASK-0207` (after), strictly sequential.

## Dependencies

- Depends on: `TASK-0190` (restart route), `TASK-0193` (dashboard caller exempt from cooldown, audited), `TASK-0194` (guard allows the header-less dashboard caller), `TASK-0196` (slug in the route), `TASK-0205` (Background tab component).
- Blocks: `TASK-0207` (same rows), `TASK-0208` (UAT drives the Restart button).
- Parallel-safe with `TASK-0202`, `TASK-0203`, `TASK-0204` (skill/script only).

## Completion notes

<!-- Updated: 2026-09-20 -->

- **Implemented (frontend only):** `restartBgProcess` + `BgRestartResult` in `frontend/src/lib/api.ts` (bodiless header-less POST; 409/404/500/429/network mapped to readable messages, other statuses use the server `error` or `HTTP <status>`); shared `frontend/src/components/BgRestartButton.tsx` (`ConfirmDialog`, synchronous in-flight ref guard, `Restarting…` state, inline `role="alert"` error, transient `aria-live` `Restarted`/`Started` notice ~3 s, adaptive Start copy); mounted on every `BackgroundProcessesTab` row (sibling of the select button, since buttons cannot nest; the selected row's tail refreshes immediately via the existing `retry`) and on the `BgProcessRow` tile only when `bg.windowPresent`, between `Edit` and `Close window`.
- **Optimistic patch:** `handleBgRestarted(slug)` in `AgentList` (next to `handleBgUpdated`) sets `liveness: 'running'`, `windowPresent: true`, threaded via `onBgRestarted` through `AgentDetailView` and `BackgroundProcessesTab`, and `onRestarted` through `BgProcessSection` and `BgProcessRow`. The `bg-update` SSE reconciles. It deliberately does not patch `lastRestart`; that is `TASK-0207`'s (the `onRestarted` callback receives the full result including `restartedAt` for it).
- **Fold-in (TASK-0196 handoff):** new `frontend/src/lib/bgLabel.ts` `bgQualifiedLabel({name, projectName})` -> `"web" (project acme)`, used by the Restart/Start confirm title and by the tile's existing Remove and Close-window confirm messages (`Remove background process "dev" (project alpha)?`, `Close the window of "dev" (project beta)?`). Test: `AgentList.test.tsx` "Remove and Close-window confirm dialogs name the project" (two projects each with a `dev`), plus `BgRestartButton.test.tsx`.
- **Tests:** `BgRestartButton.test.tsx` (new), `BackgroundProcessesTab.test.tsx`, `AgentList.test.tsx` (tile Restart only with window, optimistic badge flip on tile and tab, qualified dialogs), `api.test.ts` (`restartBgProcess`). Static gates: `tsc --noEmit` clean, eslint clean on touched files, scoped vitest 280/280.
- **[DEFERRED-TO-UAT] live recipe (owned by `TASK-0208`'s UAT):** with a throwaway bg process registered in a scratch project, open an agent of that project, Background tab: click `Restart <name>`, Cancel once (confirm nothing changes and no `--- restart ---` marker appears), click again and confirm; verify the tab tail gains a `--- restart <ts> ---` marker within a moment, the badge stays/turns `running`, and `logs/bg-restarts.jsonl` gets a record with caller kind `dashboard` (no `X-Conductor-Agent`). Repeat from the tile on the Agents empty-state page. Close its window and confirm the tab row now reads `Start <name>` while the tile shows only `Open window`.
