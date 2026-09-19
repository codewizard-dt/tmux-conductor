---
id: orchestrator-agent-routing
title: An Orchestrator Agent That Routes Commands/Tasks to Other Agents
aliases: [Task Routing Orchestrator Research, Orchestrator Agent Research]
updated: 2026-09-13
sources:
  - ../../../raw/research/orchestrator-agent-routing/index.md
  - ../../../raw/research/orchestrator-agent-routing/index-2.md
confidence: ambiguous
tags: [orchestration, multi-agent, routing, task-queue, host-server, prior-art]
---

# An Orchestrator Agent That Routes Commands/Tasks to Other Agents

Research into adding a new agent role to tmux-conductor — one that decides *which* agent in the fleet should receive a given task, rather than the current mechanical FIFO dequeue. **The current system has no content-aware routing at all**: `host-server/db.ts::popTask` and its bash mirror `pop_task_sql` (`scripts/lib/db.sh`) select the next queued row purely by SQL precedence — scoped-to-this-agent rows first, then global rows — and `dispatchTaskToAgent` (`host-server/index.ts`) is pure mechanics (checkpoint, state write, log, `send-keys`) once a task is popped. **Which agent gets a task is decided entirely by a human or script at task-insert time** (`scripts/add-task.sh`'s CWD-derived scoping, or the dashboard's `AddTaskForm.tsx`), never by an agent at dispatch time.

`power-mode` (a separate user-global skill) and Claude Code's own "Agent Teams" feature are the closest existing things to an orchestrator in this user's environment, but both operate one layer up: they orchestrate Claude Code's own in-process `Agent()` subagents/teammates within a single session, with **no visibility into tmux-conductor's cross-process SQLite task queue or its vendor-agnostic (Claude/Codex/Aider) tmux panes**. Building a routing agent for tmux-conductor's actual fleet is genuinely new scope — nothing in the wiki's active tasks/roadmaps addresses it.

External research converges on the **orchestrator-worker / supervisor pattern** (Anthropic's own production architecture for Claude's Research feature; LangGraph's `create_supervisor`) as the reference shape for "an agent that routes tasks to other agents." But the same sources are equally emphatic about when *not* to reach for it: Azure's Well-Architected guidance recommends deterministic routing whenever the correct agent is identifiable from the task text alone, and Anthropic's own newer guidance warns that many teams build elaborate multi-agent routing only to find improved single-agent prompting was sufficient. Recent failure-taxonomy research (NeurIPS 2025's MAST, 1,600+ traces across AutoGen/CrewAI/LangGraph) attributes roughly 40% of multi-agent pilot failures to three causes — specification ambiguity, coordination breakdowns (routing loops), and verification gaps — and multi-agent orchestration runs roughly 15x the token cost of a plain chat turn, making an LLM-driven router something to add only where a deterministic rule demonstrably can't place a task.

**Recommendation (round 1)**: extend the existing `popTask`/`pop_task_sql` precedence with a declared-capability/tag match tier (cheap, deterministic, fits this project's no-auth/single-user/no-daemon posture) before adding any LLM routing step; if an LLM router is added later, run it as a host-server background job (mirroring the existing `dueSchedules`/`fireSchedule` async-job shape) that calls the existing `POST /queue/:agent` endpoint — never a direct pane write — and log every routing decision the same way `transitions.jsonl` already logs status-transition reasoning. A dedicated orchestrator *pane* (a full extra Claude Code instance, à la `power-mode`) was judged unjustified at the fleet's current size.

> **Contradiction (round 2, 2026-09-13):** round 1's fleet-size and "extend the existing router" framing were both re-examined and partially overturned. (1) Live `dispatch.jsonl` shows the fleet already cycling through a double-digit number of distinct agent names in a single day — well past the ~5-8-agent threshold round 1 used to defer a dedicated orchestration mechanism. (2) A populated, mature ecosystem of tools purpose-built for orchestrating fleets of *coding* CLI agents (Claude Squad, Conductor, Crystal, Vibe Kanban, dmux, `claude-vibe-squad`, `corellis`, `herdr`) was found on a second pass and was missing from round 1 entirely — its dominant shape is **ephemeral worker-per-task** (a fresh git worktree + tmux pane provisioned per task, then merged and torn down), not "route into a persistent pool," and at least one project (`corellis`) is explicitly built for 20+ agent fleets, well past round 1's cited threshold. Round 1's tag-precedence recommendation still stands as correct for tasks scoped to an existing named agent, but is no longer presented as the whole answer — see `derived_from::[[Ephemeral Worker-Per-Task Coding Agent Orchestration]]` for the revised, broader recommendation.

derived_from::[[Multi-Agent Orchestration Patterns (Orchestrator-Worker, Supervisor, Handoff)]]
derived_from::[[Ephemeral Worker-Per-Task Coding Agent Orchestration]]
relates_to::[[power-mode-skill]]
relates_to::[[claude-code-agent-teams]]
relates_to::[[Host Server]]
relates_to::[[A2A Protocol]]
