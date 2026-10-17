---
topic: A new type of agent that acts as an orchestrator of other agents, routing commands and tasks as needed
slug: orchestrator-agent-routing
researched: 2026-09-19
---

# Primary Sources — Round 3: Assumption Audit + Specialized-Agent Catalog

| ID | Type | Locator | Accessed | What it contributed |
|----|------|---------|----------|---------------------|
| S29 | web | https://spring.io/blog/2025/07/10/spring-ai-agentic-patterns | 2026-09-19 | Names the "Agent Registry" pattern explicitly: a catalog of subagent names/descriptions populated at startup, consulted by the orchestrating LLM |
| S30 | web | https://www.augmentcode.com/guides/agentic-design-patterns | 2026-09-19 | 2026 catalog of agentic design patterns; defines Multi-Agent Collaboration and Supervisor/Orchestrator roles as distinct, composable patterns |
| S31 | web | https://www.truefoundry.com/blog/multi-agent-architecture | 2026-09-19 | "A central agent and tool registry: a discoverable catalog with schema validation so different agents find approved available tools dynamically" — registry as prerequisite layer beneath orchestration |
| S32 | web | https://www.digitalapplied.com/blog/ai-agent-architecture-patterns-2026 | 2026-09-19 | 2026 taxonomy: "Move to multi-agent only when single-agent caps out... justify with measured gain on a specific failure mode single-agent can't address" |
| S33 | web | https://www.augmentcode.com/guides/agent-expert-registry-pattern | 2026-09-19 | Describes an "Agent Expert Registry" as an organizational pattern for cataloguing specialized agent roles independent of any routing mechanism |
| S34 | web | https://www.digitalapplied.com/blog/5-agentic-ai-patterns-2026 | 2026-09-19 | Names Claude Code's `.claude/agents/*.md` subagents as "the Claude Agent SDK's native supervisor primitive — one level deep, no nesting"; separately notes Kimi K2.5/K2.6 "Agent Swarm" (100-300 specialized subagents via Parallel-Agent Reinforcement Learning) as a frontier, model-trained coordination example |
| S35 | web | https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/multi-agent-orchestration | 2026-09-19 | Distinguishes "child agents" (managed within the same solution) from "connected agents" (external, owned by other teams); frames specialist-agent adoption as reuse-driven ("when specialist agents are already available and optimized for reuse") rather than routing-driven |
| S36 | web | https://www.levelop.dev/blog/orchestrator-agent-patterns | 2026-09-19 | Defines orchestrator agent narrowly: "the control layer that turns a collection of specialized agents into a coordinated workflow. It does not usually do the domain work itself" |
| S37 | web | https://code.claude.com/docs/en/sub-agents | 2026-09-19 | Documents the `.claude/agents/<name>.md` format (`name`, `description`, `tools` allowlist, optional `model`) and how the main agent selects a subagent by matching task context against `description` text |
| S38 | web | https://medium.com/@pradeep3j/agent-as-tool-vs-subagent-a-critical-orchestration-pattern-distinction | 2026-09-19 | "Subagents began taking over the conversation in ways that were impossible to reliably prevent using prompts alone... not a prompt problem. It was an architectural one." Documents the "Agent as Tool" fix: delegates invoked as tools, return structured results, always hand control back — "tools cannot take over the conversation" |
| S39 | codebase | `logs/dispatch.jsonl` (last 30 records, Node one-liner extracting distinct `agent` field values) | 2026-09-19 | 15 distinct agent names in the last 30 dispatch records; several follow a `<project>-<role>-<n>` naming convention (`tmux-conductor-fe-research`, `tmux-conductor-architect-2`, `tmux-conductor-frontend-2`) alongside pure clone-copy churn (`bootstrap-bootstrap-1-copy-2-copy`, `davill-davill-architect-1-copy`) — an informal, unstructured specialization signal already in use |
| S40 | codebase | `.claude/agents/` (tmux-conductor project root) | 2026-09-19 | Directory does not exist — confirmed via directory check; tmux-conductor has never defined project-level Claude Code subagent roles despite the mechanism being natively available |
| S41 | session-context | This session's own "Available agent types" system-reminder (7 named agents: `claude-code-guide`, `codebase-inquiry-architect`, `compose-stack-doctor`, `Explore`, `general-purpose`, `Plan`, `statusline-setup`, each with a `description` and scoped `Tools` list) | 2026-09-19 | A live, working instance of the Agent Registry pattern (S29) one layer above tmux-conductor — the closest available reference implementation, present in-session but never previously cited by rounds 1-2 |

## Excerpts

### S29 — Spring AI: Agentic Patterns
https://spring.io/blog/2025/07/10/spring-ai-agentic-patterns
> The orchestrator maintains an Agent Registry — a catalog of subagent names and descriptions populated at startup — and consults it to decide which specialist to delegate to for a given subtask.

### S31 — TrueFoundry: Multi-Agent Architecture
https://www.truefoundry.com/blog/multi-agent-architecture
> A central agent and tool registry: a discoverable catalog with schema validation so different agents find approved available tools dynamically, rather than hardcoding capability lists into each agent's prompt.

### S32 — Digital Applied: AI Agent Architecture Patterns 2026
https://www.digitalapplied.com/blog/ai-agent-architecture-patterns-2026
> Move to multi-agent only when single-agent caps out on a task that genuinely needs parallel specialization. Justify the move with a measured gain on a specific failure mode single-agent could not address — not on the theoretical appeal of "agents talking to agents."

### S34 — Digital Applied: 5 Agentic AI Patterns Reshaping Enterprise Software in 2026
https://www.digitalapplied.com/blog/5-agentic-ai-patterns-2026
> Claude Code's subagents (defined in `.claude/agents/*.md`) are the Claude Agent SDK's native supervisor primitive: one level deep, no nesting. Compare this to Kimi K2.5/K2.6's "Agent Swarm," which coordinates 100-300 specialized subagents through Parallel-Agent Reinforcement Learning — a capability trained into the model itself, not assembled from an external orchestration layer.

### S35 — Microsoft Learn: Multi-Agent Orchestration
https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/multi-agent-orchestration
> Add a specialist agent when specialist agents are already available and optimized for reuse, or when the use case explicitly needs tuned or specialized quality that a generalist agent cannot provide. Distinguish child agents, managed within the same solution, from connected agents, which are external, standalone agents owned by other teams.

### S36 — Levelop: Orchestrator Agent Patterns
https://www.levelop.dev/blog/orchestrator-agent-patterns
> An orchestrator agent is the control layer that turns a collection of specialized agents into a coordinated workflow. It does not usually do the domain work itself.

### S37 — Claude Code Docs: Subagents
https://code.claude.com/docs/en/sub-agents
> Each subagent is defined by a Markdown file with YAML frontmatter: `name`, `description`, an optional `tools` allowlist, and an optional `model` override. The main agent selects a subagent by matching the current task context against each subagent's `description`.

### S38 — Medium (Pradeep Jain): Agent as Tool vs. Subagent — a Critical Orchestration Pattern Distinction
https://medium.com/@pradeep3j/agent-as-tool-vs-subagent-a-critical-orchestration-pattern-distinction
> Subagents began taking over the conversation in ways that were impossible to reliably prevent using prompts alone — despite explicit instructions like "Do not interact with the user" and "Return control to the orchestrator." This was not a prompt problem. It was an architectural one.
> The fix: the Agent as Tool pattern. Subagents are invoked as tools, return structured results, and always hand control back to the orchestrator. This works because tools cannot take over the conversation... This single design choice eliminates the entire class of orchestration failures described earlier.
