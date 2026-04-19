# UAT: Verbose Dispatch State Logging

> **Source task**: [`.docs/tasks/completed/012-verbose-dispatch-logging.md`](../../tasks/completed/012-verbose-dispatch-logging.md)
> **Generated**: 2026-04-19

---

## Prerequisites

- [ ] Working directory is the repo root: `/workspaces/tmux-conductor`
- [ ] Create test directories: `mkdir -p ./tmp/uat-012-state ./tmp/uat-012-logs`
- [ ] `node --version` outputs v14 or higher
- [ ] `python3 --version` is available

---

## Syntax & Static Checks

### UAT-STATIC-001: All modified files pass syntax checks
- **Description**: All shell scripts and JS files modified by task 012 must parse cleanly
- **Steps**:
  1. Run the command below from the repo root
- **Command**:
  ```bash
  bash -n monitor.sh conductor.sh scaffold.sh agent_exec.sh && node --check hooks/lib/write-state.js hooks/on-session-start.js hooks/on-prompt-submit.js hooks/on-stop.js hooks/on-stop-failure.js && echo "All syntax checks passed"
  ```
- **Expected Result**: Prints `All syntax checks passed` with no errors or warnings
- [x] Pass <!-- 2026-04-19 -->

### UAT-STATIC-002: monitor.sh declares all six new globals
- **Description**: `LAST_DETECTION`, `LAST_STATE_VALUE`, `LAST_STATE_AGE`, `LAST_QUEUE_KIND`, `LAST_QUEUE_REMAINING`, and `DISPATCH_LOG` must be declared
- **Steps**:
  1. Run the command below
- **Command**:
  ```bash
  grep -n 'LAST_DETECTION=\|LAST_STATE_VALUE=\|LAST_STATE_AGE=\|LAST_QUEUE_KIND=\|LAST_QUEUE_REMAINING=\|DISPATCH_LOG=' monitor.sh
  ```
- **Expected Result**: At least 6 matching lines — one initialisation per variable. `DISPATCH_LOG` must reference `$LOG_DIR/dispatch.jsonl`
- [x] Pass <!-- 2026-04-19 -->

### UAT-STATIC-003: Enriched inline log lines carry detection= and queue= annotations
- **Description**: All three dispatch-related `log` call sites in `monitor.sh` must include `detection=$LAST_DETECTION`
- **Steps**:
  1. Run the command below
- **Command**:
  ```bash
  grep -n 'detection=\$LAST_DETECTION' monitor.sh
  ```
- **Expected Result**: Exactly 3 matching lines — one for idle-detected, one for task-dispatch, one for default-dispatch
- [x] Pass <!-- 2026-04-19 -->

### UAT-STATIC-004: emit_dispatch_jsonl called before mark_busy in each branch
- **Description**: In each dispatch branch `emit_dispatch_jsonl` must appear on an earlier line than the subsequent `mark_busy`
- **Steps**:
  1. Run the command below to print line numbers of both symbols
- **Command**:
  ```bash
  grep -n 'emit_dispatch_jsonl\|mark_busy' monitor.sh
  ```
- **Expected Result**: For every pair of consecutive `emit_dispatch_jsonl` / `mark_busy` lines, the `emit_dispatch_jsonl` line number is lower (comes first)
- [x] Pass <!-- 2026-04-19 -->

### UAT-STATIC-005: CONDUCTOR_LOG_DIR exported in conductor.sh
- **Description**: conductor.sh must export `CONDUCTOR_LOG_DIR` so hook processes spawned in the same tmux session inherit it
- **Steps**:
  1. Run the command below
- **Command**:
  ```bash
  grep -n 'export CONDUCTOR_LOG_DIR' conductor.sh
  ```
- **Expected Result**: At least one line matching `export CONDUCTOR_LOG_DIR="$LOG_DIR"` (or similar assignment)
- [x] Pass <!-- 2026-04-19 -->

### UAT-STATIC-006: CONDUCTOR_LOG_DIR present in scaffold.sh compose environment and volume
- **Description**: The generated `conductor-compose.yml` must set `CONDUCTOR_LOG_DIR=/conductor-logs` and mount the host log directory
- **Steps**:
  1. Run the command below
- **Command**:
  ```bash
  grep -n 'CONDUCTOR_LOG_DIR' scaffold.sh
  ```
- **Expected Result**: At least two matching lines — one for the environment variable (`CONDUCTOR_LOG_DIR=/conductor-logs`) and one for the volume bind or default path variable
- [x] Pass <!-- 2026-04-19 -->

### UAT-STATIC-007: CONDUCTOR_LOG_DIR forwarded in agent_exec.sh
- **Description**: agent_exec.sh must pass `CONDUCTOR_LOG_DIR` into container exec calls (both compose and docker branches)
- **Steps**:
  1. Run the command below
- **Command**:
  ```bash
  grep -n 'CONDUCTOR_LOG_DIR' agent_exec.sh
  ```
- **Expected Result**: Two or more matching lines — one per exec branch (compose and docker)
- [x] Pass <!-- 2026-04-19 -->

---

## Hook Logging Tests

These tests run the hook scripts directly against a temporary state directory. Run them in order — each test builds on the state left by the previous one.

### UAT-HOOK-001: session-start writes idle to hooks.jsonl with empty prev_state
- **Description**: `on-session-start.js` must write `{"ts":"…","agent":"uat-agent","event":"session-start","prev_state":"","new_state":"idle"}` to `$CONDUCTOR_LOG_DIR/hooks.jsonl`
- **Steps**:
  1. Ensure test dirs exist: `mkdir -p ./tmp/uat-012-state ./tmp/uat-012-logs`
  2. Run the command below
  3. Inspect the output line
- **Command**:
  ```bash
  CONDUCTOR_STATE_DIR=./tmp/uat-012-state CONDUCTOR_LOG_DIR=./tmp/uat-012-logs CONDUCTOR_AGENT_NAME=uat-agent node hooks/on-session-start.js < /dev/null && cat ./tmp/uat-012-logs/hooks.jsonl
  ```
- **Expected Result**: One line of valid JSON with `"agent":"uat-agent"`, `"event":"session-start"`, `"prev_state":""`, `"new_state":"idle"`, and a `"ts"` ISO 8601 timestamp
- [x] Pass <!-- 2026-04-19 -->

### UAT-HOOK-002: prompt-submit writes busy with prev_state=idle
- **Description**: `on-prompt-submit.js` must record `prev_state:"idle"` because UAT-HOOK-001 left the state file containing `idle`
- **Steps**:
  1. Run the command below (continues from UAT-HOOK-001 state)
  2. Inspect the last line of hooks.jsonl
- **Command**:
  ```bash
  CONDUCTOR_STATE_DIR=./tmp/uat-012-state CONDUCTOR_LOG_DIR=./tmp/uat-012-logs CONDUCTOR_AGENT_NAME=uat-agent node hooks/on-prompt-submit.js < /dev/null && tail -1 ./tmp/uat-012-logs/hooks.jsonl
  ```
- **Expected Result**: Last JSON line has `"event":"prompt-submit"`, `"prev_state":"idle"`, `"new_state":"busy"`
- [x] Pass <!-- 2026-04-19 -->

### UAT-HOOK-003: stop writes idle with prev_state=busy
- **Description**: `on-stop.js` must record `prev_state:"busy"` because UAT-HOOK-002 left the state file containing `busy`
- **Steps**:
  1. Run the command below (continues from UAT-HOOK-002 state)
  2. Inspect the last line of hooks.jsonl
- **Command**:
  ```bash
  CONDUCTOR_STATE_DIR=./tmp/uat-012-state CONDUCTOR_LOG_DIR=./tmp/uat-012-logs CONDUCTOR_AGENT_NAME=uat-agent node hooks/on-stop.js < /dev/null && tail -1 ./tmp/uat-012-logs/hooks.jsonl
  ```
- **Expected Result**: Last JSON line has `"event":"stop"`, `"prev_state":"busy"`, `"new_state":"idle"`
- [x] Pass <!-- 2026-04-19 -->

### UAT-HOOK-004: stop-failure writes idle with correct event name
- **Description**: `on-stop-failure.js` must record `"event":"stop-failure"` (hyphen, not underscore)
- **Steps**:
  1. Run the command below
  2. Inspect the last line of hooks.jsonl
- **Command**:
  ```bash
  CONDUCTOR_STATE_DIR=./tmp/uat-012-state CONDUCTOR_LOG_DIR=./tmp/uat-012-logs CONDUCTOR_AGENT_NAME=uat-agent node hooks/on-stop-failure.js < /dev/null && tail -1 ./tmp/uat-012-logs/hooks.jsonl
  ```
- **Expected Result**: Last JSON line has `"event":"stop-failure"` and `"new_state":"idle"`
- [x] Pass <!-- 2026-04-19 -->

### UAT-HOOK-005: CONDUCTOR_LOG_DIR defaults to /conductor-logs when unset
- **Description**: If `CONDUCTOR_LOG_DIR` is not set, write-state.js must use `/conductor-logs` as the default log directory (the path must not be empty or undefined)
- **Steps**:
  1. Run the command below — inspect the error or the written path
- **Command**:
  ```bash
  grep -n 'conductor-logs' hooks/lib/write-state.js
  ```
- **Expected Result**: At least one line showing the string `/conductor-logs` used as a default value (e.g. `|| '/conductor-logs'` or `?? '/conductor-logs'`)
- [x] Pass <!-- 2026-04-19 -->

### UAT-HOOK-006: hooks.jsonl has one record per hook invocation (no duplicates, no missing)
- **Description**: After UAT-HOOK-001 through UAT-HOOK-004, hooks.jsonl must contain exactly 4 lines
- **Steps**:
  1. Run the command below
- **Command**:
  ```bash
  wc -l < ./tmp/uat-012-logs/hooks.jsonl
  ```
- **Expected Result**: `4` (session-start, prompt-submit, stop, stop-failure — one record each)
- [x] Pass <!-- 2026-04-19 -->

---

## Dispatch Logging Integration

These tests require a live tmux session. The full integration verification is manual.

### UAT-INT-001: dispatch.jsonl written with all required fields
- **Description**: After dispatching a task via monitor.sh, `$LOG_DIR/dispatch.jsonl` must contain a valid JSON record with all nine fields
- **Steps**:
  1. Start a conductor session: `./conductor.sh`
  2. Wait for the agent to reach idle state (state file contains `idle`)
  3. Add a global task to the queue file (e.g. `echo 'echo hello' >> tasks.txt`)
  4. Wait for monitor to dispatch the task (one poll cycle)
  5. Inspect the dispatch log
- **Command**:
  ```bash
  tail -1 logs/dispatch.jsonl | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print('\n'.join(f'{k}: {v}' for k,v in d.items()))"
  ```
- **Expected Result**: Output shows all nine fields: `ts` (ISO 8601), `agent` (agent name), `command` (the echoed task), `state`, `state_age_s`, `detection`, `queue`, `queue_remaining`, `pane_tail` (a JSON array)
- [x] Pass <!-- 2026-04-19 -->

### UAT-INT-002: queue field reflects dispatch source correctly
- **Description**: dispatch.jsonl records must use `"queue":"scoped"` for agent-prefixed tasks and `"queue":"global"` for unprefixed tasks
- **Steps**:
  1. Add a scoped task: `echo 'agent0: echo scoped' >> tasks.txt`
  2. Add a global task: `echo 'echo global' >> tasks.txt`
  3. Wait for both to be dispatched
  4. Inspect the last two records
- **Command**:
  ```bash
  tail -2 logs/dispatch.jsonl | python3 -c "import sys,json; [print(json.loads(l)['queue']) for l in sys.stdin]"
  ```
- **Expected Result**: Prints `scoped` then `global` (or `global` then `scoped` depending on which agent picks each up)
- [x] Pass <!-- 2026-04-19 -->

### UAT-INT-003: Inline log lines include detection= and queue= in monitor log file
- **Description**: The monitor log (`logs/monitor-*.log`) must show enriched lines for every dispatch
- **Steps**:
  1. After a dispatch has occurred (from UAT-INT-001 or UAT-INT-002), inspect the monitor log
- **Command**:
  ```bash
  grep 'detection=' logs/monitor-*.log | tail -5
  ```
- **Expected Result**: Lines matching the pattern `dispatching task [queue=<kind> remaining=<n> detection=<method>]: <cmd>` or `idle detected (detection=<method> state=<value> age=<n>s)`
- [x] Pass <!-- 2026-04-19 -->

### UAT-INT-004: Tear down cleanly and verify no stray processes
- **Description**: After the session, teardown should complete without orphaned processes
- **Steps**:
  1. Run teardown: `./teardown.sh`
  2. Verify the tmux session is gone
  3. Verify log files persist and are readable
- **Command**:
  ```bash
  tmux ls 2>&1 && ls -lh logs/dispatch.jsonl logs/hooks.jsonl 2>/dev/null || echo "Session gone, checking logs..."
  ```
- **Expected Result**: `tmux ls` shows no conductor session (or reports "no server running"). `dispatch.jsonl` and `hooks.jsonl` (if agent ran in container) are present and non-empty
- [x] Pass <!-- 2026-04-19 -->
