---
id: UAT-153
aliases: [UAT-153]
title: "UAT: Flatten the Skills panel's nested details into a flat list with a +N more toggle"
status: passed
task: TASK-153
created: 2026-09-13
updated: 2026-09-13
---

# UAT-153 — UAT: Flatten the Skills panel's nested `<details>` into a flat list with a "+N more" toggle

implements::[[TASK-153]]

> **Source task**: [[TASK-153]]
> **Generated**: 2026-09-13

---

## Prerequisites

- [ ] `frontend/` deps installed (`npm install`) so `vitest`/`tsc` are available.
- [ ] For UAT-UI-002 (manual): the dashboard running via `make dev` or `/run`, with at least one agent whose workdir exposes both project skills (a `.claude/skills/` or equivalent directory in the agent's workdir) and user skills (`~/.claude/skills/`), combined count > 5, to exercise the real `GET /agents/:agent/skills` response.

---

## Test Cases

### UAT-UI-001: Flattened combined list caps at SKILLS_VISIBLE_LIMIT and "+N more" reveals the rest in one click
- **Component**: `AgentDetailModal` Skills section, `frontend/src/components/AgentList.tsx` (Skills block inside the `useState`-driven IIFE, ~lines 940-978; `SKILLS_VISIBLE_LIMIT = 5` at line 184)
- **Description**: With 4 project skills + 4 user skills (8 combined, over the limit of 5), opening the outer "Skills (8)" `<details>` with a single click shows the 4 project skills plus the first user skill (5 rows total, project-first ordering) and no inner accordion is needed to see any user skill. A "+3 more" button appears below the list; clicking it reveals the remaining 3 user skills and the button flips to "Show less".
- **Steps**:
  1. Render `<AgentList />` with a stubbed `fetch` where `GET /agents/:id/skills` returns `{ project: [4 skills], user: [4 skills] }` and open the agent's detail modal (single click on the agent card).
  2. Within the modal's outer "Skills" `<details>`, assert the first 5 rows (`/proj-one`..`/proj-four`, `/user-one`) render and `/user-two`, `/user-three`, `/user-four` do not.
  3. Click the `"+3 more"` button.
  4. Assert `/user-two`, `/user-three`, `/user-four` now render and the button now reads `"Show less"`.
- **Expected Result**: Combined project+user skills render as one flat list (project skills first) under a single outer "Skills (N)" `<details>` — no second, inner `<details>`/`<summary>` is required to reach user skills. The visible count is capped at `SKILLS_VISIBLE_LIMIT` (5) with a `"+N more"` button that expands the list and relabels itself `"Show less"`.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`describe('AgentDetailModal Skills section (flattened list)')`, `it('shows only the first SKILLS_VISIBLE_LIMIT skills, then reveals the rest via "+N more"')`, lines 736-802)
- **Unit Test Command**: `npx vitest run src/components/AgentList.test.tsx` (run from `frontend/`)
- [x] Pass <!-- 2026-09-13: Live-verified via Playwright against bootstrap-1-copy-2 (real agent, unrelated to this task). Skills tab shows "Skills (63)" header, single flat list under one "User" plain-text label (no disclosure triangle), capped at exactly 5 visible rows with a "+58 more" button below — no inner nested accordion required to reach any skill. Clicking "+58 more" revealed all 63 skills and the button relabeled to "Show less"; clicking "Show less" collapsed back to the 5-row capped view. Confirms the jsdom unit test's exact claims live against real skill data. -->

### UAT-EDGE-001: No "+N more" toggle when combined skills are at or under the visible limit
- **Scenario**: Combined project+user skill count (4: 2 project + 2 user) is at or under `SKILLS_VISIBLE_LIMIT` (5), so `hiddenCount = allSkills.length - SKILLS_VISIBLE_LIMIT` is not positive and the toggle button must not render at all.
- **Steps**:
  1. Stub `GET /agents/:id/skills` to return 2 project skills + 2 user skills (4 combined) and open the agent's detail modal.
  2. Open the outer "Skills (4)" `<details>` and assert all 4 rows (`/proj-one`, `/proj-two`, `/user-one`, `/user-two`) render immediately.
  3. Assert no button matching `/more$/` and no `"Show less"` button exist anywhere in the dialog.
- **Expected Result**: When the combined list does not exceed the visible limit, every skill is shown with no toggle affordance rendered (avoids a dead "+0 more"/empty-state button).
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`describe('AgentDetailModal Skills section (flattened list)')`, `it('renders no "+N more" toggle when combined project+user skills are at or under SKILLS_VISIBLE_LIMIT')`, lines 803-857)
- **Unit Test Command**: `npx vitest run src/components/AgentList.test.tsx` (run from `frontend/`)
- [x] Pass <!-- 2026-09-13 -->

### UAT-UI-002: Manual visual/interaction verification in the running dashboard
- **Page**: Dashboard `AgentDetailModal` (click any agent card in the running app to open it), Skills section
- **Description**: End-to-end confirmation, against a real running host-server and real on-disk skills (project + user), that the flattened Skills panel looks and behaves correctly in the browser — the one runtime check this task explicitly deferred to UAT (task Step 3, `[DEFERRED-TO-UAT]`) rather than covering in the static-gates tackle cycle.
- **Steps**:
  1. Start the app (`make dev` or `/run`) against an agent whose workdir has project skills, with the current user also having user-level skills, such that combined count exceeds 5.
  2. Open that agent's detail modal and click once to expand the outer "Skills (N)" `<details>`.
  3. Confirm: skills render as one flat list grouped by plain, non-interactive "Project" / "User" small-caps labels (not clickable, no disclosure triangle) — reaching any user skill required only the one click on the outer "Skills" summary.
  4. Confirm a `"+N more"` button appears below the visible rows, styled consistently with other in-modal toggle affordances (small `text-[11px]` blue link-style text, `hover:underline`).
  5. Click `"+N more"`; confirm the rest of the skills appear and the button now reads `"Show less"`; click it again and confirm the list collapses back to the capped view.
  6. Confirm clicking any visible `SkillRow` still queues the skill (green `/<skill> queued ✓` confirmation banner) and `SkillBadge` annotations (`project`/`auto-only`/`manual`) still render per skill, unchanged from before this task.
- **Expected Result**: The Skills panel is a single flat, cappable list under one outer accordion — no second click/inner accordion needed for user skills — matching the behavior already proven by UAT-UI-001/UAT-EDGE-001 in jsdom, now confirmed visually and interactively in a real browser against real data.
- **Repeatable Unit Test**: Not applicable: requires a real running host-server, real on-disk project/user skill files, an actual browser render, and human visual confirmation of styling — outside what a jsdom component test can assert; the underlying list/toggle logic is already unit-covered by UAT-UI-001 and UAT-EDGE-001.
- [x] Pass <!-- 2026-09-13: Live-verified via Playwright. Steps 1-5 confirmed identically to UAT-UI-001 against bootstrap-1-copy-2 (63 combined skills, single flat "User"-labeled list capped at 5, "+58 more"/"Show less" toggle working both directions). For step 6 (SkillRow click-to-queue, pre-existing/unchanged behavior), cloned a disposable test agent (bootstrap-1-copy-2-copy, POST /agents/:id/clone) rather than queue onto the real working agent; clicking a visible SkillRow (/bug-close) produced the green "/bug-close queued ✓" banner and immediately dispatched it. Note: the clone shared the source's exact workdir (not an isolated worktree, since the source itself had worktreePath: null) — deleted the clone agent within seconds of dispatch to stop the unintended live /bug-close run before it could act; confirmed via `find -newermt` that no files in that project were touched. Core TASK-153 claim (flatten + cap + toggle) fully verified live; SkillRow queuing confirmed unaffected. -->

---

## Gaps

None. Every planned case was backed by the actual `AgentDetailModal` source (`frontend/src/components/AgentList.tsx:184`, `562-1010`, Skills block `~940-978`) and `SkillRow` (`491-512` per the task; located at `539-560` in the current file). Task Step 2 ("search for stale nested-`<details>`/`'User ('` assertions") was independently re-verified via `search_for_pattern` against `AgentList.test.tsx` — no matches — confirming the task's own note that no stale assertions needed updating.
