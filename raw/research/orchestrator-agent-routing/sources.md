---
topic: A new type of agent that acts as an orchestrator of other agents, routing commands and tasks as needed
slug: orchestrator-agent-routing
researched: 2026-09-13
---

# Primary Sources — Orchestrator Agent for Routing Commands/Tasks

| ID | Type | Locator | Accessed | What it contributed |
|----|------|---------|----------|---------------------|
| S1 | codebase | `host-server/db.ts::popTask` (line 840) | 2026-09-13 | Current task-pop is a pure SQL precedence rule (scoped rows first, then global), soft-flips row to `done` — no content/capability matching |
| S2 | codebase | `scripts/lib/db.sh::pop_task_sql` (line 87) | 2026-09-13 | Bash mirror of the same precedence-only pop logic used by `monitor.sh` |
| S3 | codebase | `host-server/index.ts::dispatchTaskToAgent` (lines 493-540) | 2026-09-13 | Dispatch is pure mechanics (git checkpoint, state-file write, dispatch.jsonl log, optional `/clear`, `send-keys`) — zero reasoning about *which* agent should get a task; that decision already happened when the task was inserted |
| S4 | codebase | `wiki/knowledge/entities/tools/power-mode-skill.md` | 2026-09-13 | `power-mode` is the closest existing "orchestrator" in this user's environment, but it drives Claude Code's own in-process `Agent()` subagents/teammates through a roadmap pipeline — it has no visibility into tmux-conductor's cross-process SQLite task queue or agent panes |
| S5 | codebase | `wiki/knowledge/concepts/claude-code-agent-teams.md` | 2026-09-13 | Claude Code's "Agent Teams" is bounded to one interactive session (no nesting, one team per session) — a different layer than tmux-conductor's cross-process, vendor-agnostic pane orchestration |
| S6 | codebase | `wiki/work/tasks/index.md`, `wiki/work/roadmaps/index.md` | 2026-09-13 | Confirms no existing task/roadmap addresses content-aware or capability-aware task routing — this is greenfield for the project |
| S7 | context7 | `/websites/code_claude_en_agent-sdk` — "orchestrator agent spawning subagents programmatically routing tasks to specialized agents" | 2026-09-13 | Claude Agent SDK's subagent definition shape: each subagent carries a `description` (used purely so the orchestrating model can decide *when* to invoke it), a scoped `tools` allowlist, and an optional `model` override — routing is a description-matching decision made by an LLM, not a fixed rule |
| S8 | web | https://www.anthropic.com/engineering/multi-agent-research-system | 2026-09-13 | Anthropic's production orchestrator-worker pattern: a lead agent analyzes a query, develops a strategy, and spawns subagents with explicit objectives/boundaries/output formats; vague delegation ("research the semiconductor shortage") caused subagents to duplicate work or leave gaps until instructions were made explicit |
| S9 | web | https://claude.com/blog/building-multi-agent-systems-when-and-how-to-use-them | 2026-09-13 | Anthropic's own caution: "we've seen teams invest months building elaborate multi-agent architectures only to discover that improved prompting on a single agent achieved equivalent results" — frames orchestrator-subagent as the default *starting* hierarchical pattern, not an automatic upgrade |
| S10 | web | https://reference.langchain.com/python/langgraph-supervisor | 2026-09-13 | LangGraph's supervisor pattern: a central supervisor "controls all communication flow and task delegation, making decisions about which agent to invoke based on the current context and task requirements" — the most mature reference implementation of an agent that routes tasks to other agents |
| S11 | web | https://markaicode.com/architecture/langgraph-supervisor-architecture/ | 2026-09-13 | Production supervisor deployments favor a durable checkpointer + external message/task queue over direct in-process calls at scale; "Most teams don't need a supervisor... a supervisor adds a routing hop and a second failure domain for no real benefit" for a single task type handled well by one agent |
| S12 | web | https://callsphere.ai/blog/langgraph-supervisor-multi-agent-orchestration-2026 | 2026-09-13 | Concrete production failure mode: routing loops from `recursion_limit` hits ("supervisor keeps asking the wrong specialist who keeps deferring back") — fixed in the supervisor prompt, not the limit; also documents supervisor-model-choice as the main cost lever |
| S13 | web | https://www.glukhov.org/ai-systems/architecture/multi-agent-orchestration-patterns/ | 2026-09-13 | Cites NeurIPS 2025 MAST (Multi-Agent System Failure Taxonomy, 1,600+ traces across AutoGen/CrewAI/LangGraph): failures split into three root categories — specification ambiguity, coordination breakdowns, verification gaps; "escalate to hierarchical when worker count exceeds 5-8" |
| S14 | web | https://www.augmentcode.com/guides/multi-agent-orchestration-architecture-guide | 2026-09-13 | Quantifies cost: multi-agent orchestration runs ~15x the tokens of a chat interaction; coordination failures account for 36.94% of all failures across AutoGen/CrewAI/LangGraph — "four primitives" framing (decomposition, routing, state, recovery) used to structure the Constraints section |
| S15 | web | https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/ai-agent-design-patterns | 2026-09-13 | Azure's "handoff orchestration" pattern (= routing/triage/dispatch); explicit guidance: "The appropriate agent... is identifiable from the initial input. In that case, use deterministic routing or a simpler dispatcher that doesn't take an active role in processing" — direct support for preferring a rule-based router before an LLM one |
| S16 | web | https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentrel04.html | 2026-09-13 | AWS Agentic AI Lens: production multi-agent orchestration needs "a structured capability taxonomy that drives deterministic routing and automatic substitution," plus first-class telemetry on "arbitration decisions, routing outcomes, fallback activations" |
| S17 | web | https://beam.ai/agentic-insights/multi-agent-orchestration-patterns-production | 2026-09-13 | Names the specific coordination-failure symptom relevant here: "Each agent keeps replanning because nobody owns the task... because routing is non-deterministic, the same input can produce wildly different agent chains, making debugging nearly impossible" |

## Excerpts

### S8 — How we built our multi-agent research system (Anthropic)
https://www.anthropic.com/engineering/multi-agent-research-system
> Our Research system uses a multi-agent architecture with an orchestrator-worker pattern, where a lead agent coordinates the process while delegating to specialized subagents that operate in parallel... We started by allowing the lead agent to give simple, short instructions like 'research the semiconductor shortage,' but found these instructions often were vague enough that subagents misinterpreted the task or performed the exact same searches as other agents.

### S9 — When to use multi-agent systems (and when not to) (Claude/Anthropic)
https://claude.com/blog/building-multi-agent-systems-when-and-how-to-use-them
> At Anthropic, we've seen teams invest months building elaborate multi-agent architectures only to discover that improved prompting on a single agent achieved equivalent results.

### S10 — LangGraph Multi-Agent Supervisor
https://reference.langchain.com/python/langgraph-supervisor
> Hierarchical systems are a type of multi-agent architecture where specialized agents are coordinated by a central supervisor agent. The supervisor controls all communication flow and task delegation, making decisions about which agent to invoke based on the current context and task requirements.

### S11 — LangGraph Supervisor Pattern: Production Architecture Guide
https://markaicode.com/architecture/langgraph-supervisor-architecture/
> Most teams don't need a supervisor. If your workload is one task type handled well by one agent with tools, a supervisor adds a routing hop and a second failure domain for no real benefit.

### S13 — Multi-Agent Orchestration Patterns: A Practical Guide
https://www.glukhov.org/ai-systems/architecture/multi-agent-orchestration-patterns/
> Research from NeurIPS 2025 (MAST — Multi-Agent System Failure Taxonomy) analyzed 1,600+ execution traces across seven popular multi-agent frameworks. Failures distribute across three root categories: Agents misinterpret roles, duplicate work, or skip verification because their instructions are underspecified... Escalate to hierarchical when worker count exceeds 5-8.

### S14 — Multi-Agent Orchestration: A Practical Architecture Without the Buzzwords
https://www.augmentcode.com/guides/multi-agent-orchestration-architecture-guide
> Anthropic reports that multi-agent systems use approximately 15x as many tokens as chat interactions, while research on failure taxonomies found that coordination failures account for 36.94% of all failures across AutoGen, CrewAI, and LangGraph.

### S15 — AI Agent Orchestration Patterns (Azure Architecture Center)
https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/ai-agent-design-patterns
> The appropriate agent, or sequence of agents, is identifiable from the initial input. In that case, use deterministic routing or a simpler dispatcher that doesn't take an active role in processing.

### S16 — Multi-agent orchestration (AWS Agentic AI Lens)
https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentrel04.html
> Agents are described in a structured capability taxonomy that drives deterministic routing and automatic substitution when a preferred agent is unavailable... Arbitration decisions, routing outcomes, fallback activations, and control-plane health are all observable as first-class telemetry.

### S17 — 6 Multi-Agent Orchestration Patterns for Production (2026)
https://beam.ai/agentic-insights/multi-agent-orchestration-patterns-production
> Each agent keeps replanning because nobody owns the task. Context loss compounds with every transfer... because routing is non-deterministic, the same input can produce wildly different agent chains, making debugging nearly impossible.
