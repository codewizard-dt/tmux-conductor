---
id: UAT-0210
aliases: [UAT-0210]
title: "UAT: Surface the backend's real worktree-creation error reason instead of a generic message"
status: pending
task: TASK-0210
created: 2026-09-20
updated: 2026-09-20
---

# UAT-0210 — UAT: Surface the backend's real worktree-creation error reason instead of a generic message

implements::[[TASK-0210]]

> **Source task**: [[TASK-0210]]
> **Generated**: 2026-09-20

---

## Prerequisites

Cases are split by what they need. **EDGE cases need nothing but a checkout** (node/tsx, git, vitest; no server, no agents) and are judged from the recorded command. **API and UI cases need the live stack and throwaway fixture agents.** Unit-backed coverage exists for every live case's logic, so a missing live fixture blocks only the API/UI cases, never the EDGE cases.

- [ ] (EDGE cases) `host-server/` and `frontend/` dependencies installed; run commands from the repo root as written. Scripted EDGE cases write scratch repos under `./tmp/` (repo-local, gitignored) and delete them.
- [ ] (API/UI cases) Dev stack running via `make dev` (host-server `http://localhost:8788`, frontend `http://localhost:4321/`). The host-server must be **running code that includes TASK-0210**. If it was started without file watching before the change, restart it; a stale process is a prerequisite failure, not a test failure. Quick check: UAT-API-003 below returns the git reason (a stale process returns the old generic `failed to create git worktree at <path>` with no `: <reason>` suffix).
- [ ] (API-003..005, UI-001..003) Create fixtures. **Live cases must use throwaway agents only. Never click Create worktree, Clone, Stop or Destroy on a real agent.**
  ```bash
  mkdir -p ./tmp/uat-0210-repo && cd ./tmp/uat-0210-repo && git init -q -b main && git commit -q --allow-empty -m init && cd -
  mkdir -p "$HOME/uat-0210-nonrepo"
  git -C "$HOME/uat-0210-nonrepo" rev-parse --is-inside-work-tree   # MUST fail ("not a git repository"); pick another dir if it prints true
  ```
  Add two throwaway agents via the navbar `+ Add Agent` modal. Leave **Project** unselected (free-form path), keep the default launch command, enter an ABSOLUTE workdir, leave "Use a git worktree" (Advanced) UNCHECKED for both:
  - **A** `uat-wt210-collide`: workdir = `<repo root>/tmp/uat-0210-repo`.
  - **B** `uat-wt210-nonrepo`: workdir = `$HOME/uat-0210-nonrepo`.
  Then export their ids (used by the curl commands):
  ```bash
  export UAT_A_ID=$(curl -sS 'http://localhost:8788/api/status' | jq '.agents[] | select(.name=="uat-wt210-collide") | .id')
  export UAT_B_ID=$(curl -sS 'http://localhost:8788/api/status' | jq '.agents[] | select(.name=="uat-wt210-nonrepo") | .id')
  ```
- [ ] Fixture A is stateful, so run the live cases in this order: API-001, API-002, API-004, API-003, UI-001 (all with the colliding branch present), then UI-003 (branch and worktree absent), then API-005 (consumes A's worktree). Two reset recipes:
  - **Collide** (A has no worktree, branch present): `git -C ./tmp/uat-0210-repo branch "conductor/$UAT_A_ID"`.
  - **Clean** (A has no worktree, branch absent): `git -C ./tmp/uat-0210-repo branch -D "conductor/$UAT_A_ID"`. If A already got a worktree, first run `git -C ./tmp/uat-0210-repo worktree remove --force <path from git worktree list>`, then clear the agent's stored worktree by destroying and re-adding A (or skip and rerun API-005 last).
  Start in the **Collide** state.
- [ ] Cleanup after the run: Destroy `uat-wt210-collide` and `uat-wt210-nonrepo` from their actions menus, then delete `./tmp/uat-0210-repo`, `./tmp/uat-0210-repo-worktrees` and `$HOME/uat-0210-nonrepo`.

Source under test:
- `host-server/git.ts`: `tryCreateWorktree(gitRoot, worktreePath, branch): { ok: true } | { ok: false; reason }`, `extractGitReason(stderr, maxLen = 300)`, `WORKTREE_ADD_TIMEOUT_MS` (env, default 15 000), `createWorktree` (thin `.ok` wrapper).
- `host-server/worktreeErrors.ts`: `WorktreeError` (`code`: `not-found` | `already-has-worktree` | `not-git-repo` | `git-failed`), `worktreeErrorStatus(code)`.
- `host-server/db.ts` `addWorktreeToAgent` (throws `WorktreeError`) and `createAgent` (best-effort path logs the reason).
- `host-server/index.ts` `POST /api/agents/:id/worktree` (status via `worktreeErrorStatus`, body `{ error: message }`; success is `201 { ok: true, agent }`).
- `frontend/src/lib/api.ts` `createWorktreeForAgent`; `frontend/src/components/AgentList.tsx` `AgentDetailView` shared error banner; `frontend/src/components/AgentActionsMenu.tsx` disabled-item description.

Coverage note: TASK-0210 Step 5's `[DEFERRED-TO-UAT]` item (real git message in the banner) is UAT-UI-001. The disabled-reason contrast fix folded in from TASK-0209 UAT generation is UAT-EDGE-011 (class-level) and UAT-UI-002 (rendered contrast, both themes). The route's status-by-code wiring is live-only for 404/400/500/409 (API-001..005); the mapping table itself is unit-backed (UAT-EDGE-007).

---

## Test Cases

### UAT-EDGE-001: An already-existing branch surfaces git's own "already exists" reason
- **Scenario**: `tryCreateWorktree` is asked to create `conductor/try-dup` in a repo where that branch already exists.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: Test `tryCreateWorktree reports "already exists" when the branch exists` passes (`pass 1`, `fail 0`): result is `{ ok: false }`, `reason` matches `/already exists/`, and no worktree directory is left behind.
- **Repeatable Unit Test**: Created: `host-server/git.test.ts` (written by the TASK-0210 tackle; no new file written by this generation run)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern="branch exists" git.test.ts` (verified: pass 1, fail 0)
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-002: An invalid base ref surfaces git's real "invalid reference" reason
- **Scenario**: A repo with no commits, so the `detectBaseBranch` fallback `main` is not a valid ref; `git worktree add` fails.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: Test `tryCreateWorktree reports an invalid base ref for a repo with no commits` passes: `{ ok: false }`, `reason` matches `/invalid reference|not a valid|unknown revision/i`, and the boolean wrapper `createWorktree` returns `false` for the same input.
- **Repeatable Unit Test**: Created: `host-server/git.test.ts` (TASK-0210 tackle)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern="invalid base ref" git.test.ts` (verified: pass 1, fail 0)
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-003: Reason extraction takes the last fatal/error line, strips the prefix, caps at 300 characters
- **Scenario**: `extractGitReason` on multi-line stderr with an earlier `error:` and a later `fatal:`, a plain line, empty input, a 1000-character line, and a custom cap.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: Test `extractGitReason prefers the last fatal/error line, strips the prefix, and caps length` passes. Specifically: the later `fatal:` line wins with prefix removed (`a branch named 'x' already exists`); a plain last line is returned as-is; empty input gives `git worktree add failed`; a 1000-character reason is cut to exactly 300; an explicit `maxLen` of 10 yields 10 characters.
- **Repeatable Unit Test**: Created: `host-server/git.test.ts` (TASK-0210 tackle)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern="extractGitReason" git.test.ts` (verified: pass 1, fail 0)
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-004: Success returns { ok: true } and the boolean createWorktree contract is unchanged
- **Scenario**: Regression guard: the new detailed variant must not change what existing callers of `createWorktree` see.
- **Steps**:
  1. Run the unit test command below (two name patterns).
- **Expected Result**: Both `tryCreateWorktree returns { ok: true } on success` (result deep-equals `{ ok: true }`, worktree directory exists) and `createWorktree adds a new worktree and branch off the detected base branch` pass (`pass 2`, `fail 0`).
- **Repeatable Unit Test**: Created: `host-server/git.test.ts` (TASK-0210 tackle; the second test pre-dates the task and is the untouched boolean-contract assertion)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern="tryCreateWorktree returns" --test-name-pattern="createWorktree adds" git.test.ts` (verified: pass 2, fail 0)
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-005: A missing git binary is reported as "git is not installed or not on PATH"
- **Scenario**: `spawnSync('git', …)` fails with `ENOENT`. Simulated by running with an empty `PATH` (node is invoked by absolute path). No repo or fixture needed.
- **Steps**:
  1. From the repo root, run the command below as-is.
- **Command**:
  ```bash
  cd host-server && env PATH=/nonexistent "$(command -v node)" --import tsx/esm -e "import('./git.ts').then(m=>console.log(JSON.stringify(m.tryCreateWorktree('/nonexistent/repo','/nonexistent/wt','conductor/x'))))"
  ```
- **Expected Result**: Exactly `{"ok":false,"reason":"git is not installed or not on PATH"}` on stdout (verified at generation time).
- **Repeatable Unit Test**: Blocked: promotable in principle (spawn with a scrubbed env, or a child process with empty PATH) but no test exists yet and this generation run was restricted to wiki edits by the team lead; scripted command above is the repeatable check until a test is added to `host-server/git.test.ts`
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-006: A slow `git worktree add` times out with a clear reason and leaves no half-created worktree
- **Scenario**: The dedicated `WORKTREE_ADD_TIMEOUT_MS` (not the 2 s shell-sync timeout) applies; on timeout the code best-effort runs `git worktree remove --force` + `git worktree prune`. Simulated with `WORKTREE_ADD_TIMEOUT_MS=1` against a scratch repo created under `./tmp/` (the script deletes it).
- **Steps**:
  1. From the repo root, run the command below as-is.
- **Command**:
  ```bash
  cd host-server && mkdir -p ../tmp && WORKTREE_ADD_TIMEOUT_MS=1 node --import tsx/esm -e "import('./git.ts').then(async (m) => { const cp = await import('node:child_process'); const fs = await import('node:fs'); const path = await import('node:path'); const repo = fs.mkdtempSync(path.resolve('../tmp/uat0210-timeout-')); const wt = repo + '-wt'; const g = (...a) => cp.execFileSync('git', ['-C', repo, ...a], { stdio: 'pipe' }); g('init', '-b', 'main'); g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--allow-empty', '-m', 'init'); console.log(JSON.stringify(m.tryCreateWorktree(repo, wt, 'conductor/timeout'))); console.log('worktree dir exists:', fs.existsSync(wt)); console.log(cp.execFileSync('git', ['-C', repo, 'worktree', 'list'], { encoding: 'utf8' }).trim().split('\n').length + ' worktree entries'); fs.rmSync(repo, { recursive: true, force: true }); fs.rmSync(wt, { recursive: true, force: true }); })"
  ```
- **Expected Result**: Three lines: `{"ok":false,"reason":"git worktree add timed out after 1 ms"}`, then `worktree dir exists: false`, then `1 worktree entries` (only the main checkout is registered). Any other reason text, a surviving directory, or 2 entries is a FAIL.
- **Repeatable Unit Test**: Blocked: promotable in principle (env read at module load means it needs a child process) but no test exists yet and this generation run was restricted to wiki edits by the team lead; scripted command above (verified at generation time) is the repeatable check
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-007: WorktreeError preserves its message and each code maps to the right HTTP status
- **Scenario**: `worktreeErrorStatus`: `not-found` 404, `already-has-worktree` 409, `not-git-repo` 400, `git-failed` 500. `WorktreeError` is an `Error` subclass with `name`, `code`, and the exact message.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: Both tests (`worktreeErrorStatus maps each code to its HTTP status`, `WorktreeError preserves message, code, name and Error identity`) pass (`pass 2`, `fail 0`).
- **Repeatable Unit Test**: Created: `host-server/worktreeErrors.test.ts` (TASK-0210 tackle)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test worktreeErrors.test.ts` (verified: pass 2, fail 0)
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-008: addWorktreeToAgent throws a typed WorktreeError with the right code and the real git reason
- **Scenario**: Unknown agent id → `not-found`; agent that already has a worktree → `already-has-worktree`; non-git workdir → `not-git-repo` (existing message text unchanged); pre-existing `conductor/<id>` branch → `git-failed` whose message contains both `failed to create git worktree at` and git's `already exists`.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: The three `addWorktreeToAgent` tests pass (`pass 3`, `fail 0`), including `TASK-0210: addWorktreeToAgent surfaces the real git reason as a git-failed WorktreeError`.
- **Repeatable Unit Test**: Created: `host-server/db.migration.test.ts` (TASK-0210 tackle)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern="addWorktreeToAgent" db.migration.test.ts` (verified: pass 3, fail 0)
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-009: createWorktreeForAgent throws the backend reason verbatim and maps a network failure to a friendly message
- **Scenario**: Non-ok response with `{ error }` → that exact text; non-ok without JSON → `HTTP <status>`; `TypeError` from `fetch` → `Could not reach the host-server`; any other error rethrown unchanged.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: All four tests in `createWorktreeForAgent error reasons (TASK-0210)` pass (`Tests 4 passed`).
- **Repeatable Unit Test**: Created: `frontend/src/lib/api.test.ts` (TASK-0210 tackle)
- **Unit Test Command**: `cd frontend && npx vitest run src/lib/api.test.ts` (verified: 4 passed)
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-010: The dashboard shows each real reason exactly once, in the shared banner, wrapping long text
- **Scenario**: `createWorktreeForAgent` rejects with (i) `agent 7 workdir is not inside a git repository`, (ii) `failed to create git worktree at /x/y: a branch named 'conductor/7' already exists`, (iii) `Could not reach the host-server`. After opening the Details tab, `getAllByText(reason)` has length 1 (no duplicate in the Details Worktree row) and the banner has class `break-words`.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: The three `shows the real reason "…" exactly once (banner only, no Details-row duplicate)` cases pass (`3 passed`).
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (TASK-0210 tackle)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "shows the real reason"` (verified: 3 passed, 181 skipped)
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-011: The disabled "Create worktree" reason line is not dimmed and uses the 4.5:1-safe token
- **Scenario**: Folded in from TASK-0209 UAT generation. A disabled menu item's description span must not inherit the disabled opacity and must use `text-muted` (not `text-muted-2`); only the label span carries `group-disabled:opacity-40`; `aria-describedby` still links the description.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: Test `a disabled item with a description renders the reason text, stays disabled, is skipped by roving focus, and exposes the text via aria-describedby` passes (`1 passed`). Class-level only; the rendered contrast ratio is UAT-UI-002.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentActionsMenu.test.tsx` (TASK-0210 tackle)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentActionsMenu.test.tsx -t "disabled item with a description"` (verified: 1 passed)
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-API-001: Unknown agent id returns 404 with the not-found reason
- **Endpoint**: `POST /api/agents/:id/worktree`
- **Description**: `addWorktreeToAgent` throws `WorktreeError('not-found', …)`; the route maps it via `worktreeErrorStatus`. Needs no fixture agent. Verified against the live host-server at generation time.
- **Steps**:
  1. Run the curl command below as-is.
- **Command**:
  ```bash
  curl -sS -i -X POST 'http://localhost:8788/api/agents/999999/worktree'
  ```
- **Expected Result**: Status line `HTTP/1.1 404`; body exactly `{"error":"agent 999999 not found"}`.
- **Repeatable Unit Test**: Not applicable: exercises the real HTTP route wiring; the code-to-status mapping and the thrown code are covered by UAT-EDGE-007 and UAT-EDGE-008
- [FAIL: auto-judge: prerequisite not satisfied — host-server on :8788 (PID 72494, started 02:24:08) predates edits to host-server/index.ts (02:25:41) and git.ts and runs without file watching, so it is not verified to run TASK-0210 code; response matched Expected (404, {"error":"agent 999999 not found"}) but is not evidence for the new route wiring] <!-- 2026-09-20 -->

---

### UAT-API-002: Non-numeric agent id returns 400 invalid agent id
- **Endpoint**: `POST /api/agents/:id/worktree`
- **Description**: The route's own id validation is unchanged by the typed-error refactor. Needs no fixture agent.
- **Steps**:
  1. Run the curl command below as-is.
- **Command**:
  ```bash
  curl -sS -i -X POST 'http://localhost:8788/api/agents/abc/worktree'
  ```
- **Expected Result**: Status line `HTTP/1.1 400`; body exactly `{"error":"invalid agent id"}`.
- **Repeatable Unit Test**: Not applicable: real HTTP route wiring only, no logic beyond `parseInt`/`isNaN`
- [FAIL: auto-judge: prerequisite not satisfied — host-server on :8788 is stale relative to TASK-0210 edits (started 02:24:08, index.ts modified 02:25:41, no file watching); response matched Expected (400, {"error":"invalid agent id"}) but is not evidence for the new code] <!-- 2026-09-20 -->

---

### UAT-API-003: A colliding branch returns 500 whose error carries git's real reason
- **Endpoint**: `POST /api/agents/:id/worktree`
- **Description**: Agent A (in-repo, no worktree) with `conductor/<A id>` pre-created. The route must reply with the typed `git-failed` status (500) and a message of the form `failed to create git worktree at <path>: <git reason>`, not the old generic text. Prerequisite: fixtures A and the branch-collision step are done.
- **Steps**:
  1. Confirm the branch exists: `git -C ./tmp/uat-0210-repo branch --list "conductor/$UAT_A_ID"` prints it.
  2. Run the curl command below as-is.
- **Command**:
  ```bash
  curl -sS -i -X POST "http://localhost:8788/api/agents/$UAT_A_ID/worktree"
  ```
- **Expected Result**: Status line `HTTP/1.1 500`; body is `{"error":"failed to create git worktree at <path>: a branch named 'conductor/<A id>' already exists"}` (path is a sibling of the scratch repo; git's exact wording may vary by version but must contain `already exists`). A body ending in `at <path>` with no `: <reason>` means the host-server is stale (see prerequisites). Agent A must still have no worktree afterward.
- **Repeatable Unit Test**: Not applicable: needs the real host-server, DB agent row and git repo; the same logic (typed `git-failed` with `already exists`) is covered offline by UAT-EDGE-008 and UAT-EDGE-001
- [FAIL: auto-judge: prerequisite not satisfied — needs throwaway fixture agent A (creating agents in the live conductor DB is prohibited for this run) and a host-server running current TASK-0210 code (stale, PID 72494); not executed] <!-- 2026-09-20 -->

---

### UAT-API-004: A non-git workdir returns 400 with the not-a-repo reason
- **Endpoint**: `POST /api/agents/:id/worktree`
- **Description**: Agent B's workdir is outside any git repository, so `addWorktreeToAgent` throws `WorktreeError('not-git-repo', …)` and the route maps it to 400.
- **Steps**:
  1. Run the curl command below as-is.
- **Command**:
  ```bash
  curl -sS -i -X POST "http://localhost:8788/api/agents/$UAT_B_ID/worktree"
  ```
- **Expected Result**: Status line `HTTP/1.1 400`; body `{"error":"agent <B id> workdir is not inside a git repository"}`.
- **Repeatable Unit Test**: Not applicable: real route + DB row + directory; the code and message are covered offline by UAT-EDGE-008 and the status by UAT-EDGE-007
- [FAIL: auto-judge: prerequisite not satisfied — needs throwaway fixture agent B (creating agents in the live conductor DB is prohibited for this run) and a host-server running current TASK-0210 code (stale, PID 72494); not executed] <!-- 2026-09-20 -->

---

### UAT-API-005: Success returns 201, then a second call returns 409 already-has-a-worktree
- **Endpoint**: `POST /api/agents/:id/worktree`
- **Description**: Once the colliding branch is removed, creation succeeds (201 `{ ok: true, agent }` with `branch` `conductor/<A id>` and a non-null `worktreePath`); the immediate repeat is refused with 409 and the unchanged message text. Run last, from the **Clean** state. Do not assert the worktree path layout (owned by TASK-0212).
- **Steps**:
  1. Remove the collision: `git -C ./tmp/uat-0210-repo branch -D "conductor/$UAT_A_ID"`.
  2. Run the first curl command; then run the second.
- **Command**:
  ```bash
  curl -sS -X POST "http://localhost:8788/api/agents/$UAT_A_ID/worktree" | jq '{ok, branch: .agent.branch, hasPath: (.agent.worktreePath != null)}'
  ```
  ```bash
  curl -sS -i -X POST "http://localhost:8788/api/agents/$UAT_A_ID/worktree"
  ```
- **Expected Result**: First command prints `{"ok": true, "branch": "conductor/<A id>", "hasPath": true}`. Second prints `HTTP/1.1 409` with body `{"error":"agent <A id> already has a worktree"}`.
- **Repeatable Unit Test**: Not applicable: real route, real git worktree creation; the success and `already-has-worktree` paths are covered offline by the ROADMAP-007 test inside UAT-EDGE-008
- [FAIL: auto-judge: prerequisite not satisfied — needs throwaway fixture agent A (creating agents in the live conductor DB is prohibited for this run) and a host-server running current TASK-0210 code (stale, PID 72494); not executed] <!-- 2026-09-20 -->

---

### UAT-UI-001: Create worktree with a colliding branch shows git's real reason in the banner, once
- **Page**: `http://localhost:4321/`, agent `uat-wt210-collide` (A) selected in the sidebar
- **Description**: TASK-0210 Step 5 `[DEFERRED-TO-UAT]`. End-to-end: the real git message reaches the dashboard through backend, route and `createWorktreeForAgent`. Prerequisite: fixture A in the **Collide** state (no worktree, `conductor/<A id>` present); run before API-005.
- **Steps**:
  1. Select A. Open the kebab menu (`Agent actions`) and click `Create worktree`.
  2. Read the red banner directly under the header (it appears while the Details tab is NOT selected).
  3. Click the `Details` tab and look at the Worktree row.
  4. Open the menu again.
- **Expected Result**: The banner reads `failed to create git worktree at <path>: a branch named 'conductor/<A id>' already exists` (git's real wording, not a generic message). Long text wraps inside the banner, no horizontal overflow. The same string appears exactly once on the page: the Details Worktree row does not repeat it. The `Create worktree` menu item is enabled again for a retry, and no `⎇` branch badge appears.
- **Repeatable Unit Test**: Not applicable: real browser plus live backend; the banner-once behaviour is unit-backed by UAT-EDGE-010 and the backend reason by UAT-EDGE-008
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk (also: prerequisite fixture agent A and a current host-server are unavailable this run)] <!-- 2026-09-20 -->

---

### UAT-UI-002: The disabled-reason line meets 4.5:1 contrast in light and dark themes
- **Page**: `http://localhost:4321/`, agent `uat-wt210-nonrepo` (B) selected
- **Description**: Folded in from TASK-0209 UAT generation (was ~1.4:1 light). Rendered check that the reason `Workdir is not inside a git repository` is readable in both themes.
- **Steps**:
  1. Open B's kebab menu. In devtools, inspect the reason `<span>` under the disabled `Create worktree` item and read the contrast the Accessibility pane reports (or compute the rendered text colour against the menu's `bg-card` background).
  2. Confirm no ancestor between the span and the menu applies `opacity` (only the sibling label span dims).
  3. Click the navbar theme toggle, re-open the menu, and repeat steps 1 and 2.
- **Expected Result**: Contrast is at least 4.5:1 in both light and dark (the task recorded 5.10:1 light, 5.79:1 dark). Record the measured values. The label line is visibly dimmed while the reason line is not.
- **Repeatable Unit Test**: Not applicable: rendered contrast in a real browser; the class-level guard is UAT-EDGE-011
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk (also: prerequisite fixture agent B unavailable this run)] <!-- 2026-09-20 -->

---

### UAT-UI-003: An unreachable host-server shows "Could not reach the host-server"
- **Page**: `http://localhost:4321/`, agent A selected in the **Clean** state (no worktree, branch removed; run after UI-001 and before API-005)
- **Description**: Simulates a network-level failure without stopping the shared host-server: block only the worktree request in the browser.
- **Steps**:
  1. In devtools Network, block the request URL pattern `*/api/agents/*/worktree` (or, with Playwright, `page.route('**/api/agents/*/worktree', r => r.abort())`).
  2. Open A's kebab menu and click `Create worktree`.
  3. Remove the block afterward.
- **Expected Result**: The banner shows exactly `Could not reach the host-server` (not `Failed to fetch`, not `TypeError`), once. The menu item becomes enabled again. No worktree is created (`git -C ./tmp/uat-0210-repo worktree list` shows only the main checkout).
- **Repeatable Unit Test**: Not applicable: real browser network blocking; the `TypeError` conversion is unit-backed by UAT-EDGE-009 and the banner rendering by UAT-EDGE-010
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk (also: prerequisite fixture agent A unavailable this run)] <!-- 2026-09-20 -->
