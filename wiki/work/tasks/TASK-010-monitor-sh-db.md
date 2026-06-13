---
id: TASK-010
title: "Rewrite monitor.sh pop_task as atomic SQL pop and move_to_backlog as status flip"
status: todo
created: 2026-06-12
updated: 2026-06-12
depends_on: [TASK-009]
blocks: [TASK-011]
parallel_safe_with: [TASK-001, TASK-006, TASK-007, TASK-008]
uat: ""
tags: [shell, sqlite, monitor]
---

# TASK-010 — Rewrite monitor.sh pop_task as atomic SQL pop and move_to_backlog as status flip

## Objective

Migrate `scripts/monitor.sh`'s task queue operations from flat-file (`sed -i.bak`) to SQLite. `pop_task()` becomes a one-liner call to `pop_task_sql()` from `scripts/lib/db.sh`. `move_to_backlog()` becomes `UPDATE tasks SET status='backlog' WHERE agent_id=? AND status='queued'`. Also: call `load_agents` **inside the poll loop** so dashboard-spawned agents are picked up without a monitor restart.

## Approach

`monitor.sh` currently reads `tasks.txt` with a file scan and pops with `sed -i.bak`. Replacing this with `pop_task_sql` (from TASK-009) gives atomicity: no more race between `monitor.sh` line-remove and the backend's `writeQueue` rewrite. `load_agents` inside the loop is also from the design plan — it fixes the existing gap where adding agents via the dashboard required a monitor restart.

## Steps

### 1. Source scripts/lib/db.sh at the top of monitor.sh  <!-- agent: general-purpose -->

- [ ] Use Serena `get_symbols_overview` on `scripts/monitor.sh` to understand its structure
- [ ] Add near the top (after `SCRIPT_DIR` setup):
  ```bash
  source "$SCRIPT_DIR/lib/db.sh"
  ```
- [ ] Remove or guard any existing `source "$SCRIPT_DIR/../conductor.conf"` AGENTS/TASK_QUEUE references (the conf will still be sourced for POLL_INTERVAL, LOG_DIR, etc. — only agent array and queue path are replaced)

### 2. Replace pop_task() with pop_task_sql() call  <!-- agent: general-purpose -->

- [ ] Use Serena `find_symbol` to read the `pop_task` function body in `monitor.sh`
- [ ] Replace the body with:
  ```bash
  pop_task() {
    local agent_name="$1"
    pop_task_sql "$agent_name"  # sets POPPED_TASK, LAST_QUEUE_KIND, LAST_QUEUE_REMAINING
  }
  ```
- [ ] Verify that the callers of `pop_task` use the same `POPPED_TASK` global variable — the interface is unchanged

### 3. Replace move_to_backlog() with SQL status flip  <!-- agent: general-purpose -->

- [ ] Use Serena `find_symbol` to read the `move_to_backlog` function body
- [ ] Replace with:
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

### 4. Move load_agents inside the poll loop  <!-- agent: general-purpose -->

- [ ] Find the main `while true` poll loop in `monitor.sh`
- [ ] At the TOP of the loop body (before agent iteration), add: `load_agents`
- [ ] Remove any initial `load_agents` call outside the loop (to avoid double-load on first iteration, or keep the outer call and let the loop overwrite — either is fine; prefer inside-only for simplicity)
- [ ] This means newly spawned agents (via the dashboard) are picked up on the next poll tick without restarting monitor

### 5. Update LAST_QUEUE_REMAINING log output  <!-- agent: general-purpose -->

- [ ] The dispatch log (dispatch.jsonl) includes `queue_remaining` — verify it still reads `$LAST_QUEUE_REMAINING` (set by `pop_task_sql`) rather than a file line count
- [ ] Update any remaining references to `TASK_QUEUE` (file path) or `tasks.txt` in monitor.sh to use `$CONDUCTOR_DB` instead

### 6. Syntax verification  <!-- agent: general-purpose -->

- [ ] Run `bash -n scripts/monitor.sh` — no syntax errors
