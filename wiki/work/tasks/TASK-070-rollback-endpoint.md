---
id: TASK-070
title: "Rollback endpoint — POST /api/agents/:agent/rollback"
status: todo
created: 2026-06-14
updated: 2026-06-14
depends_on: [TASK-067]
blocks: [TASK-071]
parallel_safe_with: [TASK-068, TASK-069]
uat: ""
tags: [api, checkpoint, rollback, host-server, roadmap-007]
---

# TASK-070 — Rollback endpoint — POST /api/agents/:agent/rollback

## Objective

Add a `POST /api/agents/:agent/rollback` endpoint that applies a selected checkpoint by popping the corresponding stash ref in the agent's worktree.

## Approach

The request body accepts `{ checkpoint_id: number }`. The handler:
1. Looks up the agent; 404 if not found.
2. Returns 400 if the agent has no `worktree_path`.
3. Fetches the checkpoint row via `getCheckpoint(checkpointId)`; 404 if not found or the checkpoint belongs to a different agent.
4. Runs `git -C <worktree_path> stash apply <stash_ref>` (prefer `apply` over `pop` so the stash is kept as a safety net; the user can opt to `pop` later).
5. Returns `{ ok: true, stash_ref: string }` on success.
6. On git failure, returns 500 with `{ error: string, detail: string }`.

## Steps

### 1. Read the route layout and DB helpers  <!-- agent: general-purpose -->

- [ ] Use `mcp__serena__get_symbols_overview` on `host-server/index.ts` and `host-server/db.ts` to confirm `getCheckpoint` exists and understand the error-response conventions.

### 2. Add the rollback route  <!-- agent: general-purpose -->

- [ ] Register `POST /api/agents/:agent/rollback` with body schema `{ checkpoint_id: number }`.
- [ ] Validate agent exists and has `worktree_path`; return 400 if no worktree.
- [ ] Fetch checkpoint; validate ownership; 404 if mismatch.
- [ ] Run `git -C <worktree_path> stash apply <stash_ref>` via `execSync`.
- [ ] Return `{ ok: true, stash_ref }` on success, or 500 `{ error, detail }` on git failure.

### 3. Typecheck  <!-- agent: general-purpose -->

- [ ] Run `npx tsc --noEmit` in `host-server/` — zero errors.

### 4. Smoke test  <!-- agent: general-purpose -->

- [ ] Seed a checkpoint row manually (or via TASK-068/069); call `POST /api/agents/<id>/rollback` with its `checkpoint_id`; confirm `git stash apply` ran and working-tree state was restored.
- [ ] Call rollback for a non-git agent; confirm 400 is returned.

## Acceptance Criteria

- [ ] `POST /api/agents/:agent/rollback` with a valid `checkpoint_id` applies `git stash apply <stash_ref>` in the worktree.
- [ ] Returns `{ ok: true, stash_ref }` on success.
- [ ] Returns 400 if the agent has no worktree.
- [ ] Returns 404 if the agent or checkpoint is not found, or the checkpoint belongs to a different agent.
- [ ] Returns 500 with an error message if the git command fails.
- [ ] `npx tsc --noEmit` passes in `host-server/`.

## Dependencies

- **DEPENDS ON [TASK-067](TASK-067-agent-checkpoints-table.md)** — `agent_checkpoints` table and `getCheckpoint` helper must exist.

### Roadmap

Implements ROADMAP-007 Phase 3, item "Add POST /api/agents/:agent/rollback endpoint to apply a selected checkpoint" — `wiki/work/roadmaps/ROADMAP-007-git-workflow.md`.
