# 007 — Hook Efficiency + Dispatch Race Fix

## Objective

Eliminate the duplicate-dispatch race where `monitor.sh` sends `/tackle` twice because the state file still reads `done` between `dispatch` and the next `UserPromptSubmit` hook fire, and cut redundant hook traffic by dropping the `PreToolUse` event.

## Approach

Two independent fixes in one task. (1) `monitor.sh` writes a new `dispatching` state to `$STATE_DIR/<agent>.state` the instant after it calls `dispatch.sh`; `is_idle()` treats `dispatching` as busy so the next poll cannot re-dispatch until the hook-written `working` (or later `done`) arrives. (2) `hooks/claude-hook.sh` drops the `PreToolUse` case — `UserPromptSubmit` already sets `working` at turn start, so `PreToolUse` is redundant chatter (one subshell per tool call). The container-init `jq` merge also scrubs any stale `PreToolUse` entries left by prior scaffolds.

## Prerequisites

- [x] Task 004 (Hooks Idle Detection) completed — this task modifies the mechanism it introduced
- [ ] Live `conductor` tmux session with at least one containerized Claude Code agent for end-to-end verification
- [ ] At least 2 queued tasks in `tasks.txt` to reproduce the double-dispatch observation

---

## Steps

### 1. Shrink `hooks/claude-hook.sh` to drop `PreToolUse`  <!-- agent: general-purpose -->

- [ ] Edit `hooks/claude-hook.sh`
  - Remove `PreToolUse` from the `case` branch on line 31. New branch: `UserPromptSubmit) printf 'working\n' > "$state_file" ;;`
  - Keep `Stop`, `Notification`, and the `*)` no-op branches unchanged
- [ ] Update the header comment (lines 1–10) — replace the "`UserPromptSubmit`, `PreToolUse`, `Stop`, `Notification`" enumeration with "`UserPromptSubmit`, `Stop`, `Notification`" and add a one-line note: `# PreToolUse removed (task 007): UserPromptSubmit already marks 'working' at turn start.`
- [ ] `bash -n hooks/claude-hook.sh` — must pass
- [ ] Smoke-test the three remaining events locally (use `./tmp/` per CLAUDE.md):
  ```bash
  mkdir -p ./tmp
  for ev in UserPromptSubmit Stop Notification; do
    CONDUCTOR_STATE_DIR=./tmp/hook-test CONDUCTOR_AGENT_NAME=smoke \
      bash hooks/claude-hook.sh "$ev" < /dev/null
    printf '%s -> ' "$ev"; cat ./tmp/hook-test/smoke.state
  done
  rm -rf ./tmp/hook-test
  ```
  Expected: `UserPromptSubmit -> working`, `Stop -> done`, `Notification -> wait`.

### 2. Remove `PreToolUse` from the scaffold jq merge  <!-- agent: general-purpose -->

- [ ] Edit `scaffold.sh` lines 222–231 (the `jq --arg cmd ... hooks` merge in the generated `init-claude-config.sh` heredoc)
  - Delete the `.PreToolUse = ((.PreToolUse // []) + [...])` line (currently line 227 inside the heredoc)
  - Leave `UserPromptSubmit`, `Stop`, `Notification` intact
- [ ] `bash -n scaffold.sh` — must pass
- [ ] Confirm the rendered snippet is valid by scaffolding into a throwaway dir and `jq`-parsing the generated init script's merge block:
  ```bash
  mkdir -p ./tmp/scaffold-verify && rm -rf ./tmp/scaffold-verify/*
  mkdir -p ./tmp/scaffold-verify/target
  bash scaffold.sh ./tmp/scaffold-verify/target --force > /dev/null
  grep -c 'PreToolUse' ./tmp/scaffold-verify/target/.devcontainer/init-claude-config.sh
  # expected: 0 (only the three remaining events referenced)
  grep -c '\(UserPromptSubmit\|Stop\|Notification\)' ./tmp/scaffold-verify/target/.devcontainer/init-claude-config.sh
  # expected: 3
  rm -rf ./tmp/scaffold-verify
  ```

### 3. Scrub stale `PreToolUse` entries on container init  <!-- agent: general-purpose -->

- [ ] In `scaffold.sh`, extend the generated `init-claude-config.sh` heredoc so the jq step (currently lines 223–231) also deletes any pre-existing `.hooks.PreToolUse` entries left by an older scaffold. Replace the existing `jq --arg cmd ...` invocation with a two-step pipeline that first deletes stale `PreToolUse` and then appends the three current event hooks:
  ```bash
  jq --arg cmd "$HOOK_CMD" '
    .hooks = ((.hooks // {}) | del(.PreToolUse)) |
    .hooks |= (
        .UserPromptSubmit = ((.UserPromptSubmit // []) + [{"hooks":[{"type":"command","command":($cmd + " UserPromptSubmit")}]}])
      | .Stop             = ((.Stop             // []) + [{"hooks":[{"type":"command","command":($cmd + " Stop")}]}])
      | .Notification     = ((.Notification     // []) + [{"hooks":[{"type":"command","command":($cmd + " Notification")}]}])
    )
  ' "$SETTINGS_FILE" > /tmp/settings.json && mv /tmp/settings.json "$SETTINGS_FILE"
  ```
  - Rationale: the existing sentinel `$HOME/.claude/.conductor-initialized` short-circuits re-running this script on subsequent container starts. For *existing* containers that were initialized before this task, the sentinel already exists and the merge will not re-run — document this in the "Known Gaps" section below.
- [ ] Remember to escape `$` → `\$` consistently inside the scaffold heredoc (match the style of the surrounding `\$SETTINGS_FILE`, `\$HOOK_CMD` references)
- [ ] `bash -n scaffold.sh` — must pass

### 4. Add `dispatching` state and race fix in `monitor.sh`  <!-- agent: general-purpose -->

- [ ] In `monitor.sh`, extend the `is_idle()` state switch (currently lines 93–96) to treat `dispatching` as busy:
  ```bash
        case "$state" in
          done) return 0 ;;
          working|wait|dispatching) return 1 ;;
          *) ;;  # unknown contents — fall through to regex
        esac
  ```
- [ ] Add a small helper just above `dispatch()` (around line 134) so every dispatch call stamps the state file atomically:
  ```bash
  mark_dispatching() {
    local name="$1"
    [ -n "$name" ] || return 0
    local state_file="${STATE_DIR}/${name}.state"
    printf 'dispatching\n' > "$state_file" 2>/dev/null || true
    debug "mark_dispatching: wrote 'dispatching' to $state_file"
  }
  ```
- [ ] Update the main loop's dispatch branch (currently lines 184–192) to call `mark_dispatching "$name"` **before** `dispatch "$target" "$task"` in both the `pop_task` and `TASK_CMD` arms. Example:
  ```bash
  if task=$(pop_task "$name"); then
    log "$name — dispatching task: $task"
    mark_dispatching "$name"
    dispatch "$target" "$task"
  elif [ -n "${TASK_CMD:-}" ]; then
    log "$name — queue empty, sending default: $TASK_CMD"
    mark_dispatching "$name"
    dispatch "$target" "$TASK_CMD"
  else
    log "$name — queue empty, no default command. Agent stays idle."
  fi
  ```
  - The "queue empty, no default" branch intentionally does NOT stamp `dispatching` — nothing was sent, so the next poll should behave normally.
- [ ] `bash -n monitor.sh` — must pass

### 5. Verify staleness interaction with the new state  <!-- agent: general-purpose -->

- [ ] Confirm by reading `is_idle()` (monitor.sh lines 77–112) that `dispatching` is only consulted *inside* the fresh-mtime branch (age ≤ `2 × POLL_INTERVAL`), so a stuck `dispatching` after an agent crash still falls through to the regex fallback once the state file goes stale — preserves the Task 004 failure-mode behavior.
- [ ] Document this in the inline comment above the case block: `# 'dispatching' is written by monitor.sh itself immediately after send-keys to close the race between dispatch and the UserPromptSubmit hook fire. Hook overwrites it to 'working' within milliseconds under normal conditions.`

### 6. Update documentation  <!-- agent: general-purpose -->

- [ ] `CLAUDE.md` "Key Design Decisions" bullet on idle detection — replace the existing bullet with one that lists the four state values (`working` / `wait` / `dispatching` / `done`) and notes that `dispatching` is monitor-written, the rest are hook-written
- [ ] `CLAUDE.md` "Core Scripts" table — the `hooks/claude-hook.sh` row's purpose column: drop the `PreToolUse` mention, update to reflect three events
- [ ] `README.md` "How idle detection works" section — document the new state value and the race-fix rationale in one short paragraph
- [ ] Do NOT touch the Task 004 completed file — it is a historical record of the prior mechanism

### 7. End-to-end verification  <!-- agent: general-purpose -->

- [ ] Rebuild the agent container so the scaffold changes (Steps 2 + 3) take effect:
  ```bash
  # From the target project directory (e.g., the jobfinder repo)
  docker compose -f conductor-compose.yml down
  rm -f .devcontainer/init-claude-config.sh conductor-compose.yml  # force regeneration
  bash <conductor-repo>/scaffold.sh . --force
  docker compose -f conductor-compose.yml up -d --build
  ```
- [ ] Inside the container, verify the settings file has exactly three hook events and no `PreToolUse`:
  ```bash
  docker compose -f conductor-compose.yml exec app jq '.hooks | keys' ~/.claude/settings.json
  # expected: ["Notification","Stop","UserPromptSubmit"]
  ```
- [ ] Queue ≥ 3 tasks in `tasks.txt` (e.g., three `/help` entries), start `monitor.sh`, and watch the state file transitions from the host:
  ```bash
  while true; do printf '%s: ' "$(date +%H:%M:%S)"; cat logs/state/<agent>.state 2>/dev/null; echo; sleep 0.3; done
  ```
  - Expected sequence per task: `dispatching` → `working` → `done` (then next task fires). NO back-to-back `dispatching` writes without an intervening `done`.
- [ ] Confirm `tasks.txt` drains one line per idle cycle — NOT two lines per idle (the bug symptom from the screenshot on 2026-04-14). Cross-check `logs/monitor-*.log` for exactly one `dispatching task` log line per queue entry.
- [ ] Regression check: let the agent finish naturally (no queued task) and confirm the idle loop does not spin-dispatch a default `TASK_CMD` repeatedly.

### 8. Final verification  <!-- agent: general-purpose -->

- [ ] `bash -n monitor.sh hooks/claude-hook.sh scaffold.sh` — all pass
- [ ] `git diff --stat` scope sanity-check: only `monitor.sh`, `hooks/claude-hook.sh`, `scaffold.sh`, `CLAUDE.md`, `README.md`, this task file, and runtime artifacts under `logs/` / `tasks.txt` — no stray edits
- [ ] State-file fixture replay (optional but cheap): seed `./tmp/state-test/<name>.state` with each of `working`, `wait`, `dispatching`, `done`, then call `is_idle` via a sourced extraction — confirm only `done` returns 0

---

## Risks / Known Gaps

- **Existing initialized containers keep the stale `PreToolUse` hook entry.** The `$HOME/.claude/.conductor-initialized` sentinel short-circuits re-running `init-claude-config.sh`, so Step 3's `del(.PreToolUse)` only helps fresh container builds or scaffolded projects where the sentinel was wiped. Mitigation: document that users must `docker compose down && docker compose up -d --build` (or manually `rm ~/.claude/.conductor-initialized` inside the container) to pick up the fix. No code-level auto-migration is worth the complexity.
- **`dispatching` state relies on monitor-host filesystem write being visible to the next poll.** Since both writer and reader are on the host and the poll interval is on the order of seconds, this is safe. If someone later moves monitor state to a remote/networked FS, revisit.
- **Crashed agent can stick on `dispatching`.** Identical mitigation to the pre-existing `working` stuck-state risk: the `2 × POLL_INTERVAL` staleness check punts to the regex fallback after the state file goes stale.
- **Esc-interrupt behavior unchanged.** Task 004's known gap (no `Stop` hook on Esc) persists; regex fallback still handles it. Out of scope here per clarifying Q&A on 2026-04-14.
