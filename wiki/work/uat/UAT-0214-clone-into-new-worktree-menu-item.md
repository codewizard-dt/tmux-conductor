---
id: UAT-0214
aliases: [UAT-0214]
title: "UAT: Add a Clone into new worktree item to the agent actions menu on every agent"
status: pending
task: TASK-0214
created: 2026-09-20
updated: 2026-09-20
---

# UAT-0214 — UAT: Add a Clone into new worktree item to the agent actions menu on every agent

implements::[[TASK-0214]]

> **Source task**: [[TASK-0214]]
> **Generated**: 2026-09-20

---

## Prerequisites

- [ ] **Unit-backed cases (UAT-EDGE-001 to UAT-EDGE-010) need only** the repo checkout and `frontend/node_modules`. They render components in jsdom with `cloneAgent` mocked, so they need NO dev servers and NO fixture agents. Run them from `frontend/`. Every command is scoped with a vitest `-t` name filter (a regex matched against `describe > it` names), so an unrelated test failing elsewhere in `AgentList.test.tsx` does not affect the verdict.
- [ ] **Live cases (UAT-UI-001 to UAT-UI-003) additionally need** dev servers running: `make dev` (host-server on port 8788, frontend on port 4321). The Agents page is the `/` route (`frontend/src/App.tsx`). Viewport at least 768px wide. The host-server is launched without `--watch`, so it must have been (re)started AFTER TASK-0213 (`forceWorktree` on `POST /api/agents/:id/clone`) and TASK-0215 (`worktreePath`/`branch` in the new-clone `agent-update`) landed; a stale process is a prerequisite failure, not a test failure. Restart it with `make dev` first.
- [ ] Create the fixtures below for the live cases. **Live cases must use throwaway agents only. Never use Clone, Clone into new worktree, Stop or Destroy on a real agent.** Scratch paths are `./tmp/` (repo-local, gitignored).
  ```bash
  mkdir -p ./tmp/uat-0214-repo && cd ./tmp/uat-0214-repo && git init -q -b main && git commit -q --allow-empty -m init && cd -
  ```
- [ ] Add two throwaway agents via the navbar `+ Add Agent` modal. Leave **Project** unselected (free-form path), keep the default launch command, and enter the ABSOLUTE workdir `<repo root>/tmp/uat-0214-repo` for both:
  - **A** `uat-cwt-plain`: "Use a git worktree" (Advanced) UNCHECKED, so it has no worktree and no branch.
  - **C** `uat-cwt-has`: "Use a git worktree" CHECKED, so it starts with branch `conductor/<C's id>`.
- [ ] Confirm both agents show in the sidebar and `GET http://localhost:8788/api/status` lists them with `windowPresent: true`. Note each agent's numeric `id`.
- [ ] Cleanup after the run: Destroy every `uat-cwt-*` agent (originals and clones) from their actions menus (TASK-0217 removes a clone's worktree and branch on delete), then `git -C ./tmp/uat-0214-repo worktree prune`, `git -C ./tmp/uat-0214-repo branch --list 'conductor/*'` (delete any leftovers with `branch -D`), and finally remove `./tmp/uat-0214-repo` and `./tmp/uat-0214-repo-worktrees`.

Source under test:
- `frontend/src/components/AgentList.tsx` `AgentDetailView`: `handleClone(opts?: { forceWorktree?: boolean })` (calls `cloneAgent(agent.id, opts)` when `opts` is given, `cloneAgent(agent.id)` otherwise; shares the `cloning` guard, `cloneError` banner and `onCloned(cloned.id)`), and the `agentActionItems` entry `clone-into-worktree` immediately after `clone` (label `Clone into new worktree` / `Cloning…`, `disabled: cloning || agent.inGitRepo === false`, tooltip, and description `Workdir is not inside a git repository` when `inGitRepo === false`).
- `frontend/src/lib/api.ts` `cloneAgent(agentId, opts?)` (TASK-0213): bodiless POST for a plain clone, JSON `{ "forceWorktree": true }` body when forced.
- `frontend/src/components/AgentActionsMenu.tsx`: roving focus skips disabled items (unchanged by this task).
- Backend contract it relies on: `POST /api/agents/:id/clone` with `{ forceWorktree: true }` in `host-server/index.ts` and `cloneAgentRecord` in `host-server/db.ts` (fresh `conductor/<cloneId>` branch and `<repo>-worktrees/<cloneId>` directory, off the base branch, uncommitted work is not copied).

Coverage note: EDGE cases are unit-backed and judgeable from the recorded command alone. Real git, the real host-server, tmux window cwd, real browser layout and the tooltip are live-only (UI cases). TASK-0214 Step 4's `[DEFERRED-TO-UAT]` item (clone a worktree-less agent into a worktree, confirm the `⎇` badge and the new window's cwd) is UAT-UI-001. The unit tests run `AgentList.test.tsx` in one jsdom file that other agents also edit concurrently; if a `-t` filtered run fails, re-run once before judging (a transient failure was observed at generation time and did not reproduce, 3 consecutive passes).

---

## Test Cases

### UAT-UI-001: Clone a worktree-less agent into a worktree (live): new row, badge, window cwd
- **Page**: `http://localhost:4321/`, agent `uat-cwt-plain` (A) selected in the sidebar
- **Description**: TASK-0214 Step 4 `[DEFERRED-TO-UAT]`. From an agent with no worktree, `Clone into new worktree` spawns a copy in its own new git worktree and branch; the dashboard selects the new clone, its row shows the branch badge immediately, and its tmux window runs in the worktree directory. The source is untouched.
- **Steps**:
  1. Open the Agents page and click `uat-cwt-plain` in the sidebar. Confirm its row and Details tab show no `⎇ conductor/…` branch (Details > Worktree row shows the inline `Create worktree` button, not a branch).
  2. Click the kebab button (`Agent actions`, top right of the detail header). Note that `Clone into new worktree` is present, enabled, and sits directly under `Clone`.
  3. Click `Clone into new worktree`. Do not click anything else.
  4. Observe the sidebar and the main pane for up to 10 seconds.
  5. Run the two commands below to read the clone's id, worktree path and window cwd (replace `<window>` with the clone's name shown in the sidebar; with no project it is the bare agent name):
     ```bash
     curl -sS 'http://localhost:8788/api/status' | jq '.agents | max_by(.id) | {id, name, workdir, worktreePath, branch, windowPresent}'
     ```
     ```bash
     tmux display -p -t 'conductor:<window>' '#{pane_current_path}'
     ```
  6. Run `git -C ./tmp/uat-0214-repo worktree list && git -C ./tmp/uat-0214-repo branch --list 'conductor/*'`.
  7. Re-select `uat-cwt-plain` and confirm it still has no branch and no worktree.
- **Expected Result**:
  - Step 3: the menu closes with no confirm dialog; no red error banner appears on the source pane.
  - Step 4: the selection moves to the new clone (its detail pane opens and its sidebar row is highlighted, `aria-current`); the clone's row shows the muted badge `⎇ conductor/<cloneId>` without a page reload, and its Details tab Worktree row shows the same branch. This confirms the SSE `agent-update` carries `worktreePath`/`branch` (TASK-0215).
  - Step 5: the status object has `worktreePath` = `<abs>/tmp/uat-0214-repo-worktrees/<cloneId>`, `branch` = `conductor/<cloneId>`, `workdir` = the scratch repo, `windowPresent: true`. The `tmux display` output is that same worktree path (compare after resolving symlinks; e.g. `/private/var` vs `/var` on macOS is acceptable), NOT `…/tmp/uat-0214-repo`.
  - Step 6: `git worktree list` lists the worktree at `…/tmp/uat-0214-repo-worktrees/<cloneId>` on `conductor/<cloneId>`; the branch exists.
  - Step 7: the source `uat-cwt-plain` still shows no `⎇` badge (only the clone got a worktree).
- **Repeatable Unit Test**: Not applicable for the live wiring (real backend, real git, real tmux, real browser). The dashboard-side behaviour is covered by UAT-EDGE-002 and UAT-EDGE-003.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk (live prerequisite also unmet: throwaway fixture agents not created, host-server not restarted)] <!-- 2026-09-20 -->

---

### UAT-UI-002: Clone a worktree-backed agent into a second, distinct worktree (live)
- **Page**: `http://localhost:4321/`, agent `uat-cwt-has` (C) selected
- **Description**: The item is not hidden or disabled for an agent that already has a worktree. It yields a clone on a different worktree and branch, and both agents keep their own.
- **Steps**:
  1. Select `uat-cwt-has`. Note its `⎇ conductor/<C's id>` badge.
  2. Open the kebab menu. Confirm `Clone into new worktree` is enabled (no second reason line).
  3. Click `Clone into new worktree`, wait up to 10 seconds for the new clone to become selected.
  4. Run the commands below.
- **Command**:
  ```bash
  curl -sS 'http://localhost:8788/api/status' | jq '[.agents[] | select(.name | startswith("uat-cwt-has")) | {id, name, worktreePath, branch}] | sort_by(.id)'
  ```
- **Expected Result**:
  - Step 2: item enabled with no second line.
  - Step 3: the selection moves to the clone; its row shows `⎇ conductor/<cloneId>` where `<cloneId>` differs from C's id.
  - Step 4: two objects (C, then the clone). `worktreePath` and `branch` are both non-null and both differ between the two. C's values are unchanged from step 1. `git -C ./tmp/uat-0214-repo worktree list` lists both worktree directories.
- **Repeatable Unit Test**: Not applicable for the live wiring; the with-worktree menu presence is covered by UAT-EDGE-001.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk (live prerequisite also unmet: throwaway fixture agents not created, host-server not restarted)] <!-- 2026-09-20 -->

---

### UAT-UI-003: Menu placement, tooltip and in-flight label render correctly (live, visual)
- **Page**: `http://localhost:4321/`, agent `uat-cwt-plain` (A) selected (use a fresh clone of it if A was already used, and clean up)
- **Description**: What jsdom cannot show: on-screen menu order and truncation, the native tooltip, and the transient `Cloning…` state in a real browser.
- **Steps**:
  1. Open the kebab menu. Read the item order top to bottom.
  2. Hover `Clone into new worktree` for about 1.5 seconds and read the native tooltip.
  3. Click the item and immediately re-open the kebab menu within the first second (before the clone appears).
  4. Repeat steps 1 and 2 in the other theme (theme toggle in the navbar).
- **Expected Result**:
  - Step 1: `Rename`, `Change role`, `Clone`, `Clone into new worktree`, `Create worktree`, `Add background process` in that order; the label is not truncated or wrapped awkwardly at 768px width.
  - Step 2: tooltip reads exactly `Spawn a copy of this agent in its own new git worktree and branch (off the base branch — uncommitted work is not copied)`.
  - Step 3: if the menu can be re-opened before the selection moves, the worktree item reads `Cloning…` and is greyed, and `Clone` is greyed too; neither can start a second clone. (If the clone completes too fast to observe, record "not observable" and rely on UAT-EDGE-007.)
  - Step 4: the same order and legibility in both themes.
- **Repeatable Unit Test**: Not applicable: browser layout, native tooltip and theme rendering. The DOM-level assertions (order, `title`, disabled states) are UAT-EDGE-001, UAT-EDGE-007 and UAT-EDGE-008.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk (live prerequisite also unmet: throwaway fixture agents not created, host-server not restarted)] <!-- 2026-09-20 -->

---

### UAT-EDGE-001: Present and enabled on every agent (with and without a worktree), directly after Clone, with the tooltip copy
- **Scenario**: For an `inGitRepo: true` agent both without and with a worktree the menu contains `Clone into new worktree` at the index right after `Clone`; it is enabled, its `title` is the exact tooltip copy, and plain `Clone` is untouched (still enabled).
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: Two tests pass (`…for an agent without a worktree…` and `…for an agent with a worktree…`), `Tests  2 passed`.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`AgentDetailView "Clone into new worktree" menu item (TASK-0214)`; written by the TASK-0214 tackle, no new file written by this generation run)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "is present and enabled for an agent"` — verified: 2 passed
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-002: The two clone items send different, exact arguments to cloneAgent
- **Scenario**: Selecting `Clone into new worktree` calls `cloneAgent(agent.id, { forceWorktree: true })` exactly once; selecting plain `Clone` afterwards calls `cloneAgent(agent.id)` with ONLY the agent id (asserted with `toEqual([62])`, so an extra `undefined`/options argument or a swap fails). Both call `onCloned` with the returned clone id.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: The `calls cloneAgent with { forceWorktree: true }, while plain Clone calls it with only the agent id` test passes (1 passed).
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (written by the TASK-0214 tackle, no new file written by this generation run)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "calls cloneAgent with"` — verified: 1 passed
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-003: On resolve, the selection moves to the returned clone id, as plain Clone does
- **Scenario**: Through the real `AgentList` (sidebar + detail pane), choosing `Clone into new worktree` calls `cloneAgent(27, { forceWorktree: true })`, the source's pane closes, and once the clone's `agent-update` arrives the detail pane heading is the clone and its sidebar row has `aria-current="true"` while the source row does not.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: The `Clone into new worktree re-points the selection at the returned clone id, as plain Clone does (TASK-0214)` test passes (1 passed).
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`AgentList sidebar + pane selection gaps (TASK-0173 UAT)`; written by the TASK-0214 tackle, no new file written by this generation run)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "Clone into new worktree re-points the selection"` — verified: 1 passed (one transient failure seen once during a concurrent edit of the file; did not reproduce in 3 re-runs)
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-004: A rejected clone shows the backend reason in the shared banner and the item is re-enabled
- **Scenario**: `cloneAgent` rejects with `failed to create git worktree at /x/y: a branch named 'conductor/63' already exists`. That exact text appears in the red shared error banner (`text-accent-red`), `onCloned` is not called, and the item is enabled again for a retry.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: The `shows the backend reason in the shared banner when the clone is rejected` test passes (1 passed).
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (written by the TASK-0214 tackle, no new file written by this generation run)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "shows the backend reason in the shared banner when the clone is rejected"` — verified: 1 passed
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-005: Disabled with the not-a-repo reason when inGitRepo is false; plain Clone stays available
- **Scenario**: `inGitRepo: false`: the item is disabled and shows the reason line `Workdir is not inside a git repository`; plain `Clone` remains enabled (it needs no repo); clicking the disabled item never calls `cloneAgent`.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: The `is disabled with the not-a-repo reason when inGitRepo is false, and clicking does nothing` test passes (1 passed).
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (written by the TASK-0214 tackle, no new file written by this generation run)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "is disabled with the not-a-repo reason when inGitRepo is false, and clicking"` — verified: 1 passed
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-006: An undefined inGitRepo counts as unknown: item enabled, no reason line
- **Scenario**: When `inGitRepo` is absent on the client the item stays enabled with no not-a-repo text, so the backend (via TASK-0210/0213) supplies its real reason instead of the UI guessing.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: The `is enabled when inGitRepo is undefined (unknown counts as allowed) and shows no reason` test passes (1 passed).
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (written by the TASK-0214 tackle, no new file written by this generation run)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "is enabled when inGitRepo is undefined"` — verified: 1 passed
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-007: While a clone is in flight both clone items are disabled and cloneAgent fires only once
- **Scenario**: With a `cloneAgent` promise that never settles, after selecting `Clone into new worktree` the menu shows `Cloning…` (disabled) and plain `Clone` (disabled); clicking either again does not call `cloneAgent` a second time, so the shared `cloning` guard makes concurrent clones impossible.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: The `disables both clone items while a clone is in flight and fires cloneAgent only once` test passes (1 passed).
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (written by the TASK-0214 tackle, no new file written by this generation run)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "disables both clone items while a clone is in flight"` — verified: 1 passed
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-008: The full menu item list and order (regression on the existing menu wiring test)
- **Scenario**: The pre-existing actions-menu wiring test now pins the complete ordered list `Rename, Change role, Clone, Clone into new worktree, Create worktree, Add background process`, so the new item cannot silently move, disappear, or displace a neighbour.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: The `shows Stop/Destroy as icon buttons beside the menu, which lists only Rename, Change role, Clone, Clone into new worktree, Create worktree, Add background process` test passes (1 passed).
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`AgentDetailModal actions menu wiring (TASK-148)`; updated by the TASK-0214 tackle, no new file written by this generation run)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "shows Stop/Destroy as icon buttons beside the menu"` — verified: 1 passed
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-009: Roving keyboard focus skips a disabled menu item (no component change expected)
- **Scenario**: TASK-0214 Step 2 second bullet: the menu's roving focus wraps and skips disabled items, and a disabled item with a description is skipped and linked via `aria-describedby`. This is what makes the disabled `Clone into new worktree` unreachable by keyboard when `inGitRepo === false`. The component was not changed by this task.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: Three tests pass (`ArrowDown/ArrowUp move roving focus between enabled items, wrapping and skipping a disabled item`, `a disabled item is rendered with the disabled attribute and is not part of the roving-tabindex focus order`, `a disabled item with a description renders the reason text…`), `Tests  3 passed`.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentActionsMenu.test.tsx` (pre-existing; no new file written by this generation run)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentActionsMenu.test.tsx -t "roving focus|a disabled item"` — verified: 3 passed
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-010: cloneAgent sends no body for a plain clone and a JSON forceWorktree body when forced
- **Scenario**: The request contract the menu item depends on (TASK-0213 helper): `cloneAgent(id)` and `cloneAgent(id, { forceWorktree: false })` send a bodiless `POST`; `cloneAgent(id, { forceWorktree: true })` sends `Content-Type: application/json` and body `{"forceWorktree":true}`; a failure surfaces the backend `{ error }` reason as the thrown message. This is why the plain `Clone` item's request shape is unchanged.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: The four `cloneAgent request shape (TASK-0213)` tests pass, `Tests  4 passed`.
- **Repeatable Unit Test**: Created: `frontend/src/lib/api.test.ts` (written by the TASK-0213 tackle, no new file written by this generation run)
- **Unit Test Command**: `cd frontend && npx vitest run src/lib/api.test.ts -t "cloneAgent request shape"` — verified: 4 passed
- [x] Pass <!-- 2026-09-20 -->
