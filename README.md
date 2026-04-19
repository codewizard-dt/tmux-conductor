# tmux-conductor

A vendor-agnostic system for orchestrating multiple AI coding agent instances (Claude Code, OpenAI Codex, Aider, etc.) from a single tmux session. It spawns agents in panes, detects when each finishes a task via `capture-pane` idle detection, dispatches the next command from a task queue, monitors usage limits, and tears everything down cleanly.

## Prerequisites

- **tmux** >= 3.0 (`brew install tmux` on macOS)
- **bash** >= 4.0 (macOS ships 3.2 — run `brew install bash`)
- **Docker Desktop** (only if using container execution mode)

## Quick Start

### 1. Clone the repo

```bash
git clone https://github.com/yourusername/tmux-conductor.git
cd tmux-conductor
```

### 2. Configure your agents

Edit `conductor.conf` to define your agents. Each entry uses the format `name:working_dir:launch_cmd`:

```bash
AGENTS=(
  "backend:/path/to/project:claude --dangerously-skip-permissions"
  "frontend:/path/to/project/frontend:claude --dangerously-skip-permissions"
  "tests:/path/to/project:codex --auto"
)
```

For Claude Code agents, idle detection is driven by lifecycle hooks that write `idle`/`busy` to `$STATE_DIR/<agent>.state` — no prompt regex tuning needed. For other CLIs (Codex, Aider) or when the hooks are unavailable, the monitor falls back to `IDLE_PATTERN`. Defaults:
- Claude Code: `"^>"` (fallback only)
- Codex: `"^codex>"`
- Aider: `"^aider>"`

### 3. Add tasks to the queue

Add one task per line to `tasks.txt`. Tasks can optionally be scoped to a specific agent by prefixing with the agent name:

```
backend: Refactor the authentication middleware to use JWT
frontend: Fix the login page CSS
Add unit tests for the payment service
```

- **Scoped tasks** (`backend: ...`) are only dispatched to the named agent
- **Unscoped tasks** (no prefix) go to any idle agent

When the queue is empty, agents receive `TASK_CMD` (default: `/tackle`) instead.

### 4. Launch the conductor

```bash
./scripts/conductor.sh
```

This will:
1. Create a tmux session named `conductor`
2. Open a window for each agent and start its CLI
3. Open a `monitor` window that polls for idle agents and dispatches tasks
4. Attach you to the session

If you prefer all agents in a single window with split panes:

```bash
./scripts/spawn.sh
```

### 5. Monitor and interact

Once running, the monitor automatically:
- Detects when an agent finishes (idle detection via `IDLE_PATTERN`)
- Pops the next task from `tasks.txt` and dispatches it
- Checks usage limits before each dispatch
- Triggers auto-teardown when all agents hit their usage limits

**Manual controls** (from any terminal):

```bash
# Send a command to a specific agent
./scripts/dispatch.sh conductor:backend "Review the error handling in auth.py"

# Send a command to all agents
./scripts/broadcast.sh "/clear"

# Pause the monitor (create a flag file)
touch .paused

# Resume the monitor
rm .paused
```

### 6. Shut down

```bash
./scripts/teardown.sh
```

This sends `/exit` to each agent, waits 10 seconds for graceful shutdown, then kills the tmux session.

## Container Mode (Dev Containers)

To run agents inside Docker containers instead of directly on the host:

### 1. Scaffold the target project

```bash
./scripts/scaffold.sh /path/to/your/project
```

This generates:
- `conductor-compose.yml` — Docker Compose file with a long-running container
- `.devcontainer/Dockerfile` — minimal two-layer image built on `ghcr.io/codewizard-dt/tmux-conductor-base:latest` (Chromium, Claude Code CLI, uv, nodejs, npm, python3 preinstalled); first-build completes in ~15–30s instead of ~4 min
- `.devcontainer/devcontainer.json` — VS Code Dev Container configuration
- `.devcontainer/init-claude-config.sh` — first-boot entrypoint that seeds the container's Claude config from the host (see "Shared configuration & MCPs" below)

Options:
```bash
./scripts/scaffold.sh /path/to/project --image node:20 --service myapp --force
```

### 2. Start the container

```bash
cd /path/to/your/project
docker compose -f conductor-compose.yml up -d
```

### 3. Switch to container mode

In `conductor.conf`:

```bash
EXEC_MODE="container"
COMPOSE_FILE="conductor-compose.yml"
COMPOSE_SERVICE="app"
```

### 4. Launch normally

```bash
./scripts/conductor.sh
```

The conductor will automatically wrap agent launch commands with `agent_exec.sh` to exec into the container.

### Base image

The default scaffolded Dockerfile extends `ghcr.io/codewizard-dt/tmux-conductor-base:latest`, which bundles:
- Chromium (from Debian main — no PPA, native on amd64 and arm64)
- Claude Code CLI (`~/.local/bin/claude`)
- uv (`~/.cargo/bin/uv`)
- System packages: curl, git, nodejs, npm, python3, rsync, jq, vim

This cuts per-project first-build from ~4 min to ~15–30s. The base image is rebuilt weekly (Mondays ~06:17 UTC) via `.github/workflows/base-image.yml` to pick up Chromium and apt security updates.

Override at scaffold time with `./scripts/scaffold.sh /path/to/project --image <other>`. Forks can republish the base under their own GHCR namespace and update the default `IMAGE` in `scripts/scaffold.sh`.

### Shared configuration & MCPs

Each scaffolded container bind-mounts your host's `~/.claude/` and `~/.claude.json` read-only at `/host-claude-config/`. On first boot, `init-claude-config.sh` copies them into the conductor user's home and drops a sentinel file (`~/.claude/.conductor-initialized`) so subsequent restarts short-circuit and preserve in-container state.

**Copied from the host:**
- `~/.claude.json` (user-scope MCP server registrations, settings)
- `~/.claude/settings.json`, `CLAUDE.md`, `plugins/`, and other static config

**Not copied (container-local or deliberately excluded):**
- `.credentials.json` — auth comes from `CLAUDE_CODE_OAUTH_TOKEN` in `~/.conductor_env`
- `sessions/`, `projects/`, `history.jsonl`, `shell-snapshots/`, `telemetry/`, `ide/` — live session state stays per-container

**Serena MCP** is auto-registered at project-local scope inside each container, keyed to `/workspaces/<dirname>`, so semantic code tools work out of the box without touching the host registration.

**Force a reset** of a container's config (e.g. after editing host settings you want re-synced):

```bash
docker compose -f conductor-compose.yml exec app rm /home/conductor/.claude/.conductor-initialized
docker compose -f conductor-compose.yml restart app
```

The next start will re-run the init-copy and re-register Serena.

### Host network access

From inside the scaffolded container, host services are reachable at `host.docker.internal:<port>`. The generated `conductor-compose.yml` maps this hostname to the special `host-gateway` value via `extra_hosts`, which makes the setup work identically on Linux, macOS, and Windows. On Docker Desktop (Mac/Windows) `host.docker.internal` resolves without `extra_hosts`, but the entry is included for Linux compatibility where that alias is not provided by default.

Host dev servers must bind to `0.0.0.0` (not `127.0.0.1`) to be reachable from the container — a loopback-only bind is invisible across the bridge. Examples:

```bash
astro dev --host            # Astro
vite --host 0.0.0.0         # Vite
```

Then from inside the container, hit `http://host.docker.internal:4321` (Astro default) or `http://host.docker.internal:5173` (Vite default).

## Configuration Reference

All settings live in `conductor.conf`:

| Variable | Default | Description |
|----------|---------|-------------|
| `SESSION_NAME` | `conductor` | tmux session name |
| `AGENTS` | *(example entries)* | Array of `name:working_dir:launch_cmd` |
| `CLEAR_CMD` | `/clear` | Command to clear agent context |
| `TASK_CMD` | `/tackle` | Default command when queue is empty |
| `IDLE_PATTERN` | `^>` | Fallback regex matched against last 5 lines of pane output when the hook state file is absent or stale |
| `STATE_DIR` | `./logs/state` | Directory where per-event hook scripts write per-agent `<agent>.state` files (`idle` / `busy`) |
| `POLL_INTERVAL` | `15` | Seconds between idle-detection polls; state files older than `2 × POLL_INTERVAL` are treated as stale |
| `USAGE_CHECK_CMD` | *(Claude example)* | Command that exits 0 (OK) or 1 (limit hit) |
| `TASK_QUEUE` | `./tasks.txt` | Path to task queue file (one task per line, optional `name: ` prefix for agent scoping) |
| `LOG_DIR` | `./logs` | Directory for log files |
| `EXEC_MODE` | `local` | `local` or `container` |
| `COMPOSE_FILE` | `conductor-compose.yml` | Docker Compose file for container mode |
| `COMPOSE_SERVICE` | `app` | Service name to exec into |

## Scripts

| Script | Purpose |
|--------|---------|
| `scripts/conductor.sh` | Entry point — creates tmux session with separate windows per agent |
| `scripts/spawn.sh` | Alternative entry point — split-pane layout in a single window |
| `scripts/dispatch.sh` | Send a command to a specific agent pane |
| `scripts/monitor.sh` | Main loop — idle detection, usage checks, task dispatch |
| `scripts/broadcast.sh` | Send a command to all agent panes |
| `scripts/teardown.sh` | Graceful shutdown |
| `scripts/agent_exec.sh` | Container exec wrapper (compose/docker modes) |
| `scripts/scaffold.sh` | Generate compose + devcontainer files for a target project |
| `hooks/on-session-start.js` | Claude Code hook (Node.js) — writes `idle` to agent state on SessionStart (matcher `startup|resume|clear`) |
| `hooks/on-prompt-submit.js` | Claude Code hook (Node.js) — writes `busy` to agent state on UserPromptSubmit |
| `hooks/on-stop.js` | Claude Code hook (Node.js) — writes `idle` to agent state on Stop |
| `hooks/on-stop-failure.js` | Claude Code hook (Node.js) — writes `idle` to agent state on StopFailure |
| `hooks/lib/write-state.js` | Shared stdlib-only helper — resolves agent name, drains stdin, writes `$STATE_DIR/<agent>.state` |
| `install-hooks.sh` (repo root) | Copies JS hooks plus `hooks/lib/write-state.js` into `~/.claude/hooks/tmux-conductor/` and merge-registers them in `~/.claude/settings.json` (dedup-by-command, preserves foreign hook entries) |

## How It Works

```
scripts/conductor.sh / scripts/spawn.sh
        |
        v
  ┌─────────────────────────────────┐
  │         tmux session            │
  │                                 │
  │  [agent-1] [agent-2] [agent-N] │  <-- each runs a coding CLI
  │         [monitor]               │  <-- polls agents, dispatches tasks
  └─────────────────────────────────┘
        |               ^
        | send-keys     | capture-pane
        v               |
   ┌──────────┐    ┌──────────┐
   │ dispatch  │    │  idle    │
   │ command   │    │ detect   │
   └──────────┘    └──────────┘
```

1. **Spawn**: `scripts/conductor.sh` creates a tmux session with one window per agent, plus a monitor window
2. **Poll**: `scripts/monitor.sh` checks each agent's pane output every `POLL_INTERVAL` seconds
3. **Detect**: When an agent's last 5 lines match `IDLE_PATTERN`, it's considered idle
4. **Dispatch**: The monitor pops the next task from `tasks.txt` and sends it via `scripts/dispatch.sh`
5. **Repeat**: The cycle continues until the queue is empty and all agents are idle
6. **Teardown**: Auto-triggers when all agents hit usage limits, or run `./scripts/teardown.sh` manually

## How idle detection works

```
Claude Code → hook → $STATE_DIR/<agent>.state → monitor.sh
```

For Claude Code agents, per-event Node.js hook scripts in `hooks/` are wired into Claude's lifecycle events: `on-session-start.js` writes `idle` on `SessionStart` (matcher `startup|resume|clear`), `on-prompt-submit.js` writes `busy` on `UserPromptSubmit`, `on-stop.js` writes `idle` on `Stop`, and `on-stop-failure.js` writes `idle` on `StopFailure` (API error); they share stdlib-only logic via `hooks/lib/write-state.js`. `install-hooks.sh` at the repo root copies the JS hooks plus the shared lib into `~/.claude/hooks/tmux-conductor/` and merge-registers them in `~/.claude/settings.json` with dedup-by-command so any pre-existing foreign hook entries survive — called automatically by the container's init script. The monitor reads `$STATE_DIR/<agent>.state` each poll and considers an agent idle only when it contains `idle`. `busy` is always trusted regardless of file age — a long-running task must never be re-dispatched just because the state file is old; only `on-stop.js` clears it. `idle` is only trusted when fresh (younger than `2 × POLL_INTERVAL`); a stale `idle` means the agent may have crashed after going idle without a `Stop` hook firing. The `CONDUCTOR_AGENT_NAME` environment variable tells the hooks which file to write; `scaffold.sh` bakes this in per container (default: target directory basename, overridable via `--agent-name`). If the state file is missing, the `idle` state is stale, or the file contains an unknown value, the monitor falls back to matching `IDLE_PATTERN` against the pane's `capture-pane` output — this covers Aider/Codex (no hook), any Claude instance running without the hook, and the Esc-interrupt case where no `Stop` event fires.

Monitor also writes `busy` itself (via `mark_busy`) immediately before sending a new task to an agent. This closes a race window: after `dispatch.sh` sends the task but before the agent's `UserPromptSubmit` hook fires and writes `busy`, the state file still holds `idle` — without this pre-emptive write, the next poll would see `idle` and incorrectly double-dispatch. The hook overwrites the same `busy` value within milliseconds under normal conditions.
