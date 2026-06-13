---
id: UAT-010
title: "UAT: Rewrite monitor.sh pop_task as atomic SQL pop and move_to_backlog as status flip"
status: passed
task: TASK-010
created: 2026-06-12
updated: 2026-06-12
---

# UAT-010 — UAT: Rewrite monitor.sh pop_task as atomic SQL pop and move_to_backlog as status flip

implements::[[TASK-010]]

> **Source task**: [`wiki/work/tasks/TASK-010-monitor-sh-db.md`](../tasks/TASK-010-monitor-sh-db.md)
> **Generated**: 2026-06-12

---

## Prerequisites

- [ ] `sqlite3 >= 3.35` on PATH (atomic pop relies on `DELETE … RETURNING`, added in 3.35). Verified host: 3.51.
- [ ] `bash >= 4` on PATH (named arrays via `declare -gA`). Verified host: 5.3.
- [ ] Run all commands from the repo root (`tmux-conductor/`).
- [ ] The scratch DB lives at `./tmp/uat-monitor/conductor.db`. Several pop/backlog tests are destructive, so each behavioral test below **re-seeds its own DB inline** — they do not depend on each other or on run order.

### Why these tests source `scripts/lib/db.sh`, not `scripts/monitor.sh`

`scripts/monitor.sh` runs its `while true` poll loop at top level, so sourcing it directly would launch the monitor and never return. TASK-010 made `pop_task()` and `move_to_backlog()` thin wrappers over `lib/db.sh` (`pop_task` → `pop_task_sql`; `move_to_backlog` → a `sql "UPDATE …"` status flip), and re-invokes `load_agents`/`load_bg` from `lib/db.sh` at the top of the loop. The behavioral tests therefore source the real `scripts/lib/db.sh` (the actual implementation of `pop_task_sql`, `sql`, `load_agents`) and define the two thin monitor wrappers using their **exact bodies copied from `scripts/monitor.sh:46-58`**, exercising the same contract monitor.sh uses without starting the loop. A `bash -n` gate (UAT-CLI-001) covers the whole `monitor.sh` file as written.

Each behavioral test is a single `bash` invocation reading a `<<'SH' … SH` heredoc. The heredoc avoids nested-quote escaping so the SQL string literals (single-quoted) and the `${name//\'/\'\'}` quote-doubling in `move_to_backlog` survive verbatim. Run each fenced block exactly as written, from the repo root. All commands were executed during generation and produce the stated output.

---

## Test Cases

### UAT-CLI-001: monitor.sh parses with no syntax errors
- **Description**: The full refactored `scripts/monitor.sh` (sourcing `lib/db.sh`, the rewritten `pop_task`/`move_to_backlog`, the in-loop `load_agents`/`load_bg`) parses cleanly under `bash -n`. This is the static gate that covers the file as a whole.
- **Steps**:
  1. Run the command below from the repo root.
- **Command**:
  ```bash
  bash -n scripts/monitor.sh
  ```
- **Expected Result**: Exit code 0; no output (no syntax-error lines).
- [x] Pass

### UAT-CLI-002: monitor.sh sources lib/db.sh and no longer references the flat-file queue
- **Description**: TASK-010 removed all `TASK_QUEUE` / `tasks.txt` / `tasks.backlog.txt` references from `monitor.sh` and added a `source ".../lib/db.sh"` line. This asserts both: db.sh is sourced, and the legacy flat-file queue identifiers are gone from the script.
- **Steps**:
  1. Run the command below — it prints whether db.sh is sourced and counts any surviving flat-file references.
- **Command**:
  ```bash
  bash -c 'src=$(grep -c "source \"\$SCRIPT_DIR/lib/db.sh\"" scripts/monitor.sh); legacy=$(grep -Ec "TASK_QUEUE|tasks\.txt|tasks\.backlog\.txt" scripts/monitor.sh || true); printf "db_sh_sourced=%s|legacy_refs=%s\n" "$src" "$legacy"'
  ```
- **Expected Result**: Exit code 0; stdout is exactly `db_sh_sourced=1|legacy_refs=0`.
- [x] Pass

### UAT-CLI-003: pop_task() pops the next task atomically and removes the row
- **Description**: `pop_task()` delegates to `pop_task_sql()`, which performs an atomic `DELETE … RETURNING`. With an agent-scoped, a project, and a global task queued for `alpha`, the first pop must return the agent-scoped task (highest precedence), set `LAST_QUEUE_KIND=scoped`, decrement `LAST_QUEUE_REMAINING`, return exit 0, and **delete the popped row** from the DB (proving the pop is a real removal, not a read).
- **Steps**:
  1. Run the command below as-is. It seeds a fresh DB, sources `lib/db.sh`, defines `pop_task()` with the exact body from `scripts/monitor.sh:55-58`, pops once, and re-queries the DB to confirm the row is gone.
- **Command**:
  ```bash
bash <<'SH'
export CONDUCTOR_DB="$(pwd)/tmp/uat-monitor/pop.db"
mkdir -p ./tmp/uat-monitor && rm -f "$CONDUCTOR_DB"
sqlite3 "$CONDUCTOR_DB" "CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, workdir TEXT NOT NULL); CREATE TABLE agents (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, workdir TEXT NOT NULL, launch_cmd TEXT NOT NULL, project_id INTEGER); CREATE TABLE tasks (id INTEGER PRIMARY KEY, command TEXT NOT NULL, agent_id INTEGER, project_id INTEGER, position REAL NOT NULL, status TEXT NOT NULL DEFAULT 'queued'); INSERT INTO projects (id,name,workdir) VALUES (1,'proj','/work/proj'); INSERT INTO agents (id,name,workdir,launch_cmd,project_id) VALUES (1,'alpha','/work/alpha','claude',1); INSERT INTO tasks (command,agent_id,project_id,position,status) VALUES ('global-1',NULL,NULL,1.0,'queued'),('proj-1',NULL,1,2.0,'queued'),('alpha-scoped-1',1,NULL,3.0,'queued');"
source scripts/lib/db.sh
pop_task() { local agent_name="$1"; pop_task_sql "$agent_name"; }
if pop_task alpha; then
  printf 'rc=0|task=%s|kind=%s|remaining=%s|still_in_db=%s\n' "$POPPED_TASK" "$LAST_QUEUE_KIND" "$LAST_QUEUE_REMAINING" "$(sql "SELECT COUNT(*) FROM tasks WHERE command='alpha-scoped-1'")"
fi
SH
  ```
- **Expected Result**: Exit code 0; stdout is exactly `rc=0|task=alpha-scoped-1|kind=scoped|remaining=2|still_in_db=0`. The popped row is deleted (`still_in_db=0`), confirming an atomic SQL pop rather than a flat-file scan.
- [x] Pass

### UAT-CLI-004: pop_task() drains in scope-precedence order then signals empty
- **Description**: Repeated `pop_task alpha` calls must drain the queue in precedence order — agent-scoped → project → global — with `LAST_QUEUE_KIND` reflecting each kind, and the final pop (empty queue) returning a non-zero exit with an empty `POPPED_TASK` (the `set -e`-safe guard in `pop_task_sql`). This is the contract the dispatch guard `if pop_task "$name"; then …` in `monitor.sh` depends on.
- **Steps**:
  1. Run the command below. It seeds one task per scope and pops four times in a single sourced shell.
- **Command**:
  ```bash
bash <<'SH'
export CONDUCTOR_DB="$(pwd)/tmp/uat-monitor/drain.db"
mkdir -p ./tmp/uat-monitor && rm -f "$CONDUCTOR_DB"
sqlite3 "$CONDUCTOR_DB" "CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, workdir TEXT NOT NULL); CREATE TABLE agents (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, workdir TEXT NOT NULL, launch_cmd TEXT NOT NULL, project_id INTEGER); CREATE TABLE tasks (id INTEGER PRIMARY KEY, command TEXT NOT NULL, agent_id INTEGER, project_id INTEGER, position REAL NOT NULL, status TEXT NOT NULL DEFAULT 'queued'); INSERT INTO projects (id,name,workdir) VALUES (1,'proj','/work/proj'); INSERT INTO agents (id,name,workdir,launch_cmd,project_id) VALUES (1,'alpha','/work/alpha','claude',1); INSERT INTO tasks (command,agent_id,project_id,position,status) VALUES ('global-1',NULL,NULL,1.0,'queued'),('proj-1',NULL,1,2.0,'queued'),('alpha-scoped-1',1,NULL,3.0,'queued');"
source scripts/lib/db.sh
pop_task() { local agent_name="$1"; pop_task_sql "$agent_name"; }
for i in 1 2 3 4; do
  if pop_task alpha; then printf 'pop%s=%s/%s/%s\n' "$i" "$POPPED_TASK" "$LAST_QUEUE_KIND" "$LAST_QUEUE_REMAINING"
  else printf 'pop%s=EMPTY/rc1/%s\n' "$i" "$LAST_QUEUE_REMAINING"; fi
done
SH
  ```
- **Expected Result**: Exit code 0; stdout is exactly:
  ```
  pop1=alpha-scoped-1/scoped/2
  pop2=proj-1/project/1
  pop3=global-1/global/0
  pop4=EMPTY/rc1/0
  ```
- [x] Pass

### UAT-CLI-005: move_to_backlog() flips only the named agent's queued tasks to status='backlog'
- **Description**: `move_to_backlog(agent_name)` resolves the agent's id and runs `UPDATE tasks SET status='backlog' WHERE agent_id=<id> AND status='queued'`. It must flip **only that agent's queued tasks** to `backlog`, leave the agent with zero queued rows, and not touch any other agent's tasks. This replaces the old file/`sed` move.
- **Steps**:
  1. Run the command below. It seeds `alpha` with two queued tasks and `beta` with one, calls `move_to_backlog alpha` (exact body from `scripts/monitor.sh:46-53`), and reports the resulting status counts.
- **Command**:
  ```bash
bash <<'SH'
export CONDUCTOR_DB="$(pwd)/tmp/uat-monitor/backlog.db"
mkdir -p ./tmp/uat-monitor && rm -f "$CONDUCTOR_DB"
sqlite3 "$CONDUCTOR_DB" "CREATE TABLE agents (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, workdir TEXT NOT NULL, launch_cmd TEXT NOT NULL, project_id INTEGER); CREATE TABLE tasks (id INTEGER PRIMARY KEY, command TEXT NOT NULL, agent_id INTEGER, project_id INTEGER, position REAL NOT NULL, status TEXT NOT NULL DEFAULT 'queued'); INSERT INTO agents (id,name,workdir,launch_cmd) VALUES (1,'alpha','/work/alpha','claude'),(2,'beta','/work/beta','aider'); INSERT INTO tasks (command,agent_id,position,status) VALUES ('alpha-q1',1,1.0,'queued'),('alpha-q2',1,2.0,'queued'),('beta-q1',2,3.0,'queued');"
source scripts/lib/db.sh
move_to_backlog() {
  local agent_name="$1"; local agent_id
  agent_id=$(sql "SELECT id FROM agents WHERE name='${agent_name//\'/\'\'}'")
  if [[ -n "$agent_id" ]]; then
    sql "UPDATE tasks SET status='backlog' WHERE agent_id=$agent_id AND status='queued'"
  fi
}
move_to_backlog alpha
printf 'alpha_backlog=%s|alpha_queued=%s|beta_queued=%s\n' \
  "$(sql "SELECT COUNT(*) FROM tasks WHERE agent_id=1 AND status='backlog'")" \
  "$(sql "SELECT COUNT(*) FROM tasks WHERE agent_id=1 AND status='queued'")" \
  "$(sql "SELECT COUNT(*) FROM tasks WHERE agent_id=2 AND status='queued'")"
SH
  ```
- **Expected Result**: Exit code 0; stdout is exactly `alpha_backlog=2|alpha_queued=0|beta_queued=1`. Both of alpha's queued tasks become `backlog`; beta's queued task is untouched.
- [x] Pass

### UAT-CLI-006: move_to_backlog() for an unknown agent is a no-op
- **Description**: When the agent name does not resolve to an id, `move_to_backlog` skips the `UPDATE` entirely (the `if [[ -n "$agent_id" ]]` guard), leaving every task's status unchanged. This proves the guard prevents an unscoped `UPDATE` that would corrupt the queue.
- **Steps**:
  1. Run the command below. It seeds one queued task for a real agent, calls `move_to_backlog ghost` (a name with no agent row), and confirms nothing moved to backlog.
- **Command**:
  ```bash
bash <<'SH'
export CONDUCTOR_DB="$(pwd)/tmp/uat-monitor/noop.db"
mkdir -p ./tmp/uat-monitor && rm -f "$CONDUCTOR_DB"
sqlite3 "$CONDUCTOR_DB" "CREATE TABLE agents (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, workdir TEXT NOT NULL, launch_cmd TEXT NOT NULL, project_id INTEGER); CREATE TABLE tasks (id INTEGER PRIMARY KEY, command TEXT NOT NULL, agent_id INTEGER, project_id INTEGER, position REAL NOT NULL, status TEXT NOT NULL DEFAULT 'queued'); INSERT INTO agents (id,name,workdir,launch_cmd) VALUES (1,'alpha','/work/alpha','claude'); INSERT INTO tasks (command,agent_id,position,status) VALUES ('alpha-q1',1,1.0,'queued');"
source scripts/lib/db.sh
move_to_backlog() {
  local agent_name="$1"; local agent_id
  agent_id=$(sql "SELECT id FROM agents WHERE name='${agent_name//\'/\'\'}'")
  if [[ -n "$agent_id" ]]; then
    sql "UPDATE tasks SET status='backlog' WHERE agent_id=$agent_id AND status='queued'"
  fi
}
move_to_backlog ghost
printf 'queued=%s|backlog=%s\n' "$(sql "SELECT COUNT(*) FROM tasks WHERE status='queued'")" "$(sql "SELECT COUNT(*) FROM tasks WHERE status='backlog'")"
SH
  ```
- **Expected Result**: Exit code 0; stdout is exactly `queued=1|backlog=0`. No task was moved (the unknown-agent branch is skipped).
- [x] Pass

### UAT-CLI-007: load_agents() re-invoked on a later tick picks up a dashboard-spawned agent
- **Description**: This is the headline behavioral change — `load_agents` now runs at the top of the poll loop, so an agent row inserted **between ticks** (e.g. by the dashboard backend) becomes visible without restarting the monitor. The test simulates two ticks: load (tick 1) → INSERT a new agent → load again (tick 2). `AGENT_NAMES` must reset cleanly each call and reflect the new row on tick 2.
- **Steps**:
  1. Run the command below. It seeds a DB with one agent (`alpha`), calls `load_agents` (tick 1), inserts `gamma`, then calls `load_agents` again (tick 2) and prints `AGENT_NAMES` at each tick.
- **Command**:
  ```bash
bash <<'SH'
export CONDUCTOR_DB="$(pwd)/tmp/uat-monitor/reload.db"
mkdir -p ./tmp/uat-monitor && rm -f "$CONDUCTOR_DB"
sqlite3 "$CONDUCTOR_DB" "CREATE TABLE agents (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, workdir TEXT NOT NULL, launch_cmd TEXT NOT NULL, project_id INTEGER); CREATE TABLE bg_processes (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, workdir TEXT NOT NULL, launch_cmd TEXT NOT NULL, linked_agent_id INTEGER); INSERT INTO agents (id,name,workdir,launch_cmd) VALUES (1,'alpha','/work/alpha','claude');"
source scripts/lib/db.sh
load_agents; printf 'tick1=%s\n' "${AGENT_NAMES[*]}"
sql "INSERT INTO agents (name,workdir,launch_cmd) VALUES ('gamma','/work/gamma','aider')" >/dev/null
load_agents; printf 'tick2=%s\n' "${AGENT_NAMES[*]}"
SH
  ```
- **Expected Result**: Exit code 0; stdout is exactly:
  ```
  tick1=alpha
  tick2=alpha gamma
  ```
  Tick 1 sees only `alpha`; after the inter-tick insert, the re-invoked `load_agents` surfaces `gamma` — confirming dashboard-spawned agents are picked up on the next poll without a monitor restart.
- [x] Pass

### UAT-CLI-008: load_agents() is positioned at the top of the poll loop body
- **Description**: TASK-010 step 4 requires `load_agents` (and `load_bg`) to be re-invoked **inside** the `while true` loop, immediately after the `ITER` increment, so each tick re-reads the agent set. This statically asserts that placement: within the first few lines of the loop body, `load_agents` and `load_bg` both appear after `ITER=$((ITER + 1))`.
- **Steps**:
  1. Run the command below. It extracts the lines from the `while true` line through the first `load_bg`, then confirms all three tokens — the `ITER` increment, a standalone `load_agents` line, and a standalone `load_bg` line — appear within that loop-head block.
- **Command**:
  ```bash
  bash -c 'block=$(awk "/while true; do/{f=1} f{print} /load_bg/{if(f)exit}" scripts/monitor.sh); echo "$block" | grep -Eq "ITER=\\\$\(\(ITER \+ 1\)\)" && echo "$block" | grep -Eq "^[[:space:]]*load_agents[[:space:]]*$" && echo "$block" | grep -Eq "^[[:space:]]*load_bg[[:space:]]*$" && echo "loop_top_order=ok"'
  ```
- **Expected Result**: Exit code 0; stdout is exactly `loop_top_order=ok` — the `ITER` increment, `load_agents`, and `load_bg` all appear at the top of the loop body.
- [x] Pass

---

## Notes

- All scratch DBs are written under `./tmp/uat-monitor/` per the repo's host-side temp-file rule; they are gitignored and safe to delete.
- Behavioral tests use a `bash <<'SH' … SH` heredoc so the SQL string literals and the `move_to_backlog` quote-doubling survive verbatim. The heredoc body and the closing `SH` are at column 0 (a non-`<<-` heredoc requires the terminator on its own unindented line) — copy each fenced block exactly as shown, without adding leading spaces.
