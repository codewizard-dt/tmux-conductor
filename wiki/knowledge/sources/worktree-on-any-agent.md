---
id: worktree-on-any-agent
title: Create-a-Worktree Action on Any Agent
aliases: [worktree-on-any-agent, Create worktree button on any agent]
updated: 2026-09-20
sources:
  - ../../../raw/research/worktree-on-any-agent/index.md
  - ../../../raw/research/worktree-on-any-agent/sources.md
confidence: extracted
tags: [worktree, agents, dashboard, git, clone]
---

# Create-a-Worktree Action on Any Agent

The research started from the framing that agents "can already create a new worktree" via a button, and asked what it would take for that action to exist on **any** agent. **The action already exists**: `AgentDetailView` in `AgentList.tsx` renders a "Create worktree" button that calls `POST /agents/:id/worktree` → `db.ts::addWorktreeToAgent`. But it is gated on "this agent has no worktree" at both layers — the button only renders in the else-branch of `effectiveBranch ? <branch badge> : <button>`, and the backend throws `already has a worktree` (mapped to 409). So today "any agent" really means "any agent without a worktree, from the detail pane only"; it is not in `AgentActionsMenu` (where Clone lives).

**Three real gaps.** (1) The action is not reachable from the list/sidebar or actions menu. (2) An agent that already has a worktree cannot get another, because the path (`<repo>-worktrees/<agentId>`) and branch (`conductor/<agentId>`) are pure functions of the agent id. (3) `POST /agents/:id/clone` copies `workdir` verbatim and sets `useWorktree: Boolean(source.worktreePath)`, so cloning a worktree-less agent yields **two agents sharing one working tree**. A further sharp edge, inferred from the code and not exercised at runtime: `addWorktreeToAgent` only updates the DB row and does not restart the tmux window, so a live agent keeps its old cwd while the dashboard, diff, checkpoint stash and rollback all switch to the new worktree path.

**Recommendation.** Phase it low-risk first: surface the existing action from the actions menu with clear disabled states and real error text; add **"Clone into new worktree"** on every agent (force `useWorktree: true`, include `worktreePath`/`branch` in the clone SSE payload) — this fixes the shared-workdir hazard without any naming change; treat replacing or multiplying worktrees on a live agent as a separate, higher-risk data-model decision. The ROADMAP-007 amendment (worktrees are **opt-in only**, sibling layout) constrains every option: nothing may auto-create.

relates_to::[[agent-worktree-lifecycle]]
relates_to::[[Host Server]]
relates_to::[[AgentDetailModal]]
relates_to::[[Ephemeral Worker-Per-Task Coding Agent Orchestration]]
relates_to::[[agent-modal-actions-dropdown]]
