---
topic: Why some agents are hidden (footer hint only) while others are listed underneath the prompt — is it background vs agent teams? How to make agents always show as rows.
slug: subagent-panel-visibility
researched: 2026-09-13
sources: [./sources.md]
---

# Research: Subagent panel visibility (hidden vs listed underneath)

> The two screenshots are not tmux-conductor's own dashboard chrome — they are Claude Code CLI's native terminal footer, mirrored verbatim through the pane. The dichotomy is **not** "background vs agent teams." It's **foreground/idle vs currently-running background subagents of *that session***. Claude Code renders two independent UI elements: (1) the `←` footer hint, a coarse, machine/session-wide "there are background agents somewhere" signal, and (2) the **subagent panel below the prompt input**, an inline live tree that lists only the *current session's own* background subagents while they are actually in flight, and clears each row within ~0–30s of completion. Screenshot 1 has zero of *this session's* subagents running at that instant (hint-only); screenshot 2 has two named subagents (`survey-req-dec`, `survey-roadmap-task`) actively running concurrently with `main`, so all three render as rows.

## Research Questions
- What are the two visual states shown in the screenshots, mechanically?
- What determines whether a dispatched agent renders as a row under the composer vs. stays invisible?
- Is this dichotomy "background processes vs. agent teams," as hypothesized?
- How should prompts/skills be written so spawned agents reliably show up as rows?
- Is this something tmux-conductor's own code (host-server/frontend) can or should control?

## Current State (Codebase)
tmux-conductor does not render this UI at all — it is Claude Code's own CLI. The dashboard's terminal views (`frontend/src/components/LogTail.tsx`, xterm.js via `frontend/src/lib/terminalTheme.ts`) faithfully mirror the raw pane byte stream captured by `tmux capture-pane`/PTY tail; when an agent pane runs `claude`, whatever the CLI itself paints — including this footer and subagent panel — passes through unmodified. Confirmed no local matches for "FleetView," "subagent panel," or "agent teams" render logic anywhere in `host-server/` or `frontend/` (`wiki/knowledge/entities/tools/claude-code-cli.md` is the only place these terms appear, as prior *documentation of the external CLI's behavior*, not implementation). So: **there is no tmux-conductor code path to "fix" here** — the lever is entirely in how the *agent's own prompts* (skills, slash commands, CLAUDE.md-authored orchestration) dispatch subagents inside that CLI session.

## Key Findings

1. **Two independent UI surfaces exist, and the screenshots show a difference in only one of them.** The `←` hint line (`← for agents` / `← N agents` / `← N done`) is present in *both* screenshots and reflects background-agent state at a coarser scope (opens the separate `claude agents` full-screen view) [S1][S4]. The **subagent panel below the prompt input** — the thing that differs between the two screenshots — is a distinct, inline, live tree specific to the current session's own dispatched subagents [S2].

2. **Fork mode governs whether subagents run in the foreground (never listed) or background (listed while active).** Fork mode has been on by default in interactive sessions since v2.1.225–233 (Week 33, Aug 2026): *"fork mode is on by default in interactive sessions, so Claude can hand a side task to a subagent that inherits the full conversation"* [S3]. With fork mode on, Claude Code documentation states plainly: *"Claude Code runs the subagent in the background, forks and non-fork subagents alike, and Claude can't ask for the foreground"* [S2]. Separately, ordinary (non-fork) subagents have run in the background by default since v2.1.195–201 (Week 27, June 2026): *"subagents run in the background by default so Claude keeps working while they run"* [S3].

3. **Only currently-running background subagents get a row; foreground ones never do.** Per the sub-agents doc: *"Foreground subagents block the main conversation until complete. Permission prompts are passed through to you as they come up. Background subagents run concurrently while you continue working"* and *"Claude Code shows nested subagents as a tree in the subagent panel below the prompt input and marks each row that still has descendants... with a `(+N)` count"* [S2]. This directly explains screenshot 2: `main` plus two nested background subagents (`survey-req-dec`, `survey-roadmap-task`), each showing a live status/headline next to its name — matching the Week 28 changelog note that *"agent view rows show a colored state word and a classifier-written headline"* [S3].

4. **Rows are transient by design — they disappear almost immediately after completion.** *"When a subagent finishes successfully, Claude Code removes its row immediately and... shows `/tasks to see subagents` in the footer for 30 seconds"*; a failed/stopped subagent's row *"keeps the row for 30 seconds; press x to clear sooner"* [S2]. This means screenshot 1's absence of rows is fully explained by simple timing — either no subagent was in flight at that instant, or one had just finished and its 30-second grace window had already elapsed — with no need to invoke any "background vs. team" distinction at all.

5. **Named subagents are addressable, not just labeled.** *"Named background subagents currently running in the session also appear in the typeahead, showing their status next to the name"* [S2] — matching the `@`-mention feature shipped the same week (*"typing @ in the prompt mentions another Claude session by name"* [S3]) and this session's own `SendMessage`/`ListAgents` tools, which resolve a subagent by the `name` passed to `Agent(...)`.

6. **"Agent teams" is a separate, third concept, not what's pictured here.** External commentary (not independently verified against an official doc, so treated as corroborating context only) frames the taxonomy as: subagents are isolated workers in your session that report back; background agents are independent parallel sessions you monitor; agent teams are peer sessions that *communicate* with each other. What the screenshots show is squarely the first two (a session's own background subagents), not cross-session "teams."

## Constraints
- The subagent panel's row lifetime is capped and mostly out of the orchestrating prompt's control (~30s max after completion) — no prompt wording makes a *finished* subagent stay listed indefinitely.
- Fork mode's "can't ask for the foreground" behavior is a session-wide toggle (`/config` or settings), not something set per Agent-tool call — but since it defaults on, no action is normally needed to get background execution.
- Confirming the exact conditions for an *unnamed* subagent's row appearance (does it still render, just without a friendly name?) was not directly quoted in the fetched docs — flagged as a residual gap, see Next Steps.

## Recommendation

**The fix belongs in the calling skill/prompt, not in tmux-conductor's code.** To make dispatched agents reliably show up as rows under the composer while they run:

1. **Dispatch concurrently, not sequentially.** A single `Agent(...)` call that the orchestrating prompt then waits on before continuing produces exactly one subagent — it will still show as a background row (per finding 2/3), but if the calling logic instead lets fork mode run it and then *immediately* blocks the parent turn waiting synchronously for the tool result, there is nothing else concurrently happening to observe. Launch multiple `Agent(...)` calls in one message (as this session's own `/roadmap-assess`-style orchestration and the `survey-*` names in screenshot 2 already do) when you want several rows visible together.
2. **Always pass an explicit `name`.** This is what makes a row addressable (via `@mention`/`SendMessage`) and gives it a stable label instead of a generic one, matching how `survey-req-dec`/`survey-roadmap-task` appear.
3. **Don't fight fork mode.** Leave it on (the default) rather than disabling it — disabling it is what reintroduces foreground-blocking subagents that never get a row at all.
4. **Treat the panel as a live-only view, not a durable log.** If the actual goal is a *persistent* record of what subagents ran (for later review, not just to watch them mid-flight), don't rely on this transient panel — use `claude agents --json`/`claude agents` (machine-wide, queryable, includes completed sessions with `--all`) instead, per prior research already in the wiki [S1].

### Risks / residual gaps
- Whether an *unnamed* subagent still gets a row (just unlabeled) versus not appearing at all is inferred from the "nested tree" wording, not directly confirmed by a quoted doc passage — worth a quick live test (dispatch one named + one unnamed `Agent(...)` in parallel and screenshot the panel) before hard-coding this into skill-authoring guidance.
- If fork mode has been explicitly disabled in this project's or the user's global settings, foreground execution (and zero panel visibility) becomes possible again for non-fork subagent types when the parent needs the result immediately — worth a one-line check of `~/.claude/settings.json` / project settings for a `forkMode` override if the "hidden" behavior persists even for concurrent, named dispatches.

## Next Steps
- Optional live verification: dispatch two `Agent(...)` calls in parallel, one with `name` set and one without, and screenshot the subagent panel to close the one open gap above.
- No `/task-add` is warranted — this is CLI behavior external to tmux-conductor's own codebase, not a bug or feature to implement here.
