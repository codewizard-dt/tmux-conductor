---
id: UAT-0176
aliases: [UAT-0176]
title: "UAT: Convert AddBgProcessForm into a modal and move its trigger into NavBar"
status: skipped
task: TASK-0176
created: 2026-09-18
updated: 2026-10-17
---

# UAT-0176 — UAT: Convert AddBgProcessForm into a modal and move its trigger into NavBar

implements::[[TASK-0176]]

> **Source task**: [[TASK-0176]]
> **Generated**: 2026-09-18

---

## Prerequisites

- [ ] Unit-test cases run from `frontend/` (`npx vitest run ...`); no live server needed.
- [ ] UI cases need the dev servers: `make dev` (frontend `http://localhost:4321`, host-server `http://localhost:8788`). At generation time only the host-server was up.
- [ ] **Do not click `Spawn Process` in any case except UAT-UI-007.** A successful submit creates a real tmux window, runs a launch command, and writes a `bg_processes` row in the live DB. Every other UI case stops short of a successful submit (same caution as [[UAT-0175]] / [[UAT-151]]).
- [ ] UAT-UI-007 is opt-in: run it only in an environment where a throwaway tmux window and DB row are acceptable, and always do its cleanup step.
- [ ] UAT-UI-005 step 5 (optional) creates one throwaway project via the Projects page and deletes it afterward.

---

## Test Cases

### UAT-EDGE-001: Modal shell contract — closed renders nothing, open renders the form, and all three dismissal paths call `onClose` (a click inside the card does not)
- **Scenario**: `AddBgProcessForm` was an always-rendered inline card; it must now honor `{ open, onClose }` exactly like `AddAgentForm`: `open={false}` renders nothing (early return placed after every hook), `open` renders the "Add Background Process" title, `Name` field, `Spawn Process` and `Close` (`✕`) buttons, Escape (document `keydown`) calls `onClose`, the `Close` button calls `onClose`, a backdrop click calls `onClose`, and a click on content inside the card does not.
- **Steps**: Covered by `frontend/src/components/AddBgProcessForm.test.tsx` (closed renders nothing; open renders content; Escape; close button; overlay click vs. card click). Code path: `AddBgProcessForm.tsx` Escape `useEffect` guarded by `open`, `handleOverlayClick` (`e.target === e.currentTarget`).
- **Expected Result**: `container.firstChild` is `null` when closed; when open the title, `Name` label, `Spawn Process` and `Close` are present; `onClose` is called exactly once for each of Escape, `Close` and backdrop click; clicking the title text inside the card leaves `onClose` uncalled.
- **Repeatable Unit Test**: Created: `frontend/src/components/AddBgProcessForm.test.tsx` (new file, written by TASK-0176 step 3; not modified by this UAT)
- **Unit Test Command**: `npx vitest run src/components/AddBgProcessForm.test.tsx` (run from `frontend/`) — verified: 7/7 pass
- [x] Pass <!-- 2026-09-18 --> (auto: via unit test AddBgProcessForm.test.tsx, 11 tests 0 fail; asserts closed=null, open content, Escape/Close/backdrop each call onClose once, card click does not)

---

### UAT-EDGE-002: A 201 response posts the payload and closes the modal; a 409 keeps it open with the inline error
- **Scenario**: On success the form must reset and call `onClose()` (the inline "Process spawned ✓" message and its timeout were removed). Failure paths keep the modal open and show the error inline. `POST /bg-processes` body must be unchanged by this task: `{ name, workdir, launchCmd, linkedAgent?, projectId }`, with `workdir` taken from the selected project.
- **Steps**: Covered by `AddBgProcessForm.test.tsx` (`posts the process and calls onClose on a 201 response`, `keeps the modal open and shows the error on a 409 response`). Handler: `handleSubmit` in `AddBgProcessForm.tsx` (201 branch resets fields then `onClose()`; 409 branch `setError(body.error ?? 'Conflict error')`).
- **Expected Result**: For a 201, `onClose` is called once and the captured POST body matches `{ name: 'dev-server', workdir: '/work/demo', launchCmd: 'npm run dev', projectId: 1 }`. For a 409 with `{"error":"name already exists"}`, that text is shown, `onClose` is not called, and the "Add Background Process" title is still rendered.
- **Repeatable Unit Test**: Created: `frontend/src/components/AddBgProcessForm.test.tsx` (see UAT-EDGE-001)
- **Unit Test Command**: `npx vitest run src/components/AddBgProcessForm.test.tsx` (run from `frontend/`) — verified: 7/7 pass
- [x] Pass <!-- 2026-09-18 --> (auto: via unit test AddBgProcessForm.test.tsx, 11 tests 0 fail; 201 test asserts POST body + one onClose, 409 test asserts inline error + modal still open; TASK-0176 promotions also cover no "Process spawned" text, network failure and non-JSON 500 fallbacks)

---

### UAT-EDGE-003: NavBar owns the trigger — it sits right after `+ Add Agent`, opens the dialog on click, Escape unmounts it, and the two triggers are independent
- **Scenario**: `NavBar` gained `showAddBg` state, a `+ Add Background Process` button as the immediate next sibling of `+ Add Agent` in the `ml-auto` cluster, and `{showAddBg && <AddBgProcessForm open onClose=... />}`. Conditional mounting means the mount-only `/status` and `listProjects()` fetches must not fire until the trigger is clicked, and must fire again on each reopen.
- **Steps**: Covered by `frontend/src/components/NavBar.test.tsx` (`renders the "+ Add Background Process" trigger right after "+ Add Agent" in the same cluster`; `describe('NavBar Add Background Process trigger')`: opens dialog and fetches project list fresh, Escape closes and unmounts, both triggers open their own dialog independently).
- **Expected Result**: Before any click `Spawn Process` is absent and `listProjects` has not been called. After clicking the trigger the "Add Background Process" title and `Spawn Process` button are present and `listProjects` has been called once. After Escape `Spawn Process` is gone. Opening Add Agent shows `Spawn Agent` and not `Spawn Process`, and vice versa; `addAgent.nextElementSibling === addBg`.
- **Repeatable Unit Test**: Created: `frontend/src/components/NavBar.test.tsx` (existing file; TASK-0176 step 3 added the bg cases, not modified by this UAT)
- **Unit Test Command**: `npx vitest run src/components/NavBar.test.tsx` (run from `frontend/`) — verified: 16/16 pass
- [x] Pass <!-- 2026-09-18 --> (auto: via unit test NavBar.test.tsx, 18 tests 0 fail; asserts nextElementSibling order, lazy mount + listProjects once on click, Escape/backdrop/✕ unmount, independent triggers)

---

### UAT-EDGE-004: `AgentsPage` no longer renders the form or its import, and `NavBar` is the only mounting site
- **Scenario**: `<AddBgProcessForm />` and its import must be removed from `frontend/src/pages/AgentsPage.tsx`; otherwise, since `open` is now required, the page would either fail typecheck or render a second (or permanently closed) instance.
- **Steps**:
  1. With Serena `search_for_pattern` for `AddBgProcessForm` over `frontend/src` (excluding `*.test.*`), list every match.
  2. Run `npx tsc --noEmit` from `frontend/` and check that no error mentions `AddBgProcessForm.tsx`, `NavBar.tsx` or `AgentsPage.tsx` (other agents' in-progress work in other files, e.g. `AgentList.tsx`, is not this case's concern).
- **Expected Result**: The only non-test references are the definition in `AddBgProcessForm.tsx` and the import + `<AddBgProcessForm open onClose=... />` in `NavBar.tsx`; `AgentsPage.tsx` contains none. `tsc` reports no error in the three files above.
- **Repeatable Unit Test**: Not applicable: a static source-shape and typecheck assertion; `tsc --noEmit` is the repeatable gate. Rendering `AgentsPage` in a unit test needs `AgentList`, SSE and the API mocked (new harness, see Gaps).
- [FAIL: auto-judge: manual test requires human verification — evidence gathered: `tsc --noEmit` exits clean; AgentsPage.tsx has no AddBgProcessForm reference; non-test refs are the definition, NavBar.tsx import + `<AddBgProcessForm open onClose=... />`, and ALSO dead `pages/index.astro` (Expected lists only the first two — literal mismatch, see EDGE-005)] <!-- 2026-09-18 -->

---

### UAT-EDGE-005: `frontend/src/pages/index.astro` (still imports `<AddBgProcessForm client:load />` without props) is not part of the build or dev path
- **Scenario**: The implementing agent flagged that this tracked file still renders `<AddBgProcessForm client:load />` with no `open`/`onClose`. If it were built, the now-required props would be missing and, since `open` would be `undefined`, the form would render nothing. This case determines whether the file is live rather than assuming either way. (Generation-time research found it is dead: the file's last commit is `ce53273` "Simplify to local-only architecture", the SPA entry is `frontend/index.html` -> `/src/main.tsx` -> `App.tsx` with `react-router-dom`, and there is no astro dependency or config. Re-verify.)
- **Steps**:
  1. Read `frontend/package.json` and `frontend/vite.config.ts`, and confirm `astro` / `@astrojs/*` appear in neither `dependencies`/`devDependencies` nor any plugin. Also search `frontend/package-lock.json` for `node_modules/astro` and check `frontend/node_modules` for an `astro` directory.
  2. Read `frontend/index.html` and confirm the only script entry is `/src/main.tsx`; read `frontend/src/App.tsx` and confirm the routes reference only `AgentsPage`, `ProjectsPage`, `ProjectDetailPage`, `TaskHistoryPage` under `src/pages/` (never `index.astro`).
  3. Confirm `tsconfig.json`'s `include` (`src`, `vite.config.ts`, `vitest.setup.ts`) does not make `tsc` process `.astro` files (tsc only reads `.ts`/`.tsx`/`.d.ts`), so the file's stale import cannot break `npm run build`'s `tsc` step.
  4. Optional smoke: from `frontend/` run `npx vite build --outDir ../tmp/uat-0176-dist --emptyOutDir` and confirm it succeeds and the output contains no reference to `index.astro`. Delete `./tmp/uat-0176-dist` afterward.
- **Expected Result**: No astro dependency/config/plugin, `index.html` -> `main.tsx` is the sole entry, and no route or import reaches `index.astro`, so it is dead code and the missing props there are not a build/runtime defect of TASK-0176. Record the result plus a follow-up suggestion (delete the file, along with its equally stale `<AddAgentForm client:load />` line, or file a cleanup task). If any check shows astro IS wired into build or dev, this case FAILS and the file must be updated to the new props contract.
- **Repeatable Unit Test**: Not applicable: repo-wiring inspection, not a runtime unit behavior.
- [FAIL: auto-judge: manual test requires human verification — evidence gathered: index.astro is dead. No astro in frontend/package.json, vite.config.ts (react plugin only), frontend/package-lock.json, or tsconfig include (src, vite.config.ts, vitest.setup.ts); index.html sole entry is /src/main.tsx; App.tsx routes only AgentsPage/ProjectsPage/ProjectDetailPage/TaskHistoryPage; `vite build` succeeded (1913 modules) with no astro reference in output. Follow-up: delete index.astro (and its stale AddAgentForm line) or file a cleanup task] <!-- 2026-09-18 -->

---

### UAT-UI-001: The `+ Add Background Process` trigger is present on every route, right after `+ Add Agent`, styled as a secondary/neutral button; the Agents page body has no inline card
- **Page**: `http://localhost:4321/`, `/projects`, `/history`
- **Component**: `frontend/src/components/NavBar.tsx` (action cluster), `frontend/src/pages/AgentsPage.tsx`
- **Description**: jsdom cannot confirm real layout or visual hierarchy. Checks the trigger's real position and styling in the sticky header and that removing the inline card left no gap.
- **Steps**:
  1. Open the Agents page (`/`). In the right side of the sticky header, confirm the order is: `+ Add Agent` (dark primary fill), then `+ Add Background Process` (light card fill with a thin border, dark text), then the round theme toggle.
  2. Hover the new button and confirm the fill shifts to the canvas tone (`hover:bg-canvas`); press it and confirm the slight press-scale.
  3. Confirm both buttons are the same height (32px) and the cluster does not wrap or overlap the Agents / Projects / History links at a normal laptop width. Narrow the window somewhat and confirm nothing overlaps.
  4. Scroll the page body and confirm the header stays sticky with the cluster intact.
  5. Confirm the Agents page body no longer contains an inline "Add Background Process" card (title, Project/Name/Working Directory/Launch Command fields, `Spawn Process`) anywhere, including below the agent list, and that no blank gap remains where it used to be.
  6. Navigate to `/projects` and `/history` and confirm the same trigger is present in the header on each.
  7. Toggle the theme (moon/sun button) and confirm the secondary button remains legible and visibly subordinate to `+ Add Agent` in both light and dark themes.
- **Expected Result**: Trigger present on all three routes, labelled exactly `+ Add Background Process`, immediately after `+ Add Agent`, visually secondary; no inline card in the Agents page body; no layout gap; legible in light and dark.
- **Repeatable Unit Test**: Not applicable: real layout, stickiness, hover/press states and theme contrast need a browser. The DOM-order part is covered by UAT-EDGE-003.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-09-18 -->

---

### UAT-UI-002: The modal opens from the NavBar, renders above the sticky header, and dismisses via Escape, backdrop click and `✕` (click inside the card does not dismiss)
- **Page**: `http://localhost:4321/` (repeat once on `/projects`)
- **Component**: `frontend/src/components/AddBgProcessForm.tsx`, `frontend/src/components/NavBar.tsx`
- **Description**: Verifies the modal shell in a real browser: `z-50` overlay over the `z-10` header, backdrop hit-testing, card sizing (`w-[560px]`, `max-h-[90vh]`, scroll), and the `animate-riseIn` entrance.
- **Steps**:
  1. Click `+ Add Background Process`.
  2. Confirm a centered card appears over a dimmed full-viewport backdrop that covers the sticky header too. The card shows an `ADD BACKGROUND PROCESS` heading with a `✕` at the right, then Project select, Name, Working Directory, Launch Command, `▸ Show advanced`, and a `Spawn Process` button.
  3. Press Escape; confirm it closes and the page underneath is unchanged.
  4. Reopen; click the dimmed backdrop outside the card; confirm it closes.
  5. Reopen; click on the heading text and on an empty area inside the card; confirm it stays open.
  6. Click the `✕` (aria-label `Close`); confirm it closes.
  7. Reopen and shrink the browser window height below the card height; confirm the card scrolls internally (`max-h-[90vh]`) without the page scrolling behind it or the card clipping.
  8. Navigate to `/projects`, open the modal once, and dismiss it, to confirm it works off the Agents page. Navigate back to `/` and confirm the modal is closed (no state leaks across routes).
  9. **Do not click `Spawn Process`.**
- **Expected Result**: Modal opens on click and covers the header; closes via Escape, backdrop and `✕`; clicks inside the card do not close it; card scrolls when short; no console errors.
- **Repeatable Unit Test**: Not applicable: real stacking order, backdrop hit-testing, sizing and animation need a browser. The callback logic is covered by UAT-EDGE-001 and UAT-EDGE-003.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-09-18 -->

---

### UAT-UI-003: The Link-to-Agent advanced select lists the agents that currently exist
- **Page**: `http://localhost:4321/`
- **Component**: `frontend/src/components/AddBgProcessForm.tsx` (`/status` fetch in a mount-only effect; `bg-linked-agent` select)
- **Description**: The task's deferred live check. The agent list comes from `GET /status` at mount; because the form now mounts per open, it must reflect the agents at the time the modal opens, not at first page load.
- **Steps**:
  1. Get the current agent names:
     ```bash
     curl -sS 'http://localhost:8788/api/status' | jq -r '.agents[].name'
     ```
  2. In the dashboard click `+ Add Background Process`, then `▸ Show advanced`.
  3. Open the `Link to Agent (optional)` select and compare its options with step 1.
  4. Close the modal, add a new agent via `+ Add Agent` **or** clone/stop an agent in a way that changes the list (skip this step if changing agents is not acceptable), reopen the modal, expand advanced again, and check the list is updated without a page reload.
  5. Confirm the explanatory text mentioning `CONDUCTOR_BG_NAME`, `CONDUCTOR_BG_LOG` and `CONDUCTOR_BG_STATE` is shown under the select. **Do not click `Spawn Process`.**
- **Expected Result**: The select shows `— none —` first, then exactly the agent names from `/status` (same set, no stale or missing names). On reopen after an agent change, the options reflect the change without reloading. `▾ Hide advanced` collapses the section again.
- **Repeatable Unit Test**: Not applicable: needs the live `/status` payload and real agents; the mount-time fetch-per-open behaviour is covered by UAT-EDGE-003.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-09-18 -->

---

### UAT-UI-004: Failures stay inline inside the modal — validation error and a non-spawning 409 conflict — and nothing is spawned
- **Page**: `http://localhost:4321/`
- **Component**: `frontend/src/components/AddBgProcessForm.tsx` (`handleSubmit`; `error` rendered next to the submit button)
- **Description**: Failure paths must keep the modal open with the error shown inside it (the success path closes it). Both scenarios here are rejected before any tmux window or DB row is created.
- **Steps**:
  1. **Validation path.** Open the modal. Without touching the `Project` select, enter Name `uat-0176-probe`, Launch Command `echo hi`, and click `Spawn Process`. Note whether the select visually shows a project or is blank before submitting.
  2. Confirm an inline red error appears next to the button (`Project is required`, or a native browser "fill out this field" tooltip that blocks submit), the modal stays open, and the Network tab shows no `POST /api/bg-processes`.
  3. **Conflict path.** Find an existing bg process name: `curl -sS 'http://localhost:8788/api/status' | jq -r '.bgProcesses[].name'`. If none exists, skip steps 3-5 and record "skipped: no existing bg process" (do not use an agent name: if that agent's window is absent the request would spawn).
  4. In the modal select a project, enter that existing name and any launch command, click `Spawn Process`.
  5. Confirm the modal stays open and an inline error appears (`bg process '<name>' already defined`, or `session not running` / `window already exists` depending on the tmux state), the button label returns from `Spawning…` to `Spawn Process`, and the Bg Processes list gains no duplicate row.
  6. Dismiss with Escape.
- **Expected Result**: In both paths the modal is not closed, the error text is visible inside the card, no new process appears, and the submit button is re-enabled. **Requirement note**: a project must be required; if the select visibly shows a project while submit reports `Project is required` (the select has `value=''` but no placeholder option), record that as a UX observation in the walk notes. It belongs to TASK-161's select, not to this task's shell, so it is not a fail here.
- **Repeatable Unit Test**: Not applicable: the 409-keeps-open path is already covered by UAT-EDGE-002; the rest needs the real API/tmux state and a browser's native validation UI.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-09-18 -->

---

### UAT-UI-005: Each open mounts a fresh form — typed values do not persist across close/reopen
- **Page**: `http://localhost:4321/`
- **Component**: `frontend/src/components/NavBar.tsx` (`{showAddBg && ...}` conditional mount), `AddBgProcessForm.tsx`
- **Description**: Conditional mounting is what resets the form and refetches agents and projects. A permanently mounted (but hidden) form would keep stale typed values and stale project/agent lists.
- **Steps**:
  1. Open the modal, type Name `stale-probe`, Launch Command `echo stale`, expand advanced. Press Escape.
  2. Reopen the modal and confirm Name and Launch Command are empty, the advanced section is collapsed, and the Project select is back to its initial state.
  3. Repeat with a backdrop-click dismissal and with `✕` and confirm the same reset.
  4. Confirm the Working Directory field is empty and enabled again (it is disabled and mirrors the workdir only while a project is selected).
  5. (Optional, DB write) On `/projects`, create a throwaway project `uat-0176-probe` via the Add Project card, then without reloading open the modal and confirm `uat-0176-probe` is in the Project select. Cleanup: `curl -sS 'http://localhost:8788/api/projects' | jq '.[] | select(.name=="uat-0176-probe") | .id'`, then `curl -sS -X DELETE 'http://localhost:8788/api/projects/<id>'` (add `?force=true` only if the API asks for it and the project has no real agents).
- **Expected Result**: Every reopen shows an empty, collapsed form for all three dismissal paths; the optional project appears without a page reload.
- **Repeatable Unit Test**: Not applicable: the per-open refetch is unit-covered by UAT-EDGE-003, but field reset across a real remount and the throwaway project need a browser and the live API.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-09-18 -->

---

### UAT-UI-006: Existing background processes still render on the Agents page after the inline card was removed; the page loads without console errors
- **Page**: `http://localhost:4321/`
- **Component**: `frontend/src/pages/AgentsPage.tsx`, `frontend/src/components/AgentList.tsx` (`BgProcessSection`, `bg-update` SSE)
- **Description**: Regression check that removing the `AddBgProcessForm` import/element from `AgentsPage` did not disturb the bg-process listing (which is fed by the `bg-update` / `bg-removed` SSE events, not by the form).
- **Steps**:
  1. Hard-reload `/` with the browser console open.
  2. Confirm no console errors or React warnings (in particular none about `open` being undefined or about hook order).
  3. Compare the bg-process rows shown in the dashboard with `curl -sS 'http://localhost:8788/api/status' | jq -r '.bgProcesses[].name'`.
  4. Confirm the rows keep their status pill and actions (open/close window, remove) and the layout is intact with the inline card gone.
- **Expected Result**: Zero console errors; the listed bg processes match `/status`; row actions render as before.
- **Repeatable Unit Test**: Not applicable: live SSE stream, real host-server state and browser console.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-09-18 -->

---

### UAT-UI-007: (Opt-in, spawns a real process) A successful submit closes the modal and the new process appears in the list via SSE
- **Page**: `http://localhost:4321/`
- **Component**: `AddBgProcessForm.tsx` (201 branch: reset + `onClose()`), `AgentList.tsx` (`bg-update` handler)
- **Description**: The end-to-end success path the task explicitly deferred to UAT. This creates a real tmux window, sends a launch command to it, and inserts a `bg_processes` row. Skip in any environment where that is not acceptable, and record "skipped" rather than passing it.
- **Steps**:
  1. Confirm a conductor tmux session is running (`curl -sS 'http://localhost:8788/api/status' | jq '.sessionExists'` is `true`). If not, skip.
  2. Click `+ Add Background Process`, select any project, enter Name `uat-0176-probe`, Launch Command `sleep 600` (harmless), leave advanced collapsed, click `Spawn Process`.
  3. Observe the button flip to `Spawning…`, then the modal close on its own with no inline "Process spawned ✓" message anywhere.
  4. Within a few seconds confirm a `uat-0176-probe` row appears in the Bg Processes section (via `bg-update`) with a running status.
  5. Reopen the modal and confirm it is empty (form was reset).
  6. **Cleanup (required)**: `curl -sS -X DELETE 'http://localhost:8788/api/bg-processes/uat-0176-probe'` and confirm the row disappears and the tmux window is gone.
- **Expected Result**: Modal closes itself on success; no inline success text; the new process appears without a reload; the reopened form is empty; cleanup removes the row and window.
- **Repeatable Unit Test**: Not applicable: real tmux window, DB write and SSE; the close-on-201 callback is covered by UAT-EDGE-002.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk (opt-in; spawns a real tmux window and DB row; dev server :4321 was down at run time)] <!-- 2026-09-18 -->

---

## Gaps

- **Cheap promotions MADE by /uat-auto on 2026-09-18** (tests only): all five candidates below were added to `AddBgProcessForm.test.tsx` (now 11 tests) and `NavBar.test.tsx` (now 18 tests) and pass. Original note follows. **Cheap promotions not made (this run was restricted to writing UAT/wiki files only, no code edits).** Candidates for `frontend/src/components/AddBgProcessForm.test.tsx` / `NavBar.test.tsx`, all runnable in the existing harness with no new infrastructure: (1) network-failure reject shows `Failed to spawn bg process` and does not close; (2) non-JSON 500 shows the same fallback error; (3) no "Process spawned" text after a 201; (4) `Link to Agent (optional)` lists agents from `/status` and the choice is sent as `linkedAgent`; (5) NavBar-level backdrop click and `✕` unmount the form (currently only Escape is exercised through `NavBar`; backdrop/`✕` are covered only at the form level). These were drafted and passed 28/28 during generation, then removed to honor the no-code-edit constraint.
- **`AgentsPage` has no test** asserting the inline card is gone; rendering it needs `AgentList`, SSE and API mocks (new harness). Covered by UAT-EDGE-004 (static) and UAT-UI-001/006 (browser).
- **Project select has no placeholder option.** `AddBgProcessForm.tsx` renders `value=''` (state `null`) with only real project options, so a browser may display the first project while state is still `null` and submit reports `Project is required`. Out of scope for this task (TASK-161 select; the task says not to change the project-required rule) but worth a human's eye during UAT-UI-004 step 1.
- **`index.astro`** appears to be dead code (see UAT-EDGE-005); it is not edited here.
