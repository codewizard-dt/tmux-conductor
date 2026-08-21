---
id: TASK-124
aliases: [TASK-124]
title: "AgentList text filter — scale the dashboard past small agent counts"
status: pending-uat
created: 2026-08-15
updated: 2026-08-15
depends_on: []
blocks: []
parallel_safe_with: [TASK-122, TASK-123]
uat: "[[UAT-124]]"
tags: [frontend, ui, roadmap-017]
---

# TASK-124 — AgentList text filter — scale the dashboard past small agent counts

## Objective

Add a text filter input to `AgentList` (`frontend/src/components/AgentList.tsx`) so a user with more than a handful of agents can narrow the visible list by typing, instead of scanning every card.

## Approach

`AgentList` (`AgentList.tsx:1116-1420` at task-creation time) holds all agents in a single `agents: Agent[]` state array (`useState<Agent[]>([])`, set from `GET /status` and kept live via SSE), and derives a name-sorted `orderedAgentIds` via `useMemo` for keyboard navigation between the detail modal's prev/next. Agents are then grouped (by project and/or status — confirm the exact grouping logic via `mcp__serena__find_symbol` on `columnFor`/`COLUMNS`/`AgentList` `include_body=true` before editing, since it determines where the filter must apply) into columns for rendering.

**Filter scope**: match against agent `name` at minimum; consider also matching `projectName` and/or `label`/`agentType` if those fields are cheap to include and would help scale-out (a user might want to type a project name to see all its agents). Keep the match case-insensitive substring, consistent with the existing name-sort's `.toLowerCase().localeCompare()` pattern.

**Where the filter applies**: derive a filtered list (e.g. `useMemo` keyed on `agents` and the filter text) and feed that into whatever currently consumes `agents` for column-grouping/rendering, rather than filtering post-grouping — filtering pre-grouping keeps empty-column collapse (if any exists) correct. `orderedAgentIds` (used for prev/next navigation in the open detail modal) should probably stay unfiltered, or filtering it too could strand keyboard navigation on a hidden agent — decide based on what feels least surprising and document the choice in a code comment. Filtering must never affect `bgs` (background processes) — the roadmap and existing UI treat agents and bg-processes as separate sections.

**UI placement**: add a text input near the top of `AgentList`'s render, above the grouped/columned agent cards, styled consistently with the app's existing input styling (check `AddAgentForm` or `FolderPickerModal.tsx`'s path input for the established input classes rather than inventing new ones).

**Empty-state**: when the filter matches zero agents, show a small "No agents match" message rather than silently rendering nothing — the difference between "no agents exist" and "no agents match the filter" should stay visually distinguishable.

**Verification is human-gated.** No frontend test runner exists in this repo (no vitest/jest, confirmed by three agents earlier today) — `/uat-generate` should expect all cases to fail-close to `/uat-walk`. The filter's match logic itself (a pure string-matching predicate) is a reasonable candidate for the browser-free Node reference-script technique UAT-074/UAT-076 used in lieu of a real test file, if `/uat-generate` chooses to promote it that way.

## Steps

### 1. Locate the grouping/render logic  <!-- agent: Explore -->

- [x] `mcp__serena__find_symbol` on `AgentList` with `include_body=true`, and on `columnFor`/`COLUMNS` — confirm exactly how `agents` flows into the columned card rendering, and where `orderedAgentIds` is consumed, before making any edit.

<!-- Updated: 2026-08-15 — agents state at line 1186. orderedAgentIds (lines 1200-1203) derived from raw `agents`, feeds handleNavigate prev/next. Single substitution point for a filtered list: `for (const agent of agents)` (~line 1410) building columnAgents; columnFor/COLUMNS (955-970) only classify one agent, untouched. Render top (~1441): <div className="animate-riseIn"> > <h1> > SessionBanner > agents.length===0 ternary > grid. Insertion point for filter input: after SessionBanner, before the length-check ternary. Input styling precedent: AddAgentForm.tsx's shared inputCls (rounded-[8px] border-line bg-white px-3 py-1.5 font-mono text-[12px] text-ink placeholder:text-muted-2 outline-none focus:border-accent focus:ring-2 focus:ring-accent/10 transition) or FolderPickerModal.tsx's inline equivalent. Agent interface (lines 20-52) confirmed fields: name, projectName, workdir, branch?, role?, label?, agentType? — role/label/workdir/branch all optional/nullable, filter must null-guard. No mid-edit/TODO markers found — safe to edit. BgProcessSection (1115-1125) reads from separate `bgs` state, structurally untouched by any agents-only filter. -->

### 2. Add filter state and the derived filtered list  <!-- agent: general-purpose -->

- [x] **Hot file** — re-read `frontend/src/components/AgentList.tsx` immediately before editing (concurrently edited by other Phase-3-adjacent work: TASK-123 also touches this file). Add `const [filterText, setFilterText] = useState('')` inside `AgentList`.
- [x] Add a `useMemo`-derived filtered agent list (case-insensitive substring match on `name`, optionally `projectName`) keyed on `agents` and `filterText`, and thread it into the grouping/render step located in Step 1 in place of the raw `agents` array.
- [x] Decide and document (code comment) whether `orderedAgentIds` (modal prev/next navigation) uses the filtered or unfiltered list.

<!-- Updated: 2026-08-15 — filterText state at line 1207. New exported pure predicate `agentMatchesFilter(agent, filterText)` at line 267 (module scope, near formatCost) matches name/projectName/role/branch case-insensitively; deliberately excludes workdir (common-prefix noise) and label/agentType (low-signal); empty/whitespace input matches everything. filteredAgents useMemo at line 1419 keyed on [agents, filterText]; column-grouping loop (line 1427) now iterates filteredAgents instead of raw agents (pre-grouping filter, per task's own requirement). orderedAgentIds (line 1222) deliberately left on unfiltered agents with an explanatory comment — keyboard nav must not strand on a hidden agent when the modal is open. bgs/BgProcessSection untouched. tsc --noEmit: one expected transient TS6133 (setFilterText unused) — resolves once Step 3 wires the input. Independently re-verified via search_for_pattern after the sub-agent self-corrected a mid-flight line-index mistake. -->

### 3. Add the input and empty state  <!-- agent: general-purpose -->

- [x] Add a text `<input>` above the agent card grid, wired to `filterText`/`setFilterText`, styled per the app's existing input conventions.
- [x] When the filtered list is empty but `agents` is not, render a small "No agents match" (or similar) message instead of an empty grid.

<!-- Updated: 2026-08-15 — <input> (line 1461-1470) rendered only when agents.length>0, right after SessionBanner; wired to filterText/setFilterText; className replicates AddAgentForm's inputCls (border-line/font-mono/focus-ring) but max-w-xs instead of w-full; aria-label="Filter agents"; placeholder names exactly the 4 matched fields. Ternary widened to 3 branches: agents.length===0 -> "No agents registered.", filteredAgents.length===0 -> "No agents match your filter." (same <p> classes for visual consistency), else the existing grid. bgs/BgProcessSection/orderedAgentIds/column-grouping untouched. tsc --noEmit: zero errors, independently re-confirmed. -->

### 3.5. Add unit + RTL tests for the filter  <!-- agent: general-purpose -->

- [x] Add a unit test suite for `agentMatchesFilter` (exported pure predicate) in `frontend/src/components/AgentList.test.tsx`, matching the file's existing `describe`/`it` + `vitest`/`@testing-library/react` conventions.
- [x] Add at least one RTL render test for `AgentList` itself that mocks `fetch` (canned `/status` response with 2-3 distinct agents) and stubs the global `EventSource` (jsdom has none; `useSSEEvent`'s `ensureSource()` calls `new EventSource(...)` on mount), types into the filter input, and asserts the rendered card set changes accordingly.

<!-- Updated: 2026-08-15 — 8 unit tests for agentMatchesFilter (empty/whitespace input, per-field match on name/projectName/role/branch, no-match, null-field safety, workdir-exclusion regression pin) + 1 RTL integration test (mocked fetch + stubbed EventSource via vi.stubGlobal, renders real <AgentList/>, types into the aria-label="Filter agents" input via fireEvent.change, asserts the non-matching card disappears while the matching one remains, vi.unstubAllGlobals() cleanup). 36/36 pass, independently re-run. BLOCKING BUG FOUND AND FIXED: the RTL test caught a genuine Rules-of-Hooks violation — filteredAgents' useMemo had been placed after the loading/error early-returns in Step 2, which would break on every loading->loaded transition in the real app, not just in tests. Moved it above all early returns, alongside the component's other top-level hooks; confirmed only one declaration remains, no duplicate. tsc --noEmit: zero errors, independently re-confirmed. -->

### 4. Typecheck and smoke  <!-- agent: general-purpose -->

- [x] `npx tsc --noEmit` in `frontend/` — zero errors.
- [x] `npm run build` in `frontend/` — clean.
- [DEFERRED-TO-UAT] With `make dev` running, type a partial agent name into the filter and confirm only matching cards remain visible, background-process cards are unaffected, clearing the input restores the full list, and a filter matching nothing shows the empty-state message.

<!-- Updated: 2026-08-15 — tsc --noEmit: zero errors. npm run build: clean, only the pre-existing >500kB chunk-size advisory (not an error). Full frontend suite (npm test): 4 test files, 50/50 tests pass. Also ran make typecheck (host-server + frontend workspaces): both exit 0. Manual make-dev smoke test deferred to UAT phase per tackle's static-gates-only rule — the RTL integration test in Step 3.5 already exercises the equivalent behavior (typing filters the rendered card set) at the component level. -->

## Acceptance Criteria

- [ ] A text input filters the visible agent cards by a case-insensitive substring match on agent name (at minimum).
- [ ] Background-process cards are never affected by the agent filter.
- [ ] An empty filter match shows a distinct "no matches" state, not a silently blank list.
- [ ] `npx tsc --noEmit` and `npm run build` pass cleanly in `frontend/`.

## Dependencies

- None — UI-only, independent of the other ROADMAP-017 Phase 3 items.
- **Parallel-safe with** [TASK-122](TASK-122-dashboard-dark-mode.md) and [TASK-123](TASK-123-replace-confirm-dialogs.md) — different concerns. This task and TASK-123 both touch `frontend/src/components/AgentList.tsx` (a hot file per this repo's existing convention) — re-read immediately before every edit.

### Roadmap

Implements ROADMAP-017 Phase 3, item "Add a text filter to `AgentList` for scaling past small agent counts" — `wiki/work/roadmaps/ROADMAP-017-competitive-audit-followups.md`.
