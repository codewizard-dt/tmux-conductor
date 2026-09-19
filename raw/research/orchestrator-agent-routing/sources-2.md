---
topic: A new type of agent that acts as an orchestrator of other agents, routing commands and tasks as needed
slug: orchestrator-agent-routing
researched: 2026-09-13
---

# Primary Sources — Round 2 (Alternative Shapes for the Orchestrator Agent)

> Builds on [sources.md](sources.md); this round covers only sources not already cited there. Round 1's sources (S1-S17) still apply unless flagged as superseded below.

| ID | Type | Locator | Accessed | What it contributed |
|----|------|---------|----------|---------------------|
| S18 | codebase | `logs/dispatch.jsonl` (tail, live) | 2026-09-13 | Live evidence that the fleet already cycles through a double-digit number of distinct agent names in a single day (`tmux-conductor-fe-research`, multiple `bootstrap-bootstrap-1*` copies, `cryptwiz-cryptwiz-1-copy`, several `tmux-conductor-tmux-conductor-N`, `uat157-*` fixtures, etc.) — contradicts round 1's "fleet stays small (~5-8)" assumption, which was based only on the wiki's active-task count, not live usage |
| S19 | web | https://www.augmentcode.com/tools/open-source-agent-orchestrators | 2026-09-13 | Survey of 9-11 open-source "coding agent orchestrator" tools (Agent Orchestrator, Emdash, Baton, Conductor family, Bernstein, Claude Squad, Crystal/Nimbalyst, Vibe Kanban, Agent Kanban) — confirms this is an established, populated tool category with its own conventions, distinct from generic chat/customer-support multi-agent frameworks |
| S20 | web | https://github.com/andyrewlee/awesome-agent-orchestrators | 2026-09-13 | Curated list surfacing the specific prior-art projects most structurally similar to tmux-conductor: `dmux` (tmux + git worktrees), `herdr` (background runtime, agent-driven socket API), `ClawTeam` (agents spawn/manage their own teammates via file/P2P inboxes over tmux worktrees), `corellis` (governance framework for 20+ agent fleets — goal decomposition, fleet-wide memory, correction propagation), `Fusion` (kanban + plan-review-execute gates + per-task worktrees + hierarchical missions), `swarm-protocol` (headless MCP-based coordination: claim work, detect file conflicts, heartbeat, hand off), `subtask` (Claude Skill running tasks through subagents in git worktrees) |
| S21 | web | https://github.com/mtarcure/claude-vibe-squad | 2026-09-13 | Closest single piece of prior art to "an orchestrator agent that routes tasks to other agents" in exactly tmux-conductor's problem space: one coordinator ("Chrono") routes scoped task packets to role-based specialists across 5 model families (Claude/Codex/Gemini/Grok/Kimi), each in an isolated git worktree, reviewed by a rival family before landing — "One tmux session, no server," explicitly no separate backend process |
| S22 | web | https://github.com/herdrdev/herdr | 2026-09-13 | herdr is a single Rust background daemon (not a per-project server, not a tmux pane) that owns pane lifecycle directly; critically, "agents drive herdr through the cli and socket api: they can spawn panes, prompt each other, and wait until another agent is genuinely blocked" — routing/spawning authority is decentralized to the agents themselves, not concentrated in one supervisor process |
| S23 | web | https://github.com/standardagents/dmux (+ https://dmux.ai/) | 2026-09-13 | dmux creates a fresh tmux pane *and* a fresh git worktree/branch together per task (not "route into an existing pane"); supports 10+ agent CLIs (Claude Code, Codex, Gemini CLI, OpenCode, Cline, etc.); ships "smart merging" (auto-commit, merge, cleanup in one step) and lifecycle hooks (worktree create, pre-merge, post-merge) — the most concrete reference implementation of the ephemeral-worker-per-task shape |
| S24 | web | https://developer.upsun.com/posts/ai/git-worktrees-for-parallel-ai-coding-agents | 2026-09-13 | Names the dominant orchestrator role in this specific ecosystem explicitly: "A central orchestrator that assigns tasks, monitors progress, and coordinates merges... understands task dependencies, schedules work to minimize conflicts" — describing coordination *of ephemeral worktree workers*, not of a persistent pool |
| S25 | web | https://a2a-protocol.org/v0.2.5/specification/ | 2026-09-13 | A2A (Agent2Agent) protocol: an open, Linux-Foundation-governed standard (donated by Google, April 2025) for one agent to discover and delegate a task to another agent regardless of vendor/framework. Defines a formal `TaskState` enum (`submitted`, `working`, `input-required`, `completed`, `canceled`, `failed`, `rejected`, `auth-required`, `unknown`) transported over HTTP/JSON-RPC/SSE |
| S26 | web | https://atlan.com/know/google-a2a-protocol/ | 2026-09-13 | A2A's "Agent Card" (published at `/.well-known/agent-card.json`) is a standardized capability-advertisement document — the same role round 1 proposed inventing as a bespoke `tags` column, but as an existing open format designed specifically for cross-vendor discovery |
| S27 | web | https://dev.to/pockit_tools/mcp-vs-a2a-the-complete-guide-to-ai-agent-protocols-in-2026-30li | 2026-09-13 | Confirms multi-vendor momentum: "AutoGen is now adding A2A compatibility... CrewAI... [uses] hierarchical [delegation, with 2025's] Flows... event-driven pipelines... for production workloads where the conversational model introduces too much non-determinism" — shows the broader industry moving toward the same protocol-plus-deterministic-flow combination round 1 already recommended, independently validating that direction while also surfacing A2A as an alternative to a bespoke queue |
| S28 | web | https://www.channel.tel/blog/four-agent-protocols-mcp-a2a-acp-anp | 2026-09-13 | Names precisely when *not* to reach for a peer-agent protocol: an agent that "had its own goals, could ask clarifying questions, needed to run multiple steps... maintained task state between turns... [forcing it into an MCP tool] forces an agent into a stateless tool shape when the agent needs to be a peer" — directly analogous to tmux-conductor's own coding agents, supporting A2A's task-lifecycle shape over a plain RPC/tool-call shape *if* protocol-native delegation is ever adopted |

## Excerpts

### S21 — claude-vibe-squad
https://github.com/mtarcure/claude-vibe-squad
> Multi-model AI orchestration where behaviour is Markdown, not code. One coordinator routes scoped task packets to 71 role-based specialists across 5 model families (Codex / Claude / Gemini / Grok / Kimi) — each working in an isolated git worktree, each reviewed by a rival family before it lands. One tmux session, no server.

### S22 — herdr
https://github.com/herdrdev/herdr
> agent-native — agents drive herdr through the cli and socket api: they can spawn panes, prompt each other, and wait until another agent is genuinely blocked.

### S23 — dmux
https://github.com/standardagents/dmux
> dmux creates a tmux pane for each task. Every pane gets its own git worktree and branch so agents work in complete isolation. When a task is done, press m to merge it back into your main branch.

### S24 — Git worktrees for parallel AI coding agents (Upsun)
https://developer.upsun.com/posts/ai/git-worktrees-for-parallel-ai-coding-agents
> A central orchestrator that assigns tasks, monitors progress, and coordinates merges. This layer understands task dependencies, schedules work to minimize conflicts, and helps integrate parallel outputs into coherent commits.

### S25 — A2A Protocol Specification (TaskState)
https://a2a-protocol.org/v0.2.5/specification/
> export enum TaskState { Submitted = "submitted", Working = "working", InputRequired = "input-required", Completed = "completed", Canceled = "canceled", Failed = "failed", Rejected = "rejected", AuthRequired = "auth-required", Unknown = "unknown", }

### S27 — MCP vs A2A: The Complete Guide (2026)
https://dev.to/pockit_tools/mcp-vs-a2a-the-complete-guide-to-ai-agent-protocols-in-2026-30li
> CrewAI models agents as a crew of workers with defined roles, goals, and backstories. Delegation is hierarchical... The 2025 addition of Flows — event-driven pipelines — added more predictable routing for production workloads where the conversational model introduces too much non-determinism.

### S28 — Four protocols that power every AI agent
https://www.channel.tel/blog/four-agent-protocols-mcp-a2a-acp-anp
> It had its own goals, could ask clarifying questions, needed to run multiple steps over several seconds, and maintained task state between turns. Wrapping that in an MCP tool interface is technically possible but architecturally wrong. It forces an agent into a stateless tool shape when the agent needs to be a peer.
