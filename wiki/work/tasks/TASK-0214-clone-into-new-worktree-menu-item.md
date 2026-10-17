---
id: TASK-0214
aliases: [TASK-0214]
title: "Add a Clone into new worktree item to the agent actions menu on every agent"
status: pending-uat
created: 2026-09-20
updated: 2026-09-20
depends_on: [TASK-0209, TASK-0213]
blocks: [TASK-0218]
parallel_safe_with: [TASK-0215, TASK-0217]
uat: "[[UAT-0214]]"
tags: [worktree, agents, clone, dashboard, frontend, actions-menu]
---

# TASK-0214 — Add a Clone into new worktree item to the agent actions menu on every agent

relates_to::[[worktree-on-any-agent]]
depends_on::[[TASK-0209]]
depends_on::[[TASK-0213]]
blocks::[[TASK-0218]]

> **Roadmap**: ROADMAP-0025 Phase 2, item 2. Research: `raw/research/worktree-on-any-agent/index.md` (Solution B).
> **Collision note**: edits `agentActionItems` and `handleClone` in `frontend/src/components/AgentList.tsx`, the same array/handler as TASK-0209 and TASK-0216 — sequence 0209 → 0214 → 0216. Frontend-only, so parallel-safe with the backend tasks TASK-0215 and TASK-0217.

## Objective

Every agent's actions menu has a **Clone into new worktree** item next to **Clone**, whether or not the agent already has a worktree. Selecting it calls `POST /agents/:id/clone` with `{ forceWorktree: true }` (TASK-0213), and the dashboard selects the new clone exactly as the plain Clone does. It is the answer to "give me another isolated worktree from this agent": since a live agent cannot get a second/replacement worktree (path and branch derive from its id), the clone gets the new one.

## Approach

- **Same flow as Clone, one extra argument.** `handleClone()` (`AgentList.tsx` ~799) already handles `cloning`, `cloneError` (shown in the shared banner) and `onCloned(cloned.id)` → `setExpandedAgent({ id, armInteract: false })`. Generalise it to `handleClone(opts?: { forceWorktree?: boolean })` and share the `cloning` guard, so the two clone items can never fire concurrently.
- **Availability.** Present on every agent (no worktree required either way). Disabled only while `cloning`, or with a visible reason when `agent.inGitRepo === false` ("Workdir is not inside a git repository" — the same wording and `description` mechanism as TASK-0209; `undefined` counts as unknown → enabled, the backend answers with its real reason via TASK-0210/0213). No confirm dialog, matching plain Clone.
- **Copy.** Label `Clone into new worktree`; tooltip `Spawn a copy of this agent in its own new git worktree and branch (off the base branch — uncommitted work is not copied)`, reflecting TASK-0213's documented semantics.
- **No new selection logic.** The clone appears via the SSE `agent-update` the host-server broadcasts after spawning it (TASK-0215 makes that payload carry `worktreePath`/`branch`, so its sidebar row shows `⎇ conductor/<cloneId>` immediately).

## Steps

### 1. Generalise the clone handler  <!-- agent: general-purpose -->

- [x] `frontend/src/components/AgentList.tsx`: change `handleClone` to `async function handleClone(opts?: { forceWorktree?: boolean })` calling `cloneAgent(agent.id, opts)` (TASK-0213's helper signature); keep `if (cloning) return`, `setCloneError`, `onCloned?.(cloned.id)` and `finally { setCloning(false) }` unchanged. The existing `Clone` item keeps calling `handleClone()` with no argument so its request shape is unchanged.

### 2. Add the menu item  <!-- agent: general-purpose -->

- [x] In `agentActionItems` (~824) insert `{ key: 'clone-into-worktree', label: cloning ? 'Cloning…' : 'Clone into new worktree', onSelect: () => { void handleClone({ forceWorktree: true }) }, disabled: cloning || agent.inGitRepo === false, description: agent.inGitRepo === false ? 'Workdir is not inside a git repository' : undefined, title: <tooltip copy above> }` immediately after `clone`. Do not change the plain `Clone` item's label or `disabled` logic.
- [x] Confirm the menu's roving-focus keyboard behaviour still skips the item when disabled (covered by `AgentActionsMenu.test.tsx`; no component change expected).

### 3. Tests  <!-- agent: general-purpose -->

- [x] `frontend/src/components/AgentList.test.tsx` (mock `cloneAgent` in `../lib/api`, following the existing clone tests from TASK-134/148): (a) item is present for an agent **without** a worktree and for one **with** a worktree; (b) selecting it calls `cloneAgent` with `(agent.id, { forceWorktree: true })`, and selecting plain **Clone** still calls it with only `(agent.id)` (assert exact arguments so the two cannot be swapped); (c) on resolve, the selection moves to the returned clone id (assert the detail pane heading/`aria-current` row); (d) on reject, the backend reason (e.g. `failed to create git worktree at /x: a branch named … already exists`) appears in the shared banner; (e) `inGitRepo: false` → item disabled with the reason line; (f) while a clone is in flight both clone items are disabled.

### 4. Verify  <!-- agent: general-purpose -->

- [x] `cd frontend && npm run typecheck && npm run lint && npx vitest run src/components/AgentList.test.tsx src/components/AgentActionsMenu.test.tsx`.
- [DEFERRED-TO-UAT] Deferred to TASK-0218 (live): clone a worktree-less agent into a worktree and confirm the new row shows its `⎇` badge and the new window's cwd is the worktree.

## Files expected to be touched

`frontend/src/components/AgentList.tsx`, `frontend/src/components/AgentList.test.tsx`.

## Dependencies

- **Depends on** TASK-0213 (the `forceWorktree` request option and `cloneAgent(agentId, opts)` helper), TASK-0209 (the `inGitRepo` field, the menu `description` support, and the shared `agentActionItems` edit site).
- **Blocks** TASK-0218 (UAT).
- Parallel-safe with TASK-0215 and TASK-0217 (host-server only). Not parallel-safe with TASK-0209/0216 (same array in `AgentList.tsx`).
