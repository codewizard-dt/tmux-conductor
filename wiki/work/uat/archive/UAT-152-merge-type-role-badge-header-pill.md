---
id: UAT-152
aliases: [UAT-152]
title: "UAT: Merge AgentTypeBadge and RoleBadge into one combined header pill in AgentDetailModal"
status: passed
task: TASK-152
created: 2026-09-13
updated: 2026-09-13
---

# UAT-152 — UAT: Merge AgentTypeBadge and RoleBadge into one combined header pill in AgentDetailModal

implements::[[TASK-152]]

> **Source task**: [[TASK-152]]
> **Generated**: 2026-09-13

---

## Prerequisites

- [ ] Repo checked out at `frontend/` with dependencies installed (`npm install` already run — the existing `node_modules` in this repo is sufficient)
- [ ] For the UAT-UI cases only: frontend dev server running via `make dev` (or `/run`) so the dashboard is reachable at `http://localhost:4321/` — the UI/visual verification was explicitly deferred to this UAT phase per TASK-152 Step 4's `[DEFERRED-TO-UAT]` marker
- [ ] For UAT-UI-001/002: at least one registered agent whose `launchCmd` resolves to `claude` or `codex` (via `inferAgentType`) **and** has a non-`generic` `role` set (e.g. `frontend`, `backend`, `qa`, `devops`, `security`, `architect`) so its `AgentDetailModal` header shows the combined `type · role` pill
- [ ] For UAT-UI-003: at least one registered agent whose `launchCmd` resolves to `claude`/`codex` with **no** role set (role is `null`/unset/`generic`) — this is the common/default case for most agents in this repo's own dogfood session, since role assignment is opt-in
- [ ] For UAT-UI-004: the agent grid view (`AgentsPage` root route, before opening any detail modal) with at least one agent that has both a resolvable type and a role, so both `AgentItem` badges are visible at once

---

## Test Cases

### UAT-UI-001: Both type and role resolve — AgentDetailModal header shows one combined pill (light mode)
- **Page**: `http://localhost:4321/` → click an agent card whose type and role both resolve, to open `AgentDetailModal`
- **Description**: `AgentDetailModal`'s header (`frontend/src/components/AgentList.tsx:789`) now renders a single `<AgentIdentityBadge agent={agent} />` in place of the previous `<AgentTypeBadge agent={agent} />` + `<RoleBadge role={agent.role} />` pair. Confirms that when both `inferAgentType(agent)` and `resolveRoleBadge(agent.role)` resolve, exactly one pill appears showing `type · role` text with two dots (type dot + role dot), not two separate pills.
- **Steps**:
  1. Ensure `document.documentElement` has no `dark` class (light mode is default — confirm via the NavBar toggle showing 🌙 / `aria-label="Switch to dark mode"`).
  2. Navigate to `http://localhost:4321/` and click an agent card whose agent has a resolvable type (`claude`/`codex`) and a non-generic role.
  3. In the opened `AgentDetailModal` header, take a screenshot (`mcp__playwright__browser_take_screenshot`) of the row containing the agent name, project badge, status badge, and identity pill.
  4. Visually confirm: exactly **one** pill sits where the type badge and role badge used to sit side by side; it shows two small dots followed by `<type> · <role>` text (e.g. `claude · frontend`); hovering it shows a combined tooltip (`title="Agent type: <type>, Role: <role>"`).
  5. Confirm both the type and the role are legible in the pill text — neither piece of information was silently dropped.
- **Expected Result**: One combined pill renders in the modal header, showing both type and role, legible, with the combined tooltip.
- **Repeatable Unit Test**: Created (TASK-152 Step 3): `frontend/src/components/AgentList.test.tsx`, `describe('AgentIdentityBadge (merged type + role pill, TASK-152 Step 3)')` → `it('renders combined "type · role" text when both agent type and role resolve', ...)` — asserts `getByTitle('Agent type: claude, Role: frontend')` has text content `claude · frontend`.
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "TASK-152 Step 3"`
- [x] Pass <!-- 2026-09-13 -->

### UAT-UI-002: Both type and role resolve — same pill, dark mode legibility/contrast check
- **Page**: `http://localhost:4321/` → same agent card as UAT-UI-001, `AgentDetailModal` open
- **Description**: Repeats UAT-UI-001's visual check in dark mode. The pill's background comes from the type token (`--color-badge-type-claude-bg`/`--color-badge-type-codex-bg`) and its text color from the matching `-text` token (both defined for light and dark in `frontend/src/styles/global.css` per TASK-150); the role dot uses the role's literal dot hex from `ROLE_CONFIG`/`resolveRoleBadge` (unchanged by TASK-150/152, not theme-aware). This case exists because merging two pills into one changes information density in the same visual footprint — worth a dedicated dark-mode contrast spot-check rather than assuming light-mode legibility transfers.
- **Steps**:
  1. Navigate to `http://localhost:4321/`.
  2. Click the theme toggle in `NavBar` (`button[aria-label="Switch to dark mode"]`) to switch to dark mode; confirm `document.documentElement` gains the `dark` class.
  3. Open the same agent's `AgentDetailModal` and screenshot the header row.
  4. Visually confirm the combined pill's background/text pairing (from the dark-mode `--color-badge-type-*` tokens) is legible — text readable against its background, both dots visible and distinguishable from the pill background and from each other.
- **Expected Result**: The combined pill is legible in dark mode; no dot or text blends into the background or into each other.
- **Repeatable Unit Test**: Not applicable: dark-mode visual contrast/legibility is a rendering/perception check, not deterministic logic. The deterministic half (that both type and role resolve into the combined pill's text/title) is already covered by the same unit test cited in UAT-UI-001 — CSS custom property *values* are not exercised by the Vitest/jsdom runner.
- [x] Pass <!-- 2026-09-13 -->

### UAT-UI-003: Only the type resolves (no role set) — single-dot pill shows just the type
- **Page**: `http://localhost:4321/` → click an agent card whose type resolves but role does not (the common default case — most agents have no role assigned), to open `AgentDetailModal`
- **Description**: When `resolveRoleBadge(agent.role)` returns `null` (role is `null`/unset/`generic`) but `inferAgentType(agent)` resolves, `AgentIdentityBadge` renders a single-dot pill with just the type text and a type-only tooltip (`title="Agent type: <type>"`) — mirroring the pre-merge `AgentTypeBadge`'s own solo appearance, just now via the merged component. Chosen over the symmetric "role-only" case as the more realistic one to trigger against this repo's live agent data, since role assignment is opt-in and most registered agents don't have one set.
- **Steps**:
  1. Navigate to `http://localhost:4321/` and open the detail modal for an agent with a resolvable type and no role set.
  2. Screenshot the header identity pill.
  3. Confirm exactly one dot appears (the type dot only, no second role dot) followed by just the type name (e.g. `claude`), with no stray `·` separator and no empty second segment.
  4. Hover the pill and confirm the tooltip reads `Agent type: <type>` only (no `, Role: ...` suffix).
- **Expected Result**: A single-dot pill showing only the type, with a type-only tooltip; visually indistinguishable in layout from the old solo `AgentTypeBadge` (same size class, one dot, no trailing separator).
- **Repeatable Unit Test**: Created (TASK-152 Step 3): `frontend/src/components/AgentList.test.tsx`, same describe block → `it('renders just the agent type when only the type resolves', ...)` — asserts `getByTitle('Agent type: claude')` has text content `claude` (agent fixture: `launchCmd: 'claude', role: null`). (The symmetric role-only case — `launchCmd: 'aider'` with a role set, which makes `inferAgentType` return `null` while the role still resolves — is unit-covered by the adjacent `it('renders just the role when only the role resolves', ...)` test in the same block, asserting `getByTitle('Role: frontend')`; it is not exercised live here since one representative degenerate case is sufficient for the visual claim and the type-only path is the one this app's real data makes easy to hit.)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "TASK-152 Step 3"`
- [x] Pass <!-- 2026-09-13 -->

### UAT-EDGE-001: Neither type nor role resolves — pill renders nothing (no empty pill, no stray dot)
- **Scenario**: When both `inferAgentType(agent)` returns `null` and `resolveRoleBadge(agent.role)` returns `null` (e.g. an Aider agent — `launchCmd` not matching `claude`/`codex` — with no role set), `AgentIdentityBadge` must `return null` outright rather than rendering an empty `<span>`, a lone `·`, or a pill with no dots and no text. This is a degenerate-input edge case rather than something worth a dedicated manual screenshot — the assertion is exact-absence, which a DOM query verifies more reliably than a visual scan.
- **Steps**: N/A — covered entirely by the existing repeatable unit test below; no manual walkthrough needed for this case.
- **Expected Result**: No pill-shaped element, no stray dot, and no title matching `Agent type: ...` or `Role: ...` appears in the `AgentDetailModal` header for such an agent.
- **Repeatable Unit Test**: Created (TASK-152 Step 3): `frontend/src/components/AgentList.test.tsx`, same describe block → `it('renders nothing when neither agent type nor role resolves', ...)` — agent fixture `launchCmd: 'aider', role: null`; asserts `queryByTitle(/^Agent type:|^Role:/)` is `null` inside the modal dialog.
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "TASK-152 Step 3"`
- [x] Pass <!-- 2026-09-13 -->

### UAT-UI-004: AgentItem grid-card view is unchanged — still shows two separate badges, not the merged pill
- **Page**: `http://localhost:4321/` (`AgentsPage` root route, the agent grid — before opening any detail modal)
- **Description**: TASK-152 intentionally scoped the merge to `AgentDetailModal`'s header only. `AgentItem` (the grid card, `frontend/src/components/AgentList.tsx:1027-1028`) still renders `<AgentTypeBadge agent={agent} />` and `<RoleBadge role={agent.role} />` as two separate, unchanged pills. This case is a non-regression check on the grid view, not a check on the new component.
- **Steps**:
  1. Navigate to `http://localhost:4321/` without opening any agent's detail modal.
  2. Locate an agent card whose agent has both a resolvable type and a role.
  3. Screenshot the card's badge row.
  4. Confirm **two** separate pills render side by side — one type pill (single dot + type text + its own `title="Agent type: <type>"`), one role pill (single dot + role text + its own `title="Role: <role>"`) — not one merged pill.
- **Expected Result**: The grid card still shows two distinct badges exactly as before TASK-152; only the detail modal's header changed.
- **Repeatable Unit Test**: Created (added during UAT generation, since the composition claim — "two separately-titled elements, not one merged pill" — is deterministic and cheap to assert without a browser): `frontend/src/components/AgentList.test.tsx`, same `describe('AgentIdentityBadge (merged type + role pill, TASK-152 Step 3)')` block → `it("leaves AgentItem's grid-card badges as two separate pills, unaffected by the header merge (TASK-152 out of scope)", ...)` — renders `<AgentList />` without opening any dialog and asserts `getByTitle('Agent type: claude')` and `getByTitle('Role: frontend')` both exist as separate elements, and that no element carries the combined title `Agent type: claude, Role: frontend`. The remaining visual half of this case (pixel-level side-by-side spacing/rendering of the two pills in the live grid) stays manual below.
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "TASK-152 Step 3"`
- [x] Pass <!-- 2026-09-13 -->

---

## Gaps (dropped or narrowed from initial research)

- No case exercises the exact pixel-level "old two-pill layout vs. new one-pill layout" before/after diff — TASK-152 didn't capture a pre-change screenshot, so UAT-UI-001/002 verify the new pill's correctness directly rather than a visual diff against the old state.
- The symmetric "role resolves but type doesn't" case (an Aider/non-Claude/non-Codex agent with a role set) is deliberately left as unit-only coverage (see UAT-UI-003's note) rather than promoted to its own manual UAT-UI case, since it's the less common configuration to find live in this repo's own agent roster and the underlying logic is identical to the type-only path already covered manually.
