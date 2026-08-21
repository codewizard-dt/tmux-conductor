---
id: TASK-134
aliases: [TASK-134]
title: "Clone button in AgentDetailModal"
status: todo
created: 2026-08-15
updated: 2026-08-15
depends_on: []
blocks: []
parallel_safe_with: []
uat: ""
tags: [frontend, host-server]
---

# TASK-134 — Clone button in AgentDetailModal

## Objective

Add a "Clone" action to the agent detail modal's header action row that duplicates the open agent (same workdir, launch command, role, and project) into a new agent registered under a fresh, auto-derived name, mirroring the source agent's git-worktree setting.

## Approach

Clone is structurally a pre-filled call into the existing `createAgent()`/`POST /agents` machinery, not a new data model. A new `POST /agents/:id/clone` route loads the source `Agent` via `getAgentById`, derives a unique name by appending `-copy` (bumping to `-copy-2`, `-copy-3`, … on collision, scoped the same way existing per-project/global uniqueness is enforced), and calls `createAgent()` with `useWorktree` set to whether the source agent has a `worktreePath` — so a worktree-backed agent clones into a fresh worktree + new `conductor/<id>` branch off the same workdir, and a plain agent clones into the same shared workdir with no worktree.

No confirmation dialog is needed since cloning is non-destructive (unlike Close/Remove agent, which use `ConfirmDialog`). No new modal is needed either — the clone is created immediately on click; the user can rename it afterward via the existing inline Rename action if the auto-suffixed name isn't what they want.

## Steps

### 1. Host-server: clone route + naming helper <!-- agent: general-purpose -->

- [ ] In `host-server/db.ts`, add a helper that derives a unique clone name from a source agent's name, scoped the same way `createAgent`/existing uniqueness indexes are scoped (per-project via `idx_agents_project_name`, global via `idx_agents_null_name` when `projectId` is null): try `<name>-copy`, then `<name>-copy-2`, `<name>-copy-3`, … until free. Model this after the existing `nextAgentName()` pattern (db.ts ~line 514).
  - Add `getAgentById(db, id)` if it doesn't already exist as an exported helper (check current exports first — the earlier research found a `getAgentById` reference in the clone-implication notes; confirm its exact signature before reusing).
- [ ] In `host-server/index.ts`, add `POST /agents/:id/clone` near the existing agent routes (`POST /agents` ~line 915, `PATCH`/`DELETE /agents/:id`). Handler:
  - Loads the source agent by id (404 if missing).
  - Derives the new name via the helper above.
  - Calls `createAgent(db, { name: <derived>, workdir: source.workdir, launchCmd: source.launchCmd, projectId: source.projectId ?? undefined, role: source.role, useWorktree: Boolean(source.worktreePath) })`.
  - Spawns the tmux window for the new agent the same way `POST /agents` does (`spawnAgentWindow`), and broadcasts an `agent-update` SSE event immediately, matching the existing `POST /agents` behavior.
  - Returns the new agent record (mirror the response shape of `POST /agents`).

### 2. Frontend API client <!-- agent: general-purpose -->

- [ ] In `frontend/src/lib/api.ts`, add `cloneAgent(id: number)` calling `POST /agents/:id/clone`, following the existing style of `renameAgent`/`spawnAgentInProject` (error handling, return type).

### 3. Frontend: Clone button in AgentDetailModal <!-- agent: general-purpose -->

- [ ] In `frontend/src/components/AgentList.tsx`, add a "Clone" button to `AgentDetailModal`'s header action row (alongside Rename/Close agent/Remove agent, ~lines 700-770), using the same `inline-flex h-7 ... rounded-[7px]` button classes as the existing actions with its own distinct accent color (blue/amber/red are taken — use a green or teal accent).
  - On click: call `cloneAgent(agent.id)`, handle loading/error state the same way the other header actions do, and let the existing `agent-update` SSE broadcast (from Step 1) refresh `AgentList`'s agent grid with the new clone — no local state patching needed beyond whatever the other actions already do for consistency.
  - Confirm whether `InactiveAgentsPanel.tsx` (which also renders `AgentDetailModal`, line 154) should show the Clone button too — if an inactive/exited agent can still be cloned (workdir/launchCmd/role are still known even if the tmux window is gone), keep it enabled there as well.

## Notes

- No existing "clone"/"duplicate" concept exists anywhere in the codebase (not in `bg_processes`, `projects`, or `agents`) — this is new route + UI surface, not a modification of existing semantics.
- Agent name uniqueness is enforced per-project (`idx_agents_project_name`) or globally when `projectId IS NULL` (`idx_agents_null_name`) — the naming helper must respect this scoping or `createAgent()` will reject the clone on a collision.
