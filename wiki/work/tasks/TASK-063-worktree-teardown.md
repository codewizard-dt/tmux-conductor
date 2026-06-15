---
id: TASK-063
title: "Worktree teardown — git worktree remove --force on agent delete"
status: todo
created: 2026-06-14
updated: 2026-06-14
depends_on: [TASK-060]
blocks: []
parallel_safe_with: [TASK-061, TASK-062, TASK-064, TASK-065, TASK-067]
uat: ""
tags: [git, worktree, cleanup, host-server, roadmap-007]
---

# TASK-063 — Worktree teardown — git worktree remove --force on agent delete

## Objective

When an agent is deleted, clean up its git worktree by running `git worktree remove --force <worktree_path>`. Agents without a `worktree_path` (non-git workdirs) must be skipped silently.

## Approach

Extend the agent-delete path in `host-server/index.ts` (the `DELETE /agents/:agent` handler). Before the `DELETE FROM agents` SQL, read the agent's `worktree_path` and `branch` from the DB. If `worktree_path` is non-null, run `git worktree remove --force <worktree_path>` as a child process. Log but do not throw on git errors (the DB row should still be deleted). Optionally also delete the branch with `git branch -D <branch>` from the git root.

## Steps

### 1. Read the delete handler  <!-- agent: general-purpose -->

- [ ] Use `mcp__serena__get_symbols_overview` on `host-server/index.ts` to locate the agent-delete route (`DELETE /agents/:agent`).
- [ ] Confirm it reads the agent row before deleting (or add a `SELECT` to fetch `worktree_path` and `branch` first).

### 2. Add worktree cleanup  <!-- agent: general-purpose -->

- [ ] Before the `DELETE FROM agents` statement, fetch the agent row.
- [ ] If `worktree_path` is non-null, run `git worktree remove --force <worktree_path>` via `execSync`; catch and log any error without throwing.
- [ ] Optionally delete the associated branch: derive `gitRoot` from `worktree_path` (parent of the `worktrees/` directory) and run `git -C <gitRoot> branch -D <branch>`, catching errors.

### 3. Proceed with DB delete  <!-- agent: general-purpose -->

- [ ] Run the `DELETE FROM agents WHERE id = ?` regardless of whether the git cleanup succeeded, so the DB stays consistent.

### 4. Typecheck  <!-- agent: general-purpose -->

- [ ] Run `npx tsc --noEmit` in `host-server/` — zero errors.

### 5. Manual smoke test  <!-- agent: general-purpose -->

- [ ] Delete an agent that has a worktree; confirm the `worktrees/<id>/` directory and `conductor/<id>` branch are removed.
- [ ] Delete an agent with no worktree (`worktree_path = NULL`); confirm it deletes cleanly with no git errors.

## Acceptance Criteria

- [ ] Deleting an agent with a `worktree_path` removes the worktree directory and (optionally) the branch from the git repo.
- [ ] Deleting an agent with `worktree_path = NULL` succeeds silently with no git errors.
- [ ] A git error during cleanup does not block the DB delete (agent row is always removed).
- [ ] `npx tsc --noEmit` passes in `host-server/`.

## Dependencies

- **DEPENDS ON [TASK-060](TASK-060-agents-worktree-schema.md)** — `worktree_path` column must exist to read from.

### Roadmap

Implements ROADMAP-007 Phase 1, item "On agent delete, run `git worktree remove --force <path>` to clean up" — `wiki/work/roadmaps/ROADMAP-007-git-workflow.md`.
