---
id: UAT-114
aliases: [UAT-114]
title: "UAT: Role badge — colour-coded role badge on the agent card in the dashboard"
status: pending
task: TASK-114
created: 2026-08-15
updated: 2026-08-21
---

# UAT-114 — UAT: Role badge — colour-coded role badge on the agent card in the dashboard

implements::[[TASK-114]]

> **Source task**: [[TASK-114]]
> **Generated**: 2026-08-15
> **Note**: Frontend-only task (`frontend/src/components/AgentList.tsx`). Confirmed via `find_symbol` at generation time: `ROLE_CONFIG` (lines 166-173, `Record<string, {className, dot}>` with exactly the 6 keys `frontend`/`backend`/`qa`/`devops`/`security`/`architect`, each `bg-{hue}-100 text-{hue}-700`), the exported `resolveRoleBadge(role)` (lines 175-182, returns `null` for `null`/`undefined`/`'generic'`/any unrecognized string, else `{role, className, dot}`), and `RoleBadge` (lines 184-196, a thin JSX wrapper). Both call sites confirmed wired: `AgentDetailModal`'s header row (`<RoleBadge role={agent.role} />` at line 647, immediately after `<AgentTypeBadge agent={agent} />`, before `<ContextMeter>`) and `AgentItem`'s Row 1 (line 856, same relative position, before `<StatusBadge>`). `host-server/db.ts`'s schema migration (`~line 404`) confirms the `agents.role` column's `CHECK` constraint enumerates exactly `('generic','frontend','backend','qa','devops','security','architect')` — `ROLE_CONFIG`'s 6 keys are the non-`generic` half of that set, verified byte-for-byte in UAT-EDGE-001 below. The live `POST /api/agents` route (`host-server/index.ts:913-955`) already accepts an optional `role` field (validated server-side against the same 7-value enum, 400 on anything else) and `GET /api/status`'s agent-serialization (`index.ts:2176`) already carries `role` — confirmed live at generation time — so this file creates its own role-assigned fixtures directly via the API rather than seeding the DB by hand. **Per team-lead's explicit brief**: `resolveRoleBadge`/`ROLE_CONFIG` were exported specifically so their logic could be pinned by a Node reference script without a browser — this file does not collapse into "it's UI, so it's all human-only"; the badge's actual colour-mapping, null-guard, and no-collision-with-other-badges contract is machine-verified in UAT-EDGE-001, leaving only genuine DOM rendering to `/uat-walk`.

---

## Prerequisites

- [ ] Host-server running on `http://localhost:8788` (`make dev` or `npm start` in `host-server/`)
- [ ] Frontend dev server running on `http://localhost:4321` (`make dev`)
- [ ] `jq` and `node` installed
- [ ] Any fixture agent this file's own steps create must be deleted by that same test's own teardown step — this file otherwise creates no agents and deletes none

---

## Test Cases

### UAT-API-001: `POST /api/agents` accepts a `role`, and `GET /api/status` carries it through — the precondition `RoleBadge` depends on
- **Endpoint**: `POST /api/agents`, `GET /api/status`
- **Description**: `RoleBadge` reads `agent.role` straight off the `/status` snapshot payload the dashboard already consumes for every other badge. This pins the two-hop precondition: creating an agent with an explicit `role` succeeds and that exact value survives onto the live `/status` payload's `role` field (`host-server/index.ts:2176`) — the wire-shape this task's badge renders from, owned by TASK-111 and re-verified here only as far as TASK-114 depends on it.
- **Steps**:
  1. Create a disposable fixture agent with `role: "frontend"`:
     ```bash
     mkdir -p /Users/davidtaylor/Repositories/tmux-conductor/tmp/uat114-fixture
     ```
     ```bash
     curl -sS -X POST 'http://localhost:8788/api/agents' -H 'Content-Type: application/json' -d "{\"name\":\"uat114-role-test\",\"workdir\":\"$(pwd)/tmp/uat114-fixture\",\"launchCmd\":\"sleep 300\",\"role\":\"frontend\"}"
     ```
     Note the returned `agent.id` (call it `<RID>`).
  2. Run the command below (substitute `<RID>`).
  3. Teardown: `curl -sS -X DELETE "http://localhost:8788/api/agents/<RID>"`.
- **Command**:
  ```bash
  curl -sS 'http://localhost:8788/api/status' | jq --argjson rid <RID> '.agents[] | select(.id==$rid) | .role == "frontend"'
  ```
- **Expected Result**: Prints `true` (verified live at generation time against fixture agent id 12, since deleted).
- **Repeatable Unit Test**: Not applicable: `POST /api/agents`'s role-acceptance and `GET /api/status`'s serialization are live-route behaviour owned by TASK-111 (`role: string` on the `Agent` DB interface, `mapAgent`'s pass-through at `host-server/db.ts:207`); TASK-111 itself has no repeatable coverage yet (its own UAT is not yet generated), so this case exists only to confirm the precondition `RoleBadge` reads from actually reaches the wire — not to own TASK-111's validation/migration coverage.
- [x] Pass <!-- 2026-08-15 -->

### UAT-EDGE-001: `resolveRoleBadge`/`ROLE_CONFIG` — null-guard, per-role distinctness, schema-parity, and no collision with other badges
- **Scenario**: Five machine-checkable claims about the exported pure logic, read verbatim from source at generation time: (1) `resolveRoleBadge` returns `null` for `null`, `undefined`, `''`, `'generic'`, and an unrecognized string (`'bogus'`) — the "older row / pre-migration agent" case a broken or empty badge would visibly fail on; (2) each of the 6 schema roles resolves to a non-null config with a `className` distinct from every other role's; (3) `ROLE_CONFIG`'s key set exactly matches the non-`generic` half of `host-server/db.ts`'s `agents.role` `CHECK` constraint — if the schema ever gains a role the badge map doesn't, agents would silently render unbadged; (4) no `ROLE_CONFIG` `className` collides with `SkillBadge`'s existing Tailwind classes (`bg-violet-100 text-violet-700` / `bg-blue-100 text-blue-700` / `bg-amber-100 text-amber-700`); (5) no `ROLE_CONFIG` dot hex collides with `STATUS_CONFIG`'s or `AgentTypeBadge`'s existing hex values. This is the machine-verifiable core of the task — deliberately not "it's UI, so it's all human-only".
- **Steps**:
  1. Write the reference script (byte-for-byte copy of `ROLE_CONFIG`/`resolveRoleBadge` from `AgentList.tsx:166-182`, plus verbatim snapshots of the other three badge components' colour values and the schema's role enum, both read from source at generation time):
     ```bash
     mkdir -p /Users/davidtaylor/Repositories/tmux-conductor/tmp
     cat > /Users/davidtaylor/Repositories/tmux-conductor/tmp/uat114-role-badge.mjs <<'EOF'
     import assert from 'node:assert/strict'

     const ROLE_CONFIG = {
       frontend: { className: 'bg-pink-100 text-pink-700', dot: '#ec4899' },
       backend: { className: 'bg-orange-100 text-orange-700', dot: '#f97316' },
       qa: { className: 'bg-cyan-100 text-cyan-700', dot: '#06b6d4' },
       devops: { className: 'bg-indigo-100 text-indigo-700', dot: '#6366f1' },
       security: { className: 'bg-lime-100 text-lime-700', dot: '#84cc16' },
       architect: { className: 'bg-stone-100 text-stone-700', dot: '#78716c' },
     }

     function resolveRoleBadge(role) {
       if (role == null || role === 'generic') return null
       const cfg = ROLE_CONFIG[role]
       if (!cfg) return null
       return { role, className: cfg.className, dot: cfg.dot }
     }

     const OTHER_BADGE_CLASSNAMES = [
       'bg-violet-100 text-violet-700', // SkillBadge: project
       'bg-blue-100 text-blue-700',     // SkillBadge: auto-only
       'bg-amber-100 text-amber-700',   // SkillBadge: manual
     ]
     const OTHER_BADGE_HEXES = [
       '#3b6ef6', '#30a46c', '#e0901a', '#c07a10', '#e5484d', '#4f5a78', '#9a9da5', '#6b6e76',
       '#7e57c2', '#5b21b6', '#14a38b', '#0f766e',
     ]

     const SCHEMA_NON_GENERIC_ROLES = ['frontend', 'backend', 'qa', 'devops', 'security', 'architect']

     let failures = 0
     function test(name, fn) {
       try {
         fn()
         console.log(`ok - ${name}`)
       } catch (err) {
         failures++
         console.log(`FAIL - ${name}: ${err instanceof Error ? err.message : String(err)}`)
       }
     }

     test('resolveRoleBadge returns null for null/undefined/empty/generic/unrecognized role', () => {
       assert.equal(resolveRoleBadge(null), null)
       assert.equal(resolveRoleBadge(undefined), null)
       assert.equal(resolveRoleBadge(''), null)
       assert.equal(resolveRoleBadge('generic'), null)
       assert.equal(resolveRoleBadge('bogus'), null)
     })

     test('resolveRoleBadge returns a non-null, distinct config for each of the 6 schema roles', () => {
       const seen = new Set()
       for (const role of SCHEMA_NON_GENERIC_ROLES) {
         const resolved = resolveRoleBadge(role)
         assert.ok(resolved, `expected a config for role "${role}"`)
         assert.equal(resolved.role, role)
         assert.ok(!seen.has(resolved.className), `className for "${role}" duplicates an earlier role`)
         seen.add(resolved.className)
       }
       assert.equal(seen.size, 6)
     })

     test("ROLE_CONFIG keys exactly match the schema CHECK constraint's non-generic role values", () => {
       const configKeys = Object.keys(ROLE_CONFIG).sort()
       const schemaRoles = [...SCHEMA_NON_GENERIC_ROLES].sort()
       assert.deepEqual(configKeys, schemaRoles)
     })

     test("no ROLE_CONFIG className collides with SkillBadge's existing Tailwind classes", () => {
       for (const [role, cfg] of Object.entries(ROLE_CONFIG)) {
         assert.ok(!OTHER_BADGE_CLASSNAMES.includes(cfg.className), `role "${role}"'s className collides with an existing badge`)
       }
     })

     test("no ROLE_CONFIG dot hex collides with StatusBadge/AgentTypeBadge's existing hex values", () => {
       for (const [role, cfg] of Object.entries(ROLE_CONFIG)) {
         assert.ok(!OTHER_BADGE_HEXES.includes(cfg.dot), `role "${role}"'s dot hex collides with an existing badge`)
       }
     })

     console.log(failures === 0 ? 'ALL PASS' : `FAIL (${String(failures)} failing)`)
     process.exit(failures === 0 ? 0 : 1)
     EOF
     ```
  2. Run the command below as-is.
- **Command**:
  ```bash
  node /Users/davidtaylor/Repositories/tmux-conductor/tmp/uat114-role-badge.mjs
  ```
- **Expected Result**: Five `ok - ...` lines followed by `ALL PASS`, exit code 0 (verified by running this exact script before writing this file).
- **Repeatable Unit Test**: Blocked: this logic is promotable in principle (pure, deterministic, no I/O) but `frontend/` has no configured test runner (no vitest/jest, no `*.test.tsx` anywhere in `frontend/`, confirmed at generation time — same constraint as UAT-074/UAT-076/UAT-109/UAT-110). The reference script above is deliberately structured as named `test(name, fn)` blocks using `node:assert/strict`, so a future migration to vitest (a user-approved task to add vitest + React Testing Library to `frontend/` is reportedly in flight) is close to a 1:1 rename to `it(name, fn)` + `expect(...)` — written for easy migration, not just for this run.
- [x] Pass <!-- 2026-08-15 -->

### UAT-STATIC-001: `tsc --noEmit` and `npm run build` pass cleanly in `frontend/`
- **Description**: The task's static-gate acceptance criterion, re-verified independently of `/tackle`'s own run.
- **Steps**:
  1. Run the command below from the repo root.
- **Command**:
  ```bash
  npm --prefix frontend run typecheck
  ```
- **Expected Result**: Exit code 0, no TypeScript errors printed (verified live at generation time; `npm run build` was also run at generation time and completed cleanly — 71 modules transformed, only the pre-existing >500kB chunk-size advisory, not an error).
- **Repeatable Unit Test**: Not applicable: this test *is* the static gate (`tsc --noEmit`), already run as part of `/tackle`'s own verification and re-checked here as a UAT sanity gate, not additional new test code.
- [x] Pass <!-- 2026-08-15 -->

### UAT-UI-001: Role badge renders with the correct colour, label, and position on both the agent card and the detail modal header
- **Page**: `http://localhost:4321/`
- **Description**: For an agent whose `role` is a non-`generic` value, a small colour-coded pill showing the role name must appear on both `AgentItem`'s Row 1 (compact card) and `AgentDetailModal`'s header row — in both places positioned immediately after the `AgentTypeBadge` pill (before `StatusBadge` on the card, before `ContextMeter` in the modal) — styled as a small rounded pill (`rounded-pill px-2 py-0.5 text-[10px] font-semibold uppercase`) with a leading dot, using the `bg-{hue}-100 text-{hue}-700` Tailwind classes for that role.
- **Auth-Required**: false
- **Steps**:
  1. Create a disposable fixture agent with a non-`generic` role:
     ```bash
     mkdir -p /Users/davidtaylor/Repositories/tmux-conductor/tmp/uat114-fixture
     ```
     ```bash
     curl -sS -X POST 'http://localhost:8788/api/agents' -H 'Content-Type: application/json' -d "{\"name\":\"uat114uihappy\",\"workdir\":\"$(pwd)/tmp/uat114-fixture\",\"launchCmd\":\"sleep 300\",\"role\":\"security\"}"
     ```
     Note the returned `agent.id` (call it `<RID>`).
  2. Open the dashboard at `http://localhost:4321/`.
  3. Locate the `uat114uihappy` card in the agent list. Confirm Row 1 shows a small lime-tinted pill reading "security" (with a leading dot), positioned between the agent-type badge and the status badge.
  4. Click the card to open its detail modal. Confirm the header row shows the same lime "security" pill, positioned between the agent-type badge and the context meter.
  5. Hover the badge on either surface — confirm the tooltip/title reads `Role: security`.
  6. Teardown: `curl -sS -X DELETE "http://localhost:8788/api/agents/<RID>"`.
- **Expected Result**: A lime-coloured "security" pill with a leading dot appears in the documented position on both the card and the modal header, with an accurate tooltip. No layout shift or overflow on either surface.
- **Repeatable Unit Test**: Not applicable: verifies browser rendering, colour, and DOM positioning of a React component; `frontend/` has no component test harness. The underlying colour-mapping and null-guard logic are pinned browser-free in UAT-EDGE-001.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-08-22 -->

### UAT-UI-002: No role badge appears for a `generic`-role agent, on either surface
- **Page**: `http://localhost:4321/`
- **Description**: An agent whose `role` is `'generic'` (the default — every pre-existing agent in this DB has it) must show no role badge at all on either surface — no placeholder, no empty pill — matching `resolveRoleBadge`'s null-guard verified in UAT-EDGE-001.
- **Auth-Required**: false
- **Steps**:
  1. Open the dashboard at `http://localhost:4321/`. Pick any existing agent (all currently have `role: "generic"` — confirm with `curl -sS 'http://localhost:8788/api/status' | jq '.agents[] | {id, name, role}'` if in doubt).
  2. Inspect Row 1 of that agent's card between the agent-type badge and the status badge: confirm no role pill of any kind appears — the agent-type badge sits directly against the status badge with no gap left by a hidden/empty element.
  3. Open its detail modal: confirm the header row between the agent-type badge and the context meter shows no role pill either.
- **Expected Result**: No role badge is rendered anywhere for a `generic`-role agent, on either surface, and no layout gap is left behind.
- **Repeatable Unit Test**: Not applicable: verifies absence of a rendered DOM element in the browser. The `role == null || role === 'generic' → null` guard itself is pinned browser-free in UAT-EDGE-001's first case.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-08-22 -->

---

## Coverage vs Acceptance Criteria

| Acceptance criterion | Covered by |
|---|---|
| An agent with a non-`generic` role shows a colour-coded badge with that role's name on both the compact card and the detail modal header | UAT-UI-001, colour-mapping pinned by UAT-EDGE-001 |
| An agent with `role: 'generic'` or no `role` set shows no role badge | UAT-UI-002, null-guard pinned by UAT-EDGE-001 |
| Each of the 6 non-generic roles has a visually distinct colour, none reused from `STATUS_CONFIG`/`AgentTypeBadge`/`SkillBadge`'s existing palette | UAT-EDGE-001 (distinctness + no-collision checks) |
| `npx tsc --noEmit` and `npm run build` pass cleanly in `frontend/` | UAT-STATIC-001 |

**Note on `uatGenerate.promoteTests`**: the stored preference (`true`, legacy grammar) maps to `dedicated` for this run. No test files were created under it — `frontend/` has no configured test runner at all (no vitest/jest, no existing test files), so promoting `resolveRoleBadge`/`ROLE_CONFIG`'s logic into a real test file would mean introducing new frontend test infrastructure, out of scope for this generation. It is instead pinned as a machine-verifiable, browser-free reference script — deliberately written with named `test(...)` blocks over `node:assert/strict` so it migrates cleanly once vitest lands, per team-lead's note that this file is in flight.

**Split summary**: 3 of 5 cases (60%) execute a genuine machine-checkable verdict with no human in the loop (UAT-API-001 via live curl, UAT-EDGE-001 via a verified Node reference script covering the full colour-mapping/null-guard/no-collision/schema-parity contract, UAT-STATIC-001 via the typecheck command); the remaining 2 (UAT-UI-001, UAT-UI-002) are DOM-rendering-only and fail-close to human verification via `/uat-walk`, per UAT-CORE's UI rule.
