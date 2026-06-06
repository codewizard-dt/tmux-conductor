# UAT: Background Processes (BG_PROCESSES) + Remove TASK_CMD

> **Source task**: [`.docs/tasks/015-bg-processes-and-remove-task-cmd.md`](../tasks/015-bg-processes-and-remove-task-cmd.md)
> **Generated**: 2026-06-06

---

## Prerequisites

- [ ] tmux >= 3.0 installed
- [ ] bash >= 4.0 available (macOS: use `/opt/homebrew/bin/bash` or `brew install bash`)
- [ ] Repo root is `/Users/davidtaylor/Repositories/tmux-conductor`
- [ ] Scratch directory exists: `mkdir -p ./tmp/uat-015`

---

## Static Analysis

### UAT-STATIC-001: All four modified scripts pass bash syntax check

- **Description**: Verify that `conductor.sh`, `spawn.sh`, `monitor.sh`, and `teardown.sh` have no syntax errors after the BG_PROCESSES changes.
- **Steps**:
  1. From the repo root, run the command below.
- **Command**:
  ```bash
  bash -n scripts/conductor.sh scripts/spawn.sh scripts/monitor.sh scripts/teardown.sh
  ```
- **Expected Result**: Command exits with code 0 and produces no output. Any output indicates a syntax error.
- [x] Pass <!-- 2026-06-06 -->

### UAT-STATIC-002: conductor.conf declares BG_PROCESSES as a bash array

- **Description**: Verify the `BG_PROCESSES` array is present and syntactically valid in `conductor.conf`.
- **Steps**:
  1. Run the command below to source the config in a subshell and print the array length.
- **Command**:
  ```bash
  bash -c 'source ./conductor.conf; echo "BG count: ${#BG_PROCESSES[@]}"'
  ```
- **Expected Result**: Output is `BG count: <N>` where N ≥ 0. No error about unbound variable or syntax error.
- [x] Pass <!-- 2026-06-06 -->

### UAT-STATIC-003: TASK_CMD is absent from conductor.conf

- **Description**: Verify that `TASK_CMD` has been removed from `conductor.conf` so that queue-empty behavior is "stay idle" with no fallback command.
- **Steps**:
  1. Run the command below.
- **Command**:
  ```bash
  grep -c 'TASK_CMD' conductor.conf
  ```
- **Expected Result**: Output is `0` — no lines containing `TASK_CMD` exist in `conductor.conf`.
- [x] Pass <!-- 2026-06-06 -->

### UAT-STATIC-004: monitor.sh does not reference TASK_CMD

- **Description**: Confirm the `TASK_CMD` fallback branch was removed from `monitor.sh`.
- **Steps**:
  1. Run the command below.
- **Command**:
  ```bash
  grep -c 'TASK_CMD' scripts/monitor.sh
  ```
- **Expected Result**: Output is `0`.
- [x] Pass <!-- 2026-06-06 -->

### UAT-STATIC-005: conductor.sh prints BG_PROCESSES count in startup banner

- **Description**: Verify the startup banner includes a `BG procs:` line showing the background process count.
- **Steps**:
  1. Search for the banner line in the script source.
- **Command**:
  ```bash
  grep -c 'BG procs' scripts/conductor.sh
  ```
- **Expected Result**: Output is `1` — exactly one line in `conductor.sh` contains `BG procs`.
- [x] Pass <!-- 2026-06-06 -->

### UAT-STATIC-006: monitor.sh builds BG_NAMES from BG_PROCESSES

- **Description**: Verify `monitor.sh` constructs a `BG_NAMES` array from `BG_PROCESSES` at startup (not just inside the loop).
- **Steps**:
  1. Search for the BG_NAMES build block.
- **Command**:
  ```bash
  grep -c 'BG_NAMES' scripts/monitor.sh
  ```
- **Expected Result**: Output is `3` or more — multiple references to `BG_NAMES` (the build loop, the liveness loop, and any guard condition).
- [x] Pass <!-- 2026-06-06 -->

### UAT-STATIC-007: teardown.sh iterates BG_PROCESSES to send C-c

- **Description**: Verify `teardown.sh` contains the `C-c` loop for bg processes.
- **Steps**:
  1. Search for the C-c send line.
- **Command**:
  ```bash
  grep -c 'C-c' scripts/teardown.sh
  ```
- **Expected Result**: Output is `1` or more — at least one line sends `C-c` to a bg window.
- [x] Pass <!-- 2026-06-06 -->

---

## Behavioral Tests (require live tmux session)

The following tests require running `./scripts/conductor.sh` to create a real tmux session. They are documented as manual tests.

### UAT-SESSION-001: conductor.sh spawns named windows for BG_PROCESSES entries

- **Scenario**: Each entry in `BG_PROCESSES` gets its own tmux window with the configured name.
- **Steps**:
  1. Temporarily add a test bg entry to `conductor.conf`:
     ```
     BG_PROCESSES=("uat-sleep:/tmp:sleep 300")
     ```
  2. Run `./scripts/conductor.sh` from the repo root.
  3. After the session starts, run the command below.
- **Command**:
  ```bash
  tmux list-windows -t conductor -F '#{window_name}'
  ```
- **Expected Result**: Output includes `uat-sleep` as one of the windows. The `uat-sleep` window should have cwd `/tmp` and `sleep 300` running (verifiable via `tmux display-message -p -t conductor:uat-sleep '#{pane_current_path}'`).
- [x] Pass <!-- 2026-06-06 -->

### UAT-SESSION-002: BG_PROCESSES windows do not receive queue dispatches

- **Scenario**: `monitor.sh` must never dispatch a task from `tasks.txt` to a bg window, even if the queue has matching unscoped tasks.
- **Steps**:
  1. With a running session from UAT-SESSION-001, add an unscoped task to `tasks.txt`:
     ```
     echo "echo hello from bg-test" >> tasks.txt
     ```
  2. Wait for at least one full poll interval (15 seconds by default).
  3. Check the dispatch log.
- **Command**:
  ```bash
  grep 'uat-sleep' logs/dispatch.jsonl
  ```
- **Expected Result**: No output — no JSONL record with `"agent":"uat-sleep"`. The task was dispatched to an agent, not to the bg window.
- [x] Pass <!-- 2026-06-06 -->

### UAT-SESSION-003: monitor.sh emits WARN when a bg window goes missing

- **Scenario**: If a bg process window is deleted, monitor logs `WARN: bg '<name>' — window not found` on the next poll.
- **Steps**:
  1. With a running session, kill the `uat-sleep` window: `tmux kill-window -t conductor:uat-sleep`
  2. Wait one full poll interval (15 seconds).
  3. Check the monitor log.
- **Command**:
  ```bash
  grep "WARN: bg 'uat-sleep'" logs/monitor-*.log
  ```
- **Expected Result**: At least one line matching `WARN: bg 'uat-sleep' — window not found`.
- [x] Pass <!-- 2026-06-06 -->

### UAT-SESSION-004: queue-empty logs "queue empty, no task. Agent stays idle."

- **Scenario**: When no tasks are in `tasks.txt` (and `TASK_CMD` is absent), monitor logs that the agent stays idle without dispatching anything.
- **Steps**:
  1. Ensure `tasks.txt` is empty: `> tasks.txt`
  2. Wait one full poll interval (15 seconds).
  3. Check the monitor log for the queue-empty message.
- **Command**:
  ```bash
  grep 'queue empty, no task' logs/monitor-*.log
  ```
- **Expected Result**: At least one line containing `queue empty, no task. Agent stays idle.` — confirming no TASK_CMD fallback fires.
- [ ] Pass

### UAT-SESSION-005: queue-empty dispatch.jsonl records queue="none" with empty command

- **Scenario**: When the queue is empty, `emit_dispatch_jsonl` is called with `queue="none"` and empty command; the JSONL record reflects this.
- **Steps**:
  1. Ensure `tasks.txt` is empty and wait one poll interval.
  2. Read the latest dispatch.jsonl records.
- **Command**:
  ```bash
  grep '"queue":"none"' logs/dispatch.jsonl
  ```
- **Expected Result**: At least one JSONL line containing `"queue":"none"` and `"command":""`, confirming no fallback command was dispatched.
- [x] Pass <!-- 2026-06-06 -->

### UAT-SESSION-006: teardown.sh sends C-c to bg windows before killing session

- **Scenario**: `teardown.sh` sends `C-c` to each bg process window before the 10-second sleep and `kill-session`.
- **Steps**:
  1. Start a session with `BG_PROCESSES=("uat-sleep:/tmp:sleep 300")`.
  2. From a second terminal, run `./scripts/teardown.sh`.
  3. Observe the teardown output.
- **Expected Result**: The teardown output includes a line `Sending C-c to bg 'uat-sleep'...` before `Waiting 10 seconds for graceful exit...`. The `uat-sleep` window is terminated.
- [x] Pass <!-- 2026-06-06 -->

---

## Cleanup

After all tests:
- [ ] Remove the `uat-sleep` entry from `conductor.conf` if added: restore `BG_PROCESSES` to its original contents
- [ ] Run `./scripts/teardown.sh` or `tmux kill-session -t conductor` to clean up any test session
- [ ] Remove scratch files: `rm -rf ./tmp/uat-015`
