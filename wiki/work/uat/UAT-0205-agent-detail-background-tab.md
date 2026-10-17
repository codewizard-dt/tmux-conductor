---
id: UAT-0205
aliases: [UAT-0205]
title: "UAT: Add a Background tab to the agent detail tablist listing the agent's project's bg processes with a running/exited badge and live output tail"
status: pending
task: TASK-0205
created: 2026-09-20
updated: 2026-09-20
---

# UAT-0205 — UAT: Add a Background tab to the agent detail tablist listing the agent's project's bg processes with a running/exited badge and live output tail

implements::[[TASK-0205]]

> **Source task**: [[TASK-0205]]
> **Generated**: 2026-09-20

Verifies the new `Background (N)` tab in `AgentDetailView` (`frontend/src/components/AgentList.tsx`), its body `frontend/src/components/BackgroundProcessesTab.tsx` (including the `useBgTail` polling hook), the presentational `frontend/src/components/BgLivenessBadge.tsx`, and the `BgProcessRow` tile-badge swap.

Cases UAT-UI-001 .. UAT-UI-010, UAT-EDGE-001 .. UAT-EDGE-003 and UAT-GATE-001 .. UAT-GATE-002 are **machine-executable** (file-scoped vitest / tsc / eslint from `frontend/`) and need no running server. Cases UAT-MAN-001 .. UAT-MAN-003 are **Manual** live-browser checks for what jsdom cannot show (real scrolling, both themes, real crash detection, network-panel polling); they run only against an **isolated scratch stack** (see Prerequisites) and must never touch the real `dev`/`dev-stack` bg processes or real projects. The live recipe TASK-0205 marked `[DEFERRED-TO-UAT]` is covered by UAT-MAN-001 .. UAT-MAN-003; TASK-0208's UAT owns the end-to-end walk on the real stack.

---

## Prerequisites

- [ ] Working directory for the machine-executable cases is `frontend/` (`cd /Users/davidtaylor/Repositories/tmux-conductor/frontend`); dependencies installed (`node_modules` present).
- [ ] Manual cases only (UAT-MAN-*): an isolated scratch stack, never the real one:
  1. `mkdir -p tmp/uat-0205` at the repo root and copy `conductor.conf` to `tmp/uat-0205/conductor.conf`; in the copy set `SESSION_NAME="conductor-uat0205"`, `DB_PATH="./data/conductor.db"`, `LOG_DIR="./logs"`, `STATE_DIR="./logs/state"` (these resolve relative to the copy's directory, so the scratch DB, logs and state land under `tmp/uat-0205/`).
  2. Start the scratch host-server: `CONDUCTOR_CONF=$PWD/tmp/uat-0205/conductor.conf BACKEND_PORT=8799 npx tsx host-server/index.ts` (from the repo root; adjust to however `make dev` launches the host-server if it differs).
  3. Start a scratch frontend: `cd frontend && FRONTEND_PORT=4399 PROXY_TARGET=http://localhost:8799 npx vite`.
  4. **Gate**: `curl -sS 'http://localhost:8799/api/status' | jq '.bgProcesses'` must respond (a `[]` on the fresh scratch DB is fine); if it fails or port 8799 is unreachable, mark every UAT-MAN case blocked. If a bg process later shows no `liveness` key in this payload, the scratch server is a stale build: restart it before judging any badge case.
  5. In the scratch dashboard (`http://localhost:4399`) create one project `uat0205`, one agent in it, one bg process in it named `crashy` running `sh -c 'for i in $(seq 1 300); do echo "line $i"; sleep 1; done'`, and a second agent with no project if the UI still allows one (skip the no-project step if TASK-0195 makes that impossible).
- [ ] Cleanup after the manual cases: stop both scratch processes and `kill-session -t conductor-uat0205`; leave `tmp/uat-0205/` in place (gitignored) or delete it.

---

## Test Cases

### UAT-UI-001: BgLivenessBadge renders each liveness as visible text and falls back to windowPresent
- **Page**: component `frontend/src/components/BgLivenessBadge.tsx`
- **Description**: `running` / `exited` / `stopped` each render their own visible label with a matching `data-liveness`; an explicit `liveness` overrides `windowPresent`; with `liveness` undefined the badge shows `running` when the window is present and `stopped` when it is absent (older host-server without the field).
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: all `BgLivenessBadge (TASK-0205)` tests pass.
- **Repeatable Unit Test**: Created: `frontend/src/components/BgLivenessBadge.test.tsx`
- **Unit Test Command**: `cd frontend && npx vitest run src/components/BgLivenessBadge.test.tsx`
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk (unit test green: 6/6)] <!-- 2026-09-20 -->

### UAT-UI-002: Background tab is present with a project-bg count for an agent that has a project
- **Page**: Agents page, agent detail pane, tablist (`AgentInfoTabs`)
- **Description**: For an agent whose `projectId` is set, the tablist contains a tab labelled `Background (N)` where N is the count of that project's bg processes (here 2 of the 3 bgs in state).
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: the test `shows a "Background (N)" tab counting the agent's project bg processes` passes.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (describe `AgentList Background tab (TASK-0205)`)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "Background tab"`
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-09-20 -->

### UAT-UI-003: Only the selected agent's own project's bg processes are listed, each with a liveness badge, exited preselected
- **Page**: Agents page, agent detail pane, Background tab
- **Description**: With bg processes belonging to two projects, the tab lists only the agent's project's processes, each row showing slug, badge (`running` / `exited`) and launch command; the `exited` process is preselected (`aria-pressed="true"`) and its output is requested via `bgTail(slug, 200)`; the other project's process is never listed or requested.
- **Steps**:
  1. Run the unit test command from UAT-UI-002 (same file).
- **Expected Result**: the test `lists only the selected agent's own project bgs (with liveness badges) when two projects have processes` passes.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx`
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "Background tab"`
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-09-20 -->

### UAT-UI-004: Tab body lists the passed bgs, defaults to the first (or first exited) process
- **Page**: component `frontend/src/components/BackgroundProcessesTab.tsx`
- **Description**: Rows show slug, badge and launch command (full command in `title`); default selection is the first process, but an `exited` process wins; clicking another row changes the selection and the requested slug (`bgTail(<slug>, 200)`), and the previous process's output is no longer shown.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: tests `lists only the passed bgs, ...`, `selects the first process by default`, `prefers an exited process for the default selection`, `switches the requested slug when another row is clicked` pass.
- **Repeatable Unit Test**: Created: `frontend/src/components/BackgroundProcessesTab.test.tsx`
- **Unit Test Command**: `cd frontend && npx vitest run src/components/BackgroundProcessesTab.test.tsx`
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-09-20 -->

### UAT-UI-005: Output polling is gated on the tab being active (2 s cadence, immediate on activation)
- **Page**: Agents page, agent detail pane, Background tab
- **Description**: `AgentInfoTabs` keeps every present tab mounted, so the tail must not be polled while another tab is showing. No `bgTail` request while `active` is false (component level) or while the Background tab is not the active tab (integration level); the first request fires immediately on activation, then every 2 s (not before 1.9 s).
- **Steps**:
  1. Run the two commands below (component, then integration).
- **Expected Result**: `does not poll while inactive, and starts immediately when flipped active` and `polls again every 2 seconds` pass; in `AgentList.test.tsx`, `does not poll the output until the Background tab is the active one` passes.
- **Repeatable Unit Test**: Created: `frontend/src/components/BackgroundProcessesTab.test.tsx`, `frontend/src/components/AgentList.test.tsx`
- **Unit Test Command**: `cd frontend && npx vitest run src/components/BackgroundProcessesTab.test.tsx src/components/AgentList.test.tsx -t "polling|poll"`
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-09-20 -->

### UAT-UI-006: Polling stops on tab deactivation and on unmount; in-flight guard prevents overlapping requests
- **Page**: component `BackgroundProcessesTab` / `useBgTail`
- **Description**: After deactivation or unmount no further requests are issued; while a request is unresolved, subsequent 2 s ticks are skipped (max one request in flight) and polling resumes after it settles.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: tests `stops polling on unmount`, `stops polling when the tab is deactivated`, `does not issue a second request while one is still in flight` pass.
- **Repeatable Unit Test**: Created: `frontend/src/components/BackgroundProcessesTab.test.tsx`
- **Unit Test Command**: `cd frontend && npx vitest run src/components/BackgroundProcessesTab.test.tsx`
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-09-20 -->

### UAT-UI-007: Polling pauses while the document is hidden and resumes on visibility
- **Page**: component `BackgroundProcessesTab` / `useBgTail`
- **Description**: The task requires polling only while `active && selectedBg && !document.hidden`. With `document.hidden === true` no request is made even across many 2 s ticks; when the document becomes visible (`visibilitychange`) a request fires immediately.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: test `does not poll while the document is hidden, and resumes when it becomes visible` passes.
- **Repeatable Unit Test**: Created: `frontend/src/components/BackgroundProcessesTab.test.tsx` (test added by this UAT)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/BackgroundProcessesTab.test.tsx -t "document is hidden"`
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-09-20 -->

### UAT-UI-008: Selection is kept by slug across live updates and reset if the selected process disappears
- **Page**: component `BackgroundProcessesTab`
- **Description**: When the `bgs` prop changes (SSE `bg-update`), a selected process stays selected by slug even if list order/liveness changes; when the selected process is removed (`bg-removed`), selection falls back to the default and polling switches to the new slug.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: tests `keeps the selection by slug across live updates to the bgs list` and `resets the selection to the default when the selected process disappears` pass.
- **Repeatable Unit Test**: Created: `frontend/src/components/BackgroundProcessesTab.test.tsx` (tests added by this UAT)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/BackgroundProcessesTab.test.tsx -t "selection"`
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-09-20 -->

### UAT-UI-009: Restart marker lines are styled as dividers and the truncation hint shows only when truncated
- **Page**: component `BackgroundProcessesTab` output panel
- **Description**: `--- restart <ts> ---` lines render with `data-restart-marker="true"` (divider style) while normal lines do not; `Output truncated to last N lines` appears only when the tail's `truncated` flag is true.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: tests `styles restart marker lines distinctly from normal output` and `shows the truncation hint only when the tail is truncated` pass.
- **Repeatable Unit Test**: Created: `frontend/src/components/BackgroundProcessesTab.test.tsx`
- **Unit Test Command**: `cd frontend && npx vitest run src/components/BackgroundProcessesTab.test.tsx -t "restart marker|truncation hint"`
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-09-20 -->

### UAT-UI-010: The bg tile badge (BgProcessRow) reports real liveness, not window presence
- **Page**: Agents page, no agent selected (`BgProcessSection` tile)
- **Description**: A bg process with `windowPresent: true` and `liveness: 'exited'` shows `exited` on the tile (via `BgLivenessBadge`, `data-liveness="exited"`); no `running` badge and the old `window missing` label is gone.
- **Steps**:
  1. Run the unit test command from UAT-UI-002.
- **Expected Result**: test `the tile badge (BgProcessRow) shows "exited" for liveness "exited" even though the tmux window exists` passes.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx`
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "tile badge"`
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-09-20 -->

### UAT-EDGE-001: Tab is hidden entirely for an agent with no project, and the tablist keeps working
- **Scenario**: Agent with `projectId: null`. Only "no project" hides the tab (no disabled tab); `AgentInfoTabs` must not break, other tabs stay switchable, and no tail request is ever made.
- **Steps**: Run the unit test command below.
- **Expected Result**: test `omits the Background tab for an agent with no project, and the tablist still works` passes.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx`
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "omits the Background tab"`
- [x] Pass <!-- 2026-09-20 -->

### UAT-EDGE-002: Project with no bg processes keeps the tab and shows the empty state without polling
- **Scenario**: Agent's project owns zero bg processes. The tab stays present as `Background (0)` and shows `No background processes in <project>. Add one from the navbar.`; no `bgTail` request is ever issued.
- **Steps**: Run the unit test command below (integration test plus component-level test).
- **Expected Result**: `keeps the tab present with an empty state when the project has no bg processes` (AgentList.test.tsx) and `shows the empty state and never polls when the project has no bg processes` (BackgroundProcessesTab.test.tsx) pass.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx`, `frontend/src/components/BackgroundProcessesTab.test.tsx`
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx src/components/BackgroundProcessesTab.test.tsx -t "keeps the tab present with an empty state|shows the empty state and never polls"`
- [x] Pass <!-- 2026-09-20 -->

### UAT-EDGE-003: Tail request failure shows an inline error with Retry; late results after deactivation are ignored
- **Scenario**: `bgTail` rejects (e.g. HTTP 500): the panel shows `Could not load output` with a `Retry` button, Retry issues another request and clears the error on success. Separately, a request that resolves after the tab was deactivated must not update the UI.
- **Steps**: Run the unit test command below.
- **Expected Result**: tests `shows an error with Retry, and Retry triggers another request` and `ignores a late result that resolves after the tab was deactivated` pass.
- **Repeatable Unit Test**: Created: `frontend/src/components/BackgroundProcessesTab.test.tsx`
- **Unit Test Command**: `cd frontend && npx vitest run src/components/BackgroundProcessesTab.test.tsx -t "Retry|late result"`
- [x] Pass <!-- 2026-09-20 -->

### UAT-GATE-001: Frontend typecheck is clean
- **Description**: `BgProcess` / `AgentDetailViewProps` changes (required `projectBgs` prop) compile everywhere, including the 21 direct `<AgentDetailView>` renders in tests.
- **Steps**: Run the command below.
- **Command**:
  ```bash
  cd frontend && npx tsc --noEmit
  ```
- **Expected Result**: exit code 0, no diagnostics printed.
- **Repeatable Unit Test**: Not applicable: this case is itself a deterministic static gate.
- [FAIL: auto-judge: tsc exit 2, expected 0 — src/lib/lastPayload.ts(166,39) TS2322 string|undefined not assignable to string (untracked file from another in-flight task, not a TASK-0205 file)] <!-- 2026-09-20 -->

### UAT-GATE-002: ESLint is clean on the new and edited files, and the touched components' test files are green
- **Description**: No lint regressions in the touched files, and the `projectBgs` prop / `window missing` -> `stopped` label change did not break the sibling tests in the three files this task owns. Scoped to those files on purpose: the whole frontend suite also runs other in-flight tasks' tests (for example `AddBgProcessForm.test.tsx`, being edited concurrently by another task) whose failures are not attributable to TASK-0205.
- **Steps**: Run the command below.
- **Command**:
  ```bash
  cd frontend && npx eslint src/components/BgLivenessBadge.tsx src/components/BgLivenessBadge.test.tsx src/components/BackgroundProcessesTab.tsx src/components/BackgroundProcessesTab.test.tsx src/components/AgentList.tsx src/components/AgentList.test.tsx && npx vitest run src/components/AgentList.test.tsx src/components/BackgroundProcessesTab.test.tsx src/components/BgLivenessBadge.test.tsx
  ```
- **Expected Result**: eslint prints nothing; vitest reports 3 passed test files and 0 failures (207 tests at generation time).
- **Repeatable Unit Test**: Not applicable: this case is itself a deterministic static gate.
- [x] Pass <!-- 2026-09-20 -->

### UAT-MAN-001: Live Background tab shows clean, auto-scrolling output and real liveness badge (scratch stack only)
- **Manual**: requires the isolated scratch stack from Prerequisites (gate passed, `liveness` present in `/api/status`). Never run against the real `dev`/`dev-stack` processes.
- **Page**: `http://localhost:4399` (scratch dashboard), Agents page
- **Steps**:
  1. Select the scratch agent in project `uat0205`; confirm the tablist shows `Background (1)` after `Queued tasks` and before any `Diff`/`Usage`/`Checkpoints` tabs.
  2. Open the Background tab. Confirm the `crashy` row shows a `running` badge and its launch command (full command in the hover title), and the output region (`Output of uat0205-crashy`) shows `line N` lines with no escape sequences, newest at the bottom, updating about every 2 s with an `updated ...` label.
  3. Scroll the output up a few lines; confirm it stops following new lines. Scroll back to the bottom; confirm it follows again.
  4. Switch to another tab and open the browser network panel: confirm no `/bg-processes/.../tail` requests while the other tab is active. Return to Background: requests resume immediately, then every ~2 s.
- **Expected Result**: all four observations hold; badge text (not just colour) reads `running`.
- **Repeatable Unit Test**: Not applicable: real scrolling, layout and network behaviour are not observable in jsdom (the request gating itself is covered by UAT-UI-005 .. UAT-UI-007).
- [FAIL: auto-judge: manual/UI test requires human verification — needs isolated scratch stack (:8799/:4399)] <!-- 2026-09-20 -->

### UAT-MAN-002: Crashing a bg process flips the badge to exited and the reason stays visible (scratch stack only)
- **Manual**: same scratch stack and gate as UAT-MAN-001.
- **Page**: `http://localhost:4399`, Background tab of the scratch agent
- **Steps**:
  1. With `crashy` selected and running, attach to the scratch tmux window (`tmux attach -t conductor-uat0205`, window `crashy`) and press `C-c` so the process dies back to a shell prompt (the window still exists).
  2. Watch the Background tab (and the tile view with no agent selected) within a few seconds.
- **Expected Result**: the `crashy` badge changes from `running` to `exited` on both the tab row and the tile although the tmux window still exists; the output panel still shows the last log lines (including the interrupted output); no `window missing` text anywhere.
- **Repeatable Unit Test**: Not applicable: needs a real tmux window and the host-server's real liveness detection (payload rendering is covered by UAT-UI-003 and UAT-UI-010; detection is TASK-0191's UAT-0191).
- [FAIL: auto-judge: manual/UI test requires human verification — needs isolated scratch stack and real tmux window] <!-- 2026-09-20 -->

### UAT-MAN-003: Badge and tab are legible in both themes and the tab is absent for a project-less agent (scratch stack only)
- **Manual**: same scratch stack and gate as UAT-MAN-001.
- **Page**: `http://localhost:4399`, Background tab
- **Steps**:
  1. In light theme, view badges for a `running` process and (after UAT-MAN-002) an `exited` one; then switch to dark theme and view them again. If a stopped state is easy to produce (kill the scratch tmux window with `tmux kill-window -t conductor-uat0205:crashy`), check the `stopped` badge too.
  2. Tab through the process rows with the keyboard; confirm each row is a focusable button with a visible focus ring, and pressing Enter/Space selects it (`aria-pressed`).
  3. If a project-less agent could be created on the scratch stack, select it and confirm no `Background` tab exists and the remaining tabs still switch.
- **Expected Result**: `running` (green), `exited` (red), `stopped` (amber) labels are readable against their tinted backgrounds in both themes; keyboard selection works; the tab is absent for an agent with no project (or step 3 is recorded as not producible and covered by UAT-EDGE-001).
- **Repeatable Unit Test**: Not applicable: colour contrast and focus rings are visual (the label/data-liveness output is covered by UAT-UI-001).
- [FAIL: auto-judge: manual/UI test requires human verification — visual contrast, focus rings, both themes] <!-- 2026-09-20 -->

---

## Gaps and notes

- Stick-to-bottom auto-scroll, the `updated <relative time>` label ticking, and the "only re-render when the tail changed" optimisation have no jsdom-observable assertion (no layout engine; render counting would test implementation). Auto-scroll is verified manually in UAT-MAN-001.
- `BackgroundProcessesTab` uses `aria-pressed` on the row buttons where the task text allowed `aria-current`/`aria-pressed`; the tests encode `aria-pressed`.
- The task's `bgKey(bg)` helper was not created (everything keys on `bg.slug`, per the recorded Step 1 note); the task text allowed this and no test depends on it.
- Live end-to-end verification on the real stack remains owned by TASK-0208's UAT; the manual cases here run only on a scratch stack.
- Tests added by this UAT (not in the implementer's original set): the document-hidden test (UAT-UI-007) and the two selection tests (UAT-UI-008), all in `frontend/src/components/BackgroundProcessesTab.test.tsx`.
