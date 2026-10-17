---
id: agent-worktree-lifecycle
title: Agent Worktree Lifecycle (Creation Paths, Identity, Clone Semantics)
aliases: [Agent Worktree Lifecycle, agent worktrees]
updated: 2026-09-20
sources:
  - ../../../raw/research/worktree-on-any-agent/index.md
confidence: extracted
tags: [worktree, git, agents, lifecycle]
---

# Agent Worktree Lifecycle

How an agent's isolated git worktree comes into being, is identified, is consumed, and is torn down in tmux-conductor.

**Creation is opt-in and has three entry points.** (1) `POST /agents` with `useWorktree` (the `AddAgentForm` checkbox "Use a git worktree"); (2) retroactively via `POST /agents/:id/worktree` → `addWorktreeToAgent` (the "Create worktree" button in the agent detail Details panel, shown only when the agent has no branch); (3) `POST /agents/:id/clone`, which forwards `useWorktree: Boolean(source.worktreePath)` — so a clone gets a worktree **only if its source has one**. ROADMAP-007's 2026-08-15 amendment made this opt-in-only after unconditional creation produced unwanted worktrees; any new surface must remain explicit and user-initiated.

**Identity is derived from the agent id, not stored independently.** Path = `siblingWorktreePath(gitRoot, id)` = `<parent-of-gitRoot>/<repo>-worktrees/<id>`; branch = `conductor/<id>`. Consequences: one worktree per agent, a second one for the same agent is impossible without a naming/data-model change, and a fresh agent (e.g. a clone) naturally gets a non-colliding pair. `createWorktree` returns only a boolean, so failures surface as a generic message.

**Consumers of `worktreePath`:** pre-dispatch checkpoint stash (`dispatchTaskToAgent`), the diff endpoint (`worktreePath || workdir`), checkpoint rollback (400 when absent), and delete-time teardown (`removeWorktree` then `deleteBranch`, best-effort, git root derived from `workdir` with a path-based fallback). `resolveAgentWorktree` self-heals: if the directory has vanished, the DB reference is cleared on next read.

**Known hazards.** Cloning a worktree-less agent yields two agents on one working tree (see also the workdir-sharing caveat across agents). Retroactively adding a worktree to a **live** agent changes only the DB row — the tmux pane's cwd is unchanged *(inference from code, not runtime-verified)* — so dashboard views and the agent's actual edits can diverge. The worktree route deliberately emits no SSE (`agent-update` payloads are full status-shaped records), so other clients learn about it only on the next status poll.

derived_from::[[worktree-on-any-agent]]
relates_to::[[Host Server]]
relates_to::[[Ephemeral Worker-Per-Task Coding Agent Orchestration]]
relates_to::[[AgentDetailModal]]
