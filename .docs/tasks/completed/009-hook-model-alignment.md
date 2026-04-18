# 009 — Hook Model Alignment (idle/busy)

## Objective

Collapse the agent-state vocabulary to two values (`idle`, `busy`) and align Claude Code hooks so only idle-transition events (`SessionStart`, `Stop`, `StopFailure`) write `idle` and only the busy-transition event (`UserPromptSubmit`) writes `busy`.

## Approach

Drop the `Notification` hook entirely and add a `SessionStart` hook (matcher `startup|resume|clear`, excluding `compact`). Replace the `done`/`working`/`wait`/`dispatching` vocabulary in hooks and `monitor.sh` with `idle`/`busy`; `monitor.sh` continues to write `busy` itself in the dispatch race-gap (formerly the `dispatching` placeholder). Update `install-hooks.sh` to register the new event set and remove stale `Notification` entries from existing `settings.json` files.

## Prerequisites

- [x] Task 007 (per-event hooks + dispatch race fix) is trashed — this task supersedes and simplifies it
- [x] Understanding of the Claude Code hooks lifecycle per `.serena/memories/claude-code/hooks-reference.md`

---

## Steps

### 1. Add SessionStart hook  <!-- agent: general-purpose -->

- [x] Create `hooks/on-session-start.sh`
  - Shebang `#!/usr/bin/env bash`, `set -u`, executable bit
  - Copy the env/fallback preamble from `hooks/on-stop.sh` (`CONDUCTOR_STATE_DIR`, `CONDUCTOR_AGENT_NAME`, tmux window-name fallback, stdin drain, mkdir guard)
  - Write `idle\n` to `$STATE_DIR/${AGENT_NAME}.state`
  - Exit 0
- [x] `chmod +x hooks/on-session-start.sh`
- [x] Verify `bash -n hooks/on-session-start.sh` passes

### 2. Remove Notification hook  <!-- agent: general-purpose -->

- [x] Delete `hooks/on-notification.sh`
- [x] Remove all references to it in other files (grep the repo for `on-notification` before deleting to catch scaffold / docs / tests)

### 3. Rename state vocabulary in existing hooks  <!-- agent: general-purpose -->

- [x] `hooks/on-prompt-submit.sh` — change `working` to `busy` (line with `printf 'working\n'`); update the top-of-file comment to describe `busy`
- [x] `hooks/on-stop.sh` — change `done` to `idle`; update top-of-file comment
- [x] `hooks/on-stop-failure.sh` — change `done` to `idle`; update top-of-file comment
- [x] Verify `bash -n` on all three

### 4. Update install-hooks.sh  <!-- agent: general-purpose -->

- [x] In `hooks/install-hooks.sh`, update the jq merge to:
  - Register `SessionStart` as `[{ "matcher": "startup|resume|clear", "hooks": [{ "type": "command", "command": ($hook_dir + "/on-session-start.sh") }] }]` (matcher excludes `compact`)
  - Keep `UserPromptSubmit`, `Stop`, `StopFailure` entries as plain (matcher-less) arrays
  - Remove the `Notification` registration
  - Add `del(.hooks.Notification)` alongside the existing `del(.hooks.PreToolUse)` so upgraded installs drop stale entries
- [x] Update the echo at the end of the installer to mention the new event set
- [x] Verify: run the installer against an empty `{}` fixture in `./tmp/` and confirm jq merge produces the expected shape

### 5. Update monitor.sh state machine  <!-- agent: general-purpose -->

- [x] In `monitor.sh::is_idle`, replace the case block:
  - `idle) return 0 ;;`
  - `busy) return 1 ;;`
  - Remove `done`, `working`, `wait`, `dispatching` branches (any unknown state falls through to the regex fallback)
  - Update the inline comment describing the race-gap placeholder (now `busy`, not `dispatching`)
- [x] In `monitor.sh::mark_dispatching` (or rename to `mark_busy`):
  - Write `busy\n` instead of `dispatching\n`
  - Update the debug string accordingly
  - Update all callers
- [x] Keep the state-file-staleness + `IDLE_PATTERN` regex fallback unchanged

### 6. Update documentation  <!-- agent: general-purpose -->

- [x] `CLAUDE.md` — rewrite the "Idle detection primary signal…" paragraph under **Key Design Decisions**:
  - Two states only: `idle` (written by `on-session-start.sh` on startup/resume/clear, `on-stop.sh`, `on-stop-failure.sh`) and `busy` (written by `on-prompt-submit.sh` and by `monitor.sh` itself as the dispatch-race placeholder)
  - Remove references to `done`/`working`/`wait`/`dispatching`
  - Update the per-event hook table: add `on-session-start.sh` row, delete `on-notification.sh` row
- [x] `.docs/tasks/README.md` — add a row for this task under Active Tasks
