---
id: UAT-062
aliases: [UAT-062]
title: "UAT: Branch badge — display branch name on agent card in dashboard"
status: passed
task: TASK-062
created: 2026-07-06
updated: 2026-08-15
---

# UAT-062 — UAT: Branch badge — display branch name on agent card in dashboard

implements::[[TASK-062]]

> **Source task**: [[TASK-062]]
> **Generated**: 2026-07-06

---

## Prerequisites

- [ ] Host-server running on `http://localhost:8788` (`make dev` or `npm start` in `host-server/`).
- [ ] Frontend dev server running on `http://localhost:4321` (`make dev`).
- [ ] At least one agent exists in the conductor DB (so the `/api/agents` and `/api/status` arrays are non-empty).
- [ ] For the badge-present UI test: at least one agent spawned against a **git-backed** workdir (via TASK-061 worktree spawn), so its row has a non-null `branch` (e.g. `conductor/<id>`).
- [ ] For the no-badge UI test: at least one agent spawned against a **non-git** workdir, so its `branch` is `NULL`.

---

## Test Cases

### UAT-API-001: GET /agents exposes branch and worktreePath on every agent
- **Endpoint**: `GET /api/agents`
- **Description**: TASK-062 step 1 added `branch` and `worktreePath` to the serialised agent objects. `GET /api/agents` returns full rows via `listAgents(db)`; every agent object must carry both camelCase keys (value may be `null`).
- **Steps**:
  1. Ensure at least one agent exists.
  2. Run the curl command below as-is.
- **Command**:
  ```bash
  curl -sS 'http://localhost:8788/api/agents' | jq 'length > 0 and all(has("branch") and has("worktreePath"))'
  ```
- **Expected Result**: Prints `true` — the array is non-empty and every agent object has both `branch` and `worktreePath` keys. (A git-spawned agent shows a non-null string `branch` like `conductor/<id>`; a non-git agent shows `null`.)
- **Repeatable Unit Test**: Created: `host-server/db.migration.test.ts` (test `TASK-062: listAgents exposes non-null branch and worktreePath as camelCase fields` — proves `listAgents`/`mapAgent` surfaces non-null `branch`/`worktreePath` as camelCase without leaking snake_case).
- [x] Pass <!-- 2026-08-15 -->

### UAT-API-002: GET /status exposes branch and worktreePath on every agent
- **Endpoint**: `GET /api/status`
- **Description**: TASK-062 step 1 also added `branch`/`worktreePath` to both `/status` paths — the `buildSnapshot` snapshot path and the cold-start fallback. Every agent in the `agents` array must carry both keys.
- **Steps**:
  1. Ensure at least one agent exists.
  2. Run the curl command below as-is.
- **Command**:
  ```bash
  curl -sS 'http://localhost:8788/api/status' | jq '.agents | length > 0 and all(has("branch") and has("worktreePath"))'
  ```
- **Expected Result**: Prints `true` — the `agents` array is non-empty and every agent object has both `branch` and `worktreePath` keys.
- **Repeatable Unit Test**: Not applicable: `/status` composes runtime tmux state (live pane inspection) into the snapshot; the deterministic serialization core is covered by UAT-API-001's unit test.
- [x] Pass <!-- 2026-08-15 -->

### UAT-UI-001: Branch badge renders on a git-backed agent card
- **Page**: `http://localhost:4321/`
- **Description**: An agent whose row has a non-null `branch` must show a subtle monospace `⎇ <branch>` badge on its card (`AgentItem` in `frontend/src/components/AgentList.tsx`).
- **Auth-Required**: false
- **Steps**:
  1. Ensure at least one agent was spawned against a git-backed workdir (its `branch` is `conductor/<id>` — confirm via UAT-API-001).
  2. Open the dashboard at `http://localhost:4321/`.
  3. Locate that agent's card in the agent list.
  4. Observe the area below the name/label rows and above the active-task line.
- **Expected Result**: The card displays a small muted monospace badge reading `⎇ conductor/<id>` (matching the agent's `branch`). Hovering shows the full branch name as a tooltip (`title` attribute).
- **Repeatable Unit Test**: Not applicable: verifies browser rendering / visual placement of a React conditional; the frontend has no component test harness (no vitest/jsdom).
- [x] Pass <!-- 2026-08-15 -->

### UAT-UI-002: No branch badge on a non-git agent card
- **Page**: `http://localhost:4321/`
- **Description**: An agent whose `branch` is `NULL` (non-git workdir) must show no branch badge — the `{agent.branch && ...}` guard renders nothing.
- **Auth-Required**: false
- **Steps**:
  1. Ensure at least one agent was spawned against a non-git workdir (its `branch` is `null` — confirm via UAT-API-001).
  2. Open the dashboard at `http://localhost:4321/`.
  3. Locate that agent's card.
  4. Inspect the card for any `⎇` branch badge.
- **Expected Result**: No `⎇` badge appears anywhere on that agent's card. The card renders normally (name, status, and — if present — label/context/active-task).
- **Repeatable Unit Test**: Not applicable: verifies absence of a rendered DOM element in the browser; no frontend component test harness exists.
- [x] Pass <!-- 2026-08-15 -->

### UAT-EDGE-001: Empty-string / null branch never renders a badge
- **Scenario**: The badge guard is `{agent.branch && ...}`. Both `null`/`undefined` (non-git agents) and an empty-string branch must suppress the badge — no stray `⎇` with no name.
- **Steps**:
  1. Verified deterministically by the serialization unit test (non-null passthrough) plus the truthiness guard in `AgentItem`.
  2. Runtime confirmation is covered by UAT-UI-002 (null branch → no badge).
- **Expected Result**: A falsy `branch` (`null`, `undefined`, or `""`) renders no badge element; only a non-empty string branch renders `⎇ <branch>`.
- **Repeatable Unit Test**: Created: `host-server/db.migration.test.ts` (the `TASK-062` test asserts the mapped object exposes `branch`/`worktreePath` as camelCase; combined with the existing TASK-063 test proving null passthrough, the falsy-vs-truthy contract the guard relies on is pinned at the API boundary).
- [x] Pass <!-- 2026-08-15 -->

---
