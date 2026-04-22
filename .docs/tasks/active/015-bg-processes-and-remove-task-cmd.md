# 015 — Background Processes (BG_PROCESSES) + Remove TASK_CMD

## Objective

Add a `BG_PROCESSES` config array so the conductor can spawn host-side auxiliary processes (e.g. `pnpm dev`) in their own tmux windows, and remove `TASK_CMD` so every dispatch is explicit.

## Approach

Mirror the existing `AGENTS=()` shape for `BG_PROCESSES=()` but bypass `agent_exec.sh`/container wrapping and the `CONDUCTOR_AGENT_NAME` env prefix — these are not agents, just host commands in a tmux window. Monitor skips them for idle detection but emits a `WARN` if the window goes missing. Teardown sends `C-c` to each bg window before killing the session.

## Prerequisites

- [ ] Task 013 (Scripts Folder + add-task) completed — bg-process wiring edits all live under `scripts/`
- [ ] tmux >= 3.0 available (unchanged from existing prereqs)

---

## Steps

### 1. Update `conductor.conf`  <!-- agent: general-purpose -->

- [x] Add a new `BG_PROCESSES=()` array directly below the existing `AGENTS=()` block
  - Place it before the `# --- Slash commands` section header
  - Use the same `<name>:<working_dir>:<launch_cmd>` entry format as `AGENTS`
  - Add a comment block above the array:
    ```
    # --- Background processes ---
    # Host-side auxiliary processes (dev servers, watchers, log tailers) that
    # should run in their own tmux window alongside the agents. These run on
    # the HOST even when EXEC_MODE="container" — no agent_exec.sh wrapping,
    # no CONDUCTOR_AGENT_NAME env, no idle polling, no queue dispatch.
    #
    # Each entry uses the format: <name>:<working_dir>:<launch_cmd>
    #   name        — unique tmux window name (must not collide with AGENTS)
    #   working_dir — absolute path where the process starts
    #   launch_cmd  — the shell command (avoid ':' in the command itself)
    BG_PROCESSES=(
      # "jobfinder-dev:/Users/davidtaylor/Repositories/jobfinder:pnpm dev"
    )
    ```
- [x] Remove the `TASK_CMD` definition and its surrounding comment block (lines currently describing "Default command dispatched when the task queue is empty")
  - Leave the `CLEAR_CMD` line intact
  - The `# --- Slash commands (vendor-specific vocabulary) ---` header stays; just drop the `TASK_CMD` paragraph + assignment

### 2. Spawn bg-process windows in `scripts/conductor.sh`  <!-- agent: general-purpose -->

- [x] After the existing "Spawn remaining agents as new windows" loop and **before** the `tmux new-window ... -n "monitor"` line, insert a new loop over `BG_PROCESSES`
- [x] For each entry `IFS=: read -r name workdir launch_cmd <<< "$entry"`:
  - [x] Call `tmux new-window -t "$SESSION_NAME" -n "$name" -c "$workdir"`
  - [x] Call `tmux send-keys -t "$SESSION_NAME:$name" "$launch_cmd" Enter`
    - Do NOT wrap with `build_launch_cmd` (no container exec)
    - Do NOT prepend the `CONDUCTOR_AGENT_NAME='...' CONDUCTOR_STATE_DIR='...'` env prefix
  - [x] `echo "Spawned bg: $name ($launch_cmd) in $workdir"`
- [x] Guard the loop with `if [ "${#BG_PROCESSES[@]}" -gt 0 ]` so an empty array doesn't emit noise
- [x] Update the startup banner echo block to also print `BG procs: ${#BG_PROCESSES[@]}` directly under the existing `Agents:` line

### 3. Spawn bg-process panes in `scripts/spawn.sh`  <!-- agent: general-purpose -->

- [x] After the existing agent-split loop, add a second loop over `BG_PROCESSES` using `tmux split-window -t "$SESSION_NAME" -c "$workdir"` followed by `tmux send-keys -t "$SESSION_NAME" "$launch_cmd" Enter` and `tmux select-layout -t "$SESSION_NAME" tiled`
- [x] Same rules as step 2: no `build_launch_cmd`, no `CONDUCTOR_*` env prefix
- [x] Guard with `if [ "${#BG_PROCESSES[@]}" -gt 0 ]`
- [x] Update the "All N agents launched" closing echo to also mention bg-process count when non-zero

### 4. Update `scripts/monitor.sh` — liveness + remove TASK_CMD  <!-- agent: general-purpose -->

- [x] After the existing `AGENT_NAMES` build loop, add a parallel build of `BG_NAMES` from `BG_PROCESSES` (guarded so an unset/empty array is fine)
- [x] Inside the main `while true` loop, after the per-agent `for name in "${AGENT_NAMES[@]}"` block and before the `all_usage_hit`/`all_idle` shutdown check, add a liveness loop:
  ```bash
  for bg_name in "${BG_NAMES[@]}"; do
    bg_target="$SESSION_NAME:$bg_name"
    if ! tmux has-session -t "$bg_target" 2>/dev/null; then
      log "WARN: bg '$bg_name' — window not found"
    fi
  done
  ```
  - Do NOT call `is_idle`, `check_usage`, `pop_task`, `mark_busy`, or `dispatch` on bg entries
  - Do NOT let bg liveness affect `all_idle` / `all_usage_hit`
- [x] Remove the `elif [ -n "${TASK_CMD:-}" ]` branch inside the `if pop_task ...` block:
  - The remaining shape should be `if pop_task ...; then ... else log "$name — queue empty, no task. Agent stays idle."; emit_dispatch_jsonl "$name" "" "none" "" "$target"; fi`
- [x] Remove any remaining references to `TASK_CMD` in the startup `log` lines (the file currently does not log it, but double-check)

### 5. Graceful shutdown in `scripts/teardown.sh`  <!-- agent: general-purpose -->

- [x] After the existing loop that sends `/exit` to each agent and before the `sleep 10`, add a parallel loop over `BG_PROCESSES`:
  ```bash
  for entry in "${BG_PROCESSES[@]:-}"; do
    [ -z "$entry" ] && continue
    IFS=: read -r name _workdir _launch_cmd <<< "$entry"
    echo "[$(date +%H:%M:%S)] Sending C-c to bg '$name'..."
    tmux send-keys -t "$SESSION_NAME:$name" C-c 2>/dev/null || true
  done
  ```
- [x] Leave the existing `sleep 10` + `tmux kill-session` lines unchanged — the sleep now covers both agent `/exit` and bg `C-c`

### 6. Update `CLAUDE.md`  <!-- agent: general-purpose -->

- [x] In the "Core Scripts" section, add a sentence to the `conductor.sh` / `spawn.sh` rows noting that they also spawn a tmux window per `BG_PROCESSES` entry (host-side, no container wrapping)
- [x] In "Key Design Decisions", add a new bullet near the existing idle-detection bullets:
  > `BG_PROCESSES` entries are host-side windows spawned alongside agents but are not monitored for idle, never receive queue dispatches, and are terminated via `C-c` during teardown. Parsed with the same `name:workdir:cmd` format as `AGENTS` but without `agent_exec.sh` wrapping or `CONDUCTOR_AGENT_NAME` env.
- [x] Remove any mention of `TASK_CMD` / "default command when queue is empty" from CLAUDE.md (search with `Grep`)

### 7. Update `scripts/README.md`  <!-- agent: general-purpose -->

- [x] In the conductor.sh and spawn.sh per-script sections, document bg-process spawning
- [x] In the monitor.sh section, document the bg liveness warning and the removal of `TASK_CMD` fallback (queue-empty now means "stay idle")
- [x] In the teardown.sh section, document the `C-c` step for bg processes
- [x] If the mermaid flowchart references `TASK_CMD`, replace that node/edge with a "queue empty → stay idle" path; if it helps readability, add a `BG_PROCESSES` node on the spawn side

### 8. Verification  <!-- agent: general-purpose -->

- [ ] Run `bash -n scripts/conductor.sh scripts/spawn.sh scripts/monitor.sh scripts/teardown.sh` — all pass syntax check
- [ ] Run `shellcheck` on the four modified scripts and confirm no new warnings are introduced (pre-existing warnings are acceptable)
- [ ] Smoke test: add `BG_PROCESSES=("test-sleep:/tmp:sleep 300")` to `conductor.conf`, run `./scripts/conductor.sh`, confirm:
  - A `test-sleep` tmux window exists with cwd `/tmp` and `sleep 300` running on the host (not via `docker exec`)
  - `monitor.sh` does not emit any dispatch lines for `test-sleep`
  - Deleting the `test-sleep` window causes `monitor.sh` to log `WARN: bg 'test-sleep' — window not found` on the next poll
- [ ] Smoke test `teardown.sh`: from another shell, run `./scripts/teardown.sh`; confirm the `test-sleep` window receives `C-c` (visible in capture-pane) before the session is killed
- [ ] TASK_CMD removal: empty the queue, confirm `monitor.sh` logs `queue empty, no task. Agent stays idle.` and the JSONL `dispatch.jsonl` records a `"queue":"none"` entry with empty `command`
- [ ] Confirm `tasks.txt` scoped + global dispatch still works end-to-end (unchanged behavior)
- [ ] Restore `conductor.conf` to remove the `test-sleep` smoke-test entry before completing the task
