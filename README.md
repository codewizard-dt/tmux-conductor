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

Adjust `IDLE_PATTERN` to match your agent's prompt. Defaults:
- Claude Code: `"^>"`
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
./conductor.sh
```

This will:
1. Create a tmux session named `conductor`
2. Open a window for each agent and start its CLI
3. Open a `monitor` window that polls for idle agents and dispatches tasks
4. Attach you to the session

If you prefer all agents in a single window with split panes:

```bash
./spawn.sh
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
./dispatch.sh conductor:backend "Review the error handling in auth.py"

# Send a command to all agents
./broadcast.sh "/clear"

# Pause the monitor (create a flag file)
touch .paused

# Resume the monitor
rm .paused
```

### 6. Shut down

```bash
./teardown.sh
```

This sends `/exit` to each agent, waits 10 seconds for graceful shutdown, then kills the tmux session.

## Container Mode (Dev Containers)

To run agents inside Docker containers instead of directly on the host:

### 1. Scaffold the target project

```bash
./scaffold.sh /path/to/your/project
```

This generates:
- `conductor-compose.yml` — Docker Compose file with a long-running container
- `.devcontainer/devcontainer.json` — VS Code Dev Container configuration

Options:
```bash
./scaffold.sh /path/to/project --image node:20 --service myapp --force
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
./conductor.sh
```

The conductor will automatically wrap agent launch commands with `agent_exec.sh` to exec into the container.

## Configuration Reference

All settings live in `conductor.conf`:

| Variable | Default | Description |
|----------|---------|-------------|
| `SESSION_NAME` | `conductor` | tmux session name |
| `AGENTS` | *(example entries)* | Array of `name:working_dir:launch_cmd` |
| `CLEAR_CMD` | `/clear` | Command to clear agent context |
| `TASK_CMD` | `/tackle` | Default command when queue is empty |
| `IDLE_PATTERN` | `^>` | Regex matched against last 5 lines of pane output |
| `POLL_INTERVAL` | `15` | Seconds between idle-detection polls |
| `USAGE_CHECK_CMD` | *(Claude example)* | Command that exits 0 (OK) or 1 (limit hit) |
| `TASK_QUEUE` | `./tasks.txt` | Path to task queue file (one task per line, optional `name: ` prefix for agent scoping) |
| `LOG_DIR` | `./logs` | Directory for log files |
| `EXEC_MODE` | `local` | `local` or `container` |
| `COMPOSE_FILE` | `conductor-compose.yml` | Docker Compose file for container mode |
| `COMPOSE_SERVICE` | `app` | Service name to exec into |

## Scripts

| Script | Purpose |
|--------|---------|
| `conductor.sh` | Entry point — creates tmux session with separate windows per agent |
| `spawn.sh` | Alternative entry point — split-pane layout in a single window |
| `dispatch.sh` | Send a command to a specific agent pane |
| `monitor.sh` | Main loop — idle detection, usage checks, task dispatch |
| `broadcast.sh` | Send a command to all agent panes |
| `teardown.sh` | Graceful shutdown |
| `agent_exec.sh` | Container exec wrapper (compose/docker modes) |
| `scaffold.sh` | Generate compose + devcontainer files for a target project |

## How It Works

```
conductor.sh / spawn.sh
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

1. **Spawn**: `conductor.sh` creates a tmux session with one window per agent, plus a monitor window
2. **Poll**: `monitor.sh` checks each agent's pane output every `POLL_INTERVAL` seconds
3. **Detect**: When an agent's last 5 lines match `IDLE_PATTERN`, it's considered idle
4. **Dispatch**: The monitor pops the next task from `tasks.txt` and sends it via `dispatch.sh`
5. **Repeat**: The cycle continues until the queue is empty and all agents are idle
6. **Teardown**: Auto-triggers when all agents hit usage limits, or run `./teardown.sh` manually
