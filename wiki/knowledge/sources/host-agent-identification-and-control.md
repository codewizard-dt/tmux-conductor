---
id: host-agent-identification-and-control
title: Host-Wide Claude Code Agent Identification, Categorization, and Control
updated: 2026-09-13
sources:
  - ../../raw/research/host-agent-identification-and-control/index.md
confidence: extracted
tags: [claude-code, session-discovery, tmux, cross-session-messaging, control]
---

# Host-Wide Claude Code Agent Identification, Categorization, and Control

**Identifying and categorizing a Claude Code session tmux-conductor didn't spawn is reliably possible, empirically verified on a live multi-session machine.** A session's controlling terminal device (`ps -o tty= -p <pid>`) cross-referenced against `tmux list-panes -a -F "#{pane_tty} #{session_name}:#{window_index}.#{pane_index}"` (run across every tmux session on the server, not just tmux-conductor's own) gives an exact three-way categorization: tmux-hosted (with the precise pane), plain-terminal (a real tty absent from any pane list), or headless/background (no controlling tty at all). Verified live twice with exact matches, and cross-confirmed against the officially documented `kind:"background"` field (a background session had no tty, as expected). See `derived_from::[[claude-code-session-discovery]]` for the base `claude agents --json` detection layer this builds on.

**A mistake was caught mid-investigation, not after the fact**: three pids initially looked like orphaned processes surviving a closed tmux window (empty tty field), but `kill -0` before drawing conclusions revealed they had simply exited — `ps -o tty=` returns an empty string for both "no controlling terminal" and "no such process," and the two must never be conflated.

**Whether a detected session can actually be *sent a command* depends entirely on its category — this is the more consequential finding.** A tmux-hosted session (whoever spawned it) is trivially controllable via ordinary `tmux send-keys`, exactly like tmux-conductor's own managed agents — tmux doesn't distinguish who created a pane. A headless/background session has a real CLI management surface (`claude attach/logs/stop/respawn/rm <id>`) but `attach` is confirmed **interactive-terminal-only** — no flag pipes text into a running session non-interactively. A plain-terminal interactive session has no automatable control path found at all.

**Claude Code's own cross-session messaging (`SendMessage`/`ListAgents` — the tools this very research session used) is real, documented, and Unix-socket-based** (`code.claude.com/docs/en/cross-session-messaging`, requires v2.1.224+), confirmed on the live research machine: the `messagingSocketPath` field in `~/.claude/sessions/<pid>.json` points to a genuinely live Unix domain socket. **But it is only invocable from inside a running Claude Code process**, not from an arbitrary external process like tmux-conductor's host-server — the wire protocol isn't publicly documented, so speaking it directly would mean reverse-engineering an unsupported, version-fragile format. A legitimate indirect route exists (shell out to a throwaway `claude -p "...SendMessage..."` process that calls the tool on the caller's behalf) but this delivers advisory text a receiving Claude interprets, never a guaranteed command execution — a fundamentally different capability from `tmux send-keys`.

See `derived_from::[[Claude Code CLI]]`, `relates_to::[[controlling-detected-claude-code-sessions]]`, `relates_to::[[tmux send-keys Key Names]]`.
