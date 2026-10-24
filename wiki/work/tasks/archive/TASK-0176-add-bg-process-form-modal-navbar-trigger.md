---
id: TASK-0176
aliases: [TASK-0176]
title: "Convert AddBgProcessForm into a modal and move its trigger into NavBar"
status: done
created: 2026-09-18
updated: 2026-10-17
depends_on: [TASK-0175]
blocks: []
parallel_safe_with: [TASK-0169]
uat: "[[UAT-0176]]"
tags: [frontend, navbar, forms]
---

# TASK-0176 — Convert AddBgProcessForm into a modal and move its trigger into NavBar

depends_on::[[TASK-0175]]
relates_to::[[agents-page-sidebar-layout]]
relates_to::[[nav-bar]]
relates_to::[[add-bg-process-form]]

Roadmap: [[ROADMAP-0023]] Phase 3, item 8.

## Objective

`AddBgProcessForm` (`frontend/src/components/AddBgProcessForm.tsx`) is an always-rendered inline card with no `open`/`onClose` props, rendered unconditionally in `AgentsPage.tsx`. Convert it into a modal with the same `open`/`onClose` contract and dismissal behavior as `AddAgentForm` (TASK-151), and add a `+ Add Background Process` trigger to the `NavBar` action cluster created by [[TASK-0175]].

## Approach

- **Mirror `AddAgentForm`'s modal shell exactly** (do not invent a second dialog convention): props `{ open: boolean; onClose: () => void }`; the `if (!open) return null` early return placed **after** all hooks (`AddAgentForm` puts it after its `useEffect`s/handlers — same rule here to keep Rules of Hooks); overlay `fixed inset-0 z-50 flex items-center justify-center bg-black/40` with overlay-click-to-close (`e.target === e.currentTarget`); inner card `animate-riseIn flex max-h-[90vh] w-[560px] flex-col overflow-y-auto rounded-card border border-line bg-card px-5 py-4 shadow-pop`; header row with the existing title "Add Background Process" plus a `✕` close button (`aria-label="Close"`); an Escape `useEffect` registered only while `open`.
- **Success behavior.** Today a 201 resets fields and shows an inline "Process spawned ✓" for 4s. In a modal the form should close on success like `AddAgentForm.clearOnSuccess()`: reset state, then call `onClose()`. Drop the now-invisible inline `success` message and its timeout state (the new process appears via the `bg-update` SSE in `BgProcessSection`). Failure paths (409, other, network) keep showing the inline error inside the modal.
- **Conditionally mount from NavBar** (`{showAddBg && <AddBgProcessForm open onClose={...} />}`), same rationale as [[TASK-0175]]: the form fetches `/status` (agent list for the "Link to Agent" advanced select) and `listProjects()` in mount-only effects; NavBar mounts once per app session, so a permanently mounted form would show stale agents/projects. Per-open mount also resets the form.
- **Trigger styling.** Secondary/neutral button in the same NavBar cluster, right after `+ Add Agent`, visually subordinate: `h-8 ... border border-line bg-card text-ink hover:bg-canvas` (reuse the neutral button classes already used in `AgentDetailModal`'s Cancel buttons). Label `+ Add Background Process`.
- **AgentsPage cleanup:** remove `<AddBgProcessForm />` and its import.
- Do not change the form's fields, validation, project-required rule or API payload — this task is shell + trigger only. (The project `<select>` behavior shipped in TASK-161 is out of scope.)

## Dependencies

- depends_on: [[TASK-0175]] (both edit `NavBar.tsx`; this adds the second trigger to the cluster the first task builds).
- blocks: none.
- parallel_safe_with: [[TASK-0169]].
- File-overlap for the orchestrator: `frontend/src/pages/AgentsPage.tsx` is also edited by Phase 2 ([[TASK-0170]] layout container, [[TASK-0173]] pane overflow), [[TASK-0175]] and [[TASK-0177]]. Serialize any of those that would run concurrently.

## Files

- `frontend/src/components/AddBgProcessForm.tsx` — modal conversion (`open`/`onClose`, overlay, Escape, close-on-success, drop inline success state).
- `frontend/src/components/NavBar.tsx` — second trigger button + state + conditional `<AddBgProcessForm>`.
- `frontend/src/pages/AgentsPage.tsx` — remove `<AddBgProcessForm />` and import (overlap noted above).
- `frontend/src/components/AddBgProcessForm.test.tsx` — **new** (none exists today).
- `frontend/src/components/NavBar.test.tsx` — trigger tests.

## Steps

### 1. Convert the form into a modal <!-- agent: general-purpose -->

- [x] In `AddBgProcessForm.tsx` add `interface AddBgProcessFormProps { open: boolean; onClose: () => void }` and change the signature to `AddBgProcessForm({ open, onClose })`.
- [x] Add the Escape `useEffect` (guarded by `open`) and the `handleOverlayClick`; place `if (!open) return null` after every hook.
- [x] Wrap the existing card/form in the overlay + inner card described in Approach; keep the existing `<h2>` title styling inside a header row with the `✕` close button.
- [x] On a 201, reset fields exactly as today, then call `onClose()`; remove the `success` state, its `setTimeout`, and the inline "Process spawned ✓" element.

### 2. Add the NavBar trigger <!-- agent: general-purpose -->

- [x] In `NavBar.tsx` add `showAddBg` state, a neutral `+ Add Background Process` button after `+ Add Agent` in the action cluster, and `{showAddBg && <AddBgProcessForm open onClose={() => { setShowAddBg(false) }} />}`.
- [x] In `AgentsPage.tsx` remove `<AddBgProcessForm />` and its import.

### 3. Tests and gates <!-- agent: general-purpose -->

- [x] Create `AddBgProcessForm.test.tsx` modeled on `AddAgentForm.test.tsx` (mock `../lib/api`/`useGitRoot`/`fetch`): closed renders nothing; open shows "Add Background Process"; Escape calls `onClose`; overlay click closes but a click inside the card does not; a 201 response calls `onClose`; a 409 keeps the modal open and shows the error.
- [x] In `NavBar.test.tsx` add: the `+ Add Background Process` trigger opens the dialog, Escape closes it, and both triggers can be used independently.
- [x] Run `npm test` and `npm run typecheck` in `frontend/` — clean. (174 tests pass; `tsc --noEmit` reports only 2 unused-symbol errors in `AgentList.tsx` from another agent's in-progress TASK-0170 work, none in TASK-0176 files.)
- [ ] [DEFERRED-TO-UAT] Live check: open from the NavBar, verify the Link-to-Agent advanced select lists current agents, dismissal paths work. Actually spawning a process opens a real tmux window — flag rather than run unattended.
