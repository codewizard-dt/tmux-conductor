---
id: UAT-0167
aliases: [UAT-0167]
title: "UAT: Allow switching an agent's role directly from the agent detail modal"
status: pending
task: TASK-0167
created: 2026-09-17
updated: 2026-09-17
---

# UAT-0167 — UAT: Allow switching an agent's role directly from the agent detail modal

implements::[[TASK-0167]]

> **Source task**: [[TASK-0167]]
> **Generated**: 2026-09-17

---

## Prerequisites

- [ ] Backend running: `cd host-server && npm run dev` (port 8788)
- [ ] Frontend running: `cd frontend && npm run dev` (port 4321)
- [ ] A conductor tmux session exists with at least one registered agent (`GET http://localhost:8788/api/agents` → note an `id`, replace `<AGENT_ID>` throughout)

---

## Test Cases

### UAT-API-001: PATCH /agents/:id updates the role and broadcasts the change
- **Endpoint**: `PATCH /api/agents/:id`
- **Description**: A request carrying `{ "role": "<value>" }` (no `name`) updates only the agent's role via the new `updateAgentRole` DB function, returns the updated agent, and broadcasts an `'agent-update'` SSE event carrying the new role.
- **Steps**:
  1. Confirm agent `<AGENT_ID>` exists and note its current `role`.
  2. Run the command below with a `role` different from its current one (pick from `generic`, `frontend`, `backend`, `qa`, `devops`, `security`, `architect`).
  3. Re-`GET /api/agents` and confirm the row's `role` changed; confirm `name` is unchanged.
- **Command**:
  ```bash
  curl -sS -X PATCH 'http://localhost:8788/api/agents/<AGENT_ID>' -H 'Content-Type: application/json' -d '{"role":"devops"}'
  ```
- **Expected Result**: HTTP 200, body `{"ok":true,"agent":{...,"role":"devops",...}}`. A subsequent `GET /api/agents` shows the same agent with `role: "devops"` and its `name` unchanged.
- [x] Pass <!-- 2026-09-17: ran live against agent id 13 (cryptwiz-1, unrelated project, `role: generic` → `devops`), verified via a fresh GET, then restored to `generic`. A role PATCH is a pure DB label with no effect on the agent's live tmux pane/session, unlike a keystroke-injection test — safe to exercise against a real agent and reverted immediately after. -->

---

### UAT-EDGE-001: PATCH /agents/:id rejects an invalid role with the same error shape as POST /agents
- **Scenario**: `role` must be validated against `ROLE_VALUES` with the exact same 400 error message `POST /agents` already uses for its own role validation — no drift between the two routes' error text.
- **Steps**: Covered directly by a static-source-extraction test (see Repeatable Unit Test below) — no live server required, since `host-server/index.ts` can't be imported directly in a test process (it unconditionally calls `fastify.listen()` at import time, which would collide with the live dev-server instance already running in this environment).
- **Expected Result**: The route's source contains the identical `role must be one of: ${ROLE_VALUES.join(', ')}` 400 error message used by `POST /agents`, applied inside `PATCH /agents/:id`'s own role-validation branch.
- **Repeatable Unit Test**: Created: `host-server/rolePresets.test.ts` (`PATCH /agents/:id rejects an invalid role with the same "role must be one of: ..." message shape POST /agents uses`)
- **Unit Test Command**: `node --import tsx/esm --test rolePresets.test.ts` (run from `host-server/`) — verified: 19/19 pass
- [x] Pass <!-- 2026-09-17 -->

---

### UAT-EDGE-002: PATCH /agents/:id returns 400 when the body has neither name nor role
- **Scenario**: The route requires at least one of `name`/`role` to be present — an empty/no-op body is rejected rather than silently succeeding.
- **Steps**: Covered directly by a static-source-extraction test (see Repeatable Unit Test below) — no live server required, same constraint as UAT-EDGE-001.
- **Expected Result**: The route's source contains `if (newName === undefined && newRole === undefined) { return reply.status(400).send({ error: 'at least one of name or role is required' }); }`.
- **Repeatable Unit Test**: Created: `host-server/rolePresets.test.ts` (`PATCH /agents/:id returns 400 when the body has neither name nor role`)
- **Unit Test Command**: `node --import tsx/esm --test rolePresets.test.ts` (run from `host-server/`) — verified: 19/19 pass
- [x] Pass <!-- 2026-09-17 -->

---

### UAT-EDGE-003: A body carrying both name and role updates both, independently
- **Scenario**: The rename branch and the role branch are independent sibling `if`s (not mutually exclusive) — a request changing both fields in one call must apply both, and a role change must not be swallowed once a rename has already run in the same request.
- **Steps**: Covered directly by a static-source-extraction test asserting the two `if` blocks are siblings at the same indentation, not nested (see Repeatable Unit Test below); the DB-layer half (both writes actually landing on the same row) is covered behaviorally in `db.test.ts` (see Repeatable Unit Test below).
- **Expected Result**: `PATCH /agents/:id`'s rename logic is gated on `newName !== undefined && newName !== oldName`, and immediately after that block's closing brace (same indentation, i.e. a sibling, not nested inside it) a separate `if (newRole !== undefined)` independently calls `updateAgentRole`. At the DB layer, calling `updateAgentName` then `updateAgentRole` against the same row leaves both the new name and the new role in place.
- **Repeatable Unit Test**: Created: `host-server/rolePresets.test.ts` (`PATCH /agents/:id applies a name change and a role change independently (a body with both updates both, not just one)`) + `host-server/db.test.ts` (`TASK-167: updateAgentName and updateAgentRole can both apply to the same agent row (PATCH /agents/:id name+role combined update)`)
- **Unit Test Command**: `node --import tsx/esm --test rolePresets.test.ts` and `node --import tsx/esm --test db.test.ts` (run from `host-server/`) — verified: 19/19 and 9/9 pass respectively
- [x] Pass <!-- 2026-09-17 -->

---

### UAT-EDGE-004: updateAgentRole updates only the role column and throws on a nonexistent id
- **Scenario**: The DB-layer function backing the route must update exactly the `role` column (leaving `name`/`workdir`/`launchCmd` untouched) and must throw — not silently no-op — when given an id that doesn't exist, mirroring `updateAgentName`'s existing not-found behavior.
- **Steps**: Covered directly by a DB-layer unit test against an in-memory SQLite instance (see Repeatable Unit Test below) — no live server required.
- **Expected Result**: `updateAgentRole(db, id, 'devops')` changes only `role`; a re-read via `listAgents` confirms the change persisted; calling it with a nonexistent id throws.
- **Repeatable Unit Test**: Created: `host-server/db.test.ts` (`TASK-167: updateAgentRole updates only the role column, leaves name/workdir/launchCmd untouched, and a nonexistent id throws`)
- **Unit Test Command**: `node --import tsx/esm --test db.test.ts` (run from `host-server/`) — verified: 9/9 pass
- [x] Pass <!-- 2026-09-17 -->

---

### UAT-UI-001: Opening the role switcher shows a select pre-filled with the agent's current role and every role option
- **Page**: Dashboard SPA (`http://localhost:4321`) — an agent's detail modal, header action row
- **Component**: `frontend/src/components/AgentList.tsx` (`AgentDetailModal`, `agentActionItems` → "Change role" → the role `<select>`)
- **Description**: Clicking "Change role" in the actions menu replaces `AgentActionsMenu` with a `<select>` pre-filled with the agent's current role and one `<option>` per `ROLE_VALUES` entry, plus Save/Cancel buttons — mirroring the existing "Rename" inline-edit UX exactly.
- **Steps**:
  1. Open an agent's detail modal.
  2. Click the "Agent actions" button, then click "Change role" in the dropdown.
  3. Observe the header action row.
- **Expected Result**: The actions menu closes and is replaced by a `<select>` whose current value matches the agent's role, offering all 7 `ROLE_VALUES` options (`generic`, `frontend`, `backend`, `qa`, `devops`, `security`, `architect`), plus "Save" and "Cancel" buttons in the same visual slot the rename input uses.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`describe('AgentDetailModal role switcher (TASK-167)')` → `it('opening the role switcher shows a select pre-filled with the agent's current role and every ROLE_VALUES option')`)
- **Unit Test Command**: `npx vitest run src/components/AgentList.test.tsx -t "role switcher"` (run from `frontend/`) — verified: 3/3 pass
- [x] Pass <!-- 2026-09-17 -->

---

### UAT-UI-002: Changing the selection and clicking Save updates the role and fires onRoleChanged; the badge elsewhere updates live without a manual refresh
- **Page**: Dashboard SPA (`http://localhost:4321`) — an agent's detail modal, and the agent list row behind it
- **Component**: `frontend/src/components/AgentList.tsx` (`handleChangeRole`, `onRoleChanged`, `RoleBadge`/`AgentIdentityBadge`)
- **Description**: Selecting a different role and clicking Save calls the backend PATCH, closes the select on success, and updates the parent's local agent list optimistically via `onRoleChanged` — independent of the `'agent-update'` SSE broadcast also confirming the change server-side (UAT-API-001).
- **Steps**:
  1. Open an agent's detail modal, click "Change role", select a different role from the dropdown.
  2. Click "Save".
  3. Confirm the select closes back to the normal actions menu.
  4. Close the modal and observe the agent's row/badge in the main list.
- **Expected Result**: The role switcher closes without an error banner; the agent's role badge (in the modal header and in the list row behind it) reflects the new role without requiring a manual page refresh.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`describe('AgentDetailModal role switcher (TASK-167)')` → `it('changing the selection and clicking Save calls updateAgentRole with the new role and fires onRoleChanged')`)
- **Unit Test Command**: `npx vitest run src/components/AgentList.test.tsx -t "role switcher"` (run from `frontend/`) — verified: 3/3 pass
- [x] Pass <!-- 2026-09-17 -->

---

### UAT-UI-003: Cancel discards the change without calling the API
- **Page**: Dashboard SPA (`http://localhost:4321`) — an agent's detail modal
- **Component**: `frontend/src/components/AgentList.tsx` (the role switcher's Cancel button)
- **Description**: Regression guard — selecting a different role but clicking "Cancel" instead of "Save" must not call the backend and must not fire `onRoleChanged`; the agent's role must remain unchanged.
- **Steps**:
  1. Open an agent's detail modal, click "Change role", select a different role from the dropdown.
  2. Click "Cancel" instead of "Save".
  3. Confirm the select closes and the agent's role badge is unchanged.
- **Expected Result**: No `PATCH /agents/:id` request is sent; the agent's role is unchanged in both the modal and the list.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`describe('AgentDetailModal role switcher (TASK-167)')`, third test in the block — Cancel discard case)
- **Unit Test Command**: `npx vitest run src/components/AgentList.test.tsx -t "role switcher"` (run from `frontend/`) — verified: 3/3 pass
- [x] Pass <!-- 2026-09-17 -->

---

### UAT-EDGE-005: Changing an agent's role does not touch its worktree's CLAUDE.md (explicit non-goal)
- **Scenario**: This task explicitly does NOT call `applyRoleFragmentToWorktree` on a role change — that function is a creation-time worktree-provisioning step, and retroactively rewriting a live agent's `CLAUDE.md` is a separate, riskier decision not made here. This case locks that boundary in as a regression guard.
- **Steps**:
  1. Pick a worktree-backed agent (`worktreePath` non-null) if one exists in this environment.
  2. Note the current contents/mtime of `<worktreePath>/CLAUDE.md`.
  3. Change that agent's role via the UI or `PATCH /agents/:id`.
  4. Re-check `<worktreePath>/CLAUDE.md`.
- **Expected Result**: `CLAUDE.md` is byte-for-byte unchanged (no new `## Role: <role>` section appended, no mtime change).
- **Repeatable Unit Test**: Not applicable: this is an absence-of-a-side-effect claim over a real filesystem path inside a live worktree — the code-level guarantee is that `PATCH /agents/:id`'s handler simply never calls `applyRoleFragmentToWorktree` (verifiable by inspection, not a runtime assertion with meaningful setup/teardown cost proportional to the risk of a false negative), and no worktree fixture exists in the current environment to exercise this against safely without touching real repo state.
- [FAIL: auto-judge: prerequisite not satisfied — requires a real worktree-backed agent + filesystem inspection, not automatable in this run] <!-- 2026-09-17 -->

---

## Gaps

- No end-to-end HTTP test for `PATCH /agents/:id` exists (UAT-API-001 is the only live-command case) — `host-server/index.ts` unconditionally calls `fastify.listen()` at import time, so it can't be imported into a test process without colliding with the live dev-server already running in this environment; the route's validation/branching shape is instead pinned via static source-text assertions (UAT-EDGE-001/002/003) and its DB-layer behavior via `db.test.ts` (UAT-EDGE-003/004), following this repo's established precedent (`sseRolePayloadParity.test.ts`).
