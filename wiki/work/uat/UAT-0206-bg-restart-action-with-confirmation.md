---
id: UAT-0206
aliases: [UAT-0206]
title: "UAT: Add a Restart action with confirmation on each process in the Background tab and on the bg process tile"
status: pending
task: TASK-0206
created: 2026-09-20
updated: 2026-09-20
---

# UAT-0206 — UAT: Add a Restart action with confirmation on each process in the Background tab and on the bg process tile

implements::[[TASK-0206]]

> **Source task**: [[TASK-0206]]
> **Generated**: 2026-09-20

Verifies the dashboard Restart/Start action: `restartBgProcess` + `BgRestartResult` in `frontend/src/lib/api.ts`, the shared `frontend/src/components/BgRestartButton.tsx` (confirmation, in-flight guard, error and success states), its mounting on every row of `frontend/src/components/BackgroundProcessesTab.tsx` and on the `BgProcessRow` tile in `frontend/src/components/AgentList.tsx` (with the optimistic `handleBgRestarted` patch), and the fold-in `frontend/src/lib/bgLabel.ts` `bgQualifiedLabel` used by the Restart/Start, Remove and Close-window confirmations.

Cases UAT-INT-001 .. UAT-INT-011, UAT-EDGE-001 .. UAT-EDGE-005 and UAT-GATE-001 .. UAT-GATE-002 are **machine-executable** (file-scoped vitest / tsc / eslint from `frontend/`) and need no running server. Cases UAT-MAN-001 .. UAT-MAN-003 and UAT-API-001 are **Manual** live checks (real restart, real log marker, real audit record, real theming and keyboard behaviour); they run only against an **isolated scratch stack** (see Prerequisites), never against the live `:8788` server, the live conductor tmux session, or real `dev`/`dev-stack` bg processes. The live recipe TASK-0206 marked `[DEFERRED-TO-UAT]` is covered by UAT-MAN-001 .. UAT-MAN-002 and UAT-API-001; TASK-0208's UAT owns the end-to-end walk on the real stack.

---

## Prerequisites

- [ ] Working directory for the machine-executable cases is `frontend/` (`cd /Users/davidtaylor/Repositories/tmux-conductor/frontend`); dependencies installed (`node_modules` present).
- [ ] Manual cases only (UAT-MAN-*, UAT-API-001): an isolated scratch stack, never the real one:
  1. `mkdir -p tmp/uat-0206` at the repo root and copy `conductor.conf` to `tmp/uat-0206/conductor.conf`; in the copy set `SESSION_NAME="conductor-uat0206"`, `DB_PATH="./data/conductor.db"`, `LOG_DIR="./logs"`, `STATE_DIR="./logs/state"` (these resolve relative to the copy's directory, so the scratch DB, logs, state files and `bg-restarts.jsonl` land under `tmp/uat-0206/`). Do not use `/tmp` or `mktemp`.
  2. Start the scratch host-server from the repo root: `CONDUCTOR_CONF=$PWD/tmp/uat-0206/conductor.conf BACKEND_PORT=8798 npx tsx host-server/index.ts` (adjust to however `make dev` launches the host-server if it differs). It must use its own tmux server/session `conductor-uat0206`.
  3. Start a scratch frontend: `cd frontend && FRONTEND_PORT=4398 PROXY_TARGET=http://localhost:8798 npx vite`.
  4. **Gate A (server reachable)**: `curl -sS 'http://localhost:8798/api/status' | jq '.bgProcesses'` must respond (`[]` on the fresh scratch DB is fine); otherwise mark every manual case blocked.
  5. **Gate B (restart route exposed)**: `curl -sS -X POST 'http://localhost:8798/api/bg-processes/uat0206-nope/restart' | jq` must return `{"error":"bg process 'uat0206-nope' not found"}` (the real route's 404). A Fastify body like `{"message":"Route POST:/api/bg-processes/uat0206-nope/restart not found",...}` means the server is a stale build without the route: restart it and re-check; if still missing, mark every manual case blocked.
  6. In the scratch dashboard (`http://localhost:4398`) create one project `uat0206`, one agent in it, and two bg processes in it: `web` running `sh -c 'for i in $(seq 1 600); do echo "web line $i"; sleep 1; done'` and `db` running `sh -c 'for i in $(seq 1 600); do echo "db line $i"; sleep 1; done'`. Both must show `running`.
- [ ] Cleanup after the manual cases: stop both scratch processes and run `tmux kill-session -t conductor-uat0206`; leave `tmp/uat-0206/` in place (gitignored) or delete it.

---

## Test Cases

### UAT-INT-001: restartBgProcess sends a bodiless, header-less POST to the encoded-slug restart route and returns the result
- **Description**: The API helper issues `POST /bg-processes/<encodeURIComponent(slug)>/restart` with init exactly `{ method: 'POST' }`: no body and no `X-Conductor-Agent` header (a dashboard/human caller, cooldown-exempt server-side), and resolves with the server's `{ ok, name, restartedAt, mechanism }`.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: test `POSTs the encoded slug with no body and no X-Conductor-Agent header, returning the result` (describe `restartBgProcess (TASK-0206)`) passes.
- **Repeatable Unit Test**: Created: `frontend/src/lib/api.test.ts`
- **Unit Test Command**: `cd frontend && npx vitest run src/lib/api.test.ts -t "restartBgProcess"`
- [x] Pass <!-- 2026-09-20 -->

### UAT-INT-002: restartBgProcess maps every failure status to a readable message
- **Description**: `409` -> "The conductor tmux session is not running"; `404` -> "Process no longer exists (it may have been removed)"; `500` -> "Restart failed at step <step>" (plain "Restart failed" when no step); `429` -> "Restarted too recently, try again in <retryAfterS>s"; any other status -> the server `error` or `HTTP <status>` (also when the error body is not JSON); a fetch `TypeError` -> "Could not reach the host-server".
- **Steps**:
  1. Run the unit test command from UAT-INT-001 (same describe, all 10 tests).
- **Expected Result**: all `restartBgProcess (TASK-0206)` tests pass (10 tests).
- **Repeatable Unit Test**: Created: `frontend/src/lib/api.test.ts`
- **Unit Test Command**: `cd frontend && npx vitest run src/lib/api.test.ts -t "restartBgProcess"`
- [x] Pass <!-- 2026-09-20 -->

### UAT-INT-003: Clicking Restart only opens a confirmation; Cancel and Escape send nothing; the copy names the project and warns others are interrupted
- **Description**: A click on `Restart <name>` sends no request and opens the dialog `Restart "<name>" (project <project>)?` with the shared-resource message ("Stops the running process and starts it again with its saved launch command. Everyone in project <project> who is using it will be interrupted. Its earlier output is kept in the log, with a restart marker."). Cancel and Escape close it without a request.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: tests `opens the confirmation on click and sends nothing`, `names the project alongside the process in the dialog, and warns that others are interrupted`, `Cancel closes the dialog without a request`, `Escape closes the dialog without a request` pass.
- **Repeatable Unit Test**: Created: `frontend/src/components/BgRestartButton.test.tsx`
- **Unit Test Command**: `cd frontend && npx vitest run src/components/BgRestartButton.test.tsx -t "opens the confirmation|names the project alongside|Cancel closes|Escape closes"`
- [x] Pass <!-- 2026-09-20 -->

### UAT-INT-004: Confirm sends exactly one POST to the encoded slug with no X-Conductor-Agent header
- **Description**: Through the component, Confirm calls `POST .../bg-processes/<encoded slug>/restart` once, with no `X-Conductor-Agent` header and no body.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: test `Confirm POSTs the encoded slug to /restart with no X-Conductor-Agent header` passes.
- **Repeatable Unit Test**: Created: `frontend/src/components/BgRestartButton.test.tsx`
- **Unit Test Command**: `cd frontend && npx vitest run src/components/BgRestartButton.test.tsx -t "Confirm POSTs"`
- [x] Pass <!-- 2026-09-20 -->

### UAT-INT-005: In flight, the button is disabled and reads "Restarting…", and a second click cannot send a second request
- **Description**: While the request is unresolved the trigger is `disabled` with text `Restarting…`; clicking it neither reopens the dialog nor issues another request; once the request settles the button is enabled again.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: test `is disabled and reads "Restarting…" while in flight, and a second click sends nothing` passes.
- **Repeatable Unit Test**: Created: `frontend/src/components/BgRestartButton.test.tsx`
- **Unit Test Command**: `cd frontend && npx vitest run src/components/BgRestartButton.test.tsx -t "is disabled and reads"`
- [x] Pass <!-- 2026-09-20 -->

### UAT-INT-006: Success calls onRestarted with the result and shows a transient aria-live "Restarted" notice
- **Description**: On a 200 the component calls `onRestarted` once with the full result (including `restartedAt`, which TASK-0207 consumes), shows `Restarted` in an `aria-live="polite"` region, and clears it after about 3 s.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: test `calls onRestarted with the result and shows a transient "Restarted" notice` passes.
- **Repeatable Unit Test**: Created: `frontend/src/components/BgRestartButton.test.tsx`
- **Unit Test Command**: `cd frontend && npx vitest run src/components/BgRestartButton.test.tsx -t "calls onRestarted"`
- [x] Pass <!-- 2026-09-20 -->

### UAT-INT-007: The Background tab shows a Restart button on every row (Start for a stopped one), not nested in the row-select button
- **Description**: Every process row in the tab has its own button, label `Restart` (`aria-label` `Restart <name>`) when a window exists and `Start` (`Start <name>`) for a `stopped` process (a `stopped` process has no other action in the tab). The button is a sibling of the row-select button (buttons cannot nest), and clicking it does not change which row is selected. Also verified through the full `AgentList` detail pane.
- **Steps**:
  1. Run the two unit test commands below (component level, then integration).
- **Expected Result**: `renders a Restart button on every row, and a Start button for a stopped process`, `does not nest the restart button inside the row-select button`, `clicking Restart does not change the selected row` pass in `BackgroundProcessesTab.test.tsx`; `the tab shows Restart on every row (Start for a stopped one), and a successful restart optimistically flips the badge to running` passes in `AgentList.test.tsx`.
- **Repeatable Unit Test**: Created: `frontend/src/components/BackgroundProcessesTab.test.tsx`, `frontend/src/components/AgentList.test.tsx`
- **Unit Test Command**: `cd frontend && npx vitest run src/components/BackgroundProcessesTab.test.tsx src/components/AgentList.test.tsx -t "renders a Restart button on every row|does not nest|does not change the selected row|the tab shows Restart on every row"`
- [x] Pass <!-- 2026-09-20 -->

### UAT-INT-008: Restarting the selected process refreshes its tail immediately; restarting another one does not; both report the slug upward
- **Description**: After a confirmed restart of the *selected* row, the tab triggers one immediate tail refresh (well under the 2 s poll interval) so the `--- restart <ts> ---` marker shows up at once, and calls `onBgRestarted(slug)`. Restarting a *non-selected* row calls `onBgRestarted(<its slug>)` but does not refresh the selected process's tail.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: tests `confirming a restart of the selected process refreshes its tail immediately and reports the slug` and `restarting a non-selected process reports the slug without refreshing the selected tail` pass.
- **Repeatable Unit Test**: Created: `frontend/src/components/BackgroundProcessesTab.test.tsx`
- **Unit Test Command**: `cd frontend && npx vitest run src/components/BackgroundProcessesTab.test.tsx -t "refreshes its tail immediately|without refreshing"`
- [x] Pass <!-- 2026-09-20 -->

### UAT-INT-009: The tile shows Restart only while its window is present, with no duplicate Start next to Open window
- **Description**: In `BgProcessRow`, Restart renders only when `bg.windowPresent`; when the window is missing the existing `Open window` button is the only start affordance (no `Start <name>` button on the tile). The tile's confirmation names the project (`Restart "dev" (project alpha)?`) and clicking Restart sends nothing until confirmed. Two same-named processes in different projects each get their own button.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: test `shows Restart on a tile only while its window is present, and confirms with the project named` passes.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx`
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "shows Restart on a tile only while"`
- [x] Pass <!-- 2026-09-20 -->

### UAT-INT-010: On the tile, Restart sits between Edit and Close window
- **Description**: The task fixes the tile button order: `Edit`, `Restart <name>`, `Close window`. The first three action buttons of a tile with a live window must appear in exactly that order.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: test `places the tile Restart button between Edit and Close window` passes.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (test added by this UAT)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "between Edit and Close window"`
- [x] Pass <!-- 2026-09-20 -->

### UAT-INT-011: A successful restart optimistically flips the row's badge to running (tile and tab), hitting the right slug
- **Description**: After a confirmed restart the parent's `handleBgRestarted(slug)` patches `liveness: 'running'` and `windowPresent: true` for that slug only: an `exited` process's badge becomes `running` on the tile and in the Background tab, and exactly one `POST /bg-processes/<slug>/restart` is sent for the clicked row (the same-named sibling in another project is untouched).
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: tests `confirming Restart POSTs /bg-processes/:slug/restart for that row and optimistically flips its badge to running` and `the tab shows Restart on every row (Start for a stopped one), and a successful restart optimistically flips the badge to running` pass.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx`
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "optimistically flips"`
- [x] Pass <!-- 2026-09-20 -->

### UAT-EDGE-001: Every failure renders its mapped message with role="alert", re-enables the button, and is cleared by the next attempt
- **Scenario**: The restart request fails with 409, 404, 500 (with a step), 429, or a network error. The UI must never stay stuck: the inline `role="alert"` text is the mapped message, the button is enabled again, `onRestarted` is not called and no `Restarted` notice appears; a following attempt clears the previous error before it starts.
- **Steps**: Run the unit test command below.
- **Expected Result**: the four `renders the mapped message for a %i and re-enables the button` cases, `renders "Could not reach the host-server" on a network failure and re-enables the button`, and `clears a previous error when the next attempt starts` pass.
- **Repeatable Unit Test**: Created: `frontend/src/components/BgRestartButton.test.tsx`
- **Unit Test Command**: `cd frontend && npx vitest run src/components/BgRestartButton.test.tsx -t "renders the mapped message|Could not reach|clears a previous error"`
- [x] Pass <!-- 2026-09-20 -->

### UAT-EDGE-002: With no window the action is a Start with adapted copy
- **Scenario**: `windowPresent` is false (a `stopped` process in the tab). The trigger reads `Start` (`aria-label` `Start <name>`), the dialog title is `Start "<name>" (project <project>)?`, the message is `Starts <name>; its window is not running.` (no "Stops the running process" text), the confirm label is `Start`, and success shows `Started`.
- **Steps**: Run the unit test command below.
- **Expected Result**: test `is a "Start" with adapted copy when the window is not present` passes.
- **Repeatable Unit Test**: Created: `frontend/src/components/BgRestartButton.test.tsx`
- **Unit Test Command**: `cd frontend && npx vitest run src/components/BgRestartButton.test.tsx -t "adapted copy"`
- [x] Pass <!-- 2026-09-20 -->

### UAT-EDGE-003: A failed tile restart shows the mapped error inline and does not optimistically flip the badge
- **Scenario**: The restart route answers 409 while the tile's process is `exited`. The optimistic patch must only run on success: the inline alert reads `The conductor tmux session is not running`, the `exited` badge is unchanged (never shows `running`), and the Restart button is usable again.
- **Steps**: Run the unit test command below.
- **Expected Result**: test `a failed tile Restart shows the mapped error inline and leaves the badge unchanged` passes.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (test added by this UAT)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "failed tile Restart"`
- [x] Pass <!-- 2026-09-20 -->

### UAT-EDGE-004: Start on a stopped Background-tab row confirms with the adapted copy and flips the badge to running
- **Scenario**: A `stopped` process (no window) in the tab has only the `Start <name>` action. Through the full `AgentList` detail pane: the dialog reads `Start "db" (project alpha)?` / `Starts db; its window is not running.`, Confirm sends the restart request, and the row's badge changes from `stopped` to `running`.
- **Steps**: Run the unit test command below.
- **Expected Result**: test `Start on a stopped tab row confirms with the adapted copy and flips its badge to running` passes.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (test added by this UAT)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "Start on a stopped tab row"`
- [x] Pass <!-- 2026-09-20 -->

### UAT-EDGE-005: Remove and Close-window confirmations name the project when two projects each have a process called `dev`
- **Scenario**: Fold-in from TASK-0196: `name` is unique only per project, so a bare `"dev"` in a destructive confirmation is ambiguous. With `alpha-dev` and `beta-dev`, the tile's Remove confirmation reads `Remove background process "dev" (project alpha)?` and the Close-window confirmation reads `Close the window of "dev" (project beta)?` (via `bgQualifiedLabel`), and cancelling sends no request.
- **Steps**: Run the unit test command below.
- **Expected Result**: test `Remove and Close-window confirm dialogs name the project, not just the bare process name` passes.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx`
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "confirm dialogs name the project"`
- [x] Pass <!-- 2026-09-20 -->

### UAT-GATE-001: TASK-0206's files have no TypeScript diagnostics
- **Description**: `tsc --noEmit` reports nothing for the files TASK-0206 created or edited (`BgRestartButton.tsx`/`.test.tsx`, `BackgroundProcessesTab.tsx`/`.test.tsx`, `bgLabel.ts`, `lib/api.ts`/`api.test.ts`, `AgentList.test.tsx`). Scoped on purpose: the whole-project `tsc` also reports diagnostics from other in-flight sessions (an untracked `src/lib/lastPayload.ts`; TASK-0207's in-progress `onBgRestarted` signature change in `AgentList.tsx`) that are not attributable to this task. `AgentList.tsx` itself is therefore covered by the vitest gate below rather than by tsc here.
- **Steps**: Run the command below.
- **Command**:
  ```bash
  cd frontend && ! npx tsc --noEmit 2>&1 | grep -E 'BgRestartButton|BackgroundProcessesTab|bgLabel|src/lib/api\.(test\.)?ts|AgentList\.test'
  ```
- **Expected Result**: exit code 0 and no output (the `grep` finds no diagnostic line for those files).
- **Repeatable Unit Test**: Not applicable: this case is itself a deterministic static gate.
- [x] Pass <!-- 2026-09-20 -->

### UAT-GATE-002: ESLint is clean on TASK-0206's files and the four owning test files are green
- **Description**: No lint regressions in the new and edited files, and the restart wiring did not break sibling tests. Scoped to TASK-0206's files on purpose: `AgentList.tsx` is excluded from eslint because TASK-0207 is editing it concurrently (an unused `BgLastRestart` import there is not attributable to this task); the whole frontend suite is not run for the same reason.
- **Steps**: Run the command below.
- **Command**:
  ```bash
  cd frontend && npx eslint src/components/BgRestartButton.tsx src/components/BgRestartButton.test.tsx src/components/BackgroundProcessesTab.tsx src/components/BackgroundProcessesTab.test.tsx src/components/AgentList.test.tsx src/lib/api.ts src/lib/api.test.ts src/lib/bgLabel.ts && npx vitest run src/components/BgRestartButton.test.tsx src/components/BackgroundProcessesTab.test.tsx src/components/AgentList.test.tsx src/lib/api.test.ts
  ```
- **Expected Result**: eslint prints nothing; vitest reports 4 passed test files and 0 failures (289 tests at generation time; the count may grow if other tasks add tests to these files).
- **Repeatable Unit Test**: Not applicable: this case is itself a deterministic static gate.
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-001: A header-less restart is a dashboard caller: allowed, never 429 on a rapid repeat, and audit-logged as `dashboard` (scratch stack only)
- **Manual**: requires the isolated scratch stack from Prerequisites (Gate A and Gate B passed, processes `web`/`db` running). Never run against the live `:8788` server or real bg processes.
- **Endpoint**: `POST /api/bg-processes/uat0206-web/restart`
- **Auth-Required**: false (no `X-Conductor-Agent` header, exactly what the dashboard sends)
- **Description**: The frontend sends no `X-Conductor-Agent`; the server must treat it as a `human`/`dashboard` caller (TASK-0193/0194): allowed, exempt from the agent cooldown, and still audit-logged.
- **Steps**:
  1. Run the curl command below, then run it again immediately (within a second).
  2. Inspect the audit log: `tail -n 2 tmp/uat-0206/logs/bg-restarts.jsonl | jq '{bg, callerKind, outcome}'`.
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8798/api/bg-processes/uat0206-web/restart' | jq
  ```
- **Expected Result**: both calls return HTTP 200 with `{"ok":true,"name":"uat0206-web","restartedAt":"<ISO timestamp>","mechanism":"<string>"}` (the second is not a 429 `restart cooldown`); the audit log gains two records with `"bg":"uat0206-web"`, `"callerKind":"dashboard"`, `"outcome":"restarted"`.
- **Repeatable Unit Test**: Not applicable: needs the real host-server, a real tmux window and the log file on disk (the header-less request shape itself is covered by UAT-INT-001 and UAT-INT-004; the server-side caller rule by UAT-0193/UAT-0194).
- [FAIL: auto-judge: prerequisite not satisfied — isolated scratch stack (Prerequisites step 2: host-server, tmux session, and dashboard project/agent/bg-process creation) requires manual UI setup, unverifiable in headless mode] <!-- 2026-10-17 -->

### UAT-MAN-001: Restart from the Background tab: Cancel once, then confirm; marker appears, badge stays running, notice shows (scratch stack only)
- **Manual**: same scratch stack and gates as UAT-API-001. Never run against real bg processes.
- **Page**: `http://localhost:4398`, Agents page, scratch agent in project `uat0206`, Background tab
- **Steps**:
  1. Select the scratch agent, open `Background (2)`, select the `web` row and note the last `web line N` in the output panel.
  2. Click `Restart web`. Confirm the dialog title reads `Restart "web" (project uat0206)?` and the message warns that everyone in project uat0206 using it will be interrupted. Click Cancel. Confirm the output shows no `--- restart <ts> ---` marker, the `web line N` counter keeps counting up (process not interrupted), and `tail -n 1 tmp/uat-0206/logs/bg-restarts.jsonl` has no new record.
  3. Click `Restart web` again and confirm with `Restart`. Observe the button.
  4. Within a moment (well under the 2 s poll, thanks to the immediate refresh), look at the output panel; then wait about 3 s.
  5. Inspect `tail -n 1 tmp/uat-0206/logs/bg-restarts.jsonl | jq '{bg, callerKind, outcome}'`.
- **Expected Result**: step 3 the button is disabled and reads `Restarting…` while the request runs, then `Restarted` appears next to it and disappears after about 3 s; step 4 the output shows a `--- restart <ts> ---` divider with the earlier lines kept above it and `web line 1` restarting below it, and the `web` badge is `running` throughout; step 5 the record is `{"bg":"uat0206-web","callerKind":"dashboard","outcome":"restarted"}`. `db` is untouched (its counter never resets).
- **Repeatable Unit Test**: Not applicable: needs a real tmux window, real log capture and the audit file (the click/confirm/cancel state machine is UAT-INT-003 .. UAT-INT-006 and the tail refresh is UAT-INT-008).
- [FAIL: auto-judge: prerequisite not satisfied — isolated scratch stack requires manual UI setup, unverifiable in headless mode; also a UI test requiring human verification] <!-- 2026-10-17 -->

### UAT-MAN-002: Restart from the tile, then close the window: the tab row becomes Start while the tile shows only Open window (scratch stack only)
- **Manual**: same scratch stack and gates as UAT-API-001.
- **Page**: `http://localhost:4398`, Agents page with no agent selected (bg process tiles), then the scratch agent's Background tab
- **Steps**:
  1. With no agent selected, find the `db` tile. Confirm its buttons read, in order, `Edit`, `Restart`, `Close window`, `Remove`. Click `Restart` -> confirm; verify `Restarted` shows and `db line N` restarts from 1 (`tmux capture-pane -p -t conductor-uat0206:uat0206-db` or the tab output).
  2. Click `Close window` on the `db` tile and confirm; the confirmation must read `Close the window of "db" (project uat0206)?`. Wait for the tile to update.
  3. Confirm the `db` tile now shows `Open window` and **no** Restart/Start button. Open the scratch agent's Background tab and confirm the `db` row now has a `Start` button (aria-label `Start db`) and a `stopped` badge.
  4. Click `Start db`, confirm the dialog copy is `Starts db; its window is not running.`, confirm with `Start`; verify `Started` shows, the badge returns to `running`, and the tile shows `Restart` again.
- **Expected Result**: all four observations hold; nothing else (the `web` process, other windows) is disturbed.
- **Repeatable Unit Test**: Not applicable: real window lifecycle and SSE reconciliation are not observable in jsdom (button order, Start-only-in-tab and optimistic patching are covered by UAT-INT-007, UAT-INT-009, UAT-INT-010, UAT-INT-011 and UAT-EDGE-004).
- [FAIL: auto-judge: prerequisite not satisfied — isolated scratch stack requires manual UI setup, unverifiable in headless mode; also a UI test requiring human verification] <!-- 2026-10-17 -->

### UAT-MAN-003: The confirmation dialog and result states are legible in both themes and fully keyboard-operable (scratch stack only)
- **Manual**: same scratch stack and gates as UAT-API-001.
- **Page**: `http://localhost:4398`, Background tab and a tile
- **Steps**:
  1. In light theme open the Restart dialog from the tab, screenshot it; switch to dark theme and repeat. Confirm the title, the shared-resource warning and both buttons are readable, and that the confirm button uses the dialog's existing style (no new colours).
  2. Trigger a failure to see the inline error: stop the scratch tmux session (`tmux kill-session -t conductor-uat0206`), then confirm a Restart. Confirm the red inline error reads `The conductor tmux session is not running`, is readable in both themes, and the button is usable again. Restart the scratch host-server/session afterwards if further cases remain.
  3. Keyboard only: Tab to `Restart web`, press Enter to open the dialog, press Escape (closes, nothing sent), reopen and confirm with the keyboard; verify the button shows a visible focus ring and focus is not lost after the dialog closes.
- **Expected Result**: all observations hold in both themes; no request is sent on Escape; the keyboard path completes a restart.
- **Repeatable Unit Test**: Not applicable: colour contrast, focus rings and real keyboard focus management are visual/browser behaviour (the Escape/Cancel no-request behaviour is UAT-INT-003 and the error text is UAT-EDGE-001).
- [FAIL: auto-judge: prerequisite not satisfied — isolated scratch stack requires manual UI setup, unverifiable in headless mode; also a UI test requiring human verification] <!-- 2026-10-17 -->

---

## Gaps and notes

- **500 message wording.** The task text says the `500` message is "Restart failed at step <step>: <error>"; the implementation renders "Restart failed at step <step>" (and "Restart failed" without a step), and the tests encode that. The server's `500` body carries the fixed string `restart failed` as its `error`, so appending it would only repeat the prefix ("Restart failed at step X: restart failed"); the step is the informative part. Recorded as an accepted deviation, not tested as a gap.
- **Enter-key double fire.** The task mentions that "a second click or Enter" cannot fire a second request. The tests cover a second click while in flight; the dialog closes on confirm and the trigger is disabled, and the guard is a synchronous ref. There is no jsdom-observable Enter path distinct from the click, so keyboard behaviour is verified manually in UAT-MAN-003.
- **AgentList.tsx not typechecked/linted here.** At generation time TASK-0207 was editing `AgentList.tsx` concurrently (`BgLastRestart` unused import; `onBgRestarted` now typed `(slug, result)`), which makes whole-file tsc/eslint fail for reasons outside TASK-0206. UAT-GATE-001/002 therefore scope around it; `AgentList.tsx` behaviour is covered by the vitest cases. Re-run whole-project `npx tsc --noEmit` once TASK-0207 lands.
- **`lastRestart` is intentionally not patched** by TASK-0206's optimistic update (that is TASK-0207's), so no case asserts it.
- Tests added by this UAT (not in the implementer's original set), all in `frontend/src/components/AgentList.test.tsx`: `places the tile Restart button between Edit and Close window` (UAT-INT-010), `a failed tile Restart shows the mapped error inline and leaves the badge unchanged` (UAT-EDGE-003), `Start on a stopped tab row confirms with the adapted copy and flips its badge to running` (UAT-EDGE-004).
- Live end-to-end verification on the real stack remains owned by TASK-0208's UAT; the manual cases here run only on a scratch stack.
