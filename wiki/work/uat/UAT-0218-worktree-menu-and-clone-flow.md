---
id: UAT-0218
aliases: [UAT-0218]
title: "UAT: Run UAT for the Create worktree menu action and the Clone into new worktree flow"
status: pending
task: TASK-0218
created: 2026-09-20
updated: 2026-09-20
---

# UAT-0218 — UAT: Run UAT for the Create worktree menu action and the Clone into new worktree flow

implements::[[TASK-0218]]

> **Source task**: [[TASK-0218]]
> **Generated**: 2026-09-20
> **Consolidates the live-only recipes of**: [[TASK-0209]], [[TASK-0210]], [[TASK-0211]], [[TASK-0212]], [[TASK-0213]], [[TASK-0214]], [[TASK-0215]], [[TASK-0216]], [[TASK-0217]] (their UATs are `UAT-0209`..`UAT-0216`; `UAT-0212`/`UAT-0217` are already archived as passed)

---

## Prerequisites

This UAT is **live-only by design**: every unit-backed half already lives in the per-task UATs and the suites named under each case. What is left here needs real tmux, real git, a host-server that runs the current source, and (for propagation) two browser tabs. Nothing below may touch the operator's real conductor.

- [ ] **Host-server must run the current source.** The shared dev host-server on port 8788 runs without `--watch` and predates TASK-0209..0217; every earlier auto-run recorded `FAIL: prerequisite not satisfied` for exactly this reason. This UAT therefore uses a **private** host-server (own conf, DB, state/log dirs, tmux socket, session name, port) started by `scripts/verify-worktree-any-agent.sh`. Do **not** restart or reuse the port-8788 server, and do **not** create `uat0218-*` agents in the real `./data/conductor.db`.
- [ ] Tools on `PATH`: `tmux` (>= 3.0), `git`, `jq`, `curl`, `node` (>= 18). The script prints `SKIPPED` and exits 0 when one is missing or the private port (default `18790`, override `UAT_PORT`) is busy. A SKIPPED run is **not** a pass: re-run the cases below on a machine that has them.
- [ ] All scratch lives under `./tmp/uat-0218/` (repo-local, gitignored; never `/tmp`). Layout the script creates: `repo/` (git repo, one commit on `main`, committed `packages/app/`), `plain/` (non-git directory), `conductor.conf`, `data/`, `logs/`, `tmux/` (private `TMUX_TMPDIR`), `pids`, and later `repo-worktrees/` (sibling of `repo/`, created by the code under test, not by the script).
- [ ] **Automated half** (cases marked *Script*): `bash scripts/verify-worktree-any-agent.sh` — hermetic, brings the private stack up, seeds fixtures through the real API, asserts via `curl` / `git` / `tmux display -p '#{pane_current_path}'`, prints one `PASS: caseN ...` / `FAIL: caseN ...` line per case, tears everything down on exit, `ALL PASS` + exit 0 on success.
- [ ] **UI half** (cases marked *UI*): run `bash scripts/verify-worktree-any-agent.sh --setup-only` (same private stack + the four fixtures, **left running**, prints the dashboard command; five fixtures: a, sub, plain, wt, gone), then in a second terminal `cd frontend && FRONTEND_PORT=4322 BACKEND_PORT=18790 npm run dev` and open `http://localhost:4322/agents` (two tabs for the propagation case). Use a fresh `--setup-only` stack for the UI walk: the Script run mutates the same fixture names. Stop it with `bash scripts/verify-worktree-any-agent.sh --cleanup` and Ctrl-C the frontend.
- [ ] Fixture agents (created by the script through `POST /api/agents`, launch command `sleep 3600` so no real coding agent starts; the window name equals the agent name because they have no project):

  | Agent | Workdir | Worktree | Window |
  |-------|---------|----------|--------|
  | `uat0218-a` | `./tmp/uat-0218/repo` | none | live |
  | `uat0218-sub` | `./tmp/uat-0218/repo/packages/app` | none | live |
  | `uat0218-plain` | `./tmp/uat-0218/plain` (not a git repo) | none | live |
  | `uat0218-wt` | `./tmp/uat-0218/repo` | created at add time via `useWorktree: true` | live |
  | `uat0218-gone` | `./tmp/uat-0218/repo` | none | live (reserved for UAT-INT-006, which stops its window from outside the UI) |

  The script also creates short-lived extras during its run (`uat0218-nowin`, clones named `<source>-copy`, `uat0218-new`); they are listed in the relevant cases.

- [ ] Source under test (for orientation; do not edit while running this UAT): `host-server/index.ts` (`POST /agents/:id/worktree`, `POST /agents/:id/clone`, `DELETE /agents/:id`, `spawnAgentWindow`), `host-server/git.ts` (`tryCreateWorktree`, `siblingWorktreePath`, `agentPaneCwd`, `isInGitRepoCached`), `host-server/db.ts` (`addWorktreeToAgent`, `cloneAgentRecord`, `createAgent`), `host-server/worktreeTeardown.ts`, `host-server/agentDiff.ts`, `host-server/agentUpdatePayload.ts`, `frontend/src/components/AgentList.tsx`, `AgentActionsMenu.tsx`, `frontend/src/lib/api.ts`.

**Coverage note.** Deterministic halves are pinned by: `host-server/git.test.ts`, `host-server/worktreeErrors.test.ts`, `host-server/db.migration.test.ts`, `host-server/agentDiff.test.ts`, `host-server/agentUpdatePayload.test.ts`, `host-server/sseRolePayloadParity.test.ts`, `host-server/worktreeTeardown.test.ts`, `frontend/src/components/AgentActionsMenu.test.tsx`, `frontend/src/components/AgentList.test.tsx`, `frontend/src/lib/api.test.ts`. No new unit tests were promoted from this UAT: every promotable assertion already has a home in those files. The parts only a live run proves are the cases below, each with a `Gap` note.

**Known unrelated failures** (do not cite as evidence for or against this UAT): a failing TASK-154 "activeTask row" test in `AgentList.test.tsx`, `tsc` errors around `BackgroundProcessesTab` / `onBgRestarted`, lint warnings for unused `firstLinePreview` / `lastPayload`, and one transient `AgentList.test.tsx` flake (re-run once before judging).

**Fixture-order rule.** Cases mutate the fixtures. Run them in the order listed; each case states the state it needs and leaves.

---

## Test Cases

### UAT-INT-001: Isolated stack and fixtures come up (case 1 — Setup)
- **Scenario**: Prove the harness is hermetic before trusting any later verdict. Verifies the throwaway repo, the non-git dir, the private stack and the four fixture agents, and that the operator's real stack was not touched. Verifies TASK-0218 case 1.
- **Steps**:
  1. Record `tmux list-windows -a -F '#{session_name}:#{window_name}' | sort > ./tmp/uat-0218-real-windows.before` **only if** a real conductor session is running (skip otherwise; it is only a before/after comparison).
  2. Run the command below. It runs the whole automated half, so this case's verdict is its `PASS: case1` line (later cases read their own lines from the same run).
  3. Confirm `./tmp/uat-0218/` is gone afterwards (the script's `trap` removes what it created) and the real window list is unchanged.
- **Command**:
  ```bash
  bash scripts/verify-worktree-any-agent.sh
  ```
- **Expected Result**: `PASS: case1 setup` is printed: `./tmp/uat-0218/repo` has one commit on `main` and a committed `packages/app/`; the private host-server answers `GET http://localhost:18790/api/agents` with exactly the five fixture `uat0218-*` agents (a, sub, plain, wt, gone); each fixture whose window should be live has a window in the **private** tmux socket (`TMUX_TMPDIR=./tmp/uat-0218/tmux`); `curl http://localhost:8788/api/agents` (the real server, if running) shows **no** `uat0218-*` agent. The script refuses (exit non-zero, message naming the variable) if `CONDUCTOR_CONF` points at the repo's real `conductor.conf`. Exit code 0 and `ALL PASS` are required for every *Script* case below.
- **Repeatable Unit Test**: Not applicable: harness/isolation verification is only meaningful live. `bash -n scripts/verify-worktree-any-agent.sh` (static) was run when the script was written.
- [ ] Pass

### UAT-UI-001: Create worktree menu item is present and enabled (case 2 — TASK-0209)
- **Page**: `http://localhost:4322/agents` (private stack, `--setup-only`), agent `uat0218-a` selected
- **Description**: The kebab (`AgentActionsMenu`) on an agent with no worktree, inside a git repo, offers an enabled **Create worktree** item with the specified tooltip, ordered Rename, Change role, Clone, Clone into new worktree, Create worktree, Add background process.
- **Steps**:
  1. Select `uat0218-a` in the sidebar. Open the kebab menu in the detail header.
  2. Hover **Create worktree** and read the native tooltip.
  3. Open the **Details** tab and confirm an inline **Create worktree** button is also present (agent has no worktree).
  4. Also open the menu for `uat0218-sub` (subdirectory workdir): the item must be enabled there too.
- **Expected Result**: The item is enabled (not greyed, focusable). Tooltip reads exactly `Opt in to an isolated git worktree + branch for this agent`. Menu order is as above. `GET http://localhost:18790/api/status` reports `inGitRepo: true` for `uat0218-a` and `uat0218-sub` (`curl -sS 'http://localhost:18790/api/status' | jq '.agents[] | {name, inGitRepo}'`).
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (describe `AgentDetailView "Create worktree" menu item (TASK-0209)`) and `frontend/src/components/AgentActionsMenu.test.tsx`. **Gap**: real payload wiring of `inGitRepo` from a live git repo and native tooltip rendering.
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx src/components/AgentActionsMenu.test.tsx -t "Create worktree"`
- [ ] Pass

### UAT-UI-002: Reasoned disabled states, readable in both themes, keyboard skip (case 3 — TASK-0209)
- **Page**: `http://localhost:4322/agents`, agents `uat0218-wt` and `uat0218-plain`
- **Description**: Disabled Create worktree items show their reason as a visible line (not hover-only). Verifies the wording, contrast in light and dark themes, and that keyboard navigation skips disabled items.
- **Steps**:
  1. Select `uat0218-wt`. Open the kebab menu. Read the **Create worktree** row.
  2. Select `uat0218-plain`. Open the kebab menu. Read the row.
  3. Toggle the app theme to light, then dark, repeating step 1/2 in each. Note the reason line is legible (target contrast >= 4.5:1; devtools contrast checker or a screenshot).
  4. With the menu open, press ArrowDown/ArrowUp through the items and note which are focused.
  5. Shrink the window to ~400 px wide and confirm the reason line wraps rather than clipping.
- **Expected Result**: `uat0218-wt`: item disabled with the visible line `Already has a worktree (conductor/<id>)`. `uat0218-plain`: item disabled with `Workdir is not inside a git repository`. The **Clone into new worktree** item is also disabled with the same not-a-repo line for `uat0218-plain` (case 10), and enabled for `uat0218-wt`. Reasons are readable without hover in both themes. ArrowDown/ArrowUp never lands on a disabled item. The Details-tab inline **Create worktree** button is absent for `uat0218-wt`.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentActionsMenu.test.tsx` (test `a disabled item with a description`, roving focus). **Gap**: computed contrast in two themes and 400 px wrapping are visual only. Contrast baseline recorded by TASK-0210: 5.10 (light) / 5.79 (dark).
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentActionsMenu.test.tsx`
- [ ] Pass

### UAT-INT-002: Real error reasons through the API (case 4, API half — TASK-0210)
- **Scenario**: `POST /api/agents/:id/worktree` returns git's real reason, with the right status, instead of a generic message. *Script* case `case4-api`.
- **Steps**:
  1. Run the automated half (UAT-INT-001) or, against a `--setup-only` stack, run the commands below in order (ids come from `curl -sS 'http://localhost:18790/api/agents' | jq '.[] | {id,name}'`).
  2. Pre-create the conflicting branch, then post for `uat0218-sub`; then clear the branch (case 5 needs it cleared).
- **Command**:
  ```bash
  git -C ./tmp/uat-0218/repo branch conductor/<uat0218-sub id>
  ```
  ```bash
  curl -sS -X POST 'http://localhost:18790/api/agents/<uat0218-sub id>/worktree' -w '\n%{http_code}\n'
  ```
  ```bash
  git -C ./tmp/uat-0218/repo branch -D conductor/<uat0218-sub id>
  ```
  ```bash
  curl -sS -X POST 'http://localhost:18790/api/agents/<uat0218-plain id>/worktree' -w '\n%{http_code}\n'
  ```
- **Expected Result**: The first POST is a **non-2xx** (500) whose body `error` is `failed to create git worktree at <path>: ...` and contains git's own text that the branch `conductor/<id>` already exists (not a generic message, not empty). The second POST (plain agent) is **400** with `{"error":"agent <id> workdir is not inside a git repository"}`. `POST /api/agents/999999/worktree` is 404 `agent 999999 not found`; `POST /api/agents/abc/worktree` is 400 `invalid agent id`.
- **Repeatable Unit Test**: Created: `host-server/git.test.ts`, `host-server/worktreeErrors.test.ts`, `host-server/db.migration.test.ts` (pattern `addWorktreeToAgent`). **Gap**: end-to-end HTTP status mapping through the running Fastify route.
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test worktreeErrors.test.ts`
- [ ] Pass

### UAT-UI-003: Real error reasons in the banner; host-server-down message (case 4, UI half — TASK-0210)
- **Page**: `http://localhost:4322/agents`, agent `uat0218-sub`
- **Description**: The banner shows git's real error once, is not duplicated in the Details tab, and a dead host-server yields a distinct message.
- **Steps**:
  1. In a terminal: `git -C ./tmp/uat-0218/repo branch conductor/<uat0218-sub id>`.
  2. Select `uat0218-sub`. Kebab menu, **Create worktree**. If the live-agent warning dialog (UAT-UI-005) appears, confirm it.
  3. Read the red banner, then open the **Details** tab and read the Worktree row.
  4. `git -C ./tmp/uat-0218/repo branch -D conductor/<uat0218-sub id>` to clear the state for later cases.
  5. Stop only the private host-server with `bash scripts/verify-worktree-any-agent.sh --stop-server`, click **Create worktree** again and read the banner, then bring it back with `bash scripts/verify-worktree-any-agent.sh --start-server` (same DB, port and tmux socket, so fixtures survive).
- **Expected Result**: Step 3: the banner contains git's actual "already exists" text exactly once; the Details Worktree row does not repeat it; no generic "failed" wording. Step 5: the banner reads exactly `Could not reach the host-server`.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (pattern `shows the real reason`) and `frontend/src/lib/api.test.ts`. **Gap**: real network failure text and de-duplication in the rendered banner.
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx src/lib/api.test.ts -t "reason"`
- [ ] Pass

### UAT-INT-003: New worktree lands in a new sibling directory (case 5 — TASK-0212)
- **Scenario**: For a **subdirectory** workdir (`uat0218-sub`, workdir `packages/app`), after clearing the pre-created branch, the worktree is created in `./tmp/uat-0218/repo-worktrees/<id>` (a directory that did not exist before), nothing new appears inside the repo, and the repo stays clean. *Script* case `case5`.
- **Steps**:
  1. Confirm `./tmp/uat-0218/repo-worktrees` does not exist (`test ! -e ./tmp/uat-0218/repo-worktrees`).
  2. Run the command below and read `worktreePath`.
  3. Compare `git status --porcelain` and the listing of the repo.
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:18790/api/agents/<uat0218-sub id>/worktree' | jq '{ok, worktreePath: .agent.worktreePath, branch: .agent.branch}'
  ```
  ```bash
  git -C ./tmp/uat-0218/repo status --porcelain
  ```
- **Expected Result**: HTTP 201; `worktreePath` equals the absolute path `<repo root>/../repo-worktrees/<id>` i.e. `.../tmp/uat-0218/repo-worktrees/<id>`; `branch` is `conductor/<id>`. `git status --porcelain` prints nothing; no `worktrees/` directory (or any new entry) exists inside `./tmp/uat-0218/repo`; `git -C ./tmp/uat-0218/repo worktree list` lists the sibling path. The window of `uat0218-sub`, if restarted (UAT-INT-005), starts in `<worktree>/packages/app` (the equivalent sub-path) or the worktree root.
- **Repeatable Unit Test**: Created: `host-server/git.test.ts` (37 tests incl. sibling guard) and `host-server/db.migration.test.ts` (`TASK-0212: addWorktreeToAgent for a subdirectory`). **Gap**: no test drives the guard refusal end to end through `createAgent`/`addWorktreeToAgent`, and the real first-time creation of the `-worktrees` directory is live only.
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test git.test.ts`
- [ ] Pass

### UAT-UI-004: A new worktree propagates to a second browser tab without reload (case 6 — TASK-0211, TASK-0215)
- **Page**: two tabs on `http://localhost:4322/agents`
- **Description**: `pollAndDiff` must broadcast `worktreePath`/`branch` changes; the acting tab also patches optimistically.
- **Steps**:
  1. Open the Agents page in tab A and tab B. Filter both by `uat0218-` (placeholder `Filter agents by name, project, role, or branch...`). Note `uat0218-a` has no `⎇` badge in either.
  2. In a terminal, start `curl -sN 'http://localhost:18790/api/events' > ./tmp/uat-0218/sse.txt &` (kill it afterwards).
  3. In tab A select `uat0218-a`, **Create worktree**, confirm the live-agent dialog (UAT-UI-005 covers its content).
  4. Watch tab B's sidebar row for `uat0218-a` for up to ~4 s. Do **not** reload tab B.
  5. In tab B type `conductor/` into the filter.
  6. Inspect `./tmp/uat-0218/sse.txt` for the `agent-update` of `uat0218-a`.
- **Expected Result**: Tab B shows `⎇ conductor/<id>` on the row within about one status poll (`STATUS_POLL_MS`, ~2 s; <= 4 s allowed) with no reload; tab A shows it immediately. The `conductor/` filter lists the agent in both tabs. The SSE file contains an `agent-update` for the agent that is **full-shaped** (`status`, `role`, `mode`, `agentType`, `windowPresent`, `inGitRepo`, `worktreePath` and `branch` both non-null). Self-heal (append): `mv ./tmp/uat-0218/repo-worktrees/<id> ./tmp/uat-0218/wt-moved`; within a few ticks the badge clears in **both** tabs and `GET /api/status` shows `{"branch":null,"worktreePath":null}` for that agent; then `mv` it back and `git -C ./tmp/uat-0218/repo worktree prune` is not needed (or note the observed behaviour).
- **Repeatable Unit Test**: Created: `host-server/agentDiff.test.ts` (predicate `agentSnapshotChanged`), `host-server/sseRolePayloadParity.test.ts`, `frontend/src/components/AgentList.test.tsx` (`creating a worktree from the detail view shows the branch badge`, `an SSE agent-update carrying worktreePath`, `removes the sidebar badge`). **Gap**: a real second browser and real SSE timing.
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test agentDiff.test.ts agentUpdatePayload.test.ts`
- [ ] Pass

### UAT-INT-004: The agent-update SSE payload for a worktree creation is full-shaped (case 6, API half — TASK-0211)
- **Scenario**: Without a browser, an SSE listener sees the `agent-update` carrying the worktree fields after `POST /worktree`. *Script* case `case6-sse`.
- **Steps**:
  1. Start a listener to a file, POST the worktree for `uat0218-a`, wait (bounded, <= 10 s) for the event, stop the listener.
- **Command**:
  ```bash
  curl -sN -m 10 'http://localhost:18790/api/events' -o ./tmp/uat-0218/sse-a.txt
  ```
  ```bash
  curl -sS -X POST 'http://localhost:18790/api/agents/<uat0218-a id>/worktree' | jq '.ok'
  ```
- **Expected Result**: `./tmp/uat-0218/sse-a.txt` contains an `event: agent-update` whose JSON `data` has `id` = the agent id, non-null `worktreePath` (sibling path) and `branch` (`conductor/<id>`), plus `status`, `mode`, `windowPresent`, `inGitRepo`. (Run the two commands concurrently; the script does.)
- **Repeatable Unit Test**: Created: `host-server/agentDiff.test.ts` and `host-server/sseRolePayloadParity.test.ts` (`periodic agent-update broadcast`).
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test agentDiff.test.ts sseRolePayloadParity.test.ts`
- [ ] Pass

### UAT-UI-005: Live-agent warning, Cancel, Confirm, "still running" notice (case 7, dialog half — TASK-0216)
- **Page**: `http://localhost:4322/agents`, agent `uat0218-a` (live window, no worktree; use a fresh `--setup-only` stack)
- **Description**: Creating a worktree for an agent whose window is live warns first; Cancel creates nothing; Confirm creates and shows a persistent notice.
- **Steps**:
  1. Select `uat0218-a`. Kebab menu, **Create worktree**. Read the dialog. Click **Cancel**. Run `curl -sS 'http://localhost:18790/api/agents' | jq '.[] | select(.name=="uat0218-a") | .worktreePath'`.
  2. Repeat, this time click **Create worktree** in the dialog.
  3. Read the amber notice; switch to another tab in the detail view and back (the notice must persist).
  4. Reload the page and note whether the notice survives (component state; record the observation, not a failure).
  5. Check contrast of the amber notice in light and dark themes and at ~400 px width.
- **Expected Result**: Dialog text: `uat0218-a is running in <workdir>. A new worktree will not move the running agent; it keeps editing that directory until its window is restarted. Create the worktree anyway?` with buttons **Cancel** and **Create worktree**. After Cancel: the API shows `null` (nothing created, no `repo-worktrees` directory). After Confirm: amber `role="status"` notice `Worktree created, but uat0218-a is still running in <workdir>. Restart its window to work inside <worktreePath>.` with a **Restart in worktree** button; it persists across tabs; the sidebar row shows `⎇ conductor/<id>`. The notice is legible in both themes and wraps at 400 px.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (describe `AgentDetailView worktree warn-first + restart (TASK-0216)`). **Gap**: real live/no-window detection from `windowPresent`, theme contrast, wrapping.
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "warn-first"`
- [ ] Pass

### UAT-UI-006: Restart in worktree relaunches the window inside the worktree; later edits appear in the Diff tab (case 7, restart half — TASK-0216, TASK-0213)
- **Page**: `http://localhost:4322/agents`, agent `uat0218-a` right after UAT-UI-005 (notice visible)
- **Description**: The confirmed restart is `DELETE` then `POST /window`; the relaunched pane starts in the worktree.
- **Steps**:
  1. Click **Restart in worktree**. Read the confirm dialog; click **Cancel** first and note the pane PID is unchanged (`tmux -S ./tmp/uat-0218/tmux/... list-panes` or `TMUX_TMPDIR=./tmp/uat-0218/tmux tmux list-panes -t uat0218:uat0218-a -F '#{pane_pid} #{pane_current_path}'`).
  2. Click **Restart in worktree** again and confirm **Restart**.
  3. Run `TMUX_TMPDIR=./tmp/uat-0218/tmux tmux display -p -t uat0218:uat0218-a '#{pane_current_path}'`.
  4. In the Terminal tab (Interact) type `touch uat-0218-agent-edit.txt`, then open the **Diff** tab.
- **Expected Result**: Confirm dialog text: `Restart "uat0218-a" in its worktree? This stops the running agent process and relaunches it; in-flight work and conversation context are lost.` (plus `uat0218-a is currently busy: restarting now will interrupt what it is doing.` only when busy). Cancel leaves the PID unchanged. After Restart the notice disappears, the window exists again, and `pane_current_path` is `.../tmp/uat-0218/repo-worktrees/<id>` (compare with `realpath`; macOS may prefix `/private`). The Diff tab lists `uat-0218-agent-edit.txt` as an uncommitted change. A failed restart, if provoked, shows `Window stopped but relaunch failed: <error>` in the banner.
- **Repeatable Unit Test**: Created: `frontend/src/lib/api.test.ts` (describe `restartAgentWindow (TASK-0216)`), `frontend/src/components/AgentList.test.tsx` (`Restart in worktree: confirm dialog`, `Restart confirmation omits the busy sentence`, `a failed restart shows the message in the banner`), `host-server/git.test.ts` (`agentPaneCwd`). **Gap**: real pane cwd, real Diff tab, and the awaiting/stalled confirmation variants (`is currently waiting for input`, `is currently stalled`) have no unit test.
- **Unit Test Command**: `cd frontend && npx vitest run src/lib/api.test.ts -t "restartAgentWindow"`
- [ ] Pass

### UAT-INT-005: Restart and respawn start inside the worktree; agent with no window (case 7, API half — TASK-0213, TASK-0216)
- **Scenario**: *Script* case `case7`. `agentPaneCwd` must be used by both the initial spawn and `POST /window`; an agent with no window needs no warning and **Create window** starts in the worktree.
- **Steps**:
  1. Create the worktree for `uat0218-sub` (state after UAT-INT-003), then restart its window through the API (DELETE then POST /window) and read the pane cwd.
  2. `DELETE` the window of `uat0218-wt`, then `POST /window`, read pane cwd (0213 INT-002).
  3. For an agent with no window and no worktree (the script creates `uat0218-nowin`, then `DELETE /window`): `POST /worktree` (no dialog exists in the API), then `POST /window`, read pane cwd.
- **Command**:
  ```bash
  curl -sS -X DELETE 'http://localhost:18790/api/agents/<id>/window'
  ```
  ```bash
  curl -sS -X POST 'http://localhost:18790/api/agents/<id>/window'
  ```
  ```bash
  TMUX_TMPDIR=./tmp/uat-0218/tmux tmux display -p -t 'uat0218:<window name>' '#{pane_current_path}'
  ```
- **Expected Result**: DELETE returns `{"ok":true,"closed":"<name>"}`, POST returns success; for the worktree-backed agents the pane path resolves to `.../repo-worktrees/<id>` (for `uat0218-sub`, the worktree root or `<worktree>/packages/app`); a second `DELETE /window` on an already-missing window returns the `agent window not present` error and no crash.
- **Repeatable Unit Test**: Created: `host-server/git.test.ts` (patterns `returns workdir when the agent has no worktree`, `worktreePath is stale`, `returns the worktree when workdir is the repo root`, `maps a subdirectory workdir into the worktree`, `falls back to the worktree root`). **Gap**: `spawnAgentWindow` passing `-c <paneCwd>` to real tmux.
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test git.test.ts`
- [ ] Pass

### UAT-INT-006: The "still running" notice clears when the window disappears (0216 INT-003)
- **Scenario**: If the window is stopped from outside the UI while the notice is showing, the notice clears instead of offering a restart that would fail. Uses the reserved fixture `uat0218-gone` (live window, no worktree).
- **Steps**:
  1. Select `uat0218-gone`, **Create worktree**, confirm; wait for the amber notice.
  2. Run the command below.
  3. Watch the detail view for up to ~10 s.
- **Command**:
  ```bash
  curl -sS -X DELETE 'http://localhost:18790/api/agents/<uat0218-gone id>/window'
  ```
- **Expected Result**: DELETE returns `{"ok":true,"closed":"uat0218-gone"}`. Within a few seconds the amber notice disappears with no click, the Terminal tab offers **Create window**, and no red banner appears. Clicking **Create window** starts the pane in the worktree.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`the notice clears when the agent window disappears`). **Gap**: the SSE-driven live version.
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "the notice clears"`
- [ ] Pass

### UAT-UI-007: Clone into new worktree from a worktree-less source (case 8, UI half — TASK-0214, TASK-0215)
- **Page**: `http://localhost:4322/agents`, agent `uat0218-a` **before** any worktree exists on it (fresh `--setup-only` stack)
- **Description**: The new kebab item spawns a copy in its own isolated worktree, selects it, and the row shows the badge on the very first render.
- **Steps**:
  1. Select `uat0218-a`. Open the kebab, hover **Clone into new worktree** (tooltip), click it. Watch the button label.
  2. Observe the sidebar/detail pane immediately after the click, frame by frame if possible (screen-record or repeat).
  3. Run `TMUX_TMPDIR=./tmp/uat-0218/tmux tmux display -p -t 'uat0218:uat0218-a-copy' '#{pane_current_path}'` (clone name is `<source>-copy`; adjust if a `-copy` already exists).
  4. Select the source again; check its menu and `pane_current_path` of its window.
- **Expected Result**: Tooltip is `Spawn a copy of this agent in its own new git worktree and branch (off the base branch — uncommitted work is not copied)`; label reads `Cloning…` while in flight and both clone items are disabled meanwhile; no confirm dialog. The new agent is selected; its row shows `⎇ conductor/<cloneId>` on its **first** appearance (no badge-less flash, no reload). Clone pane cwd is `.../repo-worktrees/<cloneId>`. The **source** still has `worktreePath: null`, no badge, and unchanged pane cwd (`.../repo`). `git -C ./tmp/uat-0218/repo worktree list` shows one worktree (the clone's).
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`Clone into new worktree re-points the selection`, `calls cloneAgent with`, `disables both clone items while a clone is in flight`), `host-server/agentUpdatePayload.test.ts`, `host-server/db.migration.test.ts` (`worktree-less source`). **Gap**: real pane cwd, real first-event timing, native tooltip.
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "Clone into new worktree"`
- [ ] Pass

### UAT-INT-007: Forced clone of a worktree-less source: API, SSE first event, pane cwd (case 8, API half — TASK-0213, TASK-0215)
- **Scenario**: *Script* case `case8`. A `{"forceWorktree":true}` clone returns a worktree-backed agent, the first SSE event for the new id already carries the fields, and the window starts inside the worktree.
- **Steps**:
  1. Start `curl -sN -m 10 'http://localhost:18790/api/events' -o ./tmp/uat-0218/sse-clone.txt` in the background.
  2. Run the clone command. Read the response.
  3. Read the pane cwd of the clone's window and of the source's window.
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:18790/api/agents/<uat0218-a id>/clone' -H 'Content-Type: application/json' -d '{"forceWorktree":true}' | jq '{ok, id: .agent.id, name: .agent.name, worktreePath: .agent.worktreePath, branch: .agent.branch}'
  ```
  ```bash
  TMUX_TMPDIR=./tmp/uat-0218/tmux tmux display -p -t 'uat0218:<clone name>' '#{pane_current_path}'
  ```
- **Expected Result**: HTTP 201; `worktreePath` = `.../tmp/uat-0218/repo-worktrees/<cloneId>`; `branch` = `conductor/<cloneId>`. The **first** `agent-update` in the SSE file for `<cloneId>` has non-null `worktreePath` and `branch`, `inGitRepo: true`, `mode` and `state` (this event comes from `buildNewAgentUpdate`, which carries `state` but no `status` object; the periodic `pollAndDiff` event of UAT-INT-004 carries `status`). An SSE client also receives a snapshot of every agent on connect, so match only events whose `worktreePath` and `branch` are non-null. Pane cwd of the clone is the worktree; source `worktreePath` stays `null` and its pane cwd stays `.../repo`. A plain clone (`{}` or no body) of the same source returns 201 with `worktreePath: null` **and the keys present** (`null`, not omitted) in its SSE first event.
- **Repeatable Unit Test**: Created: `host-server/agentUpdatePayload.test.ts` (`buildNewAgentUpdate`), `host-server/db.migration.test.ts` (`worktree-less source`, `without the flag keeps`). **Gap**: the three broadcast sites (clone route, `POST /agents`, project spawn) using the builder is checked statically only (UAT-0215 EDGE-005).
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test agentUpdatePayload.test.ts`
- [ ] Pass

### UAT-INT-008: Worktree-backed source gets a distinct worktree; plain Clone unchanged (case 9 — TASK-0213, TASK-0214)
- **Scenario**: *Script* case `case9`. Cloning `uat0218-wt` with `forceWorktree` yields a second, distinct worktree and branch; plain Clone semantics are unchanged (regression).
- **Steps**:
  1. Forced clone of `uat0218-wt`; compare its `worktreePath`/`branch` with the source's.
  2. Plain clone (`{}`) of a worktree-less agent (`uat0218-plain`'s sibling in the repo, use `uat0218-sub` before its worktree, or a fresh `uat0218-b`).
  3. Plain clone of `uat0218-wt`.
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:18790/api/agents/<uat0218-wt id>/clone' -H 'Content-Type: application/json' -d '{"forceWorktree":true}' | jq '{worktreePath: .agent.worktreePath, branch: .agent.branch}'
  ```
  ```bash
  curl -sS -X POST 'http://localhost:18790/api/agents/<worktree-less id>/clone' | jq '{worktreePath: .agent.worktreePath, workdir: .agent.workdir}'
  ```
  ```bash
  curl -sS -X POST 'http://localhost:18790/api/agents/<uat0218-wt id>/clone' | jq '{worktreePath: .agent.worktreePath, branch: .agent.branch}'
  ```
- **Expected Result**: Step 1: a new path/branch different from `uat0218-wt`'s, both under `repo-worktrees/`. Step 2: `worktreePath: null`, `workdir` equal to the source's (shared workdir, no worktree). Step 3: a worktree-backed clone with its own worktree/branch (existing behaviour, not sharing the source's). No two agents ever share a `worktreePath`. In the UI, both clone menu items exist for `uat0218-wt` and both work.
- **Repeatable Unit Test**: Created: `host-server/db.migration.test.ts` (`worktree-backed source`, `without the flag keeps`). **Gap**: real git behaviour of base-branch selection when the source worktree has uncommitted work (not copied, by design).
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test db.migration.test.ts`
- [ ] Pass

### UAT-INT-009: Forced clone fails loudly and leaves no residue (case 10, API half — TASK-0213)
- **Scenario**: *Script* case `case10`. A forced clone that cannot create a worktree returns the real reason and creates no agent row, no tmux window, no stray branch.
- **Steps**:
  1. Snapshot `curl -sS 'http://localhost:18790/api/agents' | jq 'length'`, the private tmux window list, and `git -C ./tmp/uat-0218/repo branch --list 'conductor/*'`.
  2. Forced clone of `uat0218-plain` (non-git).
  3. Pre-create the branch the next clone would take (`conductor/<next id>`; `<next id>` is max agent id + 1), forced-clone `uat0218-a`, then compare snapshots. Clear the branch afterwards.
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:18790/api/agents/<uat0218-plain id>/clone' -H 'Content-Type: application/json' -d '{"forceWorktree":true}' -w '\n%{http_code}\n'
  ```
- **Expected Result**: Step 2: **400**, error `workdir <path> is not inside a git repository`. Step 3: non-2xx with a `failed to create git worktree at <path>: ...` body containing git's reason. In both cases the agent count, tmux window list and `conductor/*` branch list are identical to the snapshots (the pre-created conflicting branch aside), i.e. no agent row, window, worktree directory or leaked `conductor/<n>` branch remains; an immediate retry after clearing the conflict succeeds.
- **Repeatable Unit Test**: Created: `host-server/db.migration.test.ts` (patterns `forceWorktree on a non-git workdir`, `worktree add fails`, plus the branch-leak test added by `fix-0213-branch-leak`). **Gap**: real rollback across DB + tmux together.
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test db.migration.test.ts`
- [ ] Pass

### UAT-UI-008: Failed Clone into new worktree shows git's reason; no ghost row (case 10, UI half — TASK-0214)
- **Page**: `http://localhost:4322/agents`, agent `uat0218-a`
- **Description**: The shared clone-error banner shows the backend reason and the sidebar gains no row.
- **Steps**:
  1. Count the sidebar rows. Pre-create the conflicting branch `conductor/<next id>` as in UAT-INT-009.
  2. Select `uat0218-a`, kebab menu, **Clone into new worktree**.
  3. Read the banner; recount rows; check the private tmux window list.
  4. Clear the branch. Then select `uat0218-plain` and open its kebab menu.
- **Expected Result**: Banner shows git's real reason (not a generic message). Row count and tmux windows unchanged. For `uat0218-plain` the **Clone into new worktree** item is disabled with `Workdir is not inside a git repository`; clicking it does nothing (no request in the browser network panel).
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`shows the backend reason in the shared banner when the clone is rejected`, `is disabled with the not-a-repo reason when inGitRepo is false, and clicking`).
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "clone is rejected|not-a-repo reason"`
- [ ] Pass

### UAT-INT-010: Deleting a forced clone tears down its worktree and branch, and only its own (case 11 — TASK-0217)
- **Scenario**: *Script* case `case11`. `DELETE /agents/:id` removes the clone's worktree directory, git registration and `conductor/<cloneId>` branch, leaves the source intact, and prunes the hand-deleted-worktree case.
- **Steps**:
  1. Forced-clone `uat0218-a` (state from UAT-INT-007), record the clone's `worktreePath`/`branch`, then delete the clone.
  2. Check the directory, `git worktree list`, `git branch --list`, and the source's worktree fields, window and agent row.
  3. For another worktree-backed agent (`uat0218-wt`'s clone), `rm -rf` its worktree directory by hand, delete that agent, and list branches.
- **Command**:
  ```bash
  curl -sS -X DELETE 'http://localhost:18790/api/agents/<cloneId>'
  ```
  ```bash
  git -C ./tmp/uat-0218/repo worktree list --porcelain
  ```
  ```bash
  git -C ./tmp/uat-0218/repo branch --list 'conductor/*'
  ```
- **Expected Result**: DELETE returns `{"ok":true,"removed":"<name>"}`. The clone's worktree directory no longer exists, its path is absent from `worktree list`, `conductor/<cloneId>` is absent from the branch list. The source agent, its worktree (if any), its branch and window are untouched. Hand-deleted case: the agent is deleted, the stale registration is pruned, and its `conductor/<id>` branch is gone too (no "used by worktree" refusal, no leaked branch). The host-server logs no unhandled exception.
- **Repeatable Unit Test**: Created: `host-server/worktreeTeardown.test.ts` (`forced-worktree clone of a worktree-less`, `tear down independently`, `removed by hand`, `handler delegates`) and `host-server/git.test.ts` (`hand-deleted worktree`). **Gap**: the HTTP route plus the tmux window kill are pinned only at source level (UAT-0217 EDGE-008); the prune-after-failed-remove wiring is checked by a static command (UAT-0217 EDGE-009).
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test worktreeTeardown.test.ts`
- [ ] Pass

### UAT-INT-011: Add Agent "Use a git worktree" still works and starts in the worktree (case 12 — regression)
- **Scenario**: *Script* case `case12`. `POST /api/agents` with `useWorktree: true` still creates a worktree in the sibling directory, the window starts in it, and its first SSE event carries the fields; an agent without `useWorktree` behaves as before.
- **Steps**:
  1. In the UI, open **Add Agent**, tick **Use a git worktree**, workdir `./tmp/uat-0218/repo` (absolute path), name `uat0218-new`, launch `sleep 3600`, submit. (The script does the equivalent via the API.)
  2. Read the sidebar badge and the pane cwd. Repeat without the checkbox as `uat0218-new2`.
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:18790/api/agents' -H 'Content-Type: application/json' -d '{"name":"uat0218-new","workdir":"<abs path>/tmp/uat-0218/repo","launchCmd":"sleep 3600","useWorktree":true}' | jq '{ok, worktreePath: .agent.worktreePath, branch: .agent.branch}'
  ```
- **Expected Result**: 201; `worktreePath` under `.../tmp/uat-0218/repo-worktrees/<id>`; badge visible immediately; pane cwd is the worktree. Without `useWorktree`: `worktreePath: null`, pane cwd is the workdir, no badge, no extra `repo-worktrees` entry.
- **Repeatable Unit Test**: Created: `host-server/agentUpdatePayload.test.ts` and `host-server/db.migration.test.ts` (`createAgent`). **Gap**: real window start.
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test agentUpdatePayload.test.ts`
- [ ] Pass

### UAT-UI-009: Worktree state flips when the workdir becomes a git repo (0209 INT-001)
- **Page**: `http://localhost:4322/agents`, agent `uat0218-plain`
- **Description**: `inGitRepo` is cached for 30 s (`isInGitRepoCached`); after `git init` on the plain directory the menu items must become enabled. Run **last** among UI cases (it mutates `plain`).
- **Steps**:
  1. Confirm both **Create worktree** and **Clone into new worktree** are disabled for `uat0218-plain`.
  2. `git -C ./tmp/uat-0218/plain init -b main && git -C ./tmp/uat-0218/plain commit --allow-empty -m init`.
  3. Wait up to ~35 s (bounded; refresh the status via the page's poll, no reload).
- **Expected Result**: Within ~35 s `GET /api/status` reports `inGitRepo: true` for `uat0218-plain` and both menu items become enabled without a reload.
- **Repeatable Unit Test**: Created: `host-server/git.test.ts` (`isInGitRepoCached`). **Gap**: live 30 s TTL flip end to end.
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test git.test.ts`
- [ ] Pass

### UAT-EDGE-001: Suites for the touched areas are green (case 12 — regression)
- **Scenario**: The deterministic halves of every case above still pass together.
- **Steps**: Run both commands below.
- **Expected Result**: `host-server`: all tests pass except none of the ones listed under Known unrelated failures (those are frontend). `frontend`: all pass except the known TASK-154 "activeTask row" failure; re-run once if `AgentList.test.tsx` flakes. Any other failure is a regression and fails this case.
- **Command**:
  ```bash
  cd host-server && npm test
  ```
  ```bash
  cd frontend && npx vitest run
  ```
- **Repeatable Unit Test**: Created: the whole suite (see Coverage note).
- **Unit Test Command**: `cd host-server && npm test`
- [ ] Pass

### UAT-INT-012: Cleanup leaves no residue and never touches real agents (case 13)
- **Scenario**: *Script* case `case13` (runs in the script's `trap`). Deleting all `uat0218-*` agents exercises UAT-INT-010's guarantees; then everything under `./tmp/uat-0218` is removed.
- **Steps**:
  1. After the UI walk: `bash scripts/verify-worktree-any-agent.sh --cleanup` (stops the private host-server and tmux server it recorded in `./tmp/uat-0218/pids`, deletes the fixture agents via the API first so worktrees/branches are torn down by the code under test, then `rm -rf ./tmp/uat-0218`). Stop the frontend dev server (Ctrl-C).
  2. Verify the residue checks below.
- **Command**:
  ```bash
  test ! -e ./tmp/uat-0218 && test ! -e ./tmp/uat-0218-real-windows.before && echo clean
  ```
  ```bash
  curl -sS 'http://localhost:8788/api/agents' | jq '[.[] | select(.name | startswith("uat0218"))] | length'
  ```
- **Expected Result**: `clean`; the real server (if running) reports `0`; `tmux list-windows -a` shows no `uat0218` session/window on the default socket; no `*-worktrees` directory was created next to the **real** repo (`test ! -e ../tmux-conductor-worktrees` unless it existed before); the real agents' windows and rows are unchanged from UAT-INT-001 step 1 (`./tmp/uat-0218-real-windows.before` compared, then removed); `./tmp/` holds no other `uat-0218*` leftovers; the port-8788 host-server was never restarted (its start time in `ps` is unchanged).
- **Repeatable Unit Test**: Not applicable: cleanup of live processes and directories.
- [ ] Pass

### UAT-EDGE-002: Shell launchers start windows in the worktree (known gap — follow-up required)
- **Scenario**: TASK-0213 fixed `spawnAgentWindow` (host-server) to start windows in `agentPaneCwd`, but `scripts/conductor.sh` (`:58`, `:71`), `scripts/spawn.sh` (`:49`, `:61`) and `scripts/lib/db.sh` (`:70`, `:78`, which selects only `a.workdir`, never `worktree_path`) still use `workdir`. An agent that already has a worktree therefore starts in the shared repo when launched by `conductor.sh` / `spawn.sh`. Expected per the requirement: the window starts in the worktree. **This case is expected to FAIL until a follow-up task fixes the scripts**; do not weaken it.
- **Steps**:
  1. Run the static check below.
  2. (Live, optional) On a private `SESSION_NAME`, run `scripts/conductor.sh` against a DB where an agent has a `worktree_path` and read `#{pane_current_path}`.
- **Command**:
  ```bash
  grep -nE 'worktree_path|worktree' scripts/lib/db.sh scripts/conductor.sh scripts/spawn.sh
  ```
- **Expected Result**: (Requirement) the scripts load `worktree_path` and pass the worktree (or its sub-path, mirroring `agentPaneCwd`) to `tmux new-session -c` / `new-window -c` / `split-window -c`. (Current behaviour) only `checkpoint_agent` in `scripts/lib/db.sh` mentions `worktree_path`, so this case fails today.
- **Repeatable Unit Test**: Blocked: shell launchers have no unit harness; a `bash`-based verifier (extend `scripts/verify-worktree-any-agent.sh`) is the follow-up.
- [ ] Pass

### UAT-EDGE-003: teardownAgentWorktree git-root fallback is wrong for the sibling layout (known gap — follow-up required)
- **Scenario**: `host-server/worktreeTeardown.ts:33` falls back to `path.dirname(path.dirname(entry.worktreePath))` when `getGitRoot(entry.workdir)` is null (workdir deleted or moved). That is the repo root only for the **legacy nested** layout `<repo>/worktrees/<id>`. With the current **sibling** layout `<parent>/<repo>-worktrees/<id>` it resolves to `<parent>`, so `git worktree remove`, `git worktree prune` and `git branch -D conductor/<id>` run against the wrong directory: the worktree registration and branch leak in the real repo. Expected per the requirement: the branch and worktree are removed. **Expected to FAIL until fixed** (recommended fix: derive the root from `git -C <worktreePath> rev-parse --git-common-dir`, using its parent).
- **Steps**:
  1. Run the reproduction below from the repo root (host-side scratch under `./tmp/`, no live server involved).
  2. Read the printed `BRANCH_LEFT` line.
- **Command**:
  ```bash
  set -e; D=./tmp/uat-0218-edge3; rm -rf $D; mkdir -p $D/repo/packages/app && cd $D/repo && git init -q -b main && echo x > packages/app/f && git add -A && git -c user.email=u@u -c user.name=u commit -qm init && git worktree add -q -b conductor/9 ../repo-worktrees/9 && rm -rf packages/app && cd - >/dev/null && (cd host-server && node --import tsx/esm -e "import('./worktreeTeardown.ts').then(m=>{const r=m.teardownAgentWorktree({id:9,workdir:process.argv[1]+'/repo/packages/app',worktreePath:process.argv[1]+'/repo-worktrees/9',branch:'conductor/9'});console.log(JSON.stringify(r))})" "$(cd ../$D && pwd)") && echo BRANCH_LEFT=$(git -C $D/repo branch --list conductor/9 | wc -l | tr -d ' ') && rm -rf $D
  ```
- **Expected Result**: (Requirement) prints `{"removedWorktree":true,"deletedBranch":true}` and `BRANCH_LEFT=0`. (Current behaviour) prints `{"removedWorktree":false,"deletedBranch":false}` with two `[conductor] DELETE /agents/9: ...` warnings and `BRANCH_LEFT=1`, and `git worktree list` still lists the worktree, so this case fails today. The scratch directory is under `./tmp/` and removed at the end.
- **Repeatable Unit Test**: Blocked: promotable in principle (add a sibling-layout case beside the legacy one in `host-server/worktreeTeardown.test.ts` once the fix lands; writing it now would be a red test on a production-code gap this task may not edit).
- [ ] Pass
