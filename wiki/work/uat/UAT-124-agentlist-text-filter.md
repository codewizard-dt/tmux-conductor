---
id: UAT-124
aliases: [UAT-124]
title: "UAT: AgentList text filter — scale the dashboard past small agent counts"
status: pending
task: TASK-124
created: 2026-08-15
updated: 2026-08-15
---

# UAT-124 — UAT: AgentList text filter — scale the dashboard past small agent counts

implements::[[TASK-124]]

> **Source task**: [[TASK-124]]
> **Generated**: 2026-08-15
> **Built test-first note**: unlike this session's earlier UI tasks, TASK-124 was implemented against a real vitest + React Testing Library harness (`frontend/`, landed by TASK-127) from the start — `agentMatchesFilter` is an exported pure predicate, and an RTL test already drives the real `<AgentList/>` component. This UAT promotes and extends that existing coverage rather than duplicating it, and closes three gaps the implementation session didn't cover: the three-way empty state, the bg-process scope boundary, and the deliberate "keyboard nav stays unfiltered" decision — all three are pinned as real, executed tests below, not left to a human to eyeball.
> **Bug found during this generation session, not present in shipped code**: while extending `AgentList.test.tsx` with the new cases below, adding a third `render()`-based test in the same file surfaced that RTL's DOM was leaking across tests — this repo's `vitest.setup.ts` note confirms `test.globals: true` is deliberately off, and RTL's auto-`afterEach(cleanup)` registration depends on that global. Fixed by adding an explicit `afterEach(() => { cleanup() })` to `AgentList.test.tsx` — a test-harness gap, not an `AgentList.tsx` defect, but reported here rather than silently worked around, since any future component test file in this repo with more than one `render()`-based test will hit the same failure mode.

---

## Prerequisites

- [ ] `frontend/` has working `node_modules/` (`npm install` run).
- [ ] `node`/`npm` available on `PATH`.

---

## Test Cases

### UAT-EDGE-001: `agentMatchesFilter` — field matching, empty/whitespace input, and the deliberate `workdir` exclusion
- **Scenario**: `agentMatchesFilter(agent, filterText)` (`frontend/src/components/AgentList.tsx`, exported module-scope function, module scope near `formatCost`) is a pure predicate matching case-insensitively against `name`/`projectName`/`role`/`branch`. `workdir`/`label`/`agentType` are deliberately excluded — the code comment above the function documents why (most agents share a long common workdir path prefix, making it low-signal; label/agentType are ephemeral or nearly-universal values).
- **Steps**: Already implemented and verified passing as part of TASK-124's own implementation (not this generation run) — no new work needed; this case documents and cross-references the existing coverage. Re-run the command below to re-verify.
- **Expected Result**: All 8 `agentMatchesFilter` cases pass: empty filterText matches, whitespace-only filterText matches, case-insensitive match on `name`, match on `projectName`, match on `role`, match on `branch`, no-match returns `false`, `null` `projectName`/`role`/`branch` never throw and are treated as non-matching, and a filter substring that only appears in `workdir` returns `false` (pins the deliberate exclusion).
- **Repeatable Unit Test**: Created (pre-existing from TASK-124's own implementation, cited here): `frontend/src/components/AgentList.test.tsx` (`describe('agentMatchesFilter', ...)`, 8 cases).
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx`
- [x] Pass <!-- 2026-08-15 -->

### UAT-UI-001: Typing into the filter input narrows the rendered agent cards (real component, real DOM)
- **Scenario**: The `<AgentList/>` default-exported component (no props) fetches `${API_BASE}/status` on mount and derives `filteredAgents` from `agents`/`filterText`. Typing into the `aria-label="Filter agents"` input (`AgentList.tsx:1466-1472`) must change which agent cards are actually present in the DOM, not merely change a piece of internal state.
- **Steps**: Already implemented and verified passing as part of TASK-124's own implementation. Re-run the command below to re-verify.
- **Expected Result**: With two fixture agents (`alpha-backend`, `beta-frontend`) mounted via a mocked `fetch`/stubbed `EventSource`, typing `'alpha'` into the filter input leaves `alpha-backend`'s card in the DOM and removes `beta-frontend`'s.
- **Repeatable Unit Test**: Created (pre-existing from TASK-124's own implementation, cited here): `frontend/src/components/AgentList.test.tsx` (`describe('AgentList filter (integration)', ...)`, `'typing into the filter input narrows the rendered agent cards'`).
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx`
- [x] Pass <!-- 2026-08-24, verified live via Playwright: navigated to http://localhost:4321 with the real live dashboard (5 real registered agents plus two fixture agents `uat124-alphanode`/`uat124-betanode`, launchCmd `bash`, workdirs under `./tmp/uat124-alpha`/`./tmp/uat124-beta`). Typed `uat124-alpha` into the `aria-label="Filter agents"` input and re-captured the accessibility snapshot: only `uat124-alphanode`'s card remained in the DOM — `uat124-betanode` and all 5 real agents' cards were gone, and the section counts updated live (Waiting/Stalled 2→1, Ready/No tasks 5→0). Screenshot: uat124-001-alpha-filter.png. -->: The three-way empty state — zero agents, filter-matches-none, and populated are all distinguishable in the DOM
- **Scenario**: TASK-124's Acceptance Criteria require "An empty filter match shows a distinct 'no matches' state, not a silently blank list" — distinct from the pre-existing "no agents exist at all" state. The render ternary (`AgentList.tsx:~1473-1481`) is: `agents.length === 0` → `"No agents registered."`, else `filteredAgents.length === 0` → `"No agents match your filter."`, else the populated grid. The filter `<input>` itself only renders when `agents.length > 0` (no point showing a filter box over an empty registry).
- **Steps**: New cases added during this UAT-generation run (not present when TASK-124 was implemented) — the implementation session covered the populated and filtered-to-zero-with-populated-registry cases only, not the true zero-agents case or an explicit assertion that the two "empty" messages are mutually exclusive. Run the command below.
- **Expected Result**: Two new cases both pass: (1) zero registered agents renders exactly `"No agents registered."` and no filter input is present at all (`getByLabelText('Filter agents')` finds nothing); (2) one registered agent plus a filter matching nothing renders exactly `"No agents match your filter."`, the agent's card is gone, and `"No agents registered."` is *not* also present (proving the two states are mutually exclusive, not both rendering due to a loose condition).
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`describe('AgentList empty states (agent filter)', ...)`, `'shows "No agents registered." (and no filter input) when there are zero agents'` and `'shows "No agents match your filter." — distinct from the zero-agents state — when the filter excludes every agent'`).
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx`
- [BLOCKED: sub-case (2) verified PASS live via Playwright — with the live dashboard's real 5 agents plus this session's `uat124-alphanode`/`uat124-betanode` fixtures registered (nonzero `agents.length`), typing a filter matching nothing (`zzz-no-such-agent-xyz`) into the `aria-label="Filter agents"` input rendered exactly `"No agents match your filter."`, no agent cards, and critically `"No agents registered."` was NOT also present — confirms the two empty states are mutually exclusive. Screenshot: uat124-002-003-no-match-bgproc-visible.png. Sub-case (1) — zero registered agents total, rendering `"No agents registered."` with no filter input present at all — could NOT be safely verified: the live dashboard is a shared session with 5 real production agents; forcing `agents.length === 0` would require deleting every real agent from the shared `conductor` tmux session, which the task's explicit safety constraints forbid (only uat124- fixtures may be created/deleted; real agent data must never be touched). No environment with a genuinely empty agent registry was available to test against. Marking this case BLOCKED rather than Pass or Fail because the `agents.length === 0` render branch (`AgentList.tsx` ~1524-1525) was never actually observed in a browser — only reasoned about from the source.] <!-- 2026-08-24, verified live via Playwright (partial — see note) -->: Background-process cards are never affected by the agent filter
- **Scenario**: TASK-124's Acceptance Criteria explicitly require background-process cards to be unaffected — `BgProcessSection` (`AgentList.tsx:1131-1141`) reads from the entirely separate `bgs` state, structurally untouched by any `agents`/`filteredAgents` logic. This case proves it at the rendered-DOM level, not just by code inspection: an agent filter that excludes every agent must still leave a background-process row visible.
- **Steps**: New case added during this UAT-generation run. Run the command below.
- **Expected Result**: With one fixture agent and one fixture bg-process mounted, typing a filter that matches nothing removes the agent's card and shows `"No agents match your filter."`, while the bg-process row's name text remains visible throughout.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`describe('AgentList empty states (agent filter)', ...)`, `'leaves background-process cards visible and unaffected when the agent filter matches nothing'`).
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx`
- [x] Pass <!-- 2026-08-24, verified live via Playwright: with fixture agents `uat124-alphanode`/`uat124-betanode` and fixture bg-process `uat124-bgproc` (all registered live via the host-server API, launchCmd `bash`) mounted alongside the 5 real registered agents, typing a filter that matches zero agents (`zzz-no-such-agent-xyz`) removed every agent card and rendered `"No agents match your filter."`, while the `uat124-bgproc` row (name, "running" status, `bash` command) remained fully visible in the "Background processes" section throughout, unaffected by the agent filter. Screenshot: uat124-002-003-no-match-bgproc-visible.png. -->

### UAT-EDGE-002: Keyboard prev/next navigation in an open detail modal ignores the grid filter (pins the deliberate `orderedAgentIds` decision)
- **Scenario**: TASK-124's implementation deliberately left `orderedAgentIds` (`AgentList.tsx:~1222`, feeds the detail modal's Cmd/Ctrl+ArrowRight/Left navigation) on the *unfiltered* `agents` list, with a code comment explaining why: a user with a modal open shouldn't have keyboard nav suddenly change or strand because they typed a filter. This is exactly the kind of decision a future refactor could "fix" back into consistency with the grid's `filteredAgents` without realizing it would silently break navigation the moment the currently-open agent falls outside the filter (`handleNavigate`'s `orderedAgentIds.indexOf(prev.id) === -1` guard would then leave the modal stuck rather than advancing).
- **Steps**: New case added during this UAT-generation run — not covered anywhere in the implementation session. Run the command below.
- **Expected Result**: With three fixture agents sorted alphabetically as alpha/beta/gamma, opening the middle agent's (`node-beta`) detail modal, then typing a filter (`'backend'`) that excludes `node-beta` from the grid but keeps `node-alpha`/`node-gamma`: the modal for `node-beta` stays open (filtering the grid must never silently close an in-progress detail view), `node-beta`'s card is gone from the grid, and pressing the "next" keyboard shortcut (`metaKey` + `ArrowRight`) advances the modal to `node-gamma` — proving `orderedAgentIds` still contained all three agents, not just the filtered two. (If it had wrongly used the filtered list, `node-beta`'s id would no longer be in `orderedAgentIds` at all, and the navigation guard would leave the modal stuck on `node-beta` instead.)
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`describe('AgentList keyboard navigation ignores the grid filter', ...)`, `'next-agent navigation still reaches an agent hidden by the current filter (orderedAgentIds stays unfiltered)'`).
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx`
- [x] Pass <!-- 2026-08-15 -->

### UAT-STATIC-001: `npx tsc --noEmit`, `npm run build`, and the full frontend suite all pass cleanly
- **Scenario**: Task Acceptance Criteria require a clean typecheck and build; the full suite (including all filter-related cases above) must be green.
- **Steps**: Run the three commands below from `frontend/`.
- **Command**:
  ```bash
  cd frontend && npx tsc --noEmit
  ```
- **Expected Result**: Exits with no output and status 0. `npm run build` was also verified clean at generation time (tsc + vite build, only the pre-existing >500kB chunk-size advisory, not an error). `npm test` (full suite, `vitest run`) was verified at 54/54 passing across 4 test files at generation time — the suite is a moving target under concurrent multi-agent development this session, so judge a re-run on zero failures, not an exact count.
- **Repeatable Unit Test**: Not applicable: this command *is* the static gate itself, re-run verbatim.
- [x] Pass <!-- 2026-08-15 -->

### UAT-UI-004: The filter input reads as visually sensible in its actual position (Manual — genuine visual judgement)
- **Scenario**: Everything the filter *does* is machine-verified above (UAT-UI-001/002/003, UAT-EDGE-002). What remains is purely a matter of visual taste: does the input look intentionally placed, sized, and styled, rather than merely functionally correct? No DOM assertion can substitute for looking at it.
- **Steps**:
  1. With `make dev` running, open the dashboard.
  2. Observe the filter input's position (above the agent card grid, below the "tmux Conductor — Agents" heading and the session banner if present), its width (`max-w-xs`, narrower than the grid it sits above), and its styling (matches `AddAgentForm`'s established border/font/focus-ring conventions).
  3. Click into it and confirm the focus ring appears, then type a few characters and confirm the placeholder text disappears normally and the typed text reads clearly in the monospace font.
- **Expected Result**: The input looks like a deliberate, integrated part of the page — not misaligned, not oddly sized relative to the grid, not visually inconsistent with the rest of the app's form inputs.
- **Repeatable Unit Test**: Not applicable: visual/layout judgement — no frontend visual-regression tooling exists in this repo.
- [FAIL: verified live via Playwright — position/sizing/border/focus-ring all read as intentional (input sits directly below the "tmux Conductor — Agents" heading, narrower than the grid, matches `AddAgentForm`'s border/font/focus-ring conventions, and the focus ring correctly appears on click), but the typed text itself does NOT "read clearly": once dark mode is active (this dashboard's live default), typed characters are nearly invisible. Confirmed via `getComputedStyle` on the live input after typing `"uat"`: `background-color: rgb(255, 255, 255)` (pure white) against `color: rgb(238, 240, 244)` (near-white light-grey) — a contrast ratio around 1.05:1, far below WCAG's 4.5:1 minimum. Cropped screenshot at the input's exact bounding box confirms it visually: the placeholder is legible (a darker muted grey) but typed text is essentially white-on-white. Root cause: `AgentList.tsx`'s filter-input `className` (~line 1521) hardcodes `bg-white` — a literal, non-theme-aware Tailwind color — while `text-ink` is a CSS-variable-backed token that resolves to a light color in dark mode; the two were never designed to appear together. This is not unique to this input: `AddAgentForm.tsx`'s shared `inputCls` (lines 22-28) uses the identical `bg-white ... text-ink` combination and was confirmed via the same `getComputedStyle` check to have the exact same white-on-white defect on its "Name" field — so TASK-124's filter input faithfully copied an app-wide input convention that, at the time TASK-124 was implemented (2026-08-15, no dark mode yet), was correct, but which a later, still-in-progress dark-mode rollout (TASK-122/UAT-122, concurrently being tested this session) has not yet reached. UAT-122's own pre-flagged list of known `bg-white`/hardcoded-hex gaps in `AgentList.tsx` (lines 222, 310, 324, 329, 337, 353, 690, 699, 749, 952, 982) does not include this filter input's line, and UAT-122's own UAT-UI-004 case did not surface it either — so this is a genuinely new, previously-unrecorded instance of the same defect family, found here because this UAT's own steps require actually typing into the input and reading the result, not just checking its position. Screenshots: uat124-004-visual-focused-typed.png (full page) and the cropped/upscaled close-up confirming white-on-white text. Not fixed — reported per instructions; likely belongs to TASK-122's dark-mode-conversion scope (or a follow-up) rather than being re-opened against TASK-124 itself.] <!-- 2026-08-24, verified live via Playwright, honest fail — real bug found -->

---

## Coverage vs Acceptance Criteria

| Acceptance criterion | Covered by |
|---|---|
| A text input filters the visible agent cards by a case-insensitive substring match on agent name (at minimum) | UAT-EDGE-001 (predicate logic), UAT-UI-001 (real DOM effect) |
| Background-process cards are never affected by the agent filter | UAT-UI-003 |
| An empty filter match shows a distinct "no matches" state, not a silently blank list | UAT-UI-002 |
| `npx tsc --noEmit` and `npm run build` pass cleanly in `frontend/` | UAT-STATIC-001 |
| (implementation detail, deliberate and documented, not in the original AC) `orderedAgentIds`/keyboard nav stays unfiltered | UAT-EDGE-002 |
| (visual polish, not functionally testable) Input placement/styling reads as intentional | UAT-UI-004 |

**Split summary**: 6 of 7 cases (86%) execute a genuine machine-checkable verdict — a materially higher ratio than this session's earlier UI tasks (which ranged 1/6–5/8), because TASK-124 was built against a real component-test harness from the start rather than having tests bolted on after the fact. Only UAT-UI-004 (pure visual/layout judgement) is human-only, and only because no visual-regression tooling exists in this repo — not because the behavior itself is unverifiable.

**Note on `uatGenerate.promoteTests`**: the stored preference (`true`, legacy grammar) maps to `dedicated`, but the repo's own layout overrides it — `frontend/src/components/AgentList.test.tsx` already exists as a sibling to `AgentList.tsx` (TASK-127's established convention, itself already used by every prior filter/UI test this session). The 4 new cases (UAT-UI-002 ×2, UAT-UI-003, UAT-EDGE-002) were added directly to that existing file rather than a new dedicated-folder file.
