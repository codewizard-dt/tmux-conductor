# 018 — Strip Container Mode from conductor.sh / spawn.sh

> **Depends on**: none
> **Blocks**: none
> **Parallel-safe with**: [016-ensure-container-up](016-ensure-container-up.md), [017-command-center-dashboard](017-command-center-dashboard.md), [014-scripts-readme-flowchart](014-scripts-readme-flowchart.md), [008-publish-base-image](008-publish-base-image.md)

## Objective

Remove all container/Docker wiring from `scripts/conductor.sh` and `scripts/spawn.sh` so agents are spawned as plain `claude` tmux windows. Specifically: delete `build_launch_cmd`, the EXEC_MODE pre-flight block, and all `EXEC_MODE` conditional branches. Update `conductor.conf` to remove EXEC_MODE and Docker Compose knobs, and add `CLAUDE_FLAGS` as a top-level setting.

## Approach

All three files change together in one pass. The `build_launch_cmd()` helper becomes a no-op once EXEC_MODE is gone — callers are simplified to inline the `launch_cmd` variable directly. The container pre-flight auth check in `conductor.sh` (lines 33–58) is removed entirely. `conductor.conf` loses the two container knobs (`EXEC_MODE`, `COMPOSE_FILE`, `COMPOSE_SERVICE`) and gains `CLAUDE_FLAGS="--dangerously-skip-permissions"` as a documented setting even though existing AGENTS entries already embed the flag in their `launch_cmd` field.

---

## Steps

### 1. Edit `scripts/conductor.sh`  <!-- agent: general-purpose -->

- [ ] Delete the `build_launch_cmd()` function (lines 22–30, inclusive of the surrounding comment line `# Helper: build the launch command...`)
- [ ] Delete the container pre-flight block (lines 32–58: from `# Pre-flight: check auth for container mode` through the closing `fi`)
- [ ] For the first-agent spawn (currently `cmd="$(build_launch_cmd "$launch_cmd")"` + `tmux send-keys ... "$env_prefix $cmd" Enter`):
  - Remove the `cmd="$(build_launch_cmd "$launch_cmd")"` line
  - Change the `tmux send-keys` line to use `$launch_cmd` directly:
    ```bash
    tmux send-keys -t "$SESSION_NAME:$name" "$env_prefix $launch_cmd" Enter
    ```
  - Change the echo to: `echo "Spawned: $name ($launch_cmd) in $workdir"`
- [ ] Apply the same simplification inside the remaining-agents loop (lines 71–80):
  - Remove the `cmd="$(build_launch_cmd "$launch_cmd")"` line
  - Change `tmux send-keys` to use `$launch_cmd` directly
  - Change the echo accordingly
- [ ] Run `bash -n scripts/conductor.sh` — must pass with no errors

### 2. Edit `scripts/spawn.sh`  <!-- agent: general-purpose -->

- [ ] Delete the `build_launch_cmd()` function (lines 19–26, inclusive of the surrounding comment line `# Helper: build the launch command...`)
- [ ] For the first-agent spawn (lines 32–34):
  - Remove `cmd="$(build_launch_cmd "$launch_cmd")"`
  - Change `tmux send-keys` to: `tmux send-keys -t "$SESSION_NAME" "$env_prefix $launch_cmd" Enter`
  - Change the echo to: `echo "Spawned: $name ($launch_cmd) in $workdir"`
- [ ] Apply the same simplification inside the split-window loop (lines 39–48):
  - Remove `cmd="$(build_launch_cmd "$launch_cmd")"`
  - Change `tmux send-keys` to use `$launch_cmd` directly
  - Change the echo accordingly
- [ ] Run `bash -n scripts/spawn.sh` — must pass with no errors

### 3. Edit `conductor.conf`  <!-- agent: general-purpose -->

- [ ] Add a `CLAUDE_FLAGS` variable in the `# --- Agents ---` section, just before the `AGENTS=(` array:
  ```bash
  # Flags passed to every agent launch command (appended when not already in launch_cmd).
  # Default enables non-interactive operation for automated orchestration.
  CLAUDE_FLAGS="--dangerously-skip-permissions"
  ```
- [ ] Remove the `# --- Execution mode ---` section (lines 112–114): the comment block and `EXEC_MODE="container"` assignment
- [ ] Remove the `# --- Docker Compose settings ---` section (lines 116–122): the comment block, `COMPOSE_FILE=`, and `COMPOSE_SERVICE=` assignments
- [ ] Remove the `# Path to the log directory *inside* the container` comment block and the commented-out `# CONDUCTOR_LOG_DIR="/tmp/conductor-logs"` line (those are container-only)

### 4. Verification  <!-- agent: general-purpose -->

- [ ] `bash -n scripts/conductor.sh` passes
- [ ] `bash -n scripts/spawn.sh` passes
- [ ] `bash -n scripts/monitor.sh` passes (unchanged, but confirm it doesn't reference `EXEC_MODE`)
- [ ] `grep -r EXEC_MODE scripts/ conductor.conf` returns no results
- [ ] `grep -r build_launch_cmd scripts/` returns no results
- [ ] `grep -r agent_exec scripts/conductor.sh scripts/spawn.sh` returns no results
