# 001 — Initial Project Scaffolding

## Objective

Extract all conductor scripts from CONDUCTOR.md into real executable files, create the host-side container exec wrapper, and build a scaffold script that sets up any existing repo with a `conductor-compose.yml` and `.devcontainer/devcontainer.json` for agent orchestration.

## Approach

Scripts are extracted from CONDUCTOR.md with minimal modification. The conductor runs on the macOS host and reaches into dev containers via `docker compose exec` / `docker exec` through an `agent_exec.sh` wrapper. A new `scaffold.sh` script generates the compose file using a non-standard name (`conductor-compose.yml`) to avoid conflicts with existing project compose files, plus a matching `devcontainer.json`.

## Prerequisites

- [ ] tmux >= 3.0 installed (`brew install tmux`)
- [ ] bash >= 4.0 available (`brew install bash` on macOS)
- [ ] Docker Desktop installed (for dev container support)

---

## Steps

### 1. Create conductor.conf  <!-- agent: general-purpose -->

- [x] Create `conductor.conf` in the project root with all configuration variables <!-- Completed: 2026-04-13 -->
  - `SESSION_NAME="conductor"`
  - `AGENTS` array with example entries using `<name>:<working_dir>:<launch_cmd>` format
  - `CLEAR_CMD="/clear"`
  - `TASK_CMD="/tackle"` (default command when queue is empty)
  - `IDLE_PATTERN="^>"` (Claude Code default)
  - `POLL_INTERVAL=15`
  - `USAGE_CHECK_CMD` with Claude usage check example
  - `TASK_QUEUE="./tasks.txt"`
  - `LOG_DIR="./logs"`
  - `EXEC_MODE="local"` — new setting: `local` runs agents directly, `container` uses `agent_exec.sh` to reach into dev containers
  - `COMPOSE_FILE="conductor-compose.yml"` — the non-standard compose filename
  - `COMPOSE_SERVICE="app"` — the service name to exec into
  - Include inline comments explaining each variable

### 2. Create dispatch.sh  <!-- agent: general-purpose -->

- [x] Create `dispatch.sh` in the project root <!-- Completed: 2026-04-13 -->
  - Usage: `dispatch.sh <target> <command>`
  - Use `tmux send-keys -t "$TARGET" -l "$CMD"` (literal mode)
  - Send `Enter` as a separate `tmux send-keys` argument (never embedded)
  - Add 0.3s sleep between literal text and Enter for UI rendering
  - Log dispatch with timestamp to stdout
  - Include `set -euo pipefail` and `SCRIPT_DIR` resolution
- [x] `chmod +x dispatch.sh` <!-- Completed: 2026-04-13 -->

### 3. Create monitor.sh  <!-- agent: general-purpose -->

- [x] Create `monitor.sh` in the project root — the main polling loop <!-- Completed: 2026-04-13 -->
  - Source `conductor.conf`
  - Create timestamped log file in `$LOG_DIR`
  - Build `AGENT_NAMES` array from `AGENTS` config
  - `pop_task()` function: reads and removes first line from `$TASK_QUEUE` using `sed -i.bak` + cleanup for BSD/GNU compatibility
  - `is_idle()` function: uses `tmux capture-pane -t "$target" -p | tail -5` and greps against `$IDLE_PATTERN`
  - `check_usage()` function: evals `$USAGE_CHECK_CMD`, returns 0 (OK) or 1 (limit hit)
  - `dispatch()` function: calls `dispatch.sh` with logging
  - Main loop: sleeps `$POLL_INTERVAL`, checks for `.paused` file, iterates agents checking idle + usage, pops tasks or sends `$TASK_CMD`
  - Auto-teardown when all agents are idle AND all hit usage limits
  - Log all actions via `log()` helper (timestamps, tee to log file)
- [x] `chmod +x monitor.sh` <!-- Completed: 2026-04-13 -->

### 4. Create conductor.sh  <!-- agent: general-purpose -->

- [x] Create `conductor.sh` in the project root — the entry point <!-- Completed: 2026-04-13 -->
  - Source `conductor.conf`
  - `mkdir -p "$LOG_DIR"`
  - Print session summary (name, agent count, queue size)
  - Kill existing session if present: `tmux kill-session -t "$SESSION_NAME" 2>/dev/null || true`
  - Create session with first agent: parse `AGENTS[0]` with `IFS=:`, use `tmux new-session -d -s "$SESSION_NAME" -c "$workdir" -n "$name"`
  - If `EXEC_MODE=container`: wrap the launch command with `agent_exec.sh`
  - Send launch command via `tmux send-keys`
  - Loop remaining agents: `tmux new-window` for each
  - Create monitor window: `tmux new-window -t "$SESSION_NAME" -n "monitor"` running `monitor.sh`
  - Attach logic: if already in tmux, print `tmux switch-client` hint; otherwise `tmux attach-session`
- [x] `chmod +x conductor.sh` <!-- Completed: 2026-04-13 -->

### 5. Create spawn.sh  <!-- agent: general-purpose -->

- [x] Create `spawn.sh` in the project root — alternative split-pane layout <!-- Completed: 2026-04-13 -->
  - Same config sourcing and agent parsing as `conductor.sh`
  - Uses `tmux split-window` instead of `new-window`
  - Runs `tmux select-layout tiled` after each split to rebalance
  - Supports `EXEC_MODE=container` wrapping same as `conductor.sh`
  - Prints summary of spawned agents
- [x] `chmod +x spawn.sh` <!-- Completed: 2026-04-13 -->

### 6. Create broadcast.sh  <!-- agent: general-purpose -->

- [x] Create `broadcast.sh` in the project root <!-- Completed: 2026-04-13 -->
  - Usage: `broadcast.sh <command>`
  - Source `conductor.conf`
  - Loop all agents, parse name from each entry
  - Check pane exists with `tmux has-session` before dispatching
  - Call `dispatch.sh` for each valid agent pane
  - Print summary line
- [x] `chmod +x broadcast.sh` <!-- Completed: 2026-04-13 -->

### 7. Create teardown.sh  <!-- agent: general-purpose -->

- [x] Create `teardown.sh` in the project root <!-- Completed: 2026-04-13 -->
  - Source `conductor.conf`
  - Loop all agents, send `/exit` via `dispatch.sh` (ignore errors)
  - Wait 10 seconds for graceful exit
  - Kill tmux session: `tmux kill-session -t "$SESSION_NAME"`
  - Print status messages throughout
- [x] `chmod +x teardown.sh` <!-- Completed: 2026-04-13 -->

### 8. Create agent_exec.sh  <!-- agent: general-purpose -->

- [x] Create `agent_exec.sh` in the project root — host-side container exec wrapper <!-- Completed: 2026-04-13 -->
  - Usage: `agent_exec.sh <mode> <target> -- <cmd...>`
  - Mode `compose`: runs `docker compose -f "$COMPOSE_FILE" exec -T "$SERVICE" "$@"`
    - Accept `COMPOSE_FILE` from environment or default to `conductor-compose.yml`
  - Mode `docker`: runs `docker exec -i "$CONTAINER" "$@"`
  - Mode validation: print usage and exit 2 on unknown mode
  - Use `exec` to replace the wrapper process with the docker command
  - Include `set -euo pipefail`
- [x] `chmod +x agent_exec.sh` <!-- Completed: 2026-04-13 -->

### 9. Create scaffold.sh  <!-- agent: general-purpose -->

- [x] Create `scaffold.sh` in the project root — sets up a target project for conductor dev containers <!-- Completed: 2026-04-13 -->
  - Usage: `scaffold.sh <target-project-path> [--image <base-image>] [--service <service-name>]`
  - Defaults: image=`ubuntu:24.04`, service=`app`
  - Parse CLI arguments with a while/case loop
  - Validate target path exists and is a directory
  - Generate `<target-path>/conductor-compose.yml`:
    ```yaml
    services:
      app:
        image: ubuntu:24.04
        command: sleep infinity
        volumes:
          - .:/workspaces/project:cached
        working_dir: /workspaces/project
    ```
    - Use the provided `--image` and `--service` values
    - Map `.` to `/workspaces/<dirname>` using `basename` of the target path
  - Generate `<target-path>/.devcontainer/devcontainer.json`:
    ```json
    {
      "name": "conductor-agent",
      "dockerComposeFile": "../conductor-compose.yml",
      "service": "app",
      "workspaceFolder": "/workspaces/<dirname>",
      "postCreateCommand": "echo 'conductor devcontainer ready'",
      "customizations": { "vscode": { "extensions": [] } }
    }
    ```
    - Create `.devcontainer/` directory if it doesn't exist
    - Warn (don't overwrite) if files already exist — print message and skip unless `--force` flag is passed
  - Print summary of generated files and next-steps hint

- [x] `chmod +x scaffold.sh` <!-- Completed: 2026-04-13 -->

### 10. Create supporting files  <!-- agent: general-purpose -->

- [x] Create `tasks.txt` with example task entries: <!-- Completed: 2026-04-13 -->
  ```
  /tackle .docs/tasks/active/047.7-walk-forward-optimization.md
  Review and simplify backend/app/services/order_service.py
  ```
- [x] Create `logs/.gitkeep` so the logs directory is tracked <!-- Completed: 2026-04-13 -->
- [x] Add `logs/*.log` and `*.bak` to `.gitignore` if not already present <!-- Completed: 2026-04-13 -->

### 11. Verification  <!-- agent: general-purpose -->

- [x] Run `bash -n` syntax check on all `.sh` files (conductor.sh, spawn.sh, dispatch.sh, monitor.sh, broadcast.sh, teardown.sh, agent_exec.sh, scaffold.sh) <!-- Completed: 2026-04-13 -->
- [x] Verify all scripts have executable permission <!-- Completed: 2026-04-13 -->
- [x] Verify `conductor.conf` is valid bash (source it in a subshell) <!-- Completed: 2026-04-13 -->
- [x] Verify `scaffold.sh` runs against a temp directory and produces valid YAML and JSON output <!-- Completed: 2026-04-13 -->

---
**UAT**: [`.docs/uat/skipped/001-initial-scaffolding.uat.md`](../../uat/skipped/001-initial-scaffolding.uat.md) *(skipped)*
