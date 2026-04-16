# 007 — Hook Efficiency, Dispatch Race Fix, and Per-Event Hook Centralization

## Objective

Split `hooks/claude-hook.sh` into self-contained per-event scripts with centralized registration, eliminate the duplicate-dispatch race, drop redundant `PreToolUse`, add `StopFailure` handling, and parse `Notification` subtypes to prevent overwriting a correct `done` state with `wait`.

## Approach

Five areas in one task. (1) Each Claude Code lifecycle event gets its own script in `hooks/` — `on-prompt-submit.sh`, `on-stop.sh`, `on-stop-failure.sh`, `on-notification.sh` — replacing the monolithic `claude-hook.sh`. A new `hooks/install-hooks.sh` encapsulates the jq merge that registers these hooks into `~/.claude/settings.json`, and `scaffold.sh` calls it instead of inlining jq. (2) `monitor.sh` writes a `dispatching` state immediately after calling `dispatch.sh` to close the race window. (3) `PreToolUse` is removed — `UserPromptSubmit` already marks `working` at turn start. (4) `StopFailure` gets its own per-event script writing `done` (API-error-terminated turn = idle). (5) `on-notification.sh` parses the JSON `notification_type` field to distinguish `idle_prompt` (→ `done`) from `permission_prompt` / `elicitation_dialog` (→ `wait`) and `auth_success` (→ no-op); unmapped types are info-logged to `$STATE_DIR/hook.log`.

## Prerequisites

- [x] Task 004 (Hooks Idle Detection) completed — this task modifies the mechanism it introduced
- [ ] Live `conductor` tmux session with at least one containerized Claude Code agent for end-to-end verification
- [ ] At least 2 queued tasks in `tasks.txt` to reproduce the double-dispatch observation

---

## Steps

### 1. Create per-event hook scripts  <!-- agent: general-purpose -->

- [x] Create `hooks/on-prompt-submit.sh` — self-contained script for the `UserPromptSubmit` event
  - Shebang `#!/usr/bin/env bash`, `set -u`
  - Read `CONDUCTOR_STATE_DIR` / `CONDUCTOR_AGENT_NAME` from env with defaults
  - Fallback: derive agent name from `tmux display-message -p '#W'` when `TMUX` is set
  - Drain stdin, guard on empty `AGENT_NAME`, `mkdir -p "$STATE_DIR"`
  - Write `working` to `$STATE_DIR/${AGENT_NAME}.state`
- [x] Create `hooks/on-stop.sh` — writes `done` on `Stop`
- [x] Create `hooks/on-stop-failure.sh` — writes `done` on `StopFailure` (API error ended the turn)
- [x] Create `hooks/on-notification.sh` — writes `wait` on `Notification` (to be refined in Step 5)
- [x] All four scripts executable (`chmod +x`)
- [x] Delete `hooks/claude-hook.sh` — its logic is now split across the four per-event scripts

### 2. Create hooks/install-hooks.sh  <!-- agent: general-purpose -->

- [x] Create `hooks/install-hooks.sh` — standalone script that registers per-event hooks into `~/.claude/settings.json`
  - `#!/usr/bin/env bash`, `set -euo pipefail`
  - Accepts `--hook-dir <path>` (default: script's own directory) and `--settings-file <path>` (default: `$HOME/.claude/settings.json`)
  - Ensures settings file exists
  - Uses `jq` to set `UserPromptSubmit`, `Stop`, `StopFailure`, `Notification` hook arrays, each pointing to the corresponding per-event script
  - Cleans up stale `PreToolUse` entries via `del(.hooks.PreToolUse)`
  - Atomic write via `mktemp` + `mv`
- [x] Make executable

### 3. Update scaffold.sh to call install-hooks.sh  <!-- agent: general-purpose -->

- [x] In `scaffold.sh` init-claude-config.sh heredoc, replace the inline jq hook-merge block with a single call to `/conductor-hooks/install-hooks.sh`
- [x] Remove the `HOOK_CMD` variable assignment that preceded the jq block
- [x] Keep surrounding init logic unchanged (sentinel check, rsync, MCP registration, sentinel touch, `exec "$@"`)

### 4. Add `dispatching` state and race fix in `monitor.sh`  <!-- agent: general-purpose -->

- [x] Extend `is_idle()` state switch to treat `dispatching` as busy:
  ```bash
  case "$state" in
    done) return 0 ;;
    working|wait|dispatching) return 1 ;;
    *) ;;  # unknown contents — fall through to regex
  esac
  ```
- [x] Add `mark_dispatching()` helper that writes `dispatching` to the state file
- [x] Call `mark_dispatching "$name"` **before** `dispatch "$target" "$task"` in both the `pop_task` and `TASK_CMD` branches
  - "Queue empty, no default" branch intentionally does NOT stamp `dispatching`
- [x] Document in inline comment: `# 'dispatching' is written by monitor.sh itself immediately after send-keys to close the race between dispatch and the UserPromptSubmit hook fire.`
- [x] Confirm staleness interaction: `dispatching` is only consulted inside the fresh-mtime branch (age ≤ `2 × POLL_INTERVAL`), so a stuck `dispatching` after agent crash falls through to regex fallback
- [x] `bash -n monitor.sh` — passes

### 5. Add Notification subtype parsing to on-notification.sh  <!-- agent: general-purpose -->

- [ ] Edit `hooks/on-notification.sh` — restructure stdin handling:
  - Replace `cat >/dev/null 2>&1 || true` with `PAYLOAD=$(cat 2>/dev/null || true)` to capture the JSON payload instead of draining it
- [ ] Replace the blanket `printf 'wait\n'` with subtype-aware handling. The JSON payload's `notification_type` field identifies the subtype (confirmed via Claude Code hooks reference at code.claude.com/docs/en/hooks):
  ```bash
  notif_type=$(printf '%s' "$PAYLOAD" | jq -r '.notification_type // empty' 2>/dev/null || true)
  case "$notif_type" in
    idle_prompt)                          printf 'done\n' > "$state_file" ;;
    permission_prompt|elicitation_dialog) printf 'wait\n' > "$state_file" ;;
    auth_success)                         ;;  # known type, no state change needed
    *)
      # Unmapped notification type — info-log full payload for investigation, leave state unchanged
      printf '[%s] %s: Notification type=%s (no state mapping) payload=%s\n' \
        "$(date +%H:%M:%S)" "$AGENT_NAME" "${notif_type:-<empty>}" "$PAYLOAD" \
        >> "$STATE_DIR/hook.log" 2>/dev/null || true
      ;;
  esac
  ```
  - `idle_prompt` → `done`: agent is truly idle; prevents the bug where Notification overwrites Stop's `done` with `wait`
  - `permission_prompt` → `wait`: agent is paused for approval, monitor treats as busy
  - `elicitation_dialog` → `wait`: agent is paused for MCP user input, monitor treats as busy
  - `auth_success` → no-op: informational, agent state unchanged
  - Unknown → info-log to `$STATE_DIR/hook.log` with full payload, leave state unchanged
- [ ] Update the header comment to document the subtype routing
- [ ] `bash -n hooks/on-notification.sh` — must pass

### 6. Update documentation  <!-- agent: general-purpose -->

- [x] `CLAUDE.md` "Core Scripts" table — replaced `hooks/claude-hook.sh` row with per-event script entries + `install-hooks.sh`
- [x] `CLAUDE.md` "Key Design Decisions" — updated idle detection bullet with four state values, per-event scripts, `install-hooks.sh`
- [x] `README.md` script table and "How It Works" section — updated to per-event scripts and `dispatching` state
- [ ] `CLAUDE.md` "Key Design Decisions" — add Notification subtype parsing details: `notification_type` JSON field, `idle_prompt` → `done`, `permission_prompt` / `elicitation_dialog` → `wait`, `auth_success` → no-op, unknown → info-logged to `$STATE_DIR/hook.log`
- [ ] `README.md` "How idle detection works" paragraph — add one sentence on Notification subtype routing and info-logging for unmapped types

### 7. Verification  <!-- agent: general-purpose -->

- [ ] `bash -n hooks/on-prompt-submit.sh hooks/on-stop.sh hooks/on-stop-failure.sh hooks/on-notification.sh hooks/install-hooks.sh scaffold.sh monitor.sh` — all pass
- [ ] Smoke-test all events locally (use `./tmp/` per CLAUDE.md):
  ```bash
  mkdir -p ./tmp/hook-test
  # Basic events
  for script_ev in "on-prompt-submit.sh working" "on-stop.sh done" "on-stop-failure.sh done"; do
    script="${script_ev%% *}"; expected="${script_ev##* }"
    CONDUCTOR_STATE_DIR=./tmp/hook-test CONDUCTOR_AGENT_NAME=smoke \
      bash "hooks/$script" < /dev/null
    actual=$(cat ./tmp/hook-test/smoke.state)
    printf '%s -> %s (expected %s) %s\n' "$script" "$actual" "$expected" \
      "$([ "$actual" = "$expected" ] && echo OK || echo FAIL)"
  done
  # Notification subtypes (pipe JSON to stdin)
  for subtype in idle_prompt permission_prompt elicitation_dialog auth_success unknown_test_type; do
    printf '{"notification_type":"%s"}' "$subtype" | \
      CONDUCTOR_STATE_DIR=./tmp/hook-test CONDUCTOR_AGENT_NAME=smoke \
      bash hooks/on-notification.sh
    state=$(cat ./tmp/hook-test/smoke.state 2>/dev/null || echo "<unchanged>")
    printf 'Notification(%s) -> %s\n' "$subtype" "$state"
  done
  # Check info log for unmapped type
  printf 'hook.log: '; cat ./tmp/hook-test/hook.log 2>/dev/null || echo "(empty)"
  rm -rf ./tmp/hook-test
  ```
  Expected:
  - `on-prompt-submit.sh -> working`, `on-stop.sh -> done`, `on-stop-failure.sh -> done`
  - `Notification(idle_prompt) -> done`
  - `Notification(permission_prompt) -> wait`
  - `Notification(elicitation_dialog) -> wait`
  - `Notification(auth_success) -> wait` (unchanged from previous — no-op)
  - `Notification(unknown_test_type) -> wait` (unchanged from previous — no-op)
  - `hook.log` contains one line with `Notification type=unknown_test_type (no state mapping)`
- [ ] Re-scaffold a test project and verify:
  ```bash
  rm -rf ./tmp/scaffold-test && mkdir -p ./tmp/scaffold-test
  bash scaffold.sh ./tmp/scaffold-test --force
  ```
  - `init-claude-config.sh` calls `/conductor-hooks/install-hooks.sh`, contains no inline jq hook-merge
  - `conductor-compose.yml` mounts hooks volume at `/conductor-hooks:ro`
  - `rm -rf ./tmp/scaffold-test`
- [ ] `git diff --stat` scope sanity-check: only `hooks/` scripts, `monitor.sh`, `scaffold.sh`, `CLAUDE.md`, `README.md`, this task file — no stray edits

### 8. End-to-end verification  <!-- agent: general-purpose -->

- [BLOCKED: requires live Docker + tmux environment] Rebuild the agent container:
  ```bash
  docker compose -f conductor-compose.yml down
  rm -f .devcontainer/init-claude-config.sh conductor-compose.yml
  bash <conductor-repo>/scaffold.sh . --force
  docker compose -f conductor-compose.yml up -d --build
  ```
- [BLOCKED: requires Docker] Verify settings file has exactly four hook events and no `PreToolUse`:
  ```bash
  docker compose -f conductor-compose.yml exec app jq '.hooks | keys' ~/.claude/settings.json
  # expected: ["Notification","Stop","StopFailure","UserPromptSubmit"]
  ```
- [BLOCKED: requires Docker + tmux] Watch state file transitions with ≥ 3 queued tasks:
  - Expected per task: `dispatching` → `working` → `done`. No back-to-back `dispatching` without intervening `done`.
- [BLOCKED: requires Docker + tmux] Confirm `tasks.txt` drains one line per idle cycle (not two — the original bug).
- [BLOCKED: requires Docker + tmux] Regression check: agent finishes with no queued task, idle loop does not spin-dispatch.
- [BLOCKED: requires Docker + tmux] Check `$STATE_DIR/hook.log` after a full cycle — should be empty or contain only genuinely unmapped notification types.

---

## Risks / Known Gaps

- **Existing initialized containers keep stale hook entries.** The `$HOME/.claude/.conductor-initialized` sentinel short-circuits re-running `init-claude-config.sh`, so `install-hooks.sh` only runs on fresh builds. Mitigation: `docker compose down && docker compose up -d --build` (or `rm ~/.claude/.conductor-initialized` inside the container).
- **`dispatching` relies on host filesystem write being visible to the next poll.** Both writer and reader are on the host with seconds between polls — safe. Revisit if monitor state moves to a networked FS.
- **Crashed agent can stick on `dispatching`.** Same mitigation as `working` stuck-state: `2 × POLL_INTERVAL` staleness check falls through to regex.
- **Esc-interrupt: no `Stop` hook fires.** Task 004's known gap persists; regex fallback handles it.
- **`auth_success` is a no-op.** If it should change state, the no-op means the agent stays as-is. Update once observed via `hook.log`.

---
**UAT**: [`.docs/uat/pending/007-hook-efficiency-dispatch-race.uat.md`](../../uat/pending/007-hook-efficiency-dispatch-race.uat.md)
