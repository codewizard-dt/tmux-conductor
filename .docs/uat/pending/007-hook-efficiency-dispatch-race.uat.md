# UAT: Hook Efficiency + Dispatch Race Fix

> **Source task**: [`.docs/tasks/active/007-hook-efficiency-dispatch-race.md`](../../tasks/active/007-hook-efficiency-dispatch-race.md)
> **Generated**: 2026-04-16

---

## Prerequisites

- [ ] Working directory is the repo root (`/workspaces/tmux-conductor` or equivalent)
- [ ] `bash` >= 4 available on PATH
- [ ] `jq` installed (required for UAT-SH-011 through UAT-INT-003)
- [ ] `./tmp/` directory is clean or absent — tests create and clean up their own subdirs

---

## Shell / Script Tests

### UAT-SH-001: Syntax check — all per-event hook scripts and modified scripts

- **Scope**: Every script created or modified by task 007 must parse without errors.
- **Steps**:
  1. Run the command below from the repo root.
- **Command**:
  ```bash
  bash -n hooks/on-prompt-submit.sh hooks/on-stop.sh hooks/on-stop-failure.sh hooks/on-notification.sh hooks/install-hooks.sh monitor.sh scaffold.sh && echo ALL_PASS
  ```
- **Expected Result**: Output is exactly `ALL_PASS` with exit code 0. Any parse error names the offending script.
- [ ] Pass

---

### UAT-SH-002: Per-event hook scripts are executable

- **Scope**: Task 007 required all four hook scripts and `install-hooks.sh` to be `chmod +x`. Verifies that requirement holds.
- **Steps**:
  1. Run the command below.
- **Command**:
  ```bash
  for f in hooks/on-prompt-submit.sh hooks/on-stop.sh hooks/on-stop-failure.sh hooks/on-notification.sh hooks/install-hooks.sh; do test -x "$f" && echo "$f: OK" || echo "$f: NOT EXECUTABLE"; done
  ```
- **Expected Result**: Five lines all ending in `OK`.
- [ ] Pass

---

### UAT-SH-003: on-prompt-submit.sh writes `working` on UserPromptSubmit

- **Scope**: `on-prompt-submit.sh` must write `working\n` to `$CONDUCTOR_STATE_DIR/$CONDUCTOR_AGENT_NAME.state`.
- **Steps**:
  1. Run the command below. It drives the script with env vars and reads back the state file.
- **Command**:
  ```bash
  mkdir -p ./tmp/uat-007 && CONDUCTOR_STATE_DIR=./tmp/uat-007 CONDUCTOR_AGENT_NAME=uat bash hooks/on-prompt-submit.sh < /dev/null && cat ./tmp/uat-007/uat.state
  ```
- **Expected Result**: Output is exactly `working`
- [ ] Pass

---

### UAT-SH-004: on-stop.sh writes `done` on Stop

- **Scope**: `on-stop.sh` must write `done\n` to the state file.
- **Steps**:
  1. Depends on UAT-SH-003 having created `./tmp/uat-007/`. Run the command below.
- **Command**:
  ```bash
  CONDUCTOR_STATE_DIR=./tmp/uat-007 CONDUCTOR_AGENT_NAME=uat bash hooks/on-stop.sh < /dev/null && cat ./tmp/uat-007/uat.state
  ```
- **Expected Result**: Output is exactly `done`
- [ ] Pass

---

### UAT-SH-005: on-stop-failure.sh writes `done` on StopFailure

- **Scope**: An API-error–terminated turn (`StopFailure`) must mark the agent as idle (`done`). This is identical to `Stop` behaviour, implemented via a separate script.
- **Steps**:
  1. Depends on `./tmp/uat-007/` existing (created by UAT-SH-003). Run the command below.
- **Command**:
  ```bash
  CONDUCTOR_STATE_DIR=./tmp/uat-007 CONDUCTOR_AGENT_NAME=uat bash hooks/on-stop-failure.sh < /dev/null && cat ./tmp/uat-007/uat.state
  ```
- **Expected Result**: Output is exactly `done`
- [ ] Pass

---

### UAT-SH-006: on-notification.sh routes `idle_prompt` → `done`

- **Scope**: An `idle_prompt` Notification means the agent is truly idle. The script must write `done`, preventing a late Notification from overwriting Stop's `done` with `wait`.
- **Steps**:
  1. Pipe a JSON payload with `notification_type: idle_prompt` to the script. Depends on `./tmp/uat-007/` existing.
- **Command**:
  ```bash
  printf '{"notification_type":"idle_prompt"}' | CONDUCTOR_STATE_DIR=./tmp/uat-007 CONDUCTOR_AGENT_NAME=uat bash hooks/on-notification.sh && cat ./tmp/uat-007/uat.state
  ```
- **Expected Result**: Output is exactly `done`
- [ ] Pass

---

### UAT-SH-007: on-notification.sh routes `permission_prompt` → `wait`

- **Scope**: A `permission_prompt` Notification means the agent is paused awaiting user approval. The script must write `wait` so the monitor treats the agent as busy.
- **Steps**:
  1. Pipe a JSON payload with `notification_type: permission_prompt`. Depends on `./tmp/uat-007/` existing.
- **Command**:
  ```bash
  printf '{"notification_type":"permission_prompt"}' | CONDUCTOR_STATE_DIR=./tmp/uat-007 CONDUCTOR_AGENT_NAME=uat bash hooks/on-notification.sh && cat ./tmp/uat-007/uat.state
  ```
- **Expected Result**: Output is exactly `wait`
- [ ] Pass

---

### UAT-SH-008: on-notification.sh routes `elicitation_dialog` → `wait`

- **Scope**: An `elicitation_dialog` Notification (MCP user-input dialog) is the same as `permission_prompt` from the monitor's perspective — agent is paused, must be treated as busy.
- **Steps**:
  1. Pipe `notification_type: elicitation_dialog`. Depends on `./tmp/uat-007/` existing.
- **Command**:
  ```bash
  printf '{"notification_type":"elicitation_dialog"}' | CONDUCTOR_STATE_DIR=./tmp/uat-007 CONDUCTOR_AGENT_NAME=uat bash hooks/on-notification.sh && cat ./tmp/uat-007/uat.state
  ```
- **Expected Result**: Output is exactly `wait`
- [ ] Pass

---

### UAT-SH-009: on-notification.sh routes `auth_success` → no-op (state unchanged)

- **Scope**: `auth_success` is informational. The script must leave the state file exactly as it was — no write.
- **Steps**:
  1. Pre-seed the state file with `done`. Then send `auth_success`. State must remain `done`.
- **Command**:
  ```bash
  printf 'done\n' > ./tmp/uat-007/uat.state && printf '{"notification_type":"auth_success"}' | CONDUCTOR_STATE_DIR=./tmp/uat-007 CONDUCTOR_AGENT_NAME=uat bash hooks/on-notification.sh && cat ./tmp/uat-007/uat.state
  ```
- **Expected Result**: Output is exactly `done` (unchanged)
- [ ] Pass

---

### UAT-SH-010: on-notification.sh info-logs unknown types and leaves state unchanged

- **Scope**: Any `notification_type` not in the four known values must be logged to `$STATE_DIR/hook.log` with the full payload, and the state file must remain untouched.
- **Steps**:
  1. Pre-seed the state file with `done`. Send a payload with an unmapped type.
  2. Check that state is still `done`.
  3. Check that `hook.log` contains a `(no state mapping)` entry for the unmapped type.
- **Command (step 1–2 — state unchanged)**:
  ```bash
  printf 'done\n' > ./tmp/uat-007/uat.state && printf '{"notification_type":"mystery_event","detail":"test"}' | CONDUCTOR_STATE_DIR=./tmp/uat-007 CONDUCTOR_AGENT_NAME=uat bash hooks/on-notification.sh && cat ./tmp/uat-007/uat.state
  ```
- **Expected Result**: Output is exactly `done`
- [ ] Pass
- **Command (step 3 — hook.log entry)**:
  ```bash
  grep -c 'no state mapping' ./tmp/uat-007/hook.log
  ```
- **Expected Result**: `1` (exactly one log entry for the unmapped type; the line also includes the full payload `{"notification_type":"mystery_event","detail":"test"}`)
- [ ] Pass

---

### UAT-SH-011: install-hooks.sh creates settings.json with exactly four hook events

- **Scope**: `install-hooks.sh` must register `UserPromptSubmit`, `Stop`, `StopFailure`, and `Notification` — no more, no less.
- **Steps**:
  1. Run the script against a fresh temp settings file.
  2. Verify the output JSON has exactly the four expected keys.
- **Command**:
  ```bash
  mkdir -p ./tmp/uat-007-install && bash hooks/install-hooks.sh --hook-dir "$(pwd)/hooks" --settings-file ./tmp/uat-007-install/settings.json && jq '.hooks | keys' ./tmp/uat-007-install/settings.json
  ```
- **Expected Result**: `["Notification","Stop","StopFailure","UserPromptSubmit"]`
- [ ] Pass

---

### UAT-SH-012: install-hooks.sh removes stale `PreToolUse` from existing settings

- **Scope**: Containers initialised by pre-task-007 scaffolds may have `PreToolUse` in their settings. `install-hooks.sh` must delete it so the defunct hook no longer fires.
- **Steps**:
  1. Seed the temp settings file with a `PreToolUse` entry.
  2. Run `install-hooks.sh`. Verify `PreToolUse` is gone, four new keys are present.
- **Command**:
  ```bash
  printf '{"hooks":{"PreToolUse":[{"type":"command","command":"/old/claude-hook.sh"}]}}\n' > ./tmp/uat-007-install/settings.json && bash hooks/install-hooks.sh --hook-dir "$(pwd)/hooks" --settings-file ./tmp/uat-007-install/settings.json && jq '.hooks | keys' ./tmp/uat-007-install/settings.json
  ```
- **Expected Result**: `["Notification","Stop","StopFailure","UserPromptSubmit"]` — `PreToolUse` absent.
- [ ] Pass

---

### UAT-SH-013: install-hooks.sh bakes the provided `--hook-dir` into hook command paths

- **Scope**: Each hook entry's `command` field must be an absolute path constructed from `--hook-dir`. This is what allows the container to call `/conductor-hooks/on-stop.sh` etc. at runtime.
- **Steps**:
  1. Run the script with `--hook-dir /conductor-hooks`.
  2. Inspect the `Stop` hook's command value.
- **Command**:
  ```bash
  bash hooks/install-hooks.sh --hook-dir /conductor-hooks --settings-file ./tmp/uat-007-install/settings.json && jq -r '.hooks.Stop[0].command' ./tmp/uat-007-install/settings.json && rm -rf ./tmp/uat-007-install
  ```
- **Expected Result**: `/conductor-hooks/on-stop.sh`
- [ ] Pass

---

## Cleanup (hook script tests)

- **Steps**:
  1. Remove the shared temp directory used by UAT-SH-003 through UAT-SH-010.
- **Command**:
  ```bash
  rm -rf ./tmp/uat-007 && echo CLEANED
  ```
- **Expected Result**: `CLEANED`
- [ ] Pass

---

## Integration Tests

### UAT-INT-001: Scaffold-generated init-claude-config.sh calls install-hooks.sh

- **Scope**: `scaffold.sh` must emit `/conductor-hooks/install-hooks.sh` in the generated `init-claude-config.sh` instead of the old inline `jq` hook-merge block.
- **Steps**:
  1. Run scaffold against a throwaway directory.
  2. Grep the init script for the install-hooks.sh invocation.
- **Command (step 1 — scaffold)**:
  ```bash
  mkdir -p ./tmp/uat-007-scaffold && bash scaffold.sh ./tmp/uat-007-scaffold --force > /dev/null && echo SCAFFOLD_OK
  ```
- **Expected Result**: `SCAFFOLD_OK`
- [ ] Pass
- **Command (step 2 — install-hooks.sh call present)**:
  ```bash
  grep -c '/conductor-hooks/install-hooks.sh' ./tmp/uat-007-scaffold/.devcontainer/init-claude-config.sh
  ```
- **Expected Result**: `1` (exactly one call to install-hooks.sh)
- [ ] Pass

---

### UAT-INT-002: Scaffold-generated init-claude-config.sh contains no inline jq hook-merge

- **Scope**: The old pattern (`jq '.hooks.UserPromptSubmit = ...'`) must be absent — registration is fully delegated to `install-hooks.sh`.
- **Steps**:
  1. Depends on `./tmp/uat-007-scaffold/` from UAT-INT-001. Grep for the old jq pattern; expect no match.
- **Command**:
  ```bash
  grep 'hooks.UserPromptSubmit' ./tmp/uat-007-scaffold/.devcontainer/init-claude-config.sh || echo ABSENT
  ```
- **Expected Result**: `ABSENT` (grep found nothing; the `||` branch fires)
- [ ] Pass

---

### UAT-INT-003: conductor-compose.yml mounts hooks volume at `/conductor-hooks:ro`

- **Scope**: The generated compose file must bind-mount the repo's `hooks/` directory as `/conductor-hooks:ro` so `install-hooks.sh` and the per-event scripts are reachable at runtime.
- **Steps**:
  1. Depends on `./tmp/uat-007-scaffold/` from UAT-INT-001. Grep the compose file for the volume mount.
- **Command**:
  ```bash
  grep 'conductor-hooks' ./tmp/uat-007-scaffold/conductor-compose.yml && rm -rf ./tmp/uat-007-scaffold
  ```
- **Expected Result**: A line containing `conductor-hooks:ro` — e.g. `/workspaces/tmux-conductor/hooks:/conductor-hooks:ro`. The `rm` cleans up the scaffold test directory.
- [ ] Pass

---

### UAT-INT-004: is_idle treats `dispatching` as busy (same as `working`/`wait`)

- **Scope**: `mark_dispatching()` in `monitor.sh` writes `dispatching` to the state file immediately before `dispatch` is called; `is_idle()` must return 1 (busy) for this value. This closes the race window between dispatch and the agent's first `UserPromptSubmit` hook write.
- **Steps**:
  1. Run the command below. It inlines the relevant logic from `monitor.sh`'s `is_idle()` state-file branch (no tmux required) and tests all four state values.
- **Command**:
  ```bash
  mkdir -p ./tmp/uat-007-dispatch && bash -c 'STATE_DIR=./tmp/uat-007-dispatch; POLL_INTERVAL=86400; is_idle_state(){ local sf="$STATE_DIR/$1.state"; [ -f "$sf" ] || return 0; local now mtime age; now=$(date +%s); mtime=$(stat -f %m "$sf" 2>/dev/null || stat -c %Y "$sf" 2>/dev/null || echo 0); age=$(( now - mtime )); [ "$age" -le $(( POLL_INTERVAL * 2 )) ] || return 0; local s; s=$(cat "$sf"); case "$s" in done) return 0;; working|wait|dispatching) return 1;; esac; return 0; }; for s in done working wait dispatching; do printf "%s\n" "$s" > "$STATE_DIR/a.state"; is_idle_state a && r=idle || r=busy; printf "%s -> %s\n" "$s" "$r"; done' && rm -rf ./tmp/uat-007-dispatch
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

> **Note**: These tests require a live `conductor` tmux session with at least one containerized Claude Code agent. They are blocked in the devcontainer development environment. Run them on the host after standing up a full conductor session with a freshly scaffolded + rebuilt container.

### UAT-E2E-001: Container settings.json has exactly four hook events and no PreToolUse

- **Components**: `scaffold.sh`, Docker container, `~/.claude/settings.json` inside the container
- **Prerequisites**:
  - [ ] A target project directory with `conductor-compose.yml` regenerated by this version of `scaffold.sh`
  - [ ] Container started fresh: `docker compose -f conductor-compose.yml up -d --build`
- **Steps**:
  1. Build and start the container (fresh build ensures `init-claude-config.sh` runs).
  2. Query hook keys inside the running container.
- **Command**:
  ```bash
  docker compose -f conductor-compose.yml exec app jq '.hooks | keys' ~/.claude/settings.json
  ```
- **Expected Result**: `["Notification","Stop","StopFailure","UserPromptSubmit"]` — exactly four events, `PreToolUse` absent.
- [ ] Pass

---

### UAT-E2E-002: dispatching → working → done state sequence under normal operation

- **Components**: `monitor.sh`, per-event hooks inside container, `$STATE_DIR/<agent>.state`
- **Prerequisites**:
  - [ ] One queued task in `tasks.txt`
  - [ ] `monitor.sh` running
- **Steps**:
  1. Watch the state file while `monitor.sh` processes one task:
     ```bash
     while true; do printf '%s: ' "$(date +%H:%M:%S)"; cat logs/state/<agent>.state 2>/dev/null || echo "(none)"; sleep 0.3; done
     ```
- **Expected Result**: State transitions in order: `done` (pre-dispatch) → `dispatching` (monitor writes before `send-keys`) → `working` (`on-prompt-submit.sh` fires) → `done` (`on-stop.sh` fires). No second `dispatching` write after the first `working`.
- [ ] Pass

---

### UAT-E2E-003: No double-dispatch — tasks.txt drains one line per idle cycle

- **Components**: `monitor.sh`, `tasks.txt`, `$STATE_DIR/<agent>.state`, `logs/monitor-*.log`
- **Prerequisites**:
  - [ ] At least 3 entries in `tasks.txt`
  - [ ] `monitor.sh` running, at least one agent container idle
- **Steps**:
  1. Watch `tasks.txt` line count during one full monitor cycle.
  2. After the cycle, check the monitor log for exactly one `dispatching task` line per queue entry consumed.
- **Expected Result**: Each entry in `tasks.txt` consumed exactly once. `logs/monitor-*.log` shows one `dispatching task` line per queue entry. No back-to-back `dispatching` writes without an intervening `done` in the state file.
- [ ] Pass
