---
id: TASK-0167
aliases: [TASK-0167]
title: "Allow switching an agent's role directly from the agent detail modal"
status: pending-uat
created: 2026-09-17
updated: 2026-09-17
depends_on: []
blocks: []
parallel_safe_with: []
uat: "[[UAT-0167]]"
tags: [frontend, backend, agents]
---

# TASK-0167 — Allow switching an agent's role directly from the agent detail modal

## Objective

An agent's `role` (`generic`, `frontend`, `backend`, `qa`, `devops`, `security`, `architect`) is currently only set at creation time (`POST /agents` / `POST /projects/:id/agents`) or copied verbatim on clone (`POST /agents/:id/clone`). There is no way to change an existing agent's role afterward short of editing the database directly. This task adds a role switcher to `AgentDetailModal`, mirroring the existing inline-rename UX (`AgentActionsMenu` → "Rename" → inline input → Save/Cancel), backed by a new optional `role` field on the existing `PATCH /agents/:id` route.

## Approach

**Backend** (`host-server/`):
- Extend `PATCH /agents/:id` (`host-server/index.ts` ~line 1406, currently `Body: { name?: string }`) to also accept an optional `role?: string`, validated against the already-imported `ROLE_VALUES` (`rolePresets.ts`) the same way `POST /agents` and `POST /projects/:id/agents` already validate it (`role !== undefined && (typeof role !== 'string' || !ROLE_VALUES.includes(role))` → 400). At least one of `name`/`role` must be present in the body; a body with neither is a 400 (mirror the existing `name` validation's error shape/style for `role`'s own error).
- Add `updateAgentRole(db, id, role)` to `host-server/db.ts`, next to `updateAgentName` — `UPDATE agents SET role=? WHERE id=?`, throwing on `changes === 0` (not found), same shape as `updateAgentName`.
- In the route handler, when `role` is present and valid, call `updateAgentRole` (in addition to / independent of the existing `name` handling — a request may change name, role, or both in one call).
- Broadcast the change over SSE so other open views (agent list, other modals) update live. Reuse the existing generic `'agent-update'` broadcast shape already used elsewhere in this file (e.g. the clone route, ~line 1497) rather than inventing a new event type — a full pollAndDiff-shaped payload with the new `role` value.
- **Explicit non-goal**: do NOT call `applyRoleFragmentToWorktree` on a role change. That function is documented as a creation-time worktree-provisioning step (injecting a role fragment into a *fresh* worktree's `CLAUDE.md`); retroactively rewriting a live agent's `CLAUDE.md` out from under it while it may be actively running is a materially different, riskier behavior change than this task's scope (a metadata/UI change) and is not requested here. If a future task wants that, it should be scoped and decided separately.

**Frontend** (`frontend/`):
- `frontend/src/lib/api.ts`: extend `renameAgent`'s route usage or add a sibling `updateAgentRole(agentId: number, role: string): Promise<ApiAgent>` that `PATCH`es `${API_BASE}/agents/${agentId}` with `{ role }` — mirror `renameAgent`'s existing structure (~line 311) exactly.
- `frontend/src/components/AgentList.tsx` (`AgentDetailModal`):
  - Add a `"Change role"` item to `agentActionItems` (the `AgentActionsMenu` array, ~line 789, next to the existing `"Rename"` item), opening a new small inline control — reuse the existing `showRenameInput`-style pattern: a `showRoleInput` boolean state, a `<select>` (not a free-text `<input>`, since role is a closed enum) populated from `ROLE_VALUES` (already exported from this same file, ~line 188), defaulting to the agent's current `agent.role`, with Save/Cancel buttons in the same visual slot the rename input currently occupies when active (~line 994-1025) — when `showRoleInput` is true, render the role `<select>` + Save/Cancel instead of `AgentActionsMenu`, same as the rename branch does today (both inline-edit modes are mutually exclusive with each other and with `AgentActionsMenu` — only one can be open at a time).
  - Add `handleChangeRole()` mirroring `handleRename()` (~line 750): call the new `updateAgentRole` API function, on success close the select and call an `onRoleChanged?.(agent.id, newRole)` callback prop (mirroring `onRenamed`) so the parent list can update its local state without waiting for the next poll/SSE tick.
  - Wire `onRoleChanged` up through whatever parent currently wires `onRenamed` into `AgentDetailModal`, updating the local `agents` array entry's `role` field the same way a rename updates `name`.
- `frontend/src/components/AgentList.test.tsx`: add tests mirroring the existing rename tests — opening the role switcher renders a `<select>` pre-filled with the agent's current role and all `ROLE_VALUES` options, changing the selection and clicking Save calls the new API function with the new role and fires `onRoleChanged`, Cancel discards the change without calling the API.

## Steps

### 1. Backend: PATCH /agents/:id role support  <!-- agent: general-purpose -->

- [x] In `host-server/db.ts`, add `updateAgentRole(db: Database.Database, id: number, role: string): Agent` next to `updateAgentName` (~line 672), following its exact shape (`UPDATE agents SET role=? WHERE id=?`, throw `Agent ${id} not found` on zero changes, return `findAgentById`).
- [x] In `host-server/index.ts`, extend the `PATCH /agents/:id` route's `Body` type to `{ name?: string; role?: string }` and its handler to also read/validate `role` against `ROLE_VALUES` (same 400 pattern as `POST /agents`'s own role validation, ~line 1026), requiring at least one of `name`/`role` to be present (400 if both are absent).
- [x] Call `updateAgentRole` when a valid `role` is present in the body; keep the existing `name`-only path unchanged when `role` is absent. Support both fields changing in the same request.
- [x] Broadcast an `'agent-update'` SSE event with the new role, reusing the existing broadcast shape from the clone route (~line 1497-1502) rather than a new event type.
- [x] Run the host-server typecheck and test suite (`cd host-server && npx tsc --noEmit && npm test`) — confirm no regressions.

<!-- Updated: 2026-09-17 -->
<!-- db.ts:678-682 added updateAgentRole. index.ts:13 imports it; PATCH /agents/:id (~1406-1500) rewritten: Body now {name?; role?}, 400 if both absent, role validated against ROLE_VALUES (mirrors POST /agents), name-change logic now gated on newName defined+changed (unchanged behavior for name-only requests), role-change logic independent so both fields can change in one request. agent-update broadcast reuses the spawn/respawn route's context-gathering pattern (closer fit than clone route for an existing agent) plus role: updated.role. tsc --noEmit clean; npm test 147/147 pass, no live server touched. -->

### 2. Frontend: API client  <!-- agent: general-purpose -->

- [x] In `frontend/src/lib/api.ts`, add `updateAgentRole(agentId: number, role: string): Promise<ApiAgent>` mirroring `renameAgent` (~line 311) exactly, PATCHing `{ role }` instead of `{ name }`.
- [x] Run `cd frontend && npx tsc --noEmit` — confirm no type errors.

<!-- Updated: 2026-09-17 -->
<!-- Added updateAgentRole to frontend/src/lib/api.ts lines 325-337, immediately after renameAgent, mirroring it exactly (PATCH {role} instead of {name}). tsc --noEmit clean. -->

### 3. Frontend: role switcher UI in AgentDetailModal  <!-- agent: general-purpose -->

- [x] In `frontend/src/components/AgentList.tsx`, add `showRoleInput`/`roleInput`/`changingRole`/`roleError` state mirroring the existing `showRenameInput`/`renameInput`/`renaming`/`renameError` state (~line 604-607).
- [x] Add a `"Change role"` entry to `agentActionItems` (~line 789), opening the role switcher (mirror the existing `"Rename"` entry's `onSelect`, ~line 791, seeding `roleInput` from `agent.role ?? 'generic'`).
- [x] Render a `<select>` populated from `ROLE_VALUES` (imported/already-defined in this file, ~line 188) in place of `AgentActionsMenu` when `showRoleInput` is true, with Save/Cancel buttons in the same visual slot as the rename input (~line 994-1025) — both inline-edit modes stay mutually exclusive.
- [x] Add `handleChangeRole()` mirroring `handleRename()` (~line 750): call `updateAgentRole(agent.id, roleInput)`, close the select on success, call `onRoleChanged?.(agent.id, roleInput)`.
- [x] Add an `onRoleChanged?: (agentId: number, role: string) => void` prop to `AgentDetailModal`'s props, wired up through the same parent path that already wires `onRenamed` (find via Serena `find_referencing_symbols` on `onRenamed`), updating the local agent list's `role` field for that agent id.
- [x] Run `cd frontend && npx tsc --noEmit` — confirm no type errors.

<!-- Updated: 2026-09-17 -->
<!-- Added showRoleInput/roleInput/changingRole/roleError state, a "Change role" menu item (mutually exclusive with "Rename" — each closes the other's input), a <select> populated from ROLE_VALUES with Save/Cancel in the same header slot as rename, handleChangeRole() mirroring handleRename(), onRoleChanged prop wired through the same AgentDetailModal call site as onRenamed with an optimistic setAgents update. roleError folded into the existing error-banner chain. Investigated AgentActionsMenu's self-close-on-select and the existing Escape-key ordering before assuming — no extra fix needed, new <select> mirrors the pre-existing pattern. tsc --noEmit clean. -->

### 4. Tests  <!-- agent: general-purpose -->

- [x] In `frontend/src/components/AgentList.test.tsx`, add tests mirroring the existing rename tests: opening the role switcher shows a `<select>` pre-filled with the agent's current role and every `ROLE_VALUES` option; changing the selection + Save calls `updateAgentRole` with the new role and fires `onRoleChanged`; Cancel discards without calling the API.
- [x] In `host-server/`, add or extend a route test for `PATCH /agents/:id` covering: valid `role` update (200, DB row updated), invalid `role` (400, same error shape as the create routes), a body with neither `name` nor `role` (400), and a body with both `name` and `role` (200, both updated).
- [x] Run the full frontend and host-server test suites (`cd frontend && npx vitest run`, `cd host-server && npm test`) and confirm green.

<!-- Updated: 2026-09-17 -->
<!-- Added a 3-test describe block to AgentList.test.tsx (~1318-1435): select pre-filled + all ROLE_VALUES options, Save calls PATCH {role} + fires onRoleChanged, Cancel is a no-op. Also fixed two pre-existing stale menu-item-list assertions (TASK-148 describe block) that hadn't been updated for the new "Change role" item added in step 3 — these were failing before this step touched them. host-server/db.test.ts: 2 new behavioral tests for updateAgentRole (updates only role, throws on nonexistent id; name+role both apply to the same row). host-server/rolePresets.test.ts: 3 static source-pinning tests for the route's validation shape — a true HTTP-level route test isn't possible since index.ts unconditionally calls fastify.listen() on import (would collide with the live host-server on :8788) and no HTTP test harness exists in this repo; followed the established precedent (sseRolePayloadParity.test.ts) of pinning validation/branching via source-text assertions, with the actual DB writes covered behaviorally in db.test.ts. Frontend: 151/151 pass. Host-server: 152/152 pass. -->

### 5. Manual verification  <!-- agent: general-purpose -->

- [DEFERRED-TO-UAT] Start the dev servers, open an existing agent's detail modal, use the new "Change role" action to switch its role, confirm the badge/pill elsewhere in the UI (agent list row, `AgentIdentityBadge`) reflects the new role without a manual refresh (via the SSE broadcast).
- [DEFERRED-TO-UAT] Confirm changing an agent's role does **not** modify its worktree's `CLAUDE.md` (if it has one) — this task's explicit non-goal.

<!-- Updated: 2026-09-17 -->
<!-- Runtime/browser verification is out of tackle's static-gates-only scope; deferred to UAT (/uat-generate + /uat-auto, human /uat-walk for the live-browser cases). -->
