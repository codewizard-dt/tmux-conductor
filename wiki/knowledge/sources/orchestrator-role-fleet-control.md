---
id: orchestrator-role-fleet-control
title: An `orchestrator` Agent Role That Manages tmux-Window Agents and Background Processes
aliases: [Orchestrator Role Research, Fleet-Control Orchestrator]
updated: 2026-09-20
sources:
  - ../../../raw/research/orchestrator-role-fleet-control/index.md
  - ../../../raw/research/orchestrator-role-fleet-control/sources.md
confidence: inferred
tags: [orchestration, roles, host-server, bg-processes, security, agents]
---

# An `orchestrator` Agent Role That Manages tmux-Window Agents and Background Processes

Earlier orchestrator research asked how a *task* finds its agent ([[An Orchestrator Agent That Routes Commands/Tasks to Other Agents]]) and what infrastructure must exist beneath any orchestrator ([[Infrastructure Requirements for a Multi-Agent Architecture (the Orchestrator Agent)]]). This round asks a different question: what does it take for one agent, carrying a new **`orchestrator` role**, to manage the *lifecycle* of the fleet's tmux windows and background processes? **Nearly every verb it needs already exists as an unauthenticated host-server route** — create agent, open/close/reopen a window, enqueue a task, tail output, open/close a bg window — and the only missing verb, bg restart, is already scheduled in ROADMAP-0024. The gap is identity, effect, and guardrails, not a control API.

Three code facts frame the work. **(1)** `agents.role` is a SQLite CHECK enum of seven values (schema v7), so adding `orchestrator` needs an `agents` table-rebuild migration on the v8 `tasks_v8` pattern, plus four in-sync edit sites (CHECK, `ROLE_VALUES`, `role-presets.json`, migration fixtures). **(2)** A role only changes an agent's behaviour if the agent has a **worktree**: `applyRoleFragmentToWorktree` has exactly two call sites, both in worktree creation, so a non-worktree agent — which an orchestrator normally is — gets no role-driven prompt at all. **(3)** The spawn env carries only `CONDUCTOR_AGENT_NAME` (the non-injective `<project>-<name>` window name); neither the agent's numeric id nor its role is exported.

**The security framing is the central finding.** Under the repo's no-auth, single-user trust model a call without the caller header is treated as a human, so "only orchestrators may do X" **cannot be enforced** — any agent can omit the header, or run `tmux` directly under its skip-permissions launch. What *is* enforceable is a **capability grant plus guardrails plus audit**: recognise orchestrator callers to apply *extra* limits (no self-target, no orchestrator-creates-orchestrator, a max-active-agents cap, human confirmation for delete), and attribute every action in a JSONL log. See [[Agent Role as Capability Grant, Not Permission Wall (No-Auth Trust Model)]]. The orchestrator drives workers through the queue only, never `/agents/:id/keys` (see [[Agent as Tool vs. Subagent (Conversational Authority)]]).

**Recommendation:** extend the role enum with `orchestrator`; scope v1 to **lifecycle management** (window and bg control), deliberately excluding task-completion tracking and task routing, which depend on unbuilt Tier-0 infrastructure; deliver tools as a `curl`-wrapping skill following the `dev-commands` precedent; identify callers by numeric agent id (env `CONDUCTOR_AGENT_ID`, extending TASK-0193's header convention) rather than window name; wake the orchestrator with an existing `schedules` row. Sequence after ROADMAP-0024's restart, liveness, audit and caller-resolution work, and after ROADMAP-0023's `AgentList` rewrite for any UI.

> **Contradiction:** [[ADR-0006]] (accepted 2026-09-18) lists "Role → behaviour injection — **Exists**" among its primitives. The code shows it exists only for agents that have a worktree (`applyRoleFragmentToWorktree` is called solely from worktree creation paths). For a non-worktree agent the role is a label with no behavioural effect. ADR-0006 is a work artifact and is not edited here; any role-tier router or orchestrator role that assumes injection for every agent is relying on a false premise.

> **Contradiction:** [[Infrastructure Requirements for a Multi-Agent Architecture (the Orchestrator Agent)]] recommended deferring "orchestrator-as-agent (W)" because of its full pane authority and reliance on the unreliable idle signal. This request is that shape. The reconciliation is scope: a lifecycle-only orchestrator that acts through existing routes with server-side guardrails avoids depending on task-completion semantics, but it does not remove the skip-permissions blast radius — that residual risk is accepted, not solved.

**Still unverified:** where the frontend role picker lives (the frontend treats role as a free string), whether `TMUX_PANE`-based caller verification is worth adding over the header, and whether an allow-rule–restricted (non-skip-permissions) orchestrator launch is practical.

derived_from::[[An Orchestrator Agent That Routes Commands/Tasks to Other Agents]]
relates_to::[[Infrastructure Requirements for a Multi-Agent Architecture (the Orchestrator Agent)]]
relates_to::[[Agent Role as Capability Grant, Not Permission Wall (No-Auth Trust Model)]]
relates_to::[[Agent as Tool vs. Subagent (Conversational Authority)]]
relates_to::[[LLM Orchestrator Runtime Options (tmux Agent vs. claude -p vs. Agent SDK)]]
relates_to::[[Background Process Registry (bg_processes) — Mechanism and Gaps]]
relates_to::[[Agent Worktree Lifecycle (Creation Paths, Identity, Clone Semantics)]]
relates_to::[[Claude Code Instruction Placement (CLAUDE.md vs. Rules vs. Launch Flags)]]
relates_to::[[Host Server]]
