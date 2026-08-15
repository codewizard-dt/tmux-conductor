---
id: UAT-061
title: "UAT: Worktree spawn — detect git repo on agent spawn, create worktree + branch, store in DB"
status: passed
task: TASK-061
created: 2026-07-06
updated: 2026-07-06
---

# UAT-061 — UAT: Worktree spawn — detect git repo on agent spawn, create worktree + branch, store in DB

implements::[[TASK-061]]

> **Source task**: [[TASK-061]]
> **Generated**: 2026-07-06
> **Note**: `POST /agents` and `GET /agents` are registered under the `/api` prefix (`host-server/index.ts:1988`), so the live routes are `/api/agents`. `createAgent` (`host-server/db.ts`) now calls `getGitRoot`/`createWorktree` (`host-server/git.ts`) synchronously inside the request handler — worktree creation happens before the `201` response is sent, so no polling/eventual-consistency wait is needed in these tests.

---

## Prerequisites

- [ ] Host-server running on `http://127.0.0.1:8788` (`make dev` or `npm --prefix host-server run dev`)
- [ ] The conductor tmux session is running (`POST /agents` returns `409 { error: "session not running" }` otherwise — start it via `POST /api/session/start` or `make dev`'s conductor bootstrap)
- [ ] A scratch git repo to use as a git `workdir` fixture, e.g. `mkdir -p /tmp/uat061-fixture && cd /tmp/uat061-fixture && git init -b main && git commit --allow-empty -m init` (any absolute path git repo works; do not point `workdir` at the tmux-conductor repo itself — that would leave a stray `worktrees/`/`conductor/*` branch in this repo)
- [ ] `jq` installed
- [ ] Cleanup after every test: `DELETE /api/agents/:id` for every throwaway agent created, and `git -C <fixture-repo> worktree remove --force <path>` for any worktree left behind if the DELETE route doesn't clean it up (TASK-063, worktree teardown, is a separate not-yet-implemented task — worktree directories are NOT removed on agent delete as of this task)

---

## Test Cases

### UAT-API-001: Spawning an agent with a git workdir creates a worktree and branch
- **Endpoint**: `POST /api/agents`
- **Description**: When `workdir` is inside a git repo, the response's `agent.worktreePath`/`agent.branch` are populated, a `worktrees/<id>/` directory exists under the repo root, and a `conductor/<id>` branch exists in the repo.
- **Steps**:
  1. Create an agent pointed at the git fixture repo (adjust `workdir` to your fixture path and ensure the tmux window name `uat061-git` doesn't already exist):
     ```bash
     curl -sS -X POST 'http://127.0.0.1:8788/api/agents' -H 'Content-Type: application/json' -d '{"name":"uat061-git","workdir":"/tmp/uat061-fixture","launchCmd":"bash"}'
     ```
  2. Note the returned `agent.id` (call it `<GID>`) and `agent.worktreePath`
  3. Confirm the branch exists: `git -C /tmp/uat061-fixture branch --list "conductor/$GID"`
  4. Confirm the worktree directory exists: `test -d /tmp/uat061-fixture/worktrees/$GID && echo present`
  5. Teardown:
     ```bash
     curl -sS -X DELETE "http://127.0.0.1:8788/api/agents/$GID"
     ```
- **Expected Result**: HTTP 201; response body has `agent.worktreePath` equal to `/tmp/uat061-fixture/worktrees/<GID>` and `agent.branch` equal to `conductor/<GID>` (both non-null strings); `git branch --list` shows `conductor/<GID>`; `worktrees/<GID>/` exists on disk.
- **Repeatable Unit Test**: Created: `host-server/git.test.ts` (`createWorktree adds a new worktree and branch off the detected base branch`) — covers the `git.ts` helper directly; the DB round-trip (`createAgent` → `UPDATE` → `mapAgent` → `Agent.worktreePath`/`branch`) requires the live route (Fastify routes are registered inline with no injectable app export) and is verified here only.
- [x] Pass <!-- 2026-07-06 -->

### UAT-API-002: Spawning an agent with a non-git workdir leaves worktree_path/branch NULL
- **Endpoint**: `POST /api/agents`
- **Description**: When `workdir` is not inside a git work tree, the agent is created normally (no error) and `agent.worktreePath`/`agent.branch` are `null`.
- **Steps**:
  1. Create an agent with a non-git workdir (a plain directory with no `.git`, e.g. `/tmp`):
     ```bash
     curl -sS -X POST 'http://127.0.0.1:8788/api/agents' -H 'Content-Type: application/json' -d '{"name":"uat061-nongit","workdir":"/tmp","launchCmd":"bash"}'
     ```
  2. Note the returned `agent.id` (call it `<NID>`)
  3. Teardown:
     ```bash
     curl -sS -X DELETE "http://127.0.0.1:8788/api/agents/$NID"
     ```
- **Expected Result**: HTTP 201; response body has `agent.worktreePath: null` and `agent.branch: null`; no error is thrown, agent creation succeeds like before this task.
- **Repeatable Unit Test**: Created: `host-server/git.test.ts` (`getGitRoot returns null for a directory that is not inside a git work tree`) — covers the detection helper; the end-to-end "agent still creates successfully" behavior needs the live route and is verified here only.
- [x] Pass <!-- 2026-07-06 -->

### UAT-API-003: GET /api/agents reflects worktreePath/branch for a git-workdir agent
- **Endpoint**: `GET /api/agents`
- **Description**: The list endpoint (which also runs through `mapAgent`) surfaces the same `worktreePath`/`branch` fields for a previously created git-workdir agent, confirming the fields round-trip through the DB and not just the creation response.
- **Steps**:
  1. Create a git-workdir agent as in UAT-API-001, note `<GID>` and its `worktreePath`/`branch`
  2. Run the command below
  3. Teardown: `curl -sS -X DELETE "http://127.0.0.1:8788/api/agents/$GID"`
- **Command**:
  ```bash
  curl -sS 'http://127.0.0.1:8788/api/agents' | jq --arg id "$GID" '.[] | select((.id|tostring) == $id) | {worktreePath, branch}'
  ```
- **Expected Result**: HTTP 200; the selected agent's `worktreePath`/`branch` match the values returned by the original `POST` response exactly (non-null, `.../worktrees/<GID>` and `conductor/<GID>`).
- **Repeatable Unit Test**: Not applicable: cross-route HTTP integration (`mapAgent` DB round-trip via a second endpoint) over the live server.
- [x] Pass <!-- 2026-07-06 -->

### UAT-EDGE-001: Worktree creation failure does not abort agent creation
- **Scenario**: `git worktree add` fails (e.g. the target `worktrees/<id>` path already exists as a non-empty non-worktree directory, or the branch name is already taken) — the agent row must still be created successfully with `worktree_path`/`branch` left `NULL`, per the task's "on git failure, log a warning but do not abort" requirement.
- **Steps**:
  1. Pre-create a colliding branch name in the fixture repo, then create an agent whose computed `id` (unpredictable ahead of time — DB auto-increment) may or may not collide with an existing branch; for a deterministic version, pre-create the worktree parent path as a plain file (a git failure mode that reliably reproduces without needing to predict the DB id):
     ```bash
     mkdir -p /tmp/uat061-fixture/worktrees && touch /tmp/uat061-fixture/worktrees/PLACEHOLDER
     ```
     then note the next agent's id after creation and confirm `git worktree add` for that exact target path was never attempted to collide with a *file* named after the id — see the unit test below for the deterministic form of this scenario (branch-already-exists), which is exercised without needing to predict IDs.
  2. Simplest deterministic reproduction: run the repeatable unit test below rather than trying to race the DB's auto-increment id through the live route.
- **Expected Result**: `createWorktree` returns `false` (verified in the unit test); at the route level, `createAgent`'s `try`-free `if (created) { UPDATE } else { console.warn }` branch means agent creation completes and returns `201` regardless of worktree outcome — never a `500`.
- **Repeatable Unit Test**: Created: `host-server/git.test.ts` (`createWorktree returns false when the branch already exists`) — this is the deterministic, id-independent form of "worktree creation fails"; the live-route id-prediction race described above is not a reliable manual repro and is intentionally not asserted as a curl step.
- [x] Pass <!-- 2026-07-06 -->

---

## Coverage vs Acceptance Criteria

| Acceptance criterion | Covered by |
|---|---|
| Spawning an agent with a git workdir creates `worktrees/<agent-id>/` and a `conductor/<agent-id>` branch | UAT-API-001 |
| `agents` row has `worktree_path`/`branch` populated for git-workdir agents | UAT-API-001, UAT-API-003 |
| Non-git workdirs: agent created normally; `worktree_path`/`branch` NULL; no error thrown | UAT-API-002 |
| Worktree creation failure is non-fatal (warning, not abort) | UAT-EDGE-001 (`host-server/git.test.ts`) |
| `npx tsc --noEmit` passes in `host-server/` | Static gate — verified during `/tackle` (not re-tested here) |
