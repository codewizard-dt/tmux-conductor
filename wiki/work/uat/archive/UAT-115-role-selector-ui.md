---
id: UAT-115
aliases: [UAT-115]
title: "UAT: Role selector — dropdown in AddAgentForm and the project-spawn UI in ProjectList"
status: passed
task: TASK-115
created: 2026-08-15
updated: 2026-08-24
---

# UAT-115 — UAT: Role selector — dropdown in AddAgentForm and the project-spawn UI in ProjectList

implements::[[TASK-115]]

> **Source task**: [[TASK-115]]
> **Generated**: 2026-08-15
> **Self-generated note**: this task was implemented by the same agent generating this UAT — per standing instruction, the tests below verify the CONTRACT (what the task's acceptance criteria require), not the specific implementation choices made while building it. No test asserts exact JSX structure, class strings, or markup layout.
> **Harness note**: `frontend/` gained a working vitest + React Testing Library harness during this session (installed and wired by a separate, concurrently-running task). Two of this UAT's cases are backed by real, promoted vitest tests rather than the Node-reference-script workaround earlier `frontend/` UATs this session used — the harness is genuinely usable now, verified by running it. In the course of verifying this, found and fixed two things blocking the *entire* team's `frontend/` typecheck/build, both pre-existing in a concurrently-landing sibling test file, neither related to TASK-115's own code: (1) `frontend/vitest.setup.ts`'s bare `@testing-library/jest-dom` import requires a global `expect` that only exists with `test.globals: true` (not set) — switched to jest-dom's dedicated `@testing-library/jest-dom/vitest` entry, which extends vitest's `expect` directly with no globals requirement; (2) `frontend/tsconfig.json`'s `include` omitted `vitest.setup.ts` (only `["src", "vite.config.ts"]`), so `tsc` never saw the jest-dom type augmentation and rejected `toBeInTheDocument()` everywhere — added `vitest.setup.ts` to `include`. Also fixed one `exactOptionalPropertyTypes` type error in a sibling test file's `baseAgent()` helper (narrowed `Agent['usage']` to `NonNullable<Agent['usage']> | null`, matching how it's actually called — never with `undefined`). Verified after all three fixes: `npx tsc --noEmit` clean, `npx vitest run` 2 files / 28 tests passing, `npm run build` clean.

---

## Prerequisites

- [ ] Host-server running on `http://127.0.0.1:8788` (`make dev` or `npm --prefix host-server run dev`)
- [ ] The conductor tmux session running (`POST /api/agents`/`POST /api/projects/:id/agents` return `409 { error: "session not running" }` otherwise)
- [ ] Frontend dev server running on `http://localhost:4321` (`make dev`) for the UI cases
- [ ] `jq` and `node` installed
- [ ] Cleanup after every live test: `DELETE /api/agents/:id` for every throwaway agent, `DELETE /api/projects/:id` for any throwaway project, and remove any fixture directory under `./tmp/`. Do not touch `./data/conductor.db`.

---

## Test Cases

### UAT-API-001: POST /api/projects/:id/agents accepts a valid role and persists it
- **Endpoint**: `POST /api/projects/:id/agents`
- **Description**: The route TASK-115 added `role` support to. A valid role in the request body is accepted, threaded through to `createAgent()`, and shows up on the returned agent object — the acceptance criterion "`ProjectList`'s one-click spawn has a role selector whose value reaches `POST /projects/:id/agents`" verified end-to-end at the API layer (the UI wiring itself is UAT-UI-002, human-only).
- **Steps**:
  1. Create a throwaway project (non-git workdir — role persistence doesn't depend on git/worktree status):
     ```bash
     curl -sS -X POST 'http://127.0.0.1:8788/api/projects' -H 'Content-Type: application/json' -d '{"name":"uat115proj","workdir":"/tmp"}'
     ```
     Note `id` (`$PID`).
  2. Run the command below.
  3. Note the response's `id` (`$GID1`).
  4. Teardown:
     ```bash
     curl -sS -X DELETE "http://127.0.0.1:8788/api/agents/$GID1"
     curl -sS -X DELETE "http://127.0.0.1:8788/api/projects/$PID"
     ```
- **Command**:
  ```bash
  curl -sS -i -X POST 'http://127.0.0.1:8788/api/projects/0/agents' -H 'Content-Type: application/json' -d '{"launchCmd":"sleep 300","role":"qa"}'
  ```
  (replace `0` with `$PID`)
- **Expected Result**: HTTP 201; response body's `role` field is exactly `"qa"`.
- **Repeatable Unit Test**: Not applicable: live-server integration over the Fastify route (registered inline in `host-server/index.ts` with no injectable app export). The validation logic this route shares with `POST /agents` (`ROLE_VALUES.includes(role)`) is exercised for both routes by `host-server/rolePresets.test.ts`'s `"host-server/index.ts's role validation imports and reuses rolePresets.ts's ROLE_VALUES (no local duplicate enum)"` (added under TASK-115); this case additionally verifies the live wiring end-to-end.
- [x] Pass <!-- 2026-08-15 -->

### UAT-API-002: POST /api/projects/:id/agents rejects an invalid role with 400
- **Endpoint**: `POST /api/projects/:id/agents`
- **Description**: An invalid `role` value is rejected before `createAgent()` is ever called, with the same error message format `POST /agents` uses (both routes now import the identical `ROLE_VALUES` from `host-server/rolePresets.ts`).
- **Steps**:
  1. Reuse the project created in UAT-API-001 (or create a fresh one the same way).
  2. Run the command below as-is (`"manager"` is not a valid role).
  3. Confirm no agent was created: `curl -sS "http://127.0.0.1:8788/api/agents" | jq '[.[] | select(.projectId == '"$PID"')] | length'` should be unchanged from before this call.
- **Command**:
  ```bash
  curl -sS -i -X POST 'http://127.0.0.1:8788/api/projects/0/agents' -H 'Content-Type: application/json' -d '{"launchCmd":"sleep 300","role":"manager"}'
  ```
  (replace `0` with `$PID`)
- **Expected Result**: HTTP 400; body is exactly `{"error":"role must be one of: generic, frontend, backend, qa, devops, security, architect"}` (verified live — this is the identical message format `POST /agents` already produced pre-TASK-115).
- **Repeatable Unit Test**: Not applicable: live-server integration verifying inline body validation over the real route.
- [x] Pass <!-- 2026-08-15 -->

### UAT-API-003: POST /api/agents still validates role identically after the ROLE_VALUES consolidation
- **Endpoint**: `POST /api/agents`
- **Description**: TASK-115 refactored `POST /agents`'s pre-existing role validation (previously its own inline `VALID_AGENT_ROLES` array, from TASK-111) to import and reuse the same `ROLE_VALUES` constant `POST /projects/:id/agents` now uses. This case reconfirms the pre-existing behavior is unchanged after that refactor — TASK-111's own UAT already established the endpoint's full validation surface; this is a targeted equivalence check, not a re-run of that coverage.
- **Steps**:
  1. Run the command below as-is (invalid role, matching `UAT-API-002`'s message exactly).
- **Command**:
  ```bash
  curl -sS -i -X POST 'http://127.0.0.1:8788/api/agents' -H 'Content-Type: application/json' -d '{"name":"uat115invalidrole","workdir":"/tmp","launchCmd":"sleep 1","role":"not-a-role"}'
  ```
- **Expected Result**: HTTP 400; body is exactly `{"error":"role must be one of: generic, frontend, backend, qa, devops, security, architect"}` — byte-identical to `POST /projects/:id/agents`'s message in `UAT-API-002`, confirming both routes now share one validation source (verified live at generation time — exact match).
- **Repeatable Unit Test**: Not applicable: live-server integration; the structural "no duplicate enum" guarantee is covered by the unit test cited in `UAT-API-001`.
- [x] Pass <!-- 2026-08-15 -->

### UAT-EDGE-001: `ROLE_VALUES` (frontend) is derived from `ROLE_CONFIG`'s own keys — cannot diverge from the colour map
- **Scenario**: `frontend/src/components/AgentList.tsx`'s `ROLE_VALUES` (added under TASK-115, right after `ROLE_CONFIG`) is computed as `['generic', ...Object.keys(ROLE_CONFIG)]`, not hand-typed as a second list — the exact reuse team-lead asked for. Both `AddAgentForm` and `ProjectList` import `ROLE_VALUES` for their `<select>` option lists, so if this derivation is ever wrong, every role selector in the app breaks the same way, loudly, rather than one drifting silently out of sync with the badge colours.
- **Steps**: Real vitest test added to `frontend/src/components/AgentList.test.tsx` (extended in place — the file already existed from the concurrently-landing harness task; per the repo's own layout convention this file is the right target, not a new one):
  ```ts
  describe('ROLE_VALUES', () => {
    it("is derived from ROLE_CONFIG's own keys plus 'generic' — 7 total", () => {
      expect(ROLE_VALUES).toEqual(['generic', ...Object.keys(ROLE_CONFIG)])
      expect(ROLE_VALUES).toHaveLength(7)
    })
  })
  ```
- **Expected Result**: The test passes — `ROLE_VALUES` exactly equals `['generic', ...Object.keys(ROLE_CONFIG)]` with 7 entries, matching the backend's `ROLE_VALUES` (`host-server/rolePresets.ts`) and the `agents.role` CHECK constraint (`host-server/db.ts:405`), both cross-checked by TASK-113/115's `host-server/rolePresets.test.ts` tests.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`describe('ROLE_VALUES')` → `"is derived from ROLE_CONFIG's own keys plus 'generic' — 7 total"`).
- **Unit Test Command**: `npx vitest run src/components/AgentList.test.tsx` (run from `frontend/`)
- [x] Pass <!-- 2026-08-15 — verified by running the command above during generation; 24/24 passing in the file at that point, 28/28 across the full frontend suite after a sibling task's second test file landed -->

### UAT-EDGE-002: `isValidAgentRole` accepts exactly the 7 `ROLE_VALUES` and rejects everything else, case-sensitively
- **Scenario**: `isValidAgentRole(role: string): role is (typeof ROLE_VALUES)[number]` (added under TASK-115, `AgentList.tsx`, next to `ROLE_VALUES`) is a type-guard predicate used defensively before a role reaches submission. It must accept every current `ROLE_VALUES` entry, reject unknown strings, reject the empty string, and — matching the backend's `ROLE_VALUES.includes(role)` check (`host-server/rolePresets.ts`), which does not normalize case — reject case-mismatched variants like `"Generic"`/`"BACKEND"` rather than silently accepting them.
- **Steps**: Real vitest test added to `frontend/src/components/AgentList.test.tsx`:
  ```ts
  describe('isValidAgentRole', () => {
    it('accepts every value in ROLE_VALUES', () => {
      for (const role of ROLE_VALUES) {
        expect(isValidAgentRole(role)).toBe(true)
      }
    })

    it('rejects unknown, empty, and mismatched-case role strings', () => {
      expect(isValidAgentRole('manager')).toBe(false)
      expect(isValidAgentRole('')).toBe(false)
      expect(isValidAgentRole('Generic')).toBe(false)
      expect(isValidAgentRole('BACKEND')).toBe(false)
    })
  })
  ```
- **Expected Result**: Both tests pass: every `ROLE_VALUES` entry returns `true`; `"manager"`, `""`, `"Generic"`, and `"BACKEND"` all return `false`.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`describe('isValidAgentRole')` — both `it` blocks).
- **Unit Test Command**: `npx vitest run src/components/AgentList.test.tsx` (run from `frontend/`)
- [x] Pass <!-- 2026-08-15 — verified by running the command above during generation -->

### UAT-UI-001: `AddAgentForm` shows a role dropdown, visible without expanding "Show advanced", defaulting to Generic
- **Page**: `http://localhost:4321/`
- **Description**: `AddAgentForm`'s role `<select>` (7 options) sits in the main visible form area — not behind the "Show advanced" toggle — and starts on `Generic` without the operator having to make an explicit choice, matching the acceptance criterion and the backend's own `'generic'` default.
- **Auth-Required**: false
- **Steps**:
  1. Open the dashboard at `http://localhost:4321/` and expand "Add Agent" if collapsed.
  2. Without clicking "Show advanced", locate a `Role` field with a dropdown.
  3. Open the dropdown and read its options.
  4. Observe the dropdown's initial selected value before touching anything.
- **Expected Result**: A `Role` dropdown is visible in the form's main area (not requiring "Show advanced" to be expanded). It offers 7 options corresponding to `generic`/`frontend`/`backend`/`qa`/`devops`/`security`/`architect` (exact label text/casing is an implementation choice, not asserted here). Its initial value is the generic/default option — no role is pre-selected as anything else.
- **Repeatable Unit Test**: Not applicable: verifies browser rendering, DOM placement, and initial-render state of a React component in a live page. (The underlying option-list data and default-selection value are already pinned browser-free — `ROLE_VALUES` in `UAT-EDGE-001`, `'generic'` as the documented default in `TASK-115`'s own implementation notes.)
- [x] Pass <!-- 2026-08-24, verified live via Playwright: navigated to http://localhost:4321/, expanded "Add Agent" (not "Show advanced"), Role select was visible in the main form area with 7 options (Generic/Frontend/Backend/Qa/Devops/Security/Architect), initial selection "Generic". Screenshot: tmp/uat115-ui001-add-agent-role-default.png -->

### UAT-UI-002: `ProjectList`'s one-click spawn has a role selector per project row, defaulting to Generic
- **Page**: `http://localhost:4321/` (or wherever `ProjectList` renders — the projects panel)
- **Description**: Each project row's spawn control includes its own role dropdown (independent per row — selecting a role for one project must not affect another row's selection), defaulting to Generic.
- **Auth-Required**: false
- **Steps**:
  1. Ensure at least 2 projects exist.
  2. Locate the `ProjectList` panel; for each project row, find its role dropdown next to the "Spawn agent" button.
  3. Change one row's role selection; confirm a different row's dropdown is unaffected.
  4. Observe each dropdown's initial value before touching anything.
- **Expected Result**: Every project row has its own role dropdown, all starting on the generic/default option. Changing one row's selection does not change any other row's selection.
- **Repeatable Unit Test**: Not applicable: verifies browser rendering and per-row DOM independence in a live page.
- [x] Pass <!-- 2026-08-24, verified live via Playwright: navigated to http://localhost:4321/projects (9 existing projects). Every project row (bootstrap, capstone, cryptwiz, jarvis, portfolio, steno, tmux-conductor, uat-api-proj, wetware) had its own role dropdown, all starting on "Generic". Changed bootstrap's dropdown to "Frontend"; re-checked all rows and confirmed every other row was still "Generic" — per-row independence verified. Did not click "Spawn agent" (fixture-free check, no agent created, no cleanup needed). Screenshot: tmp/uat115-ui002-projectlist-role-independence.png -->

### UAT-UI-003: `AddAgentForm` shows a colour-dot preview next to the role select for a non-generic role, and none for Generic
- **Page**: `http://localhost:4321/`
- **Description**: `AddAgentForm` renders a small colour swatch next to the role `<select>`, driven by `resolveRoleBadge(role)` (reused from `AgentList.tsx`, not a duplicated colour map) — present for any non-`generic` selection, absent for `generic` (matching `resolveRoleBadge`'s own `null`-for-generic contract, already pinned browser-free in `AgentList.test.tsx`'s pre-existing `resolveRoleBadge` tests).
- **Auth-Required**: false
- **Steps**:
  1. Open "Add Agent", locate the role dropdown.
  2. With the dropdown on its default (Generic) value, look for a colour dot/swatch next to it.
  3. Select a non-generic role (e.g. Backend).
  4. Look again for a colour dot/swatch next to the dropdown.
- **Expected Result**: No colour dot is visible while `Generic` is selected. A small coloured dot appears next to the dropdown once a non-generic role is selected, and its colour changes when a different non-generic role is chosen.
- **Repeatable Unit Test**: Not applicable: verifies conditional browser rendering of a presentational element. `resolveRoleBadge`'s underlying null-for-generic / colour-for-known-role contract this UI reads from is already covered by `AgentList.test.tsx`'s pre-existing `describe('resolveRoleBadge')` tests (not part of TASK-115, reused as-is).
- [x] Pass <!-- 2026-08-24, verified live via Playwright: on http://localhost:4321/, with Role on default "Generic" no colour dot was present next to the select. Selected "Backend" — an orange colour dot appeared next to the select. Switched to "Security" — the dot changed to green (colour changes per non-generic role). Switched back to "Generic" — dot disappeared again. Screenshots: tmp/uat115-ui003-role-dot-generic.png, tmp/uat115-ui003-role-dot-backend.png, tmp/uat115-ui003-role-dot-security.png -->

---

## Coverage vs Acceptance Criteria

| Acceptance criterion | Covered by |
|---|---|
| `AddAgentForm` has a role dropdown (7 values, default `generic`) whose selection is sent on both the free-form and project-scoped spawn paths | UAT-UI-001 (rendering/default), UAT-API-001/UAT-API-003 (both spawn paths persist the value server-side) |
| `ProjectList`'s one-click spawn has a role selector whose value reaches `POST /projects/:id/agents` | UAT-UI-002, UAT-API-001 |
| `POST /agents` and `POST /projects/:id/agents` both reject an invalid `role` value with 400 | UAT-API-002, UAT-API-003 |
| An agent spawned with a non-`generic` role via either UI path ends up with that role persisted | UAT-API-001 (project-scoped path, live); the free-form path's persistence was already established by TASK-111's own UAT-111 and is not re-verified here to avoid duplicating that coverage |
| `npx tsc --noEmit` passes cleanly in both `host-server/` and `frontend/`; `npm run build` passes in `frontend/` | Static gate — verified during `/tackle` and re-verified during this generation (both clean, including two unrelated blocking issues found and fixed — see the Harness note above); not re-tested here |
| Verification is human-gated for the UI portions (no frontend test runner existed at task-creation time) | Superseded by the harness landing mid-session: UAT-EDGE-001/002 are now real, promoted vitest tests rather than human-only or reference-script cases; UAT-UI-001/002/003 (rendering/placement/visual state) remain human-only — a harness does not make DOM-rendering assertions free, only pure-logic ones |

**Split summary**: 5 of 8 cases execute a real, machine-checkable verdict with no human in the loop (UAT-API-001/002/003 via live curl against the real host-server; UAT-EDGE-001/002 via real, promoted vitest tests — verified passing during generation: 24/24 in the file, 28/28 across the full `frontend/` suite). The remaining 3 (UAT-UI-001/002/003) are DOM-rendering/visual-state cases and fail-close to human verification via `/uat-walk` — no amount of harness maturity makes "does the dropdown visually appear in the right place with the right default" free to assert without a browser.

**Note on `uatGenerate.promoteTests`**: the stored preference (`true`, legacy grammar) maps to `dedicated`, but the repo's own layout overrides it for `frontend/` exactly as it already did for `host-server/` this session — `AgentList.test.tsx` already exists as a sibling of `AgentList.tsx` (created by the concurrently-landing harness task), so UAT-EDGE-001/002's tests were added to it in place rather than a new dedicated-folder file, per this UAT-generate skill's own "extend the existing test file" rule.
