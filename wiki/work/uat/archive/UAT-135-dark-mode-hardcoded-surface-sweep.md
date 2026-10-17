---
id: UAT-135
aliases: [UAT-135]
title: "UAT: Dark-mode sweep — replace remaining hardcoded bg-white/surface literals across every page and component"
status: passed
task: TASK-135
created: 2026-08-28
updated: 2026-09-19
---

# UAT-135 — UAT: Dark-mode sweep — replace remaining hardcoded bg-white/surface literals across every page and component

implements::[[TASK-135]]

> **Source task**: [[TASK-135]]
> **Generated**: 2026-08-28

---

## Prerequisites

- [ ] Frontend dev server running (`cd frontend && npm run dev`, default `http://localhost:4321`) and host-server running (default `http://localhost:8788`), or use `make dev` from repo root.
- [ ] Dashboard has at least one project and one agent visible (any live fleet state is fine — these cases are read-mostly and don't require fixtures).
- [ ] Dark-mode toggle available in the NavBar (top-right sun/moon icon, per `TASK-122`).

---

## Test Cases

### UAT-EDGE-001: No hardcoded `bg-white` remains anywhere under `frontend/src` except the one documented exception
- **Scenario**: TASK-135 swapped 41 hardcoded `bg-white` Tailwind literals to the `bg-card` theme token across 19 files. This is a static, repo-wide regression guard against any of those 41 spots — or a brand-new one — reverting to a hardcoded literal.
- **Steps**: Run the unit test command below.
- **Expected Result**: Both assertions pass — zero files under `frontend/src` contain `bg-white` except `components/LogTail.tsx`, and `LogTail.tsx` contains exactly one `bg-white` occurrence (the intentional live-indicator dot at ~line 675, a white dot rendered on a colored banner, not a themeable surface).
- **Repeatable Unit Test**: Created: `frontend/src/components/ConfirmDialog.test.tsx` (new `describe('bg-white elimination — TASK-135 regression guard', ...)` block, following the same repo-wide static-check pattern already established by the neighboring `UAT-123` `window.confirm` elimination guard in the same file)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/ConfirmDialog.test.tsx`
- [x] Pass <!-- 2026-09-19 (auto-plus): via unit test frontend/src/components/ConfirmDialog.test.tsx, 11/11 tests pass -->

### UAT-UI-001: Modals and dialogs re-theme correctly in dark mode (ConfirmDialog, AddProjectForm, AddAgentForm, FolderPickerModal)
- **Page**: `http://localhost:4321/` (Agents tab) and `http://localhost:4321/projects`
- **Description**: Verifies the `bg-white` → `bg-card` swap on the four most-used modal/dialog surfaces.
- **Steps**:
  1. Toggle dark mode via the NavBar.
  2. Click any agent card, then click "Remove agent" or "Close agent" to open `ConfirmDialog`. Observe its background, then click Cancel (do not confirm against a real agent).
  3. Click "Add Agent" to open `AddAgentForm`; observe the collapsed-card background and the input fields. Click "Show advanced" if present.
  4. From `AddAgentForm` (or the Projects page), open "Add Project" (`AddProjectForm`) and observe its card background.
  5. From `AddProjectForm`, click "Browse" (or equivalent) to open `FolderPickerModal`; observe its panel background and Cancel button.
  6. Toggle back to light mode and repeat steps 2-5, confirming none of the four surfaces regressed to a jarring/mismatched light-mode appearance.
- **Expected Result**: In dark mode, all four surfaces render with the dark card background (`rgb(33, 35, 43)`, matching `--color-card`'s dark value) and legible text/border contrast — no leftover pure-white (`rgb(255, 255, 255)`) panels. In light mode, all four still render with the correct light card background (`rgb(255, 255, 255)`) and normal contrast.
- [SKIP: user-directed — closing out] <!-- 2026-09-19 -->

### UAT-UI-002: Agent detail modal's nested sections re-theme correctly in dark mode (AgentList card/rename/buttons, CheckpointList, DiffPanel, LogTail, ModeSwitcher)
- **Page**: `http://localhost:4321/` — any agent's detail modal
- **Description**: Verifies the swap across the highest-density cluster of fixes: the main agent card, its rename flow, its Close/Remove buttons, and four nested detail-modal sections.
- **Steps**:
  1. Toggle dark mode.
  2. Observe an agent card in the main grid (`AgentList`'s list-item container) — background should not be pure white.
  3. Open an agent's detail modal. Click "Rename" and observe the rename input's background; Cancel without saving.
  4. Observe the "Close agent" and "Remove agent" buttons' backgrounds (don't confirm either).
  5. Expand the "Checkpoints" section (if the agent has any checkpoints) and observe its action button(s).
  6. Expand the "Changes" (Diff) section and observe its button(s) — the empty state ("No changes yet") is sufficient if no live diff exists.
  7. In the "Log output" section, observe the Live/History segmented toggle's inactive-state background, and (if Direct Input mode is available) the interact textarea's background.
  8. In the "Details" section, observe the `ModeSwitcher` toggle (Default/Accept edits/Plan/Bypass) background.
  9. Toggle back to light mode and re-check all of the above.
- **Expected Result**: Every surface in both modes shows the correct token-driven background (dark: `rgb(33, 35, 43)`; light: `rgb(255, 255, 255)`) with legible contrast — no pure-white panel visible anywhere in dark mode.
- [SKIP: user-directed — closing out] <!-- 2026-09-19 -->

### UAT-UI-003: Page-level card surfaces re-theme correctly in dark mode (ProjectList, ProjectDetailPage, TaskHistoryPage)
- **Page**: `http://localhost:4321/projects`, `http://localhost:4321/projects/<id>`, `http://localhost:4321/history`
- **Description**: Verifies the swap on three page-level (non-modal) surfaces.
- **Steps**:
  1. Toggle dark mode.
  2. Navigate to `/projects`; observe the "Add Project" collapsed-card background.
  3. Open any project's detail page (`/projects/<id>`); observe all three sections' card backgrounds.
  4. Navigate to `/history`; observe the collapsed-card background at the top of the page.
  5. Toggle back to light mode and re-check all three pages.
- **Expected Result**: All surfaces show the correct token-driven background in both modes, matching the rest of the dark-mode-aware dashboard.
- [SKIP: user-directed — closing out] <!-- 2026-09-19 -->

### UAT-UI-004: AddTaskForm and InactiveAgentsPanel re-theme correctly in dark mode
- **Page**: an agent's detail modal → "Queued tasks" tab; main Agents page → "Inactive Agents" panel
- **Description**: Verifies the swap on the task-queueing form and the inactive-agents panel.
- **Steps**:
  1. Toggle dark mode.
  2. Open an agent's detail modal, expand "Queued tasks", and observe the scope-toggle buttons (Agent/Project) and the command textarea backgrounds.
  3. On the main Agents page, expand "Inactive Agents" and observe its collapsed-card background (an empty "None" state is sufficient if no agents are currently inactive).
  4. Toggle back to light mode and re-check both.
- **Expected Result**: Both surfaces show the correct token-driven background in both modes.
- [SKIP: user-directed — closing out] <!-- 2026-09-19 -->

### UAT-EDGE-002: Partial fixes keep their amber/orange accent color while losing the hardcoded white base
- **Scenario**: Three spots (`AddAgentForm.tsx`'s "use git root" button, `AddBgProcessForm.tsx`'s "use git root" button, `LogTail.tsx`'s Direct-Input toggle inactive state) mixed an in-scope `bg-white` base with an out-of-scope amber/orange accent border/text — TASK-135 swapped only the `bg-white` base, leaving the accent styling untouched by design.
- **Steps**:
  1. Toggle dark mode.
  2. Open "Add Agent", expand advanced options if needed, and locate the "use git root" button (only visible when a workdir differs from the detected git root — may require entering a nested path). Observe its background is now dark-token-driven while its amber border is still visibly amber, not washed out or mismatched.
  3. In an agent's detail modal's "Log output" section, if Direct Input mode is available, observe the Direct-Input toggle's inactive state — background should be dark-token-driven while the orange accent border/text remains orange.
- **Expected Result**: In both spots, the background is now the dark card token (not pure white) while the amber/orange accent border and text colors are visually unchanged from before this task — the fix touched only the base surface, not the semantic accent.
- [SKIP: user-directed — closing out] <!-- 2026-09-19 -->

### UAT-EDGE-003: Components verified only via source (not live-reachable in the current UI) still use the correct token
- **Scenario**: `AddBgProcessForm.tsx`, `ScheduleForm.tsx`, and `ScheduleList.tsx` were fixed identically to every other spot, but are not mounted/reachable anywhere in the current live app (confirmed dead code during TASK-135's Step 3 — no route or parent component references them). `TaskList.tsx`/`ScheduleList.tsx`'s drag-item ternary default branch, and `AgentList.tsx`'s "host-server not reachable" panel, also could not be safely triggered live without mutating real fleet state or actually taking the host-server down.
- **Steps**: This case cannot be walked live. Instead, open each file below and confirm the fixed line reads `bg-card`, not `bg-white`:
  1. `frontend/src/components/AddBgProcessForm.tsx` — lines 17 and 91
  2. `frontend/src/components/ScheduleForm.tsx` — lines 65, 74, 84, 92
  3. `frontend/src/components/ScheduleList.tsx` — line 135
  4. `frontend/src/components/TaskList.tsx` — line 33
  5. `frontend/src/components/AgentList.tsx` — line 1433 (the "host-server not reachable" panel)
- **Expected Result**: All five files show `bg-card` at the noted lines, no `bg-white` remaining.
- **Repeatable Unit Test**: Not applicable: these five lines are already covered by UAT-EDGE-001's repo-wide static regression guard (any regression here would already fail that test) — a second, narrower test would be redundant.
- [SKIP: user-directed — closing out] <!-- 2026-09-19 -->

---

## Known gaps (not covered by this UAT — out of scope per TASK-135's own Objective)

- `AgentList.tsx`'s hardcoded hex status/role-badge color maps (`STATUS_STYLES` and the `bg-[#...]`/`text-[#...]` arbitrary-value pill classes) and `LogTail.tsx`'s xterm terminal-theme colors are a separate, unfixed defect class (semantic colors needing real light+dark design, not a token swap) — explicitly excluded from TASK-135's scope per user confirmation during `/task-add`, and therefore not tested here. Flagged as a candidate for a future task.
- One pre-existing, unrelated bug was noticed incidentally during TASK-135's live verification (agent-rename input's `pattern` attribute throws a console error; `/api/agents/:id/diff` 500s for at least one agent) — not part of this sweep, not fixed, not tested here.
