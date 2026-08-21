---
id: TASK-068
aliases: [TASK-068]
title: "Pre-dispatch checkpoint — git stash push before each task dispatch + record in agent_checkpoints"
status: done
created: 2026-06-14
updated: 2026-08-15
depends_on: [TASK-067]
blocks: []
parallel_safe_with: [TASK-069, TASK-070, TASK-071]
uat: "[[UAT-068]]"
tags: [git, checkpoint, dispatch, monitor, roadmap-007]
---

# TASK-068 — Pre-dispatch checkpoint — git stash push before each task dispatch + record in agent_checkpoints

## Objective

Before each task dispatch (in both `monitor.sh` and the immediate-dispatch fast-path in `host-server/index.ts`), take a git stash snapshot of the agent's worktree and record it in the `agent_checkpoints` table. Agents without a worktree are silently skipped.

## Approach

**In `monitor.sh`:** Before the `dispatch` call, if the agent has a `worktree_path` stored in the DB, run:
```bash
git -C "$worktree_path" stash push -m "conductor-checkpoint-$(date +%s%3N)"
```
Capture the stash ref from the output (`stash@{N}`). Then call a new host-server endpoint `POST /api/agents/:agent/checkpoints` (from TASK-069) or directly insert into SQLite via `scripts/lib/db.sh` to record the checkpoint.

**In `host-server/index.ts`:** The immediate-dispatch fast-path (`POST /queue/:agent` when agent is idle) should do the same: look up `worktree_path`, run the stash command via `execSync`, insert the checkpoint row using the `insertCheckpoint` DB helper from TASK-067.

The stash snapshot is best-effort: if the stash fails (e.g., clean working tree has nothing to stash), log a warning and proceed with the dispatch anyway.

## Steps

### 1. Read the dispatch paths  <!-- agent: general-purpose -->

- [x] Use `mcp__serena__get_symbols_overview` on `scripts/monitor.sh` to locate the `dispatch` call and understand the surrounding context.
- [x] Use `mcp__serena__get_symbols_overview` on `host-server/index.ts` to locate the immediate-dispatch fast-path (idle agent + empty queue).
- [x] Confirm `insertCheckpoint` is available from `host-server/db.ts` (TASK-067).

<!-- Updated: 2026-07-06 — monitor.sh dispatch loop at ~L436-444 (mark_busy → optional /clear → dispatch task); host-server fast-path at POST /tasks ~L825-854. insertCheckpoint(db, agentId, ts, stashRef) confirmed in db.ts. -->


### 2. Add stash logic to `scripts/lib/db.sh` or `monitor.sh`  <!-- agent: general-purpose -->

- [x] In `monitor.sh` (or `scripts/lib/db.sh`), add a `checkpoint_agent()` function that:
  - queries `worktree_path` for the agent from SQLite,
  - runs `git -C "$worktree_path" stash push -m "conductor-checkpoint-<ts>"`,
  - captures the stash ref from the git output,
  - inserts a row into `agent_checkpoints` via sqlite3 or via a `POST /api/agents/:agent/checkpoints` call.
- [x] Call `checkpoint_agent "$agent"` in `monitor.sh` before each `dispatch` call.

<!-- Updated: 2026-07-06 — checkpoint_agent() added to scripts/lib/db.sh; called in monitor.sh right after mark_busy, before the /clear + task dispatch. Resolves stash@{0} to a stable SHA (checkpoints accumulate; stash@{N} shifts). ms ts via `node -e Date.now()` because `date +%s%3N` is GNU-only and breaks on BSD/macOS. Clean-worktree/no-worktree/git-error all warn+continue. -->


### 3. Add stash logic to the host-server fast-path  <!-- agent: general-purpose -->

- [x] In the immediate-dispatch handler in `host-server/index.ts`, after confirming the agent is idle:
  - Read `worktree_path` from the agent row.
  - If non-null, run `git -C <worktreePath> stash push -m "conductor-checkpoint-<ts>"` via `execSync`.
  - Parse the stash ref from stdout; call `insertCheckpoint(agentId, ts, stashRef)`.
  - On git error (e.g., nothing to stash), log and continue.

<!-- Updated: 2026-07-06 — added stashCheckpoint(worktreePath, ts) helper to host-server/git.ts (spawnSync, mirrors existing git helpers; returns resolved stash SHA or null on clean-tree/error). Fast-path in POST /tasks now calls it before sendTextToPane and records via insertCheckpoint; null → console.warn + continue. -->


### 4. Typecheck  <!-- agent: general-purpose -->

- [x] Run `npx tsc --noEmit` in `host-server/` — zero errors. <!-- Updated: 2026-07-06 — TSC_EXIT=0; `bash -n` clean on scripts/lib/db.sh + scripts/monitor.sh. -->


### 5. Smoke test  <!-- agent: general-purpose -->

- [DEFERRED-TO-UAT] Dispatch a task to an agent with a worktree; confirm a `stash@{N}` entry appears in `git stash list` inside the worktree and a row is inserted into `agent_checkpoints`.
- [DEFERRED-TO-UAT] Dispatch a task to an agent without a worktree; confirm no git command is run and the task dispatches normally.

<!-- Updated: 2026-07-06 — runtime smoke test deferred to UAT phase per tackle static-gate policy (needs a live tmux session + worktree agent). -->


## Acceptance Criteria

- [ ] Every task dispatch to a git-worktree agent creates a `git stash push -m "conductor-checkpoint-<ts>"` snapshot before the command is sent.
- [ ] The stash ref is recorded in `agent_checkpoints` with the correct `agent_id` and `ts`.
- [ ] Non-git agents (no `worktree_path`) dispatch without any git operations.
- [ ] A clean worktree (nothing to stash) logs a warning but does not block dispatch.
- [ ] `npx tsc --noEmit` passes in `host-server/`.

## Dependencies

- **DEPENDS ON [TASK-067](TASK-067-agent-checkpoints-table.md)** — `agent_checkpoints` table and `insertCheckpoint` helper must exist.

### Roadmap

Implements ROADMAP-007 Phase 3, item "Before each task dispatch, take a git snapshot: `git stash push -m 'conductor-checkpoint-<ts>'`" — `wiki/work/roadmaps/ROADMAP-007-git-workflow.md`.
