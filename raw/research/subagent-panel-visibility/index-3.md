---
topic: Where and what instructions to add so all tmux-conductor agents know the named-parallel-dispatch / agent-teams preference is preferred behavior
slug: subagent-panel-visibility
researched: 2026-09-13
sources: [./sources-3.md]
---

# Research: Where to put the agent-teams/naming preference so every tmux agent picks it up

> Builds on [index.md](index.md) and [index-2.md](index-2.md); this update covers *instruction placement* — the concrete files/locations to edit and what to write in them, given the mechanics those two passes already established (fork-mode background execution, agent-teams's named-call trigger, and the `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` flag already being on globally for this user).

**Two different scopes answer "all tmux agents" differently, and you likely want both.** For a preference that should apply to *every* Claude Code session this user's `tmux-conductor` ever spawns — regardless of which project directory that agent's pane happens to be working in — the correct location is a new file at `~/.claude/rules/agent-teams-preference.md`, exactly the pattern already in use for `~/.claude/rules/lsp-first.md` (confirmed as an official, user-level, all-projects-loaded mechanism, not a custom convention). For the preference to also read correctly to a human (or another agent) who opens *this specific repo*, add a shorter, cross-referencing note to `tmux-conductor`'s own project `CLAUDE.md` — it won't reach agents spawned into other repos, but it documents the convention where this project's own orchestration skills and contributors will see it. **Do not put this in `AGENTS.md`** — Claude Code does not read that file at all; it exists in this repo only for the non-Claude agents (Codex, Aider, etc.) tmux-conductor also supports, and the concept (named `Agent` tool calls, fork mode, agent teams) is Claude-Code-specific and meaningless to them.

## Research Questions
- What are Claude Code's actual instruction-loading locations, in priority order, and which of them apply regardless of an agent's working directory?
- Does Claude Code read `AGENTS.md` (already present in this repo) for this purpose?
- Is `~/.claude/rules/` — already used for this user's Serena/LSP-first instruction — an official mechanism or a custom one, and does it apply globally?
- Is there a more surgical, tmux-conductor-specific injection point (as opposed to a machine-wide rule) that reaches only conductor-spawned agents?
- What should the instruction text itself say, given the mechanics `index.md`/`index-2.md` already established?

## Current State (Codebase)
- `AGENTS.md` (repo root) mirrors `CLAUDE.md`'s section structure almost exactly (Project Overview, Architecture, Prerequisites, Task/Doc Workflow, Shell Command Conventions, MCP Tool Rules, LLM Wiki) [S5] — consistent with this project's own stated design as a "vendor-agnostic system for orchestrating multiple AI coding agent instances (Claude Code, OpenAI Codex, Aider, etc.)": `AGENTS.md` is the vendor-neutral file, `CLAUDE.md` the Claude-specific one.
- `~/.claude/rules/lsp-first.md` already exists and is exactly this pattern in active use: the system surfaces it every session as *"user's private global instructions for all projects"* [S3].
- `scripts/conductor.sh` spawns each agent by reading a per-agent `launch_cmd` (`AGENT_CMDS["$name"]`, sourced from the `agents` SQLite table) and running it via `tmux send-keys -t "$SESSION_NAME:$window_name" "$env_prefix $launch_cmd" Enter` [S4] — i.e., the exact `claude ...` command line (with whatever flags the user configured per agent) is fully under this project's control at spawn time, not hardcoded. This is the mechanical hook point if the goal is "only agents `tmux-conductor` itself spawns," as opposed to every Claude Code session on the machine.
- This repo's own `CLAUDE.md` (root) does not currently mention agent-teams, fork mode, or naming conventions for the `Agent` tool at all — confirmed by the absence of any such section in the file as read in `index.md`/`index-2.md`'s research.

## Key Findings

1. **Claude Code reads `CLAUDE.md`, not `AGENTS.md` — confirmed directly.** *"Claude Code reads CLAUDE.md, not AGENTS.md. If your repository already uses AGENTS.md for other coding agents, create a CLAUDE.md that imports it... You can also add Claude-specific instructions below the import."* [S1] This repo already has both files, so the pattern the docs recommend (`@AGENTS.md` import plus a Claude-specific section) is directly applicable if the two files should stay in sync going forward — but the agent-teams preference itself, being Claude-Code-only, belongs in the Claude-specific section, never in `AGENTS.md` proper.

2. **`~/.claude/rules/` is a real, documented, first-party feature — not a personal convention — and user-level rules apply to every project on the machine.** *"Personal rules in `~/.claude/rules/` apply to every project on your machine... User-level rules are loaded before project rules."* Files without `paths:` frontmatter load unconditionally at every session launch; files with `paths:` only activate when Claude touches a matching file [S1]. This is the exact mechanism already backing `lsp-first.md` [S3], confirming it's the natural place to add a sibling file for this preference.

3. **Project CLAUDE.md and `.claude/rules/` are checked into git and team-shared, but only cover sessions whose working directory is inside that project.** *"Team members via source control"* is the CLAUDE.md project scope's "Shared with" column [S1]. Since `tmux-conductor` agents can be (and per its own architecture, often are) spawned with a `workdir` pointing at a *different* repository entirely, a project-level rule in `tmux-conductor` itself will not reach those agents — only user-level `~/.claude/rules/` or a launch-time flag will.

4. **A third, more surgical option exists: inject the instruction at launch via `--append-system-prompt-file`, scoped to only the `launch_cmd` this project itself constructs.** *"`--append-system-prompt-file` — Load additional system prompt text from a file and append to the default prompt"* [S2], an alternative to the literal-string `--append-system-prompt` "for text too long to pass on the command line" [S2] — a meaningful advantage here, since `conductor.sh` already dispatches `launch_cmd` through `tmux send-keys`, where a long literal string adds another layer of shell-quoting risk on top of the project's already-documented BSD/GNU `sed` and `send-keys -l` literal-mode carefulness. This is the only option of the three that reaches **only** agents this project itself spawns, without touching the user's unrelated day-to-day Claude Code sessions.

5. **CLAUDE.md content is not enforced — it's a strong suggestion, not a hard rule.** *"Claude treats them as context, not enforced configuration... there's no guarantee of strict compliance, especially for vague or conflicting instructions."* [S1] For something as unenforceable-by-nature as "prefer naming your parallel Agent-tool calls," a CLAUDE.md/rules-file instruction is the right *category* of mechanism (behavioral guidance, not a hard gate) — a hook could only block/deny an action, not make Claude choose to add a `name` field, so this is not a case where a `PreToolUse` hook would substitute for the instruction.

## Constraints
- Any instruction placed at `~/.claude/rules/` applies to **every** Claude Code session on this machine, not just tmux-conductor-spawned ones — including the user's own everyday interactive use in unrelated projects. If that breadth is undesired, the launch-time `--append-system-prompt-file` route (finding 4) is the one that scopes correctly.
- CLAUDE.md/rules content is capped for adherence, not hard size: *"target under 200 lines per CLAUDE.md file... Files over 200 lines consume more context and may reduce adherence"* [S1] — keep the new content short and specific, per the docs' own "Specificity" guidance (concrete, verifiable instructions beat vague ones).
- `--append-system-prompt` and `--append-system-prompt-file` **cannot be combined** with each other [S2]; whichever is chosen for `conductor.sh`'s launch_cmd becomes the only system-prompt-append mechanism available to that invocation (a user who also wants to hand-add `--append-system-prompt` per-agent would need to fold both into one file instead).
- Both `~/.claude/rules/` and CLAUDE.md are loaded as context (a user message after the system prompt for CLAUDE.md); only `--append-system-prompt`/`--append-system-prompt-file` land literally in the system prompt itself, which the official troubleshooting guidance frames as the tier to reach for specifically when a CLAUDE.md instruction isn't being followed reliably enough [S1].

## Solution Comparison

| Criteria | A: `~/.claude/rules/agent-teams-preference.md` (global) | B: this repo's `CLAUDE.md` (project) | C: `--append-system-prompt-file` baked into `launch_cmd` |
|---|---|---|---|
| **Approach** | New user-level rule file, sibling to `lsp-first.md` | New section in `tmux-conductor`'s own root `CLAUDE.md` | Wrap each agent's stored `launch_cmd` (e.g. `claude --append-system-prompt-file ~/.claude/rules/agent-teams-preference.md`) |
| **Reaches** | Every Claude Code session on this machine, any project | Only sessions whose workdir is `tmux-conductor` (or a subdirectory) | Only agents spawned via `conductor.sh`/`spawn.sh`'s own `launch_cmd` |
| **Pros** | Matches the exact existing convention (`lsp-first.md`); zero code changes; one file | Team-shared via git; visible to anyone reading the project's own docs | Most precisely scoped — literally "all tmux agents," nothing else |
| **Cons** | Also affects the user's unrelated day-to-day Claude Code use outside tmux-conductor | Doesn't reach agents whose workdir is a *different* project | Requires editing how `launch_cmd` is stored/templated (host-server "Add Agent" flow, `scripts/add-task.sh`, or the DB default) — real, if small, code change |
| **Complexity** | Low | Low | Medium (touches the agent-creation path, not just a doc) |
| **Codebase fit** | N/A (lives outside the repo) | Matches this project's existing CLAUDE.md/AGENTS.md split | Fits `conductor.sh`'s existing `launch_cmd`-from-DB pattern cleanly |
| **Maintenance** | One file, edited rarely | One section, edited rarely | Needs the same file (A) to point at, plus keeping the launch template in sync if the agent-creation UI changes |

## Recommendation

**Do both A and B; treat C as an optional hardening step, not a prerequisite.**

1. **Add `~/.claude/rules/agent-teams-preference.md`** (no `paths:` frontmatter, so it loads unconditionally) with content along these lines:
   - State the preference plainly: when spawning multiple `Agent(...)` tool calls to do parallel work, always pass an explicit, descriptive `name` to each call.
   - State *why*, briefly, so it survives edits by future-you: naming is what lets a background dispatch become a fully-tracked, addressable teammate (agent teams is enabled machine-wide via `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in `~/.claude/settings.json`), and teammates keep a persistent row in the subagent panel while siblings are still working, instead of blinking out the instant each one finishes.
   - Cross-reference `raw/research/subagent-panel-visibility/` in `tmux-conductor` for the full mechanism, for whichever future session re-derives "why does this rule exist."
2. **Add a short section to `tmux-conductor`'s own project `CLAUDE.md`** (near the existing Task/Doc Workflow or MCP Tool Rules sections) pointing at the same convention, so anyone reading this repo's own docs — human or agent — sees it without needing `~/.claude/rules/` to be visible to them (e.g. a contributor on a different machine). Keep it to 3-5 lines; don't duplicate the full rationale, just cross-reference the global rule and the wiki concept pages (`background-subagent-panel-visibility`, `claude-code-agent-teams`) for the mechanism.
3. **Skip `AGENTS.md` entirely for this** — it's read by Codex/Aider, not Claude Code, and the concept doesn't translate.
4. **Treat option C (baking `--append-system-prompt-file` into the stored `launch_cmd`) as optional** — reach for it only if A/B prove insufficiently reliable in practice (per finding 5, CLAUDE.md/rules content is unenforced context, so if `/power-mode`-style orchestration keeps forgetting to name its calls despite the rule, this is the next escalation, not the first move). If adopted, point `--append-system-prompt-file` at the *same* file created in step 1 rather than duplicating its content.

### Risks / residual gaps
- Not verified in this pass: whether an instruction at `~/.claude/rules/` actually changes real-world adherence for `power-mode`'s specific `Agent({...})` call pattern — CLAUDE.md/rules content is unenforced context (finding 5), so this remains a "should help, not guaranteed" lever, consistent with `index-2.md`'s own conclusion that power-mode's current teammate formation is already happening "by accident" via Claude's own auto-naming.
- The exact interaction between `--append-system-prompt-file` and a resumed session (`claude --resume`, which `conductor.sh` doesn't currently appear to use for fresh spawns, but which the dashboard's other flows might) was not confirmed by the docs excerpt fetched — flagged, not resolved, in [S2].

## Next Steps
- `/task-add` candidate (small, project-scoped): "Add a `## Agent orchestration` section to `tmux-conductor`'s root `CLAUDE.md` cross-referencing the new `~/.claude/rules/agent-teams-preference.md` global rule." This is a docs-only change to this repo — writing the actual global rule file itself is outside this repo and can be done directly (Write tool) without a task.
- No `/decision-create` warranted — this is a documentation/instruction-placement choice, not an architecturally significant trade-off with competing runtime implementations.
