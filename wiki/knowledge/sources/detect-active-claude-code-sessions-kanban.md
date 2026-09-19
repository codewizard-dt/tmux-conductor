---
id: detect-active-claude-code-sessions-kanban
title: Detecting All Active Claude Code Sessions for the Kanban
updated: 2026-09-13
sources:
  - ../../raw/research/detect-active-claude-code-sessions-kanban/index.md
confidence: extracted
tags: [claude-code, session-discovery, kanban, dashboard]
---

# Detecting All Active Claude Code Sessions for the Kanban

The Claude Code CLI already exposes a documented, scriptable command — **`claude agents --json`** — that prints every active session on the machine (interactive and background) as a JSON array with `pid`, `cwd`, `name`, `sessionId`, `kind`, and a live `status`/`state` field. Verified directly against the installed CLI's `--help` text ("Print active sessions (interactive and background) as a JSON array and exit — for scripting; does not require a TTY") and against a live run returning 14 concurrent sessions across 6 different project directories on the research machine. This is a strictly better data source for "detect all active Claude Code sessions" than anything `uses::[[tmux-conductor]]` builds itself today.

**`uses::[[tmux-conductor]]`'s current model only sees agents it explicitly registered.** The dashboard kanban (`AgentList.tsx`'s `COLUMNS`) renders exclusively from the SQLite `agents` table, populated only when a user adds an agent and it gets spawned into a tmux window the conductor controls. There is no discovery step today — an ad-hoc `claude` session in a different terminal, tmux session, IDE pane, or background/cloud job is invisible. Model/context enrichment for a *registered* agent (`host-server/context.ts`) is itself a workdir-scoped best-effort fallback, not a discovery mechanism — it can only enrich an agent that's already in the kanban.

**The globally-installed hooks don't already solve this, despite firing machine-wide.** `install-hooks.sh` merges `uses::[[Claude Code Hooks]]` into `~/.claude/settings.json` (user-level), so they technically fire for every session on the machine — but `hooks/lib/write-state.js` silently `exit(0)`s with nothing written unless `CONDUCTOR_AGENT_NAME`/`CONDUCTOR_STATE_DIR` env vars are set (only true for conductor-spawned sessions) or the session happens to be inside *some* tmux pane (grabbing the window name, but still writing to a hardcoded default `STATE_DIR` that isn't a real writable path outside a container). See `relates_to::[[claude-code-session-discovery]]`.

There's also an **undocumented internal registry** backing the CLI feature: `~/.claude/sessions/<pid>.json`, one file per live session, garbage-collected on process exit (verified: all 14 files on the research machine matched live PIDs, zero stale entries), maintained by Claude Code's own local daemon (`~/.claude/daemon/roster.json`, `daemon.lock`). It carries a superset of fields (live `status`, `updatedAt`, a per-session IPC socket path) but should be treated as a private format, not integrated against directly — `claude agents --json` is the supported surface over the same data. Claude Code's own multi-agent tooling (the `ListAgents` cross-session tool) renders this same registry with additional tmux-pane correlation layered on top, which is not itself part of the CLI JSON output.

See the underlying raw research report (`raw/research/detect-active-claude-code-sessions-kanban/index.md`, linked above) for the full solution comparison, implementation outline, and risk list (CLI output-shape drift, cross-project privacy/noise, no control channel for a merely-detected session).
