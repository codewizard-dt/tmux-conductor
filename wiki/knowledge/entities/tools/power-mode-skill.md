---
id: power-mode-skill
title: power-mode (Claude Code skill)
aliases: [/power-mode, Power Mode]
updated: 2026-09-13
sources:
  - ../../../raw/research/subagent-panel-visibility/index-2.md
  - ../../../raw/research/orchestrator-agent-routing/index.md
confidence: extracted
tags: [claude-code, skill, orchestration, agent-teams]
---

`power-mode` is a user-global Claude Code skill (`~/.claude/skills/power-mode/SKILL.md`, not part of `uses::[[tmux-conductor]]`'s own repo) that orchestrates a parallel agent fleet to drive a roadmap or task file through the full tackle → uat-generate → uat-auto pipeline to completion. It self-describes as an "Agent Team Orchestrator" and its own text says "Use agent teams for parallel work," with a Parallelization Mandate requiring collision-safe tasks to spawn as multiple `Agent(...)` tool calls in a single message (minimum 5 when 5+ tasks are available in a wave).

Its actual `Agent({...})` call examples pass only `description`, `prompt`, and `mode: "bypassPermissions"` — never an explicit `name`, `subagent_type`, or `isolation`. Because this user's environment has `relates_to::[[claude-code-agent-teams]]` globally enabled (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`) and Claude Code names ordinary subagents on its own for later addressability, power-mode's fleet very likely forms real **teammates** on most runs — not because its `SKILL.md` deliberately requests that, but as an incidental effect of auto-naming plus the environment flag. This is the best-supported explanation for the fleet's generally good panel-visibility behavior (teammates' idle rows persist as a group while siblings are still working, rather than each blinking out the instant it finishes).

Not yet independently confirmed: whether a given `/power-mode` run is, in fact, producing teammates rather than plain subagents (would require inspecting `~/.claude/teams/{team-name}/config.json`'s `members` array during a live run). The clean, deterministic fix — not yet applied — would be adding an explicit `name` to every `Agent({...})` call template in the skill so teammate formation stops depending on Claude's own case-by-case naming judgment.

`relates_to::[[An Orchestrator Agent That Routes Commands/Tasks to Other Agents|../../sources/orchestrator-agent-routing.md]]` (2026-09-13): `power-mode` is the closest existing "orchestrator" in this user's environment, but it operates one layer above `uses::[[tmux-conductor]]`'s own fleet — it drives Claude Code's own in-process `Agent()` subagents/teammates through a roadmap/task pipeline within a single session, with **no visibility into tmux-conductor's cross-process SQLite task queue or `GET /agents`/`GET /status` API**. A future routing agent for tmux-conductor's actual (vendor-agnostic, tmux-pane-hosted) fleet would need to be built separately, not by extending `power-mode` itself — see `relates_to::[[Multi-Agent Orchestration Patterns (Orchestrator-Worker, Supervisor, Handoff)]]`.
