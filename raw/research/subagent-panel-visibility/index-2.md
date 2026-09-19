---
topic: Is the "agent teams" feature a way to affect subagent-panel visibility? power-mode usually does a good job with this — why?
slug: subagent-panel-visibility
researched: 2026-09-13
sources: [./sources-2.md]
---

# Research: Agent teams as a lever on subagent-panel visibility (update)

> Builds on [index.md](index.md); this update covers the "agent teams" feature specifically (deferred there as a separate, unverified concept) and explains *why* `/power-mode` reliably shows well-behaved rows.

**Yes — and it's already switched on.** `~/.claude/settings.json` has `"CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"` set globally for this user, across every project (no project-level override in tmux-conductor). With that flag on, **any `Agent(...)` call that carries a `name` — and isn't a fork or an `isolation`-scoped call — launches as a full teammate instead of an ordinary background subagent** [S1]. Teammates get a materially more persistent panel presence than plain subagents (idle rows stay visible while siblings are still working, not cleared within 0–30s of that one agent finishing) [S1]. `power-mode`'s `SKILL.md` explicitly says "Use agent teams for parallel work" [S3] and always dispatches multiple `Agent(...)` calls in one message per its Parallelization Mandate [S3] — and because Claude auto-names subagents on its own for later addressability even when the calling prompt doesn't hardcode a `name` [S1], power-mode's fleet is very likely forming real teammates today, which is the actual reason its rows behave well — not anything power-mode's `SKILL.md` text does explicitly to control panel rendering.

## Research Questions
- What is "agent teams" as a literal Claude Code feature, distinct from the fork-mode background subagents covered in the prior research pass?
- Is agent teams enabled in this user's environment, and does that change the panel-visibility mechanics already documented in `index.md`?
- Does `power-mode`'s `SKILL.md` explicitly invoke agent teams, and does its actual `Agent(...)` call pattern qualify for teammate formation?
- Does becoming a teammate (vs. a plain subagent) change *how long* a row stays visible, on top of *whether* one appears?
- What's the concrete, actionable lever for tmux-conductor's own skill-authoring (power-mode and others) to make this more deterministic rather than incidental?

## Current State (Codebase)
- `~/.claude/settings.json` (user-global) sets `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1"` [S2]. Neither `/Users/davidtaylor/Repositories/tmux-conductor/.claude/settings.json` (absent) nor `.claude/settings.local.json` (present, no override) changes this for the project, so agent teams is live for every session run against this repo, including every `/power-mode` run.
- `~/.claude/skills/power-mode/SKILL.md` [S3]:
  - Line 13: *"You are the primary orchestrator. Use agent teams for parallel work."* — power-mode's own author already names this feature as the intended mechanism, not an accident.
  - Its `Agent({...})` call examples (lines 69–178) pass only `description`, `prompt`, and `mode: "bypassPermissions"` — **no `name`, no `subagent_type`, no `isolation`.** Per [S1], the presence of an explicit `name` (and absence of `isolation`/fork) is exactly what triggers teammate formation — power-mode's literal prompt text doesn't force it, but doesn't prevent it either.
  - The Parallelization Mandate (lines 27–41) requires spawning collision-safe work as one message with multiple `Agent` calls, minimum 5 when 5+ tasks are available — satisfying the "concurrent dispatch" condition this research already identified in `index.md` as necessary for panel rows regardless of team status.
- The in-session `Agent` tool schema itself documents `team_name: Deprecated; ignored. The session has a single implicit team.` — independently corroborating [S1]'s "one team per session" architecture and its migration away from an explicit opt-in `TeamCreate` step.

## Key Findings

1. **Agent teams is a distinct, heavier mechanism than the fork-mode background subagents covered previously — not just different vocabulary for the same thing.** Per the official comparison table: subagents have "Own context window; results return to the caller" and communicate only by "Return a result to the caller" (unless Claude named them, in which case they too can be messaged); teammates have "Own context window; fully independent" and "message each other directly," coordinating through "a shared task list" with claimable, dependency-aware tasks [S1].

2. **Agent teams is opt-in via an experimental env var, and it's already on for this user.** *"Agent teams are experimental and disabled by default. Enable them by setting `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`... Without that variable, no team is set up at session start... Claude does not spawn or propose teammates."* [S1] Confirmed live: it's `"1"` in `~/.claude/settings.json` [S2].

3. **The trigger for teammate formation is exactly: a named `Agent` call, not a fork, without `isolation`.** *"Claude launches a teammate when it calls the Agent tool with a name while agent teams are enabled, unless the call is a fork or passes isolation on the call itself."* And critically: *"Claude also names ordinary subagents on its own so it can message them later. Those calls follow the same rule, so teams can form even when you didn't ask for one."* [S1] This means power-mode's un-named-in-prompt `Agent({...})` calls can still become teammates purely because the acting Claude chooses to add a `name` at call time (which it's documented to do routinely) — an implicit, non-deterministic path to the same effect power-mode's author apparently intended.

4. **The panel doesn't visually distinguish a subagent row from a teammate row, but the two have different persistence rules.** *"Subagents appear in the same agent panel as teammates, so the panel alone doesn't confirm a team formed."* [S1] For an ordinary background subagent, the prior research (`index.md`, [S1 there]) found rows clear immediately on success. For a teammate specifically: *"As of v2.1.199, an idle teammate's row stays in the panel while any teammate or subagent is still working... Once every agent in the panel is idle, idle rows hide after 30 seconds and reappear on the teammate's next turn; the teammate stays running and addressable while hidden."* [S1] This is the mechanism most likely behind the user's observation that power-mode "usually does a good job" — a wave of 5 teammates finishing at staggered times won't have their rows disappearing one-by-one as each completes; they persist as a group until the whole panel is idle.

5. **A real, documented failure mode exists if power-mode is ever run nested inside an existing teammate.** *"No background subagents from in-process teammates: an in-process teammate's own subagents run in the foreground... Claude Code returns an error when a teammate spawns a subagent whose definition sets `background: true`."* [S1] If a user asked an existing teammate to run `/power-mode` on its own, its `Agent(...)` dispatches would be forced foreground and lose panel visibility entirely — this is a real edge case worth a one-line caution in power-mode's own docs, though it's not the common invocation path (power-mode is normally run from the top-level lead session).

6. **Token cost is a genuine, non-cosmetic trade-off of relying on teams rather than plain subagents.** *"Agent teams use significantly more tokens than a single session... each teammate has its own context window."* [S1] If power-mode's fleet is quietly becoming full teammates via auto-naming, that's a meaningfully higher token bill than the plain-subagent path this research previously assumed applied uniformly — worth knowing when reasoning about `/power-mode` cost, separate from the UI-visibility question.

## Constraints
- Agent teams requires an **interactive** session — *"Spawning teammates also requires an interactive session. In non-interactive mode with the `-p` flag... Claude doesn't spawn teammates."* [S1] tmux-conductor's whole model (Claude Code running interactively in tmux panes) satisfies this, so it's not a blocker here, but any headless/`-p` invocation of power-mode (e.g. from a script) would silently fall back to plain subagents.
- Whether a given power-mode run actually produces teammates or plain subagents is **not deterministic from the SKILL.md text as written today** — it depends on whether the acting Claude happens to add a `name` to each `Agent(...)` call, which the docs say it "may" do but don't guarantee case-by-case.
- Only one team exists per session (`"One team per session: a session has exactly one team, scoped to that session"` [S1]), matching the deprecated `team_name` parameter's "single implicit team" behavior already noted in `index.md`.

## Recommendation

**Agent teams is already doing real work here — the fix is to make it deliberate instead of incidental.** Add explicit `name` values to every `Agent({...})` call in `~/.claude/skills/power-mode/SKILL.md` (e.g. `name: "tackle-<TASK-NNNN>"`, `name: "uat-gen-<TASK-NNNN>"`, `name: "uat-auto-<TASK-NNNN>"`), rather than relying on Claude's own judgment to add one at call time. This:
- Guarantees teammate formation (since agent teams is already globally enabled) instead of leaving it to chance, giving power-mode's fleet the more persistent v2.1.199 idle-row behavior on every run, not just the runs where the acting Claude happened to self-name.
- Makes every spawned agent addressable and referenceable by a predictable name in later prompts, matching the docs' own best-practice ("tell the lead what to call each teammate").
- Costs nothing extra to add — the `name` field already exists on the `Agent` tool and power-mode already builds unique per-task descriptions it can derive a slug from.

**Do not chase "agent teams" as a separate thing to turn on** — it's not off, and there's no code in tmux-conductor's own repo to change; the lever is purely the *prompt text* in the `SKILL.md` files under `~/.claude/skills/`. If cost becomes a concern given teams' higher token usage per [S1], the alternative is the opposite move: explicitly disable agent teams (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "0"` in a settings scope power-mode's calls run under) and rely purely on the plain-subagent background-execution path documented in `index.md` — accepting the less-persistent (immediate-clear-on-success) row behavior in exchange for materially lower per-agent token cost.

### Risks / residual gaps
- Not independently verified in this pass: whether power-mode's *current* runs are, in fact, forming teammates today (would require inspecting `~/.claude/teams/` during a live `/power-mode` run, or checking a run's transcript for `name` on its `Agent` tool_use blocks) — the conclusion above is the best-supported inference from the settings + SKILL.md + official docs, not a live-traced confirmation.
- The docs' idle-row persistence behavior ("stays in the panel while any teammate or subagent is still working") is described for a *lead's own terminal*; whether this generalizes identically to the pane-mirroring setup tmux-conductor's dashboard captures (an agent pane running as a lead) was not separately re-verified — treated as the same mechanism since the dashboard is a passive mirror, consistent with `index.md`'s finding that tmux-conductor renders the CLI's own output verbatim.

## Next Steps
- Optional: `/task-add` to add explicit `name` values to power-mode's `Agent({...})` call templates in `~/.claude/skills/power-mode/SKILL.md` — a small, low-risk prompt-engineering change (not a tmux-conductor code change; the file lives in `~/.claude/skills/`, outside this repo).
- Optional live verification: run a small `/power-mode` wave and inspect `~/.claude/teams/{team-name}/config.json`'s `members` array to directly confirm whether teammates (not plain subagents) formed, closing the one open gap above.
