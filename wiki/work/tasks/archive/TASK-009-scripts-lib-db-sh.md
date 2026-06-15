---
id: TASK-009
title: "Create scripts/lib/db.sh — sql wrapper, load_agents, load_bg, pop_task_sql"
status: done
created: 2026-06-12
updated: 2026-06-12
depends_on: [TASK-003, TASK-005]
blocks: [TASK-010, TASK-011]
parallel_safe_with: [TASK-001, TASK-006, TASK-007, TASK-008]
uat: "../uat/UAT-009-scripts-lib-db-sh.md"
tags: [shell, sqlite, scripts]
---

# TASK-009 — Create scripts/lib/db.sh — sql wrapper, load_agents, load_bg, pop_task_sql

## Objective

Create `scripts/lib/db.sh` — the shared SQLite helper library for the conductor shell scripts. It resolves the DB path (env → `DB_PATH` conf → default), wraps `sqlite3` with WAL timeout and field-separator settings, and provides `load_agents`, `load_bg`, and `pop_task_sql` functions. Sourcing this file replaces the AGENTS/BG_PROCESSES conf-array parsing in `conductor.sh`, `monitor.sh`, `spawn.sh`, `broadcast.sh`, and `teardown.sh`.

## Approach

The `sql()` function is a thin wrapper: `sqlite3 -cmd '.timeout 5000' -separator $'\x1f' "$CONDUCTOR_DB" "$@"`. The field separator `\x1f` (Unit Separator) is safely split with `IFS=$'\x1f'`. All agent/bg data comes from JOIN queries over the `agents` and `bg_processes` tables.

From the design plan:
- `load_agents` fills `AGENT_NAMES[]`, `AGENT_DIRS{}`, `AGENT_CMDS{}`, `AGENT_BG{}` associative arrays
- `load_bg` fills `BG_NAMES[]`, `BG_DIRS{}`, `BG_CMDS{}`
- `pop_task_sql` runs the atomic `DELETE…RETURNING` SQL and sets `POPPED_TASK`, `LAST_QUEUE_KIND`, `LAST_QUEUE_REMAINING`

## Steps

### 1. Create scripts/lib/ directory and scripts/lib/db.sh skeleton  <!-- agent: general-purpose --> <!-- Completed: 2026-06-12 -->

- [x] Create `scripts/lib/db.sh` (new file — `Write` tool)
- [x] Shebang: `#!/usr/bin/env bash` (library — not executed directly, sourced)
- [x] Set `set -euo pipefail` at the top (inherited by sourcing script's context)
- [x] DB path resolution at source time:
  ```bash
  LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  CONF_DIR="$(dirname "$LIB_DIR")"  # scripts/../ = repo root
  # Resolve DB path: env > conf setting > default
  if [[ -z "${CONDUCTOR_DB:-}" ]]; then
    # source conductor.conf temporarily to get DB_PATH
    _db_conf="${CONF_DIR}/../conductor.conf"
    if [[ -f "$_db_conf" ]]; then
      DB_PATH_FROM_CONF=$(bash -c "source \"$_db_conf\" 2>/dev/null && echo \"\${DB_PATH:-}\"")
    fi
    if [[ -n "${DB_PATH_FROM_CONF:-}" ]]; then
      CONDUCTOR_DB="$(cd "$CONF_DIR/.." && realpath -m "${DB_PATH_FROM_CONF}")"
    else
      CONDUCTOR_DB="${CONF_DIR}/../data/conductor.db"
    fi
  fi
  ```

### 2. Implement sql() wrapper  <!-- agent: general-purpose --> <!-- Completed: 2026-06-12 -->

- [x] `sql()` function:
  ```bash
  sql() {
    sqlite3 -cmd '.timeout 5000' -separator $'\x1f' "$CONDUCTOR_DB" "$@"
  }
  ```
- [x] `sql_one()` — same but returns single-column first row (used for simple SELECTs)

### 3. Implement load_agents()  <!-- agent: general-purpose --> <!-- Completed: 2026-06-12 -->

- [x] `load_agents()`:
  - Declare: `AGENT_NAMES=()`, `declare -A AGENT_DIRS`, `declare -A AGENT_CMDS`, `declare -A AGENT_BG` (associative: agent_name → linked_bg_name or "")
  - Query: `SELECT a.name, a.workdir, a.launch_cmd, COALESCE(b.name,'') FROM agents a LEFT JOIN bg_processes b ON b.linked_agent_id=a.id ORDER BY a.name`
  - Parse each row with `IFS=$'\x1f' read -r name workdir cmd bg_name`
  - Populate the arrays

### 4. Implement load_bg()  <!-- agent: general-purpose --> <!-- Completed: 2026-06-12 -->

- [x] `load_bg()`:
  - Declare: `BG_NAMES=()`, `declare -A BG_DIRS`, `declare -A BG_CMDS`
  - Query: `SELECT name, workdir, launch_cmd FROM bg_processes ORDER BY name`
  - Parse and populate

### 5. Implement pop_task_sql()  <!-- agent: general-purpose --> <!-- Completed: 2026-06-12 -->

- [x] `pop_task_sql()` accepts `$1` = agent name:
  - Initialize: `POPPED_TASK=""`, `LAST_QUEUE_KIND=""`, `LAST_QUEUE_REMAINING=0`
  - Run the atomic `DELETE…RETURNING` SQL from the design plan (inlining `$1` for the agent name — names validated `^[A-Za-z0-9_-]+$` + schema CHECK):
    ```sql
    DELETE FROM tasks WHERE id = (
      SELECT t.id FROM tasks t
      WHERE t.status = 'queued' AND (
           (t.agent_id IS NOT NULL AND t.agent_id = (SELECT id FROM agents WHERE name='<AGENT>'))
        OR (t.project_id IS NOT NULL AND t.project_id = (SELECT project_id FROM agents WHERE name='<AGENT>'))
        OR (t.agent_id IS NULL AND t.project_id IS NULL))
      ORDER BY CASE WHEN t.agent_id IS NOT NULL THEN 0
                    WHEN t.project_id IS NOT NULL THEN 1 ELSE 2 END,
               t.position
      LIMIT 1)
    RETURNING id, command,
      CASE WHEN agent_id IS NOT NULL THEN 'scoped'
           WHEN project_id IS NOT NULL THEN 'project' ELSE 'global' END;
    ```
  - Parse result: `IFS=$'\x1f' read -r _id POPPED_TASK LAST_QUEUE_KIND`
  - Remaining count: `LAST_QUEUE_REMAINING=$(sql "SELECT COUNT(*) FROM tasks WHERE status='queued'")`
  - Return 0 if `POPPED_TASK` non-empty, else 1

### 6. Syntax verification  <!-- agent: general-purpose --> <!-- Completed: 2026-06-12 -->

- [x] Run `bash -n scripts/lib/db.sh` — no syntax errors
- [x] Run `bash -c "source scripts/lib/db.sh && echo 'sourced ok'"` against a test env to verify it sources without errors (CONDUCTOR_DB may not exist yet — that's OK)
