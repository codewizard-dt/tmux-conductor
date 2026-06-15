---
id: UAT-020
title: "UAT: Sync bin/conductor daemon install to the rendered-template + bootout/bootstrap flow"
status: passed
task: TASK-020
created: 2026-06-12
updated: 2026-06-12
---

# UAT-020 — UAT: Sync bin/conductor daemon install to the rendered-template + bootout/bootstrap flow

implements::[[TASK-020]]

> **Source task**: [`wiki/work/tasks/TASK-020-daemon-install-render-bootstrap.md`](../tasks/TASK-020-daemon-install-render-bootstrap.md)
> **Generated**: 2026-06-12

---

## Prerequisites

- [ ] Run all commands from the repo root (`/Users/davidtaylor/Repositories/tmux-conductor`)
- [ ] `bash` available on PATH (script validation)
- [ ] `sed` available (dry-render substitution)
- [ ] `node` resolvable on PATH (so the install's `NODE_PATH` computation is exercisable)
- [ ] `bin/conductor`, `com.tmux-conductor.daemon.plist`, and `daemon/tmux-conductor-daemon.service.in` present (TASK-019 templates already rendered with all three placeholders)
- [ ] Scratch directory `./tmp/` is used for all dry-render output (never `/tmp`)

---

## Test Cases

### UAT-CLI-001: Script passes bash syntax check
- **Description**: Verify the rewritten `bin/conductor` is syntactically valid bash (acceptance criterion: `bash -n bin/conductor` passes).
- **Steps**:
  1. Run the command below as-is from the repo root.
- **Command**:
  ```bash
  bash -n bin/conductor
  ```
- **Expected Result**: Exit code 0 and no output. Any syntax error printed to stderr is a fail.
- [x] Pass <!-- 2026-06-12 -->

### UAT-CLI-002: Deprecated `launchctl load` is fully removed
- **Description**: The deprecated `launchctl load` invocation must be gone from the entire script (acceptance criterion: "the deprecated `launchctl load` is gone").
- **Steps**:
  1. Grep the script for the exact deprecated form `launchctl load`.
  2. Confirm zero matches.
- **Command**:
  ```bash
  grep -c 'launchctl load' bin/conductor
  ```
- **Expected Result**: Prints `0`. The `grep` exits non-zero with no matches, which is the success condition; any count >= 1 is a fail.
- [x] Pass <!-- 2026-06-12 -->

### UAT-CLI-003: All three placeholders referenced in the install block
- **Description**: The `daemon install` rendering must reference all three placeholders `__REPO_ROOT__`, `__LOG_PATH__`, `__NODE_PATH__` (acceptance criterion: substitutes all three placeholders).
- **Steps**:
  1. Count distinct placeholder tokens present in the script's sed expressions.
- **Command**:
  ```bash
  grep -oE '__(REPO_ROOT|LOG_PATH|NODE_PATH)__' bin/conductor | sort -u | wc -l | tr -d ' '
  ```
- **Expected Result**: Prints `3` (all three placeholder names appear in the sed substitution expressions).
- [x] Pass <!-- 2026-06-12 -->

### UAT-CLI-004: macOS reload uses bootout + bootstrap
- **Description**: The macOS branch must use the modern `launchctl bootout … || true` followed by `launchctl bootstrap` (acceptance criterion: idempotent bootout/bootstrap reload).
- **Steps**:
  1. Confirm both `launchctl bootout` and `launchctl bootstrap` appear in the script.
- **Command**:
  ```bash
  grep -cE 'launchctl bootout|launchctl bootstrap' bin/conductor
  ```
- **Expected Result**: Prints `2` (one `bootout` line and one `bootstrap` line both present).
- [x] Pass <!-- 2026-06-12 -->

### UAT-CLI-005: bootout failure is tolerated with `|| true`
- **Description**: The `launchctl bootout` call must tolerate "service not loaded" so install is idempotent (acceptance criterion: `launchctl bootout … || true`).
- **Steps**:
  1. Confirm the bootout line is suffixed with `|| true`.
- **Command**:
  ```bash
  grep -E 'launchctl bootout .*\|\| true' bin/conductor
  ```
- **Expected Result**: Prints the matching bootout line (exit 0). No match (exit 1) is a fail.
- [x] Pass <!-- 2026-06-12 -->

### UAT-CLI-006: OS branch on `uname -s` with a systemd Linux path
- **Description**: The install block must branch on `uname -s` and provide a non-Darwin systemd path (acceptance criterion: Linux path detects non-Darwin via `uname -s`, uses `systemctl --user`).
- **Steps**:
  1. Confirm `uname -s` branching, the `Darwin)` case, and `systemctl --user` are all present.
- **Command**:
  ```bash
  grep -cE 'uname -s|Darwin\)|systemctl --user' bin/conductor
  ```
- **Expected Result**: Prints `4` or greater — `uname -s` (1), `Darwin)` (1), and `systemctl --user` (>=2: `daemon-reload` and `enable --now`). A count below 3 is a fail.
- [x] Pass <!-- 2026-06-12 -->

### UAT-CLI-007: Linux branch enables and starts the unit, advises lingering
- **Description**: The Linux branch must run `systemctl --user enable --now tmux-conductor-daemon.service` and print the `loginctl enable-linger` tip.
- **Steps**:
  1. Confirm both the `enable --now` invocation and the linger tip text are present.
- **Command**:
  ```bash
  grep -cE 'enable --now tmux-conductor-daemon.service|loginctl enable-linger' bin/conductor
  ```
- **Expected Result**: Prints `2` (both lines present).
- [x] Pass <!-- 2026-06-12 -->

### UAT-CLI-008: `node` not found produces a clear error path
- **Description**: Install must fail with a clear error if `node` is absent from PATH (acceptance criterion: install fails with a clear error if `node` is not on PATH).
- **Steps**:
  1. Confirm the script contains the node-not-found guard and error message.
- **Command**:
  ```bash
  grep -E 'Error: node not found on PATH' bin/conductor
  ```
- **Expected Result**: Prints the matching error line (exit 0). No match (exit 1) is a fail.
- [x] Pass <!-- 2026-06-12 -->

### UAT-CLI-009: Help text describes OS-aware install
- **Description**: `daemon help` must describe install as an OS-aware render+load, not "macOS plist only" (acceptance criterion: help text describes install across launchd/systemd).
- **Steps**:
  1. Run the daemon help subcommand.
  2. Confirm the output mentions install and references both launchd and systemd.
- **Command**:
  ```bash
  bash bin/conductor daemon help | grep -iE 'install.*launchd/systemd|launchd/systemd'
  ```
- **Expected Result**: Prints the install help line containing "launchd/systemd" (exit 0). No match is a fail.
- [x] Pass <!-- 2026-06-12 -->

### UAT-RENDER-001: macOS plist dry-render leaves zero placeholders
- **Description**: Rendering the launchd plist with the install's 3-substitution sed form must leave no literal placeholders (acceptance criterion: dry-render leaves zero placeholders).
- **Steps**:
  1. Reproduce the script's exact macOS sed form against `com.tmux-conductor.daemon.plist`, writing to `./tmp/`.
  2. Count surviving `__…__` placeholder tokens in the rendered output.
- **Command**:
  ```bash
  mkdir -p ./tmp && REPO_ROOT="$PWD" LOG_PATH="$HOME/.local/share/tmux-conductor/daemon.log" NODE_PATH="$(dirname "$(command -v node)")" sh -c 'sed -e "s|__REPO_ROOT__|$REPO_ROOT|g" -e "s|__LOG_PATH__|$LOG_PATH|g" -e "s|__NODE_PATH__|$NODE_PATH|g" com.tmux-conductor.daemon.plist > ./tmp/uat020-plist.rendered' && grep -cE '__(REPO_ROOT|LOG_PATH|NODE_PATH)__' ./tmp/uat020-plist.rendered
  ```
- **Expected Result**: Prints `0` — no unrendered placeholder survives in `./tmp/uat020-plist.rendered`.
- [x] Pass <!-- 2026-06-12 -->

### UAT-RENDER-002: systemd unit dry-render leaves zero placeholders
- **Description**: Rendering the systemd user-unit template with the same 3-substitution sed form must leave no literal placeholders (acceptance criterion: both dry-renders leave zero placeholders).
- **Steps**:
  1. Reproduce the script's exact sed form against `daemon/tmux-conductor-daemon.service.in`, writing to `./tmp/`.
  2. Count surviving `__…__` placeholder tokens in the rendered output.
- **Command**:
  ```bash
  mkdir -p ./tmp && REPO_ROOT="$PWD" LOG_PATH="$HOME/.local/share/tmux-conductor/daemon.log" NODE_PATH="$(dirname "$(command -v node)")" sh -c 'sed -e "s|__REPO_ROOT__|$REPO_ROOT|g" -e "s|__LOG_PATH__|$LOG_PATH|g" -e "s|__NODE_PATH__|$NODE_PATH|g" daemon/tmux-conductor-daemon.service.in > ./tmp/uat020-service.rendered' && grep -cE '__(REPO_ROOT|LOG_PATH|NODE_PATH)__' ./tmp/uat020-service.rendered
  ```
- **Expected Result**: Prints `0` — no unrendered placeholder survives in `./tmp/uat020-service.rendered`.
- [x] Pass <!-- 2026-06-12 -->

### UAT-RENDER-003: Rendered LOG_PATH resolves to the canonical daemon log location
- **Description**: `__LOG_PATH__` must resolve to `$HOME/.local/share/tmux-conductor/daemon.log` (acceptance criterion: LOG_PATH resolves to that path). Verifies the substitution value, not just placeholder absence.
- **Steps**:
  1. Render the plist as in UAT-RENDER-001.
  2. Confirm the rendered output contains the literal resolved log path.
- **Command**:
  ```bash
  grep -F "$HOME/.local/share/tmux-conductor/daemon.log" ./tmp/uat020-plist.rendered
  ```
- **Expected Result**: Prints the matching `StandardOutPath`/`StandardErrorPath` line(s) containing the resolved log path (exit 0). Depends on UAT-RENDER-001 having produced the file. No match is a fail.
- [x] Pass <!-- 2026-06-12 -->

### UAT-EDGE-001: No rendering logic duplicated outside bin/conductor
- **Description**: The single-source constraint requires the 3-placeholder sed rendering to live only in `bin/conductor` (acceptance criterion: no rendering logic duplicated outside `bin/conductor`). install.sh, if present, must not re-implement it.
- **Steps**:
  1. Search the repo (excluding the rendered scratch output in `./tmp/` and the templates themselves) for any other file containing the 3-placeholder sed form.
- **Command**:
  ```bash
  grep -rlE 's\|__LOG_PATH__\||s\|__NODE_PATH__\|' --include='*.sh' --include='conductor' . | grep -v 'bin/conductor'
  ```
- **Expected Result**: No output (exit 1 from grep) — only `bin/conductor` contains the rendering sed. Any other file path printed is a duplication and a fail.
- [x] Pass <!-- 2026-06-12 -->
