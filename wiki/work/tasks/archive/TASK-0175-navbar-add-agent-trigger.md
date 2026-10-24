---
id: TASK-0175
aliases: [TASK-0175]
title: "Move the + Add Agent trigger into NavBar"
status: done
created: 2026-09-18
updated: 2026-10-17
depends_on: []
blocks: [TASK-0176]
parallel_safe_with: [TASK-0169]
uat: "[[UAT-0175]]"
tags: [frontend, navbar, forms]
---

# TASK-0175 — Move the + Add Agent trigger into NavBar

blocks::[[TASK-0176]]
relates_to::[[agents-page-sidebar-layout]]
relates_to::[[nav-bar]]

Roadmap: [[ROADMAP-0023]] Phase 3, item 7.

## Objective

Relocate the `+ Add Agent` button from `AgentsPage.tsx` into `NavBar` (`frontend/src/components/NavBar.tsx`). The modal itself already exists — it was built by TASK-151 (`AddAgentForm` with `open`/`onClose`, overlay/Escape/overlay-click dismissal, closes on successful spawn). **Do not redo or restyle that conversion**; only the trigger and the ownership of the open/closed state move.

## Approach

- **State owner: `NavBar`.** `NavBar` is rendered once in `App.tsx` above `<Routes>`, outside `AgentsPage`, so `AgentsPage`'s `showAddAgentModal` state cannot be reached from it. Lift the state one level *up* into `NavBar` (a `useState<boolean>` plus rendering `<AddAgentForm>` from `NavBar`) rather than introducing a context provider for a single boolean. `AgentsPage` drops the button, the state and the `<AddAgentForm>` render (and its now-unused import).
- **Show it on every route.** NavBar is global, so the trigger is available on Agents, Projects and History. That is a deliberate, small behavior addition: adding an agent from any page is harmless, and hiding it per-route would need route sniffing for no benefit.
- **Conditionally mount the modal** (`{showAddAgent && <AddAgentForm open onClose={...} />}`) instead of leaving it mounted-but-closed. `AddAgentForm` fetches `listProjects()` in a mount-only effect, and NavBar mounts once for the whole app session: a permanently mounted form would never see a project created afterwards on the Projects page. Mounting per open also resets the form state on each open. `AddAgentForm` keeps its `open` prop (existing tests rely on it); pass `open` as `true` when mounted.
- **Placement/styling.** Put a right-aligned action cluster in the header: wrap the trigger(s) and the existing theme toggle in a `ml-auto flex items-center gap-2` div (the theme button currently owns `ml-auto`; remove it from the button). Reuse the exact primary-button classes from the current `AgentsPage` button (`h-8 ... bg-button-primary ...`), keeping the label `+ Add Agent`. [[TASK-0176]] adds a second trigger to the same cluster.
- **AgentsPage cleanup.** After removing the button, the `flex items-start gap-4` row in `AgentsPage.tsx` contains only `<InactiveAgentsPanel />` (still there until [[TASK-0177]]); keep that panel rendering, just without the sibling button, and make sure the wrapper does not leave an empty flex item. `AgentsPage.tsx` is also touched by [[TASK-0170]], [[TASK-0173]], [[TASK-0176]] and [[TASK-0177]] — list of overlaps below.

## Dependencies

- depends_on: none. It builds on the *already shipped* TASK-151 (`pending-uat`) modal; it does not require any Phase 1/2 work.
- blocks: [[TASK-0176]] (both edit `NavBar.tsx` and the header action cluster).
- parallel_safe_with: [[TASK-0169]] (no shared files).
- File-overlap for the orchestrator: `frontend/src/pages/AgentsPage.tsx` is also edited by Phase 2 ([[TASK-0170]] layout container, [[TASK-0173]] pane overflow), [[TASK-0176]] and [[TASK-0177]]. Serialize any of those that would run concurrently with this task.

## Files

- `frontend/src/components/NavBar.tsx` — add trigger button + modal state + conditional `<AddAgentForm>`; right-aligned action cluster.
- `frontend/src/pages/AgentsPage.tsx` — remove the `+ Add Agent` button, `showAddAgentModal` state, `<AddAgentForm>` render and import (overlap with Phase 2/3/4 tasks).
- `frontend/src/components/NavBar.test.tsx` — trigger tests.
- `frontend/src/components/AddAgentForm.tsx` — **no change expected** (listed so collisions with any later edit are visible).

## Steps

### 1. Add the trigger and modal to NavBar <!-- agent: general-purpose -->

- [x] In `NavBar.tsx`, import `AddAgentForm` and add `const [showAddAgent, setShowAddAgent] = useState(false)`.
- [x] Wrap the theme toggle in a `ml-auto flex items-center gap-2` cluster (drop `ml-auto` from the toggle itself) and insert the `+ Add Agent` `<button type="button">` before it, with the primary-button classes copied from `AgentsPage.tsx`'s current button and `onClick={() => { setShowAddAgent(true) }}`.
- [x] Render `{showAddAgent && <AddAgentForm open onClose={() => { setShowAddAgent(false) }} />}` after the `<header>` contents (fragment root or inside the header; the form is `fixed`-positioned so DOM position is irrelevant, but keep it out of the `sticky` header's stacking context concerns by rendering it as a sibling in a fragment).

### 2. Clean up AgentsPage <!-- agent: general-purpose -->

- [x] In `AgentsPage.tsx`, delete the `+ Add Agent` button, the `showAddAgentModal` state (and the `useState` import if unused), the `<AddAgentForm ... />` element and its import. Leave `<InactiveAgentsPanel />` and `<AddBgProcessForm />` in place (later tasks move them); simplify the wrapper row so no empty flex child remains.

### 3. Tests and gates <!-- agent: general-purpose -->

- [x] In `NavBar.test.tsx` add tests (mock `../lib/api` and `useGitRoot` the way `AddAgentForm.test.tsx` does so no network runs): the header contains a `+ Add Agent` button on every route rendered via `MemoryRouter`; clicking it shows the Add Agent dialog content; Escape closes it; the theme toggle still works and is right-aligned (existing tests stay green).
- [x] Confirm `AddAgentForm.test.tsx` still passes unmodified.
- [x] Run `npm test` and `npm run typecheck` in `frontend/` — clean. (162/162 tests pass; `npx tsc --noEmit` clean; eslint clean on the 3 changed files.) <!-- Updated: 2026-09-18 22:08 -->
- [ ] [DEFERRED-TO-UAT] Live check: open the modal from the NavBar on Agents and Projects pages; create a project on the Projects page and confirm it appears in the modal's Project dropdown without a reload; spawning an agent is a real tmux side effect — flag rather than run it unattended (same caution as UAT-151).
