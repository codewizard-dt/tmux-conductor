# UAT: Refactor Hooks to Node.js

> **Source task**: [`.docs/tasks/active/011-hooks-to-js.md`](../../tasks/active/011-hooks-to-js.md)
> **Generated**: 2026-04-18

Task 011 ports the four Claude Code per-event hooks from Bash to Node.js, extracts shared logic into `hooks/lib/write-state.js`, relocates the installer to the repo root, and archives the old Bash hooks under `hooks/.bash-backup/`. This UAT exercises the installer, the shared helper, and each per-event hook in isolation. No API or UI surface exists for this task — all tests are CLI/filesystem.

---

## Prerequisites

- [ ] `node` is on `PATH` (`node --version` prints a version)
- [ ] `jq` is on `PATH` (`jq --version` prints a version)
- [ ] `bash` >= 4.0 available (`bash --version`)
- [ ] Working directory is the repo root (`pwd` ends in `tmux-conductor`)
- [ ] `./tmp/` is empty or safe to overwrite — the UAT writes fixtures under `tmp/uat-011/`

---

## CLI Tests

### UAT-CLI-001: Per-event JS hooks parse cleanly
- **Description**: Verify all four hooks and the shared helper are syntactically valid Node.js. Confirms step 2 + step 6 of the task.
- **Steps**:
  1. Run the command below as-is from the repo root.
- **Command**:
  ```bash
  node --check hooks/lib/write-state.js && node --check hooks/on-session-start.js && node --check hooks/on-prompt-submit.js && node --check hooks/on-stop.js && node --check hooks/on-stop-failure.js && echo OK
  ```
- **Expected Result**: Final line prints `OK`. No syntax errors printed.
- [ ] Pass

### UAT-CLI-002: Installer passes bash syntax check
- **Description**: Confirms `install-hooks.sh` at the repo root is syntactically valid.
- **Steps**:
  1. Run the command below as-is from the repo root.
- **Command**:
  ```bash
  bash -n install-hooks.sh && echo OK
  ```
- **Expected Result**: Prints `OK`. No syntax errors.
- [ ] Pass

### UAT-CLI-003: Bash hooks archived, not at old paths
- **Description**: Confirms step 3 — the four `.sh` hooks are under `hooks/.bash-backup/` with a README, and not at `hooks/on-*.sh`.
- **Steps**:
  1. Run the command below as-is from the repo root.
- **Command**:
  ```bash
  ls hooks/.bash-backup/ && ls hooks/on-session-start.sh hooks/on-prompt-submit.sh hooks/on-stop.sh hooks/on-stop-failure.sh 2>&1 | head -5
  ```
- **Expected Result**: First listing shows `README.md`, `on-prompt-submit.sh`, `on-session-start.sh`, `on-stop-failure.sh`, `on-stop.sh`. Second listing shows 4 "No such file or directory" errors (the originals were moved).
- [ ] Pass

### UAT-CLI-004: Installer relocated to repo root
- **Description**: Confirms step 4 — `install-hooks.sh` lives at repo root and the old `hooks/install-hooks.sh` no longer exists.
- **Steps**:
  1. Run the command below as-is from the repo root.
- **Command**:
  ```bash
  ls install-hooks.sh hooks/install-hooks.sh 2>&1
  ```
- **Expected Result**: `install-hooks.sh` lists normally; `hooks/install-hooks.sh` prints "No such file or directory".
- [ ] Pass

---

## Edge Case Tests

### UAT-EDGE-001: `writeState` is a no-op when agent name cannot be resolved
- **Scenario**: `CONDUCTOR_AGENT_NAME` is empty and `TMUX` is unset. Per `writeState` in `hooks/lib/write-state.js`, the function must `process.exit(0)` without creating any state file.
- **Steps**:
  1. Run the command below as-is from the repo root.
- **Command**:
  ```bash
  mkdir -p tmp/uat-011/state-noop && env -u CONDUCTOR_AGENT_NAME -u TMUX CONDUCTOR_STATE_DIR="$PWD/tmp/uat-011/state-noop" node hooks/on-prompt-submit.js </dev/null; echo "exit=$?"; ls tmp/uat-011/state-noop
  ```
- **Expected Result**: `exit=0`. The `ls` prints nothing (directory empty — no `.state` file written).
- [ ] Pass

### UAT-EDGE-002: `writeState` swallows mkdir failures
- **Scenario**: `CONDUCTOR_STATE_DIR` points at a path that cannot be created (e.g. a path whose parent is a regular file). Per the `try/catch` around `fs.mkdirSync`, the hook must exit 0 without crashing.
- **Steps**:
  1. Run the command below as-is from the repo root.
- **Command**:
  ```bash
  mkdir -p tmp/uat-011 && : > tmp/uat-011/not-a-dir && CONDUCTOR_AGENT_NAME=test-agent CONDUCTOR_STATE_DIR="$PWD/tmp/uat-011/not-a-dir/state" node hooks/on-stop.js </dev/null; echo "exit=$?"
  ```
- **Expected Result**: `exit=0`. No uncaught exception printed.
- [ ] Pass

### UAT-EDGE-003: Installer prunes stale `.sh` registrations from prior installs
- **Scenario**: Per step 4, the jq `stale_cmd` regex was widened to `\\.(sh|js)$` so a settings.json carrying a legacy `.sh` entry from task 010 loses that entry on re-install.
- **Steps**:
  1. Run the command below as-is from the repo root.
- **Command**:
  ```bash
  mkdir -p tmp/uat-011 && printf '{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"/old/path/hooks/on-stop.sh"}]}]}}\n' > tmp/uat-011/stale-settings.json && ./install-hooks.sh --settings-file tmp/uat-011/stale-settings.json --install-dir tmp/uat-011/stale-install >/dev/null && jq '[.. | .command? // empty] | map(select(endswith(".sh")))' tmp/uat-011/stale-settings.json
  ```
- **Expected Result**: Output is `[]` — no `.sh` commands remain in the settings file.
- [ ] Pass

### UAT-EDGE-004: Installer preserves foreign hook entries
- **Scenario**: A third-party hook registered under a non-tmux-conductor path must survive the installer merge (the jq `stale_cmd` only matches paths ending in `on-(session-start|prompt-submit|stop|stop-failure)\.(sh|js)`).
- **Steps**:
  1. Run the command below as-is from the repo root.
- **Command**:
  ```bash
  mkdir -p tmp/uat-011 && printf '{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"/opt/foreign/my-other-hook.sh"}]}]}}\n' > tmp/uat-011/foreign-settings.json && ./install-hooks.sh --settings-file tmp/uat-011/foreign-settings.json --install-dir tmp/uat-011/foreign-install >/dev/null && jq '.hooks.Stop' tmp/uat-011/foreign-settings.json
  ```
- **Expected Result**: `.hooks.Stop` contains two entries — one with `command: "/opt/foreign/my-other-hook.sh"` (preserved) and one with `command: "tmp/uat-011/foreign-install/on-stop.js"` (newly registered).
- [ ] Pass

---

## Integration Tests

### UAT-INT-001: Installer populates fresh settings.json with four JS registrations
- **Components**: `install-hooks.sh` (repo root) → `hooks/register-hooks.jq` → `jq` → sandbox `settings.json`; files copied from `hooks/*.js` + `hooks/lib/write-state.js` → `$INSTALL_DIR`.
- **Flow**: Run the installer against an empty sandbox → confirm (a) JS scripts and `lib/write-state.js` were copied to the install dir and are executable, (b) `settings.json` contains exactly the four expected registrations pointing at JS paths, (c) SessionStart carries the `startup|resume|clear` matcher.
- **Steps**:
  1. Run the command below as-is from the repo root.
- **Command**:
  ```bash
  rm -rf tmp/uat-011/int1 && mkdir -p tmp/uat-011/int1 && ./install-hooks.sh --settings-file tmp/uat-011/int1/settings.json --install-dir tmp/uat-011/int1/install && ls -l tmp/uat-011/int1/install/on-*.js tmp/uat-011/int1/install/lib/write-state.js && jq '.hooks | {SessionStart: .SessionStart[0], UserPromptSubmit: .UserPromptSubmit[0].hooks[0].command, Stop: .Stop[0].hooks[0].command, StopFailure: .StopFailure[0].hooks[0].command}' tmp/uat-011/int1/settings.json
  ```
- **Expected Result**:
  - Success line: `Conductor hooks installed to tmp/uat-011/int1/install and registered in tmp/uat-011/int1/settings.json`
  - `ls -l` shows 4 `.js` hooks + `lib/write-state.js`, all with executable bit on the `.js` hooks (e.g. `-rwxr-xr-x`)
  - `jq` output shows:
    - `SessionStart.matcher == "startup|resume|clear"` and `SessionStart.hooks[0].command == "tmp/uat-011/int1/install/on-session-start.js"`
    - `UserPromptSubmit == "tmp/uat-011/int1/install/on-prompt-submit.js"`
    - `Stop == "tmp/uat-011/int1/install/on-stop.js"`
    - `StopFailure == "tmp/uat-011/int1/install/on-stop-failure.js"`
- [ ] Pass

### UAT-INT-002: Installer is idempotent (byte-identical output on re-run)
- **Components**: Same as UAT-INT-001 — the jq pipeline's `purge($new_cmd)` stage must dedup its own prior registration.
- **Flow**: Run the installer once → snapshot settings.json → run it a second time with the same args → diff.
- **Steps**:
  1. Run the command below as-is from the repo root.
- **Command**:
  ```bash
  rm -rf tmp/uat-011/idem && mkdir -p tmp/uat-011/idem && ./install-hooks.sh --settings-file tmp/uat-011/idem/settings.json --install-dir tmp/uat-011/idem/install >/dev/null && cp tmp/uat-011/idem/settings.json tmp/uat-011/idem/first.json && ./install-hooks.sh --settings-file tmp/uat-011/idem/settings.json --install-dir tmp/uat-011/idem/install >/dev/null && diff tmp/uat-011/idem/first.json tmp/uat-011/idem/settings.json && echo IDEMPOTENT
  ```
- **Expected Result**: No `diff` output, followed by `IDEMPOTENT`. Exit status 0.
- [ ] Pass

### UAT-INT-003: End-to-end — on-prompt-submit.js writes `busy\n` for a resolved agent
- **Components**: `install-hooks.sh` → installed `on-prompt-submit.js` → `lib/write-state.js` → state file on disk.
- **Flow**: Install to a sandbox → invoke the installed `on-prompt-submit.js` with an agent name and custom state dir, piping empty JSON on stdin (Claude Code normally delivers JSON here and the hook must drain it without blocking) → read back the state file.
- **Steps**:
  1. Run the command below as-is from the repo root.
- **Command**:
  ```bash
  rm -rf tmp/uat-011/e2e && mkdir -p tmp/uat-011/e2e && ./install-hooks.sh --settings-file tmp/uat-011/e2e/settings.json --install-dir tmp/uat-011/e2e/install >/dev/null && env -u TMUX CONDUCTOR_AGENT_NAME=uat-agent CONDUCTOR_STATE_DIR="$PWD/tmp/uat-011/e2e/state" node tmp/uat-011/e2e/install/on-prompt-submit.js <<<'{}' && cat -A tmp/uat-011/e2e/state/uat-agent.state
  ```
- **Expected Result**: `cat -A` prints `busy$` (the `$` represents the terminating newline). Exit status 0.
- [ ] Pass

### UAT-INT-004: End-to-end — on-stop.js and on-stop-failure.js both write `idle\n`
- **Components**: Installed `on-stop.js` and `on-stop-failure.js` → `lib/write-state.js` → state file.
- **Flow**: Reuse the install from UAT-INT-003 → invoke `on-stop.js` (overwrites state to `idle`) → invoke `on-stop-failure.js` (also `idle`) → confirm file contents after each.
- **Steps**:
  1. Run the command below as-is from the repo root.
  2. Must run after UAT-INT-003 (uses the same install dir and state dir).
- **Command**:
  ```bash
  env -u TMUX CONDUCTOR_AGENT_NAME=uat-agent CONDUCTOR_STATE_DIR="$PWD/tmp/uat-011/e2e/state" node tmp/uat-011/e2e/install/on-stop.js <<<'{}' && cat -A tmp/uat-011/e2e/state/uat-agent.state && env -u TMUX CONDUCTOR_AGENT_NAME=uat-agent CONDUCTOR_STATE_DIR="$PWD/tmp/uat-011/e2e/state" node tmp/uat-011/e2e/install/on-stop-failure.js <<<'{}' && cat -A tmp/uat-011/e2e/state/uat-agent.state
  ```
- **Expected Result**: Both `cat -A` invocations print `idle$`. Exit status 0.
- [ ] Pass

### UAT-INT-005: Cleanup sandbox
- **Components**: Filesystem only.
- **Flow**: Remove the `tmp/uat-011/` sandbox created by prior tests.
- **Steps**:
  1. Run the command below as-is from the repo root.
- **Command**:
  ```bash
  rm -rf tmp/uat-011 && ls tmp/uat-011 2>&1
  ```
- **Expected Result**: Final line prints "No such file or directory" (sandbox is gone).
- [ ] Pass
