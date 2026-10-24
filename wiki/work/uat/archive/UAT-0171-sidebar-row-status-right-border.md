---
id: UAT-0171
aliases: [UAT-0171]
title: "UAT: Add a status-colored right border to each sidebar agent row"
status: skipped
task: TASK-0171
created: 2026-09-18
updated: 2026-10-17
---

# UAT-0171 — UAT: Add a status-colored right border to each sidebar agent row

implements::[[TASK-0171]]

> **Source task**: [[TASK-0171]]
> **Generated**: 2026-09-18

---

## Prerequisites

- [ ] Dev servers running: `make dev` (host-server on port 8788, frontend on port 4321). Live cases use `http://localhost:4321/` (NOT `:4173`, a stale preview build).
- [ ] At least three registered agents with live tmux windows so the sidebar shows several statuses at once: one `busy`, one `idle` with queued tasks (green), and, for the amber case, one `awaiting` (a pending permission/AskUserQuestion dialog) or `empty` (`idle` with 0 queued tasks). `GET http://localhost:8788/api/status` lists each agent's `state` and `queuedTasks`.
- [ ] Theme toggle available in the NavBar (toggles the `dark` class on `<html>` and persists `localStorage['theme']`).

Source under test: `AgentItem` in `frontend/src/components/AgentList.tsx` (root `div role="button"`, `aria-label="<name> detail"`, className `... border border-r-[4px] border-line bg-card ...`, `style={{ borderRightColor: getStatusColor(status) }}`); colors come from `STATUS_CONFIG[status].dot` (busy `#3b6ef6`, idle/idle-waiting `#30a46c`, awaiting/empty `#e0901a`, error/stalled `#e5484d`, starting `#4f5a78`, no-window/unknown `#9a9da5`). Only `ACTIVE_STATUSES` rows render in the sidebar (`awaiting`, `stalled`, `error`, `busy`, `starting`, `idle`, `idle-waiting`, `empty`); `exited`, `no-window` and `unknown` are excluded (they render in `InactiveAgentsPanel`; `error` is intentionally in both sets).

---

## Test Cases

### UAT-UI-001: Each sidebar row gets a 4px right border colored from STATUS_CONFIG for its derived status
- **Page**: `http://localhost:4321/` (route `/` renders `AgentsPage` then `AgentList` then `AgentSidebar`)
- **Description**: `AgentItem` sets `border-r-[4px]` and `style.borderRightColor = getStatusColor(deriveStatus(agent))`, reusing the existing `STATUS_CONFIG` map with no new color table.
- **Steps**:
  1. Run the unit test command below. It renders one agent per case (`busy`, `idle`, `awaiting`, `error`, `starting`, `stalled`, `empty`) and compares the row's `style.borderRightColor` with `STATUS_CONFIG[status].dot` (both normalized through jsdom's `rgb(...)` round-trip), and asserts the class list contains `border-r-[4px]`.
  2. Live cross-check: open `http://localhost:4321/`, and for each row in the sidebar note the right-edge color and the status badge text.
- **Expected Result**: 7 unit tests pass. Live: busy row has a blue right border, idle a green one, awaiting/no-tasks amber, stalled red, starting slate; the border is visibly thicker (4px) than the 1px left/top/bottom edges.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`AgentList sidebar row status right border (TASK-0171) > paints the %s row with the STATUS_CONFIG color as a 4px right border`, 7 parameterized cases). Note: `idle-waiting` (idle Codex agent) is not in the parameter list, and it shares `#30a46c` with `idle`.
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "paints the .* row with the STATUS_CONFIG color"` — verified: 7 passed
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk (unit half green: 8 parameterized cases incl. idle-waiting, border-line + label + aria-label assertions, all pass; Expected's live half — rendered thickness vs 1px edges, per-status colors on real rows — is not machine-asserted)] <!-- 2026-09-18 -->

---

### UAT-UI-002: A status flip changes only the border color; the row's class list is unchanged
- **Page**: `http://localhost:4321/`
- **Description**: Because the border width class is constant and only the inline `borderRightColor` varies, an SSE `agent-update` that flips an agent from `idle` to `busy` must recolor the border without changing `className` (the no-layout-shift rule mirroring TASK-0164).
- **Steps**:
  1. Run the unit test command below (renders an `idle` agent with a queued task, captures the row's `className` and border color, fires an SSE `agent-update` with `state: 'busy'`, then re-reads the row).
- **Expected Result**: Border color before equals the normalized idle green; after the update it equals the normalized busy blue and differs from before; `className` after is strictly equal to `className` before.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`AgentList sidebar row status right border (TASK-0171) > changes only the border color, not the class list, when an agent status flips`)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "changes only the border color, not the class list"` — verified: 1 passed
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk (unit test passes and asserts the full Expected: idle green -> busy blue, colors differ, className strictly equal; only the UI-type fail-closed rule blocks an auto pass)] <!-- 2026-09-18 -->

---

### UAT-UI-003: Live check in both themes — busy row is blue, awaiting row is amber
- **Page**: `http://localhost:4321/`
- **Description**: The `[DEFERRED-TO-UAT]` step from TASK-0171. The border is inline-styled so it must render identically in light and dark; this is the visual confirmation the jsdom tests cannot give.
- **Steps**:
  1. Open `http://localhost:4321/` with the light theme active (NavBar toggle reads `Switch to dark mode`).
  2. In devtools run:
     `[...document.querySelectorAll('aside[aria-label="Agents"] [role="button"]')].map(r => [r.getAttribute('aria-label'), getComputedStyle(r).borderRightColor, getComputedStyle(r).borderRightWidth])`
  3. Match each row to its status badge text and confirm: busy `rgb(59, 110, 246)`, idle `rgb(48, 164, 108)`, awaiting or no tasks `rgb(224, 144, 26)`, stalled/error `rgb(229, 72, 77)`, starting `rgb(79, 90, 120)`; every `borderRightWidth` is `4px`.
  4. Take a screenshot of the sidebar to `wiki/work/uat/screenshots/UAT-0171-light.png`.
  5. Click the NavBar theme toggle (dark), re-run the devtools snippet, and take `wiki/work/uat/screenshots/UAT-0171-dark.png`.
- **Expected Result**: In both themes the busy row shows a blue right border and the awaiting (or no-tasks) row an amber one; computed colors and the `4px` width are identical across themes (the hexes are theme-independent); the status badge text is still present on every row.
- **Repeatable Unit Test**: Not applicable: computed styles across the `dark` class and a real browser render are not reproduced in jsdom; the per-status color mapping itself is covered by UAT-UI-001.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk (needs real browser in both themes, a live busy row and a live awaiting/no-tasks row; live fleet currently has no busy agent and no idle agent with queued tasks, and live data must not be seeded)] <!-- 2026-09-18 -->

---

### UAT-UI-004: No layout shift on status change; other three border sides keep the line color
- **Page**: `http://localhost:4321/`
- **Description**: The border width is constant, so a row's bounding box must not change when its status (and therefore border color) changes. The left, top and bottom borders must remain `border-line` and only the right border takes the status color.
- **Steps**:
  1. Open `http://localhost:4321/` and pick an agent that can change status (e.g. an `idle` agent you can dispatch a command to, so it goes `busy` then back to `idle`).
  2. In devtools capture: `const r = document.querySelector('aside[aria-label="Agents"] [aria-label="<name> detail"]'); JSON.stringify(r.getBoundingClientRect())`, and also `getComputedStyle(r).borderLeftColor`, `borderTopColor`, `borderBottomColor`, `borderLeftWidth`.
  3. Trigger a status change on that agent (send a prompt, or approve/deny a dialog for an awaiting agent) and wait for the badge to change.
  4. Re-run the same capture and compare `width` and `height` (row height may legitimately change only if content such as a queued-task line appears; note it if so) and confirm `borderRightWidth` is still `4px`.
- **Expected Result**: `width` is identical before and after, and `height` is identical unless row content changed; `borderRightWidth` stays `4px`; `borderLeftColor` / `borderTopColor` / `borderBottomColor` equal the theme's `--color-line` (`rgb(231, 232, 234)` light, `rgb(43, 45, 54)` dark) before and after, while `borderRightColor` changes to the new status color.
- **Repeatable Unit Test**: Not applicable: bounding boxes and computed border widths need a layout engine. Missing assertion in the existing suite: no test checks that the row's class list still contains `border` and `border-line` (the flip test only asserts the class list is unchanged, and the per-status tests only assert `border-r-[4px]`), so "other three sides keep `border-line`" is unasserted anywhere.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk (bounding-box/no-layout-shift and computed --color-line values need a layout engine; the "other three sides keep border-line" half is now unit-asserted in the parameterized test, 8 cases pass)] <!-- 2026-09-18 -->

---

### UAT-UI-005: The status badge text label remains the primary status signal (color is not the only cue)
- **Page**: `http://localhost:4321/`
- **Description**: WCAG 1.4.1: the right border is a redundant scanning aid; each row must still render `StatusBadge` with its text label (`busy`, `idle`, `waiting`, `no tasks`, `stalled`, `starting`) and the border adds nothing to the accessibility tree.
- **Steps**:
  1. On `http://localhost:4321/`, read the status badge text on every sidebar row.
  2. In devtools run `[...document.querySelectorAll('aside[aria-label="Agents"] [role="button"]')].map(r => [r.getAttribute('aria-label'), r.innerText])` and confirm each row's text includes a status label.
  3. In the devtools Accessibility pane (or `mcp__playwright__browser_snapshot`), confirm each row's accessible name is still exactly `<agent name> detail` with no border-related text or new role.
- **Expected Result**: Every row shows a textual status label from `STATUS_CONFIG[status].label`; the accessible name is unchanged (`<name> detail`); no extra elements exist for the border (it is CSS only).
- **Repeatable Unit Test**: Not applicable: no existing test asserts the row-level badge label for the sidebar (the label assertions in `AgentList.test.tsx` are on toast buttons), and the row's accessible-name is only used incidentally as a query handle by `rowFor()`. A one-line assertion (`within(row).getByText(STATUS_CONFIG[status].label)`) could be added to the UAT-UI-001 parameterized test but was not written because this run may not edit code.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk (per-row text label, aria-label `<name> detail` and no border-only markup are now unit-asserted for all 8 statuses and pass; live sidebar/accessibility-pane check left to a human)] <!-- 2026-09-18 -->

---

### UAT-EDGE-001: Exited agents do not render as sidebar rows, so they never receive a border
- **Scenario**: The task's "`exited`-filtered-out (skip)" clause: `AgentList` passes only `isActiveStatus(deriveStatus(a))` agents to the sidebar, so an `exited` agent has no `AgentItem` and therefore no `border-r` styling in the sidebar.
- **Steps**:
  1. Run the unit test command below (renders busy, idle, awaiting and exited agents and asserts the exited one is absent).
  2. Live cross-check: on `http://localhost:4321/`, confirm an agent whose window has exited is absent from the sidebar (it appears in the inactive panel, which this task does not change).
- **Expected Result**: The exited agent's name is not rendered in the sidebar; the busy, idle and awaiting rows are. The `InactiveAgentsPanel` is unchanged by this task (no right border added there).
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`AgentList board (no Kanban columns) > renders busy, idle and awaiting agents in one list, omits exited agents, and has no column headings`, added under TASK-0169/0170). It covers sidebar exclusion only; no test asserts `InactiveAgentsPanel` remains border-free (the task explicitly defers that to TASK-0177), so that half is a live/visual check.
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "omits exited agents"` — verified: 1 passed
- [x] Pass <!-- 2026-09-18 -->

---

### UAT-EDGE-002: Non-text contrast (3:1) of each status hex against the row background in light and dark
- **Scenario**: Task requirement: verify the border meets 3:1 non-text contrast (WCAG 1.4.11) against the row background (`bg-card`: `#ffffff` light, `#21232b` dark) for `#3b6ef6`, `#30a46c`, `#e0901a`, `#e5484d`, `#4f5a78`, `#9a9da5`. If a hex fails in one theme, it must be noted and the fix deferred to TASK-140 rather than a second palette invented here. The task's own step claims the hexes are "theme-independent" so the check "stays deferred"; no ratios were actually computed during `/tackle`.
- **Steps**:
  1. Run the Command below to compute WCAG contrast ratios for all six hexes against both card backgrounds.
  2. Compare each ratio against 3.0.
  3. For every ratio below 3.0, confirm it is recorded as a known deferred issue (in TASK-0171's notes and TASK-140 or a follow-on task) rather than silently ignored.
- **Command**:
  ```bash
  node -e 'const L=h=>{const c=[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)/255).map(v=>v<=0.03928?v/12.92:((v+0.055)/1.055)**2.4);return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2]};const R=(a,b)=>{const [x,y]=[L(a),L(b)].sort((p,q)=>q-p);return ((x+0.05)/(y+0.05)).toFixed(2)};for(const [n,h] of Object.entries({busy:"#3b6ef6",idle:"#30a46c",amber:"#e0901a",red:"#e5484d",starting:"#4f5a78",grey:"#9a9da5"}))console.log(n,h,"light",R(h,"#ffffff"),"dark",R(h,"#21232b"))'
  ```
- **Expected Result**: Ratios at generation time: busy 4.42 light / 3.54 dark; idle 3.16 / 4.96; amber `#e0901a` **2.57** light / 6.10 dark; red 3.91 / 4.00; starting `#4f5a78` 6.85 / **2.29** dark; grey `#9a9da5` **2.71** light / 5.78 dark. Three pairs fall below 3:1: amber in light (affects the `awaiting` and `empty` sidebar rows, the most urgency-relevant color), `starting` slate in dark, and grey in light (`no-window`/`unknown` rows are not shown in the sidebar, so grey is not user-visible there). Per the task these are to be noted and deferred, not fixed here. PASS requires that each failure is explicitly recorded with a follow-up owner. FAIL if the failures are not recorded anywhere. Known gap to report: `TASK-140` as written covers badge text-on-background pairs and button colors only (its scope names `STATUS_CONFIG` `bg`/`color` and badge hexes); it does not mention the `STATUS_CONFIG[...].dot` hexes that this border now uses, so the deferral target may not actually cover them.
- **Repeatable Unit Test**: Not applicable: this is a computed check against CSS token values and hex constants, not a behavior of the component; a contrast assertion could be added to `AgentList.test.tsx` iterating `STATUS_CONFIG` against the two card colors, but the failing pairs mean it would go red until TASK-140 (or a follow-on) lands, and this run may not edit code.
- [FAIL: auto-judge: 3:1 non-text contrast fails for 3 pairs — amber #e0901a light 2.57 (awaiting/empty rows), starting #4f5a78 dark 2.29, grey #9a9da5 light 2.71 (not user-visible in sidebar); no valid follow-up owner recorded: TASK-0171 defers to TASK-140 but TASK-140's scope is badge/button pairs and does not cover STATUS_CONFIG[...].dot hexes, and no other task or roadmap item tracks them — needs a follow-on task before this case can pass] <!-- 2026-09-18 -->

---

### UAT-EDGE-003: Frontend gates stay clean with the border change
- **Scenario**: Step 2 of the task: `npm test` and `npm run typecheck` in `frontend/` are clean.
- **Steps**:
  1. Run `cd frontend && npx vitest run src/components/AgentList.test.tsx` (113 tests at generation time, including the 8 TASK-0171 tests).
  2. Run `cd frontend && npm run typecheck`.
- **Expected Result**: The AgentList test file passes with no failures; `tsc --noEmit` exits with no errors. The `AgentItem` root still calls `getStatusColor` from the same file with no new imports and no new color table (`STATUS_CONFIG` has no additional entries).
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (the 8 tests in the `AgentList sidebar row status right border (TASK-0171)` describe block, covering UAT-UI-001 and UAT-UI-002); the typecheck half is a static gate, not a unit assertion.
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "sidebar row status right border"` — verified: 8 passed
- [FAIL: auto-judge: unit test covers only part of Expected — full AgentList.test.tsx run 115 passed / 0 failed and `npm run typecheck` (tsc --noEmit) exited clean, but "no new imports and no new color table" is a static claim no test asserts (working-tree AgentList.tsx diff mixes many unrelated tasks' changes, so it cannot be isolated to TASK-0171); getStatusColor is defined in the same file (AgentList.tsx:102, present in HEAD) and AgentItem calls it at :1193]  <!-- 2026-09-18 -->
