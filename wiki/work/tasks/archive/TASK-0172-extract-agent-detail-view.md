---
id: TASK-0172
aliases: [TASK-0172]
title: "Extract AgentDetailModal's content into a non-overlay AgentDetailView"
status: done
created: 2026-09-18
updated: 2026-09-19
depends_on: [TASK-0169]
blocks: [TASK-0173]
parallel_safe_with: []
uat: "[[UAT-0172]]"
tags: [frontend, agents-page, refactor]
---

# TASK-0172 — Extract AgentDetailModal's content into a non-overlay AgentDetailView

depends_on::[[TASK-0169]]
blocks::[[TASK-0173]]
relates_to::[[agents-page-sidebar-layout]]
relates_to::[[react-router-outlet-sidebar-layout]]
relates_to::[[agent-detail-modal]]

Roadmap: [[ROADMAP-0023]] Phase 2, item 4.

## Objective

Split `AgentDetailModal` (`frontend/src/components/AgentList.tsx`, exported, ~590 lines) into (a) a new exported `AgentDetailView` that renders the detail content with **no overlay concerns**, and (b) a thin `AgentDetailModal` wrapper that keeps today's overlay behavior and simply renders `AgentDetailView`. After this task the app looks and behaves identically; [[TASK-0173]] then mounts `AgentDetailView` in the main content area.

## Approach

Built against the **current** structure of `AgentDetailModal` (post TASK-157 tabs, TASK-162 Details/Queued-tasks tabs, TASK-167 role switcher, TASK-148 actions menu): header (name/label/`ProjectBadge`/`StatusBadge`/`AgentIdentityBadge`/`ContextMeter`/attention "!"), action buttons (Stop, Destroy, `AgentActionsMenu`, rename/role inline editors), prev/next navigation buttons, close X, `activeTask` strip, error strip, `AgentInfoTabs` with tabs `terminal, skills, details, queued-tasks, diff, usage, checkpoints`, and two `ConfirmDialog`s.

**What stays in `AgentDetailView`** (everything content): all `useState` for tasks/skills/rename/role/clone/worktree/window, `activeTabId` + the `armInteract` -> Terminal-tab effect, the queue+skills fetch effect keyed on `agent.id`, all handlers (`handleCreateWindow`, `handleCreateWorktree`, `doRemove`, `doCloseWindow`, `handleRename`, `handleChangeRole`, `handleClone`), the `tabs` array, header, error strip, the two `ConfirmDialog`s, the Cmd/Ctrl+Shift+Arrow document keydown handler (it needs `onNavigate` and only matters while a detail is mounted; [[TASK-0174]] re-verifies it against the pane selection), and the `interacting` state (LogTail's `onInteractChange`).

**What moves to the `AgentDetailModal` wrapper only** (overlay chrome): `createPortal(..., document.body)`, the `fixed inset-0 z-50` container, the `bg-black/40 backdrop-blur` click-to-close backdrop, the `absolute inset-4 md:inset-8 ... rounded-[14px] shadow-pop` panel, the `document.body.style.overflow = 'hidden'` lock effect, and the **Escape-closes** keydown branch (guarded by `!interacting` — see below). In a non-overlay pane Escape must not deselect the agent, so `AgentDetailView` does not register an Escape-to-close listener at all.

**Escape/interacting coupling.** The Escape branch currently reads `interacting` (set by LogTail via `onInteractChange`) so the modal does not close while Direct Input owns Escape. The wrapper therefore needs to know `interacting`: have `AgentDetailView` accept an optional `onInteractingChange?: (v: boolean) => void` prop that the wrapper uses to feed its own Escape handler. `AgentDetailView` still forwards it into LogTail.

**Props.** `AgentDetailView` takes the exact same props as `AgentDetailModal` today (`agent, project, projectId, status, onClose, armInteract, agentCount, onNavigate, onRenamed, onCloned, onRoleChanged`) plus the optional `onInteractingChange`. Keep the header close (X) button: in the pane it means "deselect"; it calls `onClose`. `doRemove`/`doCloseWindow` keep calling `onClose` on success (deselect in the pane). Check `LogTail`'s `onCloseModal` prop usage and keep passing `onClose` (semantics: whatever LogTail invokes it for, e.g. leaving the view, must still make sense as "deselect").

**Layout of the view root.** Replace the portal/overlay panel classes with a root that fills its container: `flex h-full min-h-0 flex-col overflow-hidden bg-card` (no rounded overlay chrome). The wrapper places it inside its existing rounded overlay panel, so the modal's rendered result is unchanged.

**Stay in one file.** Do not create `AgentDetailView.tsx`: the view uses ~15 symbols defined in `AgentList.tsx` (`ProjectBadge`, `StatusBadge`, `AgentIdentityBadge`, `ContextMeter`, `needsAttention`, `ROLE_VALUES`, `SkillRow`, `SKILLS_VISIBLE_LIMIT`, `UsageBreakdown`, ...); a separate file would force a wide export surface and an `AgentList.tsx` <-> new-file import cycle. Both components stay exported from `AgentList.tsx`.

**Tests.** ~60 existing tests render `AgentDetailModal` directly to assert content (skills flattening, actions menu, role switcher, tabs, Details/Queued Tasks, header emphasis). Repoint the content-focused describe blocks to `AgentDetailView` (they assert nothing overlay-specific — they query the portal via `document.body`; the view renders in RTL's container, so adjust queries only where needed). Keep a small set of tests on the `AgentDetailModal` wrapper for the overlay behavior (dialog role, backdrop click closes, Escape closes unless interacting, body scroll lock). Overlay-only tests are deleted later by [[TASK-0178]] when the wrapper is removed.

**Terminal-size probe is deferred.** `frontend/src/lib/terminalSizeProbe.ts` mirrors the modal's geometry (`fixed inset-4 md:inset-8` + `p-5`). This task does not change rendered geometry, so the probe is untouched here; [[TASK-0173]] updates it when the terminal actually moves into a narrower pane.

## Dependencies

- depends_on: [[TASK-0169]] (both edit the same file; extraction assumes the column model is gone).
- blocks: [[TASK-0173]].
- File-overlap: `AgentList.tsx` / `AgentList.test.tsx` with [[TASK-0170]], [[TASK-0171]], [[TASK-0173]], [[TASK-0174]], [[TASK-0177]], [[TASK-0178]] — the orchestrator must not run those concurrently with this task.

## Files

- `frontend/src/components/AgentList.tsx` — split `AgentDetailModal` into `AgentDetailView` + wrapper.
- `frontend/src/components/AgentList.test.tsx` — repoint content tests to `AgentDetailView`, keep wrapper overlay tests.
- `frontend/src/components/InactiveAgentsPanel.tsx` — no change required (still consumes the exported `AgentDetailModal` wrapper); listed only so collisions with [[TASK-0177]]/[[TASK-0178]] are visible.

## Steps

### 1. Carve out AgentDetailView <!-- agent: general-purpose -->

- [x] In `AgentList.tsx`, rename the current `AgentDetailModal` function body into `export function AgentDetailView(props)` and remove from it: the `createPortal` call, the `fixed inset-0` container, the backdrop `div`, the `absolute inset-4 md:inset-8` panel wrapper, the body-overflow-lock `useEffect`, and the Escape-to-close branch of the keydown handler (keep the Cmd/Ctrl+Shift+Arrow branch and its `TEXTAREA`/`INPUT` target guard).
- [x] Give the view root `flex h-full min-h-0 flex-col overflow-hidden bg-card`; keep header, `activeTask` strip, error strip, `AgentInfoTabs` block and both `ConfirmDialog`s inside it. Keep the `ErrorBoundary` wrapper around the content.
- [x] Add the optional `onInteractingChange` prop; call it from the `setInteracting` path passed to LogTail's `onInteractChange`.

### 2. Re-create the modal as a thin wrapper <!-- agent: general-purpose -->

- [x] Add `export function AgentDetailModal(props)` that owns `interacting` state (via `onInteractingChange`), the body-overflow lock effect, the Escape-unless-interacting effect calling `props.onClose`, and returns `createPortal(<ErrorBoundary><div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={`${agent.name} detail`}> <backdrop/> <div className="absolute inset-4 flex flex-col overflow-hidden rounded-[14px] bg-card shadow-pop md:inset-8"><AgentDetailView {...props} onInteractingChange={setInteracting} /></div></div></ErrorBoundary>, document.body)`.
- [x] Confirm the modal's rendered DOM and behavior are unchanged for the existing consumers (`AgentList`'s modal render and `InactiveAgentsPanel`'s).

### 3. Tests and gates <!-- agent: general-purpose -->

- [x] Repoint the content-focused describe blocks in `AgentList.test.tsx` (Skills flattened list, actions menu wiring, role switcher, tabbed info panel, Details/Queued Tasks tabs, header emphasis/last-command) to render `AgentDetailView` (adjust any `document.body`-portal queries to the RTL container). Keep the existing `detailModalProps()` helper.
- [x] Add wrapper tests: `AgentDetailModal` has `role="dialog"`, backdrop click calls `onClose`, Escape calls `onClose` when not interacting and does not when `interacting` (drive via LogTail mock's `onInteractChange` as the existing tests do), and `document.body.style.overflow` is `hidden` while mounted and restored on unmount.
- [x] Add a view test: `AgentDetailView` rendered directly has no `role="dialog"` and does not react to Escape.
- [x] Run `npm test` and `npm run typecheck` in `frontend/` — clean. No behavior change is expected in the live app.
- [x] [DEFERRED-TO-UAT] Live check: opening an agent still shows the overlay modal exactly as before, including Direct Input Escape handling.
