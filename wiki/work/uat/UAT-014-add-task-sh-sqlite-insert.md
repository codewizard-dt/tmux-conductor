---
id: UAT-014
title: "UAT: Rewrite add-task.sh to insert directly via sqlite3"
status: passed
task: TASK-014
created: 2026-06-12
updated: 2026-06-12
---

# UAT-014 — UAT: Rewrite add-task.sh to insert directly via sqlite3

implements::[[TASK-014]]

> **Source task**: [`wiki/work/tasks/TASK-014-add-task-sh-sqlite-insert.md`](../tasks/TASK-014-add-task-sh-sqlite-insert.md)
> **Generated**: 2026-06-12

---

## Prerequisites

- [ ] `sqlite3` CLI on PATH (`sqlite3 --version` — tested against 3.51)
- [ ] `bash >= 4.0` available (macOS ships 3.2; install via `brew install bash`). `#!/usr/bin/env bash` must resolve to bash 4+ (the script and `db.sh` use `set -euo pipefail` plus the `${var//\'/\'\'}` quote-doubling idiom; the helper library uses `declare -gA`).
- [ ] Working directory is the repo root: `/Users/davidtaylor/Repositories/tmux-conductor`
- [ ] `scripts/add-task.sh` exists (rewritten by TASK-014) and `scripts/lib/db.sh` exists (TASK-009)
- [ ] A seeded scratch DB exists at `./tmp/uat-add-task/conductor.db`, created by running the **Seed** block below first. Every test exports an **absolute** `CONDUCTOR_DB` pointing at that scratch DB so the library's source-time path resolution is bypassed and the live `./data/conductor.db` is never touched.
- [ ] The Seed block also creates two scratch agent workdirs — `./tmp/uat-add-task/alpha` and `./tmp/uat-add-task/unknownagent` — whose **basenames** drive the script's CWD→agent resolution. Tests `cd` into one of these before invoking `add-task.sh` (the CLI contract: CWD basename = agent name).

### Seed (run once before the test cases)

Creates the scratch DB with the real `tasks`/`agents` schema (same column names, CHECK constraints, and defaults as `backend/db.ts` `runMigrations`), seeds two agents (`alpha`, `beta`) and **no** tasks, and creates the two agent workdirs used by the tests.

```bash
bash -c 'mkdir -p ./tmp/uat-add-task/alpha ./tmp/uat-add-task/unknownagent && rm -f ./tmp/uat-add-task/conductor.db && sqlite3 ./tmp/uat-add-task/conductor.db "CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, workdir TEXT NOT NULL); CREATE TABLE agents (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE CHECK (name GLOB '\''[A-Za-z0-9_-]*'\''), workdir TEXT NOT NULL, launch_cmd TEXT NOT NULL, project_id INTEGER); CREATE TABLE tasks (id INTEGER PRIMARY KEY, command TEXT NOT NULL, agent_id INTEGER REFERENCES agents(id), project_id INTEGER REFERENCES projects(id), position REAL NOT NULL, status TEXT NOT NULL DEFAULT '\''queued'\'' CHECK (status IN ('\''queued'\'','\''backlog'\'')), source TEXT NOT NULL DEFAULT '\''manual'\'' CHECK (source IN ('\''manual'\'','\''schedule'\'')), created_at TEXT NOT NULL DEFAULT (strftime('\''%Y-%m-%dT%H:%M:%SZ'\'','\''now'\'')), CHECK (agent_id IS NULL OR project_id IS NULL)); INSERT INTO agents (id,name,workdir,launch_cmd) VALUES (1,'\''alpha'\'','\''/work/alpha'\'','\''claude'\''),(2,'\''beta'\'','\''/work/beta'\'','\''aider'\''); SELECT '\''seeded agents: '\'' || COUNT(*) FROM agents;"'
```

> Expected stdout: `seeded agents: 2`. The `tasks` table is intentionally empty so tail-position arithmetic starts from a clean `MAX(position)=0`.

---

## Test Cases

### UAT-CLI-001: add-task.sh has no syntax errors (bash -n gate)
- **Description**: The rewritten script parses under `bash -n` with no syntax errors. This is the static gate carried over from the task's Step 7.
- **Steps**:
  1. Run the command below from the repo root.
- **Command**:
  ```bash
  bash -c 'bash -n scripts/add-task.sh && echo syntax-ok'
  ```
- **Expected Result**: Exit code 0; stdout is exactly `syntax-ok`. No syntax-error output on stderr.
- [x] Pass <!-- 2026-06-12 -->

### UAT-CLI-002: scoped insert when CWD basename matches an agent
- **Description**: Run from a directory whose basename (`alpha`) matches a seeded agent. The script must resolve the basename to `agent_id=1` and INSERT a row with `agent_id=1`, `project_id` NULL, `position=1.0` (first task in an empty queue), `status='queued'`, `source='manual'`, and the positional args joined as the `command`. Stdout reports the scoped add.
- **Steps**:
  1. **Re-run the Seed block** immediately before this test (empty `tasks`, agents present, workdirs present).
  2. Run the command below — it `cd`s into the `alpha` workdir, exports the absolute scratch `CONDUCTOR_DB`, runs `add-task.sh`, then SELECTs the inserted row.
- **Command**:
  ```bash
  bash -c 'REPO="$(pwd)"; ( cd ./tmp/uat-add-task/alpha && CONDUCTOR_DB="$REPO/tmp/uat-add-task/conductor.db" "$REPO/scripts/add-task.sh" run the alpha task ); sqlite3 "$REPO/tmp/uat-add-task/conductor.db" "SELECT command||\"|\"||agent_id||\"|\"||IFNULL(project_id,\"NULL\")||\"|\"||position||\"|\"||status||\"|\"||source FROM tasks ORDER BY id DESC LIMIT 1"'
  ```
- **Expected Result**: Exit code 0. The `add-task.sh` invocation prints `Added task for alpha: run the alpha task` on stdout. The SELECT line is exactly:
  ```
  run the alpha task|1|NULL|1.0|queued|manual
  ```
  (command = the joined positional args; `agent_id=1`; `project_id` NULL; tail `position=1.0`; `status='queued'`; `source='manual'`.)
- [x] Pass <!-- 2026-06-12 -->

### UAT-CLI-003: global fallback (agent_id NULL) when basename is unknown
- **Description**: Run from a directory whose basename (`unknownagent`) does **not** match any agent row. The script must emit a warning to stderr, fall back to a global task (`agent_id` NULL, `project_id` NULL), and still INSERT a dispatchable `status='queued'` row. Stdout reports the global add.
- **Steps**:
  1. **Re-run the Seed block** immediately before this test.
  2. Run the command below — it `cd`s into the `unknownagent` workdir, captures stderr, runs the insert, then SELECTs the row (rendering NULL `agent_id` as the literal `NULL`).
- **Command**:
  ```bash
  bash -c 'REPO="$(pwd)"; ( cd ./tmp/uat-add-task/unknownagent && CONDUCTOR_DB="$REPO/tmp/uat-add-task/conductor.db" "$REPO/scripts/add-task.sh" some global task ); sqlite3 "$REPO/tmp/uat-add-task/conductor.db" "SELECT command||\"|\"||IFNULL(agent_id,\"NULL\")||\"|\"||IFNULL(project_id,\"NULL\")||\"|\"||position||\"|\"||status||\"|\"||source FROM tasks ORDER BY id DESC LIMIT 1"'
  ```
- **Expected Result**: Exit code 0. On stderr: `Warning: agent 'unknownagent' not found in DB; adding as a global (unscoped) task.`. On stdout: `Added global task: some global task`. The SELECT line is exactly:
  ```
  some global task|NULL|NULL|1.0|queued|manual
  ```
  (`agent_id` and `project_id` both NULL — a global, still-queued task; `source='manual'`.)
- [x] Pass <!-- 2026-06-12 -->

### UAT-CLI-004: tail-position ordering across two successive inserts
- **Description**: Two successive inserts (a scoped one, then a global one) must take ascending tail positions. The second position is computed as `COALESCE(MAX(position),0)+1.0` over **all** `status='queued'` rows — so a global insert following a scoped insert lands at `2.0`, not `1.0`. This proves CLI-added tasks share the backend `addTask` tail convention regardless of scope.
- **Steps**:
  1. **Re-run the Seed block** immediately before this test (empty `tasks`).
  2. Run the command below — it inserts a scoped `alpha` task, then a global task from the unknown dir, then SELECTs both rows ordered by `position`.
- **Command**:
  ```bash
  bash -c 'REPO="$(pwd)"; DB="$REPO/tmp/uat-add-task/conductor.db"; ( cd ./tmp/uat-add-task/alpha && CONDUCTOR_DB="$DB" "$REPO/scripts/add-task.sh" first task ) >/dev/null; ( cd ./tmp/uat-add-task/unknownagent && CONDUCTOR_DB="$DB" "$REPO/scripts/add-task.sh" second task ) >/dev/null 2>&1; sqlite3 "$DB" "SELECT position||\"=\"||command FROM tasks ORDER BY position"'
  ```
- **Expected Result**: Exit code 0; stdout is exactly:
  ```
  1.0=first task
  2.0=second task
  ```
  (first insert → `position=1.0`; second insert → `position=2.0`, computed from `MAX(position)+1.0` across the queued set including the prior scoped row.)
- [x] Pass <!-- 2026-06-12 -->

### UAT-EDGE-001: usage guard rejects an empty command (rc=1)
- **Description**: Invoked with no positional args, the script must print the usage line to stderr and exit non-zero **without** writing any row. This confirms the `[[ $# -lt 1 ]]` guard survived the rewrite and that sourcing `db.sh` (which resolves `CONDUCTOR_DB` at source time) does not bypass it.
- **Steps**:
  1. **Re-run the Seed block** immediately before this test (empty `tasks`).
  2. Run the command below — it invokes `add-task.sh` with no args from the `alpha` dir, captures the exit code, then asserts the `tasks` table is still empty.
- **Command**:
  ```bash
  bash -c 'REPO="$(pwd)"; DB="$REPO/tmp/uat-add-task/conductor.db"; ( cd ./tmp/uat-add-task/alpha && CONDUCTOR_DB="$DB" "$REPO/scripts/add-task.sh" ); rc=$?; printf "rc=%s|rows=%s\n" "$rc" "$(sqlite3 "$DB" "SELECT COUNT(*) FROM tasks")"'
  ```
- **Expected Result**: Exit code 0 (wrapper); `add-task.sh` prints `Usage: add-task.sh <command words...>` to stderr. Final stdout line is exactly `rc=1|rows=0` (guard fired, non-zero exit, no row inserted).
- [x] Pass <!-- 2026-06-12 -->

### UAT-EDGE-002: single quotes in the command are escaped, not broken
- **Description**: A command containing a single quote must be inserted verbatim via the `${CMD//\'/\'\'}` quote-doubling idiom — the row's `command` round-trips with the apostrophe intact and no SQL error. This guards the INSERT against quote-injection from arbitrary command text.
- **Steps**:
  1. **Re-run the Seed block** immediately before this test (empty `tasks`).
  2. Run the command below — it adds a scoped task whose text contains an apostrophe, then SELECTs the stored `command`.
- **Command**:
  ```bash
  bash -c 'REPO="$(pwd)"; DB="$REPO/tmp/uat-add-task/conductor.db"; ( cd ./tmp/uat-add-task/alpha && CONDUCTOR_DB="$DB" "$REPO/scripts/add-task.sh" fix the user'\''s bug ) >/dev/null; sqlite3 "$DB" "SELECT command FROM tasks ORDER BY id DESC LIMIT 1"'
  ```
- **Expected Result**: Exit code 0; stdout is exactly `fix the user's bug` (apostrophe preserved; exactly one row inserted; no `sqlite3` parse error).
- [x] Pass <!-- 2026-06-12 -->

---

## Cleanup

```bash
bash -c 'rm -rf ./tmp/uat-add-task && echo cleaned'
```
