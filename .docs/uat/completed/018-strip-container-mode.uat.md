# UAT: Strip Container Mode from conductor.sh / spawn.sh

> **Source task**: [`.docs/tasks/018-strip-container-mode.md`](../../tasks/018-strip-container-mode.md)
> **Generated**: 2026-06-06

---

## Prerequisites

- [ ] Working directory is the repo root: `/Users/davidtaylor/Repositories/tmux-conductor`
- [ ] `bash --version` is available (bash 4+ preferred, 3.2 minimum)

---

## Syntax Checks

### UAT-STATIC-001: conductor.sh passes bash syntax check
- **Description**: After removing `build_launch_cmd` and EXEC_MODE blocks, `conductor.sh` must have no syntax errors
- **Steps**:
  1. Run the command below from the repo root
- **Command**:
  ```bash
  bash -n scripts/conductor.sh && echo "conductor.sh OK"
  ```
- **Expected Result**: Prints `conductor.sh OK` with no errors or warnings
- [x] Pass <!-- 2026-06-06 -->

### UAT-STATIC-002: spawn.sh passes bash syntax check
- **Description**: After removing `build_launch_cmd` and its call sites, `spawn.sh` must have no syntax errors
- **Steps**:
  1. Run the command below from the repo root
- **Command**:
  ```bash
  bash -n scripts/spawn.sh && echo "spawn.sh OK"
  ```
- **Expected Result**: Prints `spawn.sh OK` with no errors or warnings
- [x] Pass <!-- 2026-06-06 -->

### UAT-STATIC-003: monitor.sh passes bash syntax check (unchanged)
- **Description**: `monitor.sh` was not modified by this task but must still pass the syntax check and must not reference `EXEC_MODE`
- **Steps**:
  1. Run the command below from the repo root
- **Command**:
  ```bash
  bash -n scripts/monitor.sh && echo "monitor.sh OK"
  ```
- **Expected Result**: Prints `monitor.sh OK` with no errors or warnings
- [x] Pass <!-- 2026-06-06 -->

---

## Dead-Code Removal Checks

### UAT-DEAD-001: No EXEC_MODE references remain in scripts/ or conductor.conf
- **Description**: The `EXEC_MODE` variable must be entirely removed — no assignments, no conditionals, no references
- **Steps**:
  1. Run the command below from the repo root
- **Command**:
  ```bash
  grep -r EXEC_MODE scripts/ conductor.conf; echo "exit:$?"
  ```
- **Expected Result**: No matching lines before `exit:`. The final output is `exit:1` (grep found nothing)
- [x] Pass <!-- 2026-06-06 -->

### UAT-DEAD-002: No build_launch_cmd references remain in scripts/
- **Description**: The `build_launch_cmd` function and all its call sites must be removed from every script
- **Steps**:
  1. Run the command below from the repo root
- **Command**:
  ```bash
  grep -r build_launch_cmd scripts/; echo "exit:$?"
  ```
- **Expected Result**: No matching lines before `exit:`. The final output is `exit:1`
- [x] Pass <!-- 2026-06-06 -->

### UAT-DEAD-003: No agent_exec references remain in conductor.sh or spawn.sh
- **Description**: `agent_exec.sh` must no longer be invoked from the two main entry-point scripts
- **Steps**:
  1. Run the command below from the repo root
- **Command**:
  ```bash
  grep -r agent_exec scripts/conductor.sh scripts/spawn.sh; echo "exit:$?"
  ```
- **Expected Result**: No matching lines before `exit:`. The final output is `exit:1`
- [x] Pass <!-- 2026-06-06 -->

### UAT-DEAD-004: Docker / Compose knobs removed from conductor.conf
- **Description**: `COMPOSE_FILE` and `COMPOSE_SERVICE` must no longer appear in `conductor.conf`
- **Steps**:
  1. Run the command below from the repo root
- **Command**:
  ```bash
  grep -E 'COMPOSE_FILE|COMPOSE_SERVICE|EXEC_MODE' conductor.conf; echo "exit:$?"
  ```
- **Expected Result**: No matching lines before `exit:`. The final output is `exit:1`
- [x] Pass <!-- 2026-06-06 -->

---

## New Configuration Check

### UAT-CONF-001: CLAUDE_FLAGS is declared in conductor.conf
- **Description**: `conductor.conf` must define a top-level `CLAUDE_FLAGS` variable before the `AGENTS=(` array
- **Steps**:
  1. Run the command below from the repo root
- **Command**:
  ```bash
  grep -n 'CLAUDE_FLAGS' conductor.conf
  ```
- **Expected Result**: At least one line showing `CLAUDE_FLAGS=` with a value (e.g. `CLAUDE_FLAGS="--dangerously-skip-permissions"`)
- [x] Pass <!-- 2026-06-06 -->

### UAT-CONF-002: CLAUDE_FLAGS appears before AGENTS array in conductor.conf
- **Description**: The `CLAUDE_FLAGS` line must come at a lower line number than the `AGENTS=(` line
- **Steps**:
  1. Run the commands below and compare the line numbers
- **Command**:
  ```bash
  flags_line=$(grep -n 'CLAUDE_FLAGS=' conductor.conf | head -1 | cut -d: -f1)
  agents_line=$(grep -n '^AGENTS=(' conductor.conf | head -1 | cut -d: -f1)
  echo "CLAUDE_FLAGS line: $flags_line  AGENTS line: $agents_line"
  [ "$flags_line" -lt "$agents_line" ] && echo "ORDER OK" || echo "ORDER WRONG"
  ```
- **Expected Result**: Prints `ORDER OK` — `CLAUDE_FLAGS` line number is less than `AGENTS=(` line number
- [x] Pass <!-- 2026-06-06 -->

---

## Spawn Behaviour Check

### UAT-SPAWN-001: conductor.sh uses launch_cmd directly (not via build_launch_cmd)
- **Description**: The `tmux send-keys` lines in `conductor.sh` must reference `$launch_cmd` (or `$env_prefix $launch_cmd`) directly, not `$cmd` produced by `build_launch_cmd`
- **Steps**:
  1. Run the command below from the repo root
- **Command**:
  ```bash
  grep -n 'send-keys.*launch_cmd' scripts/conductor.sh
  ```
- **Expected Result**: Two or more matching lines — one for the first-agent spawn and one inside the remaining-agents loop — both referencing `$launch_cmd` directly
- [x] Pass <!-- 2026-06-06 -->

### UAT-SPAWN-002: spawn.sh uses launch_cmd directly (not via build_launch_cmd)
- **Description**: The `tmux send-keys` lines in `spawn.sh` must reference `$launch_cmd` directly
- **Steps**:
  1. Run the command below from the repo root
- **Command**:
  ```bash
  grep -n 'send-keys.*launch_cmd' scripts/spawn.sh
  ```
- **Expected Result**: Two or more matching lines — one for the first-agent spawn and one inside the split-window loop — both referencing `$launch_cmd` directly
- [x] Pass <!-- 2026-06-06 -->
