---
id: UAT-013
title: "UAT: Migrate conductor.sh, spawn.sh, teardown.sh, broadcast.sh to DB-loaded agent lists"
status: passed
task: TASK-013
created: 2026-06-12
updated: 2026-06-12
---

# UAT-013 — UAT: Migrate conductor.sh, spawn.sh, teardown.sh, broadcast.sh to DB-loaded agent lists

implements::[[TASK-013]]

> **Source task**: [`wiki/work/tasks/TASK-013-migrate-scripts-db-agent-lists.md`](../tasks/TASK-013-migrate-scripts-db-agent-lists.md)
> **Generated**: 2026-06-12

---

## Prerequisites

- [ ] Run all commands from the repo root (`/Users/davidtaylor/Repositories/tmux-conductor`)
- [ ] `bash` >= 4.0 on PATH (the scripts and loaders use indexed + associative arrays; macOS default `/bin/bash` 3.2 will not run them — use Homebrew `bash`)
- [ ] `sqlite3` on PATH (used to seed the scratch DB for the functional checks)
- [ ] The four migrated scripts exist: `scripts/conductor.sh`, `scripts/spawn.sh`, `scripts/teardown.sh`, `scripts/broadcast.sh`, and the loader library `scripts/lib/db.sh`

> **Why no end-to-end tmux run:** these four scripts spawn a live tmux session and attach to it (or send keys into agent panes), which is impractical to drive headlessly. UAT therefore verifies the migration at three layers: (a) syntax gates, (b) static source-content assertions (sources `lib/db.sh`, calls the loaders, zero residual `${AGENTS[` / `${BG_PROCESSES[` references), and (c) functional sourcing of the loaders against a seeded scratch DB to confirm the consumed arrays (`AGENT_NAMES[]`, `AGENT_BG`, `BG_NAMES[]`) are populated from SQLite in the exact shape the scripts iterate.

---

## Test Cases

### UAT-CLI-001: conductor.sh passes `bash -n` syntax gate
- **Description**: The migrated `scripts/conductor.sh` parses cleanly with no syntax errors.
- **Steps**:
  1. Run the command below as-is.
- **Command**:
  ```bash
  bash -n scripts/conductor.sh
  ```
- **Expected Result**: Exit code 0, no output. Any syntax error (non-zero exit, error text) is a failure.
- [x] Pass

### UAT-CLI-002: spawn.sh passes `bash -n` syntax gate
- **Description**: The migrated `scripts/spawn.sh` parses cleanly with no syntax errors.
- **Steps**:
  1. Run the command below as-is.
- **Command**:
  ```bash
  bash -n scripts/spawn.sh
  ```
- **Expected Result**: Exit code 0, no output.
- [x] Pass

### UAT-CLI-003: teardown.sh passes `bash -n` syntax gate
- **Description**: The migrated `scripts/teardown.sh` parses cleanly with no syntax errors.
- **Steps**:
  1. Run the command below as-is.
- **Command**:
  ```bash
  bash -n scripts/teardown.sh
  ```
- **Expected Result**: Exit code 0, no output.
- [x] Pass

### UAT-CLI-004: broadcast.sh passes `bash -n` syntax gate
- **Description**: The migrated `scripts/broadcast.sh` parses cleanly with no syntax errors.
- **Steps**:
  1. Run the command below as-is.
- **Command**:
  ```bash
  bash -n scripts/broadcast.sh
  ```
- **Expected Result**: Exit code 0, no output.
- [x] Pass

### UAT-CLI-005: All four scripts source lib/db.sh and call the DB loaders
- **Description**: Each migrated script must `source` the `lib/db.sh` helper and invoke `load_agents`; the three multi-target scripts (conductor.sh, spawn.sh, teardown.sh) must also invoke `load_bg`. broadcast.sh must NOT call `load_bg` (it only targets agents). This asserts the migration wiring is present in every file.
- **Steps**:
  1. Run the command below as-is. It tallies the required directives per file and prints a single status line per script.
- **Command**:
  ```bash
  bash -c 'fail=0; for f in conductor spawn teardown broadcast; do p="scripts/$f.sh"; src=$(grep -cF "source \"\$SCRIPT_DIR/lib/db.sh\"" "$p"); la=$(grep -cE "^[[:space:]]*load_agents([[:space:]]|$)" "$p"); lb=$(grep -cE "^[[:space:]]*load_bg([[:space:]]|$)" "$p"); if [ "$f" = "broadcast" ]; then want_lb=0; else want_lb=1; fi; ok=1; [ "$src" -ge 1 ] || ok=0; [ "$la" -ge 1 ] || ok=0; if [ "$want_lb" -eq 1 ]; then [ "$lb" -ge 1 ] || ok=0; else [ "$lb" -eq 0 ] || ok=0; fi; [ "$ok" -eq 1 ] && echo "$f.sh: OK (db.sh=$src load_agents=$la load_bg=$lb)" || { echo "$f.sh: MISSING (db.sh=$src load_agents=$la load_bg=$lb want_lb=$want_lb)"; fail=1; }; done; exit $fail'
  ```
- **Expected Result**: Exit code 0; four `OK` lines, none `MISSING`:
  ```
  conductor.sh: OK (db.sh=1 load_agents=1 load_bg=1)
  spawn.sh: OK (db.sh=1 load_agents=1 load_bg=1)
  teardown.sh: OK (db.sh=1 load_agents=1 load_bg=1)
  broadcast.sh: OK (db.sh=1 load_agents=1 load_bg=0)
  ```
- [x] Pass

### UAT-CLI-006: No residual `${AGENTS[` or `${BG_PROCESSES[` array references remain
- **Description**: The whole point of the migration is to stop reading the `conductor.conf` `AGENTS=(...)` / `BG_PROCESSES=(...)` bash arrays. None of the four migrated scripts may still index those arrays.
- **Steps**:
  1. Run the command below as-is. It greps each file for the forbidden array-index patterns and reports the total match count.
- **Command**:
  ```bash
  bash -c 'n=$(grep -rEo "\$\{AGENTS\[|\$\{BG_PROCESSES\[" scripts/conductor.sh scripts/spawn.sh scripts/teardown.sh scripts/broadcast.sh | wc -l | tr -d " "); echo "residual_array_refs=$n"; [ "$n" -eq 0 ]'
  ```
- **Expected Result**: Exit code 0; stdout is exactly `residual_array_refs=0`. Any non-zero count is a failure (the migration is incomplete).
- [x] Pass

### UAT-CLI-007: conductor.sh / spawn.sh / teardown.sh iterate AGENT_NAMES and BG_NAMES (not the conf arrays)
- **Description**: Beyond the absence of the old arrays, the migrated scripts must positively iterate the DB-loaded arrays — `"${AGENT_NAMES[@]}"` (or indexed `AGENT_NAMES[`) and, for the three multi-target scripts, `"${BG_NAMES[@]}"`. This catches a script that dropped the old array but failed to wire in the new one.
- **Steps**:
  1. Run the command below as-is.
- **Command**:
  ```bash
  bash -c 'fail=0; for f in conductor spawn teardown; do p="scripts/$f.sh"; an=$(grep -cE "AGENT_NAMES\[" "$p"); bn=$(grep -cE "BG_NAMES\[" "$p"); if [ "$an" -ge 1 ] && [ "$bn" -ge 1 ]; then echo "$f.sh: OK (AGENT_NAMES=$an BG_NAMES=$bn)"; else echo "$f.sh: MISSING (AGENT_NAMES=$an BG_NAMES=$bn)"; fail=1; fi; done; bca=$(grep -cE "AGENT_NAMES\[" scripts/broadcast.sh); if [ "$bca" -ge 1 ]; then echo "broadcast.sh: OK (AGENT_NAMES=$bca)"; else echo "broadcast.sh: MISSING (AGENT_NAMES=$bca)"; fail=1; fi; exit $fail'
  ```
- **Expected Result**: Exit code 0; four `OK` lines, none `MISSING`:
  ```
  conductor.sh: OK (AGENT_NAMES=... BG_NAMES=...)
  spawn.sh: OK (AGENT_NAMES=... BG_NAMES=...)
  teardown.sh: OK (AGENT_NAMES=... BG_NAMES=...)
  broadcast.sh: OK (AGENT_NAMES=...)
  ```
- [x] Pass

### UAT-CLI-008: load_agents populates AGENT_NAMES[] (ordered) + AGENT_BG link from a seeded DB
- **Description**: Sourcing `scripts/lib/db.sh` against a seeded scratch DB and calling `load_agents` must populate `AGENT_NAMES[]` in `ORDER BY a.name` order, with `AGENT_DIRS`/`AGENT_CMDS` per-agent and `AGENT_BG` resolving the linked bg-process name (empty string when none). This is the exact array shape conductor.sh, spawn.sh, teardown.sh, and broadcast.sh now consume — proving the migration's data source works end to end. Seed: agents `beta` (no bg link) and `alpha` (linked to bg `logs`), inserted out of name order to prove ordering.
- **Steps**:
  1. Run the command below as-is. It creates an isolated DB under `./tmp/`, seeds two agents (one bg-linked) inserted in reverse-name order, sources `db.sh` with `CONDUCTOR_DB` pointed at the scratch DB, runs `load_agents`, and prints the resulting arrays.
- **Command**:
  ```bash
  bash -c 'mkdir -p ./tmp/uat-013 && rm -f ./tmp/uat-013/conductor.db && sqlite3 ./tmp/uat-013/conductor.db "CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, workdir TEXT NOT NULL); CREATE TABLE agents (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, workdir TEXT NOT NULL, launch_cmd TEXT NOT NULL, project_id INTEGER REFERENCES projects(id)); CREATE TABLE bg_processes (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, workdir TEXT NOT NULL, launch_cmd TEXT NOT NULL, linked_agent_id INTEGER REFERENCES agents(id)); INSERT INTO agents (id,name,workdir,launch_cmd) VALUES (1,\"beta\",\"/work/beta\",\"aider\"),(2,\"alpha\",\"/work/alpha\",\"claude\"); INSERT INTO bg_processes (id,name,workdir,launch_cmd,linked_agent_id) VALUES (1,\"logs\",\"/work/logs\",\"tail -f x\",2);" && CONDUCTOR_DB="$(pwd)/tmp/uat-013/conductor.db" bash -c "source scripts/lib/db.sh; load_agents; printf \"names=%s|count=%s|alpha_dir=%s|alpha_cmd=%s|alpha_bg=%s|beta_bg=[%s]\n\" \"\${AGENT_NAMES[*]}\" \"\${#AGENT_NAMES[@]}\" \"\${AGENT_DIRS[alpha]}\" \"\${AGENT_CMDS[alpha]}\" \"\${AGENT_BG[alpha]}\" \"\${AGENT_BG[beta]}\""'
  ```
- **Expected Result**: Exit code 0; stdout is exactly:
  ```
  names=alpha beta|count=2|alpha_dir=/work/alpha|alpha_cmd=claude|alpha_bg=logs|beta_bg=[]
  ```
  This confirms name-ordering (`alpha` before `beta` despite reverse insert), per-agent dir/cmd, the resolved bg link for `alpha` (`logs`), and the empty-string bg for the unlinked `beta`.
- [x] Pass

### UAT-CLI-009: load_bg populates BG_NAMES[] + BG_DIRS/BG_CMDS from a seeded DB
- **Description**: Sourcing `scripts/lib/db.sh` against a seeded scratch DB and calling `load_bg` must populate `BG_NAMES[]` (ordered `ORDER BY name`) with `BG_DIRS`/`BG_CMDS` per entry — the array shape conductor.sh / spawn.sh / teardown.sh iterate for background-process windows. Seed: two bg processes `zlog` and `alog` inserted in reverse-name order.
- **Steps**:
  1. Run the command below as-is. It creates an isolated DB under `./tmp/`, seeds two bg processes in reverse-name order, sources `db.sh`, runs `load_bg`, and prints the arrays.
- **Command**:
  ```bash
  bash -c 'mkdir -p ./tmp/uat-013 && rm -f ./tmp/uat-013/bg.db && sqlite3 ./tmp/uat-013/bg.db "CREATE TABLE agents (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, workdir TEXT NOT NULL, launch_cmd TEXT NOT NULL, project_id INTEGER); CREATE TABLE bg_processes (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, workdir TEXT NOT NULL, launch_cmd TEXT NOT NULL, linked_agent_id INTEGER); INSERT INTO bg_processes (id,name,workdir,launch_cmd,linked_agent_id) VALUES (1,\"zlog\",\"/work/zlog\",\"tail -f z\",NULL),(2,\"alog\",\"/work/alog\",\"tail -f a\",NULL);" && CONDUCTOR_DB="$(pwd)/tmp/uat-013/bg.db" bash -c "source scripts/lib/db.sh; load_bg; printf \"bg_names=%s|count=%s|alog_dir=%s|zlog_cmd=%s\n\" \"\${BG_NAMES[*]}\" \"\${#BG_NAMES[@]}\" \"\${BG_DIRS[alog]}\" \"\${BG_CMDS[zlog]}\""'
  ```
- **Expected Result**: Exit code 0; stdout is exactly:
  ```
  bg_names=alog zlog|count=2|alog_dir=/work/alog|zlog_cmd=tail -f z
  ```
  Confirms name-ordering (`alog` before `zlog`), correct dir for `alog`, and correct launch_cmd for `zlog`.
- [x] Pass

### UAT-EDGE-001: load_agents / load_bg on empty agent & bg tables yield empty arrays (no spurious spawn targets)
- **Description**: With the agent and bg tables present but empty, the loaders must complete cleanly and leave `AGENT_NAMES[]` / `BG_NAMES[]` empty — so a migrated script iterating `"${AGENT_NAMES[@]}"` / `"${BG_NAMES[@]}"` has zero targets rather than a stray blank entry. This guards the blank-line `[[ -z "$name" ]] && continue` skip in the loaders under the scripts' `set -euo pipefail`.
- **Steps**:
  1. Run the command below as-is. It builds an empty-but-valid schema under `./tmp/`, sources `db.sh`, runs both loaders, and prints the array counts.
- **Command**:
  ```bash
  bash -c 'mkdir -p ./tmp/uat-013 && rm -f ./tmp/uat-013/empty.db && sqlite3 ./tmp/uat-013/empty.db "CREATE TABLE agents (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, workdir TEXT NOT NULL, launch_cmd TEXT NOT NULL, project_id INTEGER); CREATE TABLE bg_processes (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, workdir TEXT NOT NULL, launch_cmd TEXT NOT NULL, linked_agent_id INTEGER);" && CONDUCTOR_DB="$(pwd)/tmp/uat-013/empty.db" bash -c "set -euo pipefail; source scripts/lib/db.sh; load_agents; load_bg; printf \"agents=%s|bg=%s\n\" \"\${#AGENT_NAMES[@]}\" \"\${#BG_NAMES[@]}\""'
  ```
- **Expected Result**: Exit code 0; stdout is exactly `agents=0|bg=0`. No `set -e` abort, no stray entries.
- [x] Pass

---

## Cleanup

After running the functional tests, the scratch DBs live under `./tmp/uat-013/` (gitignored). Remove with:

```bash
rm -rf ./tmp/uat-013
```
