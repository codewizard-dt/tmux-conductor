---
id: TASK-014
title: "Rewrite add-task.sh to insert directly via sqlite3"
status: done
created: 2026-06-12
updated: 2026-06-12
depends_on: [TASK-009]
blocks: []
parallel_safe_with: [TASK-001, TASK-011, TASK-012]
uat: "../uat/UAT-014-add-task-sh-sqlite-insert.md"
tags: [shell, sqlite, add-task]
---

# TASK-014 — Rewrite add-task.sh to insert directly via sqlite3

## Objective

Migrate `scripts/add-task.sh` from appending a scoped task line (`agentname: command`) to the flat-file `tasks.txt` over to inserting a row directly into the SQLite `tasks` table at `./data/conductor.db`. The rewritten script sources `scripts/lib/db.sh` (for the `sql()` helper and `CONDUCTOR_DB` resolution), resolves the caller's CWD basename to an `agent_id`, computes the next tail `position`, and `INSERT`s a row with `status='queued'` and `source='manual'`. The existing CLI contract is preserved exactly: **caller's CWD basename = agent name; the command is passed as positional args** (`add-task.sh <command words...>`).

## Approach

The SQLite data layer (ROADMAP-001) made the `tasks` table the single source of truth for the queue; `monitor.sh` now pops via `pop_task_sql()` and the backend inserts via `addTask()`. `add-task.sh` is the last writer still appending to the legacy flat file, so its appends are invisible to the DB-backed queue. This task closes that gap by making `add-task.sh` insert a row whose column semantics match exactly what `monitor.sh`'s `pop_task_sql` reads and what the backend's `addTask` writes.

Authoritative facts confirmed from the codebase:

- **`tasks` schema** (`backend/db.ts` `runMigrations`): `id INTEGER PK`, `command TEXT NOT NULL`, `agent_id INTEGER` (FK `agents`, nullable), `project_id INTEGER` (FK `projects`, nullable), `position REAL NOT NULL`, `status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','backlog'))`, `source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','schedule'))`, `schedule_id INTEGER`, `created_at TEXT` (defaulted), plus `CHECK (agent_id IS NULL OR project_id IS NULL)`. A **scoped** task sets `agent_id` and leaves `project_id` NULL.
- **Tail position convention** (backend `addTask`, placement `'tail'`): `position = (SELECT MAX(position) FROM tasks WHERE status='queued') + 1.0`, with `MAX` of an empty set treated as `0`. `position` is a REAL to allow fractional reordering — match this exactly so dashboard-added and CLI-added tasks share one ordering scheme.
- **Agent resolution**: `SELECT id FROM agents WHERE name='<agent>'` (used by `pop_task_sql`, `listTasksForAgent`, `move_to_backlog`). Agent names are validated by a schema `CHECK (name GLOB '[A-Za-z0-9_-]*')`, so a basename containing no `[A-Za-z0-9_-]` chars can never match a row.
- **`sql()` helper** (`scripts/lib/db.sh`): `sqlite3 -cmd '.timeout 5000' -separator $'\x1f' "$CONDUCTOR_DB"`. Sourcing `db.sh` resolves `CONDUCTOR_DB` (env > conf `DB_PATH` > `./data/conductor.db` default) at source time. SQL string literals embed single quotes by doubling them (`''`); TASK-010's `move_to_backlog` uses the bash idiom `${agent_name//\'/''}` for the agent name and the same doubling must be applied to the command text.

**Scope decision (scoped vs global):** preserve the legacy behavior — the basename is always treated as the intended agent scope. Resolve it to `agent_id`. If the basename does not resolve to an agents row, fall back to a **global** task (`agent_id` NULL, `project_id` NULL) so the task is still queued and dispatchable, emitting a warning to stderr (mirrors the legacy "task may not be dispatched" warning and `importTaskLines`'s "unknown scope prefix → global" handling). Do **not** attempt project scoping — the legacy CLI never had a notion of projects.

## Steps

### 1. Inspect current structure and source scripts/lib/db.sh  <!-- agent: general-purpose -->

- [x] Use Serena `get_symbols_overview` / read `scripts/add-task.sh` to confirm the current flat-file flow (CWD basename → `AGENT_NAME`, `CMD="$*"`, append `"${AGENT_NAME}: ${CMD}"` to `tasks.txt`)
- [x] Keep the shebang, `set -euo pipefail`, the `SCRIPT_DIR` computation, the `if [[ $# -lt 1 ]]` usage guard, and `CMD="$*"`
- [x] Keep `AGENT_NAME="$(basename "$PWD")"` (the CLI contract: CWD basename is the agent name)
- [x] Add, after `SCRIPT_DIR` is set: `source "$SCRIPT_DIR/lib/db.sh"` — this brings in `sql()` and resolves `CONDUCTOR_DB`. Remove the now-unused `TASKS_FILE` variable

### 2. Decide how to handle the conductor.conf agent-registration prompt  <!-- agent: general-purpose -->

- [x] The legacy script has an interactive block that, when `AGENT_NAME` isn't found in `conductor.conf`'s `AGENTS=(...)` array, offers to append it (the `agent_defined` grep + `awk` rewrite). With the DB as source of truth, agents live in the `agents` table, not the conf array
- [x] **Decision:** drop the conf-array registration block entirely. Replace its purpose with a DB existence check (next step) that resolves `agent_id` and warns-then-falls-back-to-global on miss. Do NOT add agent-row creation here — agent creation is the backend/conductor's responsibility, not `add-task.sh`'s
- [x] Remove the `CONF_FILE`, `agent_defined()`, and the interactive `read`/`awk` registration block

### 3. Resolve the agent name to an agent_id  <!-- agent: general-purpose -->

- [x] Escape the agent name for SQL by doubling single quotes (same idiom as TASK-010): `AGENT_SQL="${AGENT_NAME//\'/\'\'}"`
- [x] Query: `AGENT_ID="$(sql "SELECT id FROM agents WHERE name='${AGENT_SQL}'")"` (use `sql`, not `sql_one`; a name is UNIQUE so at most one row)
- [x] If `AGENT_ID` is empty: print a stderr warning (e.g. `Warning: agent '<name>' not found in DB; adding as a global (unscoped) task.`) and leave `AGENT_ID` empty so the INSERT uses NULL `agent_id` (global task). This preserves dispatchability and mirrors `importTaskLines`'s unknown-prefix → global behavior

### 4. Compute the next tail position  <!-- agent: general-purpose -->

- [x] Match the backend `addTask` tail convention exactly: `POSITION="$(sql "SELECT COALESCE(MAX(position), 0) + 1.0 FROM tasks WHERE status='queued'")"`
- [x] Note `position` is `REAL NOT NULL` — `COALESCE(MAX(position),0)+1.0` yields a numeric literal safe to inline into the INSERT (no quoting). This appends the new task to the tail of the queued set, consistent with dashboard-added tasks

### 5. INSERT the task row  <!-- agent: general-purpose -->

- [x] Escape the command for SQL by doubling single quotes: `CMD_SQL="${CMD//\'/\'\'}"`
- [x] Build the `agent_id` value as a SQL fragment: `NULL` when `AGENT_ID` is empty, otherwise the numeric id. Example:
  ```bash
  if [[ -n "$AGENT_ID" ]]; then AGENT_ID_SQL="$AGENT_ID"; else AGENT_ID_SQL="NULL"; fi
  ```
- [x] Insert (set `agent_id`, leave `project_id` NULL per the scoped-task / `CHECK (agent_id IS NULL OR project_id IS NULL)` constraint; let `status`/`source`/`created_at` use their schema defaults or set them explicitly):
  ```bash
  sql "INSERT INTO tasks (command, agent_id, project_id, position, status, source)
       VALUES ('${CMD_SQL}', ${AGENT_ID_SQL}, NULL, ${POSITION}, 'queued', 'manual')"
  ```
- [x] Keep a success line on stdout preserving the legacy feedback, e.g. `echo "Added task for ${AGENT_NAME}: ${CMD}"` (and note in the message when it was added globally)

### 6. Sanity-check column semantics against readers  <!-- agent: general-purpose -->

- [x] Confirm the inserted row is visible to `monitor.sh`'s pop path: `pop_task_sql` selects `status='queued'` rows where `agent_id = (SELECT id FROM agents WHERE name=?)` (scoped) or `agent_id IS NULL AND project_id IS NULL` (global), ordered by scope-priority then `position` — a row written by this script matches both the scoped and the global branch correctly
- [x] Confirm the row is visible in the dashboard: `listTasksForAgent` uses the same `status='queued'` + scope predicate, so a CLI-added scoped task shows under its agent and a global one shows for every agent

### 7. Syntax verification  <!-- agent: general-purpose -->

- [x] Run `bash -n scripts/add-task.sh` — no syntax errors
- [DEFERRED-TO-UAT] (Optional smoke test, host-only, using `./tmp/`) Point `CONDUCTOR_DB` at a throwaway copy of the DB under `./tmp/`, run `add-task.sh smoke test command` from an agent's workdir, and verify with `sql "SELECT command, agent_id, position, status FROM tasks ORDER BY id DESC LIMIT 1"` that the row landed with the right scope, tail position, and `status='queued'`. Never mutate the live `./data/conductor.db` for the smoke test

<!-- Updated: 2026-06-12 -->
<!-- Tackle complete: scripts/add-task.sh rewritten to INSERT into SQLite tasks table; bash -n passed. Step 7 smoke test deferred to UAT (runtime). -->
