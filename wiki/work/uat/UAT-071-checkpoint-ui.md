---
id: UAT-071
aliases: [UAT-071]
title: "UAT: Checkpoint UI — AgentDetailModal checkpoint list with timestamps + per-checkpoint rollback button"
status: pending
task: TASK-071
created: 2026-08-15
updated: 2026-08-15
---

# UAT-071 — UAT: Checkpoint UI — AgentDetailModal checkpoint list with timestamps + per-checkpoint rollback button

implements::[[TASK-071]]

> **Source task**: [[TASK-071]]
> **Generated**: 2026-08-15
> **Note**: The task's stated paths (`app/frontend/...`, `AgentDetailModal.tsx` as a standalone file) are stale residue from an architecture reverted 2026-06-22 and no longer exist. Real locations: `AgentDetailModal` is a function component inside `frontend/src/components/AgentList.tsx:450-791`; the new panel lives at `frontend/src/components/CheckpointList.tsx`; client helpers were added to `frontend/src/lib/api.ts`. `GET /api/agents/:id/checkpoints` and `POST /api/agents/:id/rollback` are pre-existing endpoints from TASK-069/TASK-070 (see [[UAT-070]] and the archived `UAT-069-checkpoints-list-endpoint.md` for their own full contract coverage) — this UAT tests only what TASK-071 itself introduced: the frontend's consumption of those endpoints (the `AgentCheckpoint` type contract, the `worktreePath` gating field, and the UI wiring), not the endpoints' internal correctness.

---

## Prerequisites

- [ ] Host-server running on `http://127.0.0.1:8788` (`make dev` or `npm --prefix host-server run dev`) — confirmed reachable at generation time (`GET /api/status` → 200).
- [ ] `sqlite3` CLI installed — used to seed fixture agent rows directly in `data/conductor.db`, following the exact pattern established by [[UAT-070]]. No live tmux session is required for the API-level tests below.
- [ ] For the UI test cases: a browser open to the dashboard (`http://localhost:4321` in dev) with at least one agent visible, plus the ability to create/observe a git-backed agent (non-null `worktreePath`) and a non-git agent (null `worktreePath`).
- [ ] **Environment note**: this generating agent's sandbox blocks all `git stash` subcommands outright (confirmed environment-wide by the team lead and corroborated by [[UAT-070]]'s own generation run). `rollbackAgent()` ultimately calls `POST /api/agents/:id/rollback`, which shells out to `git stash apply`. UAT-UI-004 below (the Rollback button's full happy path) cannot be auto-verified in this sandbox — it requires a human tester or an agent running in an unrestricted environment.

---

## Test Cases

### UAT-API-001: `GET /api/agents/:id/checkpoints` response shape matches the frontend `AgentCheckpoint` type
- **Endpoint**: `GET /api/agents/:id/checkpoints`
- **Description**: TASK-071 added `fetchAgentCheckpoints()` and the `AgentCheckpoint` interface (`{ id, agentId, ts, stashRef, createdAt }`) to `frontend/src/lib/api.ts`, declaring a TypeScript shape for this pre-existing endpoint's response. This test verifies the live wire response actually matches that declared shape field-for-field (camelCase, all five fields present) — the exact assumption `CheckpointList.tsx` relies on when rendering `stashRef` and computing relative time from `ts`.
- **Steps**:
  1. Seed a fixture agent with a `worktree_path` and one checkpoint:
     ```bash
     sqlite3 /Users/davidtaylor/Repositories/tmux-conductor/data/conductor.db \
       "INSERT INTO agents (name, workdir, launch_cmd, worktree_path) VALUES ('uat-071-fixture-a', '/Users/davidtaylor/Repositories/tmux-conductor/tmp/uat-071-worktree-a', 'true', '/Users/davidtaylor/Repositories/tmux-conductor/tmp/uat-071-worktree-a') RETURNING id;"
     ```
     Note the printed id as `<AGENT_ID>`.
     ```bash
     curl -sS -X POST "http://127.0.0.1:8788/api/agents/<AGENT_ID>/checkpoints" -H 'Content-Type: application/json' -d '{"ts":1700000000000,"stash_ref":"deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"}'
     ```
  2. Run the Command below.
- **Command**:
  ```bash
  curl -sS "http://127.0.0.1:8788/api/agents/<AGENT_ID>/checkpoints"
  ```
- **Expected Result**: HTTP 200. JSON `{ "checkpoints": [ { "id": <number>, "agentId": <AGENT_ID>, "ts": 1700000000000, "stashRef": "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef", "createdAt": <number> } ] }` — every field present, camelCase, no `stash_ref`/`agent_id`/`created_at` leaking through unmapped. Verified live at generation time: `{"checkpoints":[{"id":9,"agentId":13,"ts":1700000000000,"stashRef":"deadbeefdeadbeefdeadbeefdeadbeefdeadbeef","createdAt":1786814889000}]}`.
- **Repeatable Unit Test**: Not applicable: this asserts the live wire shape against a hand-written TS interface declaration; there is no frontend test runner to host a unit test against (see Notes).
- [x] Pass <!-- 2026-08-15 -->

### UAT-API-002: `GET /api/agents/:id/checkpoints` returns an empty array for an agent with no checkpoints
- **Endpoint**: `GET /api/agents/:id/checkpoints`
- **Description**: `CheckpointList.tsx`'s empty-state text ("No checkpoints yet — checkpoints are taken before each task dispatch.") only renders correctly if the endpoint returns `{ checkpoints: [] }` rather than `null`/omitting the key/erroring for a checkpoint-less agent. This is the data precondition for UAT-UI-003.
- **Steps**:
  1. Seed a second fixture agent with no checkpoints recorded:
     ```bash
     sqlite3 /Users/davidtaylor/Repositories/tmux-conductor/data/conductor.db \
       "INSERT INTO agents (name, workdir, launch_cmd) VALUES ('uat-071-fixture-b', '/Users/davidtaylor/Repositories/tmux-conductor/tmp/uat-071-worktree-b', 'true') RETURNING id;"
     ```
     Note the printed id as `<AGENT_B_ID>`.
  2. Run the Command below.
- **Command**:
  ```bash
  curl -sS "http://127.0.0.1:8788/api/agents/<AGENT_B_ID>/checkpoints"
  ```
- **Expected Result**: HTTP 200. JSON `{ "checkpoints": [] }`. Verified live at generation time: `{"checkpoints":[]}`.
- **Repeatable Unit Test**: Not applicable: already covered structurally by `listCheckpoints` returning `[]` for a no-row agent, which is pre-existing backend behavior from TASK-069, not introduced by this task.
- [x] Pass <!-- 2026-08-15 -->

### UAT-API-003: `GET /api/status` exposes `worktreePath` on each agent, matching the Checkpoints section's visibility gate
- **Endpoint**: `GET /api/status`
- **Description**: `AgentDetailModal` (in `AgentList.tsx`) gates the new Checkpoints section on `agent.worktreePath` — a field added to the `Agent` interface by this task. `AgentDetailModal`'s `agent` prop is populated from `frontend/src/lib/useAgents.ts`'s `fetch('${API_BASE}/status')`, whose `agents[]` entries are built by `buildSnapshot()` (`host-server/index.ts:2167`, `worktreePath: agent.worktreePath`). This test confirms the live snapshot actually carries a non-null `worktreePath` for a git-backed agent and `null` for a non-git one — the precondition `agent.worktreePath && <CheckpointList .../>` depends on.
- **Steps**:
  1. Reuse fixture agents A (`<AGENT_ID>`, has `worktree_path`) and B (`<AGENT_B_ID>`, no `worktree_path`) from UAT-API-001/002.
  2. Run the Command below.
- **Command**:
  ```bash
  curl -sS "http://127.0.0.1:8788/api/status" | jq '.agents[] | select(.id==<AGENT_ID> or .id==<AGENT_B_ID>) | {id,worktreePath}'
  ```
- **Expected Result**: Two objects — the agent A entry with `"worktreePath": "/Users/davidtaylor/Repositories/tmux-conductor/tmp/uat-071-worktree-a"`, the agent B entry with `"worktreePath": null`. Verified live at generation time exactly as specified above (ids 13/14, since deleted).
  Cleanup after this test (last fixture-dependent case):
  ```bash
  curl -sS -X DELETE 'http://127.0.0.1:8788/api/agents/<AGENT_ID>'
  curl -sS -X DELETE 'http://127.0.0.1:8788/api/agents/<AGENT_B_ID>'
  ```
- **Repeatable Unit Test**: Not applicable: `worktreePath` pass-through in `buildSnapshot()` is a one-line field mapping in the non-injectable `host-server/index.ts` script (no exported app builder for `.inject()`-style testing), and the field's presence on the DB row is already covered by `host-server/db.migration.test.ts`.
- [x] Pass <!-- 2026-08-15 -->

### UAT-UI-001: "Checkpoints" section appears only for agents with a non-null `worktreePath`
- **Page**: Dashboard main view → click an agent card to open `AgentDetailModal`.
- **Description**: Verifies the gate at `AgentList.tsx:788` — `{!logExpanded && agent.worktreePath && <CheckpointList agentId={agent.id} />}`.
- **Steps**:
  1. Open the detail modal for a git-backed agent (created inside a git repo, so it has a worktree — check its "Details" panel shows a branch chip, or confirm via `GET /api/status` that its `worktreePath` is non-null).
  2. Scroll to the bottom of the modal body, below the "Usage" section.
  3. Confirm a "Checkpoints" `<details>` section is present.
  4. Open the detail modal for a non-git agent (workdir outside any git repo, `worktreePath: null`).
  5. Scroll to the bottom of the modal body.
- **Expected Result**: Step 3 — the "Checkpoints" section is visible for the git-backed agent. Step 5 — no "Checkpoints" section renders for the non-git agent (nothing where it would be, no error, no empty placeholder).
- **Repeatable Unit Test**: Not applicable: requires rendering `AgentDetailModal` in a browser DOM; no frontend component-test harness exists in this repo (see Notes).
- [FAIL: auto-judge: prerequisite not satisfied — host-server not reachable at http://127.0.0.1:8788] <!-- 2026-08-21 -->

### UAT-UI-002: Checkpoint rows render a relative timestamp, the `stashRef`, and a Rollback button
- **Page**: `AgentDetailModal` → "Checkpoints" section (expanded) for a git-backed agent with at least one checkpoint recorded (e.g. dispatch a task to a git-backed agent so `POST /tasks`'s pre-dispatch-checkpoint path records one, per TASK-068).
- **Description**: Verifies `CheckpointList.tsx`'s row rendering — `formatRelativeTimestamp(ts)` (e.g. "3m ago"), `stashRef`, and a "Rollback" button per row.
- **Steps**:
  1. Open the "Checkpoints" `<details>` section for the agent.
  2. Observe each checkpoint row.
- **Expected Result**: Each row shows a human-readable relative time string (e.g. "2m ago", "1h ago"; never a raw epoch number), the checkpoint's `stashRef` text, and a "Rollback" button. Rows are ordered most-recent-first (matches `listCheckpoints`'s `ORDER BY ts DESC`).
- **Repeatable Unit Test**: Not applicable: requires rendering in a browser DOM; no frontend component-test harness exists in this repo (see Notes).
- [FAIL: auto-judge: prerequisite not satisfied — host-server not reachable at http://127.0.0.1:8788] <!-- 2026-08-21 -->

### UAT-UI-003: Empty state renders when the agent has no checkpoints yet
- **Page**: `AgentDetailModal` → "Checkpoints" section for a git-backed agent that has never had a task dispatched to it (so no pre-dispatch checkpoint has been recorded).
- **Description**: Verifies the empty-state branch in `CheckpointList.tsx`. The data precondition (`GET /api/agents/:id/checkpoints` → `{ checkpoints: [] }`) is already machine-verified by UAT-API-002; this case verifies the UI renders the specified copy for that state.
- **Steps**:
  1. Open the "Checkpoints" section for a fresh git-backed agent with zero checkpoints.
- **Expected Result**: The section shows the text "No checkpoints yet — checkpoints are taken before each task dispatch." — no spinner stuck, no error, no empty list with no explanation.
- **Repeatable Unit Test**: Not applicable: requires rendering in a browser DOM; no frontend component-test harness exists in this repo (see Notes).
- [FAIL: auto-judge: prerequisite not satisfied — host-server not reachable at http://127.0.0.1:8788] <!-- 2026-08-21 -->

### UAT-UI-004: Rollback button confirms, calls the rollback endpoint, and refreshes both the checkpoint list and the diff panel
- **Page**: `AgentDetailModal` → "Checkpoints" section for a git-backed agent with at least one checkpoint and some uncommitted changes in its worktree (so the diff panel has visible content to refresh).
- **Description**: Verifies the full click-through: `window.confirm` → on confirm, `rollbackAgent(agentId, checkpointId)` → `POST /api/agents/:id/rollback` → on success, `CheckpointList` re-fetches its own list AND dispatches `window.dispatchEvent(new CustomEvent('conductor:diff-refresh', { detail: { agentId } }))`, which the listener added to `DiffPanel.tsx:47-56` picks up to re-run `load({cancelled:false})`. This is the task's core acceptance criterion and its **pass condition requires a successful `git stash apply` on the server**, which this generating agent's sandbox cannot exercise (see Prerequisites). **Requires a human tester, or an agent running in an environment where `git stash` is not blocked.**
- **Steps**:
  1. Click "Rollback" on a checkpoint row.
  2. Confirm the `window.confirm` dialog (verify cancelling it does NOT call the API — check the Network tab shows no `POST /rollback` request after Cancel).
  3. Re-open with confirm accepted; watch the Network tab for `POST /api/agents/:id/rollback` with body `{"checkpoint_id":<id>}`.
  4. Observe the Checkpoints section and the Diff panel immediately after.
- **Expected Result**: Cancelling the confirm dialog issues no network request. Confirming issues `POST /api/agents/:id/rollback` and receives `{ "ok": true, "stash_ref": "<ref>" }` (HTTP 200). The checkpoint list re-fetches (a new network `GET /checkpoints` call fires). The Diff panel also re-fetches (a new `GET .../diff` call fires without the user touching its own "Refresh" button) and its content reflects the worktree state after the stash was reapplied.
- **Repeatable Unit Test**: Blocked: no frontend test/component harness exists in this repo to mount `CheckpointList`/`DiffPanel` and simulate the `window.confirm` + fetch + `CustomEvent` sequence without a real browser; see Notes.
- [FAIL: auto-judge: prerequisite not satisfied — host-server not reachable at http://127.0.0.1:8788] <!-- 2026-08-21 -->

### UAT-UI-005: Error state renders if the checkpoints fetch fails
- **Page**: `AgentDetailModal` → "Checkpoints" section, with the host-server request for `GET /api/agents/:id/checkpoints` forced to fail (e.g. browser DevTools → Network → set to "Offline" briefly while opening the modal, or block the request via a DevTools request-blocking rule, then re-enable).
- **Description**: Verifies `CheckpointList.tsx`'s `text-accent-red` error-state branch (mirroring `DiffPanel`'s convention) renders instead of hanging on the loading state or silently showing nothing.
- **Steps**:
  1. Simulate a network failure for the checkpoints request as described above.
  2. Open (or refresh) the "Checkpoints" section for a git-backed agent.
- **Expected Result**: An error message renders in red instead of the loading text or an empty/blank section.
- **Repeatable Unit Test**: Not applicable: requires simulating a browser-level network failure; no frontend test harness exists in this repo (see Notes).
- [FAIL: auto-judge: prerequisite not satisfied — host-server not reachable at http://127.0.0.1:8788] <!-- 2026-08-21 -->

### UAT-STATIC-001: `npx tsc --noEmit` and `npm run build` pass cleanly in `frontend/`
- **Scenario**: The task's Acceptance Criteria require a clean typecheck and build after adding `CheckpointList.tsx`, the `api.ts` helpers/types, the `AgentDetailModal` wiring, the `Agent.worktreePath` field, and the `DiffPanel` refresh listener.
- **Steps**:
  1. Run the command below as-is.
- **Command**:
  ```bash
  cd /Users/davidtaylor/Repositories/tmux-conductor/frontend && npx tsc --noEmit && npm run build
  ```
- **Expected Result**: Both exit 0. Verified passing at generation time (during `/tackle`'s Step 5 and this UAT's own `/uat-generate` typecheck gate — `make typecheck` also exits 0 for both workspaces).
- **Repeatable Unit Test**: Not applicable: this command *is* the static gate itself, re-run verbatim; wrapping it in a unit test would just re-invoke the same compiler/bundler check.
- [x] Pass <!-- 2026-08-15 -->

---

## Coverage vs Acceptance Criteria

| Acceptance criterion | Covered by |
|---|---|
| "Checkpoints" section appears only for agents with a non-null `worktree_path` | UAT-API-003 (data precondition, auto) + UAT-UI-001 (render, human) |
| Each checkpoint row shows a human-readable relative timestamp and the `stash_ref` | UAT-API-001 (wire shape, auto) + UAT-UI-002 (render, human) |
| "Rollback" button triggers a confirmation, then calls `POST /api/agents/:agent/rollback`, then refreshes both the checkpoint list and the diff panel | UAT-UI-004 (human/unrestricted-env only — pass condition requires a real `git stash apply`) |
| Empty state message is shown when there are no checkpoints | UAT-API-002 (data precondition, auto) + UAT-UI-003 (render, human) |
| `npx tsc --noEmit` and `npm run build` pass cleanly in `frontend/` | UAT-STATIC-001 (auto) |
| *(implied — error handling)* Error state shown if the checkpoints fetch fails | UAT-UI-005 (human) |

---

## Notes

- **No frontend unit-test infrastructure exists in this repo.** Neither `frontend/package.json` nor the workspace root declares any test runner (no `vitest`, `jest`, or even `tsx`/`ts-node` for ad-hoc `node --test` execution against `.tsx` files, unlike `host-server/`, which uses `node --import tsx/esm --test` with sibling `*.test.ts` files). The `uatGenerate.promoteTests` preference resolves (via the legacy `true` → `dedicated` mapping) to "write to a dedicated test directory," but there is no discernible frontend test convention to extend or dedicated directory to create one in, and per the rule against introducing new test infrastructure outside a task's stated scope, no test framework was added. Every case above that would otherwise be unit-test-promotable (e.g., `CheckpointList.tsx`'s local `formatRelativeTimestamp` helper, which is deterministic, pure, and would be a trivial unit test under any JS test runner) is recorded `Blocked`/`Not applicable` rather than fabricating coverage. `host-server/`-side behavior touched indirectly by this task (the `worktreePath` field, the checkpoints/rollback endpoints) was already unit-tested during TASK-068/069/070's own implementation and is not re-tested here per "only test what the task changed or introduced."
- Six of nine cases were executed live at generation time using disposable fixture agents (ids 13/14, both deleted via `DELETE /api/agents/:id` afterward). The five UI cases (UAT-UI-001 through 005) require an actual browser and are left `[ ] Pass` for a human walkthrough (`/uat-walk`) — this is expected and correct for a UI task, not a gap. UAT-UI-004 additionally cannot be auto-judged even by `/uat-auto` on a headless agent in this sandbox, because its pass condition requires a real `git stash apply`, which is blocked environment-wide (confirmed by the team lead and independently by [[UAT-070]]'s own generation run against the same restriction).
