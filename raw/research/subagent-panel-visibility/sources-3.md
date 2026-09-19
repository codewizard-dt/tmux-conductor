---
topic: Where and what instructions to add so all tmux-conductor agents know the named-parallel-dispatch / agent-teams preference is preferred behavior
slug: subagent-panel-visibility
researched: 2026-09-13
---

# Primary Sources — Where to put the agent-teams/naming preference

> See also [sources.md](sources.md) and [sources-2.md](sources-2.md) for prior passes' sources; IDs below restart at S1 for this file per the skill's per-file numbering.

| ID | Type | Locator | Accessed | What it contributed |
|----|------|---------|----------|---------------------|
| S1 | web | https://code.claude.com/docs/en/memory | 2026-09-13 | Full CLAUDE.md scope hierarchy (managed/user/project/local), `~/.claude/rules/` mechanics and user-vs-project precedence, confirmation Claude Code reads `CLAUDE.md` not `AGENTS.md`, CLAUDE.md-is-unenforced-context caveat, `--append-system-prompt` pointer |
| S2 | web | https://code.claude.com/docs/en/cli-reference | 2026-09-13 | Exact `--append-system-prompt` (literal string) vs `--append-system-prompt-file` (file path) syntax; the two flags can't be combined; the file variant exists specifically for text too long for the command line |
| S3 | codebase | `~/.claude/rules/lsp-first.md` (surfaced via this session's own system reminders as "user's private global instructions for all projects") | 2026-09-13 | Confirms the `~/.claude/rules/` mechanism is already in active use by this user for exactly this kind of global, cross-project instruction |
| S4 | codebase | `scripts/conductor.sh` (`launch_cmd`/`AGENT_CMDS` + `tmux send-keys` dispatch, ~lines 56-86) | 2026-09-13 | Confirms the per-agent launch command is fully dynamic (sourced from the SQLite `agents` table), making it a viable, surgical injection point for a launch-time `--append-system-prompt-file` flag scoped only to conductor-spawned agents |
| S5 | codebase | `AGENTS.md` (repo root, `get_symbols_overview`) | 2026-09-13 | Confirms `AGENTS.md`'s section structure mirrors `CLAUDE.md`'s, consistent with it being the vendor-neutral file for Codex/Aider/etc., not a Claude Code input |

## Excerpts

### S1 — How Claude remembers your project
https://code.claude.com/docs/en/memory

> | Scope | Location | Purpose | Use case examples | Shared with |
> | User instructions | `~/.claude/CLAUDE.md` | Personal preferences for all projects | Code styling preferences, personal tooling shortcuts | Just you (all projects) |
> | Project instructions | `./CLAUDE.md` or `./.claude/CLAUDE.md` | Team-shared instructions for the project | Project architecture, coding standards, common workflows | Team members via source control |

> Personal rules in `~/.claude/rules/` apply to every project on your machine... User-level rules are loaded before project rules, giving project rules higher priority.

> Rules without a `paths` field are loaded unconditionally and apply to all files.

> Claude Code reads `CLAUDE.md`, not `AGENTS.md`. If your repository already uses `AGENTS.md` for other coding agents, create a `CLAUDE.md` that imports it so both tools read the same instructions without duplicating them. You can also add Claude-specific instructions below the import.

> CLAUDE.md content is delivered as a user message after the system prompt, not as part of the system prompt itself. Claude reads it and tries to follow it, but there's no guarantee of strict compliance, especially for vague or conflicting instructions.

> For instructions you want at the system prompt level, use `--append-system-prompt`. You pass it at launch, so it's better suited to scripts and automation than interactive use.

> Size: target under 200 lines per CLAUDE.md file. Longer files consume more context and reduce adherence.

### S2 — CLI reference (`--append-system-prompt` / `--append-system-prompt-file`)
https://code.claude.com/docs/en/cli-reference

> `--append-system-prompt` — Append custom text to the end of the default system prompt.

> `--append-system-prompt-file` — Load additional system prompt text from a file and append to the default prompt.

> The two flags can't be combined.

> [`--append-system-prompt-file` is] an alternative to `--append-system-prompt` for text too long to pass on the command line.
