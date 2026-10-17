---
name: dev-commands
description: Query registered background dev processes (list/status/tail) to check if shared infrastructure like dev servers are running (liveness running/exited/stopped) and inspect their recent clean output, and restart a crashed or wedged process in your own project (restart)
argument-hint: "{list|status|tail|restart} [options]"
disable-model-invocation: false
user-invocable: true
---

# Background Dev Process Commands

## What are background dev processes?

In tmux-conductor, **background dev processes** (often abbreviated "bg processes") are long-running services like `npm run dev`, `make dev`, or any build/server command that the conductor spawns and monitors in separate tmux windows alongside coding agents.

Each process has:
- **A slug** — `<projectName>-<name>` (e.g., project `tmux-conductor` + process `dev` gives `tmux-conductor-dev`). Names are unique per project, so two projects can each own a `dev` process; the slug is the identity used for the tmux window, `bg-<slug>.state`/`bg-<slug>.log`, and the `/bg-processes/:slug` API routes
- **A state file** (`running` / `exited` / `dead`, written by the conductor's poll loop, so it can lag by up to one poll interval)
- **A log file** (capturing recent output via `pipe-pane`)
- **A tmux window** (the live process; may exit if the service crashes)

**Liveness vocabulary.** The host-server reports each process as `running`, `exited` or `stopped`; this is the authoritative signal, and the one to trust over the state file:

- `running` — the window is open and the process is alive in it.
- `exited` — the window is still open, but the process is gone (it crashed or finished) and the pane is back at a shell prompt. Read `tail`, then consider `restart`.
- `stopped` — there is no tmux window at all. `restart` will start it.

The state file uses `running` / `exited` / `dead` (`dead` = window not found, the state-file counterpart of `stopped`). It is written by a poll loop, so it can trail reality; a state file that still says `running` for a crashed process is the classic stale-signal trap, which is why `status` puts liveness first. Older state files may still hold `alive`, `idle` or `busy` (from before this vocabulary); read them as legacy values.

## When to use this tool

Reach for `dev-commands` whenever you need to answer one of these questions before proceeding with a task:

- **"Is the dev server running?"** → `dev-commands.sh list` (shows your own project's processes; `dev-commands.sh list --all` shows every project's), then `dev-commands.sh status <slug>` for the liveness
- **"Did the build just complete, or is it still compiling?"** → `dev-commands.sh tail <slug>` (`status` tells you whether the process is alive, not what it is doing)
- **"What was the last error the formatter printed?"** → `dev-commands.sh tail <slug> -n 20`
- **"The test agent said it can't import a module. Is that because the dev server crashed?"** → `dev-commands.sh tail <slug>` + compare with live status
- **"The dev server crashed. Can I bring it back?"** → diagnose first with `status` and `tail`, then `dev-commands.sh restart <name>` (your own project's processes only; see "Restart a process")

This is especially useful when **multiple agents are working in the same project** and sharing dev infrastructure. One agent can query what another agent's background service is doing without having to guess from error messages or try-fail-retry cycles.

## Usage

### List registered processes

```bash
dev-commands.sh list          # your project's processes (default)
dev-commands.sh list --all    # every project's processes
```

Each line shows the process slug, its liveness, its state-file value, and whether its tmux window is still alive (`<slug> — liveness: <running|exited|stopped|unknown>, state: <state>, window: <true|false>`). `liveness: unknown` means the host-server predates liveness reporting; use `window` and `status` then. Offline lines carry only the state file (`<slug> — state: <state>`).

**Default scope is your project.** The host-server resolves your project from your agent identity: `CONDUCTOR_AGENT_NAME` (your tmux window name) is sent as the `X-Conductor-Agent` header to `GET /api/agents/whoami`, and `list` keeps only the processes of that project. The output starts with `Background processes for project <name> (use --all for every project):`.

**`--all`** lists every project's processes under `Background processes (all projects):` and appends `, project: <name>` to each line.

**Fallback to all projects.** If your project cannot be resolved, `list` shows every project instead of failing, and prints `Note: could not resolve your project (<reason>); showing all projects.` on stderr. Reasons include: `CONDUCTOR_AGENT_NAME` is not set, the agent name is unknown or ambiguous, the agent has no project, the host-server did not answer `whoami`, or `jq` is not installed.

Agent identity is self-declared: `CONDUCTOR_AGENT_NAME` is a convenience for scoping the output, not authentication. Anyone can set it to another agent's name, and `--all` is always available.

An unknown option (for example `list --bogus`) prints `Unknown option: --bogus` and the usage line `Usage: dev-commands.sh list [--all]`, and exits 1. If the host-server is unreachable, `list` falls back to filesystem state (see Offline resilience below).

### Slugs and bare names

`status`, `tail` and `restart` take a slug and resolve a bare `<name>` the same way, so `status dev`, `tail dev` and `restart dev` always mean the same process: an exact slug wins; otherwise a bare name is matched within **your own project**; otherwise a bare name matching exactly one process machine-wide is used. If several match, the script lists the candidates on stderr and exits 2 for `status`/`tail` (1 for `restart`, see "Restart a process"); re-run with the full slug. An unknown argument exits 1 and prints the closest registered slugs. When the host-server is unreachable there is no project to consult, so a bare name is matched against the registered state-file names only.

### Check a specific process's status

```bash
dev-commands.sh status <slug>
```

Asks the host-server first and prints:

1. **Liveness** — `running`, `exited` or `stopped` (see "Liveness vocabulary" above); the authoritative signal
2. **Window** — `present` or `absent`
3. **Last restart** — when and by whom the process was last restarted (`by the dashboard` when a person clicked restart; `never` when no restart is on record). Omitted by a host-server that predates restart tracking
4. **State file** — the poll-lagged state value, labeled as up to one poll interval old

followed by one plain sentence interpreting the liveness: `exited` means "the process is not running (window is at a shell prompt); check `tail`, then `restart` if appropriate", and `stopped` means "no tmux window; `restart` will start it". `status` exits 0 whenever the process is found, even when it has exited (the exit code reports the lookup, not the process's health; read the `liveness:` line), and exits 1 for an unknown name, listing the closest slugs. It works even when no state file exists, because the host-server knows every registered process.

Example (a crashed dev server that fell back to a shell prompt):

```bash
$ dev-commands.sh status tmux-conductor-dev
tmux-conductor-dev (project tmux-conductor)
  liveness:     exited
  window:       present
  last restart: 2026-09-20T09:00:00.000Z by tmux-conductor-agent2
  state file:   running  (poll-lagged, may be up to one poll interval old)
The process is not running (window is at a shell prompt); check 'tail', then 'restart' if appropriate.
```

Note how the state file still says `running` while liveness says `exited`: trust `liveness`. A host-server that predates liveness reporting prints `liveness:     unknown (host-server predates liveness reporting)` and you fall back to the `window:` line.

If the host-server is unreachable (or `jq` is missing), `status` prints the state file instead, with its meaning (`running` = alive at the last poll; `exited` = window open but the process gone; `dead` = window not found; anything else is flagged `(legacy value)`) and `Live cross-check unavailable (...)`. A state file can only be as fresh as the last poll, so treat offline `running` with suspicion.

### Tail a process's log

```bash
dev-commands.sh tail <slug> [-n N]
```

Print the last N lines (default 50, maximum 1000) of the process's output. `N` must be a positive integer (anything else is a usage error, exit 1); a larger value is clamped to 1000 with a note on stderr. The output is served by the host-server as clean text: terminal escape sequences are stripped, `\r` progress redraws are collapsed to their final state, and a `--- restart <ts> ---` marker separates output from before and after a restart. A registered process that has not printed anything yet prints `(no output yet for <slug>)` and exits 0; an unknown process exits 1 with the closest slugs.

Example:

```bash
dev-commands.sh tail tmux-conductor-dev -n 100   # Last 100 lines
dev-commands.sh tail tmux-conductor-dev          # Last 50 lines (default)
```

The output may contain secrets a dev server printed (tokens, connection strings); do not paste it into places where that matters.

### Restart a process

```bash
dev-commands.sh restart <name>
```

Restarts a background process in its tmux window. `<name>` is a slug (as printed by `list`) or a bare process name. Resolution order: an exact slug wins; otherwise a bare name is matched within **your own project** (so `restart dev` never touches another project's `dev`); otherwise a bare name that matches exactly one process machine-wide is used. If several match, the candidates are listed on stderr and the script exits 1; re-run with the full slug. When `jq` is not installed, only an exact slug is accepted (no bare-name or project-scoped matching) and the script says so on stderr.

`restart` is a thin client over `POST /api/bg-processes/<slug>/restart`. The host-server owns every safety rule: the same-project guard, the restart cooldown, and the audit log (`CONDUCTOR_AGENT_NAME` is sent as the `X-Conductor-Agent` header so the restart is attributed to you). The script never runs tmux itself and never retries, and there is no confirmation prompt.

Example (success, exit 0):

```bash
$ dev-commands.sh restart dev
Resolved 'dev' to 'tmux-conductor-dev'
Restarted tmux-conductor-dev at 2026-09-20T10:11:12.345Z. Use 'dev-commands.sh tail tmux-conductor-dev' to watch it come back up.
```

Example (cooldown, exit 5):

```bash
$ dev-commands.sh restart tmux-conductor-dev
Restart skipped: tmux-conductor-dev was restarted 12s ago by tmux-conductor-agent2. Retry in 48s (or check its output with 'tail' first).
Do NOT retry in a loop: the cooldown exists to stop restart loops. Check 'dev-commands.sh tail tmux-conductor-dev' and wait.
```

Example (refused, exit 3):

```bash
$ dev-commands.sh restart other-project-dev
Refused: other-project-dev belongs to project 7, you are in project 3 (or your agent identity could not be resolved).
Server said: restart denied: project-mismatch
Do not retry; only processes in your own project can be restarted.
```

Exit codes:

| Code | Meaning | What to do |
|------|---------|------------|
| 0 | Restarted | `tail <slug>` to watch it come back up, then verify with `status` |
| 1 | Usage error, no such process, or ambiguous bare name | Check the name against `list`; use the full slug |
| 2 | Host-server unreachable | `restart` needs the host-server and has no offline fallback; tell the user |
| 3 | Refused: the process belongs to a different project, or your agent identity could not be resolved | Do not retry; tell the user |
| 4 | The conductor tmux session is not running | Nothing to restart; tell the user |
| 5 | Cooldown: the process was restarted too recently | Do not retry in a loop; `tail` it and wait the `retryAfterS` shown |
| 6 | Restart failed on the server, or an unexpected response | Report the printed error and step to the user |

**When to restart.** Restart only when your own diagnosis via `status` and `tail` says the process has exited or is wedged (for example, no output and an unresponsive port), not merely slow (a build still compiling, a dev server reloading after your edit).

**Etiquette:**

- Check `tail` first: the last lines usually say why it stopped, and a restart will not fix a config or code error you can fix yourself.
- Restart once, then observe with `tail` and `status`. Never loop or poll `restart`.
- Another agent sharing the project may already have restarted it; a cooldown (exit 5) or a fresh log marker means someone did, so look before acting again.
- Only your own project's processes can be restarted. A refusal (exit 3) is final; report it to the user instead of working around it.

## Environment setup

These commands require two environment variables to be set:

- `CONDUCTOR_STATE_DIR` — where the state files live (e.g., `./logs/state`)
- `CONDUCTOR_LOG_DIR` — where the log files live (e.g., `./logs`)

**These are set automatically** by `conductor.sh` and `spawn.sh` when they launch agents; you only need to set them manually if running `dev-commands.sh` from a shell outside the conductor environment.

If either variable is missing, the script will print a clear `FATAL:` error message and exit.

One further variable is optional:

- `CONDUCTOR_AGENT_NAME` — your agent's tmux window name (`<projectName>-<name>`), set by the conductor when it spawns your agent. `list` uses it to default to your project; without it, `list` shows all projects and prints a note on stderr.

## Offline resilience

If the host-server is unreachable:

- **`list`** falls back to globbing state files and printing their contents (no live `windowPresent` check, but process slugs and states are still visible). State files carry no project field, so offline `list` lists every state file and cannot filter by project; without `--all` it prints `Note: host-server unreachable; using offline state files instead. (cannot filter by project offline)` on stderr. The offline header is `Background processes (from state files):`
- **`status`** still shows the state file (with its meaning, in the `running`/`exited`/`dead` vocabulary) but has no liveness; the cross-check line says `Live cross-check unavailable (host-server unreachable)`. The state file is poll-lagged, so it can say `running` for a process that has already crashed
- **`tail`** still works: it falls back to reading the log file directly (`bg-<slug>.log`), prints `Note: host-server unreachable; showing the raw log with a best-effort escape strip.` on stderr, and strips the common escape sequences (colours, cursor moves, window titles, `\r` redraws) with `sed`. This is best-effort: it has no restart markers and can miss unusual sequences, unlike the server-cleaned output
- **`restart`** needs the host-server and has no offline fallback: if it cannot be reached, the script prints `Cannot reach the conductor host-server on port <BACKEND_PORT>; restart needs it (there is no offline fallback).` and exits 2

This means you can still inspect process output and the last-known state even if the conductor's API is temporarily down; only liveness and `restart` need the host-server.

## Notes

- **Missing process**: If you ask for a process that isn't registered yet, you'll get a clear message (plus the closest registered slugs), not a raw shell error.
- **Missing log file**: A registered process that has not printed anything yet prints `(no output yet for <slug>)` (online). Offline, a missing log file is reported as `No log file for '<name>'`.
- **jq optional**: If `jq` is not installed, `list` falls back to simple text output of state files instead of parsing the JSON API response. Like the offline path, this cannot filter by project, so it lists every state file and prints a note on stderr.
