# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

tmux-conductor is a vendor-agnostic system for orchestrating multiple AI coding agent instances (Claude Code, OpenAI Codex, Aider, etc.) from a single tmux session. It spawns agents in panes, detects when each finishes a task via `capture-pane` idle detection, dispatches the next command from a task queue, monitors usage limits, and tears everything down cleanly.

**Current state:** Core implementation complete. All 8 shell scripts are implemented, executable, and pass syntax checks. Design documentation (`CONDUCTOR.md` with full script specifications, `deep-research-report.md` with infrastructure research) served as the specification source.

## Architecture

- **Agent panes** (0..N-1): each runs a coding CLI in its own tmux window
- **Conductor pane** (last window): runs `monitor.sh`, polling agent panes via `capture-pane` to detect idle state
- Communication is one-way push: conductor uses `send-keys` to dispatch commands and `capture-pane` to read output
- All config lives in `conductor.conf` — agent definitions, idle patterns, usage checks, task queue path

### Core Scripts

| Script | Purpose |
|--------|---------|
| `conductor.sh` | Entry point: creates tmux session, spawns agent windows, starts monitor |
| `spawn.sh` | Alternative: split-pane layout instead of separate windows |
| `dispatch.sh` | Sends a command to a specific agent pane via `send-keys -l` + separate `Enter` |
| `monitor.sh` | Main loop: polls for idle agents, checks usage limits, pops tasks from queue |
| `broadcast.sh` | Sends a command to all agent panes |
| `teardown.sh` | Graceful shutdown: sends `/exit` to each agent, waits, kills session |
| `agent_exec.sh` | Host-side container exec wrapper (compose/docker modes) |
| `scaffold.sh` | Generates `conductor-compose.yml` + `.devcontainer/devcontainer.json` for a target project; defaults to `ghcr.io/codewizard-dt/tmux-conductor-base:latest` (override with `--image`) |
| `hooks/on-session-start.sh` | Claude Code hook — writes `idle` to `$STATE_DIR/<agent>.state` on SessionStart (matcher `startup|resume|clear`) |
| `hooks/on-prompt-submit.sh` | Claude Code hook — writes `busy` to `$STATE_DIR/<agent>.state` on UserPromptSubmit |
| `hooks/on-stop.sh` | Claude Code hook — writes `idle` to `$STATE_DIR/<agent>.state` on Stop |
| `hooks/on-stop-failure.sh` | Claude Code hook — writes `idle` to `$STATE_DIR/<agent>.state` on StopFailure (API error) |
| `hooks/install-hooks.sh` | Copies per-event hook scripts to `~/.claude/hooks/tmux-conductor/` and merge-registers them in `~/.claude/settings.json` with dedup-by-command (preserves foreign hook entries) |

### Key Design Decisions

- `send-keys -l` (literal mode) for dispatch — preserves special characters in prompts
- `Enter` is always a separate `send-keys` argument, never embedded in the string
- `sed -i.bak` + cleanup for BSD/GNU sed compatibility (macOS ships BSD sed)
- Idle detection primary signal is the per-agent state file at `$STATE_DIR/<agent>.state`. Two values: `idle` (hook-written by `on-session-start.sh` on startup/resume/clear, `on-stop.sh` on Stop, and `on-stop-failure.sh` on StopFailure) and `busy` (hook-written by `on-prompt-submit.sh` on UserPromptSubmit, and monitor-written by `mark_busy` immediately before dispatch to close the race between send-keys and the agent's first UserPromptSubmit hook fire). Monitor treats `idle` as idle and `busy` as working; any other contents fall through to the regex fallback. Each Claude Code lifecycle event has its own script in `hooks/` (on-session-start.sh, on-prompt-submit.sh, on-stop.sh, on-stop-failure.sh); `hooks/install-hooks.sh` copies them to `~/.claude/hooks/tmux-conductor/` and merges the registrations into `~/.claude/settings.json` with dedup-by-command so foreign hook entries survive.
- If the state file is missing or stale (older than `2 × POLL_INTERVAL`), monitor falls back to the `IDLE_PATTERN` regex against the last 5 lines of `capture-pane -p` — this covers Aider, Codex, Claude-without-hooks, and the Esc-interrupt case where no `Stop` hook fires
- `POLL_INTERVAL` acts as debounce to avoid false positives during agent tool calls
- Usage monitoring runs before every dispatch; when all agents hit limits, auto-teardown triggers
- Task queue supports agent-scoped entries via `agentname: command` prefix — `pop_task()` matches scoped lines first, then falls back to unscoped (global) lines
- Base image `ghcr.io/codewizard-dt/tmux-conductor-base` is rebuilt weekly (`.github/workflows/base-image.yml`) from `debian:bookworm-slim` with Chromium, Claude Code CLI, and uv preinstalled — every scaffolded project inherits fresh deps without paying the ~4 min install cost per project. Override with `scaffold.sh --image <other>`.

## Prerequisites

- tmux >= 3.0
- bash >= 4.0 (macOS default is 3.2 — use `brew install bash` or adapt for indexed arrays)
- Optional: `jq` for JSON config parsing

## Task/Doc Workflow

This repo uses a structured task lifecycle under `.docs/`:
- Tasks go in `.docs/tasks/active/` with `<NNN>-<slug>.md` naming
- UAT files go in `.docs/uat/pending/` with `<NNN>-<slug>.uat.md` naming
- Slash commands: `/add-task`, `/tackle`, `/uat-generator`, `/uat-walkthrough`, `/uat-skip`, `/trash-task`
- `/tackle` does not move task files — they stay in `active/` until UAT passes

## Shell Command Conventions

- Use plain `git log ...` and `git status ...` — never prefix with `git -C <path>`. The repo's allowlist matches `Bash(git log:*)` and `Bash(git status:*)`; adding `-C /abs/path` triggers an approval prompt every time. Rely on the working directory instead.
- **Temporary files / scratch directories on the host: ALWAYS use `./tmp/` (the repo-local `tmp/` directory). Non-negotiable, mandatory.** Never use `/tmp/`, `$TMPDIR`, `mktemp -d`, or any other system-level temp location for host-side work. `./tmp/` is gitignored, lives next to your work, and keeps fixtures/captures inspectable. **Scope:** this rule applies only to commands run on the host (your dev shell, sub-agents acting on the host, scripts executed from the project root). Inside a dev container or any generated container-init script, follow normal Unix conventions — `/tmp` there is the container's ephemeral filesystem and is the right choice.

## MCP Tool Rules

When MCP tools are available, follow `.docs/guides/mcp-tools.md`:
- Use Serena for all code exploration and editing, directory listing, and file search
- Use Context7 for library/framework documentation lookups
- Use Brave Search for general web research (sequential only, 1 req/sec)
- Standard `Read`/`Edit`/`Write` tools are permitted for markdown and config files
- Never use `sed`, `awk`, `echo >>`, or shell commands to edit any file
