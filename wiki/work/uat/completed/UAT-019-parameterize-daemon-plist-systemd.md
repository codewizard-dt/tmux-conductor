---
id: UAT-019
title: "UAT: Parameterize daemon launchd plist (log path, node path) and add a systemd user-unit template"
status: passed
task: TASK-019
created: 2026-06-12
updated: 2026-06-12
---

# UAT-019 — UAT: Parameterize daemon launchd plist (log path, node path) and add a systemd user-unit template

implements::[[TASK-019]]

> **Source task**: [`wiki/work/tasks/TASK-019-parameterize-daemon-plist-systemd.md`](../tasks/TASK-019-parameterize-daemon-plist-systemd.md)
> **Generated**: 2026-06-12

---

## Prerequisites

- [ ] Run all commands from the repo root (`/Users/davidtaylor/Repositories/tmux-conductor`).
- [ ] `com.tmux-conductor.daemon.plist` exists at the repo root.
- [ ] `daemon/tmux-conductor-daemon.service.in` exists.
- [ ] `plutil` available (macOS) for the XML-lint test (UAT-EDGE-001).
- [ ] Repo-local `tmp/` directory is writable (gitignored scratch space) for the render test.

---

## Test Cases

### UAT-API-001: Plist contains all three placeholder tokens
- **Description**: The plist must use every placeholder in `{__REPO_ROOT__, __LOG_PATH__, __NODE_PATH__}` so a single substitution map can render it. Asserts each token appears at least once.
- **Steps**:
  1. Run the command below from the repo root.
- **Command**:
  ```bash
  grep -lZ -e '__REPO_ROOT__' com.tmux-conductor.daemon.plist | xargs -0 grep -l '__LOG_PATH__' | xargs grep -l '__NODE_PATH__'
  ```
- **Expected Result**: Prints `com.tmux-conductor.daemon.plist` (the file matched all three tokens). Exit status 0.
- [x] Pass <!-- 2026-06-12 -->

### UAT-API-002: Plist has zero `/Users/davidtaylor` literals
- **Description**: All machine-specific home-directory hardcodes must be gone. The previous `StandardOutPath`/`StandardErrorPath` literals were `/Users/davidtaylor/.local/share/tmux-conductor/daemon.log`.
- **Steps**:
  1. Run the command below from the repo root.
- **Command**:
  ```bash
  grep -c '/Users/davidtaylor' com.tmux-conductor.daemon.plist
  ```
- **Expected Result**: Prints `0`. (No user-home literal remains.)
- [x] Pass <!-- 2026-06-12 -->

### UAT-API-003: Plist stdout and stderr both point at `__LOG_PATH__`
- **Description**: `StandardOutPath` and `StandardErrorPath` intentionally share one log file, both rendered from `__LOG_PATH__`. The token must appear exactly twice in the plist (the two log-path keys).
- **Steps**:
  1. Run the command below from the repo root.
- **Command**:
  ```bash
  grep -c '<string>__LOG_PATH__</string>' com.tmux-conductor.daemon.plist
  ```
- **Expected Result**: Prints `2` (one for `StandardOutPath`, one for `StandardErrorPath`).
- [x] Pass <!-- 2026-06-12 -->

### UAT-API-004: Plist PATH prepends `__NODE_PATH__` before the system dirs
- **Description**: The `EnvironmentVariables` → `PATH` must begin with `__NODE_PATH__:` followed by the original four system dirs, so the renderer-resolved nvm/Homebrew node bin dir wins over any system node.
- **Steps**:
  1. Run the command below from the repo root.
- **Command**:
  ```bash
  grep -F '<string>__NODE_PATH__:/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>' com.tmux-conductor.daemon.plist
  ```
- **Expected Result**: Prints the matched `<string>__NODE_PATH__:/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>` line. Exit status 0.
- [x] Pass <!-- 2026-06-12 -->

### UAT-API-005: systemd `.service.in` template exists
- **Description**: The new systemd user-unit template file must exist at the expected path.
- **Steps**:
  1. Run the command below from the repo root.
- **Command**:
  ```bash
  test -f daemon/tmux-conductor-daemon.service.in && echo EXISTS
  ```
- **Expected Result**: Prints `EXISTS`. Exit status 0.
- [x] Pass <!-- 2026-06-12 -->

### UAT-API-006: `.service.in` contains all three placeholder tokens
- **Description**: The systemd template must reuse the exact same placeholder vocabulary as the plist so one renderer substitutes both files.
- **Steps**:
  1. Run the command below from the repo root.
- **Command**:
  ```bash
  grep -lZ -e '__REPO_ROOT__' daemon/tmux-conductor-daemon.service.in | xargs -0 grep -l '__LOG_PATH__' | xargs grep -l '__NODE_PATH__'
  ```
- **Expected Result**: Prints `daemon/tmux-conductor-daemon.service.in`. Exit status 0.
- [x] Pass <!-- 2026-06-12 -->

### UAT-API-007: `.service.in` has zero `/Users/davidtaylor` literals
- **Description**: The systemd template must contain no machine-specific home-directory hardcode.
- **Steps**:
  1. Run the command below from the repo root.
- **Command**:
  ```bash
  grep -c '/Users/davidtaylor' daemon/tmux-conductor-daemon.service.in
  ```
- **Expected Result**: Prints `0`.
- [x] Pass <!-- 2026-06-12 -->

### UAT-API-008: `.service.in` has a `Restart=always` directive
- **Description**: The systemd analogue of launchd `KeepAlive=true` is `Restart=always`. This directive must be present so the unit restarts on exit/crash.
- **Steps**:
  1. Run the command below from the repo root.
- **Command**:
  ```bash
  grep -x 'Restart=always' daemon/tmux-conductor-daemon.service.in
  ```
- **Expected Result**: Prints `Restart=always`. Exit status 0.
- [x] Pass <!-- 2026-06-12 -->

### UAT-API-009: `.service.in` ExecStart mirrors the plist run command
- **Description**: The unit must run `tsx daemon/index.ts` via the daemon's local bin, mirroring the plist `ProgramArguments` exactly.
- **Steps**:
  1. Run the command below from the repo root.
- **Command**:
  ```bash
  grep -x 'ExecStart=__REPO_ROOT__/daemon/node_modules/.bin/tsx __REPO_ROOT__/daemon/index.ts' daemon/tmux-conductor-daemon.service.in
  ```
- **Expected Result**: Prints the matched `ExecStart=...` line. Exit status 0.
- [x] Pass <!-- 2026-06-12 -->

### UAT-API-010: `.service.in` directs stdout and stderr to `__LOG_PATH__` via append
- **Description**: Both `StandardOutput` and `StandardError` must use systemd's `append:__LOG_PATH__` form so the two streams share one log file (matching the plist).
- **Steps**:
  1. Run the command below from the repo root.
- **Command**:
  ```bash
  grep -c 'append:__LOG_PATH__' daemon/tmux-conductor-daemon.service.in
  ```
- **Expected Result**: Prints `2` (one for `StandardOutput`, one for `StandardError`).
- [x] Pass <!-- 2026-06-12 -->

### UAT-API-011: `.service.in` is enablable at login via `WantedBy=default.target`
- **Description**: The `[Install]` section must declare `WantedBy=default.target` so `systemctl --user enable --now` activates it at user login.
- **Steps**:
  1. Run the command below from the repo root.
- **Command**:
  ```bash
  grep -x 'WantedBy=default.target' daemon/tmux-conductor-daemon.service.in
  ```
- **Expected Result**: Prints `WantedBy=default.target`. Exit status 0.
- [x] Pass <!-- 2026-06-12 -->

### UAT-EDGE-001: Rendered plist passes `plutil -lint` (valid XML)
- **Scenario**: After substituting concrete values for the three tokens, the plist must remain well-formed XML so launchd can load it. Verifies the templating did not break XML structure.
- **Steps**:
  1. Run the command below from the repo root. It renders a copy into the gitignored `tmp/` dir with dummy absolute paths and lints it.
- **Command**:
  ```bash
  sed -e 's#__REPO_ROOT__#/opt/repo#g' -e 's#__LOG_PATH__#/opt/log/daemon.log#g' -e 's#__NODE_PATH__#/opt/node/bin#g' com.tmux-conductor.daemon.plist > tmp/uat019-rendered.plist && plutil -lint tmp/uat019-rendered.plist
  ```
- **Expected Result**: Prints `tmp/uat019-rendered.plist: OK`. Exit status 0.
- [x] Pass <!-- 2026-06-12 -->

### UAT-EDGE-002: No machine-specific node/nvm version path remains in either file
- **Scenario**: Beyond the user-home literal, no concrete nvm/node version path (e.g. `.nvm/versions/node/`) should be baked into either template — node location is the renderer's job via `__NODE_PATH__`.
- **Steps**:
  1. Run the command below from the repo root.
- **Command**:
  ```bash
  grep -rc '.nvm/versions/node' com.tmux-conductor.daemon.plist daemon/tmux-conductor-daemon.service.in
  ```
- **Expected Result**: Prints `com.tmux-conductor.daemon.plist:0` and `daemon/tmux-conductor-daemon.service.in:0` (zero matches in each).
- [x] Pass <!-- 2026-06-12 -->

### UAT-EDGE-003: `.service.in` PATH prepends `__NODE_PATH__` before the Linux system dirs
- **Scenario**: The systemd `Environment=PATH=` line must prepend `__NODE_PATH__` for the same nvm-invisibility reason as the plist, ahead of the system dirs (Homebrew's `/opt/homebrew/bin` is macOS-only and intentionally omitted here).
- **Steps**:
  1. Run the command below from the repo root.
- **Command**:
  ```bash
  grep -x 'Environment=PATH=__NODE_PATH__:/usr/local/bin:/usr/bin:/bin' daemon/tmux-conductor-daemon.service.in
  ```
- **Expected Result**: Prints the matched `Environment=PATH=__NODE_PATH__:/usr/local/bin:/usr/bin:/bin` line. Exit status 0.
- [x] Pass <!-- 2026-06-12 -->

---

## Notes

- All tests are automatable via shell assertions; none require a running daemon, a live API, or a browser.
- Full `systemd-analyze verify` on the rendered `.service` requires resolved paths plus a Linux host and is deferred to TASK-020 / its UAT, per the source task's explicit out-of-scope note.
