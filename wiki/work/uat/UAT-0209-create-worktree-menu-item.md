---
id: UAT-0209
aliases: [UAT-0209]
title: "UAT: Add a Create worktree item to the agent actions menu with reasoned disabled states"
status: pending
task: TASK-0209
created: 2026-09-20
updated: 2026-09-20
---

# UAT-0209 — UAT: Add a Create worktree item to the agent actions menu with reasoned disabled states

implements::[[TASK-0209]]

> **Source task**: [[TASK-0209]]
> **Generated**: 2026-09-20

---

## Prerequisites

- [ ] Dev servers running: `make dev` (host-server on port 8788, frontend on port 4321). Live UI cases use `http://localhost:4321/` (the Agents page is the `/` route, `frontend/src/App.tsx`). Viewport at least 768px wide.
- [ ] The host-server is running code that includes TASK-0209. It is launched as `node --import tsx/esm index.ts` (no `--watch`), so a process started before the change serves payloads WITHOUT `inGitRepo` (observed at generation time: every agent returned `inGitRepo: null`). Restart it (`make dev`) before the API and INT cases; a stale process is a prerequisite failure, not a test failure.
- [ ] Create the fixtures below. **Live cases must run on throwaway agents only. Never use "Create worktree", Clone, Stop or Destroy on a real agent.** Scratch paths are `./tmp/` (repo-local, gitignored) except the non-repo dir, which must sit OUTSIDE any git repository because `./tmp` is inside the tmux-conductor work tree and `git rev-parse` would resolve to it.
  ```bash
  mkdir -p ./tmp/uat-0209-repo && cd ./tmp/uat-0209-repo && git init -q && git commit -q --allow-empty -m init && cd -
  mkdir -p "$HOME/uat-0209-nonrepo"
  git -C "$HOME/uat-0209-nonrepo" rev-parse --is-inside-work-tree   # MUST fail ("not a git repository"); pick another dir if it prints true
  ```
- [ ] Add three throwaway agents via the navbar `+ Add Agent` modal. Leave **Project** unselected (free-form path), keep the default launch command, and enter an ABSOLUTE workdir (`<repo root>/tmp/uat-0209-repo` for A and C, `$HOME/uat-0209-nonrepo` for B):
  - **A** `uat-wt-repo`: workdir = scratch git repo, "Use a git worktree" (Advanced) UNCHECKED, so it has no worktree.
  - **B** `uat-wt-nonrepo`: workdir = the non-repo dir, worktree UNCHECKED.
  - **C** `uat-wt-has`: workdir = scratch git repo, "Use a git worktree" CHECKED, so it starts with branch `conductor/<id>`.
- [ ] Confirm the three agents show in the sidebar (`windowPresent: true` in `GET http://localhost:8788/api/status`). Note each agent's numeric `id` from that response.
- [ ] Cleanup after the run: Destroy the three `uat-wt-*` agents from their actions menus, then delete `./tmp/uat-0209-repo`, `./tmp/uat-0209-repo-worktrees` and `$HOME/uat-0209-nonrepo` (the worktree lands at `<repo>-worktrees/<agentId>`, `host-server/git.ts` `siblingWorktreePath`).

Source under test:
- `host-server/git.ts`: `isInGitRepoCached(workdir, now)` (30 000 ms TTL per workdir, delegates to `getGitRoot(workdir) !== null`), `__resetGitRepoCacheForTests()`.
- `host-server/index.ts`: `inGitRepo: boolean` in the status snapshot (`buildSnapshot`, `GET /api/status` no-session fallback), and in the full `agent-update` payloads (SSE connect replay and periodic `pollAndDiff` broadcast). Deliberately NOT in the change-detection predicate.
- `frontend/src/components/AgentActionsMenu.tsx`: optional `description` on `AgentActionsMenuItem`, rendered as a second line (`text-[11px] text-muted-2`), linked by `aria-describedby`.
- `frontend/src/components/AgentList.tsx` `AgentDetailView`: `agentActionItems` entry `create-worktree` between `clone` and `add-bg-process`; `hasWorktree`/`worktreeMenuDescription`; `handleCreateWorktree`; `worktreeError` in the shared banner (`renameError ?? roleError ?? closeError ?? removeError ?? cloneError ?? worktreeError`).

Coverage note: EDGE cases are unit-backed (jsdom / node test runner) and can be judged from the recorded command. Real git, the real host-server payloads, real browser layout, keyboard behaviour and light/dark rendering are live-only (API, UI, INT cases). TASK-0209 Step 5's `[DEFERRED-TO-UAT]` item (light/dark readability of the reason line) is UAT-UI-004.

---

## Test Cases

### UAT-API-001: Every agent in GET /api/status carries a boolean inGitRepo
- **Endpoint**: `GET /api/status`
- **Description**: The per-agent status payload gained `inGitRepo: boolean` (`buildSnapshot`). It must be a real boolean for every agent, never absent or null.
- **Steps**:
  1. Run the curl command below as-is.
- **Command**:
  ```bash
  curl -sS 'http://localhost:8788/api/status' | jq '[.agents[].inGitRepo | type] | unique'
  ```
- **Expected Result**: `["boolean"]` (the array contains only `"boolean"`; no `"null"`). Empty `[]` is a prerequisite failure (no agents), not a pass.
- **Repeatable Unit Test**: Not applicable: exercises the real running host-server payload; the cache helper itself is covered by UAT-EDGE-001
- [FAIL: auto-judge: prerequisite not satisfied — host-server serves stale payload (inGitRepo null for all agents; restart needed) and throwaway agents uat-wt-repo/uat-wt-nonrepo/uat-wt-has do not exist] <!-- 2026-09-20 -->

---

### UAT-API-002: inGitRepo is true for the repo agents and false for the non-repo agent
- **Endpoint**: `GET /api/status`
- **Description**: The flag reflects the agent's workdir: A and C (inside the scratch git repo) are `true`, B (plain directory outside any repo) is `false`.
- **Steps**:
  1. Run the curl command below as-is.
- **Command**:
  ```bash
  curl -sS 'http://localhost:8788/api/status' | jq '[.agents[] | select(.name | startswith("uat-wt-")) | {name, inGitRepo, branch}] | sort_by(.name)'
  ```
- **Expected Result**: Three objects, in name order: `uat-wt-has` with `"inGitRepo": true` and `"branch": "conductor/<id>"`; `uat-wt-nonrepo` with `"inGitRepo": false` and `"branch": null`; `uat-wt-repo` with `"inGitRepo": true` and `"branch": null`.
- **Repeatable Unit Test**: Not applicable: needs the live status endpoint and real directories; the underlying true/false git detection is covered by UAT-EDGE-001
- [FAIL: auto-judge: prerequisite not satisfied — host-server serves stale payload (inGitRepo null for all agents; restart needed) and throwaway agents uat-wt-repo/uat-wt-nonrepo/uat-wt-has do not exist] <!-- 2026-09-20 -->

---

### UAT-API-003: The SSE connect replay carries inGitRepo on agent-update
- **Endpoint**: `GET /api/events` (SSE)
- **Description**: The hand-built full `agent-update` payload replayed to a newly connected client includes `inGitRepo` (added after `usage`, Step 1). Late-connecting dashboards would otherwise see the field only after a reload.
- **Steps**:
  1. Run the curl command below as-is (it exits after 3 seconds; a curl timeout exit code is expected).
- **Command**:
  ```bash
  curl -sS -N --max-time 3 'http://localhost:8788/api/events' | grep -oE '"name":"uat-wt-[a-z]*"|"inGitRepo":[a-z]*'
  ```
- **Expected Result**: For each of the three throwaway agents the output contains an `"inGitRepo":true` or `"inGitRepo":false` token (three of them in total). The `false` value appears once, alongside `uat-wt-nonrepo`. Field order in the raw payload places `inGitRepo` after `usage`, so the name and flag are not adjacent; count the tokens rather than pairing lines.
- **Repeatable Unit Test**: Not applicable: needs a live SSE stream (`host-server/sseRolePayloadParity.test.ts` only pins the role/worktree/branch field adjacency)
- [FAIL: auto-judge: prerequisite not satisfied — host-server serves stale payload (inGitRepo null for all agents; restart needed) and throwaway agents uat-wt-repo/uat-wt-nonrepo/uat-wt-has do not exist] <!-- 2026-09-20 -->

---

### UAT-UI-001: Create worktree from the actions menu on an in-repo agent without a worktree
- **Page**: `http://localhost:4321/`, agent `uat-wt-repo` (A) selected in the sidebar
- **Description**: The menu item is reachable from the kebab menu even though the Details tab is not open, is enabled, creates a real worktree, and then flips to a disabled state that explains itself.
- **Steps**:
  1. Open the Agents page and click `uat-wt-repo` in the sidebar. Leave the default (Terminal) tab active; do NOT open the Details tab.
  2. Confirm the header shows no `⎇ conductor/…` branch badge.
  3. Click the kebab button (`Agent actions`, top right of the detail header).
  4. Observe the item order and the state of `Create worktree`.
  5. Click `Create worktree`.
  6. Re-open the kebab menu.
  7. In a terminal: `cd ./tmp/uat-0209-repo && git worktree list && git branch --list 'conductor/*'`.
- **Expected Result**:
  - Step 4: `Create worktree` sits between `Clone` and `Add background process`, is enabled (not greyed), and shows no second line.
  - Step 5: the menu closes; the item, if re-opened mid-request, reads `Creating worktree…` and is disabled; within a few seconds the header shows the badge `⎇ conductor/<A's id>`. No error banner appears.
  - Step 6: `Create worktree` is now greyed and shows the visible second line `Already has a worktree (conductor/<A's id>)` without hovering.
  - Step 7: `git worktree list` lists `…/tmp/uat-0209-repo-worktrees/<A's id>` on branch `conductor/<A's id>`; the branch exists.
- **Repeatable Unit Test**: Not applicable for the live wiring (real backend, real git, real browser). The jsdom behaviour is covered by UAT-EDGE-003.
- [FAIL: auto-judge: prerequisite not satisfied — host-server serves stale payload (inGitRepo null for all agents; restart needed) and throwaway agents uat-wt-repo/uat-wt-nonrepo/uat-wt-has do not exist; UI test also requires human verification] <!-- 2026-09-20 -->

---

### UAT-UI-002: Disabled with the branch named when the agent already has a worktree
- **Page**: `http://localhost:4321/`, agent `uat-wt-has` (C) selected
- **Description**: For an agent that already owns a worktree the item is present but disabled, and the reason is readable on screen (not only in a native tooltip).
- **Steps**:
  1. Select `uat-wt-has`. Open the browser devtools Network tab and clear it.
  2. Open the kebab menu. Read the `Create worktree` row without hovering it.
  3. Try to click `Create worktree`.
  4. Open the `Details` tab and look at the `Worktree` row.
- **Expected Result**:
  - Step 2: `Create worktree` is greyed and a second, smaller line reads `Already has a worktree (conductor/<C's id>)`.
  - Step 3: nothing happens (menu stays open, no `POST …/worktree` request in the Network tab).
  - Step 4: the `Worktree` row shows the `⎇ conductor/<C's id>` branch and no inline `Create worktree` button.
- **Repeatable Unit Test**: Not applicable for the live wiring; the jsdom behaviour is covered by UAT-EDGE-004.
- [FAIL: auto-judge: prerequisite not satisfied — host-server serves stale payload (inGitRepo null for all agents; restart needed) and throwaway agents uat-wt-repo/uat-wt-nonrepo/uat-wt-has do not exist; UI test also requires human verification] <!-- 2026-09-20 -->

---

### UAT-UI-003: Disabled with the not-a-repo reason for an agent whose workdir is not a git repository
- **Page**: `http://localhost:4321/`, agent `uat-wt-nonrepo` (B) selected
- **Description**: The reason for an unavailable action is shown, and keyboard users skip past the disabled item.
- **Steps**:
  1. Select `uat-wt-nonrepo` and clear the devtools Network tab.
  2. Open the kebab menu with the mouse and read the `Create worktree` row without hovering it.
  3. Click `Create worktree`.
  4. Close the menu (Escape). With the kebab button focused, press ArrowDown to open the menu, then keep pressing ArrowDown, noting which items receive focus.
- **Expected Result**:
  - Step 2: `Create worktree` is greyed with the visible second line `Workdir is not inside a git repository`.
  - Step 3: nothing happens, no `POST …/worktree` request appears.
  - Step 4: focus moves Rename, Change role, Clone, Add background process (any items after it), and never lands on `Create worktree`.
- **Repeatable Unit Test**: Not applicable for the live keyboard/browser behaviour; the jsdom behaviour is covered by UAT-EDGE-002 and UAT-EDGE-005.
- [FAIL: auto-judge: prerequisite not satisfied — host-server serves stale payload (inGitRepo null for all agents; restart needed) and throwaway agents uat-wt-repo/uat-wt-nonrepo/uat-wt-has do not exist; UI test also requires human verification] <!-- 2026-09-20 -->

---

### UAT-UI-004: The disabled-reason line is readable in light and dark themes
- **Page**: `http://localhost:4321/`, agent `uat-wt-nonrepo` (B) selected, menu open
- **Description**: TASK-0209 Step 5 `[DEFERRED-TO-UAT]`: confirm the reason line is readable in both themes. Note the reason line is `text-muted-2` inside a button that also carries `disabled:opacity-40`, so its effective contrast is lower than the same text on an enabled item.
- **Steps**:
  1. With B selected, open the kebab menu in the current theme and read the reason line at 100% browser zoom.
  2. In devtools, inspect the reason `<span>` (`Workdir is not inside a git repository`) and read the contrast the Styles/Accessibility pane reports (or measure the rendered text colour, blended with the button's 0.4 opacity, against the `--color-card` background).
  3. Click the theme toggle in the navbar (moon/sun icon), re-open the kebab menu, and repeat steps 1 and 2.
  4. Repeat once for `uat-wt-has` (C), whose reason line is `Already has a worktree (conductor/<id>)`, in both themes.
- **Expected Result**: In both light and dark themes the reason line can be read comfortably at normal zoom, without hovering. Record the measured contrast per theme. The project's text-contrast bar is 4.5:1 (see UAT-140); a measurement below that must be recorded as a finding and judged by the reviewer, not silently accepted.
- **Repeatable Unit Test**: Not applicable: visual rendering and theme contrast are browser-only
- [FAIL: auto-judge: prerequisite not satisfied — host-server serves stale payload (inGitRepo null for all agents; restart needed) and throwaway agents uat-wt-repo/uat-wt-nonrepo/uat-wt-has do not exist; UI test also requires human verification] <!-- 2026-09-20 -->

---

### UAT-EDGE-001: isInGitRepoCached answers true/false correctly and honours the 30 s TTL
- **Scenario**: A repo returns `true`, a plain directory `false`; a second call inside the TTL returns the cached value even after `.git` is removed (or created); the value refreshes at exactly 30 000 ms. The injected clock keeps the test off wall time.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: The `isInGitRepoCached is true for a repo, false for a plain directory, and honours the TTL via an injected clock` test passes (`pass 1`, `fail 0`).
- **Repeatable Unit Test**: Created: `host-server/git.test.ts` (`isInGitRepoCached is true for a repo…`; written by the TASK-0209 tackle, no new file written by this generation run)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern="isInGitRepoCached" git.test.ts` — verified: pass 1, fail 0
- [FAIL: auto-judge: prerequisite not satisfied — host-server serves stale payload (inGitRepo null for all agents; restart needed) and throwaway agents uat-wt-repo/uat-wt-nonrepo/uat-wt-has do not exist] <!-- 2026-09-20 -->

---

### UAT-EDGE-002: A disabled menu item with a description shows it, exposes it via aria-describedby, and is skipped by roving focus
- **Scenario**: `AgentActionsMenuItem.description` renders as visible text under the label, the button is `disabled`, keyboard navigation skips it, its `aria-describedby` points at the description, and items without a description carry no `aria-describedby`.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: The `a disabled item with a description renders the reason text, stays disabled, is skipped by roving focus, and exposes the text via aria-describedby` test passes (1 passed).
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentActionsMenu.test.tsx` (written by the TASK-0209 tackle, no new file written by this generation run)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentActionsMenu.test.tsx -t "a disabled item with a description"` — verified: 1 passed
- [FAIL: auto-judge: prerequisite not satisfied — host-server serves stale payload (inGitRepo null for all agents; restart needed) and throwaway agents uat-wt-repo/uat-wt-nonrepo/uat-wt-has do not exist] <!-- 2026-09-20 -->

---

### UAT-EDGE-003: Enabled for an in-repo agent without a worktree; clicking calls createWorktreeForAgent once and the branch badge appears
- **Scenario**: `inGitRepo: true`, no `worktreePath`/`branch`: the item is enabled, one click calls `createWorktreeForAgent(agent.id)` exactly once, `⎇ conductor/<id>` appears, and the item then becomes disabled with `Already has a worktree (conductor/<id>)`.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: The `enabled for an in-repo agent without a worktree: clicking it calls createWorktreeForAgent once and the branch badge appears` test passes (1 passed).
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`AgentDetailView "Create worktree" menu item (TASK-0209)`; written by the TASK-0209 tackle, no new file written by this generation run)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "enabled for an in-repo agent"` — verified: 1 passed
- [FAIL: auto-judge: prerequisite not satisfied — host-server serves stale payload (inGitRepo null for all agents; restart needed) and throwaway agents uat-wt-repo/uat-wt-nonrepo/uat-wt-has do not exist] <!-- 2026-09-20 -->

---

### UAT-EDGE-004: Disabled for an agent that already has a worktree, with a description naming the branch
- **Scenario**: `worktreePath`/`branch` set: the item is disabled, its text and `aria-describedby` target read `Already has a worktree (conductor/12)`, and clicking never calls `createWorktreeForAgent`.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: The `disabled for an agent that already has a worktree, with a description naming the branch` test passes (1 passed).
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (written by the TASK-0209 tackle, no new file written by this generation run)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "disabled for an agent that already has a worktree"` — verified: 1 passed
- [FAIL: auto-judge: prerequisite not satisfied — host-server serves stale payload (inGitRepo null for all agents; restart needed) and throwaway agents uat-wt-repo/uat-wt-nonrepo/uat-wt-has do not exist] <!-- 2026-09-20 -->

---

### UAT-EDGE-005: Disabled with the not-a-repo reason when inGitRepo is false
- **Scenario**: `inGitRepo: false`: the item is disabled with the text `Workdir is not inside a git repository`, and clicking never calls `createWorktreeForAgent`.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: The `disabled with the not-a-repo reason when inGitRepo is false` test passes (1 passed).
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (written by the TASK-0209 tackle, no new file written by this generation run)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "disabled with the not-a-repo reason"` — verified: 1 passed
- [FAIL: auto-judge: prerequisite not satisfied — host-server serves stale payload (inGitRepo null for all agents; restart needed) and throwaway agents uat-wt-repo/uat-wt-nonrepo/uat-wt-has do not exist] <!-- 2026-09-20 -->

---

### UAT-EDGE-006: An undefined inGitRepo (older payload / partial SSE) counts as unknown and leaves the item enabled
- **Scenario**: When `inGitRepo` is absent on the client the item stays enabled with no not-a-repo text, so the backend remains the authority (its 400 is the backstop).
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: The `enabled when inGitRepo is undefined (unknown counts as allowed)` test passes (1 passed).
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (written by the TASK-0209 tackle, no new file written by this generation run)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "enabled when inGitRepo is undefined"` — verified: 1 passed
- [FAIL: auto-judge: prerequisite not satisfied — host-server serves stale payload (inGitRepo null for all agents; restart needed) and throwaway agents uat-wt-repo/uat-wt-nonrepo/uat-wt-has do not exist] <!-- 2026-09-20 -->

---

### UAT-EDGE-007: A rejected createWorktreeForAgent shows its error in the shared banner while the Details tab is not active
- **Scenario**: `createWorktreeForAgent` rejects with `git worktree add failed: boom`: the text appears in the red shared error banner (`text-accent-red`) even though the Details tab is not the selected tab, and the menu item is re-enabled for a retry, so a menu-path failure is never silent.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: The `a rejected createWorktreeForAgent shows the error in the shared banner while the Details tab is not active` test passes (1 passed).
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (written by the TASK-0209 tackle, no new file written by this generation run)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "a rejected createWorktreeForAgent shows the error"` — verified: 1 passed
- [FAIL: auto-judge: prerequisite not satisfied — host-server serves stale payload (inGitRepo null for all agents; restart needed) and throwaway agents uat-wt-repo/uat-wt-nonrepo/uat-wt-has do not exist] <!-- 2026-09-20 -->

---

### UAT-INT-001: The in-repo signal follows the workdir (after the 30 s cache TTL) end to end
- **Scenario**: Backend cache, status payload and menu state agree. B starts non-repo (disabled); after the workdir becomes a git repository and the 30 s TTL passes, `/api/status` reports `true` and the menu item becomes enabled after a page reload. (Per TASK-0209 Step 1, `inGitRepo` is intentionally not part of SSE change detection, so an already-open page may keep the last value until reload or another agent change; do not treat that as a failure.)
- **Steps**:
  1. Confirm B is still disabled with `Workdir is not inside a git repository` (UAT-UI-003) and `GET /api/status` reports `inGitRepo: false` for `uat-wt-nonrepo`.
  2. In a terminal: `git -C "$HOME/uat-0209-nonrepo" init -q && git -C "$HOME/uat-0209-nonrepo" commit -q --allow-empty -m init`.
  3. Wait at least 35 seconds.
  4. Run the curl command below.
  5. Reload `http://localhost:4321/`, select `uat-wt-nonrepo`, open the kebab menu.
  6. Do NOT click `Create worktree` on this agent; cleanup removes it.
- **Command**:
  ```bash
  curl -sS 'http://localhost:8788/api/status' | jq '.agents[] | select(.name == "uat-wt-nonrepo") | {name, inGitRepo}'
  ```
- **Expected Result**: Step 4 returns `{"name": "uat-wt-nonrepo", "inGitRepo": true}`. Step 5: `Create worktree` is enabled with no second line. Re-running the curl in step 4 within 30 s of the `git init` may still return `false` (cached); only the post-35 s result decides the case.
- **Repeatable Unit Test**: Not applicable: end-to-end over the real filesystem, host-server and browser (the TTL logic alone is UAT-EDGE-001)
- [FAIL: auto-judge: prerequisite not satisfied — host-server serves stale payload (inGitRepo null for all agents; restart needed) and throwaway agents uat-wt-repo/uat-wt-nonrepo/uat-wt-has do not exist] <!-- 2026-09-20 -->
