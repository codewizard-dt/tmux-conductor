---
topic: Is the "agent teams" feature a way to affect subagent-panel visibility? power-mode usually does a good job with this — why?
slug: subagent-panel-visibility
researched: 2026-09-13
---

# Primary Sources — Agent teams as a lever on subagent-panel visibility (update)

> See also [sources.md](sources.md) for the prior pass's sources (S1-S6 there); IDs below restart at S1 for this file per the skill's per-file numbering.

| ID | Type | Locator | Accessed | What it contributed |
|----|------|---------|----------|---------------------|
| S1 | web | https://code.claude.com/docs/en/agent-teams | 2026-09-13 | Full agent-teams mechanics: opt-in env var, teammate-formation trigger (named + non-fork + no isolation), subagent-vs-teammate comparison table, idle-row persistence rules (v2.1.199+), foreground-forced subagents inside a teammate, token-cost warning |
| S2 | codebase | `~/.claude/settings.json` | 2026-09-13 | `"CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"` confirmed set (global, user-level); no project-level override found in tmux-conductor's `.claude/settings.json` (absent) or `.claude/settings.local.json` (present, no match) |
| S3 | codebase | `~/.claude/skills/power-mode/SKILL.md` | 2026-09-13 | Line 13 explicitly says "Use agent teams for parallel work"; its `Agent({...})` call examples pass `description`/`prompt`/`mode` only, never `name`/`subagent_type`/`isolation`; Parallelization Mandate requires multi-agent-per-message dispatch |
| S4 | codebase | `Agent` tool schema (in-session tool definition, `team_name` parameter description) | 2026-09-13 | `team_name: Deprecated; ignored. The session has a single implicit team.` — corroborates S1's "one team per session" architecture from the calling tool's own interface |

## Excerpts

### S1 — Orchestrate teams of Claude Code sessions
https://code.claude.com/docs/en/agent-teams

> Agent teams are experimental and disabled by default. Enable them by setting `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in your settings.json or environment. Without that variable, no team is set up at session start, no team directories are written, and Claude does not spawn or propose teammates.

> Claude launches a teammate when it calls the Agent tool with a name while agent teams are enabled, unless the call is a fork or passes isolation on the call itself... Claude also names ordinary subagents on its own so it can message them later. Those calls follow the same rule, so teams can form even when you didn't ask for one.

> Enabling agent teams also changes ordinary delegation. Claude may name a subagent on its own, and while agent teams are enabled, a subagent that Claude names launches as a teammate, so teams can form even when you didn't ask for one.

> Claude may sometimes use subagents instead of creating a team. Subagents appear in the same agent panel as teammates, so the panel alone doesn't confirm a team formed. If Claude spawned subagents instead, ask again and explicitly request an agent team.

> As of v2.1.199, an idle teammate's row stays in the panel while any teammate or subagent is still working, so you can select it to review its transcript or send it more work. Once every agent in the panel is idle, idle rows hide after 30 seconds and reappear on the teammate's next turn; the teammate stays running and addressable while hidden.

> When more than three teammates are idle at once, the rows beyond the first three collapse into a single row that counts the collapsed teammates, such as `2 idle agents` when five are idle.

> No background subagents from in-process teammates: an in-process teammate's own subagents run in the foreground, because a teammate's background work can't outlive the lead's process. Claude Code returns an error when a teammate spawns a subagent whose definition sets `background: true`.

> Agent teams use significantly more tokens than a single session. Each teammate has its own context window, and token usage scales with the number of active teammates.

> Spawning teammates also requires an interactive session. In non-interactive mode with the `-p` flag, including Agent SDK sessions, Claude doesn't spawn teammates, and a subagent that Claude names runs as an ordinary subagent even with agent teams enabled.

> One team per session: a session has exactly one team, scoped to that session. You can't create additional named teams or share a team across sessions.

### S3 — power-mode SKILL.md
`~/.claude/skills/power-mode/SKILL.md`

> Use this skill to drive tasks or roadmaps to completion using a parallel agent team. The primary goal is efficiency: collision-safe tasks must always run in parallel. You are the primary orchestrator. Use agent teams for parallel work.

> Spawning a parallel agent team is MANDATORY whenever tasks are collision-safe... Minimum team size: 5 agents when 5 or more collision-safe tasks are available in the current wave.
