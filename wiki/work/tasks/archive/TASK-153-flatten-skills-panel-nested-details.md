---
id: TASK-153
aliases: [TASK-153]
title: "Flatten the Skills panel's nested details into a flat list with a +N more toggle"
status: done
created: 2026-09-13
updated: 2026-09-13
depends_on: []
blocks: []
parallel_safe_with: []
uat: "[[UAT-153]]"
tags: [frontend, ux]
---

# TASK-153 — Flatten the Skills panel's nested `<details>` into a flat list with a "+N more" toggle

## Objective

`AgentDetailModal`'s Skills section (`frontend/src/components/AgentList.tsx:869-898`) is a double-nested accordion: an outer `<details>` ("Skills (N)") containing a flat list of Project skills, plus a second, inner `<details>` ("User (N)") nested inside it for User skills — two clicks required to see a user skill. Per ROADMAP-021 Phase 3, replace this with a single flat list (still under the one outer "Skills (N)" `<details>`) showing Project and User skills together, capped to a small number visible by default with a "+N more" button to reveal the rest — no inner accordion.

## Approach

In the Skills section (`AgentList.tsx:869-898`):

- Remove the inner `<details>` (`AgentList.tsx:885-895`) wrapping User skills.
- Concatenate `skills.project` and `skills.user` into one ordered list (project first, matching current visual precedence), rendered via the existing `SkillRow` component (`AgentList.tsx:491-512`, unchanged) — keep the existing small-caps `Project`/`User` group labels (`AgentList.tsx:879`, and the equivalent for User) as plain non-interactive headings above each group's rows in the flat list, just without the inner `<details>`/`<summary>` wrapper around the User group.
- Add a visible-count cap: show the first `SKILLS_VISIBLE_LIMIT` rows (constant, e.g. `5`, defined near `ROLE_CONFIG`/`STATUS_CONFIG` at the top of the file) across the combined list; if more remain, render a `"+N more"` button below the list (same visual style as other in-modal toggle affordances — check for an existing "+N more"-style pattern elsewhere in this file or `InactiveAgentsPanel.tsx` to match styling; otherwise a simple `text-[11px] text-accent-blue hover:underline` button) that expands to show the rest. Reuse the outer `<details>`'s existing `mt-3 flex-shrink-0` container; the new expand state is local `useState` inside `AgentDetailModal` (near other panel-local state, e.g. `queuedSkill`), not persisted.
- Preserve existing behavior: `SkillRow`'s click-to-queue (`onQueued={setQueuedSkill}`) and `SkillBadge` annotations (`project`/`auto-only`/`manual`) are unchanged; only the nesting/visibility structure changes.

## Steps

### 1. Flatten the Skills section markup <!-- agent: general-purpose -->

- [x] In `frontend/src/components/AgentList.tsx`, add a `SKILLS_VISIBLE_LIMIT = 5` constant near the top-level constants (`ROLE_CONFIG`/`STATUS_CONFIG`, ~line 80-174).
- [x] Add `const [showAllSkills, setShowAllSkills] = useState(false)` inside `AgentDetailModal` near the other panel-local state (e.g. near `queuedSkill`'s `useState`).
- [x] Replace the Skills section (`AgentList.tsx:869-898`) with a flat structure: keep the outer `<details className="mt-3 flex-shrink-0">` / `<summary>Skills (N)</summary>`, but inside it build one combined array `[...skills.project.map(s => ({ skill: s, group: 'project' })), ...skills.user.map(s => ({ skill: s, group: 'user' }))]`, slice to `showAllSkills ? all : all.slice(0, SKILLS_VISIBLE_LIMIT)`, and render each with its existing group label shown only when the group changes from the previous row (so "Project" and "User" still appear as section labels, just not as separate collapsible widgets) followed by `<SkillRow key={skill.name} skill={skill} agentId={agent.id} onQueued={setQueuedSkill} />` (unchanged).
- [x] Below the rendered rows, if `all.length > SKILLS_VISIBLE_LIMIT`, render a toggle button: `{!showAllSkills ? `+${all.length - SKILLS_VISIBLE_LIMIT} more` : 'Show less'}`, `onClick` flips `showAllSkills`.

### 2. Tests <!-- agent: general-purpose -->

- [x] In `frontend/src/components/AgentList.test.tsx`, search for any existing test asserting the nested `<details>` structure or the "User (" summary text for the Skills section and update it to match the flattened markup. (No stale nested-accordion assertions existed to update; confirmed via Serena search — none reference `'User ('` or a second `Skills (` details.)
- [x] Add a test: with more than `SKILLS_VISIBLE_LIMIT` combined project+user skills, only the first `SKILLS_VISIBLE_LIMIT` render initially and a `"+N more"` button is present; clicking it reveals the rest. (Added `describe('AgentDetailModal Skills section (flattened list)')` at `AgentList.test.tsx:736-801`: 4 project + 4 user skills, asserts first 5 rows visible, `+3 more` button, click reveals remaining 3 rows and button flips to `Show less`.)
- [x] Run `npm test` and `npm run typecheck` in `frontend/` — clean. (57/57 tests passing in `AgentList.test.tsx`; `tsc --noEmit` clean.)

### 3. Verify <!-- agent: general-purpose -->

- [DEFERRED-TO-UAT] Via `/run` or `make dev`, open an agent's detail modal with both project and user skills configured; confirm the Skills panel now shows one flat list (single click to open the outer "Skills" details, no second click needed for User skills), and that a "+N more" button appears and works when the combined count exceeds the visible limit. (Runtime/E2E verification belongs to the UAT phase, not the static-gates-only tackle cycle — see `wiki/guides/command-anti-patterns.md#verification-belongs-to-the-right-phase`.)

## Notes

- Scoped to `AgentDetailModal`'s Skills panel only (`AgentList.tsx:869-898`) — the outer "Details"/"Queued tasks" `<details>` panels elsewhere in the modal (`AgentList.tsx:801`, `852`) are single-level already and out of scope.

<!-- Updated: 2026-09-13 06:00 -->

