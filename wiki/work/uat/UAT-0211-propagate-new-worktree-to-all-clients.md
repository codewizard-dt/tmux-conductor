---
id: UAT-0211
aliases: [UAT-0211]
title: "UAT: Propagate a newly created worktree/branch to all clients without a reload"
status: pending
task: TASK-0211
created: 2026-09-20
updated: 2026-09-20
---

# UAT-0211 — UAT: Propagate a newly created worktree/branch to all clients without a reload

implements::[[TASK-0211]]

> **Source task**: [[TASK-0211]]
> **Generated**: 2026-09-20

---

## Prerequisites

Cases are split by what they need. **EDGE cases need nothing but a checkout** (node/tsx and vitest installed; no server, no browser, no agents). Each runs a file- and name-scoped command and is judged from its recorded output, so they never depend on live fixture agents. **API and UI cases need the live stack, two browser windows and throwaway fixture agents.** Every live case's logic is already unit-backed by an EDGE case, so a missing live fixture blocks only the API/UI cases.

- [ ] (EDGE cases) `host-server/` and `frontend/` dependencies installed. Run commands from the repo root exactly as written (each starts with `cd`).
- [ ] (API/UI cases) Dev stack running via `make dev` (host-server `http://localhost:8788`, frontend `http://localhost:4321/`). The host-server must be **running code that includes TASK-0211** (`pollAndDiff` calling `agentSnapshotChanged`); if it was started without file watching before the change, restart it. A stale process is a prerequisite failure, not a test failure. The status tick is `STATUS_POLL_MS` (default 2000 ms; check `conductor.conf` if timings look off).
- [ ] (API/UI cases) Two independent browser windows on `http://localhost:4321/`: **Browser A** (acts) and **Browser B** (observes). Use a normal window plus a private/incognito window, or two different browsers, so they hold separate SSE connections. Neither may be reloaded during a case.
- [ ] (API/UI cases) Create fixtures. **Live cases must use throwaway agents only. Never click Create worktree, Clone, Stop or Destroy on a real agent.**
  ```bash
  mkdir -p ./tmp/uat-0211-repo && cd ./tmp/uat-0211-repo && git init -q -b main && git commit -q --allow-empty -m init && cd -
  ```
  Add two throwaway agents via the navbar `+ Add Agent` modal. Leave **Project** unselected (free-form path), keep the default launch command, enter an ABSOLUTE workdir of `<repo root>/tmp/uat-0211-repo`, and leave "Use a git worktree" (Advanced) UNCHECKED for both:
  - **A** `uat-wt211-a`
  - **B** `uat-wt211-b`
  Then export their ids:
  ```bash
  export UAT_A_ID=$(curl -sS 'http://localhost:8788/api/status' | jq '.agents[] | select(.name=="uat-wt211-a") | .id')
  export UAT_B_ID=$(curl -sS 'http://localhost:8788/api/status' | jq '.agents[] | select(.name=="uat-wt211-b") | .id')
  ```
  Neither agent may have a worktree at the start: `curl -sS 'http://localhost:8788/api/status' | jq '.agents[] | select(.name|startswith("uat-wt211")) | {name, branch, worktreePath}'` must show `null` for both.
- [ ] Live cases are stateful. Run them in this order: UI-001 (consumes A's worktree), API-001 (consumes B's worktree), UI-002 (uses B's worktree). Do not reload either browser between cases; reloading would hide the exact failure being tested.
- [ ] Cleanup after the run: Destroy `uat-wt211-a` and `uat-wt211-b` from their actions menus, then `git -C ./tmp/uat-0211-repo worktree prune`, and delete `./tmp/uat-0211-repo`, `./tmp/uat-0211-repo-worktrees` (if present) and `./tmp/uat-0211-sse.txt`.

Source under test:
- `host-server/agentDiff.ts`: `agentSnapshotChanged(prev, next)` and `DiffableAgent` (pure predicate; includes `worktreePath` and `branch`).
- `host-server/index.ts`: `pollAndDiff` (`if (agentSnapshotChanged(prev, agent))` gate, then `broadcastSSE('agent-update', { …, worktreePath, branch, role, … })`), and the comment on `POST /api/agents/:id/worktree` (no direct broadcast; the periodic diff carries it).
- `frontend/src/components/AgentList.tsx`: `AgentDetailView` prop `onWorktreeCreated`, `handleCreateWorktree` (calls it after `setWorktreeOverride`), and the `AgentList` handler that patches `agents` state.

Coverage note: TASK-0211 Step 4's `[DEFERRED-TO-UAT]` item (two browsers, no reload) is UAT-UI-001. The predicate's worktree clauses are unit-backed (EDGE-001), a dropped-clause regression is guarded by EDGE-002, and the acting client's instant sidebar update and both SSE-driven paths are unit-backed (EDGE-005..007). The one wiring hole no committed test covers, that `pollAndDiff` actually calls the predicate, is EDGE-004.

---

## Test Cases

### UAT-EDGE-001: A worktree or branch appearing or vanishing is a change
- **Scenario**: `agentSnapshotChanged` must report a change when `worktreePath` goes null to set, `branch` goes null to set, or both are cleared (the read-side self-heal when a worktree directory vanishes). Without these clauses a worktree created on an otherwise idle agent produces no `agent-update` at all.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: The three tests `worktreePath null -> set is a change`, `branch null -> set is a change` and `worktree cleared (set -> null, self-heal) is a change` pass (`pass 3`, `fail 0`).
- **Repeatable Unit Test**: Created: `host-server/agentDiff.test.ts` (written by the TASK-0211 tackle; no new file written by this generation run)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern="worktreePath null -> set" --test-name-pattern="branch null -> set" --test-name-pattern="worktree cleared" agentDiff.test.ts` (verified: pass 3, fail 0)
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-002: The extraction kept every pre-existing clause and the no-change and first-sight cases
- **Scenario**: Regression guard for moving the predicate out of `pollAndDiff`. Identical agents must not broadcast, a missing `prev` (first sight) must, and one representative field from each pre-existing group (`state`, `status.display`, `queuedTasks`, `usage.costUsd`) must still trigger.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: `identical agents are not a change`, `a missing prev (first sight) is a change` and `a pre-existing field from each group still triggers a change` pass (`pass 3`, `fail 0`).
- **Repeatable Unit Test**: Created: `host-server/agentDiff.test.ts` (TASK-0211 tackle)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern="identical agents" --test-name-pattern="missing prev" --test-name-pattern="pre-existing field" agentDiff.test.ts` (verified: pass 3, fail 0)
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-003: The periodic agent-update body still carries worktreePath, branch and role adjacently
- **Scenario**: The broadcast body was not reordered by the extraction. The existing static source test pins `worktreePath`, `branch`, `role` adjacent in the `pollAndDiff` `broadcastSSE('agent-update', …)` call, which is what carries the new worktree to other clients.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: `pollAndDiff's periodic agent-update broadcast includes role, at parity with worktreePath/branch …` passes (`pass 1`, `fail 0`).
- **Repeatable Unit Test**: Created: `host-server/sseRolePayloadParity.test.ts` (pre-existing test, deliberately left valid by TASK-0211; no new file written by this generation run)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern="periodic agent-update broadcast" sseRolePayloadParity.test.ts` (verified: pass 1, fail 0)
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-004: pollAndDiff gates its broadcast on agentSnapshotChanged (wiring check)
- **Scenario**: EDGE-001 and EDGE-002 prove the predicate; nothing committed proves `pollAndDiff` still uses it. If someone restores an inline `if (!prev || …)` condition, every unit test stays green and worktree propagation silently regresses. This check reads the source.
- **Steps**:
  1. From the repo root, run the command below as-is.
- **Command**:
  ```bash
  node -e "const s=require('fs').readFileSync('host-server/index.ts','utf8');console.log(s.includes(\"import { agentSnapshotChanged } from './agentDiff.ts'\"), s.includes('if (agentSnapshotChanged(prev, agent)) {'), s.includes('prev.worktreePath !== agent.worktreePath'))"
  ```
- **Expected Result**: Exactly `true true false` (verified at generation time): the predicate is imported, `pollAndDiff` gates on it, and no inline copy of the old worktree comparison remains in `index.ts`. Any other combination means the wiring regressed (FAIL).
- **Repeatable Unit Test**: Blocked: promotable in principle as a static assertion beside the existing regex checks in `host-server/sseRolePayloadParity.test.ts` (same pattern), but this generation run was restricted to wiki edits by the team lead. Add a `test('pollAndDiff gates on agentSnapshotChanged', …)` matching `/if \(agentSnapshotChanged\(prev, agent\)\) \{/` against `index.ts`; the scripted commands above are the repeatable check until then.
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-005: Creating a worktree from the detail view updates the sidebar badge immediately (acting client)
- **Scenario**: `AgentDetailView` calls `onWorktreeCreated(id, worktreePath, branch)` after a successful create and `AgentList` patches `agents` state, so the acting client's sidebar row shows `⎇ conductor/<id>` without waiting for a tick. The assertion is scoped to the sidebar (`complementary` region), so the detail pane's own Worktree row cannot satisfy it.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: `creating a worktree from the detail view shows the branch badge on the sidebar row immediately` passes (`Tests 1 passed`, others skipped).
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (TASK-0211 tackle, describe `AgentList worktree/branch propagation (TASK-0211)`)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "creating a worktree from the detail view shows the branch badge"` (verified: 1 passed, 186 skipped)
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-006: An incoming SSE agent-update with worktreePath/branch updates the sidebar badge and the detail Worktree row (other clients)
- **Scenario**: This is what every non-acting client relies on. An agent that had no worktree receives an `agent-update` carrying `worktreePath` and `branch`; both the sidebar badge and the open detail pane's Worktree row must show `⎇ conductor/32`.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: `an SSE agent-update carrying worktreePath/branch updates the sidebar badge and the detail Worktree row` passes (`Tests 1 passed`, others skipped).
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (TASK-0211 tackle)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "an SSE agent-update carrying worktreePath"` (verified: 1 passed, 186 skipped)
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-007: An SSE agent-update with worktreePath/branch null removes the badge (self-heal)
- **Scenario**: When the host-server's read-side self-heal clears a vanished worktree, the next `agent-update` carries `worktreePath: null, branch: null`; the sidebar badge and the detail pane's badge must both disappear.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: `an SSE agent-update with worktreePath/branch null removes the sidebar badge (self-heal)` passes (`Tests 1 passed`, others skipped).
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (TASK-0211 tackle)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "removes the sidebar badge"` (verified: 1 passed, 186 skipped)
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-API-001: The host-server emits a full-shaped agent-update carrying the new worktree within one status tick
- **Endpoint**: `GET /api/events` (SSE) observed while `POST /api/agents/:id/worktree` runs
- **Description**: Proves the server side end to end with no browser: creating a worktree on an otherwise idle agent (fixture B) now produces an `agent-update` whose body carries the complete status-shaped record, not a partial `{worktreePath, branch}`. Before TASK-0211 no event was emitted at all. Two terminals. Prerequisite: B has no worktree.
- **Steps**:
  1. Terminal 1: start the listener below. It writes about 10 seconds of SSE to a repo-local file, then exits by itself.
  2. Terminal 2, within 3 seconds of starting the listener: run the create command.
  3. When the listener exits, run the two checks below.
- **Command**:
  ```bash
  curl -sN -m 10 'http://localhost:8788/api/events' -o ./tmp/uat-0211-sse.txt
  ```
  ```bash
  curl -sS -X POST "http://localhost:8788/api/agents/$UAT_B_ID/worktree" | jq '{ok, branch: .agent.branch, hasPath: (.agent.worktreePath != null)}'
  ```
  ```bash
  grep -cE '"name":"uat-wt211-b".*"branch":"conductor/' ./tmp/uat-0211-sse.txt
  ```
  ```bash
  grep -E '"name":"uat-wt211-b".*"branch":"conductor/' ./tmp/uat-0211-sse.txt | jq -R 'sub("^data: ";"") | fromjson | {id, state, hasStatus: (.status != null), hasRole: has("role"), hasMode: has("mode"), branch, hasPath: (.worktreePath != null)}'
  ```
- **Expected Result**: The create call prints `{"ok": true, "branch": "conductor/<B id>", "hasPath": true}`. The first grep prints `1` or more (at least one `agent-update` for B with the new branch arrived after the create; the initial-connect resend for B was sent before the create and carries `"branch":null`, so it does not match). The last command prints an object with `hasStatus: true`, `hasRole: true`, `hasMode: true`, `hasPath: true` and `branch` equal to `conductor/<B id>`, showing the payload is complete rather than partial. A grep count of `0` means the event never arrived (FAIL, unless the host-server is stale; see prerequisites). Do not assert the worktree path layout (owned by TASK-0212).
- **Repeatable Unit Test**: Not applicable: needs the running host-server, its polling interval, a DB agent row and a real git worktree; the predicate is covered offline by UAT-EDGE-001 and the body shape by UAT-EDGE-003
- [FAIL: auto-judge: prerequisite not satisfied — fixture agent uat-wt211-b ($UAT_B_ID) does not exist; live-conductor DB agent creation and host-server restart forbidden for this run (host-server is reachable, HTTP 200, but no fixture; unit-backed by EDGE-001/003 which pass)] <!-- 2026-09-20 -->

---

### UAT-UI-001: Creating a worktree in Browser A shows the badge in A's sidebar at once and in Browser B's sidebar within about 2 s, with no reload
- **Page**: `http://localhost:4321/` in two windows (A and B), agent `uat-wt211-a` (fixture A, no worktree)
- **Description**: TASK-0211 Step 4 `[DEFERRED-TO-UAT]`. The acting client must feel instant (optimistic patch); every other client must catch up through the SSE event within one status tick. Prerequisite: fixture A has no worktree; neither window has been reloaded since fixtures were created (so both hold live SSE connections).
- **Steps**:
  1. In both windows locate `uat-wt211-a` in the sidebar. In B also open the agent's detail pane and select the `Details` tab (so the Worktree row is visible). Confirm neither shows a `⎇` badge on the `uat-wt211-a` row.
  2. In Browser A select `uat-wt211-a`, open the kebab menu (`Agent actions`) and click `Create worktree`.
  3. In A, watch the sidebar row for `uat-wt211-a` as soon as the request completes.
  4. In B, without touching or reloading it, watch the sidebar row and the Details tab Worktree row. Note the seconds elapsed since the click in A.
  5. Type `conductor/` into the sidebar `Filter agents` box (placeholder "Filter agents by name, project, role, or branch...") in A, then clear it. Do the same in B.
- **Expected Result**: In A the sidebar row shows `⎇ conductor/<A id>` immediately when the create finishes (no waiting for a tick). In B the same badge appears on the sidebar row, and the Details tab Worktree row switches from empty to `⎇ conductor/<A id>`, within about 2 s of the click (one `STATUS_POLL_MS` tick; up to 4 s allowed for measurement slack). No reload or navigation is needed in either window. In both windows the `Filter agents` box with `conductor/` lists `uat-wt211-a` (the filter matches on branch). Failure: B only shows the badge after a manual reload, or A's sidebar row lags behind A's detail pane.
- **Repeatable Unit Test**: Not applicable: two live browser sessions plus the real SSE stream and polling interval; the acting-client patch is unit-backed by UAT-EDGE-005, the SSE-driven update by UAT-EDGE-006 and the server-side emission by UAT-EDGE-001
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk (also: fixture agent uat-wt211-a and two browsers not available in this run)] <!-- 2026-09-20 -->

---

### UAT-UI-002: A worktree that vanishes on disk clears the badge in every open dashboard without a reload
- **Page**: `http://localhost:4321/` in Browser A and Browser B, agent `uat-wt211-b` (fixture B, worktree created by UAT-API-001)
- **Description**: The self-heal path. `resolveAgentWorktree` clears the DB columns when the worktree directory no longer exists, and the diff now broadcasts that clearing. Prerequisite: UAT-API-001 done (B has a worktree) and both windows still open on B with the badge visible (if a window was reloaded, that is fine here; the badge must be visible before the step starts). The directory is moved aside rather than deleted.
- **Steps**:
  1. Confirm `⎇ conductor/<B id>` is visible on B's sidebar row in both windows.
  2. Read B's worktree path: `curl -sS 'http://localhost:8788/api/status' | jq -r '.agents[] | select(.name=="uat-wt211-b") | .worktreePath'`
  3. Move it aside: `mv "<path from step 2>" "<path from step 2>.moved"`
  4. Watch B's sidebar row in both windows without reloading, and note the seconds elapsed.
  5. Confirm the server side: `curl -sS 'http://localhost:8788/api/status' | jq '.agents[] | select(.name=="uat-wt211-b") | {branch, worktreePath}'`
- **Expected Result**: Within about 2 s (up to 4 s allowed) the `⎇ conductor/<B id>` badge disappears from B's sidebar row in both windows with no reload, and the Details Worktree row (if open) no longer shows the branch. The status query prints `{"branch": null, "worktreePath": null}`. Afterwards `Create worktree` is available again in B's actions menu (do not click it; the branch already exists).
- **Repeatable Unit Test**: Not applicable: needs the live stack, a real directory removal and the polling interval; the frontend handling of the null update is unit-backed by UAT-EDGE-007 and the predicate clause by UAT-EDGE-001
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk (also: fixture agent uat-wt211-b and two browsers not available in this run)] <!-- 2026-09-20 -->
