---
id: TASK-0232
aliases: [TASK-0232]
title: "Preselect the active agent's project when the Add Agent modal opens"
status: pending-uat
created: 2026-09-20
updated: 2026-10-17
depends_on: [TASK-0173, TASK-0175]
blocks: []
parallel_safe_with: [TASK-0199, TASK-0200]
uat: ""
tags: [frontend, navbar, forms, agents-page]
---

# TASK-0232 — Preselect the active agent's project when the Add Agent modal opens

depends_on::[[TASK-0173]]
depends_on::[[TASK-0175]]
relates_to::[[nav-bar]]
relates_to::[[agents-page-sidebar-layout]]

## Objective

When the user clicks **+ Add Agent** in the header while an agent is selected in the Agents page detail pane, the modal opens with that agent's project already chosen in the Project dropdown (and the launch command already set to that project's default, exactly as if the user had picked it by hand). With no active agent, or an active agent that has no project, the modal behaves as it does today (`— None (free-form) —`).

## Approach

- **The gap.** The selection lives in `AgentList`'s local `expandedAgent` state (`frontend/src/components/AgentList.tsx`, `useState<{ id; armInteract } | null>`), while the trigger lives in `NavBar`, rendered once in `App.tsx` *above* `<Routes>`. NavBar cannot see the selection, and `AddAgentForm` has no way to receive a default project. `AddBgProcessForm` already solves the second half with a `defaultProjectId?: number | null` prop that seeds `selectedProjectId`; mirror it.
- **Sharing the selection: a tiny module store, not a context or a lifted state.** New `frontend/src/lib/activeAgent.ts` exposing `setActiveAgentProjectId(id: number | null)`, `getActiveAgentProjectId()` and `subscribeActiveAgent(cb)`, consumed with `useSyncExternalStore`. It follows the repo's existing module-store pattern (`sidebarState.ts`, `lastPayload.ts`) and avoids threading the selection up through `App.tsx`/`AgentsPage` or re-architecting `AgentList`'s state. It stores only the derived `projectId` (`number | null`), not the whole agent, so unrelated agent updates (status flips, SSE ticks) do not re-render NavBar: `setActiveAgentProjectId` is a no-op when the value is unchanged.
- **Scope: Agents page only** (user decision). `AgentList` clears the store on unmount, so on `/projects` and `/history` there is no active agent and the modal opens with None, as today. No "remember last active agent" behaviour.
- **What counts as active.** The agent rendered in the detail pane: `selectedAgent` in `AgentList` (resolved from `expandedAgent` against the full `agents` list, so a selected inactive agent still counts). Publish `selectedAgent?.projectId ?? null`.
- **Rules of Hooks.** `AgentList` has early returns (`loading`, error, session-dead). The publishing `useEffect` must be declared above them, next to the other top-level hooks, and derive from `selectedAgent` (which is computed before the first early return).
- **Seeding the form.** `AddAgentForm` gets `defaultProjectId?: number | null` (default `null`). `selectedProjectId` initialises from it. Because `projects` load asynchronously in the mount effect, the launch command cannot be derived at initial state; when the list arrives, if `selectedProjectId` is set: find the project and apply `setLaunchCmd(project.defaultLaunchCmd)` + `setLaunchPreset(presetForCommand(project.defaultLaunchCmd))` (the same two calls the dropdown's `onChange` makes); if the project is not in the list (deleted since), reset `selectedProjectId` to `null`. The effect must not clobber a project the user changed in the meantime: only apply when the current selection still equals the seeded id, and only on the first load.
- **NavBar wiring.** `NavBar` reads the store with `useSyncExternalStore` and passes `defaultProjectId` when it mounts `AddAgentForm`. The form is already conditionally mounted per open, so it re-seeds on every open with the selection as of that click; an open modal is not re-seeded if the selection changes underneath it (the modal is modal, so this cannot happen by user action anyway).
- **Alternatives rejected.** (a) React context provider wrapping the routes: more plumbing for one nullable number. (b) Lifting `expandedAgent` out of `AgentList`: large, risky change in a file with several in-flight tasks. (c) A URL param for the selection: out of scope, changes navigation behaviour.

## Dependencies

- depends_on: [[TASK-0173]] (introduced the pane selection this reads) and [[TASK-0175]] (moved the trigger into NavBar and made `AddAgentForm` conditionally mount per open). Both are `pending-uat` and implemented, so this can start now.
- blocks: none.
- parallel_safe_with: [[TASK-0199]] (also edits `AddAgentForm.tsx`, but a different region: a description textarea vs. the project seeding; expect a trivial merge) and [[TASK-0200]] (`LogTail`/`AddTaskForm`, no shared files).
- File-overlap for the orchestrator: `frontend/src/components/AgentList.tsx` is edited by many in-flight tasks (ROADMAP-0025, [[TASK-0200]], [[TASK-0201]], ROADMAP-0027 display work). This task's change there is one small `useEffect` plus an import, so keep the diff minimal and do not run it concurrently with another `AgentList.tsx` edit.

## Files

- `frontend/src/lib/activeAgent.ts` — new module store (setter, getter, subscribe).
- `frontend/src/lib/activeAgent.test.ts` — new store tests.
- `frontend/src/components/AgentList.tsx` — publish `selectedAgent?.projectId ?? null`, clear on unmount (one `useEffect` above the early returns).
- `frontend/src/components/NavBar.tsx` — read the store, pass `defaultProjectId` to `AddAgentForm`.
- `frontend/src/components/AddAgentForm.tsx` — `defaultProjectId` prop, seeded `selectedProjectId`, launch-command sync when the project list loads.
- `frontend/src/components/AddAgentForm.test.tsx`, `frontend/src/components/NavBar.test.tsx`, `frontend/src/components/AgentList.test.tsx` — tests.

## Steps

### 1. Add the active-agent store <!-- agent: general-purpose -->

- [x] Create `frontend/src/lib/activeAgent.ts`: module-level `let activeProjectId: number | null = null` and a `Set` of listeners. Export `getActiveAgentProjectId(): number | null`, `subscribeActiveAgent(listener: () => void): () => void`, and `setActiveAgentProjectId(id: number | null): void` which returns early when `id === activeProjectId` and otherwise assigns then notifies all listeners. Add a short header comment in the style of `sidebarState.ts` explaining why it exists (NavBar sits above the routes and cannot see AgentList's selection).
- [x] Export a `useActiveAgentProjectId()` hook wrapping `useSyncExternalStore(subscribeActiveAgent, getActiveAgentProjectId)` so callers need not repeat the wiring.
- [x] Create `frontend/src/lib/activeAgent.test.ts` (vitest): default is `null`; set then get; subscribers fire on change; no notification when the value is unchanged; unsubscribe stops notifications; setting back to `null` notifies. Reset the store in `afterEach` via `setActiveAgentProjectId(null)`.

### 2. Publish the selection from AgentList <!-- agent: general-purpose -->

- [x] In `frontend/src/components/AgentList.tsx`, import `setActiveAgentProjectId`. Immediately after `selectedAgent` is computed (currently `const selectedAgent = expandedAgent ? agents.find(...) : undefined`) and **above the first early return** (`if (loading)`), add `useEffect(() => { setActiveAgentProjectId(selectedAgent?.projectId ?? null) }, [selectedAgent?.projectId])`. If `selectedAgent` is currently computed below an early return, move the computation up rather than the effect down (Rules of Hooks: same hook count on every render).
- [x] Add a second `useEffect(() => () => { setActiveAgentProjectId(null) }, [])` (cleanup-only) so leaving the Agents page clears the store.
- [x] In `AgentList.test.tsx`, add tests: selecting an agent in a project publishes its `projectId` (assert via `getActiveAgentProjectId()`); selecting an agent with `projectId: null` publishes `null`; deselecting or switching agents updates it; unmounting resets to `null`. Reuse the existing selection helpers in that file rather than inventing new ones.

### 3. Seed AddAgentForm and wire NavBar <!-- agent: general-purpose -->

- [x] In `frontend/src/components/AddAgentForm.tsx`, add `defaultProjectId?: number | null` to `AddAgentFormProps` (doc comment mirroring `AddBgProcessForm`'s) and default it to `null` in the destructure. Initialise `const [selectedProjectId, setSelectedProjectId] = useState<number | null>(defaultProjectId)`.
- [x] Change the mount effect that calls `listProjects()` so that after `setProjects(list)`, if `defaultProjectId !== null`: `const p = list.find((x) => x.id === defaultProjectId)`; when found, `setLaunchCmd(p.defaultLaunchCmd)` and `setLaunchPreset(presetForCommand(p.defaultLaunchCmd))`; when not found, `setSelectedProjectId(null)`. Guard with a functional update or a ref so a project the user picked before the list resolved is not overwritten (only touch state while `selectedProjectId` still equals `defaultProjectId`). Leave the fetch-failure path (silent, free-form still works) unchanged; with a failed fetch the seeded id has no matching option, so the select shows the empty option and submit falls to the free-form branch: also reset `selectedProjectId` to `null` in the `catch` when it was seeded, so the form never submits an id it cannot display.
- [x] In `frontend/src/components/NavBar.tsx`, import `useActiveAgentProjectId`, call it once at the top of `NavBar`, and render `<AddAgentForm open defaultProjectId={activeProjectId} onClose={...} />`. Do not change the `AddBgProcessForm` mount.
- [x] `AddAgentForm.test.tsx` (mock `../lib/api` and `useGitRoot` as the existing tests do): with `defaultProjectId` matching a listed project, the Project select shows it and the launch command/preset equals that project's default; with an unknown id, the select falls back to `— None (free-form) —`; with no prop, behaviour is unchanged; a user change of the dropdown made before the list resolves is not overwritten; submitting with a seeded project calls `spawnAgentInProject` with that id.
- [x] `NavBar.test.tsx`: with `setActiveAgentProjectId(7)` before clicking `+ Add Agent`, the dialog's Project select has value `7` (mock `listProjects` to return a project with id 7); with the store at `null`, it is the empty option; closing and reopening after `setActiveAgentProjectId(...)` changes re-seeds. Reset the store in `afterEach`.

### 4. Gates <!-- agent: general-purpose -->

- [x] Run `npm test` and `npm run typecheck` in `frontend/`; both clean. Confirm the existing `AddAgentForm.test.tsx`, `NavBar.test.tsx` and `AgentList.test.tsx` cases still pass unmodified apart from the additions above.
- [x] Run the project lint for the changed files (`npx eslint` on the 6 changed source/test files) and fix findings.
- [DEFERRED-TO-UAT] Live check in the dashboard (do not spawn a real agent unattended, as with UAT-151/0175): with agents in two different projects, select an agent in project A and click `+ Add Agent`; the Project dropdown shows A and the launch command matches A's default. Switch to an agent in project B and reopen: B. Select an agent with no project: None. Go to `/projects` and open the modal: None. Return to the Agents page with an agent still selected and reopen: preselected again.
<!-- Updated: 2026-10-17 -->
