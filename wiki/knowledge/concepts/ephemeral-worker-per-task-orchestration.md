---
id: ephemeral-worker-per-task-orchestration
title: Ephemeral Worker-Per-Task Coding Agent Orchestration
aliases: [Worktree-Per-Task Pattern, Spawn-Per-Task Agent Orchestration]
updated: 2026-09-20
sources:
  - ../../../raw/research/worktree-on-any-agent/index.md
  - ../../../raw/research/orchestrator-agent-routing/index-2.md
  - ../../../raw/research/multi-agent-infrastructure-requirements/index.md
confidence: extracted
tags: [orchestration, multi-agent, git-worktree, tmux, prior-art]
---

# Ephemeral Worker-Per-Task Coding Agent Orchestration

A distinct multi-agent orchestration shape found specifically in tools built for **coding** agent fleets (as opposed to chat, customer-support, or research agents): rather than maintaining a persistent pool of long-lived agents and routing tasks into whichever one is free or best-matched, the orchestrator provisions a **fresh, disposable worker per task** — a new git worktree and branch, plus a new terminal/tmux session running the chosen agent CLI — runs it to completion, then merges the result and tears the worker down. There is no "which existing agent should get this" decision at all, because no existing agent is targeted; one is created for the task.

This is the dominant pattern across a populated, mature open-source tool category purpose-built for this exact niche: `dmux` creates a tmux pane and a git worktree/branch together per task, supports 10+ agent CLIs (Claude Code, Codex, Gemini CLI, OpenCode, Cline, and others), and ships "smart merging" (auto-commit/merge/cleanup in one step) plus lifecycle hooks at worktree-create, pre-merge, and post-merge. Claude Squad, Conductor, Crystal, and Vibe Kanban all follow the same worktree-per-task substrate. On top of that substrate, at least one project adds an explicit routing/coordinator layer nearly identical to what a "task-routing orchestrator agent" would need: `claude-vibe-squad`'s "Chrono" coordinator routes scoped task packets to role-based specialists across five different model families (Claude, Codex, Gemini, Grok, Kimi), each in its own isolated worktree, with a rival-family review gate before anything lands — entirely inside **one tmux session, no separate server process**.

**A distinct third shape, orthogonal to persistent-vs-ephemeral, decentralizes the routing decision itself**: `herdr` is a single background daemon whose defining feature is that agents drive it directly through a CLI/socket API to spawn new panes and prompt each other, rather than a central orchestrator process deciding on their behalf. This removes the "one router to get wrong" failure mode entirely, at the cost of the single audit trail a centralized router would otherwise provide.

**Scale note**: `corellis`, a governance framework in this same tool category, is explicitly built for 20+ agent fleets — well past the ~5-8-agent "escalate to hierarchical" threshold cited in generic (chat/research) multi-agent literature (see `relates_to::[[Multi-Agent Orchestration Patterns (Orchestrator-Worker, Supervisor, Handoff)]]`). Coding-agent fleets appear to tolerate — or require — a higher agent count before centralized coordination becomes necessary, likely because git-worktree isolation already resolves the file-conflict class of coordination failure that dominates generic multi-agent failure taxonomies.

**Relevance to `uses::[[tmux-conductor]]`**: tmux-conductor's data model (long-lived named `agents` rows, with rename/clone/skills/checkpoints) assumes persistent identity, but already has the underlying primitives this pattern needs — `agents.worktreePath` and the pre-dispatch git-checkpoint mechanism in `dispatchTaskToAgent` (`relates_to::[[Host Server]]`). Adopting this pattern for tasks with no suitable existing agent (rather than leaving them in an unassigned global queue bucket) would mean sequencing those existing primitives the way `dmux` sequences its lifecycle hooks, not building new isolation machinery from scratch.

**Infrastructure this pattern needs beyond a worktree (2026-09-19):** [[Infrastructure Requirements for a Multi-Agent Architecture (the Orchestrator Agent)]] finds worktree isolation is necessary but not sufficient. It defers conflicts to merge time rather than removing them, and ports, databases, Docker volumes and caches stay shared unless split per worktree; abandoned worktrees consume disk; coordination overhead grows non-linearly with agent count, so merges should be serialized one branch at a time. Fleet-scale tooling adds a FIFO merge queue and a watchdog. tmux-conductor has only create/remove/stash primitives in `git.ts` — **no merge function**, no merge queue, no teardown trigger, no orphan reaper — and `DEC-0006#D1`'s ephemeral fallback depends on all of them plus the BUG-0001 human-confirmation gate.

**Existing worktree creation surface (2026-09-20):** the worktree primitive is already reachable as an opt-in per-agent action (`POST /agents/:id/worktree`, create-time `useWorktree`, and clone), keyed by agent id (`<repo>-worktrees/<id>`, branch `conductor/<id>`) — a fresh agent id is what makes a new worktree collision-free, which is the natural building block for a worktree-per-task flow. See [[agent-worktree-lifecycle]].

derived_from::[[An Orchestrator Agent That Routes Commands/Tasks to Other Agents]]
relates_to::[[agent-worktree-lifecycle]]
relates_to::[[Infrastructure Requirements for a Multi-Agent Architecture (the Orchestrator Agent)]]
relates_to::[[Multi-Agent Orchestration Patterns (Orchestrator-Worker, Supervisor, Handoff)]]
relates_to::[[Host Server]]
relates_to::[[A2A Protocol]]
