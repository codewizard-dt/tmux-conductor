---
topic: Why some agents are hidden (footer hint only) while others are listed underneath the prompt — is it background vs agent teams? How to make agents always show as rows.
slug: subagent-panel-visibility
researched: 2026-09-13
---

# Primary Sources — Subagent panel visibility

| ID | Type | Locator | Accessed | What it contributed |
|----|------|---------|----------|---------------------|
| S1 | codebase | `wiki/knowledge/entities/tools/claude-code-cli.md` (## Background/async agents section) | 2026-09-13 | Prior-researched footer hint variants (`← N agents` / `← for agents` / `← N done`) and confirmation this is a separate signal from hooks; background agents shipped v2.1.198 |
| S2 | web | https://code.claude.com/docs/en/sub-agents | 2026-09-13 | Fork mode semantics, foreground-vs-background subagent distinction, subagent panel row lifecycle (appears while running, clears on completion), named subagents in typeahead |
| S3 | web | https://code.claude.com/docs/en/whats-new | 2026-09-13 | Changelog confirmation: subagents background-by-default (Week 27, v2.1.195-201), fork mode on-by-default + `@`-mention (Week 33, v2.1.225-233), "agent view rows" headline feature (Week 28) |
| S4 | web | https://code.claude.com/docs/en/agent-view | 2026-09-13 | Confirms the `←` footer hint is a coarse "background agents exist" signal distinct from the full-screen `claude agents` view; documents the collapsed-hint text exactly |
| S5 | screenshot | `tmp/dashboard-drops/1789314772109-Screenshot-2026-09-13-at-10.45.47-AM.png` | 2026-09-13 | Primary evidence: footer hint alone (`← for agents`), no subagent panel rows, main session idle awaiting a prompt ("keep going") |
| S6 | screenshot | `tmp/dashboard-drops/1789314778972-Screenshot-2026-09-13-at-10.50.49-AM.png` | 2026-09-13 | Primary evidence: same footer hint plus `esc to interrupt` (main busy), and a subagent panel listing `main`, `survey-req-dec`, `survey-roadmap-task` with live task headlines |

## Excerpts

### S2 — Claude Code sub-agents documentation
https://code.claude.com/docs/en/sub-agents
> Where fork mode is on, as it is by default in an interactive session, Claude Code runs the subagent in the background, forks and non-fork subagents alike, and Claude can't ask for the foreground.

> Foreground subagents block the main conversation until complete. Permission prompts are passed through to you as they come up. Background subagents run concurrently while you continue working. When a background subagent reaches a tool call that needs permission, Claude Code surfaces the prompt in your main session and names the subagent that is asking.

> Claude Code shows nested subagents as a tree in the subagent panel below the prompt input and marks each row that still has descendants in the panel with a `(+N)` count of them.

> When a subagent finishes successfully, Claude Code removes its row immediately and, except in screen reader mode, shows `/tasks to see subagents` in the footer for 30 seconds.

> Named background subagents currently running in the session also appear in the typeahead, showing their status next to the name.

### S3 — Claude Code "What's new" digest
https://code.claude.com/docs/en/whats-new
> **Week 27** (June 29 – July 3, 2026, v2.1.195–v2.1.201): subagents run in the background by default so Claude keeps working while they run.

> **Week 33** (August 10–14, 2026, v2.1.225–v2.1.233): fork mode is on by default in interactive sessions, so Claude can hand a side task to a subagent that inherits the full conversation; ... and typing `@` in the prompt mentions another Claude session by name.

> **Week 28** (July 6–10, 2026, v2.1.202–v2.1.206): agent view rows show a colored state word and a classifier-written headline.

### S4 — Claude Code agent-view documentation
https://code.claude.com/docs/en/agent-view
> Inside a regular `claude` session, the prompt footer's `←` hint counts the background agents that are waiting on you, such as `← 2 agents`, and returns to `← for agents` when none need input.

> Agent view, opened with `claude agents`, is one screen for all your background sessions: what's running, what needs your input, and what's done.
