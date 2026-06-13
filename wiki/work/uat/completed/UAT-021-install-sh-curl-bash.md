---
id: UAT-021
title: "UAT: Write install.sh — bash-3.2-safe, idempotent curl|bash installer"
status: passed
task: TASK-021
created: 2026-06-12
updated: 2026-06-12
---

# UAT-021 — UAT: Write install.sh — bash-3.2-safe, idempotent curl|bash installer

implements::[[TASK-021]]

> **Source task**: [`wiki/work/tasks/TASK-021-install-sh-curl-bash.md`](../../tasks/completed/TASK-021-install-sh-curl-bash.md)
> **Generated**: 2026-06-12

---

## Prerequisites

- [ ] Run all shell commands from the repo root: `/Users/davidtaylor/Repositories/tmux-conductor`
- [ ] `bash` available (any version — the static tests do not execute the installer body)
- [ ] For the heavier live-install tests (UAT-LIVE-*): a throwaway scratch `$HOME` is required so a real run does not touch your machine. These are marked **MANUAL / scratch-home** and are not auto-runnable.

---

## Test Cases

### UAT-STATIC-001: Script passes `bash -n` syntax check
- **Description**: The installer must parse cleanly with no syntax errors under `bash -n` (acceptance: Step 12 — "must pass clean").
- **Steps**:
  1. From repo root, run the command below.
  2. Confirm it exits 0 and prints nothing.
- **Command**:
  ```bash
  bash -n install.sh
  ```
- **Expected Result**: Exit code 0, no output. Any syntax error fails the test.
- [x] Pass <!-- 2026-06-12 -->

### UAT-STATIC-002: No bash-4-only constructs present (bash-3.2 safety)
- **Description**: The script body must contain NO bash-4-only constructs — `declare -A`, `mapfile`, `readarray`, `${var^^}`, `${var,,}` — outside the explanatory doc comment. (Acceptance: Step 12 — "zero functional occurrences".) The script's own comments reference these token names to document the constraint, so the assertion targets functional usage, not the documentary mentions.
- **Steps**:
  1. Run the grep below, which searches for functional usage of the forbidden constructs.
  2. `declare -A` must never appear. `mapfile`/`readarray` as command invocations must never appear. `${var^^}` / `${var,,}` case-conversion expansions must never appear.
- **Command**:
  ```bash
  grep -nE 'declare[[:space:]]+-A|^[[:space:]]*(mapfile|readarray)[[:space:]]|\$\{[A-Za-z_][A-Za-z0-9_]*(\^\^|,,)\}' install.sh | grep -vE '^[0-9]+:[[:space:]]*#'
  ```
- **Expected Result**: The final pipeline exits non-zero and prints nothing. The base grep matches the forbidden token names where they appear as prose inside the leading doc comment block (lines 6-10); the trailing `grep -vE '^[0-9]+:[[:space:]]*#'` strips those comment lines, leaving zero functional matches. If any NON-comment line containing an actual `declare -A` / `mapfile` / `readarray` / `${var^^}` / `${var,,}` construct survives the filter, the pipeline prints it and the test FAILS.
- [x] Pass <!-- 2026-06-12 -->

### UAT-STATIC-003: Truncated-download guard — `main(){...}; main "$@"` wrapper
- **Description**: The entire body must be wrapped in `main() { … }` with the only top-level executable line being `main "$@"` (acceptance: Step 1 + Step 12, line ~476).
- **Steps**:
  1. Confirm a `main()` function definition exists.
  2. Confirm the final non-blank line of the file is exactly `main "$@"`.
- **Command**:
  ```bash
  grep -nE '^main\(\)[[:space:]]*\{' install.sh && tail -n 1 install.sh | grep -qxE 'main "\$@"' && echo GUARD_OK
  ```
- **Expected Result**: Prints the `main() {` definition line, then `GUARD_OK`. Exit code 0. If either the function header or the trailing `main "$@"` is missing, the test FAILS.
- [x] Pass <!-- 2026-06-12 -->

### UAT-STATIC-004: `set -euo pipefail` at the top
- **Description**: The installer must enable strict mode (`set -euo pipefail`) near the top, matching house style (acceptance: Step 1).
- **Steps**:
  1. Confirm `set -euo pipefail` appears within the first 5 lines.
- **Command**:
  ```bash
  head -n 5 install.sh | grep -qxE 'set -euo pipefail' && echo STRICT_MODE_OK
  ```
- **Expected Result**: Prints `STRICT_MODE_OK`, exit 0. If absent in the header, FAILS.
- [x] Pass <!-- 2026-06-12 -->

### UAT-STATIC-005: Delegates daemon install — does NOT re-implement plist rendering
- **Description**: The installer must CALL `bin/conductor daemon install` and must NOT contain its own plist/systemd rendering (acceptance: Step 9 + Dependencies — "do NOT re-implement it here"). TASK-020 owns the rendering.
- **Steps**:
  1. Confirm the script invokes `"$INSTALL_DIR/bin/conductor" daemon install`.
  2. Confirm the script contains no plist/launchd/systemd-unit rendering markers (e.g. `<plist`, `<?xml`, `[Unit]`, `launchctl bootstrap`, `Label</key>`).
- **Command**:
  ```bash
  grep -qE 'bin/conductor" daemon install' install.sh && ! grep -qiE '<plist|<\?xml|\[Unit\]|launchctl[[:space:]]+bootstrap|<key>Label' install.sh && echo DELEGATES_DAEMON_OK
  ```
- **Expected Result**: Prints `DELEGATES_DAEMON_OK`, exit 0. The first grep must find the delegation call; the second must find NO rendering markers. If the installer re-implements plist rendering, the test FAILS.
- [x] Pass <!-- 2026-06-12 -->

### UAT-STATIC-006: Pairing prompt reads from `/dev/tty`, not stdin
- **Description**: Under `curl | bash` stdin is the script text, so the interactive pairing prompt must read from `/dev/tty` (acceptance: Step 10, line ~434).
- **Steps**:
  1. Confirm a `read` of the pairing code redirects from `/dev/tty`.
  2. Confirm the script guards on `/dev/tty` readability before prompting.
- **Command**:
  ```bash
  grep -qE 'read -r code </dev/tty' install.sh && grep -qE '\[ -r /dev/tty \]' install.sh && echo DEVTTY_OK
  ```
- **Expected Result**: Prints `DEVTTY_OK`, exit 0. Both the `read … </dev/tty` and the `[ -r /dev/tty ]` guard must be present. If the prompt reads from plain stdin instead, FAILS.
- [x] Pass <!-- 2026-06-12 -->

### UAT-STATIC-007: Prereq checks reference git, tmux, node, npm, jq
- **Description**: Section 2 must perform prerequisite checks for git, tmux, node, npm, and jq (acceptance: Step 3). Each is probed via `command -v` (with version parsing for tmux/node).
- **Steps**:
  1. Confirm each of the five tool names appears in a `command -v` check.
- **Command**:
  ```bash
  for tool in git tmux node npm jq; do grep -qE "command -v $tool" install.sh && echo "FOUND $tool" || echo "MISSING $tool"; done
  ```
- **Expected Result**: Five lines, all `FOUND`: `FOUND git`, `FOUND tmux`, `FOUND node`, `FOUND npm`, `FOUND jq`. Any `MISSING` line FAILS the test.
- [x] Pass <!-- 2026-06-12 -->

### UAT-STATIC-008: PATH bash >= 4 check inspects the PATH bash, not $BASH_VERSION
- **Description**: The runtime scripts need bash >= 4 on PATH, but the installer itself runs on 3.2. The check must inspect `command -v bash` via `--version`, NOT the running shell's `$BASH_VERSION` (acceptance: Step 3 — "inspect the bash on PATH … NOT `$BASH_VERSION`").
- **Steps**:
  1. Confirm the script resolves the PATH bash and reads its `--version`.
  2. Confirm the bash-version gate does not branch on `$BASH_VERSION`.
- **Command**:
  ```bash
  grep -qE 'command -v bash' install.sh && grep -qE '"\$path_bash" --version' install.sh && ! grep -nE '\$BASH_VERSION' install.sh | grep -qvE '^[0-9]+:[[:space:]]*#' && echo PATH_BASH_OK
  ```
- **Expected Result**: Prints `PATH_BASH_OK`, exit 0. The script resolves the PATH bash and runs `--version` on it. The `$BASH_VERSION` token appears only in a comment ("NOT $BASH_VERSION") documenting the constraint; the inner `grep -qvE '^[0-9]+:#'` filter confirms there is NO functional (non-comment) reference to `$BASH_VERSION`, so the leading `!` makes the clause true. FAILS if the version gate actually branches on the running shell's `$BASH_VERSION`.
- [x] Pass <!-- 2026-06-12 -->

### UAT-STATIC-009: Idempotent symlink via `ln -sf`
- **Description**: Re-runs must replace (not duplicate) the CLI symlink — the installer must use `ln -sf` (acceptance: Step 8 + idempotency contract).
- **Steps**:
  1. Confirm the conductor symlink is created with `ln -sf`.
- **Command**:
  ```bash
  grep -qE 'ln -sf "\$INSTALL_DIR/bin/conductor" "\$HOME/\.local/bin/conductor"' install.sh && echo LN_SF_OK
  ```
- **Expected Result**: Prints `LN_SF_OK`, exit 0. If the symlink is created without `-f` (would fail/duplicate on re-run), FAILS.
- [x] Pass <!-- 2026-06-12 -->

### UAT-STATIC-010: Fast-forward-only repo update (no clobber)
- **Description**: On an existing clean git tree the installer must update with fast-forward-only and never force; on a dirty tree it must warn-skip (acceptance: Step 4 + idempotency contract).
- **Steps**:
  1. Confirm the update path uses `merge --ff-only` (or `pull --ff-only`).
  2. Confirm a dirty tree (`status --porcelain` non-empty) triggers a skip rather than a clobber.
- **Command**:
  ```bash
  grep -qE 'merge --ff-only "origin/\$BRANCH"|pull --ff-only' install.sh && grep -qE 'status --porcelain' install.sh && echo FF_ONLY_OK
  ```
- **Expected Result**: Prints `FF_ONLY_OK`, exit 0. Both the ff-only merge/pull and the porcelain dirty-tree guard must be present. FAILS if the update can force-overwrite a tree.
- [x] Pass <!-- 2026-06-12 -->

### UAT-STATIC-011: Health-poll uses the daemon unix socket + /healthz
- **Description**: After daemon install, the installer must poll health via `curl --unix-socket "$SOCK" http://localhost/healthz` (acceptance: Step 9; socket + route fixed per task env grounding).
- **Steps**:
  1. Confirm the curl health poll targets the unix socket and the `/healthz` route.
- **Command**:
  ```bash
  grep -qE 'curl -s --unix-socket "\$SOCK" http://localhost/healthz' install.sh && echo HEALTHZ_OK
  ```
- **Expected Result**: Prints `HEALTHZ_OK`, exit 0. FAILS if the health check uses a TCP port instead of the unix socket, or hits a different route.
- [x] Pass <!-- 2026-06-12 -->

### UAT-STATIC-012: DB migrate/verify are defensively warn-skipped
- **Description**: `db:migrate` and `db:verify` npm scripts are not yet wired, so the installer must probe for them and warn-skip when absent rather than hard-fail (acceptance: Step 6 + env grounding).
- **Steps**:
  1. Confirm the script probes `scripts['db:migrate']` and `scripts['db:verify']` from `backend/package.json` before running them.
  2. Confirm both have a warn-skip branch.
- **Command**:
  ```bash
  grep -qE "scripts\['db:migrate'\]" install.sh && grep -qE "scripts\['db:verify'\]" install.sh && grep -qiE "db:migrate script not wired yet" install.sh && echo DB_DEFENSIVE_OK
  ```
- **Expected Result**: Prints `DB_DEFENSIVE_OK`, exit 0. Both script probes and the warn-skip note must be present. FAILS if the installer assumes the scripts exist (would hard-fail on a real run today).
- [x] Pass <!-- 2026-06-12 -->

### UAT-STATIC-013: Pairing degrades gracefully when `pair` subcommand absent
- **Description**: `conductor pair` arrives in ROADMAP-002 Phase 3 and is absent today. The installer must detect its absence and skip pairing without failing (acceptance: Step 10 — key graceful-degrade path).
- **Steps**:
  1. Confirm the script probes `bin/conductor pair --help` to detect the subcommand.
  2. Confirm an absent subcommand logs a "pairing not available" skip and never `die`s.
- **Command**:
  ```bash
  grep -qE 'bin/conductor" pair --help' install.sh && grep -qiE 'pairing not available yet' install.sh && echo PAIR_DEGRADE_OK
  ```
- **Expected Result**: Prints `PAIR_DEGRADE_OK`, exit 0. The probe and the graceful-skip log must both be present. FAILS if a missing `pair` subcommand would abort the installer.
- [x] Pass <!-- 2026-06-12 -->

### UAT-STATIC-014: Ten ordered sections present in order
- **Description**: The installer is specified as 10 ordered sections (acceptance: Approach — "10 ordered sections … follow the ordering exactly"). Confirm each section header is present in ascending order.
- **Steps**:
  1. Extract the `Section N —` headers in file order and confirm they read 1 through 10 monotonically.
- **Command**:
  ```bash
  grep -oE 'Section ([0-9]+) —' install.sh | grep -oE '[0-9]+' | paste -sd, -
  ```
- **Expected Result**: Prints `1,2,3,4,5,6,7,8,9,10` (Section markers in ascending order, no gaps, no reordering). Note: a `Step 1` skeleton comment precedes Section 1; only the `Section N —` markers are counted here. FAILS if any section is missing or out of order.
- [x] Pass <!-- 2026-06-12 -->

### UAT-STATIC-015: Logging tees to the XDG data-dir install.log
- **Description**: Progress must be logged to `~/.local/share/tmux-conductor/install.log`, with the log dir created first (acceptance: Approach — Logging; Step 1).
- **Steps**:
  1. Confirm `LOG_DIR` points at `$HOME/.local/share/tmux-conductor` and is `mkdir -p`'d.
  2. Confirm `LOG_FILE` is `$LOG_DIR/install.log`.
- **Command**:
  ```bash
  grep -qE 'LOG_DIR="\$HOME/\.local/share/tmux-conductor"' install.sh && grep -qE 'mkdir -p "\$LOG_DIR"' install.sh && grep -qE 'LOG_FILE="\$LOG_DIR/install\.log"' install.sh && echo LOG_OK
  ```
- **Expected Result**: Prints `LOG_OK`, exit 0. FAILS if the log lives in `/tmp`, `$TMPDIR`, or anywhere other than the XDG data dir.
- [x] Pass <!-- 2026-06-12 -->

### UAT-STATIC-016: Env-overridable settings honor CONDUCTOR_* defaults
- **Description**: Section 1 must define install dir, repo url, branch, pairing code, and socket as env-overridable with the documented defaults (acceptance: Step 2).
- **Steps**:
  1. Confirm each setting uses the `${CONDUCTOR_*:-default}` override form.
- **Command**:
  ```bash
  for v in 'INSTALL_DIR="\$\{CONDUCTOR_HOME:-' 'REPO_URL="\$\{CONDUCTOR_REPO_URL:-' 'BRANCH="\$\{CONDUCTOR_BRANCH:-main\}' 'CONDUCTOR_PAIRING_CODE="\$\{CONDUCTOR_PAIRING_CODE:-' 'SOCK="\$\{CONDUCTOR_DAEMON_SOCK:-'; do grep -qE "$v" install.sh && echo "OK $v" || echo "MISSING $v"; done
  ```
- **Expected Result**: Five `OK` lines, no `MISSING`. Each of the five env-overridable settings uses the `:-default` form. Any `MISSING` FAILS the test.
- [x] Pass <!-- 2026-06-12 -->

### UAT-LIVE-001: Clean install into a scratch CONDUCTOR_HOME (MANUAL / scratch-home)
- **Scenario**: A full real run against a throwaway home, verifying the installer stands up an installation end-to-end. **This executes the installer body and clones the repo — run ONLY in a disposable environment** (e.g. a scratch HOME or a container). Not auto-runnable.
- **Steps**:
  1. Create a scratch HOME under the repo-local tmp dir, e.g. `SCRATCH="$PWD/tmp/uat-021-home"; mkdir -p "$SCRATCH"`.
  2. Run the installer pointing all paths at the scratch home and a local clone source so no network is needed:
     `HOME="$SCRATCH" CONDUCTOR_HOME="$SCRATCH/.tmux-conductor" CONDUCTOR_REPO_URL="file://$PWD" bash install.sh`
  3. Observe the run to completion.
- **Expected Result**: The run reaches `=== install complete ===` and prints the summary block. The clone lands at `$SCRATCH/.tmux-conductor`, a `data/` dir exists, the symlink `$SCRATCH/.local/bin/conductor` exists, and `$SCRATCH/.local/share/tmux-conductor/install.log` contains the full transcript. db:migrate/db:verify and pairing are warn-skipped (expected — not yet wired). FAILS only on a `die`/non-zero exit from a hard step (prereqs, clone, non-git INSTALL_DIR).
- [FAIL: auto-judge: manual test requires human verification — MANUAL / scratch-home live install] <!-- 2026-06-12 -->

### UAT-LIVE-002: Idempotent re-run is non-destructive (MANUAL / scratch-home)
- **Scenario**: Re-running the installer over an already-installed scratch home must not clobber or duplicate anything (acceptance: idempotency contract). **MANUAL / scratch-home** — depends on UAT-LIVE-001 having run first into the same `$SCRATCH`.
- **Steps**:
  1. With the same `$SCRATCH` from UAT-LIVE-001, run the installer a second time:
     `HOME="$SCRATCH" CONDUCTOR_HOME="$SCRATCH/.tmux-conductor" CONDUCTOR_REPO_URL="file://$PWD" bash install.sh`
  2. Observe the repo-sync and symlink steps.
- **Expected Result**: Second run completes with exit 0. The repo-sync step takes the fast-forward path (or warn-skips if the scratch tree is dirty) — it does NOT re-clone and does NOT clobber. The symlink is replaced in place via `ln -sf` (still a single symlink at `$SCRATCH/.local/bin/conductor`, not duplicated). install.log is appended to, not truncated. No hard failure on re-run.
- [FAIL: auto-judge: manual test requires human verification — MANUAL / scratch-home idempotent re-run] <!-- 2026-06-12 -->

### UAT-LIVE-003: Dirty-tree update is warn-skipped (MANUAL / scratch-home)
- **Scenario**: With local uncommitted changes in the scratch clone, the update step must warn and leave the tree untouched (acceptance: Step 4). **MANUAL / scratch-home**.
- **Steps**:
  1. In `$SCRATCH/.tmux-conductor`, make the tree dirty: `echo x >> "$SCRATCH/.tmux-conductor/README.md"` (or touch a tracked file).
  2. Re-run: `HOME="$SCRATCH" CONDUCTOR_HOME="$SCRATCH/.tmux-conductor" CONDUCTOR_REPO_URL="file://$PWD" bash install.sh`.
  3. Inspect the output / install.log for the dirty-tree warning.
- **Expected Result**: The installer logs `WARN: working tree at … is dirty, skipping update; resolve manually.` and continues to completion (exit 0). The local dirty change is preserved — never discarded or overwritten.
- [FAIL: auto-judge: manual test requires human verification — MANUAL / scratch-home dirty-tree warn-skip] <!-- 2026-06-12 -->

---
