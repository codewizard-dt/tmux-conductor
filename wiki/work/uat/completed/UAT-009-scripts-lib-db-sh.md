---
id: UAT-009
title: "UAT: Create scripts/lib/db.sh — sql wrapper, load_agents, load_bg, pop_task_sql"
status: passed
task: TASK-009
created: 2026-06-12
updated: 2026-06-12
---

# UAT-009 — UAT: Create scripts/lib/db.sh — sql wrapper, load_agents, load_bg, pop_task_sql

implements::[[TASK-009]]

> **Source task**: [`wiki/work/tasks/TASK-009-scripts-lib-db-sh.md`](../tasks/TASK-009-scripts-lib-db-sh.md)
> **Generated**: 2026-06-12

---

## Prerequisites

- [ ] `sqlite3` CLI on PATH (`sqlite3 --version` — tested against 3.51)
- [ ] `bash >= 4.0` available (macOS ships 3.2; install via `brew install bash`). The helpers use associative arrays and `declare -gA`, which require bash 4+. Run the commands below with that bash (e.g. `/opt/homebrew/bin/bash`), which is what `#!/usr/bin/env bash` resolves to.
- [ ] Working directory is the repo root: `/Users/davidtaylor/Repositories/tmux-conductor`
- [ ] `scripts/lib/db.sh` exists (created by TASK-009)
- [ ] A seeded scratch DB exists at `./tmp/uat-db/conductor.db`, created by running the **Seed** block below first. The DB uses the same table/column names as the real schema (`agents`, `bg_processes`, `tasks`, `projects`).
- [ ] Every command below exports an **absolute** `CONDUCTOR_DB` so the library's source-time path resolution is bypassed. This is the supported invocation pattern (all consuming scripts pass `CONDUCTOR_DB` via env). See `UAT-EDGE-003` for the documented macOS `realpath -m` quirk that only fires when `CONDUCTOR_DB` is *unset*.

### Seed (run once before the test cases)

Creates the scratch DB with two agents (`alpha` linked to project `proj` and to bg process `logs`; `beta` unscoped, no bg), one bg process, and three queued tasks spanning all three scopes (global, project, agent-scoped).

```bash
bash -c 'mkdir -p ./tmp/uat-db && rm -f ./tmp/uat-db/conductor.db && sqlite3 ./tmp/uat-db/conductor.db "CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, workdir TEXT NOT NULL); CREATE TABLE agents (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, workdir TEXT NOT NULL, launch_cmd TEXT NOT NULL, project_id INTEGER REFERENCES projects(id)); CREATE TABLE bg_processes (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, workdir TEXT NOT NULL, launch_cmd TEXT NOT NULL, linked_agent_id INTEGER REFERENCES agents(id)); CREATE TABLE tasks (id INTEGER PRIMARY KEY, command TEXT NOT NULL, agent_id INTEGER, project_id INTEGER, position REAL NOT NULL, status TEXT NOT NULL DEFAULT (quote(0))); INSERT INTO projects (id,name,workdir) VALUES (1,\"proj\",\"/work/proj\"); INSERT INTO agents (id,name,workdir,launch_cmd,project_id) VALUES (1,\"alpha\",\"/work/alpha\",\"claude\",1),(2,\"beta\",\"/work/beta\",\"aider\",NULL); INSERT INTO bg_processes (id,name,workdir,launch_cmd,linked_agent_id) VALUES (1,\"logs\",\"/work/logs\",\"tail -f x\",1); UPDATE tasks SET status=status; INSERT INTO tasks (command,agent_id,project_id,position,status) VALUES (\"global-1\",NULL,NULL,1.0,\"queued\"),(\"proj-1\",NULL,1,2.0,\"queued\"),(\"alpha-scoped-1\",1,NULL,3.0,\"queued\"); SELECT \"seeded rows: \" || COUNT(*) FROM tasks;"'
```

> Note on the seed: the `status` column default is written defensively above; the three `INSERT`s set `status='queued'` explicitly, which is what matters. Expected stdout: `seeded rows: 3`.

---

## Test Cases

### UAT-CLI-001: db.sh has no syntax errors and sources cleanly
- **Description**: The library parses under `bash -n` and can be sourced (with an absolute `CONDUCTOR_DB` provided) without aborting.
- **Steps**:
  1. Run the command below from the repo root.
- **Command**:
  ```bash
  bash -c 'bash -n scripts/lib/db.sh && CONDUCTOR_DB="$(pwd)/tmp/uat-db/conductor.db" bash -c "source scripts/lib/db.sh && echo sourced-ok"'
  ```
- **Expected Result**: Exit code 0; stdout is exactly `sourced-ok`. No syntax-error output.
- [x] Pass

### UAT-CLI-002: sql() wrapper executes a query and returns rows
- **Description**: `sql()` wraps `sqlite3` with the `.timeout`/`-separator $'\x1f'` settings and returns query output against `$CONDUCTOR_DB`.
- **Steps**:
  1. Seed block has been run.
  2. Run the command below.
- **Command**:
  ```bash
  CONDUCTOR_DB="$(pwd)/tmp/uat-db/conductor.db" bash -c 'source scripts/lib/db.sh && sql "SELECT COUNT(*) FROM tasks"'
  ```
- **Expected Result**: Exit code 0; stdout is exactly `3` (three seeded tasks).
- [x] Pass

### UAT-CLI-003: sql() returns multi-column rows joined by the \x1f unit separator
- **Description**: `sql()` uses `-separator $'\x1f'` so multi-column rows are split safely by `IFS=$'\x1f'`. This test renders the separator as a visible token to confirm it is the Unit Separator (0x1f), not a comma or pipe.
- **Steps**:
  1. Seed block has been run.
  2. Run the command below — it pipes a two-column row through `cat -v`, which renders 0x1f as `^_`.
- **Command**:
  ```bash
  CONDUCTOR_DB="$(pwd)/tmp/uat-db/conductor.db" bash -c 'source scripts/lib/db.sh && sql "SELECT name, workdir FROM agents WHERE name='\''alpha'\''" | cat -v'
  ```
- **Expected Result**: Exit code 0; stdout is exactly `alpha^_/work/alpha` (the `^_` is `cat -v`'s rendering of the 0x1f separator). No comma or pipe between the two columns.
- [x] Pass

### UAT-CLI-004: sql_one() returns only the first row
- **Description**: `sql_one()` is `sql … | head -n1` — it returns a single (first) row even when the query would yield several.
- **Steps**:
  1. Seed block has been run.
  2. Run the command below (the query would return two agent names; only the first should print).
- **Command**:
  ```bash
  CONDUCTOR_DB="$(pwd)/tmp/uat-db/conductor.db" bash -c 'source scripts/lib/db.sh && sql_one "SELECT name FROM agents ORDER BY name"'
  ```
- **Expected Result**: Exit code 0; stdout is exactly `alpha` (single line; `beta` is not printed).
- [x] Pass

### UAT-CLI-005: load_agents() populates AGENT_NAMES, AGENT_DIRS, AGENT_CMDS
- **Description**: `load_agents()` runs the JOIN query and fills the indexed array `AGENT_NAMES[]` plus associative arrays `AGENT_DIRS`, `AGENT_CMDS`, ordered by agent name.
- **Steps**:
  1. Seed block has been run.
  2. Run the command below.
- **Command**:
  ```bash
  CONDUCTOR_DB="$(pwd)/tmp/uat-db/conductor.db" bash -c 'source scripts/lib/db.sh && load_agents && printf "names=%s|alpha_dir=%s|alpha_cmd=%s|beta_dir=%s|beta_cmd=%s\n" "${AGENT_NAMES[*]}" "${AGENT_DIRS[alpha]}" "${AGENT_CMDS[alpha]}" "${AGENT_DIRS[beta]}" "${AGENT_CMDS[beta]}"'
  ```
- **Expected Result**: Exit code 0; stdout is exactly `names=alpha beta|alpha_dir=/work/alpha|alpha_cmd=claude|beta_dir=/work/beta|beta_cmd=aider`.
- [x] Pass

### UAT-CLI-006: load_agents() AGENT_BG reflects the bg-process LEFT JOIN
- **Description**: The LEFT JOIN on `bg_processes.linked_agent_id` sets `AGENT_BG[<agent>]` to the linked bg-process name, or empty string when no bg process is linked. `alpha` is linked to `logs`; `beta` is unlinked.
- **Steps**:
  1. Seed block has been run.
  2. Run the command below.
- **Command**:
  ```bash
  CONDUCTOR_DB="$(pwd)/tmp/uat-db/conductor.db" bash -c 'source scripts/lib/db.sh && load_agents && printf "alpha_bg=[%s]|beta_bg=[%s]\n" "${AGENT_BG[alpha]}" "${AGENT_BG[beta]}"'
  ```
- **Expected Result**: Exit code 0; stdout is exactly `alpha_bg=[logs]|beta_bg=[]` (alpha linked to `logs`; beta's bg is the empty string via `COALESCE(b.name,'')`).
- [x] Pass

### UAT-CLI-007: load_bg() populates BG_NAMES, BG_DIRS, BG_CMDS
- **Description**: `load_bg()` selects from `bg_processes ORDER BY name` and fills `BG_NAMES[]`, `BG_DIRS`, `BG_CMDS`.
- **Steps**:
  1. Seed block has been run.
  2. Run the command below.
- **Command**:
  ```bash
  CONDUCTOR_DB="$(pwd)/tmp/uat-db/conductor.db" bash -c 'source scripts/lib/db.sh && load_bg && printf "names=%s|logs_dir=%s|logs_cmd=%s\n" "${BG_NAMES[*]}" "${BG_DIRS[logs]}" "${BG_CMDS[logs]}"'
  ```
- **Expected Result**: Exit code 0; stdout is exactly `names=logs|logs_dir=/work/logs|logs_cmd=tail -f x`.
- [x] Pass

### UAT-CLI-008: pop_task_sql() pops agent-scoped task first (highest priority)
- **Description**: With one task in each scope queued, the first pop for `alpha` must return the **agent-scoped** task, set `LAST_QUEUE_KIND=scoped`, and decrement `LAST_QUEUE_REMAINING` to 2. The pop is an atomic `DELETE…RETURNING`, so the row is removed.
- **Steps**:
  1. **Re-run the Seed block** immediately before this test so all three tasks are present (earlier pop tests are destructive).
  2. Run the command below.
- **Command**:
  ```bash
  CONDUCTOR_DB="$(pwd)/tmp/uat-db/conductor.db" bash -c 'source scripts/lib/db.sh && pop_task_sql alpha; printf "rc=%s|task=%s|kind=%s|remaining=%s\n" "$?" "$POPPED_TASK" "$LAST_QUEUE_KIND" "$LAST_QUEUE_REMAINING"'
  ```
- **Expected Result**: Exit code 0; stdout is exactly `rc=0|task=alpha-scoped-1|kind=scoped|remaining=2`.
- [x] Pass

### UAT-CLI-009: pop_task_sql() drains in scope priority order — scoped, then project, then global
- **Description**: Four sequential pops for `alpha` must return tasks in priority order (scoped → project → global), then signal empty. Each pop returns the correct `kind` and a correctly decrementing remaining count; the fourth pop returns non-zero (rc=1) with an empty `POPPED_TASK`.
- **Steps**:
  1. **Re-run the Seed block** immediately before this test.
  2. Run the command below (four pops in one sourced shell).
- **Command**:
  ```bash
  CONDUCTOR_DB="$(pwd)/tmp/uat-db/conductor.db" bash -c 'source scripts/lib/db.sh; for i in 1 2 3 4; do if pop_task_sql alpha; then printf "pop%s=%s/%s/%s\n" "$i" "$POPPED_TASK" "$LAST_QUEUE_KIND" "$LAST_QUEUE_REMAINING"; else printf "pop%s=EMPTY/rc1/%s\n" "$i" "$LAST_QUEUE_REMAINING"; fi; done'
  ```
- **Expected Result**: Exit code 0; stdout is exactly:
  ```
  pop1=alpha-scoped-1/scoped/2
  pop2=proj-1/project/1
  pop3=global-1/global/0
  pop4=EMPTY/rc1/0
  ```
- [x] Pass

### UAT-CLI-010: pop_task_sql() for an unscoped agent skips other agents' scoped tasks
- **Description**: `beta` has no project and no scoped task. Popping for `beta` must skip `alpha`'s scoped task and `proj`'s project task (beta is not in that project) and return only the **global** task. This proves the scope predicates correctly exclude another agent's work.
- **Steps**:
  1. **Re-run the Seed block** immediately before this test.
  2. Run the command below (first pop for beta, then a second to confirm nothing else is eligible).
- **Command**:
  ```bash
  CONDUCTOR_DB="$(pwd)/tmp/uat-db/conductor.db" bash -c 'source scripts/lib/db.sh; pop_task_sql beta; printf "pop1=%s/%s/%s\n" "$POPPED_TASK" "$LAST_QUEUE_KIND" "$LAST_QUEUE_REMAINING"; if pop_task_sql beta; then printf "pop2=%s/%s\n" "$POPPED_TASK" "$LAST_QUEUE_KIND"; else printf "pop2=EMPTY-for-beta(remaining=%s)\n" "$LAST_QUEUE_REMAINING"; fi'
  ```
- **Expected Result**: Exit code 0; stdout is exactly:
  ```
  pop1=global-1/global/2
  pop2=EMPTY-for-beta(remaining=2)
  ```
  (beta's first pop takes only the global task, leaving the scoped + project tasks — 2 remaining — neither of which beta is eligible for, so the second pop is empty.)
- [x] Pass

### UAT-EDGE-001: pop_task_sql() on an empty queue returns rc=1 and clears outputs
- **Description**: When no eligible task exists, `pop_task_sql` must leave `POPPED_TASK` empty, set `LAST_QUEUE_REMAINING=0`, and return non-zero — without aborting under `set -e` (the empty-result read is guarded).
- **Steps**:
  1. Run the command below against a freshly created **empty** DB (this test seeds its own empty schema inline; it does not depend on `./tmp/uat-db/conductor.db`).
- **Command**:
  ```bash
  bash -c 'mkdir -p ./tmp/uat-db && rm -f ./tmp/uat-db/empty.db && sqlite3 ./tmp/uat-db/empty.db "CREATE TABLE agents (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, workdir TEXT, launch_cmd TEXT, project_id INTEGER); CREATE TABLE tasks (id INTEGER PRIMARY KEY, command TEXT, agent_id INTEGER, project_id INTEGER, position REAL, status TEXT); INSERT INTO agents (id,name) VALUES (1,\"alpha\");" && CONDUCTOR_DB="$(pwd)/tmp/uat-db/empty.db" bash -c "source scripts/lib/db.sh; if pop_task_sql alpha; then echo UNEXPECTED-rc0; else printf \"rc=%s|task=[%s]|remaining=%s\n\" \"1\" \"\$POPPED_TASK\" \"\$LAST_QUEUE_REMAINING\"; fi"'
  ```
- **Expected Result**: Exit code 0 (the wrapper handles the non-zero pop); stdout is exactly `rc=1|task=[]|remaining=0`. No `UNEXPECTED-rc0`, no `set -e` abort.
- [x] Pass

### UAT-EDGE-002: load_agents() / load_bg() on empty tables yield empty arrays
- **Description**: Against a DB with the tables present but no agent/bg rows, `load_agents` and `load_bg` must complete cleanly and leave the name arrays empty (no error, no stray entries from blank-line guards).
- **Steps**:
  1. Run the command below (creates an empty-but-valid schema inline).
- **Command**:
  ```bash
  bash -c 'mkdir -p ./tmp/uat-db && rm -f ./tmp/uat-db/notables.db && sqlite3 ./tmp/uat-db/notables.db "CREATE TABLE agents (id INTEGER PRIMARY KEY, name TEXT, workdir TEXT, launch_cmd TEXT); CREATE TABLE bg_processes (id INTEGER PRIMARY KEY, name TEXT, workdir TEXT, launch_cmd TEXT, linked_agent_id INTEGER);" && CONDUCTOR_DB="$(pwd)/tmp/uat-db/notables.db" bash -c "source scripts/lib/db.sh; load_agents; load_bg; printf \"agents=%s|bg=%s\n\" \"\${#AGENT_NAMES[@]}\" \"\${#BG_NAMES[@]}\""'
  ```
- **Expected Result**: Exit code 0; stdout is exactly `agents=0|bg=0` (both arrays empty, no errors).
- [x] Pass

### UAT-EDGE-003: source-time DB path resolution (known macOS realpath -m quirk)
- **Description**: When `CONDUCTOR_DB` is **unset**, `db.sh` resolves the DB path from `conductor.conf`'s `DB_PATH` using `realpath -m`. On macOS (BSD `realpath`), `-m` is not supported and prints `realpath: illegal option -- m`. Per the task, this is a **known, non-fatal quirk** — the supported invocation always passes an absolute `CONDUCTOR_DB` via env (as every consuming script does), which bypasses this branch entirely. This test documents the quirk and verifies the env-provided path takes precedence with no warning.
- **Steps**:
  1. Run the command below. It sources `db.sh` twice: once with `CONDUCTOR_DB` unset (to surface the BSD warning), once with it set (to confirm the warning is bypassed and the provided path wins).
- **Command**:
  ```bash
  bash -c 'echo "--- unset (expect BSD realpath warning, non-fatal) ---"; ( unset CONDUCTOR_DB; bash -c "source scripts/lib/db.sh 2>&1; true" ) ; echo "--- env-provided (no warning, path wins) ---"; CONDUCTOR_DB="$(pwd)/tmp/uat-db/conductor.db" bash -c "source scripts/lib/db.sh 2>&1; echo CONDUCTOR_DB=\$CONDUCTOR_DB"'
  ```
- **Expected Result**: Exit code 0. The first section may print `realpath: illegal option -- m` (the documented, non-fatal macOS quirk — acceptable). The second section prints `CONDUCTOR_DB=` followed by the absolute path ending in `/tmp/uat-db/conductor.db`, with **no** `realpath` warning — confirming the env path bypasses the conf-resolution branch. On a Linux/GNU host the first warning is simply absent, which is also a pass.
- [x] Pass

### UAT-EDGE-004: pop is atomic — concurrent pops never hand out the same task twice
- **Description**: The `DELETE…RETURNING` pop is atomic, so two pops for the same agent return two distinct tasks (no double-dispatch). With three tasks seeded, three sequential pops return three distinct commands and the fourth is empty.
- **Steps**:
  1. **Re-run the Seed block** immediately before this test.
  2. Run the command below, which collects the popped commands and checks they are all distinct.
- **Command**:
  ```bash
  CONDUCTOR_DB="$(pwd)/tmp/uat-db/conductor.db" bash -c 'source scripts/lib/db.sh; out=""; for i in 1 2 3; do pop_task_sql alpha && out="$out $POPPED_TASK"; done; uniq=$(printf "%s\n" $out | sort -u | wc -l | tr -d " "); printf "popped:%s|distinct=%s\n" "$out" "$uniq"'
  ```
- **Expected Result**: Exit code 0; stdout is exactly `popped: alpha-scoped-1 proj-1 global-1|distinct=3` (three pops, three distinct commands — no task handed out twice).
- [x] Pass

---

## Cleanup

```bash
bash -c 'rm -rf ./tmp/uat-db && echo cleaned'
```
