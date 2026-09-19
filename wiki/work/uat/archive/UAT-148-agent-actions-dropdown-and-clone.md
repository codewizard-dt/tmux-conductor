---
id: UAT-148
aliases: [UAT-148]
title: "UAT: Collapse AgentDetailModal actions into a 3-dot dropdown and add Clone"
status: passed
task: TASK-148
created: 2026-09-13
updated: 2026-09-13
---

# UAT-148 — UAT: Collapse AgentDetailModal actions into a 3-dot dropdown and add Clone

implements::[[TASK-148]]

> **Source task**: [[TASK-148]]
> **Generated**: 2026-09-13

---

## Prerequisites

- [ ] Host-server running on `:8788` (`BACKEND_PORT`, per `.env.example`) — `make dev` or `npm run dev --workspace host-server`.
- [ ] Frontend dev server running on `:4321` (`FRONTEND_PORT`) for the UI cases — `make dev` or `npm run dev --workspace ui`.
- [ ] At least one existing agent registered (with a real tmux window present, i.e. `windowPresent: true`) to clone from and to open `AgentDetailModal` against. For UAT-API-001..004, know its numeric id (`GET /agents` or the dashboard) — substitute it for the `1` placeholder in the curl commands below. Use an agent with no worktree (`worktreePath: null`) so the clone's own fields stay simple to assert on.
- [ ] At least 2 agents registered in the same project/scope, so `agentCount > 1` and the modal's prev/next nav controls render (needed only to confirm they still sit outside the new menu — not itself a new behavior under test).
- [ ] At least one agent with no live tmux window (`windowPresent: false`) visible in `InactiveAgentsPanel` (UAT-UI-006, UAT-UI-009).

---

## Test Cases

### UAT-API-001: Clone an agent — happy path creates a `<name>-copy` agent
- **Endpoint**: `POST /agents/:id/clone`
- **Description**: Verifies the new clone route (`host-server/index.ts:1457-1497`) derives a `-copy` name via `deriveCloneName` (`host-server/db.ts:538-549`), creates the new agent with the source's `workdir`/`launchCmd`/`role`/`projectId`, spawns its tmux window, and returns the same response shape as `POST /agents`.
- **Steps**:
  1. Note the source agent's `name`, `workdir`, `launchCmd`, `role`, and `projectId` beforehand (`GET /agents`).
  2. Run the curl command below as-is (substitute the source agent's real id for `1`).
  3. Confirm a new agent appears in `GET /agents` with a live tmux window.
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8788/api/agents/1/clone' | jq
  ```
- **Expected Result**: `201` with body `{ "ok": true, "agent": { "id": <new-id, different from 1>, "name": "<source-name>-copy", "workdir": "<identical to source>", "launchCmd": "<identical to source>", "projectId": <identical to source>, "role": "<identical to source>" } }`.
- **Repeatable Unit Test**: Not applicable — exercises the live HTTP route plus `spawnAgentWindow`'s real tmux side effect and the `agent-update` SSE broadcast, which need a running host-server and tmux session. The pure name-derivation logic this route calls is unit-tested directly under UAT-EDGE-001.
- [x] Pass <!-- 2026-09-13: Command block was missing the /api prefix (route is mounted at /api/agents/:id/clone, host-server/index.ts:1457/2291); fixed the Command above. Auto-judge already independently confirmed the corrected path returns 201 with the expected shape (POST /api/agents/20/clone → id 27, name "fe-research-copy-2", workdir/launchCmd/projectId/role matching source). -->

### UAT-API-002: Cloning the same source again resolves the collision to `<name>-copy-2`
- **Endpoint**: `POST /agents/:id/clone`
- **Description**: With `<source-name>-copy` now taken (from UAT-API-001), a second clone of the same source must fall back to `-copy-2` per `deriveCloneName`'s collision loop.
- **Steps**:
  1. Run UAT-API-001 first so `<source-name>-copy` already exists.
  2. Run the same curl command again against the same source id.
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8788/api/agents/1/clone' | jq
  ```
- **Expected Result**: `201` with body `{ "ok": true, "agent": { "id": <new-id, different from both prior ids>, "name": "<source-name>-copy-2", ... } }`.
- **Repeatable Unit Test**: Not applicable at the route level (same live-server/tmux dependency as UAT-API-001). The collision-avoidance chain itself (`-copy` → `-copy-2` → `-copy-3`) is unit-tested directly under UAT-EDGE-001.
- [x] Pass <!-- 2026-09-13: Re-verified at the corrected /api path. fe-research (id 20) already had a "-copy" (id 25, fe-research-copy) from UAT-API-001's prior run; POST /api/agents/20/clone again returned 201 with { ok: true, agent: { id: 27, name: "fe-research-copy-2", workdir/launchCmd/projectId/role identical to source } } — collision correctly resolved to -copy-2. -->

### UAT-API-003: 400 on a non-numeric agent id
- **Endpoint**: `POST /agents/:id/clone`
- **Description**: The route 400s before any DB lookup when `parseInt(req.params.id, 10)` is `NaN` (`host-server/index.ts:1458-1459`).
- **Steps**:
  1. Run the curl command below as-is.
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8788/api/agents/not-a-number/clone' | jq
  ```
- **Expected Result**: `400` with body `{ "error": "invalid agent id" }`.
- **Repeatable Unit Test**: Not applicable — a one-line `isNaN` guard on the live Fastify route; this repo's host-server tests (`node:test` against `db.ts`/`config.ts` functions) don't stand up the Fastify app, so exercising route-level parsing needs the live server this UAT already covers.
- [x] Pass <!-- 2026-09-13: Re-verified at the corrected /api path. curl -X POST /api/agents/not-a-number/clone -i returned HTTP/1.1 400 Bad Request with body {"error":"invalid agent id"} — exact match. -->

### UAT-API-004: 404 when the source agent doesn't exist
- **Endpoint**: `POST /agents/:id/clone`
- **Description**: The route 404s with the same error shape `DELETE /agents/:id` uses when `getAgentById` finds nothing (`host-server/index.ts:1461-1464`).
- **Steps**:
  1. Run the curl command below as-is, using an id that is not a real agent (e.g. a very large number).
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8788/api/agents/999999/clone' | jq
  ```
- **Expected Result**: `404` with body `{ "error": "agent 999999 not found" }`.
- **Repeatable Unit Test**: Not applicable — same live-route-parity reasoning as UAT-API-003; `getAgentById` returning `undefined` for an unknown id is a pre-existing, already-covered helper, and the 404-shape mapping is a two-line route branch that only exists on the live Fastify instance.
- [x] Pass <!-- 2026-09-13: Re-verified at the corrected /api path. curl -X POST /api/agents/999999/clone -i returned HTTP/1.1 404 Not Found with body {"error":"agent 999999 not found"} — exact match. -->

### UAT-UI-001: The header shows one 3-dot actions menu instead of three flat buttons, with four items in order
- **Page**: Dashboard SPA (`http://localhost:4321`) — an agent's detail modal header
- **Component**: `frontend/src/components/AgentList.tsx` (`AgentDetailModal`, `agentActionItems` at `AgentList.tsx:709-739`) rendering `frontend/src/components/AgentActionsMenu.tsx`
- **Description**: The old three flat buttons (Rename/Close agent/Remove agent) are gone, replaced by a single trigger with `aria-label="Agent actions"` and `aria-haspopup="true"`. Opening it shows a `role="menu"` panel with items in the fixed order: Rename, Close agent (only when the agent has a live window), Remove agent, Clone.
- **Steps**:
  1. Open an agent's detail modal for an agent with a live tmux window (`windowPresent: true`).
  2. Confirm there is exactly one button labeled "Agent actions" in the header (no separate "Rename"/"Close agent"/"Remove agent" buttons visible).
  3. Click it.
  4. Read the menu items top to bottom.
- **Expected Result**: The trigger renders the 3-dot (lucide `EllipsisVertical`) icon and toggles `aria-expanded` to `true` on click; the opened panel lists exactly: Rename, Close agent, Remove agent, Clone — in that order.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`describe('AgentDetailModal actions menu wiring (TASK-148)')`, `it('lists Rename, Close agent, Remove agent, Clone in order for a windowPresent agent')`) — added once TASK-153's concurrent edits to this file settled; asserts the exact `agentActionItems` composition/order through the real menu.
- **Unit Test Command**: `npx vitest run src/components/AgentList.test.tsx` (run from `frontend/`)
- [x] Pass <!-- 2026-09-13: Live-verified via Playwright against cryptwiz-1-copy (windowPresent:true). Modal header shows exactly one "Agent actions" button (aria-haspopup=true); no separate Rename/Close agent/Remove agent buttons present. Clicking it toggled aria-expanded to true and opened a role="menu" panel with items in order: Rename, Close agent, Remove agent, Clone. Screenshot: tmp/uat148/ui001-menu-open.png. -->

### UAT-UI-002: Keyboard-only operation — Tab to trigger, Enter opens and focuses the first item, arrow keys move focus, Enter activates
- **Page**: Dashboard SPA (`http://localhost:4321`) — an agent's detail modal header
- **Component**: `frontend/src/components/AgentActionsMenu.tsx`
- **Description**: Verifies the WAI-ARIA "Actions Menu Button" keyboard pattern: `Enter`/`Space` on the trigger opens the menu and focuses the first enabled item; `ArrowDown`/`ArrowUp` move a roving `tabIndex` focus between items (wrapping, skipping any disabled item); `Enter`/`Space` on a focused item activates it.
- **Steps**:
  1. Open an agent's detail modal.
  2. Tab until the "Agent actions" trigger has focus.
  3. Press Enter — confirm the menu opens and the "Rename" item is focused.
  4. Press ArrowDown repeatedly — confirm focus moves Rename → Close agent (if present) → Remove agent → Clone, wrapping back to Rename.
  5. Press ArrowUp — confirm focus moves backward, wrapping from Rename to the last item.
  6. With "Rename" focused, press Enter — confirm the menu closes and the inline rename input appears in place of the trigger.
- **Expected Result**: All keyboard interactions behave as described; no mouse is used at any step.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentActionsMenu.test.tsx` (`it('opening via Enter on the trigger skips a disabled first item and focuses the first enabled one')` and `it('ArrowDown/ArrowUp move roving focus between enabled items, wrapping and skipping a disabled item')` cover the generic open/roving-focus/wrap/skip-disabled mechanics this case exercises through the real menu items)
- **Unit Test Command**: `npx vitest run src/components/AgentActionsMenu.test.tsx` (run from `frontend/`)
- [x] Pass <!-- 2026-09-13: Live-verified via Playwright. Focusing the trigger and pressing Enter opened the menu with "Rename" focused; ArrowDown cycled focus Rename to Close agent to Remove agent to Clone, then wrapped back to Rename; ArrowUp from Rename wrapped to Clone (the last item). Enter on the focused "Rename" item closed the menu and swapped the trigger for the focused, pre-filled inline input. -->

### UAT-UI-003: First Escape closes the menu and returns focus to the trigger; a second Escape then closes the modal
- **Page**: Dashboard SPA (`http://localhost:4321`) — an agent's detail modal header
- **Component**: `frontend/src/components/AgentActionsMenu.tsx` + `frontend/src/components/AgentList.tsx` (`AgentDetailModal`'s own document-level Escape-closes listener)
- **Description**: The menu's own `Escape` handler calls `stopPropagation()` so the first Escape only closes the menu (and returns focus to the trigger) without also closing the modal; a second, separate Escape press (menu already closed) is then free to reach the modal's existing Escape-closes-modal listener.
- **Steps**:
  1. Open an agent's detail modal.
  2. Open the actions menu (click or Enter on the trigger).
  3. Press Escape once — confirm only the menu closes (modal stays open) and keyboard focus returns to the "Agent actions" trigger.
  4. Press Escape a second time — confirm the modal itself now closes.
- **Expected Result**: Exactly as described — one Escape to close the menu, a second to close the modal; the trigger visibly has focus after step 3.
- **Repeatable Unit Test**: Created (menu half only): `frontend/src/components/AgentActionsMenu.test.tsx` (`it('Escape closes the menu, stops propagation to an ancestor keydown handler, and returns focus to the trigger')` — asserts the menu closes, focus returns to the trigger, and an ancestor `onKeyDown` handler is never invoked, i.e. propagation is stopped). The second-Escape-closes-the-modal half is `AgentDetailModal`'s pre-existing, unchanged listener and needs the full modal harness to assert in isolation from real DOM focus — not covered by a new unit test this pass.
- **Unit Test Command**: `npx vitest run src/components/AgentActionsMenu.test.tsx` (run from `frontend/`)
- [x] Pass <!-- 2026-09-13: Live-verified via Playwright. With the menu open, one Escape closed only the menu (the dialog stayed in the DOM, and document.activeElement moved back to the "Agent actions" trigger); a second Escape then closed the modal (dialog removed from the DOM). -->

### UAT-UI-004: Clicking outside the open menu closes it
- **Page**: Dashboard SPA (`http://localhost:4321`) — an agent's detail modal header
- **Component**: `frontend/src/components/AgentActionsMenu.tsx`
- **Description**: A `document` `mousedown` listener (attached only while open) closes the menu when the click lands outside its wrapper.
- **Steps**:
  1. Open an agent's detail modal.
  2. Open the actions menu.
  3. Click anywhere outside the menu panel (e.g. the modal header background).
- **Expected Result**: The menu closes; `aria-expanded` on the trigger returns to `false`.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentActionsMenu.test.tsx` (`it('clicking outside the menu closes it')`)
- **Unit Test Command**: `npx vitest run src/components/AgentActionsMenu.test.tsx` (run from `frontend/`)
- [x] Pass <!-- 2026-09-13: Live-verified via Playwright. With the menu open, clicking the modal header background (outside the menu panel) closed the menu (role="menu" removed from the DOM, trigger's aria-expanded back to false) while the modal itself stayed open. -->

### UAT-UI-005: Rename is still reachable and works through the new menu
- **Page**: Dashboard SPA (`http://localhost:4321`) — an agent's detail modal header
- **Component**: `frontend/src/components/AgentList.tsx` (`handleRename`/`renameAgent`, unchanged; only the entry point moved into the menu)
- **Description**: Regression-of-access-path check — selecting "Rename" from the menu swaps the trigger for the same inline `<input>` + Save/Cancel the old flat button used to reveal.
- **Steps**:
  1. Open an agent's detail modal, open the actions menu, select "Rename".
  2. Confirm the trigger is replaced by a focused text input pre-filled with the agent's current name, plus Save/Cancel buttons.
  3. Type a new valid name and press Enter (or click Save).
  4. Confirm the modal header now shows the new name and the trigger is back in place of the input.
  5. Repeat, but press Escape (or click Cancel) instead — confirm the rename is discarded and the trigger reappears unchanged.
- **Expected Result**: Rename still saves/cancels exactly as before TASK-148; only how you reach the input (via the menu instead of a visible "Rename" button) has changed.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`it('selecting Rename closes the menu and swaps the trigger for the pre-filled inline input')`)
- **Unit Test Command**: `npx vitest run src/components/AgentList.test.tsx` (run from `frontend/`)
- [x] Pass <!-- 2026-09-13: Live-verified via Playwright on a disposable clone (cryptwiz-1-copy). Selecting Rename from the menu swapped the trigger for a focused input pre-filled with the current name; typing a new name and pressing Enter saved it (modal header and the grid card updated, trigger reappeared). Reopening Rename and clicking Cancel discarded the edit, leaving the saved name unchanged. -->

### UAT-UI-006: Close agent is still reachable through the menu, unchanged confirmation message, omitted without a live window
- **Page**: Dashboard SPA (`http://localhost:4321`) — an agent's detail modal header
- **Component**: `frontend/src/components/AgentList.tsx` (`ConfirmDialog` at `AgentList.tsx:958-964`, unchanged)
- **Description**: Regression-of-access-path check — selecting "Close agent" from the menu still shows the existing `ConfirmDialog` with its unchanged message; the whole item is omitted from the menu (not just disabled) when the agent has no live tmux window.
- **Steps**:
  1. Open the detail modal for an agent with `windowPresent: true`, open the actions menu, select "Close agent".
  2. Confirm a dialog appears with message `Close agent "<name>"'s window? The agent stays registered and can be relaunched with "Create window".` and a "Close" confirm button.
  3. Confirm it, and confirm the agent's tmux window is killed while the agent stays registered.
  4. Open the detail modal for an agent with `windowPresent: false` (e.g. via `InactiveAgentsPanel`) and open its actions menu.
  5. Confirm there is no "Close agent" item in the list at all (Rename/Remove/Clone still present).
- **Expected Result**: Message text, confirm label, and omission-when-no-window behavior are all unchanged from before TASK-148 — only the entry point moved.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`it('selecting Close agent shows the unchanged ConfirmDialog message and "Close" confirm label')` for the message/confirm-label half; `it('omits the Close agent item entirely (not just disabled) when the agent has no live window')` for the `agent.windowPresent` omission half — `ConfirmDialog`'s own render/confirm/cancel mechanics remain covered separately by the pre-existing `frontend/src/components/ConfirmDialog.test.tsx`)
- **Unit Test Command**: `npx vitest run src/components/AgentList.test.tsx` (run from `frontend/`)
- [x] Pass <!-- 2026-09-13: Live-verified via Playwright on a disposable clone (windowPresent:true). Selecting "Close agent" showed the ConfirmDialog with a "Close" confirm button; message read exactly `Close agent "<name>"'s window and close this view? The agent stays registered and can be relaunched with "Create window".` `git show HEAD:frontend/src/components/AgentList.tsx` confirms this exact wording, including the "and close this view" clause, predates TASK-148 (the line is untouched by the current diff) — so this UAT's Expected text simply omits that pre-existing clause, and the tested claim (message unchanged from before TASK-148) holds. Confirming killed the tmux window (the agent then appeared under Inactive Agents, windowPresent:false via GET /api/status) while staying registered; reopening it from InactiveAgentsPanel showed the menu with Close agent correctly omitted (see UAT-UI-009). -->

### UAT-UI-007: Remove agent is still reachable through the menu with its unchanged confirmation message
- **Page**: Dashboard SPA (`http://localhost:4321`) — an agent's detail modal header
- **Component**: `frontend/src/components/AgentList.tsx` (`ConfirmDialog` at `AgentList.tsx:951-957`, unchanged)
- **Description**: Regression-of-access-path check for the destructive Remove action.
- **Steps**:
  1. Open an agent's detail modal, open the actions menu, select "Remove agent".
  2. Confirm a dialog appears with message `Remove agent "<name>"? This kills its tmux window, deletes it from conductor.conf, and drops its queued tasks.` and a "Remove" confirm button.
  3. Cancel it — confirm the agent is untouched and still present.
- **Expected Result**: Message text and confirm label are unchanged from before TASK-148; cancelling leaves the agent in place.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`it('selecting Remove agent shows the unchanged ConfirmDialog message and "Remove" confirm label')`)
- **Unit Test Command**: `npx vitest run src/components/AgentList.test.tsx` (run from `frontend/`)
- [x] Pass <!-- 2026-09-13: Live-verified via Playwright on a disposable inactive clone, opened via InactiveAgentsPanel. Selecting "Remove agent" showed the ConfirmDialog with message `Remove agent "<name>"? This kills its tmux window, deletes it from conductor.conf, and drops its queued tasks.` and a "Remove" confirm button — exact match. Clicking Cancel left the agent untouched, confirmed present via GET /api/status after cancelling. -->

### UAT-UI-008: Selecting Clone creates a new agent that appears live in the grid via SSE, with no page reload
- **Page**: Dashboard SPA (`http://localhost:4321`) — agent grid + an agent's detail modal
- **Component**: `frontend/src/components/AgentList.tsx` (`handleClone`, `AgentList.tsx:693-704`) + `frontend/src/lib/api.ts` (`cloneAgent`) + the `agent-update` SSE broadcast from `POST /agents/:id/clone`
- **Description**: Clone is non-destructive — no confirmation dialog — and fires immediately on selection; the new agent shows up in the grid purely from the existing SSE `agent-update` broadcast (`handleClone` does no local state patch).
- **Steps**:
  1. Open an agent's detail modal, open the actions menu, select "Clone".
  2. Without reloading the page, watch the main agent grid behind the modal.
  3. Confirm a new agent named `<name>-copy` (or `-copy-2`, etc., if one already exists) appears in the grid within a couple of seconds, with its own live tmux window.
- **Expected Result**: The new agent appears live via SSE with no manual refresh; if `cloneAgent` throws, the same error banner used for rename/close/remove failures shows the message (`renameError ?? closeError ?? removeError ?? cloneError` at `AgentList.tsx:832-834`).
- **Repeatable Unit Test**: Created (immediate-fire/no-dialog half only): `frontend/src/components/AgentList.test.tsx` (`it('selecting Clone fires POST /agents/:id/clone immediately with no confirmation dialog')` — asserts `handleClone` calls the clone endpoint on selection with no `ConfirmDialog` shown). The live-grid-appears-via-SSE half still requires a real backend/SSE connection and a running dev server, so it remains this UAT case's manual step; `handleClone`'s error-vs-success branching wraps a single `await cloneAgent(agent.id)` call with no further branching logic worth isolating, and `cloneAgent`'s HTTP-client contract is exercised end-to-end by UAT-API-001/002 above.
- **Unit Test Command**: `npx vitest run src/components/AgentList.test.tsx` (run from `frontend/`)
- [x] Pass <!-- 2026-09-13: Live-verified via Playwright on cryptwiz-1-copy. Selecting Clone fired immediately with no ConfirmDialog; the new agent appeared live in the grid (Ready/No tasks count incremented, a new card rendered) with no page reload, driven purely by the existing agent-update SSE broadcast, and the modal re-pointed itself at the newly cloned agent per handleClone's onCloned callback. -->

### UAT-UI-009: InactiveAgentsPanel shows the same actions dropdown for an inactive agent
- **Page**: Dashboard SPA (`http://localhost:4321`) — the "Inactive Agents" panel
- **Component**: `frontend/src/components/InactiveAgentsPanel.tsx:154` (renders the same exported `AgentDetailModal` from `AgentList.tsx` — confirmed via source read: no separate modal/menu implementation exists here)
- **Description**: TASK-148's one edit to `AgentDetailModal` covers both call sites; there is nothing additional to wire in `InactiveAgentsPanel.tsx`.
- **Steps**:
  1. Expand the "Inactive Agents" panel and open the detail modal for one of its agents (an agent with `windowPresent: false`).
  2. Confirm the header shows the same single "Agent actions" trigger (not the old three buttons), and opening it shows Rename, Remove agent, and Clone (Close agent omitted, per UAT-UI-006).
- **Expected Result**: Identical menu behavior to the main grid's modal — same component, same code path.
- **Repeatable Unit Test**: Not applicable — `InactiveAgentsPanel.tsx` imports and renders `AgentList.tsx`'s exported `AgentDetailModal` directly (verified via source read), so there is no separate logic path to unit-test here beyond what UAT-UI-001..008 and UAT-EDGE-001 already cover.
- [x] Pass <!-- 2026-09-13: Live-verified via Playwright. Opened the InactiveAgentsPanel row for a disposable inactive clone (windowPresent:false) — same "Agent actions" trigger in the header; opening it listed exactly Rename, Remove agent, Clone (Close agent omitted). Screenshot: tmp/uat148/ui009-inactive-menu.png. Confirms InactiveAgentsPanel renders the same AgentDetailModal component/code path as the main grid. -->

### UAT-EDGE-001: `deriveCloneName` avoids collisions across `-copy`/`-copy-2`/`-copy-3` and scopes collisions by `project_id`
- **Scenario**: `host-server/db.ts`'s `deriveCloneName` (`db.ts:538-549`) must (a) return `"<name>-copy"` when free, (b) walk `-copy-2`, `-copy-3`, … when taken, and (c) scope the collision check by `project_id` (per `idx_agents_project_name`/`idx_agents_null_name`) so a same-named `-copy` agent in a *different* project never blocks a project-scoped source agent, while one in the *same* project correctly does.
- **Steps**: Deterministic against an in-memory SQLite DB (`openDb(':memory:')`) — see the created unit test for the exact fixture sequence (global-scope collision chain up to `-copy-3`, then cross-project non-collision, then same-project collision).
- **Expected Result**: `deriveCloneName` returns `uat148-agent-copy` → `uat148-agent-copy-2` → `uat148-agent-copy-3` as the base name is progressively taken; a `<name>-copy` agent in a sibling project does not affect a project-scoped source's derived name, but one in the *same* project does (forcing `-copy-2`).
- **Repeatable Unit Test**: Created: `host-server/db.test.ts` (`test('TASK-148: deriveCloneName picks "<name>-copy", falls back to "-copy-2"/"-copy-3" on collision, and scopes collisions by project_id')`)
- **Unit Test Command**: `node --import tsx/esm --test db.test.ts` (run from `host-server/`) — verified passing (2/2 tests pass in the file, including the pre-existing TASK-126 test).
- [x] Pass <!-- 2026-09-13 -->
