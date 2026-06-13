---
id: UAT-022
title: "UAT: Verify install.sh end-to-end into a scratch CONDUCTOR_HOME on macOS"
status: passed
task: TASK-022
created: 2026-06-12
updated: 2026-06-12
---

# UAT-022 — UAT: Verify install.sh end-to-end into a scratch CONDUCTOR_HOME on macOS

implements::[[TASK-022]]

> **Source task**: [`wiki/work/tasks/TASK-022-verify-installer-e2e-macos.md`](../tasks/TASK-022-verify-installer-e2e-macos.md)
> **Generated**: 2026-06-12

These tests encode the TASK-022 acceptance criteria. The scoped-live parts are auto-runnable shell assertions (static syntax gate, sandboxed plist render into `./tmp`, the ff-only update guard, and the daemon-step delegation). The two launchctl-live / live-`/healthz` tests are MANUAL — they require a throwaway `$HOME` or a CI runner because `install.sh` + `bin/conductor daemon install` hardcode the daemon identity (launchd label, socket, log, plist destination) to `$HOME`; running them on the developer's real machine would clobber the real daemon. These two are EXPECTED non-blocking fails under `/uat-auto`, exactly like UI tests.

---

## Prerequisites

- [ ] Run from the repo root (`/Users/davidtaylor/Repositories/tmux-conductor`)
- [ ] `bash`, `plutil`, `git` available on PATH (stock macOS provides all three)
- [ ] Repo-local `./tmp/` exists or is creatable (gitignored scratch dir — mandatory per project rules)

---

## Test Cases

### UAT-SHELL-001: install.sh and bin/conductor pass bash syntax gate
- **Description**: Verifies AC-1's static gate — both the installer and the CLI it invokes parse cleanly under `bash -n` (no syntax errors), the first thing a `curl | bash` consumer's shell does.
- **Steps**:
  1. Run the command below as-is from the repo root.
- **Command**:
  ```bash
  bash -n install.sh && bash -n bin/conductor && echo SYNTAX_OK
  ```
- **Expected Result**: Exit 0, prints `SYNTAX_OK`. Any parse error on either file fails the test.
- [x] Pass <!-- 2026-06-12 -->

### UAT-SHELL-002: Sandboxed plist render into ./tmp leaves zero placeholders and passes plutil -lint
- **Description**: Verifies AC-2 (plist validity) and AC-7 (scratch work under `./tmp`) without touching launchd. Reproduces `bin/conductor`'s exact `sed` substitution of `__REPO_ROOT__` / `__LOG_PATH__` / `__NODE_PATH__` into a scratch file under `./tmp/`, then asserts (a) no residual `__...__` placeholder tokens remain, (b) `plutil -lint` reports OK, and (c) the rendered Label is `com.tmux-conductor.daemon`.
- **Steps**:
  1. Run the command below as-is from the repo root. It renders to `./tmp/uat-022-rendered.plist` (never into `~/Library/LaunchAgents`).
- **Command**:
  ```bash
  mkdir -p ./tmp && REPO_ROOT="$PWD" && LOG_PATH="$PWD/tmp/uat-022-daemon.log" && NODE_PATH="$(dirname "$(command -v node)")" && sed -e "s|__REPO_ROOT__|$REPO_ROOT|g" -e "s|__LOG_PATH__|$LOG_PATH|g" -e "s|__NODE_PATH__|$NODE_PATH|g" com.tmux-conductor.daemon.plist > ./tmp/uat-022-rendered.plist && ! grep -q '__[A-Z_]*__' ./tmp/uat-022-rendered.plist && plutil -lint ./tmp/uat-022-rendered.plist && grep -q '<string>com.tmux-conductor.daemon</string>' ./tmp/uat-022-rendered.plist && echo RENDER_OK
  ```
- **Expected Result**: Exit 0, `plutil -lint` prints `OK`, and the final line is `RENDER_OK`. If any `__...__` token survives the render, the `! grep` clause fails the test.
- [x] Pass <!-- 2026-06-12 -->

### UAT-SHELL-003: install.sh has the ff-only update guard and never destructive-re-clones
- **Description**: Verifies AC-3 (idempotent re-run). Section 3 of `install.sh` must (a) update an existing checkout via `git merge --ff-only`, (b) guard a dirty tree by skipping the update, and (c) never contain a destructive `git reset --hard` or an unconditional re-clone over an existing install dir.
- **Steps**:
  1. Run the command below as-is from the repo root.
- **Command**:
  ```bash
  grep -q 'merge --ff-only' install.sh && grep -q 'working tree at .* is dirty, skipping update' install.sh && ! grep -q 'reset --hard' install.sh && echo IDEMPOTENT_GUARD_OK
  ```
- **Expected Result**: Exit 0, prints `IDEMPOTENT_GUARD_OK`. The `! grep 'reset --hard'` clause asserts no destructive reset path exists.
- [x] Pass <!-- 2026-06-12 -->

### UAT-SHELL-004: Daemon step delegates to `bin/conductor daemon install`
- **Description**: Verifies AC-2's wiring — `install.sh` does not hand-roll launchctl itself; its Section 8 delegates the daemon service install to `"$INSTALL_DIR/bin/conductor" daemon install`, and the real launchctl `bootout`/`bootstrap` lives in `bin/conductor`'s `install)` case. Confirms the contract boundary between installer and CLI.
- **Steps**:
  1. Run the command below as-is from the repo root.
- **Command**:
  ```bash
  grep -qF '"$INSTALL_DIR/bin/conductor" daemon install' install.sh && grep -qF 'launchctl bootout gui/$(id -u)/com.tmux-conductor.daemon' bin/conductor && grep -qF 'launchctl bootstrap gui/$(id -u)' bin/conductor && echo DELEGATION_OK
  ```
  (Fixed-string `-F` is required: the literal `$(id -u)` contains regex metacharacters `(` `)`.)
- **Expected Result**: Exit 0, prints `DELEGATION_OK`.
- [x] Pass <!-- 2026-06-12 -->

### UAT-SHELL-005: Pairing degrades gracefully when run non-interactively
- **Description**: Verifies AC-4. With stdin not a tty and no `CONDUCTOR_PAIRING_CODE`, Section 9 must take a "skipping" branch (either the non-interactive skip, or the `pair` subcommand-absent skip). Asserts both skip branches are present in source so the installer can never block on a pairing prompt in a `curl | bash` run.
- **Steps**:
  1. Run the command below as-is from the repo root.
- **Command**:
  ```bash
  grep -q 'non-interactive, no pairing code — skipping' install.sh && grep -q 'pairing not available yet — skipping' install.sh && echo PAIRING_SKIP_OK
  ```
- **Expected Result**: Exit 0, prints `PAIRING_SKIP_OK`.
- [x] Pass <!-- 2026-06-12 -->

### UAT-MANUAL-001: Live launchctl bootstrap of the daemon (throwaway-$HOME / CI runner)
- **Description**: MANUAL / human-verification-required. Verifies AC-2's *live* path: a real `bin/conductor daemon install` bootstraps the launchd job and the daemon process comes up. **EXPECTED to fail / be skipped under `/uat-auto`** and is **non-blocking**, exactly like a UI test — `install.sh` + `bin/conductor daemon install` hardcode the launchd label (`com.tmux-conductor.daemon`), socket, log, and plist destination to `$HOME`, so running this on the developer's real machine would clobber the real daemon's launchd namespace. Run only inside a throwaway `$HOME` (e.g. `HOME=$(mktemp -d)` on a scratch box) or a disposable CI runner.
- **Steps** (human, on a throwaway $HOME only):
  1. On a scratch machine / CI runner with a disposable `$HOME`, clone the repo and run `bin/conductor daemon install`.
  2. Run `launchctl list | grep com.tmux-conductor.daemon`.
- **Expected Result**: Exactly one `com.tmux-conductor.daemon` job listed, not crash-looping (stable PID across two `launchctl list` reads). On the developer's real machine this test is intentionally NOT run.
- [FAIL: auto-judge: manual test requires human verification — throwaway-$HOME/CI runner; EXPECTED non-blocking] <!-- 2026-06-12 -->

### UAT-MANUAL-002: Live /healthz over the daemon Unix socket (throwaway-$HOME / CI runner)
- **Description**: MANUAL / human-verification-required. Verifies AC-2's live health probe. **EXPECTED to fail / be skipped under `/uat-auto`** and is **non-blocking** — same hardcoded-`$HOME` socket reason as UAT-MANUAL-001. Run only after UAT-MANUAL-001 on a throwaway `$HOME`.
- **Steps** (human, on a throwaway $HOME only):
  1. After UAT-MANUAL-001 bootstraps the daemon, run:
     `curl -s --unix-socket "$HOME/.local/share/tmux-conductor/daemon.sock" http://localhost/healthz`
- **Expected Result**: HTTP 200 / a healthy JSON body from the daemon over the socket. On the developer's real machine this test is intentionally NOT run.
- [FAIL: auto-judge: manual test requires human verification — throwaway-$HOME/CI runner; EXPECTED non-blocking] <!-- 2026-06-12 -->

---

## Notes for /uat-auto

- UAT-SHELL-001 through UAT-SHELL-005 are auto-runnable and must all PASS.
- UAT-MANUAL-001 and UAT-MANUAL-002 are MANUAL (throwaway-`$HOME` / CI runner). They are EXPECTED non-blocking fails under headless auto-run and must NOT gate the overall verdict — treat them like UI tests that require a human/CI environment.
