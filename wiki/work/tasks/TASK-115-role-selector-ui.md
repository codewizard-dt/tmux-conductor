---
id: TASK-115
aliases: [TASK-115]
title: "Role selector — dropdown in AddAgentForm and the project-spawn UI in ProjectList"
status: pending-uat
created: 2026-08-15
updated: 2026-08-21
depends_on: [TASK-111]
blocks: []
parallel_safe_with: [TASK-113, TASK-114]
uat: "[[UAT-115]]"
tags: [frontend, ui, roles, roadmap-010]
---

# TASK-115 — Role selector — dropdown in AddAgentForm and the project-spawn UI in ProjectList

depends_on::[[TASK-111]]

## Objective

Let an operator pick a role (`generic`, `frontend`, `backend`, `qa`, `devops`, `security`, `architect`) when spawning a new agent, in both places an agent can be spawned from: the free-form path in `AddAgentForm` (`POST /agents`) and the project-scoped one-click spawn in `ProjectList`/`ProjectDetailPage` (`POST /projects/:id/agents`). The chosen role must reach `createAgent()` so TASK-113's spawn-time CLAUDE.md fragment write actually has a role to act on — this task is the only place a human ever supplies that value.

## Approach

**`AddAgentForm.tsx`** (`frontend/src/components/AddAgentForm.tsx`) already has a `<select>`-based dropdown pattern to mirror exactly: the "Launch Agent" preset selector (lines 369-386, `<select id="agent-launch-preset" value={launchPreset} onChange={...} className={inputCls}>` with `LAUNCH_COMMAND_PRESETS.map(...)`). Add a `role` field the same way — a controlled `<select>` state var (`const [role, setRole] = useState<string>('generic')`), defaulting to `'generic'`, with the 7 enum values as `<option>`s. Decide whether it belongs in the main two-column grid (Name/Working Directory, lines 317-357) or under "Show advanced" (lines 359-401, where Launch Command already lives) — role selection feels like a primary decision an operator makes every spawn, not a rarely-touched advanced setting, so prefer placing it in the main visible area (e.g. its own row below the Name/Workdir grid) over burying it behind "Show advanced". Thread the selected `role` into both submission paths in `handleSubmit()` (line 64-123): the free-form `fetch(`${API_URL}/agents`, ...)` call (line 103-107, add `role` to the JSON body) and the project-scoped `spawnAgentInProject(...)` call (line 82, needs a new optional 4th parameter — see below). Reset `role` to `'generic'` in `clearOnSuccess()` (line 69-77) alongside the other field resets.

**`spawnAgentInProject()`** (`frontend/src/lib/api.ts:289-307`) currently takes `(projectId, name?, launchCmd?)` and POSTs to `/projects/:id/agents` with `{ name?, launchCmd? }` (backend route at `host-server/index.ts:1893`, body type `{ name?: unknown; launchCmd?: unknown }`). Add a 4th optional `role?: string` parameter, included in the JSON body the same conditional way `name`/`launchCmd` already are (`...(role !== undefined ? { role } : {})`). The backend route's body type and handler need the matching `role?: unknown` field, validated against the same 7-value enum as TASK-111's `POST /agents` validation (extract a shared validator/constant if one doesn't already exist after TASK-111, rather than duplicating the enum list a third time — check whether TASK-111 exported anything reusable, e.g. from `rolePresets.ts`'s `ROLE_VALUES` if TASK-112 landed first, or inline the same 7-value array if not).

**`ProjectList.tsx`**'s spawn action (line 37, `await spawnAgentInProject(project.id)`) is currently a single button with no form at all — no name/launchCmd inputs either. Adding a role *dropdown* here means introducing the project's first piece of spawn-time UI beyond a bare button: a small inline `<select>` next to (or replacing) the "Spawn" button, defaulting to `'generic'`, whose current value is passed as the 4th arg to `spawnAgentInProject(project.id, undefined, undefined, role)`. Check whether `ProjectDetailPage.tsx` (which also calls `spawnAgentInProject(project.id)` at line 60) should get the same treatment — team lead named `ProjectList` specifically as the roadmap target; extending `ProjectDetailPage.tsx` too is a reasonable scope call left to the implementer, but `ProjectList.tsx` is the hard requirement.

## Steps

### 1. Confirm the dependency landed  <!-- agent: general-purpose -->

- [x] Confirm TASK-111's `role` field/validation exists in `host-server/index.ts`'s `POST /agents` handler and the frontend `Agent` type. If missing, mark `[BLOCKED: TASK-111 not yet merged]` and stop. <!-- Updated: 2026-08-15 — confirmed: POST /agents validates role (index.ts:~913-939, refactored below to reuse ROLE_VALUES), createAgent() in db.ts already accepts role and wires TASK-113's applyRoleFragmentToWorktree. Verified POST /projects/:id/agents genuinely had NO role support (no field, no validation, not passed to createAgent) before this task's Step 2 — flagged and confirmed with team-lead before proceeding. -->

### 2. Extend the API client and backend route  <!-- agent: general-purpose -->

- [x] Add an optional `role?: string` 4th parameter to `spawnAgentInProject()` in `frontend/src/lib/api.ts:289-307`, included in the POST body conditionally (matching the existing `name`/`launchCmd` pattern). <!-- Updated: 2026-08-15 -->
- [x] In `host-server/index.ts`'s `POST /projects/:id/agents` handler (`index.ts:1893`), add `role?: unknown` to the body type, validate against the 7-value enum (reuse TASK-111/TASK-112's exported constant if one exists; otherwise inline the same array used by `POST /agents`'s validation — do not let the two routes' enum lists silently drift), and pass the validated value through to `createAgent()`. <!-- Updated: 2026-08-15 — found TASK-112's rolePresets.ts already exports ROLE_VALUES (readonly string[]); imported it into index.ts and reused it here. Also refactored POST /agents' existing inline VALID_AGENT_ROLES array (from TASK-111, predates rolePresets.ts) to reuse the same import, closing a duplication that already existed before this task — both routes now validate against one source of truth. -->

### 3. Add the selector to `AddAgentForm`  <!-- agent: general-purpose -->

- [x] Add `const [role, setRole] = useState<string>('generic')` and a `<select>` control (mirroring the "Launch Agent" preset dropdown's markup at `AddAgentForm.tsx:369-386`) with the 7 role values as options, placed in the main visible form area (not behind "Show advanced"). <!-- Updated: 2026-08-15 — new field row inserted right after the Name/Workdir grid, before the "Show advanced" toggle. Options derived from AgentList.tsx's exported ROLE_VALUES (not hand-typed). Added a small colour-dot preview next to the select via resolveRoleBadge(role), also imported from AgentList.tsx — reuses the existing role→colour mapping rather than duplicating it; native <option> can't render inline colour swatches, so the dot sits beside the select instead. -->
- [x] Include `role` in both submission paths: the free-form `POST /agents` body (line 103-107) and the `spawnAgentInProject(...)` call (line 82) — but only send it when non-`'generic'`, or always send it and let the backend default — pick whichever is simpler given how Step 2's route validation was implemented, and be consistent with how `launchCmd` is currently always sent. <!-- Updated: 2026-08-15 — always sent (matches launchCmd's existing always-sent pattern): role added to the free-form fetch body and as spawnAgentInProject's new 4th argument. -->
- [x] Reset `role` to `'generic'` in `clearOnSuccess()` (line 69-77) alongside the other field resets. <!-- Updated: 2026-08-15 -->

### 4. Add the selector to `ProjectList`  <!-- agent: general-purpose -->

- [x] In `frontend/src/components/ProjectList.tsx`, add a small inline role `<select>` per project row (or a single shared one if the UI groups multiple projects under one spawn control — check the actual row layout via `get_symbols_overview` before deciding), defaulting to `'generic'`, and pass its value as the 4th argument to `spawnAgentInProject(project.id, undefined, undefined, role)` at the existing call site (line 37). <!-- Updated: 2026-08-15 — each project row is independent (a <ul> of <li> rows, each with its own Spawn/Delete buttons), so used per-row state (Record<number, string> keyed by project.id, default 'generic') rather than one shared selector. Options derived from AgentList.tsx's exported ROLE_VALUES, same as AddAgentForm — no third hand-typed role list. Did not add the resolveRoleBadge colour-dot preview here (row is already tight: name/workdir/launchCmd/role-select/spawn/delete); added it in AddAgentForm instead, where there was room. ProjectDetailPage.tsx's separate spawn call site (line 60) was left untouched — task named ProjectList as the hard requirement and treats ProjectDetailPage as an implementer's discretion call; scoped to what was asked. -->

### 5. Typecheck + build  <!-- agent: general-purpose -->

- [x] Run `npx tsc --noEmit` in `host-server/` and `frontend/` — zero errors in both. <!-- Updated: 2026-08-15 — both clean. -->
- [x] Run `npm run build` in `frontend/` — clean build. <!-- Updated: 2026-08-15 — clean (pre-existing >500kB chunk-size warning only, unrelated to this task). -->

## Acceptance Criteria

- [ ] `AddAgentForm` has a role dropdown (7 values, default `generic`) whose selection is sent on both the free-form and project-scoped spawn paths.
- [ ] `ProjectList`'s one-click spawn has a role selector whose value reaches `POST /projects/:id/agents`.
- [ ] `POST /agents` and `POST /projects/:id/agents` both reject an invalid `role` value with 400.
- [ ] An agent spawned with a non-`generic` role via either UI path ends up with that role persisted (`GET /agents`/`GET /api/status` shows it).
- [ ] `npx tsc --noEmit` passes cleanly in both `host-server/` and `frontend/`; `npm run build` passes in `frontend/`.
- [ ] **Verification is human-gated for the UI portions**: this repo has no frontend test runner (confirmed during UAT-071's generation), so dropdown rendering/selection/submission can only be verified visually in a browser. The `POST /agents`/`POST /projects/:id/agents` 400-on-invalid-role behavior, however, is machine-verifiable via `curl` (same pattern as TASK-111's own acceptance criteria) and should be tested that way rather than left human-only.

## Dependencies

- **DEPENDS ON [TASK-111](TASK-111-agent-role-column.md)** — needs the `role` column/validation to exist server-side for either spawn path to actually persist a role.

### Roadmap

Implements ROADMAP-010 Phase 3, item 5 ("Add role selector dropdown to `AddAgentForm` and the project-spawn UI in `ProjectList`") — `wiki/work/roadmaps/ROADMAP-010-agent-observability-ux.md`.
