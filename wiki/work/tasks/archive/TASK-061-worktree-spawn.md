---
id: TASK-061
aliases: [TASK-061]
title: "Worktree spawn — detect git repo on agent spawn, create worktree + branch, store in DB"
status: done
created: 2026-06-14
updated: 2026-07-06
depends_on: [TASK-060]
blocks: [TASK-062]
parallel_safe_with: [TASK-063, TASK-064, TASK-065, TASK-067]
uat: "[[UAT-061]]"
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

- [x] Use `mcp__serena__get_symbols_overview` on `host-server/index.ts` to locate the agent-creation route (`POST /agents` or equivalent) and the `INSERT INTO agents` statement.
- [x] Confirm the TypeScript type for agent rows now includes `worktree_path` and `branch` (from TASK-060).

**Findings:** `POST /agents` handler at `host-server/index.ts:901` calls `createAgent(db, {...})` (index.ts:935) then `spawnAgentWindow(...)` (index.ts:937); a second creation call site exists at `index.ts:1817` (project-scoped). `createAgent` lives in `host-server/db.ts:474-491` and does the `INSERT INTO agents` — it does NOT yet accept/insert `worktree_path`/`branch`. DB schema v3 already added `worktree_path`/`branch` columns and `AgentRow` (db.ts:109-118) has them as `string | null` optional — but the public `Agent` interface (db.ts:15-23) and `mapAgent` (db.ts:184-187) do NOT map them yet, so that gap must be closed in this task too. A reusable git helper module `host-server/git.ts` already exists (`isGitRepo`, `detectBaseBranch`, using `spawnSync('git', ...)`) with a matching `git.test.ts` — new worktree-creation logic should live there rather than inline in index.ts.
<!-- Updated: 2026-07-06 14:00 -->

### 2. Add git-repo detection  <!-- agent: general-purpose -->

- [x] After the `INSERT INTO agents`, run `git -C <workdir> rev-parse --show-toplevel` via `execSync`; capture stdout as `gitRoot`.
- [x] Catch errors (non-zero exit = not a git repo); set `gitRoot = null` and proceed without creating a worktree.

**Findings:** Added `getGitRoot(workdir): string | null` to `host-server/git.ts` (spawnSync-based, matches `isGitRepo`/`detectBaseBranch` pattern, returns `null` on any failure rather than throwing). Wired into `createAgent` (`host-server/db.ts`) right after the `INSERT INTO agents`, with a comment marking the step-3 seam (worktree add + `UPDATE agents` + `Agent`/`mapAgent` type gap, deliberately left for step 3). `npx tsc --noEmit` in `host-server/` passed with zero errors. Verified via Serena `find_symbol` post-hoc — no collision damage.
<!-- Updated: 2026-07-06 14:10 -->

### 3. Create the worktree and branch  <!-- agent: general-purpose -->

- [x] When `gitRoot` is non-null, construct `worktreePath = path.join(gitRoot, 'worktrees', agentId)` and `branch = \`conductor/\${agentId}\``.
- [x] Run `git -C <gitRoot> worktree add <worktreePath> -b <branch>` via `execSync`.
- [x] On success, `UPDATE agents SET worktree_path = ?, branch = ? WHERE id = ?`.
- [x] On git failure, log a warning but do not abort the agent creation.

**Findings:** Added `createWorktree(gitRoot, worktreePath, branch): boolean` to `host-server/git.ts` (spawnSync `git worktree add <path> -b <branch> <baseRef>`, base ref from `detectBaseBranch`, returns false on failure rather than throwing). Wired into `createAgent` (db.ts): on `gitRoot` non-null, computes `worktreePath`/`branch` from `row.id`, calls `createWorktree`, on success runs the `UPDATE agents SET worktree_path/branch`, on failure `console.warn`s and leaves columns NULL — never aborts. Also closed the type gap: `Agent` interface now has `worktreePath: string | null; branch: string | null;` and `mapAgent` maps them from the row, so `findAgentById` (called after the UPDATE) returns the populated values to all callers. `npx tsc --noEmit` in `host-server/` passed clean. Verified via Serena `find_symbol` post-hoc — code intact, no collision damage.
<!-- Updated: 2026-07-06 14:25 -->

### 4. Typecheck  <!-- agent: general-purpose -->

- [x] Run `npx tsc --noEmit` in `host-server/` — zero errors.

**Findings:** `cd host-server && npx tsc --noEmit` — exit code 0, no output.
<!-- Updated: 2026-07-06 14:30 -->

### 5. Manual smoke test  <!-- agent: general-purpose -->

- [DEFERRED-TO-UAT] Create an agent via `POST /agents` with a `workdir` pointing to a git repo; confirm a new branch `conductor/<id>` appears in `git branch --list` and `worktrees/<id>/` exists.
- [DEFERRED-TO-UAT] Create an agent with a non-git `workdir`; confirm it is created without error and `worktree_path`/`branch` are `NULL`.

**Note:** Runtime/E2E verification (real POST /agents calls, live tmux + git worktree side effects) is out of scope for the implementation phase per tackle's static-gates-only rule — deferred to UAT walkthrough.
<!-- Updated: 2026-07-06 14:32 -->

## Acceptance Criteria

- [ ] Spawning an agent with a git workdir creates a `worktrees/<agent-id>/` directory and a `conductor/<agent-id>` branch in the repo.
- [ ] `agents` row has `worktree_path` and `branch` populated for git-workdir agents.
- [ ] Non-git workdirs: agent is created normally; `worktree_path` and `branch` are `NULL`; no error is thrown.
- [ ] `npx tsc --noEmit` passes in `host-server/`.

## Dependencies

- **DEPENDS ON [TASK-060](TASK-060-agents-worktree-schema.md)** — `worktree_path` and `branch` columns must exist before this task can store them.

### Roadmap

Implements ROADMAP-007 Phase 1, items "On agent spawn from a project, detect if workdir is a git repo and call `git worktree add`" and "Store the worktree path and branch in the agents row; skip silently for non-git workdirs" — `wiki/work/roadmaps/ROADMAP-007-git-workflow.md`.
