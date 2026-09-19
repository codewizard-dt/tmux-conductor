---
topic: "Can tmux-conductor reliably identify and categorize Claude Code agent sessions running on the host even when they weren't started inside its own tmux session? And is it actually possible to send them commands?"
slug: host-agent-identification-and-control
researched: 2026-09-13
---

# Primary Sources — Host-Wide Claude Code Agent Identification, Categorization, and Control

> Builds on [../detect-active-claude-code-sessions-kanban/sources.md](../detect-active-claude-code-sessions-kanban/sources.md) — S1-S9 there (the `claude agents --json` schema, `~/.claude/sessions/<pid>.json`, hooks-not-global-coverage, etc.) are read-only context for this round; not repeated here.

| ID | Type | Locator | Accessed | What it contributed |
|----|------|---------|----------|---------------------|
| S1 | codebase (live commands) | `tmux list-panes -a -F "..."`, `ps -o tty= -p <pid>`, `kill -0 <pid>` (local machine) | 2026-09-13 | Empirically verified tty-to-tmux-pane correlation (2 exact matches); confirmed a `kind:"background"` session has no controlling tty (`??`) while live `kind:"interactive"` sessions do |
| S2 | codebase (CLI, installed locally) | `claude attach --help`, `claude logs --help`, `claude stop --help`, `claude --help` (full top-level command list) | 2026-09-13 | Confirmed `attach`/`logs`/`stop` semantics (interactive-only reattach, read-only tail, stop) and that no `message`/`send` CLI subcommand exists |
| S3 | context7 | `/websites/code_claude` — "teammates cross-session messaging SendMessage ListAgents protocol how it works" | 2026-09-13 | Official doc text (`code.claude.com/docs/en/cross-session-messaging`, `/tools-reference`): Unix-domain-socket transport on macOS/Linux (named pipe on Windows), v2.1.224+ requirement, same-filesystem discovery model |
| S4 | codebase (live inspection) | `~/.claude/sessions/*.json`'s `messagingSocketPath` field + Python `os.stat`/`stat.S_ISSOCK` check | 2026-09-13 | Confirmed 12/12 checked `messagingSocketPath` values are real, currently-live Unix domain sockets at `/tmp/cc-socks/<pid>.sock` |
| S5 | web | https://www.developersdigest.tech/blog/claude-code-cross-session-messaging-2026 | 2026-09-13 | "`claude -p` workers bind the same inbox socket as interactive sessions... hooks get the socket path as `CLAUDE_CODE_MESSAGING_SOCKET`" |
| S6 | web | https://www.explainx.ai/blog/claude-code-cross-session-messaging-list-agents-2026 | 2026-09-13 | "`claude -p` sessions can receive but not approve... a held message stays held unless you set `crossSessionInbound: 'accept'`"; rate-limiting/50-message unread-queue cap details |
| S7 | web | https://aicatchup.com/news/claude-code-cross-session-messaging | 2026-09-13 | "Held messages are capped at 100, separately from the delivery queue"; container/WSL2-vs-native-Windows unreachability caveats |
| S8 | web | https://blakecrosley.com/blog/claude-code-cross-session-messaging | 2026-09-13 | "A message is input, never authority"; confirms per-session socket binds at `/tmp/cc-socks/<pid>.sock` independently (matches S4's live-machine finding) |
| S9 | codebase (live inspection) | `~/.claude/daemon/attach-journal/*.json`, `~/.claude/daemon/dispatch/` | 2026-09-13 | Confirmed `attach-journal` holds attach-latency telemetry (`surface:"fleet"`, `attachMs`, `msgsLoaded`), not a command queue — ruled out as a control mechanism |

## Excerpts

### S1 — live tty/tmux correlation (this machine, 2026-09-13)
```
$ tmux list-panes -a -F "#{pane_tty} #{session_name}:#{window_index}.#{pane_index} ..."
/dev/ttys006 conductor:1.0 ...
/dev/ttys009 conductor:4.0 ...

$ ps -o tty= -p 88840   →  ttys006   (exact match to conductor:1.0)
$ ps -o tty= -p 89060   →  ttys009   (exact match to conductor:4.0)
$ ps -o tty= -p 31343   →  ??        (kind:"background" per claude agents --json — no controlling terminal, as expected)
```
Correction caught in the same investigation: `ps -o tty= -p 88808` initially returned empty and was misread as "no controlling terminal" (implying an orphaned/detached survivor); re-checked with `kill -0 88808` and confirmed the process had simply exited. `ps -o tty=` returns an empty string in both cases — liveness must be checked first.

### S2 — `claude attach --help` (local CLI, v2.1.270)
```
Usage: claude attach <id>

  Open the background session in this terminal. ← returns to agent view, Ctrl+Z drops back to your shell. The session keeps running either way.
```
No flag accepts input to pipe into the session; confirmed via the full help text (only `<id>` positional, no options).

### S3 — Context7, `/websites/code_claude`, official docs
> Claude Code binds an inbox socket for each session with cross-session messaging enabled, where other sessions on the machine deliver messages. The socket is a Unix domain socket on macOS and Linux, including Linux inside WSL 2, and a named pipe on native Windows.

> `SendMessage` ... Messaging other sessions requires Claude Code v2.1.224 or later.

> `ListAgents` ... Requires Claude Code v2.1.224 or later, and appears only in sessions where cross-session messaging is enabled.

### S4 — live socket verification (this machine, 2026-09-13)
```python
import json, glob, os, stat
for f in glob.glob(os.path.expanduser('~/.claude/sessions/*.json')):
    d = json.load(open(f))
    p = d.get('messagingSocketPath')
    if p:
        print(p, 'is_socket=', stat.S_ISSOCK(os.stat(p).st_mode))
# → /tmp/cc-socks/<pid>.sock is_socket= True  (12/12 checked)
```

### S5 — developersdigest.tech
> First, `claude -p` workers bind the same inbox socket as interactive sessions, so a long-running non-interactive job can receive messages, and hooks get the socket path as `CLAUDE_CODE_MESSAGING_SOCKET` (a hook can post back to its own session).

### S6 — explainx.ai
> `claude -p` sessions can receive but not approve — a non-interactive session binds an inbox socket like any other and shows up in `/list-agents`, but it can't display the approval dialog, so a held message stays held unless you set `crossSessionInbound: "accept"` in its `--settings`.

### S7 — aicatchup.com
> A session inside a container cannot reach one on the host, and a WSL 2 session and a native Windows session on the same computer cannot reach each other either, because they register under different home directories and listen on different socket types.

### S8 — blakecrosley.com
> Since v2.1.224, every interactive Claude Code session on a Mac or Linux box binds a Unix socket at startup, and any other session you run can drop a text message into it; mine sits at /tmp/cc-socks/38590.sock, with owner-only permissions.

### S9 — `~/.claude/daemon/attach-journal/<uuid>.json` (this machine, 2026-09-13)
```json
{
  "gestureId": "c1b564dd-994f-4d4e-a7f0-24adac20a162",
  "surface": "fleet",
  "pid": 27963,
  "via": "spare",
  "interactiveReached": true,
  "attachMs": 20,
  "msgsLoaded": 195
}
```
Confirms this is attach-performance telemetry (the "fleet"/agent-view UI's own instrumentation), not a message/command queue.
