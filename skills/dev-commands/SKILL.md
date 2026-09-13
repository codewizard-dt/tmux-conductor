---
name: dev-commands
description: Query registered background dev processes (list/status/tail) to check if shared infrastructure like dev servers are running and inspect their recent output
category: tooling
argument-hint: "{list|status|tail} [options]"
disable-model-invocation: true
user-invocable: true
---

# Background Dev Process Commands

## What are background dev processes?

In tmux-conductor, **background dev processes** (often abbreviated "bg processes") are long-running services like `npm run dev`, `make dev`, or any build/server command that the conductor spawns and monitors in separate tmux windows alongside coding agents.

Each process has:
- **A registered name** (e.g., `npm-dev`, `vite-frontend`)
- **A state file** (idle/busy/running — written by poll loops)
- **A log file** (capturing recent output via `pipe-pane`)
- **A tmux window** (the live process; may exit if the service crashes)

## When to use this tool

Reach for `dev-commands` whenever you need to answer one of these questions before proceeding with a task:

- **"Is the dev server running?"** → `dev-commands.sh list`
- **"Did the build just complete, or is it still compiling?"** → `dev-commands.sh status <name>`
- **"What was the last error the formatter printed?"** → `dev-commands.sh tail <name> -n 20`
- **"The test agent said it can't import a module. Is that because the dev server crashed?"** → `dev-commands.sh tail <name>` + compare with live status

This is especially useful when **multiple agents are working in the same project** and sharing dev infrastructure. One agent can query what another agent's background service is doing without having to guess from error messages or try-fail-retry cycles.

## Usage

### List all registered processes

```bash
dev-commands.sh list
```

Shows all registered background processes along with their current state (idle/busy/running) and whether their tmux window is still alive. Gracefully falls back to filesystem state if the host-server is unreachable.

### Check a specific process's status

```bash
dev-commands.sh status <name>
```

Prints two pieces of information:

1. **State file** (poll-lagged) — the last-written state (idle/busy/etc.), labeled as potentially stale by up to one poll interval
2. **Live window status** — whether the tmux window is still present (from the host-server if reachable, or "unavailable" if offline)

Together, these signals let you distinguish between "the process exited" and "the state file hasn't been updated yet."

Example:

```bash
$ dev-commands.sh status npm-dev
State file (bg-npm-dev.state, may lag up to one poll interval):
  running

Live window status (from host-server):
  windowPresent: true
```

### Tail a process's log

```bash
dev-commands.sh tail <name> [-n N]
```

Print the last N lines (default 50) of the process's output log. The log captures what the process printed to stdout/stderr via `pipe-pane`.

Example:

```bash
dev-commands.sh tail npm-dev -n 100   # Last 100 lines
dev-commands.sh tail npm-dev          # Last 50 lines (default)
```

## Environment setup

These commands require two environment variables to be set:

- `CONDUCTOR_STATE_DIR` — where the state files live (e.g., `./logs/state`)
- `CONDUCTOR_LOG_DIR` — where the log files live (e.g., `./logs`)

**These are set automatically** by `conductor.sh` and `spawn.sh` when they launch agents; you only need to set them manually if running `dev-commands.sh` from a shell outside the conductor environment.

If either variable is missing, the script will print a clear `FATAL:` error message and exit.

## Offline resilience

If the host-server is unreachable:

- **`list`** falls back to globbing state files and printing their contents (no live `windowPresent` check, but process names and states are still visible)
- **`status`** still shows the state file; the "live window status" line will note the host-server is unreachable
- **`tail`** is unaffected — it reads the log file directly, no host-server dependency

This means you can always inspect process output and state even if the conductor's API is temporarily down.

## Notes

- **Missing process**: If you ask for a process name that isn't registered yet, you'll get a clear message, not a raw shell error.
- **Missing log file**: Some processes may not have printed anything yet (or the log was rotated). The script will say so clearly.
- **jq optional**: If `jq` is not installed, `list` falls back to simple text output of state files instead of parsing the JSON API response.
