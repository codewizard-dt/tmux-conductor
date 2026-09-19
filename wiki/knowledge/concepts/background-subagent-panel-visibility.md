---
id: background-subagent-panel-visibility
title: Background Subagent Panel Visibility (Fork Mode, Foreground vs. Background)
updated: 2026-09-13
sources:
  - ../../raw/research/subagent-panel-visibility/index.md
  - ../../raw/research/subagent-panel-visibility/index-2.md
confidence: ambiguous
tags: [claude-code, subagents, fork-mode, orchestration, agent-teams]
---

Claude Code's interactive session exposes two independent, easily-confused UI surfaces for multi-agent work:

1. **The `←` footer hint** (`← for agents` / `← N agents` / `← N done`) — a coarse signal that background agents exist somewhere reachable, gateway to the separate full-screen `claude agents` view.
2. **The subagent panel below the prompt input** — an inline live tree listing only the *current session's own* subagents while they are actively running, nested with `(+N)` descendant counts, each row showing a colored state word and a classifier-written headline.

**What puts a subagent in surface 2 is purely foreground-vs-background, not "team" membership.** Fork mode — on by default in interactive sessions since v2.1.225–233 — forces every subagent (fork or plain) to run in the background, where "Claude can't ask for the foreground." Background execution itself has been the subagent default since v2.1.195–201. A **foreground** subagent (one whose result the parent blocks on before continuing, possible when fork mode is off) never gets a row at all — permission prompts pass straight through instead of surfacing in the main session. A **background** subagent gets a row for exactly as long as it's in flight: removed immediately on success (replaced by a 30-second `/tasks to see subagents` footer hint), kept up to 30 seconds on failure/stop.

**Naming makes a row addressable, not just visible.** An explicit `name` on the subagent lets it appear in the `@`-mention typeahead and be resumed/messaged by that name later — the panel row itself is populated by the nested-subagent tree regardless of whether a name was given, so naming affects *addressability*, not *whether* a row appears.

**Practical rule for orchestration prompts/skills:** dispatch subagents concurrently (multiple calls in one message) with explicit names, and don't turn fork mode off, if the goal is to have running work visibly listed while it's in flight. Because rows are inherently transient (cleared within 0–30s of completion), this panel is unsuitable as a durable record of what ran — use `claude agents --json`/`claude agents` for that instead (`relates_to::[[Discovering All Active Claude Code Sessions on a Machine]]`).

This is a distinct problem from `relates_to::[[Pane-Idle Detection Cannot See Async Background Agent Work]]`: that concept is about an *external observer* (tmux-conductor's monitor/host-server) misreading a pane's idle/busy state because Claude Code's own `Stop` hook fires before background work resolves. This concept is about what the *interactive user, inside the session itself*, sees rendered live in their own terminal.

See also `relates_to::[[Claude Code CLI]]` (background/async agents section) for the underlying hook-event mechanics (`agent_needs_input`/`agent_completed`).

## Update (2026-09-13): teammates vs. plain subagents have different row-persistence rules

> **Contradiction — corrected:** this page originally treated "agent teams" as an unrelated third concept, distinct from what governs panel rows. That undersold it: whether a panel row belongs to a plain background subagent or a full **teammate** (`relates_to::[[claude-code-agent-teams]]`) changes the row's *persistence*, not just whether one can appear. Official docs: *"Subagents appear in the same agent panel as teammates, so the panel alone doesn't confirm a team formed"* — but a teammate's idle row *"stays in the panel while any teammate or subagent is still working... hides after 30 seconds"* only once the **whole panel** goes idle, whereas a plain subagent's row clears **immediately** on its own success. A named `Agent(...)` call becomes a teammate (not a plain subagent) whenever agent teams is enabled (an opt-in, experimental `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` setting) and the call isn't a fork or `isolation`-scoped — and Claude names subagents on its own routinely, so this can happen even when the calling prompt never says `name:`.

**Practical upshot for orchestration prompts:** if the goal is a fleet of rows that stay visible as a *group* until the whole wave finishes (rather than blinking out one-by-one as each task completes), that behavior comes from teammate formation, which in turn requires agent teams to be enabled *and* each call to end up named. `derived_from::[[power-mode-skill]]` gets this today largely by accident (Claude's own auto-naming), not because its `SKILL.md` passes `name` explicitly.
