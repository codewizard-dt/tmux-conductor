---
id: UAT-063
aliases: [UAT-063]
title: "UAT: Worktree teardown — git worktree remove --force on agent delete"
status: passed
task: TASK-063
created: 2026-07-06
updated: 2026-08-15
---

# UAT-063 — UAT: Worktree teardown — git worktree remove --force on agent delete

implements::[[TASK-063]]

> **Source task**: [[TASK-063]]
> **Generated**: 2026-07-06
> **Route note**: all routes are registered under the `/api` prefix (`host-server/index.ts:2017`), so the live route under test is `DELETE /api/agents/:id`; agent creation for fixtures goes through `POST /api/agents`.
> **Implementation note**: the actual worktree-teardown composition (read `entry.worktreePath`/`entry.branch` → `removeWorktree` → `deleteBranch`, all inside a non-throwing try/catch, followed unconditionally by `deleteAgent`) lives inline in the `DELETE /agents/:id` Fastify handler (`host-server/index.ts:1217-1266`), not as a separately exported function — so the end-to-end delete behavior below can only be verified by driving the real HTTP route against a live host-server, not by a unit test. The underlying git primitives it calls (`removeWorktree`, `deleteBranch` in `host-server/git.ts`) *are* pure enough to unit test and were promoted (see each case's "Repeatable Unit Test" line).

---

## Prerequisites

- [ ] Host-server running on `http://127.0.0.1:8788` (`make dev` or `npm --prefix host-server run dev`)
- [ ] The conductor tmux session is running under the name configured in `conductor.conf` (`SESSION_NAME`, default `conductor`) — `POST /api/agents` returns `409 { error: "session not running" }` otherwise. A bare `tmux new-session -d -s conductor` is sufficient; the full `conductor.sh` launch is not required for these tests.
- [ ] `jq` installed
- [ ] From the repo root, build two fixture git repos under the repo-local `./tmp/` (never `/tmp`, per this repo's convention) — each gets its own repo so worktree/branch registrations from one test never interfere with another:
  ```bash
  mkdir -p tmp/uat063-fixture-happy && cd tmp/uat063-fixture-happy \
    && git init -q -b main && git -c user.email=uat@test.local -c user.name=UAT commit -q --allow-empty -m init && cd -
  ```
  ```bash
  mkdir -p tmp/uat063-fixture-locked && cd tmp/uat063-fixture-locked \
    && git init -q -b main && git -c user.email=uat@test.local -c user.name=UAT commit -q --allow-empty -m init && cd -
  ```
- [ ] A non-git absolute path for the "no worktree" case — `/tmp/uat063-nogit-<random>` (outside this repo's working tree, so `git -C <path> rev-parse --show-toplevel` fails and `createAgent` leaves `worktree_path`/`branch` NULL). No need to pre-create the directory; `POST /api/agents` does not require the workdir to exist on disk.
- [ ] Cleanup after every test: `DELETE /api/agents/:id` for every throwaway agent still present, and `rm -rf tmp/uat063-fixture-*` when done. UAT-EDGE-001 additionally requires manually unlocking/removing its worktree (see that test's cleanup step) since the locked worktree is expected to survive the DELETE call.

---

## Test Cases

### UAT-API-001: Deleting an agent with a worktree removes the worktree directory and its branch
- **Endpoint**: `DELETE /api/agents/:id` (preceded by `POST /api/agents`)
- **Description**: When an agent's `workdir` sits inside a git repo, `createAgent` auto-provisions a worktree at `<gitRoot>/worktrees/<id>` on branch `conductor/<id>` (TASK-061). Deleting that agent must run `git worktree remove --force` and `git branch -D`, leaving neither the directory nor the branch behind.
- **Steps**:
  1. Create the agent against the happy-path fixture repo:
     ```bash
     curl -sS -X POST 'http://127.0.0.1:8788/api/agents' -H 'Content-Type: application/json' -d "{\"name\":\"uat063happy\",\"workdir\":\"$(pwd)/tmp/uat063-fixture-happy\",\"launchCmd\":\"sleep 300\"}"
     ```
  2. From the response, note `agent.id` (`<HID>`), `agent.worktreePath`, and `agent.branch`. Confirm `worktreePath` matches `.../tmp/uat063-fixture-happy/worktrees/<HID>` and `branch` equals `conductor/<HID>` (non-null — this confirms the fixture is set up correctly before testing the delete path).
  3. Confirm the worktree and branch exist on disk/in git before deleting:
     ```bash
     test -d "$(pwd)/tmp/uat063-fixture-happy/worktrees/$HID" && echo "worktree dir present"
     ```
  4. Run the delete command below as-is (substitute `$HID`).
  5. After the delete, confirm the directory is gone and the branch is gone:
     ```bash
     test -d "$(pwd)/tmp/uat063-fixture-happy/worktrees/$HID" || echo "worktree dir removed"
     git -C "$(pwd)/tmp/uat063-fixture-happy" branch --list "conductor/$HID"
     ```
- **Command**:
  ```bash
  curl -sS -X DELETE "http://127.0.0.1:8788/api/agents/$HID"
  ```
- **Expected Result**: The DELETE call returns `200 { "ok": true, "removed": "uat063happy" }`. Step 5's `test -d` prints "worktree dir removed" (directory gone). `git branch --list "conductor/$HID"` prints nothing (branch gone). A follow-up `GET /api/agents` no longer lists `$HID`.
- **Repeatable Unit Test**: Created: `host-server/git.test.ts` (`removeWorktree removes a registered worktree and its directory`, `deleteBranch deletes an existing, non-checked-out branch`) — these cover the two git primitives the route composes; the HTTP-level composition itself is integration-only (see the file's Implementation note).
- [x] Pass <!-- 2026-08-15 -->

### UAT-API-002: Deleting an agent with `worktree_path = NULL` succeeds with no git errors
- **Endpoint**: `DELETE /api/agents/:id` (preceded by `POST /api/agents`)
- **Description**: Agents whose `workdir` is not inside a git repo never get a worktree (`createAgent` leaves `worktree_path`/`branch` NULL). The delete route's `if (entry.worktreePath)` guard must skip git cleanup entirely and still delete the DB row cleanly.
- **Steps**:
  1. Create the agent against a non-git workdir:
     ```bash
     curl -sS -X POST 'http://127.0.0.1:8788/api/agents' -H 'Content-Type: application/json' -d '{"name":"uat063nogit","workdir":"/tmp/uat063-nogit-fixture","launchCmd":"sleep 300"}'
     ```
  2. From the response, note `agent.id` (`<NID>`). Confirm `agent.worktreePath` and `agent.branch` are both `null`.
  3. Run the delete command below as-is (substitute `$NID`).
- **Command**:
  ```bash
  curl -sS -X DELETE "http://127.0.0.1:8788/api/agents/$NID"
  ```
- **Expected Result**: `200 { "ok": true, "removed": "uat063nogit" }` with no 5xx, no error body, and no worktree-cleanup warning in the host-server's stdout/log for this agent (nothing to warn about — the `if (entry.worktreePath)` block never executes). A follow-up `GET /api/agents` no longer lists `$NID`.
- **Repeatable Unit Test**: Created: `host-server/db.migration.test.ts` (`TASK-063: createAgent leaves worktreePath and branch null when workdir is not inside a git repository`) — covers the precondition (non-git workdir → NULL columns) that makes the route's guard a no-op; the route's guard itself is a one-line conditional with no independent logic to isolate, so the HTTP-level no-op path stays UAT-only.
- [x] Pass <!-- 2026-08-15 -->

### UAT-EDGE-001: A git error during worktree cleanup does not block the DB delete
- **Scenario**: `git worktree remove --force <path>` fails (non-zero exit) — e.g. the worktree is locked, so a single `--force` is insufficient (git requires `-f -f` to override a lock; verified directly: `git worktree remove --force <locked-path>` exits 128 with `fatal: cannot remove a locked working tree`). The route must log the failure via `console.warn` and never throw, so `deleteAgent` (which sits after the try/catch, unconditionally) still runs and the DB row is removed regardless.
- **Steps**:
  1. Create the agent against the locked-fixture repo:
     ```bash
     curl -sS -X POST 'http://127.0.0.1:8788/api/agents' -H 'Content-Type: application/json' -d "{\"name\":\"uat063locked\",\"workdir\":\"$(pwd)/tmp/uat063-fixture-locked\",\"launchCmd\":\"sleep 300\"}"
     ```
  2. Note `agent.id` (`<LID>`) and `agent.worktreePath` from the response.
  3. Lock the worktree so `git worktree remove --force` will fail:
     ```bash
     git -C "$(pwd)/tmp/uat063-fixture-locked" worktree lock "$(pwd)/tmp/uat063-fixture-locked/worktrees/$LID"
     ```
  4. Run the delete command below as-is (substitute `$LID`).
  5. Confirm the DB row is actually gone despite the git failure:
     ```bash
     curl -sS 'http://127.0.0.1:8788/api/agents' | jq "map(select(.id == $LID)) | length"
     ```
  6. Confirm the worktree directory is still present on disk (the failed git op left it in place — this is what proves the error path was actually exercised, not skipped):
     ```bash
     test -d "$(pwd)/tmp/uat063-fixture-locked/worktrees/$LID" && echo "locked worktree dir survived, as expected"
     ```
  7. Cleanup (manual, since the route intentionally leaves a failed cleanup for a human/operator to resolve):
     ```bash
     git -C "$(pwd)/tmp/uat063-fixture-locked" worktree unlock "$(pwd)/tmp/uat063-fixture-locked/worktrees/$LID" \
       && git -C "$(pwd)/tmp/uat063-fixture-locked" worktree remove --force "$(pwd)/tmp/uat063-fixture-locked/worktrees/$LID"
     ```
- **Command**:
  ```bash
  curl -sS -X DELETE "http://127.0.0.1:8788/api/agents/$LID"
  ```
- **Expected Result**: The DELETE call still returns `200 { "ok": true, "removed": "uat063locked" }` despite the underlying `git worktree remove --force` failing. Step 5 prints `0` (agent row gone from the DB). Step 6 prints "locked worktree dir survived, as expected" (the failed git op did not remove it — confirming the try/catch swallowed a real failure rather than the worktree happening to be absent for some other reason). The host-server log shows a `[conductor] DELETE /agents/<LID>: git worktree remove failed for ...` warning (visible in whatever terminal/log is running the host-server process) but no crash/500.
- **Repeatable Unit Test**: Created: `host-server/git.test.ts` (`removeWorktree returns false (without throwing) and leaves the directory when the worktree is locked`) — covers the exact git-failure primitive this scenario exercises; the route's "log-but-don't-throw, delete-unconditionally" composition around it is integration-only (see the file's Implementation note).
- [x] Pass <!-- 2026-08-15 -->

---

## Coverage vs Acceptance Criteria

| Acceptance criterion | Covered by |
|---|---|
| Deleting an agent with a `worktree_path` removes the worktree directory and branch | UAT-API-001 |
| Deleting an agent with `worktree_path = NULL` succeeds silently with no git errors | UAT-API-002 |
| A git error during cleanup does not block the DB delete (agent row is always removed) | UAT-EDGE-001 |
| `npx tsc --noEmit` passes in `host-server/` | Already checked off in [[TASK-063]] step 4 (re-verified independently by the orchestrator); not re-run here as a separate UAT case since it carries no new runtime behavior beyond what step 4 already confirmed. |
