---
id: TASK-0173
aliases: [TASK-0173]
title: "Wire sidebar row click to render AgentDetailView in the main content area"
status: done
created: 2026-09-18
updated: 2026-10-17
depends_on: [TASK-0170, TASK-0172]
blocks: [TASK-0174, TASK-0178]
parallel_safe_with: []
uat: "[[UAT-0173]]"
tags: [frontend, agents-page, layout, navigation]
---

# TASK-0173 — Wire sidebar row click to render AgentDetailView in the main content area

depends_on::[[TASK-0170]]
depends_on::[[TASK-0172]]
blocks::[[TASK-0174]]
blocks::[[TASK-0178]]
relates_to::[[agents-page-sidebar-layout]]
relates_to::[[react-router-outlet-sidebar-layout]]
relates_to::[[agent-detail-modal]]

Roadmap: [[ROADMAP-0023]] Phase 2, item 5.

## Objective

Clicking an agent in the sidebar renders that agent's full detail (`AgentDetailView` from [[TASK-0172]]) in the right-hand main area instead of opening the overlay modal. When no agent is selected the main area shows an empty state plus the background-process section.

## Approach

**Selection mechanism: local component state, not a route.** Keep the existing `expandedAgent: { id, armInteract } | null` state in `AgentList` as the single source of truth for "selected agent". Rationale: the SSE notification handlers, the `expandedAgentRef` mirror (used to suppress toasts for the agent already on screen) and `onCloned`/cycling all already speak this state; a `/agents/:id` route would add deep-linking/refresh-safety (see [[react-router-outlet-sidebar-layout]]) but forces `AgentList`'s SSE-owned `agents` state to be re-plumbed through an `<Outlet>` context. That is a possible follow-up, explicitly out of scope. Do not rename `expandedAgent` in this task (rename churn buys nothing); a comment may clarify it now means "selected".

**Main area contents.**
- Selected: `<AgentDetailView key={agent.id} ... />` filling the pane (`h-full`, `min-w-0`, `flex-1`). Key by `agent.id` so switching rows fully remounts the view: this resets per-agent local state that previously leaked across modal navigation (`worktreeOverride`, open rename/role inputs, confirm dialogs, active tab) and re-fires the `armInteract` -> Terminal-tab effect on mount. `LogTail` was already keyed by agent id, so no terminal behavior is lost.
- Not selected: an empty-state card ("Select an agent from the sidebar") followed by `BgProcessSection` (moved here from [[TASK-0170]]'s interim main area). While an agent is selected, `BgProcessSection` is not shown — the wide per-row edit forms do not fit the sidebar and the pane is full-height. Note this in the task's completion notes so UAT checks it deliberately.
- The `h1` label and `SessionBanner` stay above the two columns; if the vertical budget for the pane is too tight, fold the `h1` into the empty state.

**Remove the overlay render from `AgentList`.** Replace the `expandedModalAgent && expandedAgent && <AgentDetailModal .../>` block with the pane render; pass the same props (`agent`, `project`, `projectId`, `status`, `armInteract`, `onClose={() => setExpandedAgent(null)}`, `agentCount`, `onNavigate`, `onRenamed`, `onRoleChanged`, `onCloned`). `onClose` now means deselect (also called by `doRemove`/`doCloseWindow` when the agent goes away, which returns the pane to the empty state). The `AgentDetailModal` wrapper is still consumed by `InactiveAgentsPanel` until [[TASK-0178]] — do not delete it.

**Selected-row highlight.** Add a `selected` prop to `AgentItem` (`aria-current="true"` plus a subtle background/ring on the row when `expandedAgent?.id === agent.id`). Keep `role="button"`.

**Selected agent disappears** (removed, or status becomes inactive and filtered from the active list): the existing lookup `agents.find(a => a.id === expandedAgent.id)` returns undefined → pane falls back to the empty state; also clear `expandedAgent` in that case via effect so it does not resurrect if the agent returns. Agents that turn `exited`/`no-window` while selected keep rendering (the view can show them — that is how inactive agents are opened by [[TASK-0178]]).

**Terminal-size probe (must change here).** `frontend/src/lib/terminalSizeProbe.ts` builds a hidden node mirroring the modal panel geometry (`fixed inset-4 md:inset-8` + `p-5`) to measure the "widest-realistic-panel" and posts cols/rows to `POST /api/terminal-size` (TASK-130), which resizes every tmux window globally. Once the terminal renders in a pane that is narrower than the old overlay (viewport minus ~320px sidebar), the probe over-measures and tmux windows get sized wider than the visible terminal. Update the probe so its hidden node mirrors the new pane geometry: the sidebar width plus the pane's own padding; keep constants shared (export a `SIDEBAR_WIDTH_PX` used by both `AgentSidebar` and the probe rather than duplicating `320`). Update `terminalSizeProbe.test.ts` accordingly. If the modal wrapper still exists (until [[TASK-0178]]), the modal path is the wider case — measure the pane (the steady-state surface) and accept that the transient inactive-agent modal may over-fit.

## Dependencies

- depends_on: [[TASK-0170]] (sidebar + two-column layout), [[TASK-0172]] (`AgentDetailView` exists).
- blocks: [[TASK-0174]] (cycling/notification re-verification against this mechanism), [[TASK-0178]] (inactive panel repoints to this mechanism).
- File-overlap: `AgentsPage.tsx` is also edited by [[TASK-0170]], [[TASK-0175]], [[TASK-0176]], [[TASK-0177]] (pane container height/overflow tweak here); `AgentList.tsx`/`AgentList.test.tsx` with every Phase 1/2/4 task.

## Files

- `frontend/src/components/AgentList.tsx` — pane render replaces overlay render, empty state, `AgentItem` `selected` prop, `key={agent.id}`, clear-on-vanish effect, shared `SIDEBAR_WIDTH_PX`.
- `frontend/src/pages/AgentsPage.tsx` — ensure the layout container lets the pane scroll/fill (small overflow/height adjustment; overlap with Phase 3/4 tasks).
- `frontend/src/lib/terminalSizeProbe.ts` — probe geometry now mirrors the pane.
- `frontend/src/lib/terminalSizeProbe.test.ts` — updated expectations.
- `frontend/src/components/AgentList.test.tsx` — pane behavior tests; existing tests that open the modal via row click and query `getByRole('dialog')` are updated.

## Steps

### 1. Render the view in the main area <!-- agent: general-purpose -->

- [x] In `AgentList`, delete the `AgentDetailModal` render at the bottom of the return and render `AgentDetailView` in the right-hand main area when `expandedModalAgent && expandedAgent`, with `key={expandedModalAgent.id}` and the same props.
- [x] When nothing is selected render the empty-state card followed by `BgProcessSection`; when selected do not render `BgProcessSection`.
- [x] Add an effect that sets `expandedAgent` to `null` when the selected id is no longer in `agents`. (Implemented in the `agent-removed` SSE handler instead of an effect: `onCloned` selects a just-cloned id before its `agent-update` arrives, so an "absent from agents" effect would wrongly clear it.)

### 2. Selected-row highlight <!-- agent: general-purpose -->

- [x] Add `selected?: boolean` to `AgentItem`; when true set `aria-current="true"` and a selected background/ring class. Pass `selected={expandedAgent?.id === agent.id}` from the sidebar (thread through `AgentSidebar`'s props).

### 3. Update the terminal-size probe <!-- agent: general-purpose -->

- [x] Export `SIDEBAR_WIDTH_PX` (320) from one module (`AgentList.tsx` or a tiny constants export in `terminalSizeProbe.ts`, whichever avoids a new import cycle) and use it in both the sidebar `w-[...]` class and the probe. (New `frontend/src/lib/layoutConstants.ts`; sidebar uses inline `style={{ width }}`.)
- [x] Change the probe's hidden geometry node from the overlay-panel classes to a node positioned to the right of the sidebar with the pane's padding, keeping `visibility: hidden` / `pointer-events: none`.
- [x] Update `terminalSizeProbe.test.ts` for the new geometry.

### 4. Tests and gates <!-- agent: general-purpose -->

- [x] Update `AgentList.test.tsx`: tests that clicked a row and expected a dialog now expect the detail content in the pane and no `role="dialog"`; add tests for the empty state, `BgProcessSection` visible only when nothing is selected, deselect via the view's close button, selected-row `aria-current`, switching rows remounts the view (rename input from the first agent is gone), and selected agent removed via SSE `agent-removed` returns to the empty state.
- [x] Run `npm test` and `npm run typecheck` in `frontend/` — clean. (vitest 222/222; `tsc --noEmit` clean.)
- [ ] [DEFERRED-TO-UAT] Live Playwright check: click a row → detail in the pane, terminal renders and Direct Input works, resize the window and confirm the terminal refits and tmux panes are not over-sized.

<!-- Updated: 2026-09-18 22:50 -->

## Completion notes

- `BgProcessSection` is intentionally hidden while an agent is selected (shown only with the empty state) — UAT should check this deliberately.
- The pane wrapper is `role="region"` with `aria-label="<name> detail"` (tests query it in place of the old `dialog`); the overlay `AgentDetailModal` is unchanged and still used by `InactiveAgentsPanel`.
- Deselect-on-removal lives in the `agent-removed` SSE handler (not an effect) to avoid clearing a just-cloned selection before its `agent-update` arrives.
- Probe geometry: hidden node is `fixed inset-y-0 right-0` with `left: SIDEBAR_WIDTH_PX` (from new `frontend/src/lib/layoutConstants.ts`), then the view's `p-5` and the bordered capture wrapper.
- Smoke check on :4321: row click yields pane at x=320 filling to the viewport bottom, no `role=dialog`, one `aria-current` row.
