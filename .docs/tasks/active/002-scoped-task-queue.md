# 002 — Project-Scoped Task Queue

## Objective

Add agent-name prefix scoping to the task queue so tasks are dispatched only to the matching agent, preventing cross-project mis-dispatch.

## Approach

Extend the `tasks.txt` format with an optional `agentname: ` prefix per line. Modify `pop_task()` in `monitor.sh` to accept an agent name, scan for matching-prefix or unprefixed lines, and remove the matched line. Unprefixed lines remain a global pool dispatched to any idle agent, preserving backward compatibility. No config format changes needed — the existing agent name from `AGENTS` entries is the scope key.

## Prerequisites

- [ ] Task 001 (Initial Scaffolding) completed — all scripts exist and pass syntax checks

---

## Steps

### 1. Rewrite `pop_task()` in monitor.sh  <!-- agent: general-purpose -->

- [x] Modify `pop_task()` to accept an agent name parameter: `pop_task <agent_name>` <!-- Completed: 2026-04-13 -->
- [x] Scan `$TASK_QUEUE` line by line looking for the first match in priority order: <!-- Completed: 2026-04-13 -->
  1. Lines prefixed with `<agent_name>: ` (exact match on agent name before colon-space)
  2. Lines with no prefix (no colon-space pattern) — these are global/unscoped
  - A "prefixed line" matches the regex `^[a-zA-Z0-9_-]+: .+` (name, colon, space, command)
  - A line prefixed for a *different* agent is skipped
- [x] When a match is found: <!-- Completed: 2026-04-13 -->
  - Strip the `<agent_name>: ` prefix if present, returning only the command portion
  - Remove that specific line from `$TASK_QUEUE` using `sed -i.bak` with the line number (not always line 1) + cleanup of `.bak` file
  - Return 0
- [x] When no match is found, return 1 <!-- Completed: 2026-04-13 -->
- [x] Preserve `set -euo pipefail` compatibility — ensure grep/sed failures don't exit the script (use `|| true` or conditional checks) <!-- Completed: 2026-04-13 -->

### 2. Update main loop in monitor.sh  <!-- agent: general-purpose -->

- [x] Change the `pop_task` call site (around line 86) to pass the current agent name: `if task=$(pop_task "$name"); then` <!-- Completed: 2026-04-13 -->
- [x] No other changes to the dispatch flow — `dispatch`, `check_usage`, `is_idle` remain unchanged <!-- Completed: 2026-04-13 -->
- [x] Ensure the `TASK_CMD` fallback (queue-empty default command) still works for all agents regardless of scoping <!-- Completed: 2026-04-13 -->

### 3. Update tasks.txt with scoped examples  <!-- agent: general-purpose -->

- [x] Replace current `tasks.txt` contents with examples demonstrating all three patterns: <!-- Completed: 2026-04-13 -->
  ```
  jobfinder: /tackle .docs/tasks/active/047.7-walk-forward-optimization.md
  webapp: Review and simplify backend/app/services/order_service.py
  /tackle .docs/tasks/active/005-shared-lib.md
  ```
  - First line: scoped to `jobfinder` agent
  - Second line: scoped to `webapp` agent
  - Third line: unscoped, dispatched to any idle agent

### 4. Document prefix syntax in conductor.conf  <!-- agent: general-purpose -->

- [x] Update the `TASK_QUEUE` comment block in `conductor.conf` to document the scoping syntax <!-- Completed: 2026-04-13 -->
  - Explain the `agentname: command` prefix format
  - Note that unprefixed lines go to any idle agent
  - Add an inline example showing both scoped and unscoped entries

### 5. Verification  <!-- agent: general-purpose -->

- [x] Run `bash -n monitor.sh` to verify no syntax errors after edits <!-- Completed: 2026-04-13 -->
- [x] Verify `conductor.conf` still sources cleanly: `bash -c 'source conductor.conf'` <!-- Completed: 2026-04-13 -->
- [x] Manual logic test: create a test `tasks.txt` with mixed scoped/unscoped lines, then trace through `pop_task` logic to confirm: <!-- Completed: 2026-04-13 -->
  - `pop_task "jobfinder"` returns the jobfinder-prefixed line (stripped of prefix)
  - `pop_task "webapp"` returns the webapp-prefixed line (stripped of prefix)
  - `pop_task "otheragent"` returns the unscoped line
  - After all three pops, `tasks.txt` is empty
