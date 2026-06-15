---
id: TASK-061
title: "Worktree spawn — detect git repo on agent spawn, create worktree + branch, store in DB"
status: todo
created: 2026-06-14
updated: 2026-06-14
depends_on: [TASK-060]
blocks: [TASK-062]
parallel_safe_with: [TASK-063, TASK-064, TASK-065, TASK-067]
uat: ""
tags: [git, worktree, spawn, host-server, roadmap-007]
---

# TASK-061 — Worktree spawn — detect git repo on agent spawn, create worktree + branch, store in DB

## Objective

When an agent is spawned from a project whose `workdir` is a git repository, automatically create a dedicated git worktree and branch for that agent, and store the resulting `worktree_path` and `branch` values in the `agents` row. Non-git workdirs must be silently skipped.

## Approach

Extend the agent-spawn path in `host-server/index.ts` (the `POST /agents` handler, or wherever `INSERT INTO agents` is executed). After the row is inserted:

1. Check whether `workdir` is inside a git repo (`git -C <workdir> rev-parse --is-inside-work-tree`).
2. If it is, derive a branch name from the agent ID/name (e.g., `conductor/<agent-id>`) and a worktree path (e.g., `<git-root>/worktrees/<agent-id>`).
3. Call `git -C <git-root> worktree add <worktree-path> -b <branch>` as a child process.
4. Update the `agents` row with the resulting `worktree_path` and `branch` values.
5. If the workdir is not a git repo, leave `worktree_path` and `branch` as `NULL`; log a debug note but do not throw.

Use Node's `child_process.execSync` or `spawnSync` with a short timeout; surface git errors as a non-fatal warning (agent is still created).

## Steps

### 1. Read the spawn path  <!-- agent: general-purpose -->

- [ ] Use `mcp__serena__get_symbols_overview` on `host-server/index.ts` to locate the agent-creation route (`POST /agents` or equivalent) and the `INSERT INTO agents` statement.
- [ ] Confirm the TypeScript type for agent rows now includes `worktree_path` and `branch` (from TASK-060).

### 2. Add git-repo detection  <!-- agent: general-purpose -->

- [ ] After the `INSERT INTO agents`, run `git -C <workdir> rev-parse --show-toplevel` via `execSync`; capture stdout as `gitRoot`.
- [ ] Catch errors (non-zero exit = not a git repo); set `gitRoot = null` and proceed without creating a worktree.

### 3. Create the worktree and branch  <!-- agent: general-purpose -->

- [ ] When `gitRoot` is non-null, construct `worktreePath = path.join(gitRoot, 'worktrees', agentId)` and `branch = \`conductor/\${agentId}\``.
- [ ] Run `git -C <gitRoot> worktree add <worktreePath> -b <branch>` via `execSync`.
- [ ] On success, `UPDATE agents SET worktree_path = ?, branch = ? WHERE id = ?`.
- [ ] On git failure, log a warning but do not abort the agent creation.

### 4. Typecheck  <!-- agent: general-purpose -->

- [ ] Run `npx tsc --noEmit` in `host-server/` — zero errors.

### 5. Manual smoke test  <!-- agent: general-purpose -->

- [ ] Create an agent via `POST /agents` with a `workdir` pointing to a git repo; confirm a new branch `conductor/<id>` appears in `git branch --list` and `worktrees/<id>/` exists.
- [ ] Create an agent with a non-git `workdir`; confirm it is created without error and `worktree_path`/`branch` are `NULL`.

## Acceptance Criteria

- [ ] Spawning an agent with a git workdir creates a `worktrees/<agent-id>/` directory and a `conductor/<agent-id>` branch in the repo.
- [ ] `agents` row has `worktree_path` and `branch` populated for git-workdir agents.
- [ ] Non-git workdirs: agent is created normally; `worktree_path` and `branch` are `NULL`; no error is thrown.
- [ ] `npx tsc --noEmit` passes in `host-server/`.

## Dependencies

- **DEPENDS ON [TASK-060](TASK-060-agents-worktree-schema.md)** — `worktree_path` and `branch` columns must exist before this task can store them.

### Roadmap

Implements ROADMAP-007 Phase 1, items "On agent spawn from a project, detect if workdir is a git repo and call `git worktree add`" and "Store the worktree path and branch in the agents row; skip silently for non-git workdirs" — `wiki/work/roadmaps/ROADMAP-007-git-workflow.md`.
