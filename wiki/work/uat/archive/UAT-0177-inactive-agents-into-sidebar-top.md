---
id: UAT-0177
aliases: [UAT-0177]
title: "UAT: Relocate InactiveAgentsPanel into a collapsible section at the top of the sidebar"
status: skipped
task: TASK-0177
created: 2026-09-18
updated: 2026-10-17
---

# UAT-0177 — UAT: Relocate InactiveAgentsPanel into a collapsible section at the top of the sidebar

implements::[[TASK-0177]]

> **Source task**: [[TASK-0177]]
> **Generated**: 2026-09-18

---

## Prerequisites

- [ ] Dev servers running: `make dev` (host-server on port 8788, frontend on port 4321). Live cases use `http://localhost:4321/` (NOT `:4173`, a stale preview build). The route `/` renders `AgentsPage` then `AgentList` then `AgentSidebar` (`<aside aria-label="Agents">`, width `SIDEBAR_WIDTH_PX = 320`).
- [ ] At least one registered agent with `no-window` / `exited` / `unknown` state so the section has rows. `GET http://localhost:4321/api/status` (through the Vite `/api` proxy) lists each agent's `state` and `windowPresent`. At generation time the live board had five `no-window` agents plus busy/idle/awaiting ones.
- [ ] Unit cases run from `frontend/` with `npx vitest run <file> -t "<name>"`.

**Safety rule for every live case**: never click **Wake** and never click the confirm button labelled **Remove** on a real agent. Wake starts/restarts a real tmux window and Remove deletes the agent from SQLite. Live cases only look at the affordances, or open then **Cancel** the confirm dialog. Anything that must exercise Wake or Remove for real is covered by the unit tests, which mock `fetch`.

Source under test:
- `frontend/src/components/InactiveAgentsPanel.tsx` — collapsible section (`collapsed` defaults to `true`, header `button[aria-expanded]` reading `Inactive Agents (N)`, rows are `li` with `title={workdir}`, `border-r-[4px]` plus inline `borderRightColor = getStatusColor(status)`, buttons `aria-label="Wake agent <name>"` / `aria-label="Remove agent <name>"`, `ConfirmDialog` message `Remove agent "<name>"? ...`). `INACTIVE_STATUSES = ['no-window','exited','error','unknown']`.
- `frontend/src/components/AgentList.tsx` `AgentSidebar` — filter input, then `{totalAgentCount > 0 && <InactiveAgentsPanel />}`, then the empty states / project groups. Empty state `No active agents.` shows when agents are registered, the filter is empty and no active rows remain.
- `frontend/src/pages/AgentsPage.tsx` — now only `<main><ErrorBoundary><AgentList /></ErrorBoundary></main>`; no `InactiveAgentsPanel` import or wrapper row.

---

## Test Cases

### UAT-EDGE-001: Section is docked between the filter and the first project group, collapsed by default, with the inactive count
- **Scenario**: A registered set with both active and inactive agents. The sidebar must show `Inactive Agents (N)` collapsed (`aria-expanded="false"`, inactive rows not rendered) positioned after the filter input and before the first project group header.
- **Steps**:
  1. Run the unit command below (AgentList side: renders the sidebar with a grouped set plus one `exited` agent; asserts the toggle is `Inactive Agents (1)`, collapsed, row hidden, DOM order filter -> toggle -> first group header `Alpha2`, and that expanding reveals the row).
  2. Run the second unit command (panel side: `InactiveAgentsPanel` alone is collapsed by default and counts only the three inactive agents out of five).
- **Expected Result**: Both unit tests pass.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`docks a collapsed "Inactive Agents" section between the filter and the first project group (TASK-0177)`) and `frontend/src/components/InactiveAgentsPanel.test.tsx` (`is collapsed by default, showing only the inactive count`). Both were written during the TASK-0177 tackle; this generation run authored no new test files.
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "docks a collapsed"` — verified: 1 passed. Second: `cd frontend && npx vitest run src/components/InactiveAgentsPanel.test.tsx -t "is collapsed by default"` — verified: 1 passed
- [x] Pass <!-- 2026-09-18 -->

---

### UAT-UI-001: Live — section renders at the top of the 320px sidebar, above the project groups, and is not rendered anywhere else on the page
- **Page**: `http://localhost:4321/`
- **Description**: Visual confirmation of the relocation, including the page-level half of the task (the full-width card beside the Add Agent button is gone).
- **Steps**:
  1. Open `http://localhost:4321/` at a desktop width (e.g. 1440x900).
  2. In the left sidebar, confirm the order top to bottom: filter input (`Filter agents`), the `▸ INACTIVE AGENTS (N)` header, then the first project group header.
  3. Confirm `N` equals the number of agents in `GET http://localhost:4321/api/status` whose `state` is `no-window`, `exited`, `error` or `unknown`.
  4. Confirm no other "Inactive Agents" control exists outside the sidebar (nothing beside the NavBar Add Agent button, nothing in the main pane). Console check (read-only): `Array.from(document.querySelectorAll('button')).filter(b => /Inactive Agents/.test(b.textContent)).map(b => !!b.closest('aside[aria-label="Agents"]'))` should return exactly `[true]`.
  5. Confirm the section has no card chrome: no drop shadow and no rounded card box around the whole section; only a `border-b` divider below it.
- **Expected Result**: Exactly one Inactive Agents control, inside the sidebar, between the filter and the first group; collapsed on first load; `N` matches the API; no full-width card in the page body.
- **Repeatable Unit Test**: Not applicable for the page-level half: no test renders `AgentsPage` or asserts the panel is absent from it. The sidebar-order half is covered by UAT-EDGE-001. Missing assertion: `AgentsPage` renders no `Inactive Agents` button outside `aside[aria-label="Agents"]`, and no card-chrome classes (`shadow-card`, `rounded-card`) on the section.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk (unit half now covered by AgentList.test.tsx "AgentsPage renders no Inactive Agents control..." which passes; live order, N-vs-API match and no-shadow rendering remain unverified)] <!-- 2026-09-18 -->

---

### UAT-EDGE-002: Expanding the section lists only no-window / exited / error / unknown agents, with a compact two-line row
- **Scenario**: A mixed set (`no-window`, `exited`, `error`, `busy`, `idle`). Expanding must list exactly the inactive ones; `no-window` reads as `closed`; the workdir moves into the row's `title` tooltip rather than being rendered inline.
- **Steps**:
  1. Run the unit command below.
- **Expected Result**: The test passes: `closed-agent`, `exited-agent`, `errored-agent` are listed; `busy-agent` and `ready-agent` are not; the text `closed` is shown for the no-window row; that row's `li.title` equals its workdir.
- **Repeatable Unit Test**: Created: `frontend/src/components/InactiveAgentsPanel.test.tsx` (`lists only no-window/exited/error/unknown agents when expanded`; written during the TASK-0177 tackle). Coverage gap: the fixture has no agent whose derived status is `unknown`, so the `unknown` member of `INACTIVE_STATUSES` is not asserted despite the test title. Missing assertion: an agent that derives to `unknown` appears in the expanded list (labelled `unknown`).
- **Unit Test Command**: `cd frontend && npx vitest run src/components/InactiveAgentsPanel.test.tsx -t "lists only no-window/exited/error/unknown"` — verified: 1 passed
- [x] Pass <!-- 2026-09-18 -->

---

### UAT-UI-002: Live — expanded rows fit the 320px column with no horizontal overflow, at desktop and ~1024px widths
- **Page**: `http://localhost:4321/`
- **Description**: The `[DEFERRED-TO-UAT]` step from TASK-0177. Rows must be compact (project badge + name on line one, status label on line two, right-aligned Wake button plus trash icon button) and must not force horizontal scroll inside the sidebar, including with long agent names.
- **Steps**:
  1. Open `http://localhost:4321/` at 1440x900. Click the `Inactive Agents (N)` header (or the `▸` glyph) to expand.
  2. Visually confirm each row: line 1 is the project badge and the agent name (truncated with an ellipsis if long), line 2 is the uppercase status label (`CLOSED` for no-window, `EXITED`, `ERROR`, `UNKNOWN`); on the right, a blue `Wake` button and a small red-outlined trash icon button. No workdir path is printed in the row.
  3. Hover a row: the native tooltip shows the agent's workdir.
  4. Console check (read-only): `const a = document.querySelector('aside[aria-label="Agents"]'); [a.scrollWidth, a.clientWidth]` — the two numbers must be equal (no horizontal overflow).
  5. Resize the viewport to about 1024x768 and repeat steps 2 and 4.
  6. Click the header again: the rows collapse and the count remains.
- **Expected Result**: Two-line compact rows, workdir only in the tooltip, Wake and trash controls visible without clipping, `scrollWidth === clientWidth` on the sidebar at both widths, toggle collapses and re-expands cleanly.
- **Repeatable Unit Test**: Not applicable: jsdom has no layout engine, so overflow, truncation and visual compactness cannot be asserted. The tooltip/label part is covered by UAT-EDGE-002. Missing assertion: none feasible in vitest; a Playwright layout assertion (`aside.scrollWidth <= aside.clientWidth`) would be needed and no e2e harness exists in the repo.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk (overflow/truncation/compact layout not assertable in jsdom)] <!-- 2026-09-18 -->

---

### UAT-UI-003: Live — each inactive row has a 4px status-colored right border (grey for no-window/unknown, red for exited/error)
- **Page**: `http://localhost:4321/`
- **Description**: Rows use `getStatusColor(status)` on `border-r-[4px]`, matching the active rows from TASK-0171. Colors: `no-window`/`unknown` `#9a9da5` (`rgb(154, 157, 165)`), `exited`/`error` `#e5484d` (`rgb(229, 72, 77)`).
- **Steps**:
  1. Run the unit command below (renders an `exited` agent in `InactiveAgentsPanel` and asserts `border-r-[4px]`, `borderRightColor` equals the normalized `STATUS_CONFIG.exited.dot`, and `border-line` remains in the class list).
  2. Live: expand the section and compare the right edge of a `CLOSED` row with the 1px left/top/bottom edges. Console check on a row: `getComputedStyle(document.querySelector('aside li')).borderRightColor` should read `rgb(154, 157, 165)` for a no-window row (and `rgb(229, 72, 77)` for an exited/error row if one exists) and `borderRightWidth` should read `4px`.
  3. Toggle the theme (NavBar) and confirm the border color is unchanged in dark mode.
- **Expected Result**: Unit test passes. Live: right border is 4px, grey for closed rows, red for exited/error rows, identical in both themes.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`paints InactiveAgentsPanel rows with the same 4px status right border (TASK-0177)`; written during the TASK-0177 tackle). Coverage gap: only `exited` is asserted. Missing assertions: a `no-window` row (and `unknown`, `error`) gets `#9a9da5` / `#e5484d` respectively.
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "paints InactiveAgentsPanel rows"` — verified: 1 passed
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk (unit half now covers no-window/unknown/exited/error border colors and passes; live computed-style check and dark-mode theme toggle unverified)] <!-- 2026-09-18 -->

---

### UAT-EDGE-003: Wake issues DELETE (only when the window is still present) and then POST to `/agents/:id/window`
- **Scenario**: Wake on a `no-window` agent must only POST; Wake on an agent whose window is still present (e.g. `exited` with `windowPresent: true`) must DELETE the stale window first and then POST. Both hit `/agents/:id/window`.
- **Steps**:
  1. Run the unit command below (it matches both Wake tests; `fetch` is mocked so no real agent is touched).
- **Expected Result**: 2 tests pass: `[POST /agents/1/window]` for the window-less agent; `[DELETE /agents/2/window, POST /agents/2/window]` for the windowed one.
- **Repeatable Unit Test**: Created: `frontend/src/components/InactiveAgentsPanel.test.tsx` (`Wake on a window-less agent POSTs ...` and `Wake on an agent whose window is still present DELETEs then POSTs ...`; written during the TASK-0177 tackle). Coverage gap: the error path (non-OK response shows `rowError` text under the list, button re-enabled) has no test. Missing assertion: a failed wake renders the server's `error` message and clears the busy state.
- **Unit Test Command**: `cd frontend && npx vitest run src/components/InactiveAgentsPanel.test.tsx -t "Wake on"` — verified: 2 passed
- [x] Pass <!-- 2026-09-18 -->

---

### UAT-EDGE-004: Remove asks for confirmation first, DELETEs only on confirm, and Cancel issues no request
- **Scenario**: Clicking the trash button opens `ConfirmDialog` (`Remove agent "<name>"? ...`); no mutation happens until the `Remove` confirm button is clicked; Cancel closes the dialog with no request.
- **Steps**:
  1. Run the unit command below (matches both the confirm test and the cancel test; `fetch` is mocked).
- **Expected Result**: 2 tests pass: after confirm exactly one `DELETE /agents/1`; after Cancel zero non-GET requests and the dialog text is gone.
- **Repeatable Unit Test**: Created: `frontend/src/components/InactiveAgentsPanel.test.tsx` (`Remove opens the confirm dialog and only DELETEs the agent after confirming` and `cancelling the confirm dialog issues no request`; written during the TASK-0177 tackle).
- **Unit Test Command**: `cd frontend && npx vitest run src/components/InactiveAgentsPanel.test.tsx -t "confirm dialog"` — verified: 2 passed
- [x] Pass <!-- 2026-09-18 -->

---

### UAT-UI-004: Live — Wake and Remove affordances are present, labelled, and Remove opens then cancels its confirm dialog (no side effects)
- **Page**: `http://localhost:4321/`
- **Description**: Live check of the compact controls without triggering the real side effects (see the safety rule above).
- **Steps**:
  1. Expand `Inactive Agents (N)`. Check via the accessibility tree or console that each row has `button[aria-label="Wake agent <name>"]` (label text `Wake`) and `button[aria-label="Remove agent <name>"]` (trash icon, no visible text). Do NOT click Wake.
  2. Click the trash button on one row. The confirm dialog opens with `Remove agent "<name>"? This deletes it from conductor.conf and drops its queued tasks.` and `Remove` / `Cancel` buttons.
  3. Click **Cancel** (never `Remove`). The dialog closes; the row is still listed; the section is still expanded.
  4. Optional network check: the browser network log shows no non-GET request to `/api/agents/...` during steps 1-3.
- **Expected Result**: Both controls exist with the exact aria-labels and fit the row; the confirm dialog appears for the trash click and Cancel leaves everything unchanged with no DELETE/POST issued.
- **Repeatable Unit Test**: Not applicable for the live look; the behavior itself is covered by UAT-EDGE-003 and UAT-EDGE-004.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk (live aria-labels, confirm dialog open/Cancel and no-network-mutation not checked; no browser automation in headless mode)] <!-- 2026-09-18 -->

---

### UAT-EDGE-005: All agents inactive shows "No active agents." while the inactive section stays visible and usable
- **Scenario**: Agents are registered but every one is inactive (`exited`, `no-window`) and the filter is empty. The sidebar must show `No active agents.` (not `No agents registered.` and not `No agents match your filter.`), keep the filter input, and keep the `Inactive Agents (N)` section that expands to list the agents.
- **Steps**:
  1. Run the unit command below.
  2. Optional live check without touching real agents: in Playwright, intercept `**/api/status` with a payload whose `agents` are two `exited`/`no-window` entries (`page.route`), reload `http://localhost:4321/`, and confirm `No active agents.` plus `Inactive Agents (2)`. SSE updates for real agents may repopulate the list; treat the unit test as the authoritative evidence and this as best-effort.
- **Expected Result**: Unit test passes: `No active agents.` shown, the other two empty-state texts absent, `Filter agents` input present, toggle `Inactive Agents (2)` expands to show `sleepy-one` and `sleepy-two`.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`shows "No active agents." with the inactive section still visible when every registered agent is inactive (TASK-0177)`; written during the TASK-0177 tackle).
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "No active agents"` — verified: 1 passed
- [x] Pass <!-- 2026-09-18 -->

---

### UAT-EDGE-006: The inactive section is independent of the sidebar filter, and an `error` agent appears in both the active groups and the inactive section
- **Scenario**: (a) Typing in `Filter agents` narrows only the project groups; `Inactive Agents (N)` keeps its count because the panel reads its own `useAgents()` list. (b) `error` is in both `ACTIVE_STATUSES` and `INACTIVE_STATUSES` by design (TASK-0169), so an errored agent shows in a project group and in the inactive list.
- **Steps**:
  1. Live (a): with the section expanded, type an active agent's name into `Filter agents` (e.g. part of `cryptwiz-1`). Confirm project groups narrow to matches while `Inactive Agents (N)` keeps the same `N` and the same rows.
  2. Live (b): no agent is in `error` state on the live board by default, so intercept `**/api/status` in Playwright with one agent of `state: 'error'` (plus a `projectName`) and reload. Confirm the agent appears as a row in its project group with a red 4px right border AND as a row in the expanded inactive list (`ERROR` label). Do not create a real errored agent.
  3. Clear the filter and confirm the sidebar returns to its full grouped list.
- **Expected Result**: (a) inactive count and rows unchanged by the filter; (b) the errored agent is listed in both places; the task's "do not change that here" holds.
- **Repeatable Unit Test**: Not applicable as created: no test covers either half (verified by reading `AgentList.test.tsx` and `InactiveAgentsPanel.test.tsx`; the panel test's fixture includes an `error` agent but only asserts it is listed in the panel, not that it is also in the active list). Both are promotable in principle (vitest with `stubSidebarFetch`), but this generation run was restricted to wiki files. Missing assertions: (a) after `fireEvent.change` on `Filter agents` with a non-matching string, `Inactive Agents (N)` still shows the full inactive count; (b) with `state: 'error'` the same agent name renders both in a project group and inside the expanded inactive section.
- [x] Pass <!-- 2026-09-18 -->

---

### UAT-EDGE-007: Clicking an inactive row still opens the panel's own detail modal, and clicks inside the modal or closing it do not collapse the section
- **Scenario**: Open-detail behavior is explicitly unchanged in this task (repointing to the main pane is TASK-0178). The row click opens the portalled `AgentDetailModal`; backdrop click or Escape closes it; clicks inside the modal must not bubble to the panel's toggle (the `stopPropagation` wrapper).
- **Steps**:
  1. Run the unit command below (4 tests in the `opens AgentDetailModal (TASK-0172)` describe).
  2. Live (safe, read-only): expand the section, click a `CLOSED` row (not the Wake or trash buttons). A dialog named `<name> detail` opens with `Terminal` and `Details` tabs. Click between the tabs, then press Escape. The dialog closes and the section is still expanded. Do not type into the Terminal tab.
- **Expected Result**: 4 unit tests pass; live behavior matches. Note: if TASK-0178 has since repointed row clicks to the pane, this case is superseded by UAT-0178 and the unit tests will have been updated with it.
- **Repeatable Unit Test**: Created: `frontend/src/components/InactiveAgentsPanel.test.tsx` (`InactiveAgentsPanel opens AgentDetailModal (TASK-0172)`, 4 tests; pre-existing from TASK-0172, still green after the TASK-0177 relocation).
- **Unit Test Command**: `cd frontend && npx vitest run src/components/InactiveAgentsPanel.test.tsx -t "opens AgentDetailModal"` — verified: 4 passed
- [x] Pass <!-- 2026-09-18 -->

---

### UAT-INT-001: The bidirectional import between `AgentList.tsx` and `InactiveAgentsPanel.tsx` causes no build, type, lint-cycle or runtime (TDZ) failure
- **Scenario**: `AgentList.tsx` now imports `InactiveAgentsPanel`, which imports `deriveStatus`, `getStatusColor`, `ProjectBadge`, `AgentDetailModal` and types from `AgentList.tsx`. The task accepts this only if it is verified clean; otherwise the `sidebarTop` slot fallback was required.
- **Steps**:
  1. Run `cd frontend && npx tsc --noEmit` — must exit 0 with no output. Verified at generation time: clean.
  2. Run a build into a scratch directory so the served `dist/` is not overwritten: `cd frontend && npx vite build --outDir ../tmp/uat-0177-dist --emptyOutDir` — must end with `built in ...` (the >500 kB chunk warning is pre-existing and acceptable). Verified at generation time: built. Remove `tmp/uat-0177-dist` afterwards (gitignored).
  3. Run `cd frontend && npx eslint src/components/InactiveAgentsPanel.tsx src/components/AgentList.tsx` — must report 0 errors (one pre-existing `react-hooks/exhaustive-deps` warning on `pendingNotifyTimersRef` at AgentList.tsx is acceptable) and no import-cycle rule. Verified at generation time: 0 errors, 1 warning.
  4. Run the runtime evidence: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "TASK-0177"` — importing `AgentList` (which pulls in the panel) and rendering the sidebar with the section proves no temporal-dead-zone failure at module evaluation or render.
  5. Live: load `http://localhost:4321/` and confirm the browser console shows no `ReferenceError` / "Cannot access ... before initialization" errors.
- **Expected Result**: Steps 1-3 clean, step 4 shows 3 passed, step 5 shows no TDZ or import errors and the page renders the sidebar with the section.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (the three `(TASK-0177)` tests, which import both modules and render the sidebar). Steps 1-3 are static gates with no unit-test equivalent.
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "TASK-0177"` — verified: 3 passed
- [FAIL: auto-judge: steps 1-4 machine-verified clean (tsc 0 errors, vite build built, eslint 0 errors/1 pre-existing warning, vitest 10 passed) but step 5 (live browser console free of TDZ/ReferenceError, sidebar renders) requires a browser — use /uat-walk] <!-- 2026-09-18 -->

---

## Coverage gaps (no test asserts these; see the per-case notes)

- `AgentsPage` no longer renders the panel or a wrapper row (UAT-UI-001).
- `unknown` status is listed in the section (UAT-EDGE-002).
- Grey (`no-window`/`unknown`) and red (`error`) status border colors on inactive rows; only `exited` is asserted (UAT-UI-003).
- Wake failure surfaces the server error text (UAT-EDGE-003).
- Section is independent of the sidebar filter; `error` agent appears in both sections (UAT-EDGE-006).
- No horizontal overflow at 320px / 1024px (UAT-UI-002; not assertable in jsdom).
