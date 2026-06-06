# UAT: Remove scaffold.sh and agent_exec.sh

> **Source task**: [`.docs/tasks/019-remove-scaffold-sh.md`](../../tasks/019-remove-scaffold-sh.md)
> **Generated**: 2026-06-06

---

## Prerequisites

- [ ] Working directory is the repo root: `/Users/davidtaylor/Repositories/tmux-conductor`
- [ ] `git status` shows a clean working tree (or task 019 changes are committed/staged)
- [ ] `bash --version` is available

---

## Archive Verification

### UAT-ARCHIVE-001: scaffold.sh no longer exists at its original path
- **Description**: `scripts/scaffold.sh` must have been moved out of the active scripts directory
- **Steps**:
  1. Run the command below from the repo root
- **Command**:
  ```bash
  test ! -f scripts/scaffold.sh && echo "PASS: scaffold.sh not present in scripts/" || echo "FAIL: scaffold.sh still exists at scripts/scaffold.sh"
  ```
- **Expected Result**: Prints `PASS: scaffold.sh not present in scripts/`
- [x] Pass <!-- 2026-06-06 -->

### UAT-ARCHIVE-002: agent_exec.sh no longer exists at its original path
- **Description**: `scripts/agent_exec.sh` must have been moved out of the active scripts directory
- **Steps**:
  1. Run the command below from the repo root
- **Command**:
  ```bash
  test ! -f scripts/agent_exec.sh && echo "PASS: agent_exec.sh not present in scripts/" || echo "FAIL: agent_exec.sh still exists at scripts/agent_exec.sh"
  ```
- **Expected Result**: Prints `PASS: agent_exec.sh not present in scripts/`
- [x] Pass <!-- 2026-06-06 -->

### UAT-ARCHIVE-003: scaffold.sh is present in scripts/.archive/
- **Description**: The archived copy of `scaffold.sh` must exist under `scripts/.archive/`
- **Steps**:
  1. Run the command below from the repo root
- **Command**:
  ```bash
  test -f scripts/.archive/scaffold.sh && echo "PASS: scaffold.sh present in archive" || echo "FAIL: scaffold.sh not found in scripts/.archive/"
  ```
- **Expected Result**: Prints `PASS: scaffold.sh present in archive`
- [x] Pass <!-- 2026-06-06 -->

### UAT-ARCHIVE-004: agent_exec.sh is present in scripts/.archive/
- **Description**: The archived copy of `agent_exec.sh` must exist under `scripts/.archive/`
- **Steps**:
  1. Run the command below from the repo root
- **Command**:
  ```bash
  test -f scripts/.archive/agent_exec.sh && echo "PASS: agent_exec.sh present in archive" || echo "FAIL: agent_exec.sh not found in scripts/.archive/"
  ```
- **Expected Result**: Prints `PASS: agent_exec.sh present in archive`
- [x] Pass <!-- 2026-06-06 -->

### UAT-ARCHIVE-005: git history preserved — both files tracked under new paths
- **Description**: `git log` must show the archive paths as known to git (not as untracked new files)
- **Steps**:
  1. Run the command below
- **Command**:
  ```bash
  git log --oneline --follow scripts/.archive/scaffold.sh | head -3 && git log --oneline --follow scripts/.archive/agent_exec.sh | head -3
  ```
- **Expected Result**: Each command returns at least one log entry, confirming the files were moved with `git mv` rather than deleted and re-created
- [FAIL: auto-judge: git log --follow scripts/.archive/scaffold.sh and scripts/.archive/agent_exec.sh both return empty — files are staged as "new file" (not rename), meaning git mv was not used; history is not preserved at the archive paths] <!-- 2026-06-06 -->

---

## Documentation Clean-up

### UAT-DOC-001: No references to scaffold.sh in active docs
- **Description**: `scripts/README.md`, `CLAUDE.md`, and `conductor.conf` must not reference `scaffold.sh` outside of the archive note
- **Steps**:
  1. Run the command below from the repo root
- **Command**:
  ```bash
  grep -n 'scaffold\.sh' scripts/README.md CLAUDE.md conductor.conf 2>/dev/null || echo "PASS: no scaffold.sh references found"
  ```
- **Expected Result**: Prints `PASS: no scaffold.sh references found` (zero matching lines in active docs)
- [x] Pass <!-- 2026-06-06 -->

### UAT-DOC-002: No references to agent_exec in active docs
- **Description**: `scripts/README.md`, `CLAUDE.md`, and `conductor.conf` must not reference `agent_exec` outside of the archive note
- **Steps**:
  1. Run the command below from the repo root
- **Command**:
  ```bash
  grep -n 'agent_exec' scripts/README.md CLAUDE.md conductor.conf 2>/dev/null || echo "PASS: no agent_exec references found"
  ```
- **Expected Result**: Prints `PASS: no agent_exec references found` (zero matching lines in active docs)
- [x] Pass <!-- 2026-06-06 -->

### UAT-DOC-003: scripts/README.md contains an "Archived Scripts" section
- **Description**: `scripts/README.md` must include a `## Archived Scripts` heading with entries for both removed scripts
- **Steps**:
  1. Run the command below
- **Command**:
  ```bash
  grep -n 'Archived Scripts\|scaffold\.sh\|agent_exec\.sh' scripts/README.md
  ```
- **Expected Result**: At least three matching lines — the `## Archived Scripts` heading, a line mentioning `scaffold.sh`, and a line mentioning `agent_exec.sh` (all within the archive note section)
- [x] Pass <!-- 2026-06-06 -->

### UAT-DOC-004: scaffold.sh and agent_exec.sh rows removed from scripts/README.md table
- **Description**: The main scripts table in `scripts/README.md` must not contain rows for `scaffold.sh` or `agent_exec.sh`
- **Steps**:
  1. Run the command below to check the table section only (lines before any `## Archived` heading)
- **Command**:
  ```bash
  awk '/## Archived/{exit} /scaffold\.sh|agent_exec\.sh/{found=1; print} END{if(!found) print "PASS: no table rows for removed scripts"}' scripts/README.md
  ```
- **Expected Result**: Prints `PASS: no table rows for removed scripts`
- [x] Pass <!-- 2026-06-06 -->

### UAT-DOC-005: CLAUDE.md Core Scripts table does not list scaffold.sh or agent_exec.sh
- **Description**: The "Core Scripts" table in `CLAUDE.md` must not contain rows for either removed script
- **Steps**:
  1. Run the command below
- **Command**:
  ```bash
  grep -n 'scaffold\.sh\|agent_exec\.sh' CLAUDE.md || echo "PASS: no references in CLAUDE.md"
  ```
- **Expected Result**: Prints `PASS: no references in CLAUDE.md`
- [x] Pass <!-- 2026-06-06 -->

### UAT-DOC-006: conductor.conf has no references to EXEC_MODE, COMPOSE_FILE, COMPOSE_SERVICE, or devcontainer
- **Description**: Container-mode configuration keys must have been removed from `conductor.conf`
- **Steps**:
  1. Run the command below
- **Command**:
  ```bash
  grep -n 'EXEC_MODE\|COMPOSE_FILE\|COMPOSE_SERVICE\|devcontainer' conductor.conf 2>/dev/null || echo "PASS: no container-mode config keys found"
  ```
- **Expected Result**: Prints `PASS: no container-mode config keys found`
- [x] Pass <!-- 2026-06-06 -->

---

## Syntax Checks

### UAT-SYNTAX-001: All remaining active scripts pass bash -n
- **Description**: The four core active scripts must pass bash syntax check with no errors
- **Steps**:
  1. Run the command below from the repo root
- **Command**:
  ```bash
  bash -n scripts/conductor.sh scripts/spawn.sh scripts/monitor.sh scripts/teardown.sh && echo "PASS: all syntax checks passed"
  ```
- **Expected Result**: Prints `PASS: all syntax checks passed` with no error output
- [x] Pass <!-- 2026-06-06 -->

### UAT-SYNTAX-002: Remaining active scripts also pass syntax check
- **Description**: `dispatch.sh`, `broadcast.sh`, and `add-task.sh` must also pass bash syntax check
- **Steps**:
  1. Run the command below from the repo root
- **Command**:
  ```bash
  bash -n scripts/dispatch.sh scripts/broadcast.sh scripts/add-task.sh && echo "PASS: secondary scripts syntax OK"
  ```
- **Expected Result**: Prints `PASS: secondary scripts syntax OK` with no error output
- [x] Pass <!-- 2026-06-06 -->

### UAT-SYNTAX-003: Archived scripts are syntactically valid (content preserved intact)
- **Description**: The archived files must still be valid bash (content was not corrupted during the move)
- **Steps**:
  1. Run the command below
- **Command**:
  ```bash
  bash -n scripts/.archive/scaffold.sh scripts/.archive/agent_exec.sh && echo "PASS: archived scripts syntax OK"
  ```
- **Expected Result**: Prints `PASS: archived scripts syntax OK` with no error output
- [x] Pass <!-- 2026-06-06 -->

---

## Broad Reference Sweep

### UAT-SWEEP-001: No stray references outside .archive/ across the whole scripts/ directory
- **Description**: A recursive grep of `scripts/` (excluding `.archive/`) must find zero occurrences of `scaffold.sh` or `agent_exec`
- **Steps**:
  1. Run the command below
- **Command**:
  ```bash
  grep -r 'scaffold\.sh\|agent_exec' scripts/ --exclude-dir=.archive || echo "PASS: no stray references in scripts/"
  ```
- **Expected Result**: Prints `PASS: no stray references in scripts/`
- [FAIL: auto-judge: scripts/README.md lines 164-165 contain scaffold.sh and agent_exec.sh references in the ## Archived Scripts note — these are outside scripts/.archive/ so the grep finds matches and does not print PASS; test command does not exclude the archive note section (unlike UAT-DOC-001/002 which explicitly allow archive-note references)] <!-- 2026-06-06 -->
