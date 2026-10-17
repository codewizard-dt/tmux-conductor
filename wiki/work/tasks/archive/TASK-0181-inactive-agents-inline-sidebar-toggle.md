---
id: TASK-0181
aliases: [TASK-0181]
title: "Remove the Inactive Agents accordion — show all agents in the sidebar with a red border + Show inactive checkbox"
status: done
created: 2026-09-19
updated: 2026-09-19
depends_on: []
blocks: []
parallel_safe_with: []
uat: "[[UAT-0181]]"
tags: [frontend, agents-page, sidebar, cleanup]
---

# TASK-0181 — Remove the Inactive Agents accordion — show all agents in the sidebar with a red border + Show inactive checkbox

relates_to::[[TASK-0177]]
relates_to::[[TASK-0178]]

## Objective

Delete the collapsible "Inactive Agents" accordion (`InactiveAgentsPanel`) docked at the top of the sidebar. Inactive agents (`no-window`, `exited`, `unknown`, and `error` — which is shared with the active set) instead render as ordinary rows in the same project-grouped sidebar list as active agents, but only when a new "Show inactive" checkbox at the top of the sidebar is checked. An inactive row's right border is always a fixed red, regardless of its specific status, distinguishing it at a glance from the per-status-colored borders active rows use.

## Approach

**Delete outright**: `frontend/src/components/InactiveAgentsPanel.tsx` and `frontend/src/components/InactiveAgentsPanel.test.tsx` — once removed from `AgentSidebar` (its only consumer since TASK-0177/TASK-0178), nothing else imports it. Confirm with `find_referencing_symbols` before deleting.

**New `showInactive` state**, `frontend/src/components/AgentList.tsx`: add `const [showInactive, setShowInactive] = useState(false)` next to `filterText` (~L1799) — starts unchecked, matching the accordion's previous default-collapsed behavior.

**Sidebar checkbox**: in `AgentSidebar` (~L1724-1788), add a `showInactive: boolean` / `onShowInactiveChange: (v: boolean) => void` prop pair. Render a labelled checkbox between the filter `<input>` and where `InactiveAgentsPanel` used to sit:
```jsx
<label className="mb-4 flex items-center gap-1.5 text-[12px] text-muted">
  <input
    type="checkbox"
    checked={showInactive}
    onChange={(e) => { onShowInactiveChange(e.target.checked) }}
  />
  Show inactive
</label>
```
Match existing sidebar spacing/typography conventions (check the filter input's own classes for the established `mb-4`/text-size pattern rather than inventing new values). Only render when `totalAgentCount > 0` (mirrors the filter input's own visibility gate).

**Merge inactive rows into the grouped list**: in `AgentList`'s render body (~L2128-2131), change:
```ts
const visibleAgents = filteredAgents.filter((a) => isActiveStatus(deriveStatus(a)))
```
to select active-only or active+inactive depending on the checkbox:
```ts
const visibleAgents = showInactive
  ? filteredAgents
  : filteredAgents.filter((a) => isActiveStatus(deriveStatus(a)))
```
Pass `showInactive` and `onShowInactiveChange={setShowInactive}` down to `<AgentSidebar />` (~L2140-2146) alongside the existing props. Remove the `<InactiveAgentsPanel .../>` render block from inside `AgentSidebar` (~L1747-1751) and its import.

**Red border for inactive rows, in `AgentItem`** (~L1171-1191): the row's `style={{ borderRightColor: getStatusColor(status) }}` becomes conditional:
```ts
style={{ borderRightColor: isInactiveStatus(status) ? INACTIVE_BORDER_COLOR : getStatusColor(status) }}
```
Add a module-level `const INACTIVE_BORDER_COLOR = '#e5484d'` next to `STATUS_CONFIG` (~L90) — this is the exact same red already used for `STATUS_CONFIG.error`/`STATUS_CONFIG.exited`'s `dot`, so `error`/`exited` rows render identically to today; only `no-window` (currently grey `#9a9da5`) and `unknown` (also grey) actually change color under this rule. Do not touch `getStatusColor()` itself or `STATUS_CONFIG` — this is a presentation override at the call site, not a change to the status→color mapping other code (badges, the removed panel) relied on.

**Simplify cycling back to one list** (per this task's own confirmed scope — the two-set active/inactive cycling split TASK-0178 added no longer has a reason to exist once there's no separate inactive section):
- `activeAgents` (~L1825-1828) and `orderedInactiveIds` (~L1839-1842) collapse into one `cycleAgents` computed from `showInactive`: `agents.filter((a) => showInactive || isActiveStatus(deriveStatus(a)))` — deliberately built from the **unfiltered** `agents` (not `filteredAgents`), preserving the existing "cycling ignores the text filter" guarantee this component already documents.
- `orderedAgentIds` (~L1833-1836) becomes `[...cycleAgents].sort(byProjectThenStatus).map((a) => a.id)`, recomputed whenever `cycleAgents` (or `showInactive`) changes.
- `handleNavigate` (~L1843-1861): remove the `inActive`/`ids`/`wrap` branching entirely — there is only one list now. Always wrap (`next = (next + orderedAgentIds.length) % orderedAgentIds.length`), matching today's active-only wrapping behavior. Keep the `idx === -1` no-op guard (a selection outside the current cycle set — e.g. the selected inactive agent when `showInactive` is unchecked — stays a no-op rather than jumping).
- `selectedCycleCount` (~L2082-2084) simplifies to `orderedAgentIds.length` — delete the `orderedInactiveIds`-vs-`activeAgents` ternary.
- Update the explanatory comments at ~L1817-1824 and ~L1837-1838 (currently describing the two-set active/inactive split) to describe the new one-list-gated-by-`showInactive` behavior instead — don't leave stale comments describing a mechanism that no longer exists.

**`AgentSidebar` empty-state copy** (~L1758-1764): the existing three-way empty state ("No agents registered." / "No agents match your filter." / "No active agents.") needs re-checking once inactive rows can appear inline. The third case ("agents exist, none active, so `agents.length === 0` inside the sidebar despite `totalAgentCount > 0`") **only makes sense when `showInactive` is off** — if `showInactive` is on and no agents match the filter, the filter-empty message should show instead, since inactive agents are now visible. Ensure the sidebar's own `agents` prop (still receiving `visibleAgents`) drives this correctly with no extra prop plumbing needed — the existing three branches, read literally, may already fall through correctly since `visibleAgents` now already includes inactive agents when `showInactive` is on; verify with a test (Step 3) rather than assuming.

**Leave untouched**: `getStatusColor()`, `STATUS_CONFIG`, `isActiveStatus`/`isInactiveStatus`/`ACTIVE_STATUSES`/`INACTIVE_STATUSES` (still needed to classify rows and gate `visibleAgents`/`cycleAgents`), `StatusBadge` (unaffected — badges still use the real per-status color, only the row's own right border is overridden for inactive rows), `AgentDetailView`'s own "Create window" / actions-menu Destroy affordances (these remain the only way to wake/remove an inactive agent now that the row no longer has inline Wake/Remove buttons — confirmed acceptable for this task's scope).

## Dependencies

- depends_on: none.
- blocks: none.
- File-overlap (not a hard dependency, but do not run concurrently): [[TASK-0179]] (remove toast notifications) is also `todo` and edits `AgentList.tsx`/`AgentList.test.tsx`, in a different region (SSE handler toast bookkeeping vs. sidebar/cycling/InactiveAgentsPanel) — sequence these two rather than dispatching both at once.

## Files

- `frontend/src/components/InactiveAgentsPanel.tsx` — delete.
- `frontend/src/components/InactiveAgentsPanel.test.tsx` — delete.
- `frontend/src/components/AgentList.tsx` — `showInactive` state, checkbox in `AgentSidebar`, `visibleAgents` merge, `AgentItem` border override + `INACTIVE_BORDER_COLOR` constant, cycling simplified to one list, `selectedCycleCount` simplified, stale comments rewritten.
- `frontend/src/components/AgentList.test.tsx` — remove/rewrite tests asserting the old accordion/two-set-cycling behavior; add tests for the new checkbox + merged-list + red-border behavior.

## Steps

### 1. Delete InactiveAgentsPanel <!-- agent: general-purpose -->

- [x] Confirm via `find_referencing_symbols` that `InactiveAgentsPanel` has no consumer other than `AgentList.tsx`'s `AgentSidebar`. (Also found `AgentList.test.tsx` importing it at L55 — two tests in `describe('AgentList sidebar row status right border (TASK-0171)')` at ~L3451-3486 render the panel directly; rewrite/remove in Step 5.)
- [x] Delete `frontend/src/components/InactiveAgentsPanel.tsx` and `frontend/src/components/InactiveAgentsPanel.test.tsx`. (Deleted via `rm`; typecheck expected red until Steps 2 and 5 land.)
<!-- Updated: 2026-09-19 -->

#### Subtask discovered in Step 1 (fold into Step 5)

- Remove the dangling `InactiveAgentsPanel` import at `AgentList.test.tsx` L55 and rewrite or remove the two panel-rendering tests at ~L3451-3486 against the new inline "Show inactive" sidebar. Panel behaviors that lost coverage with the deleted test file (Wake, Remove-with-confirm, open-detail, selection highlight, "unknown" label) are intentionally dropped per Notes; recover from git history only if needed.

### 2. Add the checkbox and merge inactive rows into the sidebar <!-- agent: general-purpose -->

- [x] In `AgentList.tsx`, add `showInactive` state (default `false`).
- [x] Remove the `InactiveAgentsPanel` import and its render block from `AgentSidebar`.
- [x] Add the `showInactive`/`onShowInactiveChange` props to `AgentSidebar` and render the checkbox per Approach, between the filter input and the project groups.
- [x] Change `visibleAgents`'s computation in `AgentList`'s render body to include inactive agents when `showInactive` is true, per Approach.
- [x] Wire `showInactive`/`onShowInactiveChange={setShowInactive}` into the `<AgentSidebar />` call site.
- [x] Re-verify the sidebar's three empty-state messages still make sense with `showInactive` in both positions (see Approach's empty-state note) — adjust the branch conditions if a case is now unreachable or wrong, don't just leave it. (Verified: all three branches correct as-is; "No active agents." is now reachable only with the checkbox off. Only the third branch's comment was updated. Add a test for this in Step 5.)
<!-- Updated: 2026-09-19 -->
<!-- tsc: only the expected AgentList.test.tsx missing-module error remains (Step 5). -->
<!-- Stale `InactiveAgentsPanel` comments remain at ~L1268, L1286, L1836, L2079 in AgentList.tsx — Step 4 must rewrite them. -->
<!-- Progress: 2 of 5 -->


### 3. Red border for inactive rows <!-- agent: general-purpose -->

- [x] Add `const INACTIVE_BORDER_COLOR = '#e5484d'` near `STATUS_CONFIG`.
- [x] In `AgentItem`, change the row's `borderRightColor` style to use `INACTIVE_BORDER_COLOR` when `isInactiveStatus(status)`, else `getStatusColor(status)` as today. (`isInactiveStatus('error')` is true; error/exited unchanged visually, only no-window/unknown change grey → red.)
<!-- Updated: 2026-09-19 -->
<!-- Progress: 3 of 5. tsc: only the expected AgentList.test.tsx missing-module error. -->
<!-- Stale `INACTIVE_STATUSES` comment at ~L1285 also mentions InactiveAgentsPanel — Step 4. -->


### 4. Simplify cycling to one list <!-- agent: general-purpose -->

- [x] Replace `activeAgents`/`orderedInactiveIds` with a single `cycleAgents`/`orderedAgentIds` pair gated by `showInactive`, per Approach — built from unfiltered `agents`, not `filteredAgents`.
- [x] Simplify `handleNavigate` to a single always-wrapping list; remove the `inActive`/dual-`ids` branching; keep the `idx === -1` no-op guard.
- [x] Simplify `selectedCycleCount` to `orderedAgentIds.length`.
- [x] Rewrite the stale comments describing the old two-set active/inactive cycling split.
<!-- Updated: 2026-09-19 -->
<!-- Progress: 4 of 5. tsc: only the expected AgentList.test.tsx missing-module error. No InactiveAgentsPanel/orderedInactiveIds/activeAgents left in AgentList.tsx. -->


### 5. Tests and gates <!-- agent: general-purpose -->

- [x] In `AgentList.test.tsx`: remove or rewrite any test asserting the old accordion (`Inactive Agents (N)`, `aria-expanded`, the panel's own Wake/Remove buttons) or the old inactive-vs-active cycling split (`orderedInactiveIds`, non-wrapping inactive cycling, "stays inside the inactive list" style assertions) — search for `InactiveAgentsPanel`, `Inactive Agents`, `Wake agent`, `Remove agent` to find them.
- [x] Add tests: the "Show inactive" checkbox is unchecked by default and inactive agents are absent from the sidebar; checking it shows inactive agents inline, grouped/sorted alongside active ones; an inactive row's `style.borderRightColor` is the fixed red regardless of its specific inactive status (cover at least `no-window` and `exited`); an `error` agent's border is unaffected (still the same red it already had); cycling with `showInactive` off skips inactive agents and wraps within active ones only (existing coverage may already assert this — confirm, don't duplicate); cycling with `showInactive` on includes inactive agents in sidebar order and wraps.
- [x] Run `cd frontend && npx tsc --noEmit` — clean.
- [x] Run `cd frontend && npm test` — clean; report the before/after test count. (Before: 90 passed / 9 files, `AgentList.test.tsx` failed to load on the dangling import. After: 250 passed / 10 files, `AgentList.test.tsx` = 160.)
- [x] `search_for_pattern` for `InactiveAgentsPanel` across `frontend/src` — confirm zero matches.
<!-- Updated: 2026-09-19 -->
<!-- Progress: 5 of 5. Observation: prev/next buttons stay visible after the selected agent turns inactive with "Show inactive" off (count = remaining active agents); shortcut is a no-op per Step 4. Old test asserting the buttons hide was dropped, not replaced. -->


## Notes

- Confirmed with the user: dropping the accordion's inline "Wake"/"Remove" quick-action buttons is acceptable — an inactive agent's detail pane (`AgentDetailView`) already offers "Create window" (wake) and the actions menu's Destroy (remove), just one extra click away instead of inline on the row.
- Confirmed with the user: the "Show inactive" checkbox starts **unchecked**, matching the accordion's previous default-collapsed state.
- Filed directly by user request: "remove the inactive agents accordion, instead display all agents in the sidebar. inactive agents show a red border. add a checkbox filter at the top of the sidebar to 'show inactive' agents."
