---
id: multi-agent-orchestration-patterns
title: Multi-Agent Orchestration Patterns (Orchestrator-Worker, Supervisor, Handoff)
updated: 2026-09-13
sources:
  - ../../../raw/research/orchestrator-agent-routing/index.md
  - ../../../raw/research/orchestrator-agent-routing/index-2.md
confidence: ambiguous
tags: [orchestration, multi-agent, routing, architecture]
---

# Multi-Agent Orchestration Patterns (Orchestrator-Worker, Supervisor, Handoff)

The industry-converged pattern for "an agent that routes tasks to other agents" is **orchestrator-worker** (Anthropic's own term, used in production for Claude's Research feature): a lead agent analyzes an incoming request, decomposes it into subtasks with explicit objectives/boundaries/output formats, and delegates to specialized subagents/workers that run independently or in parallel. The same shape appears under different names elsewhere — LangGraph's **supervisor pattern** (`create_supervisor`, a central node that "controls all communication flow and task delegation, making decisions about which agent to invoke based on the current context") and Azure's **handoff orchestration** (routing/triage/dispatch — dynamic delegation where each agent can assess a task and pass it to a more appropriate agent).

**When to use a router at all is the load-bearing question, not how to build one.** Azure's guidance is explicit: "The appropriate agent... is identifiable from the initial input. In that case, use deterministic routing or a simpler dispatcher that doesn't take an active role in processing" — an LLM-driven router earns its cost only once the correct destination genuinely isn't derivable from the task text by a rule. Anthropic's own newer guidance reinforces this from the builder's side: "we've seen teams invest months building elaborate multi-agent architectures only to discover that improved prompting on a single agent achieved equivalent results." A capability taxonomy (declared tags/skills per agent, per AWS's Agentic AI Lens) plus a deterministic match is the correct starting point; an LLM call is the escalation for the residual ambiguous cases, gated so it never runs unconditionally per task (multi-agent orchestration runs roughly 15x the token cost of a single chat turn).

**Documented failure modes are specific and recurring.** NeurIPS 2025's MAST taxonomy (1,600+ execution traces across AutoGen, CrewAI, and LangGraph) attributes roughly 40% of multi-agent pilot failures to three root causes: *specification ambiguity* (underspecified role/task boundaries — Anthropic's own research system hit this early, with one subagent duplicating another's work because delegation instructions were too vague), *coordination breakdowns* (message loss, circular handoffs — the concrete symptom is a "routing loop," e.g. a supervisor and a specialist deferring back and forth until a recursion limit trips), and *verification gaps* (no independent check of a worker's output before a handoff is considered complete). Coordination failures alone account for ~37% of all failures across those three frameworks. The fix for routing loops is reported to live in the router's own prompt/rules, not in raising the recursion limit.

**Observability and audit trail are treated as first-class, not optional**, once a system routes non-deterministically: AWS's Agentic AI Lens calls for "arbitration decisions, routing outcomes, fallback activations" to be observable telemetry, not side effects — the same lesson `relates_to::[[Observability for Agent Status Transitions]]` already applies to tmux-conductor's status-detection layer (a `transitions.jsonl`-shaped log recording *why* a transition/decision was made, not just that it happened) generalizes directly to a routing decision.

**Scale threshold**: research converges on escalating from a simple dispatcher to a full hierarchical/supervisor architecture only once worker count exceeds roughly 5-8 agents, or independent parallel task volume dominates the workload — below that, the coordination overhead of a router (a second failure domain, per production LangGraph guides) usually costs more than it saves.

> **Contradiction (2026-09-13):** the ~5-8-agent scale threshold above is drawn from generic (chat/customer-support/research) multi-agent literature. A second research pass found this does not hold for the coding-agent-orchestration niche specifically: `corellis`, a governance framework purpose-built for coding-agent fleets, explicitly targets **20+ agent fleets**, and tmux-conductor's own live dispatch history already shows a double-digit number of distinct agents in a single day — past the generic threshold already. Treat the 5-8 figure as applicable to generic supervisor/chat architectures only, not as a general rule for coding-agent fleets. See `relates_to::[[Ephemeral Worker-Per-Task Coding Agent Orchestration]]` for the coding-specific pattern this threshold doesn't account for.

This orchestrator-worker/supervisor framing also assumes a **persistent pool of workers a router assigns work into**. A structurally different, equally well-established shape for coding-agent fleets specifically — provisioning a disposable worker (fresh git worktree + terminal session) per task rather than routing into an existing pool — is covered separately in `relates_to::[[Ephemeral Worker-Per-Task Coding Agent Orchestration]]`, alongside a third, decentralized shape where agents request handoffs from each other directly rather than through any central router.

derived_from::[[An Orchestrator Agent That Routes Commands/Tasks to Other Agents]]
relates_to::[[Host Server]]
relates_to::[[power-mode-skill]]
relates_to::[[Observability for Agent Status Transitions]]
relates_to::[[Ephemeral Worker-Per-Task Coding Agent Orchestration]]
