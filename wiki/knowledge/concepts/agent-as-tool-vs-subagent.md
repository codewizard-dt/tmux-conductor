---
id: agent-as-tool-vs-subagent
title: Agent as Tool vs. Subagent (Conversational Authority)
updated: 2026-09-19
sources:
  - ../../../raw/research/orchestrator-agent-routing/index-3.md
confidence: extracted
tags: [orchestration, multi-agent, failure-mode, architecture]
---

# Agent as Tool vs. Subagent (Conversational Authority)

A named, production-documented orchestration failure axis: when a delegate agent can take **conversational authority** — interact directly with the user, or otherwise take over the interaction instead of returning control to its caller — orchestration reliability collapses, independent of how carefully the delegate is prompted. One practitioner's account: "Subagents began taking over the conversation in ways that were impossible to reliably prevent using prompts alone" despite explicit instructions like "Do not interact with the user" and "Return control to the orchestrator" — concluding "this was not a prompt problem. It was an architectural one."

**The fix is the "Agent as Tool" pattern**: constrain every delegate to be invoked strictly as a callable tool — it receives input, returns a structured result, and always hands control back to the caller. "Tools cannot take over the conversation" — the constraint is architectural (the calling convention itself), not a matter of instructing the delegate to behave.

**Why this matters unusually strongly for `uses::[[tmux-conductor]]`:** its coding agents are not in-process LLM subagents returning structured results — they are separate OS processes with a live, interactive tmux pane as their only interface, free to run indefinitely, ask their own clarifying questions, and never mechanically "hand back control" the way a function call does. This is a **more extreme case of conversational authority** than anything the source literature describes. It directly reinforces (rather than merely coexists with) the existing design constraint that any router or orchestrator built for tmux-conductor must interact with agents only through `POST /queue/:agent` (enqueue) — never through `POST /agents/:agent/keys` (direct pane keystroke injection, which grants the same unmediated conversational control this pattern warns against).

**Applied to an `orchestrator` role (2026-09-20):** the same rule shapes its route grant — enqueue via `POST /tasks` and manage window/bg *lifecycle*, but exclude `POST /agents/:id/keys` and `/mode` (unmediated pane control) and gate agent deletion behind human confirmation. See [[Agent Role as Capability Grant, Not Permission Wall (No-Auth Trust Model)]].

derived_from::[[An Orchestrator Agent That Routes Commands/Tasks to Other Agents]]
relates_to::[[Agent Role as Capability Grant, Not Permission Wall (No-Auth Trust Model)]]
relates_to::[[Multi-Agent Orchestration Patterns (Orchestrator-Worker, Supervisor, Handoff)]]
relates_to::[[Specialized-Agent Registry / Catalog Pattern]]
relates_to::[[Host Server]]
