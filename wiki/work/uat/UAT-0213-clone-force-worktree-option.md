---
id: UAT-0213
aliases: [UAT-0213]
title: "UAT: Add a force-worktree option to POST /agents/:id/clone and start the clone's window inside the worktree"
status: pending
task: TASK-0213
created: 2026-09-20
updated: 2026-09-20
---

# UAT-0213 — UAT: Add a force-worktree option to POST /agents/:id/clone and start the clone's window inside the worktree

implements::[[TASK-0213]]

> **Source task**: [[TASK-0213]]
> **Generated**: 2026-09-20

---

## Prerequisites

Cases are split by what they need. **EDGE cases need nothing but a checkout** (node/tsx, git, vitest; no server, no tmux, no agents). Each one runs a name-scoped unit test and is judged from the recorded command alone. **API and INT cases need the live stack and throwaway fixture agents.** Every live case's core logic is also unit-backed, so a missing live fixture blocks only the API/INT cases, never the EDGE cases.

`host-server/db.migration.test.ts` has unrelated pre-existing failures (`bgHasLinkedAgentColumn` undefined; a TASK-125 v8 test against the v12 migration). **Always run it with `--test-name-pattern`** as written below; never run the whole file and never judge a case from the file-level totals.

- [ ] (EDGE cases) `host-server/` and `frontend/` dependencies installed. Run from the repo root as written.
- [ ] (API/INT cases) Dev stack running via `make dev` (host-server `http://localhost:8788`, tmux session `conductor` alive). The host-server must be **running code that includes TASK-0213**. If it was started without file watching before the change, restart it; a stale process is a prerequisite failure, not a test failure. Quick check: UAT-API-002 returns **400** on a stale-free server. A stale server returns **201** and creates an unwanted clone (delete it with `DELETE /api/agents/<id>`, then restart).
- [ ] (API/INT cases) Create fixtures. **Live cases must use throwaway agents only. Never Clone, Stop or Destroy a real agent.** Fixture agents run `sleep 3600`, so no real Claude session is started.
  ```bash
  export UAT_REPO="$PWD/tmp/uat-0213-repo"
  mkdir -p "$UAT_REPO" && git -C "$UAT_REPO" init -q -b main && git -C "$UAT_REPO" -c user.email=uat@test.local -c user.name=UAT commit -q --allow-empty -m init
  export UAT_NONREPO="$HOME/uat-0213-nonrepo"
  mkdir -p "$UAT_NONREPO"
  git -C "$UAT_NONREPO" rev-parse --is-inside-work-tree   # MUST fail ("not a git repository"); pick another dir if it prints true
  export UAT_BLOCKED="$PWD/tmp/uat-0213-blocked"
  mkdir -p "$UAT_BLOCKED" && git -C "$UAT_BLOCKED" init -q -b main && git -C "$UAT_BLOCKED" -c user.email=uat@test.local -c user.name=UAT commit -q --allow-empty -m init
  touch "$UAT_BLOCKED-worktrees"   # a regular FILE where the sibling worktrees directory must go: makes `git worktree add` fail
  ```
  Then create the three throwaway agents (no project, no worktree, `sleep 3600` launch command):
  ```bash
  for spec in "uat-wt213-src:$UAT_REPO" "uat-wt213-nonrepo:$UAT_NONREPO" "uat-wt213-blocked:$UAT_BLOCKED"; do
    curl -sS -X POST 'http://localhost:8788/api/agents' -H 'Content-Type: application/json' -d "$(jq -n --arg n "${spec%%:*}" --arg w "${spec#*:}" '{name:$n,workdir:$w,launchCmd:"sleep 3600"}')" | jq -c '.agent | {id,name,worktreePath}'
  done
  export UAT_SRC_ID=$(curl -sS 'http://localhost:8788/api/status' | jq '.agents[] | select(.name=="uat-wt213-src") | .id')
  export UAT_NONREPO_ID=$(curl -sS 'http://localhost:8788/api/status' | jq '.agents[] | select(.name=="uat-wt213-nonrepo") | .id')
  export UAT_BLOCKED_ID=$(curl -sS 'http://localhost:8788/api/status' | jq '.agents[] | select(.name=="uat-wt213-blocked") | .id')
  echo "$UAT_SRC_ID $UAT_NONREPO_ID $UAT_BLOCKED_ID"
  ```
  All three ids must be numbers, each `worktreePath` must be `null`, and `tmux list-windows -t conductor -F '#{window_name}'` must list the three names.
- [ ] Live cases are stateful. **Run them in this order: API-001, INT-001, API-002, API-003, API-004, API-005, API-006, INT-002.** Each clone the run creates is recorded as an exported id (`UAT_C1_ID` .. `UAT_C5_ID`) for cleanup. Clone names are derived (`<source>-copy`, then `-copy-2`, ...), so the names quoted in the cases assume this order.
- [ ] Cleanup after the run (destroys the worktrees and `conductor/<id>` branches of the clones too):
  ```bash
  for id in $UAT_C5_ID $UAT_C4_ID $UAT_C3_ID $UAT_C2_ID $UAT_C1_ID $UAT_SRC_ID $UAT_NONREPO_ID $UAT_BLOCKED_ID; do curl -sS -X DELETE "http://localhost:8788/api/agents/$id" | jq -c .; done
  rm -rf "$UAT_REPO" "$UAT_REPO-worktrees" "$UAT_BLOCKED" "$UAT_BLOCKED-worktrees" "$UAT_NONREPO"
  ```
  Then confirm `tmux list-windows -t conductor -F '#{window_name}'` shows no `uat-wt213-*` window and `GET /api/status` shows no `uat-wt213-*` agent.

Source under test:
- `host-server/git.ts` `agentPaneCwd(agent, exists = fs.existsSync): string`: pane start directory, worktree when present on disk (plus the sub-path mapping for a subdirectory workdir), else `workdir`.
- `host-server/db.ts` `createAgent` (`requireWorktree`: hard-fail plus row rollback) and `cloneAgentRecord(db, source, { forceWorktree })`.
- `host-server/index.ts` `POST /api/agents/:id/clone` (body `{ forceWorktree?: unknown }`, strict `=== true`; `WorktreeError` mapped by `worktreeErrorStatus`: `not-git-repo` 400, `git-failed` 500, body `{ error: message }`; success `201 { ok: true, agent }`) and `spawnAgentWindow` (`tmux new-window -c agentPaneCwd(...)`).
- `frontend/src/lib/api.ts` `cloneAgent(agentId, opts?: { forceWorktree?: boolean })`.

Coverage note: TASK-0213 Step 5's `[DEFERRED-TO-UAT]` item (clone with `forceWorktree`, confirm `#{pane_current_path}` is the worktree and the source repo is untouched) is UAT-INT-001. The route's status mapping and the "no clone row left behind" guarantee are unit-backed in `cloneAgentRecord` (EDGE-008, EDGE-009) but the HTTP status and `{ error }` body are live-only (API-002, API-003). **Not covered here:** the workdir-keyed transcript-fallback call-site changes (`agentPaneCwd(agent)` passed to `getContextForAgent` / `detectAgentStatusWithBackgroundJobs`) only matter for a real Claude/Codex session resolving its transcript; fixture agents run `sleep`, so that is left to TASK-0218's runtime pass. API-001 and INT-001 do confirm the changed call sites do not throw and the agent shows in `/api/status`.

---

## Test Cases

### UAT-EDGE-001: agentPaneCwd falls back to workdir when there is no worktree, or the worktree path is stale
- **Scenario**: `agentPaneCwd({ workdir, worktreePath: null })` and a `worktreePath` that does not exist on disk (also forced stale through the injected `exists` predicate).
- **Steps**:
  1. Run the two unit test commands below.
- **Expected Result**: Test `agentPaneCwd returns workdir when the agent has no worktree` passes, and test `agentPaneCwd returns workdir when worktreePath is stale (not on disk)` passes (`pass 1`, `fail 0` each). Both return the agent's `workdir` unchanged.
- **Repeatable Unit Test**: Created: `host-server/git.test.ts` (written by the TASK-0213 tackle; no new file written by this generation run)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern="returns workdir when the agent has no worktree" git.test.ts` and `cd host-server && node --import tsx/esm --test --test-name-pattern="worktreePath is stale" git.test.ts` (both verified: pass 1, fail 0)
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-002: agentPaneCwd returns the worktree when the workdir is the repo root
- **Scenario**: A real repo with a real worktree created via `tryCreateWorktree`; agent `workdir` is the repo root.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: Test `agentPaneCwd returns the worktree when workdir is the repo root` passes: the result equals the worktree path, not the repo root.
- **Repeatable Unit Test**: Created: `host-server/git.test.ts` (TASK-0213 tackle)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern="returns the worktree when workdir is the repo root" git.test.ts` (verified: pass 1, fail 0)
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-003: agentPaneCwd maps a subdirectory workdir into the same sub-path of the worktree
- **Scenario**: `workdir` is `<repo>/packages/app` and the worktree contains `packages/app`.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: Test `agentPaneCwd maps a subdirectory workdir into the worktree` passes: the result is `<worktree>/packages/app`, so a subdirectory agent lands in its own package inside the worktree.
- **Repeatable Unit Test**: Created: `host-server/git.test.ts` (TASK-0213 tackle)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern="maps a subdirectory workdir into the worktree" git.test.ts` (verified: pass 1, fail 0)
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-004: agentPaneCwd falls back to the worktree root when the sub-path does not exist in the worktree
- **Scenario**: `workdir` is an untracked subdirectory of the repo, so the worktree checkout has no matching sub-path.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: Test `agentPaneCwd falls back to the worktree root when the sub-path is missing there` passes: the result is the worktree root, never a non-existent path.
- **Repeatable Unit Test**: Created: `host-server/git.test.ts` (TASK-0213 tackle)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern="falls back to the worktree root" git.test.ts` (verified: pass 1, fail 0)
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-005: A forced clone of a worktree-less source gets a fresh sibling worktree and branch; the source stays worktree-less
- **Scenario**: `cloneAgentRecord(db, source, { forceWorktree: true })` where the source has no worktree.
- **Steps**:
  1. Run the unit test command below (scoped by `--test-name-pattern`; do not run the whole file).
- **Expected Result**: Test `TASK-0213: cloneAgentRecord with forceWorktree gives a worktree-less source a fresh sibling worktree` passes: the clone has `worktreePath` and `branch` set, `path.dirname(worktreePath)` is `<repo>-worktrees`, `branch` is `conductor/<cloneId>`, the clone id differs from the source id, and the source's own `worktreePath` is still `null`.
- **Repeatable Unit Test**: Created: `host-server/db.migration.test.ts` (TASK-0213 tackle)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern="worktree-less source" db.migration.test.ts` (verified: pass 1, fail 0)
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-006: A forced clone of a worktree-backed source gets a second, distinct worktree
- **Scenario**: Source already has a worktree; clone with `forceWorktree`.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: Test `TASK-0213: cloneAgentRecord with forceWorktree gives a worktree-backed source a second, distinct worktree` passes: the clone's `worktreePath` differs from the source's, both directories exist on disk, and `git worktree list` shows both.
- **Repeatable Unit Test**: Created: `host-server/db.migration.test.ts` (TASK-0213 tackle)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern="worktree-backed source" db.migration.test.ts` (verified: pass 1, fail 0)
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-007: Without the flag, the clone keeps the source's previous worktree-ness (regression guard)
- **Scenario**: `cloneAgentRecord(db, source)` with no options, once for a worktree-less source and once for a worktree-backed source.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: Test `TASK-0213: cloneAgentRecord without the flag keeps the previous worktree-ness of the source` passes: the clone of a worktree-less source has `worktreePath === null`; the clone of a worktree-backed source has a `worktreePath`.
- **Repeatable Unit Test**: Created: `host-server/db.migration.test.ts` (TASK-0213 tackle)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern="without the flag keeps" db.migration.test.ts` (verified: pass 1, fail 0)
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-008: A forced clone of a non-git workdir throws not-git-repo and leaves no clone row
- **Scenario**: Source workdir is a plain directory (git upward search capped inside `./tmp`); clone with `forceWorktree`.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: Test `TASK-0213: forceWorktree on a non-git workdir throws not-git-repo and leaves no clone row` passes: a `WorktreeError` with `code === 'not-git-repo'` is thrown and `listAgents(db).length` is unchanged.
- **Repeatable Unit Test**: Created: `host-server/db.migration.test.ts` (TASK-0213 tackle)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern="forceWorktree on a non-git workdir" db.migration.test.ts` (verified: pass 1, fail 0; the shorter pattern `non-git workdir` also matches an older unrelated test, so keep the full pattern)
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-009: A forced clone whose git worktree add fails throws git-failed, rolls the row back and leaves no directory
- **Scenario**: The branch `conductor/<nextId>` is pre-created in the repo so `git worktree add -b` fails with "already exists".
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: Test `TASK-0213: a forced clone whose git worktree add fails throws git-failed, rolls the row back and leaves no directory` passes: a `WorktreeError` with `code === 'git-failed'` and a message matching `/already exists/` is thrown, no clone row remains, and `<repo>-worktrees/<nextId>` does not exist. (This case pre-creates the branch itself, so it does not exercise a branch left behind by the failed attempt; see UAT-API-004.)
- **Repeatable Unit Test**: Created: `host-server/db.migration.test.ts` (TASK-0213 tackle)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern="worktree add fails" db.migration.test.ts` (verified: pass 1, fail 0)
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-010: A forced clone of a subdirectory-workdir source lands the worktree beside the git root
- **Scenario**: Source `workdir` is `<repo>/packages/app`; clone with `forceWorktree`.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: Test `TASK-0213: forceWorktree from a subdirectory workdir lands the worktree beside the git root, not the subdirectory` passes: `path.dirname(worktreePath)` is `<repo>-worktrees` (not `<repo>/packages/app-worktrees`), the clone keeps `workdir` equal to the subdirectory, and `<worktree>/packages/app/index.txt` exists.
- **Repeatable Unit Test**: Created: `host-server/db.migration.test.ts` (TASK-0213 tackle)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern="subdirectory workdir lands" db.migration.test.ts` (verified: pass 1, fail 0)
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-011: cloneAgent sends no body for a plain clone (default and `forceWorktree: false`)
- **Scenario**: `cloneAgent(3)` and `cloneAgent(3, { forceWorktree: false })` with `fetch` stubbed.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: Both tests named `sends a bodiless POST ...` pass (`Tests 2 passed`): the request is `POST .../agents/3/clone` with init exactly `{ method: 'POST' }`, i.e. no headers and no body, identical to the pre-TASK-0213 request.
- **Repeatable Unit Test**: Created: `frontend/src/lib/api.test.ts` (TASK-0213 tackle)
- **Unit Test Command**: `cd frontend && npx vitest run src/lib/api.test.ts -t "bodiless POST"` (verified: 2 passed, 6 skipped)
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-012: cloneAgent sends `{ forceWorktree: true }` as JSON and surfaces the backend's error reason
- **Scenario**: `cloneAgent(3, { forceWorktree: true })` with `fetch` stubbed for success and for a 400 `{ error }` response.
- **Steps**:
  1. Run the two unit test commands below.
- **Expected Result**: The forced-body test passes: `init.method` is `POST`, `init.headers` equals `{ 'Content-Type': 'application/json' }` and `init.body` equals `JSON.stringify({ forceWorktree: true })`. The error test passes: a non-ok response with `{ error: 'workdir is not inside a git repository' }` makes the promise reject with exactly that message.
- **Repeatable Unit Test**: Created: `frontend/src/lib/api.test.ts` (TASK-0213 tackle)
- **Unit Test Command**: `cd frontend && npx vitest run src/lib/api.test.ts -t "JSON . forceWorktree: true . body when forced"` and `cd frontend && npx vitest run src/lib/api.test.ts -t "surfaces the backend"` (both verified: 1 passed, 7 skipped)
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-API-001: POST clone with `{ "forceWorktree": true }` on a worktree-less git source returns 201 with a fresh sibling worktree
- **Endpoint**: `POST /api/agents/:id/clone`
- **Description**: The route wiring for the forced clone: 201, and the response agent carries `worktreePath` `<repo>-worktrees/<cloneId>` and branch `conductor/<cloneId>` even though the source has neither.
- **Steps**:
  1. Confirm the fixture source `uat-wt213-src` exists and has no worktree (see Prerequisites).
  2. Run the curl command below as-is.
  3. Export the new clone's id: `export UAT_C1_ID=<the .agent.id from the response>` (its name is `uat-wt213-src-copy`).
  4. Run the verification curl: `curl -sS 'http://localhost:8788/api/status' | jq '.agents[] | select(.name=="uat-wt213-src-copy") | {id, windowPresent, worktreePath, branch, workdir}'`
- **Command**:
  ```bash
  curl -sS -i -X POST "http://localhost:8788/api/agents/$UAT_SRC_ID/clone" -H 'Content-Type: application/json' -d '{"forceWorktree":true}'
  ```
- **Expected Result**: Status line `HTTP/1.1 201 Created` and body `{"ok":true,"agent":{...}}` where `agent.name` is `uat-wt213-src-copy`, `agent.workdir` equals `$UAT_REPO`, `agent.worktreePath` equals `$UAT_REPO-worktrees/<agent.id>` (the `tmp/uat-0213-repo-worktrees/<id>` directory beside the repo, not inside it), and `agent.branch` equals `conductor/<agent.id>`. The verification curl shows the same `worktreePath`/`branch` and `windowPresent: true`. `git -C "$UAT_REPO" worktree list` lists the repo root and that worktree, and `git -C "$UAT_REPO" branch --list 'conductor/*'` lists the clone's branch.
- **Repeatable Unit Test**: Not applicable: HTTP route wiring (Fastify body parsing, status, tmux spawn); its create half is unit-backed by UAT-EDGE-005
- [FAIL: auto-judge: prerequisite not satisfied — live fixture agents (uat-wt213-*) not created and host-server not restarted (forbidden by orchestrator); no unit-backed evidence channel] <!-- 2026-09-20 -->

---

### UAT-INT-001: The forced clone's tmux window starts inside its worktree and the source repo is untouched
- **Scenario**: End to end for the deferred Step 5 runtime check. After UAT-API-001, the clone's window must have been created with `tmux new-window -c <worktree>` (the `spawnAgentWindow` / `agentPaneCwd` fix), while the source agent's window and the repo working tree stay as they were.
- **Steps**:
  1. Run the commands below in order. Wait about 2 seconds after UAT-API-001 so the pane's shell has started.
  2. `export UAT_C1_WT=$(curl -sS 'http://localhost:8788/api/status' | jq -r '.agents[] | select(.name=="uat-wt213-src-copy") | .worktreePath')`
  3. `tmux display -p -t 'conductor:uat-wt213-src-copy' '#{pane_current_path}'`
  4. `tmux display -p -t 'conductor:uat-wt213-src' '#{pane_current_path}'`
  5. `git -C "$UAT_REPO" status --porcelain`
  6. `git -C "$UAT_REPO" rev-parse --abbrev-ref HEAD`
- **Expected Result**: Step 3 prints exactly `$UAT_C1_WT` (the `<repo>-worktrees/<cloneId>` path, not `$UAT_REPO`). Step 4 prints `$UAT_REPO` (the worktree-less source's window still starts in its workdir). Step 5 prints nothing (source working tree clean; no untracked or modified files from the clone). Step 6 prints `main` (the source repo's checked-out branch is unchanged; the clone's `conductor/<id>` branch lives only in its worktree). The `sleep 3600` process in the clone's pane confirms the launch command ran there: `tmux capture-pane -p -t 'conductor:uat-wt213-src-copy' | head -5` shows the `CONDUCTOR_AGENT_NAME='uat-wt213-src-copy' ... sleep 3600` line.
- **Repeatable Unit Test**: Not applicable: needs a live tmux session and real `new-window -c` behaviour; the path arithmetic is unit-backed by UAT-EDGE-001..004
- [FAIL: auto-judge: prerequisite not satisfied — live tmux/fixture agents not available for this run (depends on UAT-API-001); no unit-backed evidence channel] <!-- 2026-09-20 -->

---

### UAT-API-002: POST clone with the flag on a non-git workdir returns 400 with the reason and leaves no clone row
- **Endpoint**: `POST /api/agents/:id/clone`
- **Description**: A forced clone that cannot get a worktree fails loudly instead of silently returning two agents on one directory. `WorktreeError('not-git-repo')` maps to 400 via `worktreeErrorStatus`, body `{ error: message }`.
- **Steps**:
  1. Record the agent count first: `curl -sS 'http://localhost:8788/api/status' | jq '.agents | length'`
  2. Run the curl command below as-is.
  3. Record the agent count again with the same curl.
- **Command**:
  ```bash
  curl -sS -i -X POST "http://localhost:8788/api/agents/$UAT_NONREPO_ID/clone" -H 'Content-Type: application/json' -d '{"forceWorktree":true}'
  ```
- **Expected Result**: Status line `HTTP/1.1 400 Bad Request` and body `{"error":"workdir <$UAT_NONREPO> is not inside a git repository"}` (the message names the fixture path). The agent count is unchanged, `GET /api/status` has no `uat-wt213-nonrepo-copy` agent, and `tmux list-windows -t conductor -F '#{window_name}'` has no `uat-wt213-nonrepo-copy` window. A **201** here means the server is stale (see Prerequisites) or the flag is being ignored: fail the case.
- **Repeatable Unit Test**: Not applicable: HTTP status/body mapping is live-only; the throw and the "no row left" guarantee are unit-backed by UAT-EDGE-008
- [FAIL: auto-judge: prerequisite not satisfied — live fixture agent uat-wt213-nonrepo not created and host-server not restarted (forbidden by orchestrator); no unit-backed evidence channel] <!-- 2026-09-20 -->

---

### UAT-API-003: POST clone with the flag when `git worktree add` fails returns 500 with git's reason, no clone row, no directory
- **Endpoint**: `POST /api/agents/:id/clone`
- **Description**: `WorktreeError('git-failed')` maps to 500. The fixture repo's `-worktrees` sibling is a regular file, so `git worktree add` fails with a real git reason that must reach the response body verbatim (after `extractGitReason`).
- **Steps**:
  1. Confirm the blocker is still a file: `test -f "$UAT_BLOCKED-worktrees" && echo file`
  2. Record the agent count: `curl -sS 'http://localhost:8788/api/status' | jq '.agents | length'`
  3. Run the curl command below as-is.
  4. Record the agent count again, then run `git -C "$UAT_BLOCKED" worktree list`.
- **Command**:
  ```bash
  curl -sS -i -X POST "http://localhost:8788/api/agents/$UAT_BLOCKED_ID/clone" -H 'Content-Type: application/json' -d '{"forceWorktree":true}'
  ```
- **Expected Result**: Status line `HTTP/1.1 500 Internal Server Error` and body `{"error":"failed to create git worktree at <$UAT_BLOCKED>-worktrees/<n>: could not create leading directories of '<...>/.git': Not a directory"}` (the exact git wording may vary by git version, but the message must start with `failed to create git worktree at` and end with git's real reason, not a generic string). The agent count is unchanged, no `uat-wt213-blocked-copy` agent or window exists, and `git worktree list` shows only the repo root.
- **Repeatable Unit Test**: Not applicable: HTTP status/body mapping is live-only; the rollback is unit-backed by UAT-EDGE-009
- [FAIL: auto-judge: prerequisite not satisfied — live fixture agent uat-wt213-blocked not created and host-server not restarted (forbidden by orchestrator); no unit-backed evidence channel] <!-- 2026-09-20 -->

---

### UAT-API-004: After a failed forced clone, fixing the cause and retrying succeeds (the failed attempt leaves no residue)
- **Endpoint**: `POST /api/agents/:id/clone`
- **Description**: A failed forced clone must be a clean rollback. Agent ids are `INTEGER PRIMARY KEY` without `AUTOINCREMENT`, so the id freed by the rolled-back row is reused by the next agent, and its branch name `conductor/<id>` is derived from that id. Any branch the failed `git worktree add -b` left behind would make the retry (and the next unrelated forced clone or worktree-backed agent to receive that id) fail with "already exists". **Suspected gap, see the report:** in the probe run during generation, git created the branch `conductor/<n>` before failing on the directory and `createAgent`'s rollback only removes the row and the directory, so this case is expected to expose a stray branch.
- **Steps**:
  1. Directly after UAT-API-003, inspect residue: `git -C "$UAT_BLOCKED" branch --list 'conductor/*'`
  2. Remove the blocker: `rm "$UAT_BLOCKED-worktrees"`
  3. Run the curl command below as-is.
  4. Export the clone id: `export UAT_C2_ID=<the .agent.id from the response>`
- **Command**:
  ```bash
  curl -sS -i -X POST "http://localhost:8788/api/agents/$UAT_BLOCKED_ID/clone" -H 'Content-Type: application/json' -d '{"forceWorktree":true}'
  ```
- **Expected Result**: Step 1 prints nothing (no `conductor/*` branch is left by the failed attempt). Step 3 returns `HTTP/1.1 201 Created` with `agent.worktreePath` under `$UAT_BLOCKED-worktrees/` and `agent.branch` `conductor/<agent.id>`. If step 1 lists a stray `conductor/<n>` branch, or step 3 returns 500 with `already exists`, fail the case and record the leftover branch. Do not delete the stray branch to make the retry pass.
- **Repeatable Unit Test**: Blocked: promotable (a `db.migration.test.ts` case that forces the `worktree add` failure through an unwritable/non-directory sibling parent instead of a pre-created branch, then asserts `git branch --list 'conductor/*'` is empty and a retry succeeds), but not added by this run: the generating agent was told not to edit source or test files while other agents edit `host-server/` concurrently, and the case is expected to fail against the current implementation. Add it alongside the fix.
- [FAIL: auto-judge: prerequisite not satisfied — live fixtures/host-server restart unavailable (forbidden by orchestrator); Repeatable Unit Test field is still "Blocked:" so not unit-backed here, though the newly added db.migration.test.ts branch-leak test (run with the EDGE-009 pattern) passed] <!-- 2026-09-20 -->

---

### UAT-API-005: POST clone with no body (and with `{}`) on a worktree-less git source returns 201 with no worktree (unchanged behaviour)
- **Endpoint**: `POST /api/agents/:id/clone`
- **Description**: The flag is optional. The plain dashboard "Clone" request has no body and no `Content-Type`; the route must still accept it, and a clone of a worktree-less source must not get a worktree.
- **Steps**:
  1. Run the curl command below as-is (no `-d`, no header).
  2. Export the clone id: `export UAT_C3_ID=<the .agent.id from the response>` (its name is `uat-wt213-src-copy-2`, because `uat-wt213-src-copy` is taken).
  3. Repeat with an explicit empty object and export its id as `UAT_C4_ID`: `curl -sS -i -X POST "http://localhost:8788/api/agents/$UAT_SRC_ID/clone" -H 'Content-Type: application/json' -d '{}'`
  4. `tmux display -p -t 'conductor:uat-wt213-src-copy-2' '#{pane_current_path}'`
- **Command**:
  ```bash
  curl -sS -i -X POST "http://localhost:8788/api/agents/$UAT_SRC_ID/clone"
  ```
- **Expected Result**: Both requests return `HTTP/1.1 201 Created` with `agent.worktreePath` `null` and `agent.branch` `null`, `agent.workdir` equal to `$UAT_REPO`. Step 4 prints `$UAT_REPO`: without a worktree the window starts in the workdir, exactly as before.
- **Repeatable Unit Test**: Not applicable: exercises bodiless-request handling in the Fastify route; the underlying "no flag keeps worktree-ness" logic is unit-backed by UAT-EDGE-007 and the client's bodiless request by UAT-EDGE-011
- [FAIL: auto-judge: prerequisite not satisfied — live fixture agent uat-wt213-src not created and host-server not restarted (forbidden by orchestrator); no unit-backed evidence channel] <!-- 2026-09-20 -->

---

### UAT-API-006: Forced clone of a worktree-backed source returns 201 with a second, distinct worktree off the base branch
- **Endpoint**: `POST /api/agents/:id/clone`
- **Description**: The clone from UAT-API-001 (`uat-wt213-src-copy`, id `$UAT_C1_ID`) already has a worktree. Forcing a clone of it must create a separate fresh worktree and branch, not reuse or copy the source's.
- **Steps**:
  1. Run the curl command below as-is.
  2. Export the clone id: `export UAT_C5_ID=<the .agent.id from the response>` (its name is `uat-wt213-src-copy-copy`).
  3. `git -C "$UAT_REPO" worktree list`
  4. Base check: `git -C "$UAT_REPO" merge-base --is-ancestor main "conductor/$UAT_C5_ID" && echo based-on-main`
- **Command**:
  ```bash
  curl -sS -i -X POST "http://localhost:8788/api/agents/$UAT_C1_ID/clone" -H 'Content-Type: application/json' -d '{"forceWorktree":true}'
  ```
- **Expected Result**: `HTTP/1.1 201 Created`; `agent.worktreePath` is `$UAT_REPO-worktrees/<agent.id>` (a different path from `$UAT_C1_WT`) and `agent.branch` is `conductor/<agent.id>` (different from the source clone's branch). Step 3 lists the repo root, the UAT-API-001 worktree, and this new worktree. Step 4 prints `based-on-main`. The new worktree contains no uncommitted work from the source clone's worktree (`git -C <new worktreePath> status --porcelain` prints nothing).
- **Repeatable Unit Test**: Not applicable: HTTP wiring; the distinct-worktree logic is unit-backed by UAT-EDGE-006
- [FAIL: auto-judge: prerequisite not satisfied — live fixtures/host-server restart unavailable (forbidden by orchestrator; depends on UAT-API-001); no unit-backed evidence channel] <!-- 2026-09-20 -->

---

### UAT-INT-002: A respawned window for an existing worktree-backed agent starts inside its worktree
- **Scenario**: The `spawnAgentWindow` cwd fix also changes `POST /agents/:id/window` for existing worktree agents. Kill the UAT-API-001 clone's window and respawn it; the new window must start in the worktree, not the repo root.
- **Steps**:
  1. `tmux kill-window -t 'conductor:uat-wt213-src-copy'`
  2. `curl -sS -i -X POST "http://localhost:8788/api/agents/$UAT_C1_ID/window"`
  3. Wait about 2 seconds, then: `tmux display -p -t 'conductor:uat-wt213-src-copy' '#{pane_current_path}'`
- **Expected Result**: Step 2 returns `HTTP/1.1 201 Created` with `{"ok":true,"action":"spawned",...}`. Step 3 prints `$UAT_C1_WT` (the worktree path), not `$UAT_REPO`. `GET /api/status` shows `uat-wt213-src-copy` with `windowPresent: true`.
- **Repeatable Unit Test**: Not applicable: needs a live tmux session
- [FAIL: auto-judge: prerequisite not satisfied — live tmux/fixture agents not available for this run (depends on UAT-API-001); no unit-backed evidence channel] <!-- 2026-09-20 -->
