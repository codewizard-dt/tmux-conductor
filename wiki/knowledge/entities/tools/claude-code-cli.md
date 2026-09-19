---
id: claude-code-cli
title: Claude Code CLI
aliases: [claude, Claude Code]
updated: 2026-09-13
sources:
  - ../../../raw/research/claude-usage-quota-signal/index.md
  - ../../../raw/research/terminal-keyboard-clipboard/index.md
  - ../../../raw/research/context-window-accuracy/index.md
  - ../../../raw/research/stop-hook-subagent-detection/index.md
  - ../../../raw/research/bug-0001-background-agent-detection/index.md
  - ../../../raw/research/detect-active-claude-code-sessions-kanban/index.md
  - ../../../raw/research/host-agent-identification-and-control/index.md
confidence: ambiguous
tags: [claude-code, cli, agent-teams]
---

# Claude Code CLI

Anthropic's agentic coding CLI (`claude`), installed at v2.1.233 as of this research (v2.1.269-2.1.270 as of the 2026-09-13 session-discovery research below). Full command surface (`claude --help`): `agents`, `auth`, `auto-mode`, `doctor`, `gateway`, `import`, `install`, `mcp`, `plugin|plugins`, `project`, `setup-token`, `ultrareview`, `update|upgrade` — **no `usage` subcommand exists**. Invoking `claude usage` (or any unrecognized word) falls through to the `[prompt]` positional argument and launches a full interactive agentic turn, not a status check — this was the root cause of a real bug in `uses::[[tmux-conductor]]`'s `USAGE_CHECK_CMD` (see `derived_from::[[claude-usage-quota-signal]]`).

`claude auth status` is fast (~0.2s) and reports login/subscription-tier info only (`{loggedIn, authMethod, apiProvider, email, orgId, orgName, subscriptionType}`) — no usage/quota fields. `claude doctor` is an installation health check, also with no usage data.

## Input-line key bindings (verified 2026-08-15, v2.1.233)

Established by driving a real `claude` input line inside a throwaway tmux session and reading the buffer back — not from documentation. Each was sent as a tmux key name; no prompt was ever submitted:

| Key sent | Effect on the input line |
|---|---|
| `M-Left` / `M-Right` | jump one word left / right |
| `M-b` / `M-f` | jump one word left / right (same effect; `\eb` / `\ef`) |
| `M-BSpace` | delete previous word |
| `C-w` | delete previous word |
| `C-u` | kill to start of line |
| `C-k` | kill to end of line |
| `C-a` / `C-e` | move to start / end of line |
| `Home` / `End` | move to start / end of line |

There is **no keyboard text-selection** concept in the input line, so Shift+Arrow has nothing to map to. See `relates_to::[[terminal-keyboard-clipboard]]` and `relates_to::[[tmux-send-keys-key-names]]`.

The one official surface for checking subscription usage is the `/usage` **slash command**, but it only works typed inside a live interactive session — there is no CLI-invocable equivalent — and its own in-product disclaimer says it is computed from local sessions only, not authoritative server state. See `relates_to::[[claude-subscription-usage-signal-gap]]` for the full implication of this gap.

## Context-window size per model

Context-window size is **not exposed by any queryable API** (`GET /v1/models` returns only `id`/`display_name`/`type`/`created_at`, no `context_window` field) and is not reliably present in the transcript JSONL either — the API-injected `<budget:token_budget>` / `<system_warning>Token usage: X/Y</system_warning>` tags described in Anthropic's docs are added to the outgoing request, not persisted to what Claude Code writes to disk.

As of this research: Claude Sonnet 5 has a 1M-token context window as its **only** option (no 200k variant, no `[1m]` opt-in needed) on the API, on Claude.ai paid plans, and in Claude Code — a change from Sonnet 4.5 (200k) and a plan-gated exception for Sonnet 4.6 (1M requires usage credits outside API/pay-as-you-go). Opus 4.6 and later, Fable 5, and Mythos 5/Preview are also 1M-window models. Anthropic's own Claude Code has independently shipped the "still assumes Sonnet is 200k" bug at least twice (`anthropics/claude-code#84310`, `#76155`) — this is a recurring trap tied to how fast the model lineup changes, not a one-off. See `derived_from::[[context-window-accuracy]]`.

## Background/async agents (shipped v2.1.198, ~July 2026)

As of Claude Code v2.1.198, background agents run by default: a session can dispatch an agent that keeps running detached while the outer turn legitimately ends (a genuine `Stop`), then resumes the conversation later via Claude Code's own async task-notification machinery. The `Notification` hook event gained two new `notification_type` values for this: `agent_needs_input` (background agent needs input) and `agent_completed` (background agent finished **or failed**) — alongside the pre-existing `permission_prompt`, `idle_prompt`, `auth_success`, `elicitation_dialog`, `elicitation_url_dialog`, `elicitation_complete`, `elicitation_response`, and (as of this update) `quota_auto_resume_fired`/`quota_auto_resume_stale`/`quota_auto_resume_disabled`. This is a **different mechanism** from the classic synchronous Task tool, whose `SubagentStart`/`SubagentStop` events nest inside the outer turn and only resolve before `Stop` ever fires — `Stop`'s own JSON payload has no field indicating outstanding background work either way. See `relates_to::[[stop-hook-subagent-detection]]` and `relates_to::[[Claude Code Hooks]]`.

**`agent_needs_input` fires only when a decision is genuinely needed — confirmed 2026-09-04, not a general "still running" ping.** A background agent that runs to completion without ever needing input never triggers it. `agent_id`/`agent_type` (the common hook fields) do **not** identify which background job a Notification refers to — they describe whether the current hook-firing process is itself a subagent. No per-background-job correlator field was found documented anywhere on the Notification payload.

**The interactive prompt footer's `←` hint is a separate, more precisely-scoped background-agent signal**, independent of hooks entirely: `← N agents` (N need input), `← for agents` (agents active, none currently need input), `← N done` (transient, shown when agents complete while none need input). Background sessions also have a short ID (directory name under `~/.claude/jobs/<id>`) and a full `sessionId`, usable with `claude --resume`. See `relates_to::[[bug-0001-background-agent-detection]]`.

## Fork mode and the subagent panel below the prompt input (confirmed via Context7, `code.claude.com/docs/en/sub-agents` + `whats-new`, 2026-09-13)

The `←` footer hint above is **not** the same UI element as the **subagent panel below the prompt input** — a distinct, inline live tree that lists only the current session's own currently-running subagents (nested, with a `(+N)` descendant count per row), separate from the footer hint's coarser session/machine-wide signal. Fork mode — on by default in interactive sessions as of v2.1.225–v2.1.233 (Week 33, Aug 2026) — is what puts a subagent there at all: *"Claude Code runs the subagent in the background, forks and non-fork subagents alike, and Claude can't ask for the foreground."* Plain (non-fork) subagents separately became background-by-default in v2.1.195–v2.1.201 (Week 27, June 2026).

**Foreground vs. background is the entire determining factor for whether a panel row can appear at all.** A foreground subagent blocks the parent turn and never appears as a row (permission prompts pass straight to the user instead of surfacing in the main session); a background subagent gets a row for at least as long as it's in flight. An explicit `name` makes a subagent addressable (via `@`-mention typeahead and later resume/message). See `derived_from::[[subagent-panel-visibility]]` and `relates_to::[[background-subagent-panel-visibility]]` for the full investigation (prompted by two dashboard screenshots that turned out to differ in whether *that session* had any of its own background subagents/teammates in flight at the moment captured).

> **Contradiction — corrected (2026-09-13):** this section originally read "not 'background vs. agent teams'" and stated a row clears "immediately on success... or kept up to 30 seconds on failure/stop" unconditionally. A follow-up pass found agent teams is not a ruled-out alternative — it's a separate, opt-in mechanism (`relates_to::[[claude-code-agent-teams]]`, `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, enabled globally for this user) that changes *how long* a row persists: a named `Agent(...)` call becomes a full **teammate** rather than a plain subagent whenever the flag is on and the call isn't a fork/`isolation`-scoped, and a teammate's idle row stays visible while any sibling is still working (clearing only once the whole panel goes idle) — materially different from a plain subagent's immediate-on-success clear. See `derived_from::[[subagent-panel-visibility (agent-teams update)|../../../raw/research/subagent-panel-visibility/index-2.md]]`.

## Agent teams (opt-in, `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`; confirmed via Context7, `code.claude.com/docs/en/agent-teams`, 2026-09-13)

Agent teams is experimental and off by default. When enabled, a teammate is a fully independent Claude Code session — own context window, direct messaging with other teammates, claims work from a shared task list — versus a subagent that just reports a result back to its caller. Formation trigger: *"Claude launches a teammate when it calls the Agent tool with a name while agent teams are enabled, unless the call is a fork or passes isolation on the call itself,"* and this can happen without the user asking, since *"Claude also names ordinary subagents on its own so it can message them later."* Constraints: one team per session (no nested teams — a teammate's own subagents run foreground-only, can't outlive the lead's process); requires an interactive session (never triggers under `-p`/headless); costs meaningfully more tokens than plain subagents. See `relates_to::[[claude-code-agent-teams]]` for the full concept writeup and `relates_to::[[power-mode-skill]]` for a concrete orchestration skill that both invokes this feature by name in its own instructions and, per the linked research, very likely relies on it incidentally via Claude's own auto-naming.

## `claude agents --json` — machine-wide active-session listing (confirmed 2026-09-13, v2.1.269+)

`claude agents [options]` ("Manage background agents") has a documented `--json` flag: **"Print active sessions (interactive and background) as a JSON array and exit (for scripting; does not require a TTY)."** `--all` additionally includes completed background sessions; `--cwd <path>` filters to sessions started under a directory. Confirmed live: returned 14 concurrent sessions spanning 6 project directories, e.g. `{"pid":8995,"cwd":"/Users/.../bootstrap-claude","kind":"interactive","startedAt":1789017086346,"sessionId":"11984a21-...","name":"bootstrap-claude-bc","status":"busy"}`. Fields seen: `id` (background sessions), `pid`, `cwd`, `kind` (`interactive`|`background`), `startedAt`, `sessionId`, `name`, `status` (`idle`|`busy`) and/or `state` (`working`|`blocked`, background). This is the supported, scriptable way to enumerate every Claude Code session running on a machine — not scoped to one project's cwd — and is the recommended integration point for anything wanting to show all active sessions somewhere (e.g. a dashboard kanban). See `derived_from::[[detect-active-claude-code-sessions-kanban]]` and `relates_to::[[claude-code-session-discovery]]`.

`claude attach <id>` / `claude logs <id>` / `claude stop <id>` are confirmed via full `--help` text (2026-09-13) to be **interactive-terminal or read/stop-only, not a command-injection path**: `claude attach <id>` — "Open the background session in this terminal[.] ← returns to agent view, Ctrl+Z drops back to your shell. The session keeps running either way" (a human reattaches; no flag pipes text in); `claude logs <id>` — recent output only; `claude stop <id>` — stop, resumable later via `attach`. No `claude <verb>` subcommand exists to feed input into a running session from an external script. See `derived_from::[[host-agent-identification-and-control]]` and `relates_to::[[controlling-detected-claude-code-sessions]]`.

## Cross-session messaging — `SendMessage`/`ListAgents` (confirmed via Context7 + Brave Search + live socket check, 2026-09-13)

A real, first-party feature, officially documented at `code.claude.com/docs/en/cross-session-messaging`, requiring **v2.1.224+**: "Claude Code binds an inbox socket for each session with cross-session messaging enabled, where other sessions on the machine deliver messages. The socket is a Unix domain socket on macOS and Linux... and a named pipe on native Windows." `ListAgents` discovers reachable sessions (subagents, `agent-teams` teammates, other local sessions, and — over Remote Control — cloud/other-machine sessions); `SendMessage` delivers plain text to one by name. Confirmed live on the research machine: `~/.claude/sessions/<pid>.json`'s `messagingSocketPath` field points to a real, currently-open Unix domain socket at `/tmp/cc-socks/<pid>.sock` (verified via `stat.S_ISSOCK`, 12/12 checked) — this is the exact "register themselves in files on disk and bind a local inbox socket there" mechanism the docs describe, caught in the act.

Governed by the `crossSessionInbound` setting (`accept`/`hold`/`refuse`, v2.1.224+) on the **receiving** session; a `claude -p` (print-mode) session binds the same inbox socket and can receive, but can't show the approval dialog, so a held message stays held unless `crossSessionInbound: "accept"` is set explicitly. Delivery is rate-limited (repeated/identical messages throttled) with an unread-queue cap (reported as 50 messages by one source, a separate 100-message held-message cap by another — not independently confirmed against an official doc, so treat the exact numbers as approximate). Only reaches sessions visible on the **same filesystem** — a session inside a container, or across a WSL2-vs-native-Windows boundary, is unreachable even "on the same machine."

**Critically, this channel is only invocable from inside a running Claude Code process** — there is no `claude <verb>` CLI subcommand to trigger a delivery externally, and the wire protocol spoken over the Unix socket itself is not publicly documented (only the tool-level behavior and settings are). A message delivered this way is advisory text the receiver's own Claude interprets "between tool calls or starts a fresh turn if idle" — never authoritative, never a guaranteed command execution. See `relates_to::[[controlling-detected-claude-code-sessions]]` for the full implication of this for `uses::[[tmux-conductor]]`'s host-server, which is a plain Node process and cannot itself call these tools.

Underneath this command sits an **undocumented internal per-process registry**, `~/.claude/sessions/<pid>.json` (one file per live session, garbage-collected on process exit — verified zero stale entries against `kill -0`), backed by a local daemon (`~/.claude/daemon/roster.json`, `daemon.lock`, `daemon.status.json`). It carries extra fields (`updatedAt`, a `messagingSocketPath` IPC socket, `bridgeSessionId`) but is a private implementation detail that could change shape without notice — prefer `claude agents --json` over reading it directly. `~/.claude/daemon/roster.json` itself is narrower than it looks: on the research machine its `workers` dict held only the 2 background pty-host-pool sessions, not all 14 live sessions — the documented way to inspect the supervisor is `claude daemon status` ("Print the supervisor's state, version, socket directory, and worker count"), not this file.

### Official "agent view" schema and command surface (confirmed via Context7, `code.claude.com/docs/en/agent-view`, 2026-09-13)

`claude agents --json`'s documented field-presence rules: `cwd`/`kind`/`startedAt` always present; `id` only on **background** sessions; `state` only on background sessions — one of `working`/`blocked`/`done`/`failed`/`stopped`; `pid`/`status` present only **while the process is alive**; `waitingFor` present when `status` is `waiting` (`permission prompt`, `input needed`, `sandbox request`, `worker request`, `dialog open`); `sessionId`/`name` present when set. Shipped ~May 2026 (`code.claude.com/docs/en/whats-new/2026-w21`: "`claude agents --json` lists live sessions as JSON for scripting, such as status bars and session pickers").

The same feature documents a full shell control surface keyed by a background session's `id`: `claude attach <id>` (reattach in this terminal), `claude logs <id>`, `claude stop <id>` (alias `claude kill`), `claude respawn <id>` / `claude respawn --all` (restart, resuming the saved conversation or re-running the original prompt), `claude rm <id>` (remove from the list; transcript stays on disk, still usable via `claude --resume`), `claude daemon status`, `claude daemon stop --any` (`--keep-workers` leaves background sessions running for the next supervisor to reconnect to). None of this control surface applies to plain **interactive** sessions (no `id` field) — those remain detect-only from outside their own terminal/pane. See `relates_to::[[claude-code-session-discovery]]`.

### SessionEnd hook reliability (confirmed via Context7 + Brave Search, 2026-09-13)

Official `reason` enum (`code.claude.com/docs/en/hooks`): `clear`, `resume`, `logout`, `prompt_input_exit`, `other` (`bypass_permissions_disabled` removed in v2.1.234). SessionEnd hooks "have no decision control" and Claude Code "discards their JSON output fields." Default timeout 1.5s, raisable per-hook up to a 60s overall budget, or overridden via `CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS`. Real, confirmed reliability gaps beyond the timeout mechanics themselves: `anthropics/claude-code#41577` (async work inside the hook is killed before completion even with a 90s timeout configured), `#62987` (`claude rm`/`stop`/reap SIGKILLs the background session's process tree immediately with no prior SIGTERM grace, so cleanup code can't run), `#6428` (doesn't fire on `/clear` despite docs stating it should), `#17885`/`#35892` (doesn't fire on `/exit` in some versions). **Net: don't build a session registry that depends on SessionEnd firing reliably on every exit path** — pair it with independent PID-liveness verification, or prefer `claude agents --json` (which the daemon itself keeps in sync independent of hook reliability).
