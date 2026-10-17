---
id: UAT-0216
aliases: [UAT-0216]
title: "UAT: Warn, and offer a restart in the worktree, when adding a worktree to an agent whose window is live"
status: pending
task: TASK-0216
created: 2026-09-20
updated: 2026-09-20
---

# UAT-0216 — UAT: Warn, and offer a restart in the worktree, when adding a worktree to an agent whose window is live

implements::[[TASK-0216]]

> **Source task**: [[TASK-0216]]
> **Generated**: 2026-09-20

---

## Prerequisites

- [ ] Dev servers running: `make dev` (host-server on port 8788, frontend on port 4321). Live UI cases use `http://localhost:4321/` (the Agents page is the `/` route). Viewport at least 768px wide. The tmux session is `conductor` (`SESSION_NAME` in `conductor.conf`).
- [ ] The host-server is running code that includes TASK-0209 (menu item, `inGitRepo`) and TASK-0213 (`agentPaneCwd` in `spawnAgentWindow`). It is launched without `--watch`, so a process started before those changes is stale: restart it (`make dev`) before the live cases. Without TASK-0213 a "restart" relaunches the window in the same directory, so a stale server makes UAT-INT-001 and UAT-INT-002 fail for a reason that is a prerequisite failure, not a TASK-0216 failure.
- [ ] Create the fixtures below. **Live cases must run on throwaway agents only. Never use "Create worktree", Restart, Stop or Destroy on a real agent.** Scratch paths are `./tmp/` (repo-local, gitignored).
  ```bash
  mkdir -p ./tmp/uat-0216-repo && cd ./tmp/uat-0216-repo && git init -q && git commit -q --allow-empty -m init && cd -
  ```
- [ ] Add two throwaway agents via the navbar `+ Add Agent` modal. Leave **Project** unselected (free-form path), keep the default launch command, enter the ABSOLUTE workdir `<repo root>/tmp/uat-0216-repo`, and leave "Use a git worktree" (Advanced) UNCHECKED, so neither has a worktree:
  - **L** `uat-rw-live`: used by the warn, notice, restart and window-gone cases. Keeps its window.
  - **N** `uat-rw-nowin`: used by the no-window case (UAT-INT-002). Its window is stopped there.
- [ ] Confirm both agents show in the sidebar with `windowPresent: true` (`curl -sS 'http://localhost:8788/api/status' | jq '.agents[] | select(.name | startswith("uat-rw-")) | {id, name, windowPresent, worktreePath}'`). Note each agent's numeric `id` (`<L id>`, `<N id>`). With no project selected the tmux window name equals the agent name.
- [ ] Cleanup after the run: Destroy both `uat-rw-*` agents from their actions menus, then `git worktree prune` and delete `./tmp/uat-0216-repo` and `./tmp/uat-0216-repo-worktrees` (the worktree lands at `<repo>-worktrees/<agentId>`).

Source under test:
- `frontend/src/lib/api.ts`: `restartAgentWindow(agentId)` (`DELETE` then `POST` on `${API_BASE}/agents/:id/window`; staged message `Window stopped but relaunch failed: …` when the second call fails).
- `frontend/src/components/AgentList.tsx` `AgentDetailView`: `requestCreateWorktree()` (live `agent.windowPresent` → `confirmingWorktree` dialog, else `handleCreateWorktree()`), both entry points (`create-worktree` menu item and the Details-tab button) call it; `worktreeNeedsRestart` notice (`role="status"`, amber) with the **Restart in worktree** button; restart `ConfirmDialog` (`confirmLabel="Restart"`, extra sentence when status is `busy`/`awaiting`/`stalled`); `doRestartInWorktree()` (does not call `onClose`); `restartError` joins the shared red banner; the notice self-clears when `agent.windowPresent` goes false.
- `host-server/index.ts`: `DELETE /api/agents/:id/window` (kill-window, removes the state file) and `POST /api/agents/:id/window` (respawns via `spawnAgentWindow`, pane cwd = `agentPaneCwd`, i.e. the worktree when set). `GET /api/agents/:id/diff` diffs `worktreePath || workdir`.

Coverage note: the EDGE cases are unit-backed (jsdom / vitest) and are scoped with `-t` name filters, so they depend on no live fixture agent and no host-server. The UI/INT cases are live and human-judged: real tmux pane cwd, real browser layout and theme rendering. The TASK-0216 `[DEFERRED-TO-UAT]` step (create a worktree on a running agent, confirm the warning, restart in worktree, `pane_current_path` shows the worktree, Diff tab reflects later edits) is UAT-INT-001.

Known unrelated failures at generation time (from concurrent sessions, NOT TASK-0216 regressions): `AgentList.test.tsx` has an unrelated failing TASK-154 "activeTask row" test; `npm run typecheck` reports errors around `BackgroundProcessesTab` / `onBgRestarted`; lint reports unused `firstLinePreview` / `lastPayload` in `AgentList.tsx`. The commands below are scoped to TASK-0216's own tests with `-t` filters and are unaffected. Do not run the full `AgentList.test.tsx`, `npm run typecheck` or `npm run lint` as evidence for this UAT.

---

## Test Cases

### UAT-UI-001: A live agent shows the warning before a worktree is created, and cancelling creates nothing
- **Page**: `http://localhost:4321/`, agent `uat-rw-live` (L) selected in the sidebar
- **Description**: On an agent whose window is running, "Create worktree" from the actions menu opens a confirmation first that says the running agent will not move. Cancelling must leave the agent unchanged (no worktree, no branch, no request).
- **Steps**:
  1. Open the Agents page, click `uat-rw-live`, and open the devtools Network tab (clear it).
  2. Click the kebab button (`Agent actions`, top right of the detail header), then click `Create worktree`.
  3. Read the dialog. Do not confirm it.
  4. Click `Cancel`.
  5. In a terminal: `git -C ./tmp/uat-0216-repo worktree list` and `curl -sS 'http://localhost:8788/api/status' | jq '.agents[] | select(.name == "uat-rw-live") | {branch, worktreePath}'`.
- **Expected Result**:
  - Step 2: a confirmation dialog opens (the menu closes). The message reads: `uat-rw-live is running in <repo root>/tmp/uat-0216-repo. A new worktree will not move the running agent; it keeps editing that directory until its window is restarted. Create the worktree anyway?` The buttons are `Cancel` and `Create worktree`. No `POST …/worktree` request is in the Network tab yet.
  - Step 4: the dialog closes; still no `POST …/worktree` request, no `⎇ conductor/…` badge in the header, no amber notice.
  - Step 5: `git worktree list` lists only the main repo; the status JSON is `{"branch": null, "worktreePath": null}`.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (UAT-EDGE-001 covers the dialog logic in jsdom; written by the TASK-0216 tackle, no new file written by this generation run). The live case checks real wording, real network and real git.
- [FAIL: auto-judge: prerequisite not satisfied — throwaway fixture agents uat-rw-live/uat-rw-nowin not created (live conductor DB and host-server restart forbidden this run); UI test also requires human verification — use /uat-walk] <!-- 2026-09-20 -->

---

### UAT-UI-002: Confirming creates the worktree and leaves a persistent notice with a Restart in worktree button
- **Page**: `http://localhost:4321/`, agent `uat-rw-live` (L) selected
- **Description**: After the warn-first confirmation, the worktree is created and an amber notice states the agent is still running in the old directory. The notice persists while the user moves between tabs, and does not disappear on its own.
- **Steps**:
  1. Open the kebab menu, click `Create worktree`, then click the dialog's `Create worktree` button.
  2. Observe the header and the area under the header (above the tab content).
  3. Switch tabs: Details, Diff (if present), back to Terminal.
  4. Reload the page (F5), re-select `uat-rw-live`.
- **Expected Result**:
  - Step 2: within a few seconds the header shows the badge `⎇ conductor/<L id>`, and a notice (amber/warning tone) reads `Worktree created, but uat-rw-live is still running in <repo root>/tmp/uat-0216-repo. Restart its window to work inside <repo root>/tmp/uat-0216-repo-worktrees/<L id>.` with a `Restart in worktree` button on it. No red error banner.
  - Step 3: the notice stays visible on every tab.
  - Step 4 (informational, not a failure either way): the notice is component state, so it is expected to be gone after a reload. Record whether it reappears. The pane is still in the old directory in that case (see UAT-INT-001 step 2); note this if the notice is absent, since the persistent-notice promise then covers only the current view.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (UAT-EDGE-002 covers the notice contents in jsdom). Live layout, tab persistence and reload behaviour are browser-only.
- [FAIL: auto-judge: prerequisite not satisfied — throwaway fixture agents uat-rw-live/uat-rw-nowin not created (live conductor DB and host-server restart forbidden this run); UI test also requires human verification — use /uat-walk] <!-- 2026-09-20 -->

---

### UAT-UI-003: The restart confirmation states what is lost, adds a busy warning, and cancelling leaves the window untouched
- **Page**: `http://localhost:4321/`, agent `uat-rw-live` (L) selected, notice from UAT-UI-002 visible
- **Description**: Restart is destructive (process and conversation context are lost), so it needs its own confirmation with plain wording. A busy/awaiting/stalled agent gets a stronger line. Cancel must not touch tmux.
- **Steps**:
  1. Record the window's pane PID: `tmux display -p -t 'conductor:=uat-rw-live' '#{pane_pid}'`.
  2. On the notice, click `Restart in worktree`. Read the dialog. Do not confirm.
  3. Click `Cancel`. Re-run the command from step 1.
  4. Make the agent busy: click into the Terminal tab and send it a prompt that takes a while (for example `count slowly from 1 to 200, one number per line`). While its badge reads `busy`, click `Restart in worktree` again and read the dialog. Click `Cancel`.
- **Expected Result**:
  - Step 2: a dialog reads `Restart "uat-rw-live" in its worktree? This stops the running agent process and relaunches it; in-flight work and conversation context are lost.` with buttons `Cancel` and `Restart`. For an idle agent there is no second sentence.
  - Step 3: the dialog closes, the notice remains, and the pane PID is unchanged (the window was not restarted).
  - Step 4: the same message plus `uat-rw-live is currently busy: restarting now will interrupt what it is doing.` Cancelling leaves the agent running. (An `awaiting` agent reads `is currently waiting for input` and a `stalled` agent `is currently stalled`; no unit test covers those two wordings, so note whether you could trigger either. Not required for a pass.)
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (UAT-EDGE-004 and UAT-EDGE-005 cover the dialog text in jsdom for busy and idle). The unchanged-PID assertion and real busy state need live tmux.
- [FAIL: auto-judge: prerequisite not satisfied — throwaway fixture agents uat-rw-live/uat-rw-nowin not created (live conductor DB and host-server restart forbidden this run); UI test also requires human verification — use /uat-walk] <!-- 2026-09-20 -->

---

### UAT-INT-001: Restart in worktree relaunches the pane inside the worktree, keeps the view selected, and the Diff tab follows the agent's edits
- **Scenario**: This is the TASK-0216 `[DEFERRED-TO-UAT]` step, end to end: the hazard exists before the restart (the pane is still in the shared workdir), and the restart fixes it (the pane is in the worktree), without deselecting the agent.
- **Steps**:
  1. Continue on `uat-rw-live` (L) with the notice showing (UAT-UI-002). Let the agent be idle (wait for the badge to read `idle`).
  2. BEFORE restarting, run the first command below.
  3. Click `Restart in worktree`, then click `Restart` in the dialog. Watch the detail pane and the sidebar for up to ~15 seconds.
  4. Run the first command again. Then run the second command below.
  5. When the agent is idle again (fresh `SessionStart`), in the Terminal tab type `! touch uat-0216-agent-edit.txt` and press Enter (Claude Code bash mode runs in the agent's cwd). If the agent is stuck on a trust/permission prompt, answer it first.
  6. Open the `Diff` tab (or reload it) and, in a terminal, run the third command below.
- **Command**:
  ```bash
  tmux display -p -t 'conductor:=uat-rw-live' '#{pane_current_path}'
  ```
  ```bash
  curl -sS 'http://localhost:8788/api/status' | jq '.agents[] | select(.name == "uat-rw-live") | {windowPresent, branch, worktreePath}'
  ```
  ```bash
  git -C ./tmp/uat-0216-repo-worktrees/<L id> status --short
  ```
- **Expected Result**:
  - Step 2: prints `<repo root>/tmp/uat-0216-repo` (the shared workdir). This proves the hazard the warning describes.
  - Step 3: the dialog closes, the button reads `Restarting…` briefly, then the amber notice disappears. The agent stays selected and its detail view stays open (it is NOT deselected, unlike Stop). No red banner. The sidebar row briefly shows no-window/starting and returns to `idle`.
  - Step 4: the first command prints `<repo root>/tmp/uat-0216-repo-worktrees/<L id>` (the worktree). The status JSON is `{"windowPresent": true, "branch": "conductor/<L id>", "worktreePath": "<repo root>/tmp/uat-0216-repo-worktrees/<L id>"}`. The pane PID from UAT-UI-003 step 1 has changed.
  - Step 6: `git status --short` prints `?? uat-0216-agent-edit.txt` (the agent's file landed in the worktree, not the shared workdir; `git -C ./tmp/uat-0216-repo status --short` prints nothing for it), and the Diff tab shows the change (an untracked file may not appear in `git diff <base>`; if the tab stays empty, edit a tracked file instead: `! echo x >> f.txt` after committing `f.txt` in the worktree, and record which was used). If the agent cannot be driven, fall back to a manual edit inside the worktree directory and mark the Diff assertion as weaker evidence (it then proves only the `worktreePath || workdir` diff target, not the agent's cwd).
- **Repeatable Unit Test**: Not applicable: real tmux pane cwd, process relaunch and the running Claude Code CLI. The API helper sequence is covered by UAT-EDGE-009 to UAT-EDGE-011 and the dialog/state logic by UAT-EDGE-004.
- [FAIL: auto-judge: prerequisite not satisfied — needs live fixture agent uat-rw-live plus a restarted host-server with TASK-0213 (agent creation in live DB and host-server restart forbidden this run); command depends on unresolved <L id>] <!-- 2026-09-20 -->

---

### UAT-INT-002: An agent with no window gets no warning, no notice, and its next window lands in the worktree
- **Scenario**: For an agent whose window is not running, adding a worktree needs no warning: TASK-0213's `agentPaneCwd` makes the next window start in the worktree.
- **Steps**:
  1. Stop the window of `uat-rw-nowin` (N) without touching the UI: run the first command below. Wait for the sidebar to show it as no-window, then select `uat-rw-nowin`.
  2. Open the kebab menu and click `Create worktree`. Observe immediately.
  3. Observe the area under the header.
  4. In the Terminal tab click `Create window`. Wait for the agent to appear as running.
  5. Run the second command below.
- **Command**:
  ```bash
  curl -sS -X DELETE 'http://localhost:8788/api/agents/<N id>/window'
  ```
  ```bash
  tmux display -p -t 'conductor:=uat-rw-nowin' '#{pane_current_path}'
  ```
- **Expected Result**:
  - Step 1: the DELETE returns `{"ok":true,"closed":"uat-rw-nowin"}`.
  - Step 2: NO confirmation dialog appears; the worktree is created immediately and the header shows `⎇ conductor/<N id>` within a few seconds.
  - Step 3: NO amber notice (`role="status"`) and no red banner.
  - Step 5: prints `<repo root>/tmp/uat-0216-repo-worktrees/<N id>`.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (UAT-EDGE-003 covers the no-dialog / no-notice logic in jsdom). The pane-cwd assertion needs live tmux.
- [FAIL: auto-judge: prerequisite not satisfied — needs live fixture agent uat-rw-nowin plus a restarted host-server with TASK-0213 (agent creation in live DB and host-server restart forbidden this run); command depends on unresolved <N id>] <!-- 2026-09-20 -->

---

### UAT-INT-003: The notice clears when the agent's window disappears
- **Scenario**: If the window dies (or is stopped) while the notice is showing, "Restart in worktree" would fail with the DELETE's `agent window not present`; the notice must clear instead. The case needs a live agent with no worktree yet: `uat-rw-live` has one after UAT-INT-001, so add a third throwaway `uat-rw-gone` (same workdir, no worktree, default launch command) and destroy it in cleanup, or run this case before UAT-INT-001.
- **Steps**:
  1. Select the agent with a live window and no worktree. Kebab menu, `Create worktree`, confirm. Wait for the amber notice.
  2. Run the command below (it stops the window from outside the UI).
  3. Watch the detail view for up to ~10 seconds (the change arrives over SSE).
- **Command**:
  ```bash
  curl -sS -X DELETE 'http://localhost:8788/api/agents/<id>/window'
  ```
- **Expected Result**: The DELETE returns `{"ok":true,"closed":"<name>"}`. Within a few seconds the amber notice disappears without a click, the Terminal tab offers `Create window`, and no red error banner is shown.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (UAT-EDGE-007 covers the clear-on-window-gone logic in jsdom). The SSE-driven live version is the case above.
- [FAIL: auto-judge: prerequisite not satisfied — needs a live throwaway agent (creation in live DB forbidden this run); command depends on unresolved <id> and issues a destructive DELETE on a live window] <!-- 2026-09-20 -->

---

### UAT-UI-004: The notice and both dialogs are readable in light and dark themes
- **Page**: `http://localhost:4321/`, a live agent with the notice showing (UAT-UI-002 state)
- **Description**: The notice uses an amber tone on a tinted surface (`bg-accent-amber/5`, `text-accent-amber`, 11px text), which is a contrast risk in light theme. Both `ConfirmDialog`s must be legible too.
- **Steps**:
  1. With the notice showing, read it at 100% browser zoom in the current theme. In devtools inspect the notice text and read the contrast the Accessibility pane reports (or measure text colour against the tinted surface).
  2. Open the create-anyway dialog (on an agent with a live window and no worktree) and the restart dialog; read each.
  3. Click the theme toggle in the navbar and repeat steps 1 and 2.
  4. At a ~400px wide viewport, check the notice wraps (message on one line group, button below) and does not overflow horizontally.
- **Expected Result**: In both themes the notice text and button label read comfortably, and both dialogs' text and buttons are legible. Record the measured contrast per theme; the project's text-contrast bar is 4.5:1 (see UAT-140): a measurement below it is recorded as a finding for the reviewer, not silently accepted. At narrow width the notice wraps and the page has no horizontal scroll.
- **Repeatable Unit Test**: Not applicable: visual rendering, theme contrast and responsive layout are browser-only
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk; also prerequisite not satisfied (no live fixture agent)] <!-- 2026-09-20 -->

---

### UAT-EDGE-001: A live window gates creation behind the warning; cancel makes no call; confirm creates
- **Scenario**: `windowPresent: true` and a click on the menu's `Create worktree`: the warning dialog opens (text names the agent's `workdir`) and `createWorktreeForAgent` is not called; `Cancel` closes it with still no call; re-opening and confirming calls `createWorktreeForAgent(51)` exactly once and closes the dialog.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: The `live window: the menu item opens the warning first and creates nothing until confirmed` test passes (`Tests  1 passed`).
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`AgentDetailView worktree warn-first + restart (TASK-0216)`; written by the TASK-0216 tackle, no new file written by this generation run)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "live window: the menu item opens the warning"` — verified: 1 passed
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-002: Confirming creation shows the persistent notice naming the workdir and worktree, with a Restart in worktree button
- **Scenario**: After a confirmed create on a live agent, a `role="status"` notice contains `is still running in`, the original `/repo/main` workdir and the new `/repo/wt/52` worktree path, and a `Restart in worktree` button.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: The `confirming creation shows the persistent notice naming the workdir and worktree, with a Restart in worktree button` test passes (`Tests  1 passed`).
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (written by the TASK-0216 tackle, no new file written by this generation run)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "confirming creation shows the persistent notice"` — verified: 1 passed
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-003: No window: creation is immediate with no dialog and no notice
- **Scenario**: `windowPresent: false`: clicking the menu's `Create worktree` calls `createWorktreeForAgent(53)` at once, shows the `⎇ conductor/53` badge, and renders no dialog and no `role="status"` notice.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: The `no window: creation is immediate, with no dialog and no notice` test passes (`Tests  1 passed`).
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (written by the TASK-0216 tackle, no new file written by this generation run)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "no window: creation is immediate"` — verified: 1 passed
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-004: Restart in worktree confirms first (with the busy warning), calls restartAgentWindow once, clears the notice, and does not close the view
- **Scenario**: A `busy` live agent: `Restart in worktree` opens a dialog containing `stops the running agent process and relaunches it`, `conversation context are lost` and `is currently busy`; nothing is called until `Restart` is clicked; then `restartAgentWindow(55)` is called exactly once, the notice disappears and `onClose` is never called.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: The `Restart in worktree: confirm dialog (with the busy warning when working) then restartAgentWindow once, notice cleared, view stays selected` test passes (`Tests  1 passed`).
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (written by the TASK-0216 tackle, no new file written by this generation run)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "Restart in worktree: confirm dialog"` — verified: 1 passed
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-005: The restart confirmation omits the busy sentence for an idle agent
- **Scenario**: Idle agent: the restart dialog carries the base warning but no `is currently …` sentence.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: The `Restart confirmation omits the busy sentence for an idle agent` test passes (`Tests  1 passed`).
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (written by the TASK-0216 tackle, no new file written by this generation run)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "Restart confirmation omits the busy sentence"` — verified: 1 passed
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-006: A failed restart shows the message in the red banner and keeps the notice
- **Scenario**: `restartAgentWindow` rejects with `Window stopped but relaunch failed: spawn boom`: the message appears in the shared red banner (`text-accent-red`) and the amber notice stays, so the user can retry.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: The `a failed restart shows the message in the banner and keeps the notice` test passes (`Tests  1 passed`).
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (written by the TASK-0216 tackle, no new file written by this generation run)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "a failed restart shows the message in the banner"` — verified: 1 passed
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-007: The notice clears when the agent window disappears
- **Scenario**: With the notice showing, re-rendering the agent with `windowPresent: false` removes it (render-time state adjustment).
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: The `the notice clears when the agent window disappears` test passes (`Tests  1 passed`).
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (written by the TASK-0216 tackle, no new file written by this generation run)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "the notice clears when the agent window disappears"` — verified: 1 passed
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-008: The Details-tab Create worktree button follows the same warn-first path as the menu item
- **Scenario**: On the Details tab the inline `Create worktree` button opens the same warning dialog with no call made; confirming calls `createWorktreeForAgent(54)` and produces the notice. Both entry points share `requestCreateWorktree()`.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: The `the Details-tab button follows the same warn-first path as the menu item` test passes (`Tests  1 passed`).
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (written by the TASK-0216 tackle, no new file written by this generation run)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "the Details-tab button follows the same warn-first path"` — verified: 1 passed
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-009: restartAgentWindow issues DELETE then POST against the same window URL
- **Scenario**: `restartAgentWindow(5)` makes exactly two fetches, first `DELETE` then `POST`, both to `…/agents/5/window`.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: The `restartAgentWindow (TASK-0216) issues DELETE then POST against the same window URL` test passes (`Tests  1 passed`).
- **Repeatable Unit Test**: Created: `frontend/src/lib/api.test.ts` (`restartAgentWindow (TASK-0216)`; written by the TASK-0216 tackle, no new file written by this generation run)
- **Unit Test Command**: `cd frontend && npx vitest run src/lib/api.test.ts -t "issues DELETE then POST"` — verified: 1 passed
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-010: restartAgentWindow short-circuits when the DELETE fails
- **Scenario**: A non-OK DELETE (`{ error: 'kill failed' }`) rejects with `kill failed` and no POST is made (the window was not stopped, so nothing is relaunched).
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: The `short-circuits when DELETE fails (no POST)` test passes (`Tests  1 passed`).
- **Repeatable Unit Test**: Created: `frontend/src/lib/api.test.ts` (written by the TASK-0216 tackle, no new file written by this generation run)
- **Unit Test Command**: `cd frontend && npx vitest run src/lib/api.test.ts -t "short-circuits when DELETE fails"` — verified: 1 passed
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-011: restartAgentWindow surfaces a staged message when the relaunch POST fails
- **Scenario**: DELETE succeeds, POST returns `{ error: 'spawn failed' }`: the helper rejects with `Window stopped but relaunch failed: spawn failed`, so the user knows the window is now stopped.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: The `surfaces a staged message when the relaunch POST fails` test passes (`Tests  1 passed`).
- **Repeatable Unit Test**: Created: `frontend/src/lib/api.test.ts` (written by the TASK-0216 tackle, no new file written by this generation run)
- **Unit Test Command**: `cd frontend && npx vitest run src/lib/api.test.ts -t "surfaces a staged message"` — verified: 1 passed
- [x] Pass <!-- 2026-09-20 -->
