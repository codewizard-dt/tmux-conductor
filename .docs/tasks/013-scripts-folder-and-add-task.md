# 013 — Consolidate Scripts Folder + add-task Utility

## Objective

Move 8 orchestration scripts into `./scripts/`, update all internal and external references, and create `scripts/add-task.sh` to enqueue a tmux-conductor task from any working directory.

## Approach

Use `git mv` to preserve history for the 8 scripts. Since all moved scripts share `$SCRIPT_DIR` for sibling-script references, inter-script paths need no code changes — only the 5 `source "$SCRIPT_DIR/conductor.conf"` lines must be updated to `$SCRIPT_DIR/../conductor.conf`. External references in `README.md`, `CLAUDE.md`, `~/.aliases`, and UAT docs are updated by text replacement. `add-task.sh` derives the agent name from `basename "$PWD"` (caller's CWD = the project being dispatched to) and resolves `tasks.txt` via `$SCRIPT_DIR/../tasks.txt` so it works when called from any directory.

## Prerequisites

- [ ] Task 012 (Verbose Dispatch Logging) completed

---

## Steps

### 1. Create `scripts/` directory and move scripts  <!-- agent: general-purpose -->

- [x] Run `mkdir -p scripts` in repo root
- [x] Run `git mv` for each of the 8 scripts (one command per script to preserve history):
  - `git mv conductor.sh scripts/conductor.sh`
  - `git mv monitor.sh scripts/monitor.sh`
  - `git mv dispatch.sh scripts/dispatch.sh`
  - `git mv teardown.sh scripts/teardown.sh`
  - `git mv spawn.sh scripts/spawn.sh`
  - `git mv broadcast.sh scripts/broadcast.sh`
  - `git mv scaffold.sh scripts/scaffold.sh`
  - `git mv agent_exec.sh scripts/agent_exec.sh`
- [x] Confirm `install-hooks.sh` is NOT moved — it stays at repo root
- [x] Confirm `.devcontainer/init-claude-config.sh` is NOT moved — stays in `.devcontainer/`
- [x] Confirm `hooks/.bash-backup/*.sh` are NOT moved — archived, stay in place

### 2. Fix `conductor.conf` source path in moved scripts  <!-- agent: general-purpose -->

Five scripts source `conductor.conf` via `$SCRIPT_DIR/conductor.conf`. After the move, `SCRIPT_DIR` points to `scripts/` but `conductor.conf` stays at repo root. Update each with Serena's `replace_content` (literal mode):

- [x] In `scripts/conductor.sh`: replace `source "$SCRIPT_DIR/conductor.conf"` → `source "$SCRIPT_DIR/../conductor.conf"`
- [x] In `scripts/monitor.sh`: same replacement
- [x] In `scripts/teardown.sh`: same replacement
- [x] In `scripts/broadcast.sh`: same replacement
- [x] In `scripts/spawn.sh`: same replacement
- [x] Verify `dispatch.sh` and `agent_exec.sh` do NOT source `conductor.conf` (they don't need updating)

### 3. Update `README.md`  <!-- agent: general-purpose -->

Replace all bare-invocation script references with `scripts/`-prefixed paths. Use `Edit` tool with `replace_all: false` for each unique occurrence (there are ~15):

- [x] `./conductor.sh` → `./scripts/conductor.sh` (appears at lines ~55, ~143)
- [x] `./spawn.sh` → `./scripts/spawn.sh` (line ~67)
- [x] `./dispatch.sh` → `./scripts/dispatch.sh` (line ~82)
- [x] `./broadcast.sh` → `./scripts/broadcast.sh` (line ~85)
- [x] `./teardown.sh` → `./scripts/teardown.sh` (lines ~97, ~261)
- [x] `./scaffold.sh` → `./scripts/scaffold.sh` (lines ~109, ~120, ~158)
- [x] Update the script reference table (lines ~220–233) to reflect `scripts/` prefix
  - Keep `install-hooks.sh` listed as repo-root (no path prefix change)
- [x] Any remaining inline mention of `conductor.sh / spawn.sh` (line ~238) → `scripts/conductor.sh / scripts/spawn.sh`

### 4. Update `CLAUDE.md`  <!-- agent: general-purpose -->

- [x] In the Core Scripts table, add path context noting scripts now live in `scripts/` — update the table header or add a note: "All scripts below live in `scripts/` except `install-hooks.sh` (repo root)"
- [x] Update the `install-hooks.sh` row annotation — currently says `(repo root)`, keep that
- [x] Verify no inline command examples reference bare script names that need updating (most references in CLAUDE.md are name-only, not invocation paths, so minimal changes expected)

### 5. Update `~/.aliases`  <!-- agent: general-purpose -->

Read `/Users/davidtaylor/.aliases` first, then use `Edit` to update the two tmux-conductor aliases:

- [x] Line ~5: `alias scaffold-dev-container='/Users/davidtaylor/Repositories/tmux-conductor/scaffold.sh '`  
  → `alias scaffold-dev-container='/Users/davidtaylor/Repositories/tmux-conductor/scripts/scaffold.sh '`
- [x] Line ~6: `alias tmux-conductor='/Users/davidtaylor/Repositories/tmux-conductor/conductor.sh'`  
  → `alias tmux-conductor='/Users/davidtaylor/Repositories/tmux-conductor/scripts/conductor.sh'`

### 6. Update UAT and task docs  <!-- agent: general-purpose -->

Several UAT files reference script names with bare paths (e.g., `bash -n monitor.sh conductor.sh`). Update to `scripts/` prefix:

- [x] `.docs/uat/completed/012-verbose-dispatch-logging.uat.md`:
  - `bash -n monitor.sh conductor.sh scaffold.sh agent_exec.sh` → `bash -n scripts/monitor.sh scripts/conductor.sh scripts/scaffold.sh scripts/agent_exec.sh`
  - Any `grep -n ... monitor.sh` or `grep -n ... conductor.sh` → prefix with `scripts/`
  - Any `./conductor.sh` or `./teardown.sh` references → `./scripts/conductor.sh`, `./scripts/teardown.sh`
  - References to `install-hooks.sh` → unchanged (stays at root)
- [x] `.docs/uat/skipped/005-host-network-access.uat.md`:
  - `bash -n scaffold.sh` → `bash -n scripts/scaffold.sh`
  - `./scaffold.sh` → `./scripts/scaffold.sh`
- [x] `.docs/uat/skipped/011-hooks-to-js.uat.md`:
  - `bash -n install-hooks.sh` → unchanged (stays at root)
  - Any other script references → update with `scripts/` prefix
- [x] `.docs/uat/trashed/007-hook-efficiency-dispatch-race.uat.md`:
  - Update `monitor.sh` and `scaffold.sh` references to `scripts/` prefix
  - `install-hooks.sh` → unchanged

### 7. Create `scripts/add-task.sh`  <!-- agent: general-purpose -->

Create a new script at `scripts/add-task.sh` that appends a properly formatted task to `tasks.txt`:

- [x] Script behaviour:
  - Usage: `add-task.sh <command words...>` (all positional args form the task command)
  - Agent name: `basename "$PWD"` — the caller's CWD is the target project directory
  - Tasks file: `"$SCRIPT_DIR/../tasks.txt"` — absolute path resolved from script location
  - Output line format: `agentname: command` (matching the existing format in `tasks.txt`)
  - Prints confirmation: `Added task for <agentname>: <command>`
  - Exits with error + usage message if no arguments supplied
  - Exits with error if `tasks.txt` parent directory doesn't exist

- [x] Script template:
  ```bash
  #!/usr/bin/env bash
  # Usage: add-task.sh <command words...>
  # Appends a scoped task entry to tasks.txt for the agent matching the current directory name.
  set -euo pipefail

  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  TASKS_FILE="$SCRIPT_DIR/../tasks.txt"
  AGENT_NAME="$(basename "$PWD")"

  if [[ $# -lt 1 ]]; then
    echo "Usage: add-task.sh <command words...>" >&2
    exit 1
  fi

  CMD="$*"

  if [[ ! -d "$(dirname "$TASKS_FILE")" ]]; then
    echo "Error: tasks.txt parent directory not found: $(dirname "$TASKS_FILE")" >&2
    exit 1
  fi

  echo "${AGENT_NAME}: ${CMD}" >> "$TASKS_FILE"
  echo "Added task for ${AGENT_NAME}: ${CMD}"
  ```

- [x] Make executable: `chmod +x scripts/add-task.sh`

### 8. Update task index and CLAUDE.md script table  <!-- agent: general-purpose -->

- [x] Add `add-task.sh` to the Core Scripts table in `CLAUDE.md`:
  - `| \`scripts/add-task.sh\` | Appends a scoped task entry to \`tasks.txt\` using the caller's CWD name as agent name |`
- [x] Add entry to `.docs/tasks/README.md` under Active Tasks:
  - `| 013 | [Scripts Folder + add-task](active/013-scripts-folder-and-add-task.md) | Move 8 orchestration scripts to scripts/, update all references, add add-task.sh utility |`

### 9. Verification  <!-- agent: general-purpose -->

- [x] `bash -n scripts/conductor.sh scripts/monitor.sh scripts/dispatch.sh scripts/teardown.sh scripts/spawn.sh scripts/broadcast.sh scripts/scaffold.sh scripts/agent_exec.sh scripts/add-task.sh` — all pass syntax check
- [x] `bash -n install-hooks.sh` — still passes (untouched)
- [x] Confirm `scripts/monitor.sh` line ~5: `source "$SCRIPT_DIR/../conductor.conf"` (not `$SCRIPT_DIR/conductor.conf`)
- [x] From repo root, run `cd /tmp && /Users/davidtaylor/Repositories/tmux-conductor/scripts/add-task.sh "test task"` — confirm it appends `tmp: test task` to `tasks.txt`, then remove the line
- [x] `grep 'tmux-conductor/scripts/' /Users/davidtaylor/.aliases` — confirms both aliases updated
- [x] `git status` — only expected files modified (no accidental deletions)
