---
id: claude-code-instruction-placement
title: Claude Code Instruction Placement (CLAUDE.md vs. Rules vs. Launch Flags)
updated: 2026-09-13
sources:
  - ../../raw/research/subagent-panel-visibility/index-3.md
confidence: extracted
tags: [claude-code, memory, configuration]
---

Claude Code offers several places to put a standing instruction, and they differ in **scope** (who/what it reaches) and **enforcement** (context vs. system prompt vs. hard hook), not just location:

- **Managed policy CLAUDE.md** (`/Library/Application Support/ClaudeCode/CLAUDE.md` on macOS, etc.) — every session on the machine, every repo, IT/MDM-deployed. Overkill for a personal preference.
- **`~/.claude/CLAUDE.md`** — one file, personal, all projects.
- **`~/.claude/rules/*.md`** (no `paths:` frontmatter) — personal, all projects, loaded unconditionally at every launch, *before* project rules. Supports many small topic files instead of one large file. This is the mechanism already backing this user's `~/.claude/rules/lsp-first.md`.
- **Project `CLAUDE.md` / `.claude/CLAUDE.md` / `.claude/rules/*.md`** — team-shared via git, but scoped to sessions whose working directory is inside that project (and its subdirectories, loaded on demand).
- **`paths:`-scoped rules** — only enter context when Claude touches a matching file glob; for narrow, file-type-specific conventions, not standing preferences.
- **`--append-system-prompt` / `--append-system-prompt-file`** (mutually exclusive) — injected at launch, literally into the system prompt rather than as a later context message. Best for scripts/automation that construct the launch command themselves (exactly `derived_from::[[tmux-conductor]]`'s own `conductor.sh`/`spawn.sh`, which build each agent's `launch_cmd` dynamically from a DB-stored value) since it reaches only sessions launched through that exact command, not the user's unrelated everyday Claude Code use.
- **`AGENTS.md`** — not read by Claude Code at all; it's for other agentic CLIs (Codex, Aider, etc.). Import it from `CLAUDE.md` with `@AGENTS.md` if the two need to stay in sync.
- **Hooks** — the only genuinely *enforced* layer; use them only when the instruction is really a hard gate ("block this," not "prefer this"), since CLAUDE.md/rules content is unenforced context Claude tries to follow but isn't guaranteed to.

**Choosing between the scopes is a "who does this need to reach" question, not a "which is more correct" one**: user-level `~/.claude/rules/` is the right call for "every Claude Code session on my machine," project CLAUDE.md for "everyone who works on this specific repo," and a launch-flag injection for "only sessions a specific script spawns" — three genuinely different audiences that happen to look similar in the abstract ("add an instruction somewhere").

See `relates_to::[[claude-code-agent-teams]]` and `relates_to::[[Background Subagent Panel Visibility (Fork Mode, Foreground vs. Background)]]` for the concrete case this concept was extracted from (deciding where to tell tmux-conductor's agents to prefer naming their parallel `Agent(...)` calls).
