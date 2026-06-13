---
id: TASK-020
title: "Sync bin/conductor daemon install to the rendered-template + bootout/bootstrap flow"
status: done
created: 2026-06-12
updated: 2026-06-12
depends_on: [TASK-019]
blocks: [TASK-022]
parallel_safe_with: []
uat: "../uat/UAT-020-daemon-install-render-bootstrap.md"
tags: [shell, daemon, launchd, systemd, install, service]
---

# TASK-020 — Sync bin/conductor daemon install to the rendered-template + bootout/bootstrap flow

## Objective

Rewrite the `daemon install` subcommand in `bin/conductor` so it is the **single, canonical** service-install implementation for both macOS (launchd) and Linux (systemd user units). The current implementation only substitutes `__REPO_ROOT__` into the launchd plist and then runs the deprecated `launchctl load`; it never substitutes the `__LOG_PATH__` / `__NODE_PATH__` placeholders that TASK-019 added to the template, and it has no Linux path at all. After this task, `daemon install` renders all three placeholders, installs to the per-OS user service location, and (re)loads the service idempotently via the modern `launchctl bootout`/`bootstrap` flow (macOS) or `systemctl --user` (Linux). install.sh (TASK-022) MUST call `bin/conductor daemon install` rather than re-implement rendering, so this rendering logic lives in exactly one place and the two install paths cannot drift.

## Approach

The existing block (`bin/conductor`, lines ~139-146) is:

```sh
install)
  PLIST_SRC="$REPO_ROOT/com.tmux-conductor.daemon.plist"
  PLIST_DST="$HOME/Library/LaunchAgents/com.tmux-conductor.daemon.plist"
  mkdir -p "$(dirname "$PLIST_DST")"
  sed "s|__REPO_ROOT__|$REPO_ROOT|g" "$PLIST_SRC" > "$PLIST_DST"
  launchctl load "$PLIST_DST"
  echo "Installed and loaded daemon plist."
  ;;
```

Three problems: (1) only `__REPO_ROOT__` is substituted — `__LOG_PATH__` and `__NODE_PATH__` (added to the plist by TASK-019) are left as literal placeholders; (2) `launchctl load` is deprecated on modern macOS; (3) there is no Linux/systemd branch.

The rewrite computes three substitution values once, then branches on OS via `uname -s`:

- `REPO_ROOT` — already in scope at the top of `bin/conductor` (used by `daemon start` at line 118).
- `LOG_PATH` — `$HOME/.local/share/tmux-conductor/daemon.log` (same path `daemon start` already uses at line 116). `mkdir -p "$(dirname "$LOG_PATH")"` before rendering so the log directory exists.
- `NODE_PATH` — `$(dirname "$(command -v node)")` — the directory containing the `node` binary, so the launchd/systemd unit's `PATH` can find `node`/`tsx`. Fail clearly if `command -v node` is empty.

All substitution uses `sed` with the `s|…|…|g` form (pipe delimiter, since paths contain `/`), exactly mirroring the existing `__REPO_ROOT__` line — three sequential `-e` expressions in one `sed` invocation.

**macOS branch** (`Darwin`):
- `PLIST_SRC="$REPO_ROOT/com.tmux-conductor.daemon.plist"`, `PLIST_DST="$HOME/Library/LaunchAgents/com.tmux-conductor.daemon.plist"`.
- `mkdir -p "$(dirname "$PLIST_DST")"`, render with the 3-substitution `sed`.
- Replace `launchctl load` with idempotent reload: `launchctl bootout gui/$(id -u)/com.tmux-conductor.daemon 2>/dev/null || true` (tolerate "not loaded") then `launchctl bootstrap gui/$(id -u) "$PLIST_DST"`.

**Linux branch** (anything else / `Linux`):
- `UNIT_SRC="$REPO_ROOT/daemon/tmux-conductor-daemon.service.in"` (the systemd user-unit template TASK-019 creates).
- `UNIT_DST="$HOME/.config/systemd/user/tmux-conductor-daemon.service"`.
- `mkdir -p "$(dirname "$UNIT_DST")"`, render with the SAME 3-substitution `sed`.
- `systemctl --user daemon-reload`, then `systemctl --user enable --now tmux-conductor-daemon.service`.
- Echo advice to run `loginctl enable-linger "$USER"` so the user daemon survives logout.

The `daemon help` usage text (lines 148-156) and the top-level `help` description of `daemon <sub>` (line 173) must stay in sync — the `install` line should describe "render + load the user service for this OS (launchd on macOS, systemd on Linux)".

> **Single-source constraint:** Do NOT duplicate any of this rendering into install.sh. TASK-022 wires install.sh to shell out to `bin/conductor daemon install`. This task owns the rendering; install.sh only invokes it.

> **TASK-019 dependency:** This task assumes the plist already contains the `__LOG_PATH__` and `__NODE_PATH__` placeholders and that `daemon/tmux-conductor-daemon.service.in` exists with `__REPO_ROOT__`/`__LOG_PATH__`/`__NODE_PATH__` placeholders. If those are absent, TASK-019 is not yet done — stop and surface that, do not invent the template here.

## Steps

### 1. Confirm prerequisites from TASK-019  <!-- agent: general-purpose -->

- [x] Use Serena `search_for_pattern` for `__LOG_PATH__` and `__NODE_PATH__` in `com.tmux-conductor.daemon.plist` — confirm both placeholders exist (added by TASK-019) <!-- Completed: 2026-06-12 -->
- [x] Use Serena `find_file` for `tmux-conductor-daemon.service.in` in `daemon/` — confirm the systemd user-unit template exists and contains `__REPO_ROOT__`, `__LOG_PATH__`, `__NODE_PATH__` <!-- Completed: 2026-06-12 -->
- [x] If either prerequisite is missing, stop and report that TASK-019 must complete first (do not author the template or add placeholders in this task) — PASS, both present <!-- Completed: 2026-06-12 -->

### 2. Compute the three substitution values  <!-- agent: general-purpose -->

- [x] In `bin/conductor`, locate the `install)` case under `daemon)` (currently lines ~139-146) <!-- Completed: 2026-06-12 -->
- [x] At the top of the rewritten `install)` block, set `LOG_PATH="$HOME/.local/share/tmux-conductor/daemon.log"` and `mkdir -p "$(dirname "$LOG_PATH")"` (matches the path `daemon start` uses at line 116) <!-- Completed: 2026-06-12 -->
- [x] Resolve `NODE_BIN="$(command -v node)"`; if empty, `echo "Error: node not found on PATH" >&2; exit 1`; otherwise `NODE_PATH="$(dirname "$NODE_BIN")"` <!-- Completed: 2026-06-12 -->
- [x] `REPO_ROOT` is already in scope — no new assignment needed <!-- Completed: 2026-06-12 -->
- [x] Define a single reusable `sed` substitution form used by both branches: `sed -e "s|__REPO_ROOT__|$REPO_ROOT|g" -e "s|__LOG_PATH__|$LOG_PATH|g" -e "s|__NODE_PATH__|$NODE_PATH|g"` <!-- Completed: 2026-06-12 -->

### 3. Rewrite the macOS (launchd) branch  <!-- agent: general-purpose -->

- [x] Branch with `case "$(uname -s)" in Darwin) … ;; *) … ;; esac` inside the `install)` block <!-- Completed: 2026-06-12 -->
- [x] macOS: `PLIST_SRC="$REPO_ROOT/com.tmux-conductor.daemon.plist"`, `PLIST_DST="$HOME/Library/LaunchAgents/com.tmux-conductor.daemon.plist"`, `mkdir -p "$(dirname "$PLIST_DST")"` <!-- Completed: 2026-06-12 -->
- [x] Render: `sed -e … -e … -e … "$PLIST_SRC" > "$PLIST_DST"` (all three substitutions) <!-- Completed: 2026-06-12 -->
- [x] Replace `launchctl load "$PLIST_DST"` with: `launchctl bootout gui/$(id -u)/com.tmux-conductor.daemon 2>/dev/null || true` then `launchctl bootstrap gui/$(id -u) "$PLIST_DST"` <!-- Completed: 2026-06-12 -->
- [x] `echo "Installed and loaded launchd daemon: $PLIST_DST"` <!-- Completed: 2026-06-12 -->

### 4. Add the Linux (systemd user) branch  <!-- agent: general-purpose -->

- [x] In the `*)` (non-Darwin) branch: `UNIT_SRC="$REPO_ROOT/daemon/tmux-conductor-daemon.service.in"`, `UNIT_DST="$HOME/.config/systemd/user/tmux-conductor-daemon.service"`, `mkdir -p "$(dirname "$UNIT_DST")"` <!-- Completed: 2026-06-12 -->
- [x] Render with the same 3-substitution `sed`: `sed -e … -e … -e … "$UNIT_SRC" > "$UNIT_DST"` <!-- Completed: 2026-06-12 -->
- [x] `systemctl --user daemon-reload` <!-- Completed: 2026-06-12 -->
- [x] `systemctl --user enable --now tmux-conductor-daemon.service` <!-- Completed: 2026-06-12 -->
- [x] `echo "Installed and started systemd user daemon: $UNIT_DST"` and `echo "Tip: run 'loginctl enable-linger $USER' so the daemon keeps running after logout."` <!-- Completed: 2026-06-12 -->

### 5. Keep help/usage text in sync  <!-- agent: general-purpose -->

- [x] Update the `daemon help` block (lines ~148-156): change the `install` line to `echo "  install  Render + load the user service for this OS (launchd/systemd)"` <!-- Completed: 2026-06-12 -->
- [x] Update the top-level `help` block (line ~173) `daemon <sub>` description to mention install across macOS/Linux if it currently says launchd-only — already OS-neutral (`start|stop|status|install`), left unchanged <!-- Completed: 2026-06-12 -->
- [x] Use Serena `search_for_pattern` for `launchctl load` and the literal `__LOG_PATH__`/`__NODE_PATH__` in `bin/conductor` to confirm no deprecated/unrendered remnants remain — zero `launchctl load`; placeholders only in sed exprs (lines 152, 161) <!-- Completed: 2026-06-12 -->

### 6. Syntax + smoke verification  <!-- agent: general-purpose -->

- [x] `bash -n bin/conductor` — no syntax errors <!-- Completed: 2026-06-12 -->
- [x] Dry-render check (do NOT actually `bootstrap`/`enable`): in a scratch shell, run the macOS `sed` form against `com.tmux-conductor.daemon.plist` into `./tmp/` and confirm zero `__REPO_ROOT__`/`__LOG_PATH__`/`__NODE_PATH__` placeholders remain in the output — 0 placeholders <!-- Completed: 2026-06-12 -->
- [x] Repeat the dry-render against `daemon/tmux-conductor-daemon.service.in` into `./tmp/` and confirm zero placeholders remain — 0 placeholders <!-- Completed: 2026-06-12 -->
- [x] Confirm `command -v node` resolves on the dev host so `NODE_PATH` is non-empty — resolves to /opt/homebrew/bin <!-- Completed: 2026-06-12 -->

## Acceptance Criteria

- [ ] `daemon install` substitutes all three placeholders (`__REPO_ROOT__`, `__LOG_PATH__`, `__NODE_PATH__`) into the rendered service file — no literal placeholder survives in the destination file
- [ ] `__LOG_PATH__` resolves to `$HOME/.local/share/tmux-conductor/daemon.log` and its parent dir is `mkdir -p`'d before rendering
- [ ] `__NODE_PATH__` resolves to `$(dirname "$(command -v node)")`; install fails with a clear error if `node` is not on PATH
- [ ] macOS path renders to `~/Library/LaunchAgents/` and loads via `launchctl bootout … || true` then `launchctl bootstrap gui/$(id -u) …` — the deprecated `launchctl load` is gone
- [ ] Linux path detects non-Darwin via `uname -s`, renders `daemon/tmux-conductor-daemon.service.in` to `~/.config/systemd/user/tmux-conductor-daemon.service`, then `systemctl --user daemon-reload` + `enable --now`, and prints the `loginctl enable-linger` tip
- [ ] `daemon help` and the top-level `help` text describe install as an OS-aware render+load (no longer "macOS plist only")
- [ ] `bash -n bin/conductor` passes; dry-renders of both templates leave zero placeholders
- [ ] No rendering logic is duplicated outside `bin/conductor` (single-source constraint preserved for TASK-022)

## Dependencies

- **DEPENDS ON [TASK-019](TASK-019-parameterize-daemon-plist-systemd.md)** — TASK-019 adds the `__LOG_PATH__` and `__NODE_PATH__` placeholders to `com.tmux-conductor.daemon.plist` and creates the `daemon/tmux-conductor-daemon.service.in` systemd user-unit template. This task renders those placeholders and that template; it cannot complete until they exist.
- **BLOCKS [TASK-022](TASK-022-install-sh.md)** — install.sh must call `bin/conductor daemon install` to perform service installation rather than re-implementing rendering. This task establishes that single canonical install path; TASK-022 wires install.sh to invoke it.
