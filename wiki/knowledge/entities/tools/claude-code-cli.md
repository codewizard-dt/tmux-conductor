---
id: claude-code-cli
title: Claude Code CLI
aliases: [claude, Claude Code]
updated: 2026-09-04
sources:
  - ../../../raw/research/claude-usage-quota-signal/index.md
  - ../../../raw/research/terminal-keyboard-clipboard/index.md
  - ../../../raw/research/context-window-accuracy/index.md
  - ../../../raw/research/stop-hook-subagent-detection/index.md
  - ../../../raw/research/bug-0001-background-agent-detection/index.md
confidence: extracted
tags: [claude-code, cli]
---

# Claude Code CLI

Anthropic's agentic coding CLI (`claude`), installed at v2.1.233 as of this research. Full command surface (`claude --help`): `agents`, `auth`, `auto-mode`, `doctor`, `gateway`, `import`, `install`, `mcp`, `plugin|plugins`, `project`, `setup-token`, `ultrareview`, `update|upgrade` — **no `usage` subcommand exists**. Invoking `claude usage` (or any unrecognized word) falls through to the `[prompt]` positional argument and launches a full interactive agentic turn, not a status check — this was the root cause of a real bug in `uses::[[tmux-conductor]]`'s `USAGE_CHECK_CMD` (see `derived_from::[[claude-usage-quota-signal]]`).

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
