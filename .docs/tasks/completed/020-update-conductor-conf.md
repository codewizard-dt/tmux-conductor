# 020 — Update conductor.conf for local-agent model

> **Depends on**: [018-strip-container-mode](018-strip-container-mode.md)
> **Blocks**: none
> **Parallel-safe with**: [019-remove-scaffold-sh](019-remove-scaffold-sh.md)

## Objective

After task 018 strips container mode from the scripts, ensure `conductor.conf` is fully updated for the local-agent model: remove all container knobs, add `CLAUDE_FLAGS`, and update comments to reflect that agents run as plain tmux windows with `claude --dangerously-skip-permissions`.

## Approach

Task 018 handles the mechanical removal of `EXEC_MODE`, `COMPOSE_FILE`, and `COMPOSE_SERVICE`. This task documents the resulting state and adds polish: clear comments explaining `CLAUDE_FLAGS`, updated example AGENTS entries, and removal of any container-related comments that would confuse a new user.

---

## Steps

### 1. Verify task 018 changes are applied  <!-- agent: general-purpose -->

- [ ] Confirm `EXEC_MODE` is absent from `conductor.conf`
- [ ] Confirm `COMPOSE_FILE` is absent from `conductor.conf`
- [ ] Confirm `COMPOSE_SERVICE` is absent from `conductor.conf`
- [ ] Confirm `CLAUDE_FLAGS` is present in `conductor.conf`

### 2. Polish `conductor.conf` comments  <!-- agent: general-purpose -->

- [ ] Update the `# --- Agents ---` section header comment to explain that `launch_cmd` should be `claude $CLAUDE_FLAGS` or equivalent:
  ```
  # --- Agents ---
  # Bash 4+ indexed array of agent definitions.
  # Each entry uses the format: <name>:<working_dir>:<launch_cmd>
  #   name        — unique label, used as the tmux window name
  #   working_dir — absolute path where the agent's pane starts
  #   launch_cmd  — shell command that starts the agent CLI
  #                 For Claude Code: "claude --dangerously-skip-permissions"
  ```
- [ ] Update the commented-out `CONDUCTOR_LOG_DIR` line: remove the `inside the container` wording since containers are gone. Change to just note it's the hook log directory path
- [ ] Verify no remaining references to Docker, container, or compose anywhere in the file

### 3. Verification  <!-- agent: general-purpose -->

- [ ] `grep -iE "docker|container|compose|EXEC_MODE|COMPOSE_FILE|COMPOSE_SERVICE" conductor.conf` returns no results
- [ ] `bash -n conductor.conf` passes (source-able without error with empty AGENTS array substituted)
