---
id: controlling-detected-claude-code-sessions
title: Controlling a Detected Claude Code Session Depends Entirely on Its Category
updated: 2026-09-13
sources:
  - ../../raw/research/host-agent-identification-and-control/index.md
confidence: extracted
tags: [claude-code, tmux, cross-session-messaging, control, dispatch]
---

# Controlling a Detected Claude Code Session Depends Entirely on Its Category

Once a Claude Code session is identified and placed into one of the three categories from `relates_to::[[claude-code-session-discovery]]`'s tty-correlation method, whether it can be *sent a command* is a completely different answer per category — there is no single universal control mechanism:

| Category | Control mechanism | Reliability |
|---|---|---|
| **tmux-hosted** (tty matches a live pane, any tmux session) | Ordinary `tmux send-keys -t <session>:<window>.<pane>` | **Real, immediate** — tmux doesn't distinguish who created the pane; identical to controlling `uses::[[tmux-conductor]]`'s own agents. Only reaches panes on a tmux server the caller can access. |
| **Headless/background** (`kind:"background"`, no tty, has an `id`) | `claude attach <id>` / `claude logs <id>` / `claude stop <id>` / `claude respawn <id>` / `claude rm <id>` | **Management only, not command injection.** `claude attach --help`, confirmed: "Open the background session in this terminal" — an interactive terminal reattachment for a human, no flag to pipe text in. There is no documented CLI subcommand that lets an external script feed text into a running session. |
| **Plain-terminal interactive** (real tty, not a tmux pane) | — | **No automatable path found.** Genuinely read-only from outside without OS-level UI automation, which is out of scope for anything CLI-based. |

**Claude Code's cross-session messaging (`SendMessage`/`ListAgents`) is a fourth, orthogonal path — real, but not directly usable by an external process.** Officially documented (`code.claude.com/docs/en/cross-session-messaging`, requires v2.1.224+): each session with the feature enabled binds a per-session Unix domain socket (a named pipe on Windows) recorded in `~/.claude/sessions/<pid>.json`'s `messagingSocketPath` field — confirmed live on the research machine as a genuinely open socket. But **only a running Claude Code process can trigger a delivery** by calling the `SendMessage` tool; there is no `claude <verb>` CLI subcommand for it, and the wire protocol spoken over that socket is not publicly documented — reverse-engineering it for a non-Claude-Code caller (like `uses::[[Host Server]]`, a plain Node/Fastify process) would be unsupported and version-fragile.

A legitimate but heavier workaround: shell out to a throwaway `claude -p "Use SendMessage to tell <session> to ..."` process, which is itself a real Claude Code process and can call the tool. This costs a full model turn, is subject to the receiver's `crossSessionInbound` (`accept`/`hold`/`refuse`) setting and rate limits, and delivers **advisory text the receiver's own Claude interprets** — never a guaranteed, synchronous command execution the way `tmux send-keys` is *(inference — combines several independently documented facts about the messaging feature; no source describes this exact relay pattern)*.

**Net implication for any "Detected Sessions" dashboard feature**: only tmux-hosted detected sessions should ever get a "send a command" affordance (via `tmux send-keys`). Headless-background and plain-terminal sessions should stay strictly read-only/observe-and-manage (attach/stop/logs only for background ones) — offering anything resembling "send a command" for those categories would be misleading about what actually happens.

See `derived_from::[[host-agent-identification-and-control]]`, `relates_to::[[Claude Code CLI]]`, `relates_to::[[tmux send-keys Key Names]]`, `relates_to::[[claude-code-session-discovery]]`.
