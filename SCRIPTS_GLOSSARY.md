# Scripts Glossary

Master reference for every script in the tmux-conductor and tmux-agent-status repositories. Each entry includes the script's purpose and a **going-forward status** indicating whether it is needed in the current, container-free workflow.

## Going-forward status key

| Status | Meaning |
|--------|---------|
| **Essential** | Required for normal operation; do not remove |
| **Useful** | Not required but provides convenience; keep unless actively removing |
| **Active (ROADMAP-001)** | Under active development; will be Essential on completion |
| **Optional (SSH use only)** | Only needed for remote/SSH agent tracking |
| **Archived — Docker era** | Moved to `.archive/`; kept for reference only. Superseded by local-agent model |
| **Reference only** | Not installed or executed; kept for historical context |
| **Reference (dev/demo)** | Used during development or demo recording, not at runtime |
| **Test** | Integration test only; not used at runtime |

---

## tmux-conductor

Source: `/Users/davidtaylor/Repositories/tmux-conductor`

### Orchestration scripts (`scripts/`)

| Script | Purpose | Going forward? |
|--------|---------|----------------|
| `scripts/conductor.sh` | **Entry point.** Creates the tmux session named `$SESSION_NAME`, spawns one window per `AGENTS` entry, spawns one window per `BG_PROCESSES` entry (host-side, no env prefix), then opens the `monitor` window. | **Essential** |
| `scripts/spawn.sh` | **Split-pane layout alternative.** Identical to `conductor.sh` except agents and BG_PROCESSES share a single window with `split-window` + `select-layout tiled` instead of separate windows. | **Essential** |
| `scripts/monitor.sh` | **Main polling loop.** Every `POLL_INTERVAL` seconds: reads each agent's state file (`$STATE_DIR/<agent>.state`); falls back to `IDLE_PATTERN` regex when the file is missing or stale. On idle: checks usage, pops a task from `TASK_QUEUE` (scoped first, then global), writes `busy` to the state file, calls `dispatch.sh`. Emits one JSONL record to `dispatch.jsonl` per dispatch. Triggers `teardown.sh` when all agents are idle and all usage limits are hit. | **Essential** |
| `scripts/dispatch.sh` | **Low-level pane sender.** Accepts `<target> <command>`. Uses `tmux send-keys -l` (literal mode) to type the command, then a separate `Enter` keypress. Called by `monitor.sh`, `broadcast.sh`, and `teardown.sh`. | **Essential** |
| `scripts/broadcast.sh` | **Fan-out helper.** Iterates over every `AGENTS` entry and calls `dispatch.sh` for each pane that currently exists. Useful for sending `/clear`, `/status`, or any command to all agents at once. | **Useful** |
| `scripts/teardown.sh` | **Graceful shutdown.** Sends `/exit` to each agent via `dispatch.sh`, sends `C-c` to each `BG_PROCESSES` window, sleeps ~10 seconds, then runs `tmux kill-session`. | **Essential** |
| `scripts/add-task.sh` | **Queue enqueuer.** Appends `<cwd-basename>: <cmd>` to `tasks.txt`. Prompts to register the agent in `conductor.conf` if not already present. Intended to be run (or aliased) from within the target project directory. | **Useful** |

### Dashboard server (`scripts/dashboard/server/`)

These files implement the Fastify HTTP API backing the Astro+React dashboard from ROADMAP-001. They are being actively developed and will be Essential on completion.

| Script | Purpose | Going forward? |
|--------|---------|----------------|
| `scripts/dashboard/server/index.js` | **HTTP server.** Fastify app exposing `GET /status` (per-agent state + queue lengths), `GET|POST /queue/:agent` (task queue CRUD), `PUT /queue/:agent/reorder`, `DELETE /queue/:agent/:index`, `POST /agents` (spawn new agent), `GET /events` (SSE live state stream), `GET /healthz`. | **Active (ROADMAP-001)** |
| `scripts/dashboard/server/config.js` | **Config reader.** Parses `conductor.conf` via regex, extracts `SESSION_NAME`, `TASK_QUEUE`, `STATE_DIR`, and `AGENTS` array. Exports `readConductorConf()` and `appendAgentToConf()`. | **Active (ROADMAP-001)** |
| `scripts/dashboard/server/state.js` | **State reader.** Exports `readAgentState()` (reads `<agent>.state` file), `countQueuedTasks()`, `isTmuxWindowPresent()`, `readQueue()`, `writeQueue()`, `getAgentLines()`. | **Active (ROADMAP-001)** |

### Archived scripts (`scripts/.archive/`)

Moved out of active rotation as part of ROADMAP-001 (local-agent model). Preserved for reference.

| Script | Purpose | Going forward? |
|--------|---------|----------------|
| `scripts/.archive/scaffold.sh` | Generated `devcontainer-compose.yml` and `.devcontainer/devcontainer.json` in a target project directory for Docker-based agent containers. Required `ghcr.io/codewizard-dt/tmux-conductor-base` base image. | **Archived — Docker era** |
| `scripts/.archive/agent_exec.sh` | Wrapped `docker compose exec` or `docker exec` to run a command inside a named container. Used by the old container-mode dispatch path. | **Archived — Docker era** |

### Claude Code hooks (`hooks/`)

These scripts implement the idle/busy state machine that `monitor.sh` depends on. They are installed to `~/.claude/hooks/tmux-conductor/` by `install-hooks.sh`.

| Script | Purpose | Going forward? |
|--------|---------|----------------|
| `hooks/on-session-start.js` | Writes `idle` to `$STATE_DIR/<agent>.state` when Claude Code fires `SessionStart` (matched: `startup\|resume\|clear`). | **Essential** |
| `hooks/on-prompt-submit.js` | Writes `busy` to `$STATE_DIR/<agent>.state` on `UserPromptSubmit`. | **Essential** |
| `hooks/on-stop.js` | Writes `idle` on `Stop`. | **Essential** |
| `hooks/on-stop-failure.js` | Writes `idle` on `StopFailure` (API error). | **Essential** |
| `hooks/lib/write-state.js` | Shared helper sourced by all four hook scripts. Resolves the agent name from `CONDUCTOR_AGENT_NAME` env, drains stdin, writes the state value, and appends a JSONL record to `$CONDUCTOR_LOG_DIR/hooks.jsonl`. | **Essential** |
| `hooks/register-hooks.jq` | jq program invoked by `install-hooks.sh`. Deduplicates and merges the four hook registrations into `~/.claude/settings.json` while preserving foreign entries. | **Essential** |
| `hooks/.bash-backup/on-session-start.sh` | Original Bash version of the SessionStart hook (pre-task-011). | **Reference only** |
| `hooks/.bash-backup/on-prompt-submit.sh` | Original Bash version of the UserPromptSubmit hook. | **Reference only** |
| `hooks/.bash-backup/on-stop.sh` | Original Bash version of the Stop hook. | **Reference only** |
| `hooks/.bash-backup/on-stop-failure.sh` | Original Bash version of the StopFailure hook. | **Reference only** |

### Root scripts

| Script | Purpose | Going forward? |
|--------|---------|----------------|
| `install-hooks.sh` | Copies the four JS hook scripts and `lib/write-state.js` to `~/.claude/hooks/tmux-conductor/`, then runs `register-hooks.jq` via `jq` to merge registrations into `~/.claude/settings.json`. Idempotent; safe to re-run. Supports `--hook-dir`, `--settings-file`, and `--install-dir` overrides for testing. | **Essential** |

---

## tmux-agent-status

Source: `/Users/davidtaylor/Repositories/tmux-agent-status`

No Docker scripts exist in this repo — all scripts are container-free.

### Core daemons

| Script | Purpose | Going forward? |
|--------|---------|----------------|
| `scripts/sidebar-collector.sh` | **Singleton data daemon.** Runs one instance per tmux server. Sources `lib/collect.sh` to scan all tmux sessions, processes, and status files. Writes a shared binary cache (`~/.cache/tmux-agent-status/.sidebar-cache`) that all sidebar pane renderers read. Exits if another instance is already running. | **Essential** |
| `smart-monitor.sh` | **SSH + wait-timer daemon.** Monitors remote SSH sessions and active wait timers. Polls on a short interval only when either condition is active; exits when neither is present. Ensures remote state files and expired wait timers are cleaned up. | **Essential** |
| `scripts/daemon-monitor.sh` | **Watchdog.** Ensures `smart-monitor.sh` is always running. Called from tmux hooks. Uses a PID file to skip if already monitoring. | **Essential** |

### Display

| Script | Purpose | Going forward? |
|--------|---------|----------------|
| `scripts/sidebar.sh` | **Persistent sidebar TUI.** Renders the hierarchical session/window/pane status list in a dedicated tmux pane. Reads the collector cache, handles keyboard and mouse input (close, park, wait, reset), signals the collector when data changes. Registers itself as a sidebar client via `lib/sidebar-clients.sh`. | **Essential** |
| `scripts/status-line.sh` | **Status bar generator.** Outputs a compact status string (`⚡ 3 working ⏸ 1 waiting ✓ 2 done`) for the tmux status bar. Reads from the collector's status-line cache file when the daemon is running; falls back to a direct scan otherwise. | **Essential** |
| `scripts/hook-based-switcher.sh` | **fzf popup switcher.** Presents a hierarchical list of sessions, windows, and panes with status icons. Supports `Enter` (switch), `Tab` (expand/collapse), `Ctrl-X` (close), `Ctrl-P` (park), `Ctrl-W` (wait), `Ctrl-R` (reset). | **Essential** |
| `scripts/sidebar-toggle.sh` | **Sidebar toggle.** Creates the sidebar pane if absent, focuses it if present, kills it if it already has focus. Bound to `prefix + o` by default. | **Essential** |
| `scripts/sidebar-signal.sh` | **Refresh signal sender.** Sends `USR1` (full refresh) or `USR2` (animation tick) to all registered sidebar client panes. Also supports `collect` mode (touches `REFRESH_FILE` to wake the collector). | **Essential** |
| `scripts/window-wrapper.sh` | **Window-mode switcher.** Opens `hook-based-switcher.sh` in a dedicated tmux window instead of a popup, then kills the window after selection. Alternative for setups where popups are not preferred. | **Useful** |
| `scripts/preview-helper.sh` | **Switcher preview.** Generates the fzf right-pane preview content for a given target: shows agent status, queued tasks, or pane title depending on target type. | **Useful** |
| `scripts/play-sound.sh` | **Notification sounds.** Reads `@agent-notification-sound` from tmux options and plays the configured sound via PulseAudio/PipeWire. Used by hooks and status transitions. | **Useful (optional)** |

### Session management

| Script | Purpose | Going forward? |
|--------|---------|----------------|
| `scripts/close-target.sh` | **Close action.** Kills the selected session, window, or pane and cleans up all associated state files (status, pane, wait, parked). Called from the fzf switcher via `Ctrl-X`. | **Essential** |
| `scripts/park-session.sh` | **Park current session.** Writes a `.parked` marker, removes any active wait timer, jumps to the next inbox target, and updates the session's status file to `parked`. | **Essential** |
| `scripts/park-target.sh` | **Park specific target.** Applies park logic to an explicitly specified session, window, or pane. Called from the fzf switcher via `Ctrl-P`. | **Essential** |
| `scripts/wait-session.sh` | **Wait current session.** Prompts for a duration (minutes) via `tmux command-prompt`, then delegates to `wait-session-handler.sh`. Bound to `prefix + W`. | **Essential** |
| `scripts/wait-target.sh` | **Wait specific target.** Same as `wait-session.sh` but for an explicitly named target. Called from the switcher via `Ctrl-W`. | **Essential** |
| `scripts/wait-session-handler.sh` | **Wait timer writer.** Receives `<target> <minutes>` args, validates them, writes a `.wait` file with an expiry timestamp, and signals the sidebar to refresh. | **Essential** |
| `scripts/next-done-project.sh` | **Inbox cycling.** Scans all sessions and targets the next one in "done/ready" state in the same top-to-bottom order as the sidebar inbox. Bound to `prefix + N`. Supports `--exclude` to skip the current session. | **Essential** |

### Multi-agent deploy

| Script | Purpose | Going forward? |
|--------|---------|----------------|
| `scripts/deploy-sessions.sh` | **Parallel session launcher.** Reads a JSON manifest, creates a `deploy/<name>` git worktree for each entry, spawns a new tmux window/session, and runs `claude-launcher.sh` with an optional initial prompt. | **Useful** |
| `scripts/claude-launcher.sh` | **Claude session launcher.** Reads an initial prompt from a temp file (if provided) and execs `claude --dangerously-skip-permissions` with that prompt. Falls back to interactive mode when no prompt file is given. | **Useful** |

### Remote / SSH

| Script | Purpose | Going forward? |
|--------|---------|----------------|
| `setup-server.sh` | **One-time SSH setup.** Takes `<session-name> <ssh-host>`, reads the remote hostname, adds a mapping entry to `hooks/better-hook.sh`'s case statement, and installs the plugin on the remote host via `rsync`. | **Optional (SSH use only)** |
| `update-remote-status.sh` | **Background remote poll.** Fetches `~/.cache/tmux-agent-status/reachgpu.status` from the `reachgpu` SSH host into the local cache directory, non-blocking. Called from the collector when a `reachgpu` session exists. | **Optional (SSH use only)** |

### Hooks

| Script | Purpose | Going forward? |
|--------|---------|----------------|
| `hooks/better-hook.sh` | **Claude Code lifecycle hook.** Handles `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `Stop`, and `Notification` events. Writes `working`, `done`, or `ask` to the session and pane status files. Resolves the tmux session name from `$TMUX` or SSH environment. Touches the refresh file to wake the collector. | **Essential** |
| `hooks/codex-hook.sh` | **Codex CLI lifecycle hook.** Mirrors `better-hook.sh` for Codex events (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `Stop`). | **Essential** |
| `hooks/codex-notify.sh` | **Codex sound notification.** Plays a completion sound when Codex finishes a task. Called from `codex-hook.sh` on `Stop`. | **Useful (optional)** |

### Library (`scripts/lib/`)

These scripts are sourced by other scripts, not run directly. See [`scripts/lib/README.md`](../tmux-agent-status/scripts/lib/README.md) for sourcing relationships.

| Script | Purpose | Going forward? |
|--------|---------|----------------|
| `scripts/lib/collect.sh` | **Core data collector.** Builds `ENTRIES[]` from all tmux sessions: PID ancestry tracing (BFS), per-pane status file merging, worktree detection, state-priority resolution. Sets `_COLLECT_CHANGED` when data is rebuilt. | **Essential (sourced)** |
| `scripts/lib/session-status.sh` | **Session state helpers.** Defines `STATUS_DIR`, `PARKED_DIR`, `WAIT_DIR`, `PANE_DIR` constants. Provides `is_ssh_session()`, `has_agent_in_session()`, `get_pane_status()`, `get_agent_status()`, `sync_session_after_child_scope_change()`, and other helpers. Sources `agent-processes.sh`. | **Essential (sourced)** |
| `scripts/lib/status-summary.sh` | **Aggregate counter.** Reads the `ENTRIES[]` array and computes `SUMMARY_WORKING`, `SUMMARY_WAITING`, `SUMMARY_DONE`, `SUMMARY_TOTAL`. Used by `status-line.sh` and the sidebar. | **Essential (sourced)** |
| `scripts/lib/sidebar-clients.sh` | **Client registry.** Maintains a file-based list of active sidebar pane IDs under `~/.cache/tmux-agent-status/sidebar-clients/`. Provides `register_sidebar_client()`, `unregister_sidebar_client()`, `signal_sidebar_clients()`. | **Essential (sourced)** |
| `scripts/lib/selection-targets.sh` | **Target builder.** Generates the structured target list (sessions → windows → panes) used by the fzf switcher and `next-done-project.sh`. Applies park/wait/inbox filters. | **Essential (sourced)** |
| `scripts/lib/preview.sh` | **Preview renderer.** Generates the formatted right-pane preview content shown in the fzf switcher for a given target. | **Essential (sourced)** |
| `scripts/lib/agent-processes.sh` | **Process detector.** Builds a PID→children map via `ps -eo pid= ppid=`, then does a BFS from each tmux pane PID to detect whether a Claude Code or Codex process is a descendant. Used when no status file exists. | **Essential (sourced)** |

### Demo (`demo/`)

| Script | Purpose | Going forward? |
|--------|---------|----------------|
| `demo/setup.sh` | Creates the demo tmux session and populates fake agent states for recording. | **Reference (dev/demo)** |
| `demo/teardown.sh` | Kills the demo session and cleans up fake state files. | **Reference (dev/demo)** |
| `demo/record.sh` | Starts `asciinema` or `vhs` recording of the demo session. | **Reference (dev/demo)** |
| `demo/keybar.sh` | Renders an on-screen key-press display overlay during recording using `showkey` or a similar tool. | **Reference (dev/demo)** |

### Tests (`tests/`)

All 34 scripts are bash integration tests. They are not required at runtime. See [`tests/README.md`](../tmux-agent-status/tests/README.md) for per-test descriptions.

| Script | What it verifies |
|--------|-----------------|
| `claude-hook-multipane.sh` | Claude hook correctly tracks state across multiple panes in one session |
| `close-target-pane.sh` | Closing a pane cleans up pane state files and updates session state |
| `close-target-session-next-inbox.sh` | Closing a session advances to the next inbox target |
| `close-target-session.sh` | Closing a session kills the tmux session and removes state |
| `close-target-window.sh` | Closing a window cleans up window-scoped state |
| `codex-hook-lifecycle.sh` | Codex hook correctly transitions working → done on Stop |
| `next-done-inbox-order.sh` | `next-done-project.sh` follows sidebar top-to-bottom order |
| `park-session-next-inbox.sh` | Parking a session advances to next inbox item |
| `park-target-session-next-inbox.sh` | Parking via `park-target.sh` also advances inbox |
| `park-target-window.sh` | Window-scoped parking writes correct `.parked` file |
| `parked-claude-stability.sh` | Parked sessions are not re-activated by Claude hook events |
| `parked-codex-reactivation.sh` | Parked Codex sessions are correctly reactivated on UserPromptSubmit |
| `sidebar-client-signals.sh` | `sidebar-signal.sh` correctly delivers USR1 to registered clients |
| `sidebar-expired-pane-wait.sh` | Expired pane-level wait timers are cleaned up by smart-monitor |
| `sidebar-multipane-hook-statuses.sh` | Multi-pane session shows correct per-pane statuses in sidebar |
| `sidebar-preview-targets.sh` | Preview content is generated correctly for each target type |
| `sidebar-render.sh` | Sidebar renders correct icons and labels for each status |
| `sidebar-signal-clients.sh` | All registered sidebar clients receive the refresh signal |
| `sidebar-window-name-labels.sh` | Window rows in the sidebar show the tmux window name |
| `sidebar-window-park-scope.sh` | Parking a window does not affect other windows in the session |
| `smart-monitor-wait-expiry.sh` | `smart-monitor.sh` cleans up expired wait files and signals refresh |
| `status-line-cache.sh` | Status line reads from cache file when the collector is running |
| `status-line-codex-regression.sh` | Codex status transitions are reflected correctly in the status bar |
| `status-line-parked-summary.sh` | Parked sessions are excluded from the status bar summary |
| `status-line-wait-summary.sh` | Waiting sessions appear in the `⏸` count in the status bar |
| `switcher-action-bindings.sh` | fzf key bindings (Ctrl-X, Ctrl-P, Ctrl-W, Ctrl-R) trigger correct actions |
| `switcher-close-actions.sh` | Close action from the switcher correctly removes the target |
| `switcher-close-confirmation.sh` | Session/window close asks for confirmation before destroying |
| `switcher-parked-group.sh` | Parked targets appear in the PARKED group in the switcher |
| `switcher-popup-close-confirmation.sh` | Popup-mode close confirmation works without freezing the UI |
| `switcher-reset-preserves-parked.sh` | State reset (`Ctrl-R`) does not unpark already-parked sessions |
| `switcher-scope-list.sh` | Switcher correctly lists all scopes (session / window / pane) |
| `wait-target-prompt.sh` | Wait prompt appears and accepts numeric input |
| `wait-window-scope.sh` | Window-level wait writes to the correct `.wait` file path |

### Root utilities

| Script | Purpose | Going forward? |
|--------|---------|----------------|
| `test-status.sh` | Manual testing helper: sets a status file to a specified value and signals the sidebar to refresh. Used during development to verify display states without running a full agent. | **Reference only** |
