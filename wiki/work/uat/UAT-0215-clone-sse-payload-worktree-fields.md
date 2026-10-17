---
id: UAT-0215
aliases: [UAT-0215]
title: "UAT: Include worktreePath and branch in the clone agent-update SSE payload"
status: pending
task: TASK-0215
created: 2026-09-20
updated: 2026-09-20
---

# UAT-0215 — UAT: Include worktreePath and branch in the clone agent-update SSE payload

implements::[[TASK-0215]]

> **Source task**: [[TASK-0215]]
> **Generated**: 2026-09-20

---

## Prerequisites

Cases are split by what they need. **EDGE cases need nothing but a checkout** (node/tsx and vitest installed; no server, no browser, no tmux, no agents). Each runs a file- and name-scoped command and is judged from its recorded output, so none depends on live fixture agents. **API cases need the live stack and throwaway fixture agents.** Every live case's logic is already unit-backed by an EDGE case, so a missing live fixture blocks only the API cases.

- [ ] (EDGE cases) `host-server/` and `frontend/` dependencies installed. Run commands from the repo root exactly as written (each starts with `cd` or `node -e`).
- [ ] (API cases) Dev stack running via `make dev` (host-server `http://localhost:8788`) **with the tmux conductor session alive** (`POST /api/agents` returns 409 `session not running` otherwise). The host-server must be **running code that includes TASK-0215** (`buildNewAgentUpdate` in the three creation routes); if it was started without file watching before the change, restart it. A stale process is a prerequisite failure, not a test failure.
- [ ] (API cases) Create the throwaway git repo and export its absolute path:
  ```bash
  mkdir -p ./tmp/uat-0215-repo && cd ./tmp/uat-0215-repo && git init -q -b main && git commit -q --allow-empty -m init && cd -
  ```
  ```bash
  export UAT_REPO="$PWD/tmp/uat-0215-repo"
  ```
- [ ] (API cases) Create two throwaway source agents in that repo, **without** a worktree. The launch command is a plain `sleep` so no real coding agent is started; the payload under test does not depend on the agent's liveness:
  ```bash
  curl -sS -X POST 'http://localhost:8788/api/agents' -H 'Content-Type: application/json' -d "{\"name\":\"uat-wt215-a\",\"workdir\":\"$UAT_REPO\",\"launchCmd\":\"sleep 3600\"}" | jq '{ok, id: .agent.id, worktreePath: .agent.worktreePath}'
  ```
  ```bash
  curl -sS -X POST 'http://localhost:8788/api/agents' -H 'Content-Type: application/json' -d "{\"name\":\"uat-wt215-b\",\"workdir\":\"$UAT_REPO\",\"launchCmd\":\"sleep 3600\"}" | jq '{ok, id: .agent.id, worktreePath: .agent.worktreePath}'
  ```
  Both print `"ok": true` and `"worktreePath": null`. Then export their ids:
  ```bash
  export UAT_A_ID=$(curl -sS 'http://localhost:8788/api/status' | jq '.agents[] | select(.name=="uat-wt215-a") | .id')
  ```
  ```bash
  export UAT_B_ID=$(curl -sS 'http://localhost:8788/api/status' | jq '.agents[] | select(.name=="uat-wt215-b") | .id')
  ```
- [ ] (API cases) **Live cases use throwaway agents only. Never clone, create a worktree for, stop or destroy a real agent.** Cases use disjoint agent names (`uat-wt215-a`/`-b`/`-c` and their `-copy` clones), so they can run in any order. Clone names are derived by the host as `<source>-copy`; a leftover `uat-wt215-*-copy` agent from an earlier run makes the derived name `-copy-2` and breaks the greps, so clean up first.
- [ ] (API cases) Cleanup after the run: Destroy `uat-wt215-a`, `uat-wt215-b`, `uat-wt215-c`, `uat-wt215-a-copy` and `uat-wt215-b-copy` from their actions menus in the dashboard (`http://localhost:4321/`), then `git -C ./tmp/uat-0215-repo worktree prune`, and delete `./tmp/uat-0215-repo`, `./tmp/uat-0215-repo-worktrees` (if present) and `./tmp/uat-0215-sse-*.txt`.

Source under test:
- `host-server/agentUpdatePayload.ts`: `buildNewAgentUpdate(agent, live)`, the pure builder of the one-shot `agent-update` body (`worktreePath: agent.worktreePath ?? null`, `branch: agent.branch ?? null`, `role`, `inGitRepo`, `context` spread last).
- `host-server/index.ts`: the three adoption sites, each `broadcastSSE('agent-update', buildNewAgentUpdate(newAgent, { … }))` in `POST /api/agents`, `POST /api/agents/:id/clone` (body `{ "forceWorktree": true }` from TASK-0213) and `POST /api/projects/:id/agents`; plus the untouched periodic `pollAndDiff` broadcast.
- `frontend/src/components/AgentList.tsx`: the SSE `agent-update` handler that merges known ids and appends unknown ones.

Coverage note: TASK-0215 Step 4's `[DEFERRED-TO-UAT]` item (subscribe with `curl -N`, clone with `forceWorktree`, confirm the first `agent-update` for the new id has `"worktreePath"` and `"branch"`) is UAT-API-001. The builder's contract is unit-backed by EDGE-001..003, the periodic body's untouched shape by EDGE-004, the three-site adoption by EDGE-005 (scripted; no committed test yet), and the frontend append path by EDGE-006. `POST /api/projects/:id/agents` has no live case: it uses the same builder call as the other two and its adoption is checked by EDGE-005.

Design decisions (autonomous run): the unit-backed cases use `--test-name-pattern` / `-t` filters so each judges exactly its own assertions; live cases are separate, and use `sleep 3600` as the fixture launch command so no real coding agent is spawned.

---

## Test Cases

### UAT-EDGE-001: A worktree-backed agent's one-shot update carries its worktreePath and branch
- **Scenario**: `buildNewAgentUpdate` must copy the agent's `worktreePath` and `branch` into the body. Before TASK-0215 the clone literal had neither, so a worktree-backed clone rendered badge-less.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: `a worktree-backed agent carries its worktreePath and branch` passes (`pass 1`, `fail 0`); the body's `worktreePath` equals `/repo/demo-wt/7` and `branch` equals `conductor/7`.
- **Repeatable Unit Test**: Created: `host-server/agentUpdatePayload.test.ts` (written by the TASK-0215 tackle; no new file written by this generation run)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern="worktree-backed agent carries" agentUpdatePayload.test.ts` (verified: pass 1, fail 0)
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-002: A non-worktree agent gets explicit null worktreePath and branch, keys present
- **Scenario**: For an agent with no worktree the body must still contain the `worktreePath` and `branch` keys, set to `null` (not omitted), so a client merging `{ ...existing, ...updated }` cannot keep a stale badge.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: `a non-worktree agent gets explicit null worktreePath/branch (keys present)` passes (`pass 1`, `fail 0`): both keys are present in the object and both equal `null`.
- **Repeatable Unit Test**: Created: `host-server/agentUpdatePayload.test.ts` (TASK-0215 tackle)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern="non-worktree agent gets explicit null" agentUpdatePayload.test.ts` (verified: pass 1, fail 0)
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-003: The body includes role, keeps the historical defaults, passes inGitRepo through and spreads context fields last
- **Scenario**: The builder must add `role` and `inGitRepo` without disturbing the fields the old clone literal carried: `queuedTasks` defaults to `0`, `activeTask` to `null`, `launchCmd`/`workdir`/`projectName` are copied from the agent, `inGitRepo` follows the live state (default `false`), and every `context` field (`model`, `contextPct`, `contextTokens`, ...) passes through untouched.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: `role is included`, `defaults match the historical clone literal and inGitRepo is passed through` and `context fields spread through untouched` pass (`pass 3`, `fail 0`).
- **Repeatable Unit Test**: Created: `host-server/agentUpdatePayload.test.ts` (TASK-0215 tackle)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern="role is included" --test-name-pattern="defaults match the historical" --test-name-pattern="context fields spread" agentUpdatePayload.test.ts` (verified: pass 3, fail 0)
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-004: The periodic pollAndDiff agent-update body still carries worktreePath, branch and role adjacently
- **Scenario**: TASK-0215 must not reorder or touch the periodic broadcast. The static source test regex-asserts `worktreePath`, `branch`, `role` adjacent in the `pollAndDiff` `broadcastSSE('agent-update', …)` call, so a refactor that folded that body into the new builder, or dropped a field, fails here.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: `pollAndDiff's periodic agent-update broadcast includes role, at parity with worktreePath/branch …` passes (`pass 1`, `fail 0`).
- **Repeatable Unit Test**: Created: `host-server/sseRolePayloadParity.test.ts` (pre-existing test, deliberately left valid by TASK-0215; no new file written by this generation run)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern="periodic agent-update broadcast" sseRolePayloadParity.test.ts` (verified: pass 1, fail 0)
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-005: All three creation routes broadcast through buildNewAgentUpdate (wiring check)
- **Scenario**: EDGE-001..003 prove the builder; nothing committed proves the routes still use it. If someone restores an inline literal in the clone route, every unit test stays green and the badge-less first event regresses silently. This check reads the source: the builder is imported, and exactly three `broadcastSSE('agent-update', buildNewAgentUpdate(newAgent, {` call sites exist (`POST /agents`, `POST /agents/:id/clone`, `POST /projects/:id/agents`).
- **Steps**:
  1. From the repo root, run the command below as-is.
- **Command**:
  ```bash
  node -e "const s=require('fs').readFileSync('host-server/index.ts','utf8');console.log(s.includes(\"import { buildNewAgentUpdate } from './agentUpdatePayload.ts'\"), (s.match(/broadcastSSE\('agent-update', buildNewAgentUpdate\(newAgent, \{/g)||[]).length)"
  ```
- **Expected Result**: Exactly `true 3` (verified at generation time). Any other output means an adoption site was lost or duplicated (FAIL).
- **Repeatable Unit Test**: Blocked: promotable in principle as a static assertion beside the existing regex checks in `host-server/sseRolePayloadParity.test.ts` (same pattern), but this generation run was restricted to wiki edits by the team lead. Add a `test('the three creation routes broadcast via buildNewAgentUpdate', …)` asserting the import and `match(/broadcastSSE\('agent-update', buildNewAgentUpdate\(newAgent, \{/g).length === 3` against `index.ts`; the scripted command above is the repeatable check until then.
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-006: An SSE agent-update for an unknown agent id appends it with its worktree badge, and a periodic-shaped follow-up keeps it
- **Scenario**: This is what the dashboard does with the clone's first event. The clone's id is unknown to `AgentList`, so the payload is appended verbatim; the sidebar row must show `⎇ conductor/35` from that first event, with `role` carried, and a following periodic-shaped update (`state: busy`, `queuedTasks: 1`) for the same id must keep the badge. Assertions are scoped to the sidebar (`complementary` region, name `Agents`).
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: `an SSE agent-update for an unknown agent id appends it with its worktree badge, and a periodic-shaped follow-up keeps it` passes (`Tests 1 passed`, the rest skipped).
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (TASK-0215 tackle, inside describe `AgentList worktree/branch propagation (TASK-0211)`; no new file written by this generation run)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "an SSE agent-update for an unknown agent id"` (verified: 1 passed, 201 skipped)
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-API-001: The first agent-update after a forced-worktree clone carries worktreePath, branch and role
- **Endpoint**: `POST /api/agents/:id/clone` with body `{"forceWorktree":true}`, observed on `GET /api/events` (SSE)
- **Description**: TASK-0215 Step 4 `[DEFERRED-TO-UAT]`. Proves end to end, with no browser, that the immediate event the host-server broadcasts from the clone route already includes the worktree fields, so no client ever sees a badge-less row. Source `uat-wt215-a` has no worktree, so the worktree exists only because of `forceWorktree`. Two terminals. The derived clone name is `uat-wt215-a-copy`.
- **Steps**:
  1. Terminal 1: start the listener below. It writes about 10 seconds of SSE to a repo-local file, then exits by itself.
  2. Terminal 2, within 3 seconds of starting the listener: run the clone command.
  3. When the listener exits, run the two checks below.
- **Command**:
  ```bash
  curl -sN -m 10 'http://localhost:8788/api/events' -o ./tmp/uat-0215-sse-1.txt
  ```
  ```bash
  curl -sS -X POST "http://localhost:8788/api/agents/$UAT_A_ID/clone" -H 'Content-Type: application/json' -d '{"forceWorktree":true}' | jq '{ok, name: .agent.name, branch: .agent.branch, hasPath: (.agent.worktreePath != null)}'
  ```
  ```bash
  grep -m1 -E '^data: \{"id":[0-9]+,"name":"uat-wt215-a-copy",' ./tmp/uat-0215-sse-1.txt | jq -R 'sub("^data: ";"") | fromjson | {id, name, role, branch, hasPath: (.worktreePath != null), inGitRepo, hasMode: has("mode"), hasState: has("state")}'
  ```
- **Expected Result**: The clone call prints `{"ok": true, "name": "uat-wt215-a-copy", "branch": "conductor/<clone id>", "hasPath": true}`. The `grep -m1` selects the **first** `agent-update` data line for the clone (the initial-connect resend was sent before the clone existed, so it cannot match) and the `jq` prints an object with `name` `uat-wt215-a-copy`, `branch` equal to `conductor/<clone id>` (same id as `id`), `hasPath: true`, a non-null `role`, `inGitRepo: true`, `hasMode: true` and `hasState: true`. An empty grep result means the event never arrived (FAIL, unless the host-server is stale; see prerequisites). A first event with `"branch":null` or a missing `worktreePath` key is the exact regression under test (FAIL). Do not assert the worktree path layout (owned by TASK-0212).
- **Repeatable Unit Test**: Not applicable: needs the running host-server, its tmux session, a DB agent row and a real git worktree; the body contract is covered offline by UAT-EDGE-001..003 and the route wiring by UAT-EDGE-005
- [FAIL: auto-judge: prerequisite not satisfied — live API fixtures (throwaway agents uat-wt215-a/-b, restarted host-server) not created; team lead forbade creating agents in the live DB or restarting the host-server] <!-- 2026-09-20 -->

---

### UAT-API-002: The first agent-update after a plain clone of a non-worktree agent carries explicit null worktree fields
- **Endpoint**: `POST /api/agents/:id/clone` (no body), observed on `GET /api/events` (SSE)
- **Description**: The negative counterpart of API-001. Source `uat-wt215-b` has no worktree and no `forceWorktree` is sent, so the clone has none. The first event must still carry the `worktreePath` and `branch` keys with `null` values (present, not omitted). The derived clone name is `uat-wt215-b-copy`.
- **Steps**:
  1. Terminal 1: start the listener below.
  2. Terminal 2, within 3 seconds: run the clone command.
  3. When the listener exits, run the check below.
- **Command**:
  ```bash
  curl -sN -m 10 'http://localhost:8788/api/events' -o ./tmp/uat-0215-sse-2.txt
  ```
  ```bash
  curl -sS -X POST "http://localhost:8788/api/agents/$UAT_B_ID/clone" | jq '{ok, name: .agent.name, branch: .agent.branch, worktreePath: .agent.worktreePath}'
  ```
  ```bash
  grep -m1 -E '^data: \{"id":[0-9]+,"name":"uat-wt215-b-copy",' ./tmp/uat-0215-sse-2.txt | jq -R 'sub("^data: ";"") | fromjson | {name, hasBranchKey: has("branch"), hasPathKey: has("worktreePath"), branch, worktreePath, hasRole: has("role")}'
  ```
- **Expected Result**: The clone call prints `{"ok": true, "name": "uat-wt215-b-copy", "branch": null, "worktreePath": null}`. The event check prints `hasBranchKey: true`, `hasPathKey: true`, `branch: null`, `worktreePath: null`, `hasRole: true`. `hasBranchKey: false` or `hasPathKey: false` means the keys were omitted instead of sent as `null` (FAIL).
- **Repeatable Unit Test**: Not applicable: needs the running host-server and tmux session; the explicit-null contract is covered offline by UAT-EDGE-002
- [FAIL: auto-judge: prerequisite not satisfied — live API fixtures (throwaway agent uat-wt215-b, restarted host-server) not created; team lead forbade creating agents in the live DB or restarting the host-server] <!-- 2026-09-20 -->

---

### UAT-API-003: The first agent-update after creating an agent with useWorktree carries worktreePath and branch
- **Endpoint**: `POST /api/agents` with `"useWorktree": true`, observed on `GET /api/events` (SSE)
- **Description**: TASK-0215 adopted the builder in `POST /api/agents` because its omission was the same bug. Creating a worktree-backed agent must broadcast a first event that already has `worktreePath` and `branch`. The agent name is `uat-wt215-c`.
- **Steps**:
  1. Terminal 1: start the listener below.
  2. Terminal 2, within 3 seconds: run the create command.
  3. When the listener exits, run the check below.
- **Command**:
  ```bash
  curl -sN -m 10 'http://localhost:8788/api/events' -o ./tmp/uat-0215-sse-3.txt
  ```
  ```bash
  curl -sS -X POST 'http://localhost:8788/api/agents' -H 'Content-Type: application/json' -d "{\"name\":\"uat-wt215-c\",\"workdir\":\"$UAT_REPO\",\"launchCmd\":\"sleep 3600\",\"useWorktree\":true}" | jq '{ok, name: .agent.name, branch: .agent.branch, hasPath: (.agent.worktreePath != null)}'
  ```
  ```bash
  grep -m1 -E '^data: \{"id":[0-9]+,"name":"uat-wt215-c",' ./tmp/uat-0215-sse-3.txt | jq -R 'sub("^data: ";"") | fromjson | {name, branch, hasPath: (.worktreePath != null), hasRole: has("role"), inGitRepo}'
  ```
- **Expected Result**: The create call prints `{"ok": true, "name": "uat-wt215-c", "branch": "conductor/<id>", "hasPath": true}` (the `-d` payload is double-quoted only so `$UAT_REPO` expands). The event check prints `name` `uat-wt215-c`, `branch` equal to `conductor/<id>`, `hasPath: true`, `hasRole: true`, `inGitRepo: true`. A first event with `branch: null` for a worktree-backed create is the regression (FAIL).
- **Repeatable Unit Test**: Not applicable: needs the running host-server, tmux session and a real git worktree; the body contract is covered offline by UAT-EDGE-001 and the route wiring by UAT-EDGE-005
- [FAIL: auto-judge: prerequisite not satisfied — live API fixtures (throwaway git repo, restarted host-server, agent creation with useWorktree) not created; team lead forbade creating agents in the live DB or restarting the host-server] <!-- 2026-09-20 -->
