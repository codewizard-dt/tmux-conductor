---
id: TASK-010
title: "Rewrite monitor.sh pop_task as atomic SQL pop and move_to_backlog as status flip"
status: done
created: 2026-06-12
updated: 2026-06-12
depends_on: [TASK-009]
blocks: [TASK-011]
parallel_safe_with: [TASK-001, TASK-006, TASK-007, TASK-008]
uat: "../uat/UAT-010-monitor-sh-db.md"
tags: [shell, sqlite, monitor]
---

# TASK-010 — Rewrite monitor.sh pop_task as atomic SQL pop and move_to_backlog as status flip

## Objective

Migrate `scripts/monitor.sh`'s task queue operations from flat-file (`sed -i.bak`) to SQLite. `pop_task()` becomes a one-liner call to `pop_task_sql()` from `scripts/lib/db.sh`. `move_to_backlog()` becomes `UPDATE tasks SET status='backlog' WHERE agent_id=? AND status='queued'`. Also: call `load_agents` **inside the poll loop** so dashboard-spawned agents are picked up without a monitor restart.

## Approach

`monitor.sh` currently reads `tasks.txt` with a file scan and pops with `sed -i.bak`. Replacing this with `pop_task_sql` (from TASK-009) gives atomicity: no more race between `monitor.sh` line-remove and the backend's `writeQueue` rewrite. `load_agents` inside the loop is also from the design plan — it fixes the existing gap where adding agents via the dashboard required a monitor restart.

## Steps

### 1. Source scripts/lib/db.sh at the top of monitor.sh  <!-- agent: general-purpose --> <!-- Completed: 2026-06-12 -->

- [x] Use Serena `get_symbols_overview` on `scripts/monitor.sh` to understand its structure
- [x] Add near the top (after `SCRIPT_DIR` setup):
  ```bash
  source "$SCRIPT_DIR/lib/db.sh"
  ```
- [x] Remove or guard any existing `source "$SCRIPT_DIR/../conductor.conf"` AGENTS/TASK_QUEUE references (the conf will still be sourced for POLL_INTERVAL, LOG_DIR, etc. — only agent array and queue path are replaced) <!-- KEPT conf source: db.sh sources conductor.conf only in a subshell, so conf vars are not exposed to monitor.sh scope; explicit source still required -->

> **Step-4 note (from step 1):** monitor.sh has inline loops populating `AGENT_NAMES`/`AGENT_CMDS` from `${AGENTS[@]}` and `BG_NAMES` from `${BG_PROCESSES[@]}`. These are NOT pure duplicates of db.sh's `load_agents`/`load_bg` (which read from SQLite). Step 4 replaces the agent loop with a `load_agents` call.

### 2. Replace pop_task() with pop_task_sql() call  <!-- agent: general-purpose --> <!-- Completed: 2026-06-12 -->

- [x] Use Serena `find_symbol` to read the `pop_task` function body in `monitor.sh`
- [x] Replace the body with:
  ```bash
  pop_task() {
    local agent_name="$1"
    pop_task_sql "$agent_name"  # sets POPPED_TASK, LAST_QUEUE_KIND, LAST_QUEUE_REMAINING
  }
  ```
- [x] Verify that the callers of `pop_task` use the same `POPPED_TASK` global variable — the interface is unchanged <!-- Single caller at monitor.sh:475-480 uses exit status + POPPED_TASK/LAST_QUEUE_KIND/LAST_QUEUE_REMAINING globals; pop_task_sql ends with [[ -n "$POPPED_TASK" ]] so exit status (0=popped, 1=none) matches the old contract -->

> **Interface confirmed:** old body set the same three globals via file-scan + `sed -i.bak`; `pop_task_sql` sets them via atomic `DELETE…RETURNING` and returns 0/1 on popped/empty. Dispatch guard `if pop_task` preserved.

### 3. Replace move_to_backlog() with SQL status flip  <!-- agent: general-purpose --> <!-- Completed: 2026-06-12 -->

- [x] Use Serena `find_symbol` to read the `move_to_backlog` function body <!-- Old body moved queued lines to tasks.backlog.txt via file/sed ops; 2 call sites (monitor.sh:401 agent-not-found, :438 bg-not-found) pass only a name, ignore return/stdout — new SQL signature compatible -->
- [x] Replace with:
  ```bash
  move_to_backlog() {
    local agent_name="$1"
    local agent_id
    agent_id=$(sql "SELECT id FROM agents WHERE name='${agent_name//\'/''}'")
    if [[ -n "$agent_id" ]]; then
      sql "UPDATE tasks SET status='backlog' WHERE agent_id=$agent_id AND status='queued'"
    fi
  }
  ```

### 4. Move load_agents inside the poll loop  <!-- agent: general-purpose --> <!-- Completed: 2026-06-12 -->

- [x] Find the main `while true` poll loop in `monitor.sh`
- [x] At the TOP of the loop body (before agent iteration), add: `load_agents` <!-- added load_agents + load_bg at top of while-loop body (after ITER increment) -->
- [x] Removed inline conf-array blocks (AGENT_NAMES/AGENT_CMDS from ${AGENTS[@]} and BG_NAMES from ${BG_PROCESSES[@]}); kept ONE pre-loop load_agents+load_bg call because `log "Watching ${#AGENT_NAMES[@]} agents..."` (line 328) references the array before the loop starts. load_agents/load_bg confirmed loop-safe (reset AGENT_NAMES/BG_NAMES each call, declare -g for global visibility)
- [x] This means newly spawned agents (via the dashboard) are picked up on the next poll tick without restarting monitor <!-- load_bg moved into loop too, so dashboard-spawned bg-processes are also picked up -->

> **Note:** associative arrays (AGENT_DIRS/CMDS/BG) aren't cleared of stale keys on re-load, but iteration is driven by the cleanly-reset AGENT_NAMES/BG_NAMES indexed arrays, so behavior is correct for deleted agents.

### 5. Update LAST_QUEUE_REMAINING log output  <!-- agent: general-purpose --> <!-- Completed: 2026-06-12 -->

- [x] The dispatch log (dispatch.jsonl) includes `queue_remaining` — verify it still reads `$LAST_QUEUE_REMAINING` (set by `pop_task_sql`) rather than a file line count <!-- Confirmed: emit_dispatch_jsonl receives $LAST_QUEUE_REMAINING; no wc -l anywhere. Already correct, no change -->
- [x] Update any remaining references to `TASK_QUEUE` (file path) or `tasks.txt` in monitor.sh to use `$CONDUCTOR_DB` instead <!-- TASK_QUEUE genuinely unused after steps 1-4: removed its definition + conf-relative resolution block + comment ref; startup log now "Task queue: $CONDUCTOR_DB". Post-edit search: zero TASK_QUEUE/tasks.txt/tasks.backlog matches -->

### 6. Syntax verification  <!-- agent: general-purpose --> <!-- Completed: 2026-06-12 -->

- [x] Run `bash -n scripts/monitor.sh` — no syntax errors <!-- SYNTAX_OK -->
