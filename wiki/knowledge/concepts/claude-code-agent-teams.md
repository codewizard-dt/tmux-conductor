---
id: claude-code-agent-teams
title: Claude Code Agent Teams
updated: 2026-09-13
sources:
  - ../../raw/research/subagent-panel-visibility/index-2.md
confidence: extracted
tags: [claude-code, agent-teams, orchestration]
---

Agent teams is a distinct, heavier Claude Code mechanism from ordinary subagents: a **teammate** is a fully independent Claude Code instance with its own context window that messages other teammates directly and claims work from a shared task list, versus a subagent that "reports back to the caller" from within the same session. It's **experimental and disabled by default**, gated behind `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in `settings.json` or the environment — without it, "no team is set up at session start... Claude does not spawn or propose teammates."

**The trigger for teammate formation is precise and easy to hit by accident:** Claude launches a teammate whenever it calls the `Agent` tool with a `name`, while agent teams is enabled, unless the call is a fork or passes `isolation`. Critically, Claude names ordinary subagents on its own for later addressability — so teams can form "even when you didn't ask for one," purely as a side effect of routine delegation. **The panel doesn't disambiguate the two**: "Subagents appear in the same agent panel as teammates, so the panel alone doesn't confirm a team formed" — but a teammate's row persists differently: as of v2.1.199, an idle teammate's row stays visible while any sibling teammate/subagent is still working, hiding only 30s after the *whole panel* goes idle, versus a plain subagent's row clearing immediately on that one subagent's own completion.

**Constraints worth remembering:** one team per session (no nested teams — a teammate's own subagents are forced foreground, can't run in the background); requires an interactive session (a `-p`/headless invocation never spawns teammates even with the flag on); and it costs meaningfully more tokens than plain subagents, since each teammate is a fully separate instance with its own context window.

This user's `~/.claude/settings.json` has the flag set to `"1"` globally, so every session in every project — including `derived_from::[[power-mode-skill]]` runs against `uses::[[tmux-conductor]]` — has agent teams live. `relates_to::[[Background Subagent Panel Visibility (Fork Mode, Foreground vs. Background)]]` covers how this interacts with panel-row rendering in detail; `relates_to::[[Claude Code CLI]]` for the surrounding CLI feature set.
