# 016 — Auto-start dev containers before spawning agents

## Objective

Make `scripts/conductor.sh` start each agent's dev container (via `docker compose up -d --build`) before spawning its tmux window, skipping the `up` call when the container is already running.

## Approach

In container mode, collect the unique workdirs from `AGENTS`, run `docker compose -f "$COMPOSE_FILE" ps --status running --services` in each, and only invoke `docker compose up -d --build` when `$COMPOSE_SERVICE` is absent. Workdirs whose `up` fails are recorded in a failed-set; any agent with a failed workdir is skipped (with a warning) rather than aborting the whole session.

## Prerequisites

- [ ] Task 015 (BG_PROCESSES + remove TASK_CMD) merged (current `scripts/conductor.sh` is the base)
- [ ] `EXEC_MODE`, `COMPOSE_FILE`, `COMPOSE_SERVICE` present in `conductor.conf` (already true)
- [ ] `docker compose` v2 available on host

---

## Steps

### 1. Add `ensure_container_up()` helper to `scripts/conductor.sh`  <!-- agent: general-purpose -->

- [ ] Insert a new function immediately after the existing `build_launch_cmd()` helper (around line 30)
- [ ] Function signature: `ensure_container_up() { local workdir="$1"; ... }`
  - Takes a single argument: absolute workdir path
  - Uses the globals `COMPOSE_FILE` and `COMPOSE_SERVICE` from `conductor.conf`
  - Returns 0 when the service is already running OR when `up` succeeds
  - Returns non-zero when `up` fails
- [ ] Implementation outline:
  ```bash
  ensure_container_up() {
    local workdir="$1"
    if [[ ! -f "$workdir/$COMPOSE_FILE" ]]; then
      echo "⚠ $workdir/$COMPOSE_FILE not found — skipping container up for this workdir" >&2
      return 1
    fi
    if (cd "$workdir" && docker compose -f "$COMPOSE_FILE" ps --status running --services 2>/dev/null | grep -qx "$COMPOSE_SERVICE"); then
      echo "Container: ✓ $COMPOSE_SERVICE already running in $workdir"
      return 0
    fi
    echo "Container: starting $COMPOSE_SERVICE in $workdir (docker compose up -d --build)..."
    if (cd "$workdir" && docker compose -f "$COMPOSE_FILE" up -d --build); then
      return 0
    else
      echo "⚠ docker compose up failed in $workdir" >&2
      return 1
    fi
  }
  ```
- [ ] Use the `Edit` tool on `scripts/conductor.sh`; place the helper after the closing `}` of `build_launch_cmd` and before the `# Pre-flight: check auth for container mode` block

### 2. Collect unique workdirs and run the check before session creation  <!-- agent: general-purpose -->

- [ ] After the existing `# Pre-flight: check auth for container mode` block (the `fi` that closes it, around line 58), and **before** the `# Create session with first agent` block, add a new block that:
  1. Runs only when `EXEC_MODE == "container"`
  2. Iterates `AGENTS`, parses each `name:workdir:launch_cmd`, and collects unique workdirs into an associative array (`declare -A seen`) to dedupe
  3. For each unique workdir, calls `ensure_container_up "$workdir"`; if it returns non-zero, records that workdir in a failed associative array (`declare -A failed_workdirs`)
  4. Prints a blank line after the block
- [ ] Skeleton:
  ```bash
  declare -A failed_workdirs=()
  if [[ "$EXEC_MODE" == "container" ]]; then
    declare -A seen_workdirs=()
    for entry in "${AGENTS[@]}"; do
      IFS=: read -r _name workdir _launch_cmd <<< "$entry"
      [[ -n "${seen_workdirs[$workdir]:-}" ]] && continue
      seen_workdirs[$workdir]=1
      if ! ensure_container_up "$workdir"; then
        failed_workdirs[$workdir]=1
      fi
    done
    echo ""
  fi
  ```
- [ ] Declare `failed_workdirs` **outside** the `if` block so it's in scope for the spawn loops below even in local mode (will just be empty)
- [ ] Note: the script is already under `set -euo pipefail`. `ensure_container_up` must not abort the script on failure — this is why the body uses explicit `return 1` and the call site uses `if ! ensure_container_up ...; then`, which is exempt from `set -e` propagation.

### 3. Skip agent spawns whose workdir failed  <!-- agent: general-purpose -->

- [ ] Modify the **first-agent** block (currently lines 60–68, the `# Create session with first agent` section). Before calling `tmux new-session`, check `failed_workdirs`:
  - If the first agent's workdir is in `failed_workdirs`, there is no running container for it. We still need a tmux session, so find the **first non-failed** agent and promote it to the "create session" slot. If every agent is failed, `echo` an error and `exit 1`.
  - Easier alternative: loop through `AGENTS` until we find the first entry whose workdir is NOT in `failed_workdirs`; use that as the session-creator. Track its index so the second loop starts at `index+1` and knows to use `new-window` for everything else, skipping failed entries along the way.
- [ ] Replace the existing single-agent-plus-loop structure with:
  ```bash
  first_spawn=1
  for (( i=0; i<${#AGENTS[@]}; i++ )); do
    IFS=: read -r name workdir launch_cmd <<< "${AGENTS[$i]}"
    if [[ -n "${failed_workdirs[$workdir]:-}" ]]; then
      echo "⚠ Skipping agent '$name' — container in $workdir failed to start"
      continue
    fi
    cmd="$(build_launch_cmd "$launch_cmd")"
    env_prefix="CONDUCTOR_AGENT_NAME='$name' CONDUCTOR_STATE_DIR='$STATE_DIR'"
    if (( first_spawn )); then
      tmux new-session -d -s "$SESSION_NAME" -c "$workdir" -n "$name"
      first_spawn=0
    else
      tmux new-window -t "$SESSION_NAME" -n "$name" -c "$workdir"
    fi
    tmux send-keys -t "$SESSION_NAME:$name" "$env_prefix $cmd" Enter
    echo "Spawned: $name ($cmd) in $workdir"
  done
  if (( first_spawn )); then
    echo "⚠ No agents could be spawned — all workdirs failed container startup" >&2
    exit 1
  fi
  ```
- [ ] This consolidates the two prior spawn blocks (lines 60–68 and 70–80) into one unified loop
- [ ] `BG_PROCESSES` and the monitor window below remain unchanged (they do not depend on agent containers)

### 4. Update docs  <!-- agent: general-purpose -->

- [ ] `CLAUDE.md` — add a bullet under **Key Design Decisions** describing the auto-up behavior: "In container mode, `conductor.sh` runs `docker compose -f $COMPOSE_FILE ps --status running --services` in each unique agent workdir before spawning. If `$COMPOSE_SERVICE` is absent, it runs `docker compose up -d --build` in that workdir. Workdirs whose `up` fails cause only their agents to be skipped (with a warning); other agents still start."
- [ ] `scripts/README.md` — in the `conductor.sh` section, add a short paragraph (or bullet) noting the auto-up step happens between the auth pre-flight and session creation, and mention the `--status running` check
- [ ] Do **not** add references to `~/.aliases` or the user's `conductor-up` alias — the task implements the underlying command inline so the script works for any user

### 5. Verification  <!-- agent: general-purpose -->

- [ ] `bash -n scripts/conductor.sh` passes (syntax check)
- [ ] Manual smoke test A — fresh start:
  - [ ] Run `docker compose -f devcontainer-compose.yml down` in `/Users/davidtaylor/Repositories/jobfinder` (and any other agent workdir)
  - [ ] Run `scripts/conductor.sh`
  - [ ] Observe "Container: starting app in <workdir>..." for each unique workdir, then normal "Spawned: ..." output
  - [ ] `docker compose ps` in each workdir shows the service running
- [ ] Manual smoke test B — containers already up:
  - [ ] Immediately re-run `scripts/conductor.sh` (after `tmux kill-session -t conductor`)
  - [ ] Observe "Container: ✓ app already running in <workdir>" for each — no `up --build` invocation
- [ ] Manual smoke test C — failure isolation:
  - [ ] Temporarily rename `devcontainer-compose.yml` in one agent's workdir
  - [ ] Run `scripts/conductor.sh`
  - [ ] Observe a warning for that workdir, that agent's window is skipped, other agents' windows spawn normally
  - [ ] Restore the file
- [ ] Local mode regression: set `EXEC_MODE="local"` in `conductor.conf`, confirm no container checks run and all agents spawn as before. Revert `EXEC_MODE` after.
