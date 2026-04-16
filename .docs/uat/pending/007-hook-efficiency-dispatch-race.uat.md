# UAT: Hook Efficiency + Dispatch Race Fix

> **Source task**: [`.docs/tasks/active/007-hook-efficiency-dispatch-race.md`](../../tasks/active/007-hook-efficiency-dispatch-race.md)
> **Generated**: 2026-04-14

---

## Prerequisites

- [ ] Working directory is the repo root (`/workspaces/tmux-conductor` or equivalent)
- [ ] `bash` >= 4 available
- [ ] `jq` installed (for scaffold tests)
- [ ] `./tmp/` directory is clean or absent (tests create and clean up their own subdirs)

---

## Edge Case Tests

### UAT-EDGE-001: Hook writes `working` on UserPromptSubmit only

- **Scenario**: `UserPromptSubmit` event → state file must contain `working`; verifies `PreToolUse` is no longer joined in the same case branch
- **Steps**:
  1. Run the command below. It drives the hook with `UserPromptSubmit` and reads back the state file.
- **Command**:
  ```bash
  mkdir -p ./tmp/uat-007-e1 && CONDUCTOR_STATE_DIR=./tmp/uat-007-e1 CONDUCTOR_AGENT_NAME=e1 bash hooks/claude-hook.sh UserPromptSubmit < /dev/null && cat ./tmp/uat-007-e1/e1.state && rm -rf ./tmp/uat-007-e1
  ```
- **Expected Result**: Output is exactly `working`
- [ ] Pass

### UAT-EDGE-002: Hook writes `done` on Stop

- **Scenario**: `Stop` event → state file contains `done`
- **Steps**:
  1. Run the command below.
- **Command**:
  ```bash
  mkdir -p ./tmp/uat-007-e2 && CONDUCTOR_STATE_DIR=./tmp/uat-007-e2 CONDUCTOR_AGENT_NAME=e2 bash hooks/claude-hook.sh Stop < /dev/null && cat ./tmp/uat-007-e2/e2.state && rm -rf ./tmp/uat-007-e2
  ```
- **Expected Result**: Output is exactly `done`
- [ ] Pass

### UAT-EDGE-003: Hook writes `wait` on Notification

- **Scenario**: `Notification` event → state file contains `wait`
- **Steps**:
  1. Run the command below.
- **Command**:
  ```bash
  mkdir -p ./tmp/uat-007-e3 && CONDUCTOR_STATE_DIR=./tmp/uat-007-e3 CONDUCTOR_AGENT_NAME=e3 bash hooks/claude-hook.sh Notification < /dev/null && cat ./tmp/uat-007-e3/e3.state && rm -rf ./tmp/uat-007-e3
  ```
- **Expected Result**: Output is exactly `wait`
- [ ] Pass

### UAT-EDGE-004: PreToolUse event is a no-op (state file unchanged)

- **Scenario**: `PreToolUse` was removed in task 007. Sending it must leave the state file untouched.
- **Steps**:
  1. Run the command below. It seeds the state file with `done`, fires `PreToolUse`, then reads the file — it must still say `done`.
- **Command**:
  ```bash
  mkdir -p ./tmp/uat-007-e4 && printf 'done\n' > ./tmp/uat-007-e4/e4.state && CONDUCTOR_STATE_DIR=./tmp/uat-007-e4 CONDUCTOR_AGENT_NAME=e4 bash hooks/claude-hook.sh PreToolUse < /dev/null && cat ./tmp/uat-007-e4/e4.state && rm -rf ./tmp/uat-007-e4
  ```
- **Expected Result**: Output is exactly `done` (state unchanged by `PreToolUse`)
- [ ] Pass

### UAT-EDGE-005: Hook syntax check passes

- **Scenario**: `bash -n` must report no syntax errors after task 007 edits
- **Steps**:
  1. Run the command below.
- **Command**:
  ```bash
  bash -n hooks/claude-hook.sh && echo OK
  ```
- **Expected Result**: Output is exactly `OK` with exit code 0
- [ ] Pass

### UAT-EDGE-006: monitor.sh and scaffold.sh syntax checks pass

- **Scenario**: All three modified scripts must be syntax-clean
- **Steps**:
  1. Run the command below.
- **Command**:
  ```bash
  bash -n monitor.sh hooks/claude-hook.sh scaffold.sh && echo ALL_PASS
  ```
- **Expected Result**: Output is exactly `ALL_PASS` with exit code 0
- [ ] Pass

### UAT-EDGE-007: mark_dispatching writes `dispatching` to state file

- **Scenario**: `mark_dispatching()` in `monitor.sh` must atomically write `dispatching` to `$STATE_DIR/<name>.state` before `dispatch` is called
- **Steps**:
  1. Run the command below. It sources just `mark_dispatching` from `monitor.sh` inline and invokes it.
- **Command**:
  ```bash
  mkdir -p ./tmp/uat-007-e7 && STATE_DIR=./tmp/uat-007-e7 DEBUG=0 && mark_dispatching() { local name="$1"; [ -n "$name" ] || return 0; local state_file="${STATE_DIR}/${name}.state"; printf 'dispatching\n' > "$state_file" 2>/dev/null || true; } && mark_dispatching agent1 && cat ./tmp/uat-007-e7/agent1.state && rm -rf ./tmp/uat-007-e7
  ```
- **Expected Result**: Output is exactly `dispatching`
- [ ] Pass

### UAT-EDGE-008: mark_dispatching with empty name is a no-op

- **Scenario**: If the agent name is empty, `mark_dispatching` must return without touching the filesystem
- **Steps**:
  1. Run the command below. It calls `mark_dispatching ""` and verifies no state file is created.
- **Command**:
  ```bash
  mkdir -p ./tmp/uat-007-e8 && STATE_DIR=./tmp/uat-007-e8 && mark_dispatching() { local name="$1"; [ -n "$name" ] || return 0; local state_file="${STATE_DIR}/${name}.state"; printf 'dispatching\n' > "$state_file" 2>/dev/null || true; } && mark_dispatching "" && ls ./tmp/uat-007-e8/ | wc -l | tr -d ' ' && rm -rf ./tmp/uat-007-e8
  ```
- **Expected Result**: Output is exactly `0` (no files created)
- [ ] Pass

---

## Integration Tests

### UAT-INT-001: Hook full state-machine sequence

- **Components**: `hooks/claude-hook.sh`, `$STATE_DIR/<agent>.state`
- **Flow**: Drive all three active events in sequence and confirm state transitions match the new three-event contract
- **Steps**:
  1. Run the command below. It fires each event in turn and prints `<event> -> <state>` on its own line.
- **Command**:
  ```bash
  mkdir -p ./tmp/uat-007-i1 && for ev in UserPromptSubmit Stop Notification; do CONDUCTOR_STATE_DIR=./tmp/uat-007-i1 CONDUCTOR_AGENT_NAME=seq bash hooks/claude-hook.sh "$ev" < /dev/null; printf '%s -> %s\n' "$ev" "$(cat ./tmp/uat-007-i1/seq.state)"; done && rm -rf ./tmp/uat-007-i1
  ```
- **Expected Result**:
  ```
  UserPromptSubmit -> working
  Stop -> done
  Notification -> wait
  ```
- [ ] Pass

### UAT-INT-002: Scaffold renders init script with no PreToolUse hook entry

- **Components**: `scaffold.sh`, generated `.devcontainer/init-claude-config.sh`
- **Flow**: Run scaffold against a throwaway directory, grep the rendered init script for `PreToolUse` in a hook registration context — must be absent. Only occurrence allowed is `del(.PreToolUse)` (the scrubbing line).
- **Steps**:
  1. Run the scaffold to generate the init script.
  2. Grep for any hook registration lines containing `PreToolUse` — expect 0.
  3. Confirm all three active events are registered — expect exactly 3.
- **Command (step 1 — scaffold)**:
  ```bash
  mkdir -p ./tmp/uat-007-i2/target && bash scaffold.sh ./tmp/uat-007-i2/target --force > /dev/null && echo SCAFFOLD_OK
  ```
- **Expected Result**: `SCAFFOLD_OK`
- [ ] Pass
- **Command (step 2 — no hook registration for PreToolUse)**:
  ```bash
  grep -c '"PreToolUse"' ./tmp/uat-007-i2/target/.devcontainer/init-claude-config.sh
  ```
- **Expected Result**: `0`
- [ ] Pass
- **Command (step 3 — three active hook events present)**:
  ```bash
  grep -cE '"(UserPromptSubmit|Stop|Notification)"' ./tmp/uat-007-i2/target/.devcontainer/init-claude-config.sh && rm -rf ./tmp/uat-007-i2
  ```
- **Expected Result**: `3`
- [ ] Pass

### UAT-INT-003: Scaffold del(.PreToolUse) scrubs pre-existing entry

- **Components**: `scaffold.sh`, `jq`, `init-claude-config.sh` heredoc jq expression
- **Flow**: Simulate a settings.json that already has a `PreToolUse` hook (left by a pre-007 scaffold). Run the jq expression from the init script against it and confirm `PreToolUse` is gone from the output.
- **Steps**:
  1. Build a simulated `settings.json` containing a `PreToolUse` hook entry.
  2. Apply the jq merge expression (extracted from the generated init script) to it.
  3. Confirm `PreToolUse` key is absent in the result; `UserPromptSubmit`, `Stop`, `Notification` are present.
- **Command**:
  ```bash
  mkdir -p ./tmp/uat-007-i3 && printf '{"hooks":{"PreToolUse":[{"hooks":[{"type":"command","command":"/old-hook.sh PreToolUse"}]}]}}\n' > ./tmp/uat-007-i3/settings.json && jq --arg cmd '/conductor-hooks/claude-hook.sh' '.hooks = ((.hooks // {}) | del(.PreToolUse)) | .hooks |= (.UserPromptSubmit = ((.UserPromptSubmit // []) + [{"hooks":[{"type":"command","command":($cmd + " UserPromptSubmit")}]}]) | .Stop = ((.Stop // []) + [{"hooks":[{"type":"command","command":($cmd + " Stop")}]}]) | .Notification = ((.Notification // []) + [{"hooks":[{"type":"command","command":($cmd + " Notification")}]}]))' ./tmp/uat-007-i3/settings.json | jq '.hooks | keys' && rm -rf ./tmp/uat-007-i3
  ```
- **Expected Result**: `["Notification","Stop","UserPromptSubmit"]` (no `PreToolUse`)
- [ ] Pass

### UAT-INT-004: is_idle treats dispatching as busy (fresh state file)

- **Components**: `monitor.sh` `is_idle()` function, `$STATE_DIR/<agent>.state`
- **Flow**: Write `dispatching` to a fresh state file and verify the state-file branch of `is_idle()` returns 1 (busy), not 0 (idle). Uses the logic inline to avoid needing a live tmux session.
- **Steps**:
  1. Run the command below. It inlines the state-file branch of `is_idle()` (no tmux fallback) and tests all four state values.
- **Command**:
  ```bash
  mkdir -p ./tmp/uat-007-i4 && bash -c 'STATE_DIR=./tmp/uat-007-i4; POLL_INTERVAL=60; debug(){ :; }; is_idle_state(){ local name="$1" state_file="$STATE_DIR/$1.state"; [ -f "$state_file" ] || return 0; local now mtime age max_age state; now=$(date +%s); mtime=$(stat -f %m "$state_file" 2>/dev/null || stat -c %Y "$state_file" 2>/dev/null || echo 0); age=$(( now - mtime )); max_age=$(( POLL_INTERVAL * 2 )); [ "$age" -le "$max_age" ] || return 0; state=$(cat "$state_file"); case "$state" in done) return 0;; working|wait|dispatching) return 1;; esac; return 0; }; for s in done working wait dispatching; do printf "%s\n" "$s" > "$STATE_DIR/a.state"; is_idle_state a && r=idle || r=busy; printf "%s -> %s\n" "$s" "$r"; done' && rm -rf ./tmp/uat-007-i4
  ```
- **Expected Result**:
  ```
  done -> idle
  working -> busy
  wait -> busy
  dispatching -> busy
  ```
- [ ] Pass

---

## End-to-End Tests (requires live Docker + tmux)

> **Note**: These tests require a live `conductor` tmux session with at least one containerized Claude Code agent. They are blocked in the devcontainer environment. Run them on the host after standing up a full conductor session.

### UAT-E2E-001: Container settings.json has exactly three hook events after scaffold rebuild

- **Components**: `scaffold.sh`, Docker container, `~/.claude/settings.json` inside the container
- **Prerequisites**:
  - [ ] A target project directory with `conductor-compose.yml` regenerated by this version of `scaffold.sh`
  - [ ] Container started fresh (`docker compose up -d --build`)
- **Steps**:
  1. Build and start the container.
  2. Query hook keys inside the running container.
- **Command**:
  ```bash
  docker compose -f conductor-compose.yml exec app jq '.hooks | keys' ~/.claude/settings.json
  ```
- **Expected Result**: `["Notification","Stop","UserPromptSubmit"]`
- [ ] Pass

### UAT-E2E-002: No double-dispatch — tasks.txt drains one line per idle cycle

- **Components**: `monitor.sh`, `tasks.txt`, `$STATE_DIR/<agent>.state`, `logs/monitor-*.log`
- **Prerequisites**:
  - [ ] At least 3 entries in `tasks.txt`
  - [ ] `monitor.sh` started, at least one agent container running and idle
- **Steps**:
  1. Watch `tasks.txt` line count and the state file during one monitor cycle.
  2. After each dispatch, check logs for exactly one "dispatching task" line per queue entry consumed.
- **Expected Result**: Each entry in `tasks.txt` consumed exactly once; no back-to-back `dispatching` writes without an intervening `done`; `logs/monitor-*.log` shows exactly one `dispatching task` line per queue entry
- [ ] Pass

### UAT-E2E-003: dispatching → working → done state sequence under normal operation

- **Components**: `monitor.sh`, `hooks/claude-hook.sh` inside container, `$STATE_DIR/<agent>.state`
- **Prerequisites**:
  - [ ] One queued task in `tasks.txt`
  - [ ] `monitor.sh` running
- **Steps**:
  1. Watch the state file at `logs/state/<agent>.state` while `monitor.sh` processes one task:
     ```bash
     while true; do printf '%s: ' "$(date +%H:%M:%S)"; cat logs/state/<agent>.state 2>/dev/null || echo "(none)"; echo; sleep 0.3; done
     ```
- **Expected Result**: State transitions in order: `done` (pre-dispatch) → `dispatching` (written by monitor before send-keys) → `working` (written by hook on UserPromptSubmit) → `done` (written by hook on Stop). No second `dispatching` write after the first `working`.
- [ ] Pass
