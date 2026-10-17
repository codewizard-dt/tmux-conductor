---
id: TASK-0183
aliases: [TASK-0183]
title: "Sort the agent sidebar alphabetically by default with drag-to-reorder persisted in localStorage"
status: done
created: 2026-09-19
updated: 2026-09-19
depends_on: [TASK-0170, TASK-0174]
blocks: []
parallel_safe_with: [TASK-0180, TASK-0167]
uat: "[[UAT-0183]]"
tags: [frontend, agents-page, sidebar, drag-and-drop, localstorage]
---

# TASK-0183 — Sort the agent sidebar alphabetically by default with drag-to-reorder persisted in localStorage

depends_on::[[TASK-0170]]
depends_on::[[TASK-0174]]

> **Depends on**: TASK-0170 (built `AgentSidebar`; both are code-complete, `pending-uat`), TASK-0174 (cycling follows sidebar visual order).
> **Parallel-safe with**: TASK-0180 (`TaskList.tsx` / host-server), TASK-0167 (actions menu). Note: other sessions also edit `AgentList.tsx` / `AgentList.test.tsx` (see `wiki/hot.md`) — re-read the file immediately before each edit.

## Objective

The sidebar currently sorts by project, then **status urgency** (`STATUS_SORT`), then name — so rows jump around whenever an agent's status changes. Change it so agents are **alphabetical by default** and the user can **drag rows to reorder them within their project group**; the custom order persists in `localStorage`. Cmd+Shift+Arrow cycling (`orderedAgentIds`) must keep following exactly what the sidebar shows.

## Approach

- **Scope of ordering (decided).** Project groups stay alphabetical (case-insensitive, "Unassigned" last) and are not draggable. Agents are ordered *within* a group; a drag can only reorder inside its own group (project membership is data, so a cross-group move is meaningless).
- **Order model.** A flat array of agent ids (globally unique — see `Agent.id`) stored under `localStorage['conductor:agentOrder']` (same `conductor:*` namespace as `conductor:sendDraft:*` / `conductor:taskDraft:*`). Only relative order *within* a group matters, so a flat list is sufficient.
- **Sort rule (`orderAgents`).** Within a project group: agents whose id is in the saved list come first, in saved order; agents not in the list (new / never dragged) follow, alphabetical by name (case-insensitive, `localeCompare`). With no saved list the result is pure A–Z. Unknown/stale ids in storage are ignored (never throw, never need pruning for correctness).
- **Status no longer sorts.** Remove `STATUS_SORT` from the comparator. Status is still conveyed by the right border and `StatusBadge`. Delete `STATUS_SORT` if it has no remaining users (check with `find_referencing_symbols`).
- **Reorder on the *full* group, not the visible subset.** Filter text and "Show inactive" hide rows, but a drop must not disturb hidden members' relative positions. So the drag handler computes `oldIndex`/`newIndex` against the group's complete ordered list (built from the unfiltered `agents`), applies `arrayMove`, and writes the group's full new order back into the stored list (drop the group's ids from the stored list, append the group's new order). Because the visible list is a subsequence of the full group order, `over.id` is always present in the full list.
- **Single source of truth for order.** `AgentList` owns `agentOrder` state (initialised from `loadOrder()`, persisted via `saveOrder` on change). Both `AgentSidebar` (render) and the `orderedAgentIds` memo (cycling) call the same `orderAgents`, so visual order and Cmd+Shift+Arrow order cannot drift.
- **Drag mechanics.** `@dnd-kit/core` + `@dnd-kit/sortable` are already dependencies (used by `TaskList.tsx` — mirror its `DndContext` / `SortableContext` setup). One `DndContext` + `SortableContext` (`verticalListSortingStrategy`) **per project group**, so ids can only collide within a group by construction. Sensors: `PointerSensor` with `activationConstraint: { distance: 6 }` so a plain click still selects the agent; **no `KeyboardSensor`** (rows are `role="button"` with Enter/Space = select, which the keyboard sensor would hijack). Use `closestCenter`.
- **Gotchas found while researching `AgentItem` (AgentList.tsx ~1168):**
  1. The row root carries `mb-2 … last:mb-0`. Wrapping each row in a sortable `<div>` makes every row the last child of its wrapper, so `last:mb-0` would zero every gap. Move the spacing to the wrapper (`mb-2 last:mb-0` on the sortable wrapper) and remove it from `AgentItem`'s root (confirm `AgentItem` has no other call sites first).
  2. `useSortable`'s `attributes` include `role="button"` + `tabIndex=0`, which would nest a button inside the row's own `role="button"`. Spread only `listeners` on the wrapper (and `setNodeRef`, `style` with `CSS.Transform.toString(transform)` + `transition`); do **not** spread `attributes`.
  3. Apply dnd-kit's transform to the wrapper, not the row (the row has `animate-popIn`, which also uses transform).
  4. While dragging, give the wrapper `opacity-60` + a raised `z-10`/`relative` so the moved row is legible over its siblings; `isDragging` from `useSortable` drives this.
- **Reset affordance.** When a custom order exists (`agentOrder.length > 0`), show a small "Reset to A–Z" text button under the "Show inactive" checkbox; clicking it calls `clearOrder()` and sets state to `[]`. Hidden when no custom order exists.
- **Storage robustness.** Every `localStorage` read/write is wrapped in try/catch and falls back to an empty order (mirrors `NavBar.tsx` / `LogTail.tsx`); malformed JSON or non-number entries are discarded rather than thrown.
- **Pure module for testability.** Put the logic in `frontend/src/lib/agentOrder.ts` (no React, no DOM beyond `localStorage`) so it can be unit-tested exhaustively; the component tests then only verify wiring.

## Steps

### 1. Pure ordering + storage module  <!-- agent: general-purpose -->
<!-- Updated: 2026-09-19 — done: 19 vitest cases pass, tsc + eslint clean. Notes for wiring: `reorderGroup` returns a fresh array (`[...saved]`) on a no-op, so compare by content, not identity; the array move is inlined (no @dnd-kit dependency in the module); `loadOrder` accepts only integer numbers and dedupes. -->

- [x] Create `frontend/src/lib/agentOrder.ts` exporting:
  - `AGENT_ORDER_STORAGE_KEY = 'conductor:agentOrder'`
  - `compareByName(a: { name: string }, b: { name: string }): number` — case-insensitive `localeCompare` (the tie-break used today in `byProjectThenStatus`).
  - `orderAgents<T extends { id: number; name: string }>(agents: readonly T[], saved: readonly number[]): T[]` — saved-order members first (by `saved.indexOf`, ignoring ids not in `agents`), then the rest by `compareByName`. Must not mutate its inputs. Build an `id → index` `Map` once rather than calling `indexOf` per comparison.
  - `reorderGroup(fullGroupIds: readonly number[], activeId: number, overId: number, saved: readonly number[]): number[]` — returns the new stored list: `arrayMove` on `fullGroupIds` (import from `@dnd-kit/sortable`, or inline a 3-line equivalent to keep the module dependency-free), then `saved` with all `fullGroupIds` removed followed by the moved group order. Returns `saved` unchanged when `activeId === overId` or either id is missing from `fullGroupIds`.
  - `loadOrder(): number[]`, `saveOrder(ids: readonly number[]): void`, `clearOrder(): void` — all try/catch-wrapped; `loadOrder` validates `Array.isArray` and filters to `Number.isInteger` entries (dedupe while preserving first occurrence).
- [x] Create `frontend/src/lib/agentOrder.test.ts` (vitest, `localStorage.clear()` in `beforeEach`). Cases: (a) no saved order → pure A–Z, case-insensitive (`alpha`, `Beta`, `charlie`); (b) saved order wins over alphabetical; (c) agents missing from saved list are appended alphabetically after the ordered ones; (d) saved ids with no matching agent are ignored; (e) inputs not mutated; (f) `reorderGroup` moves down, moves up, no-ops for equal/missing ids; (g) `reorderGroup` with the group's hidden members present in `fullGroupIds` keeps their relative positions; (h) `reorderGroup` preserves other groups' ids already in `saved`; (i) `loadOrder` returns `[]` for missing key, malformed JSON, non-array JSON, and drops non-integers/duplicates; (j) `saveOrder`/`loadOrder` round-trip; (k) `saveOrder` and `loadOrder` do not throw when `Storage.prototype.setItem` / `getItem` throw (spy via `vi.spyOn`); (l) `clearOrder` removes the key.

### 2. Replace the comparator and wire `agentOrder` state  <!-- agent: general-purpose -->
<!-- Updated: 2026-09-19 — done: `byProject`, `sortAgentsForSidebar`, `agentOrder` state, `handleReorder`, `handleResetOrder` and `orderedAgentIds` wired; `STATUS_SORT` removed (no references left). tsc + eslint clean. `AgentSidebar` accepts `agentOrder`/`onReorder`/`onResetOrder` but only `agentOrder` is destructured — Step 3 must destructure the other two. Expected failures owned by Step 4 (7 of 144 in AgentList.test.tsx): the "Show inactive" inline-order test, "orders rows within a project group by status urgency…", and 5 Cmd/Ctrl+Shift+Arrow cycling tests. Known edge (pre-existing, not fixed): `byProject` ties project names differing only by case ("Foo"/"foo") while `groupByProject` compares labels exactly, so such agents could split into two groups. -->
- [x] (Step 4 addendum) Rewrite the 7 failing tests listed above to the alphabetical rule.

- [x] In `frontend/src/components/AgentList.tsx`, replace `byProjectThenStatus` (~line 1691) with `byProject` — project name case-insensitive, unassigned last, **no status or name tie-break** (within-group order now comes from `orderAgents`). Keep `projectLabelFor` / `projectIdFor` as-is.
- [x] Add a module-level helper `sortAgentsForSidebar(agents: Agent[], saved: readonly number[]): Agent[]` = stable-sort by `byProject`, then within each same-project run apply `orderAgents`. (Implement by grouping via `groupByProject` on a `byProject`-sorted copy, mapping each group through `orderAgents(group.agents, saved)`, and flattening.) Reuse it in both call sites below.
- [x] Remove `STATUS_SORT` (~line 1250) if `find_referencing_symbols` shows no other users after this change.
- [x] In `AgentList` add `const [agentOrder, setAgentOrder] = useState<number[]>(() => loadOrder())` **above** the loading/error early returns (Rules of Hooks — see the existing comment near `filteredAgents`). Add `handleReorder(groupProject: string | null, activeId: number, overId: number)` that computes the full group's current ordered ids from the **unfiltered** `agents` via `sortAgentsForSidebar` + `groupByProject`, calls `reorderGroup`, then `setAgentOrder(next); saveOrder(next)`. Add `handleResetOrder` (`clearOrder(); setAgentOrder([])`).
- [x] Change `orderedAgentIds` (~line 1835) to `sortAgentsForSidebar(cycleAgents, agentOrder).map((a) => a.id)` with `agentOrder` in the memo deps; update the comment above it ("project, then status urgency, then name") to describe the new rule.
- [x] Pass `agentOrder`, `onReorder={handleReorder}` and `onResetOrder={handleResetOrder}` into `AgentSidebar` (find the `<AgentSidebar …>` render site with `find_referencing_symbols`).

### 3. Sortable rows, reset link and drag styling in AgentSidebar  <!-- agent: general-purpose -->
<!-- Updated: 2026-09-19 — done: per-group DndContext/SortableContext (PointerSensor distance 6, no KeyboardSensor), `SortableAgentRow` (spreads `listeners` only, wrapper carries `mb-2 last:mb-0` + transform), `AgentItem` margin classes removed (sidebar was its only call site), "Reset to A–Z" button gated on `totalAgentCount > 0 && agentOrder.length > 0`. tsc + eslint clean; AgentList.test.tsx still shows exactly the 7 known status-order failures, none new. -->


- [x] Read `frontend/src/components/TaskList.tsx` (imports at lines 1–15, `DndContext` at ~157) and mirror its `useSensors` / `SortableContext` / `useSortable` idiom.
- [x] In `AgentSidebar` (~line 1722): add props `agentOrder: number[]`, `onReorder: (project: string | null, activeId: number, overId: number) => void`, `onResetOrder: () => void`. Replace `groupByProject([...agents].sort(byProjectThenStatus))` with `groupByProject(sortAgentsForSidebar(agents, agentOrder))`.
- [x] Wrap each group's rows in `<DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={…}>` → `<SortableContext items={group.agents.map((a) => a.id)} strategy={verticalListSortingStrategy}>`. `sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))` — created once at the top of `AgentSidebar` (hook rules: not inside the `.map`). `onDragEnd`: if `over` is null or `active.id === over.id` return; else `onReorder(group.project, Number(active.id), Number(over.id))`.
- [x] Add a small `SortableAgentRow` component (same file) that calls `useSortable({ id: agent.id })`, renders a wrapper `<div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} {...listeners} className={`mb-2 last:mb-0 ${isDragging ? 'relative z-10 opacity-60' : ''}`}>` around `<AgentItem …/>`. **Do not spread `attributes`** (nested `role="button"` — see Approach gotcha 2). Imports: `DndContext`, `closestCenter`, `PointerSensor`, `useSensor`, `useSensors` from `@dnd-kit/core`; `SortableContext`, `verticalListSortingStrategy`, `useSortable` from `@dnd-kit/sortable`; `CSS` from `@dnd-kit/utilities` (all already installed).
- [x] Remove `mb-2` and `last:mb-0` from `AgentItem`'s root className (~line 1180) after confirming via `find_referencing_symbols` that the sidebar is its only call site; otherwise add an optional `className` prop instead.
- [x] Add the "Reset to A–Z" button below the "Show inactive" label, rendered only when `agentOrder.length > 0`: `<button type="button" onClick={onResetOrder} className="mb-4 text-[12px] text-muted underline hover:text-ink">Reset to A–Z</button>`. Match the surrounding Tailwind token style (`text-muted`, `text-muted-2`, `text-ink`); no new hard-coded colors.
- [x] Add `cursor-grab` feel without breaking click affordance: keep `cursor-pointer` on the row (existing) — do not add a visible grip element (decision: whole-row drag).

### 4. Update and extend AgentList tests  <!-- agent: general-purpose -->
<!-- Updated: 2026-09-19 — done: the 7 status-order tests rewritten to the alphabetical rule; top-level `beforeEach` clears localStorage + captured drag handlers; 13 new `TASK-0183`-tagged tests added. Drag handlers are captured by a module-level `vi.mock('@dnd-kit/core')` passthrough `DndContext` and a `dragRow(activeId, overId | null)` helper (jsdom cannot drive real pointer drags). Gates: tsc + eslint clean, vitest 155/155 (AgentList.test.tsx) + 19/19 (agentOrder.test.ts). Real pointer-drag behavior and the trailing-click suppression after a drag are NOT covered by unit tests — left for UAT. -->


- [x] Read `frontend/src/components/AgentList.test.tsx` around the grouping/order assertions (start near line ~1184, the comment mentioning `byProjectThenStatus`/`groupByProject`) and use `search_for_pattern` for `urgency|STATUS_SORT|order|sorted|sort` to find every test that asserts **status-first** ordering; rewrite each to expect alphabetical-within-project (project groups still alphabetical, unassigned last). Update stale comments that mention `byProjectThenStatus`.
- [x] Add a `beforeEach` `localStorage.clear()` in the relevant `describe` so saved order never leaks between tests.
- [x] Add tests (tag names with `TASK-0183` so `vitest -t "TASK-0183"` selects them):
  - within a project, agents render A–Z regardless of status (e.g. a `busy` agent named `zeta` renders after an `idle` `alpha`);
  - a saved order in `localStorage['conductor:agentOrder']` present before mount is honoured on first render;
  - a newly-appearing agent (id not in saved order) renders after the saved-order members of its group;
  - drag wiring: capture the `onDragEnd` prop by mocking `@dnd-kit/core`'s `DndContext` with a passthrough wrapper that stores the handler (jsdom cannot drive real pointer drags), invoke it with `{ active: { id }, over: { id } }`, assert the DOM order changed **and** `localStorage['conductor:agentOrder']` holds the new order; a drop with `over: null` changes nothing;
  - a drag in project A does not change project B's order;
  - reordering while a filter hides one member of the group preserves the hidden member's relative position (assert by clearing the filter afterwards);
  - "Reset to A–Z" is absent with no saved order, present after a reorder, and clicking it restores alphabetical order and removes the storage key;
  - Cmd+Shift+ArrowDown/Up (the existing cycle-test harness) follows the custom order, not alphabetical;
  - clicking a row still selects it (click passes the 6px activation threshold logic — plain `userEvent.click` must still call `onExpand`);
  - rendering does not throw when `localStorage.getItem` throws.

### 5. Verify and document  <!-- agent: general-purpose -->
<!-- Updated: 2026-09-19 — done: tsc exit 0; eslint 0 errors (6 pre-existing react-hooks/exhaustive-deps warnings in LogTail.tsx, untouched by this task); vitest targeted 174/174, full frontend suite 271/271 across 12 files. Stale-reference sweep: 0 hits in frontend/src, scripts/README.md, wiki/index.md, hot.md and knowledge concept/entity pages; `wiki/knowledge/sources/agents-page-sidebar-layout.md` annotated with a "Superseded detail" note; historical task/UAT/log records deliberately left. `wiki/log.md` entry appended. Manual drag/persistence/click-after-drag checks deferred to UAT. -->
- Note (for UAT): pointer-drag cannot be exercised in jsdom: real drag, trailing-click suppression, reload persistence and cycling order need a live `make dev` walkthrough.

- [x] From `frontend/`: `npx tsc --noEmit`, the repo's lint command (check `package.json` scripts — mind `@typescript-eslint/no-unnecessary-condition`, which flagged TASK-0180's tests), `npx vitest run src/lib/agentOrder.test.ts src/components/AgentList.test.tsx`. All green; report counts.
- [x] `grep`-equivalent via `search_for_pattern` for leftover `byProjectThenStatus` / `STATUS_SORT` references in `frontend/src`, `wiki/`, and `scripts/README.md`; fix or annotate stale prose (do **not** edit `raw/`).
- [x] Update wiki pages that describe sidebar ordering (search `wiki/knowledge` for `byProjectThenStatus`, `status urgency`, `STATUS_SORT`; likely `agents-page-sidebar-layout` concept and `TASK-0170`'s prose is historical — leave task files as-is, fix only knowledge pages) and append a `wiki/log.md` entry.
- [DEFERRED-TO-UAT] Manual check deferred to UAT (run `make dev`): drag within a group, reload (order persists), add a new agent (appears last in its group), filter + drag, reset link, click-to-select still works after a drag (dnd-kit suppresses the trailing click — confirm), Cmd+Shift+Arrow order matches.
