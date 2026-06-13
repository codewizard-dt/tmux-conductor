---
id: TASK-019
title: "Parameterize daemon launchd plist (log path, node path) and add a systemd user-unit template"
status: done
created: 2026-06-12
updated: 2026-06-12
roadmap: "../roadmaps/ROADMAP-002-hosted-portal-oauth-relay-installer.md"
depends_on: []
blocks: [TASK-020]
parallel_safe_with: []
uat: "../uat/UAT-019-parameterize-daemon-plist-systemd.md"
tags: [daemon, installer, launchd, systemd, template]
---

# TASK-019 — Parameterize daemon launchd plist (log path, node path) and add a systemd user-unit template

## Objective

Make the daemon service definitions fully portable across machines and across the two supported init systems (macOS launchd, Linux systemd) by completing the placeholder-templating of `com.tmux-conductor.daemon.plist` and adding a parallel `daemon/tmux-conductor-daemon.service.in` systemd **user** unit template. Both files must use the **same three placeholder tokens** — `__REPO_ROOT__`, `__LOG_PATH__`, `__NODE_PATH__` — so a single downstream renderer (TASK-020) can substitute all of them with one shared substitution map.

This task is **template/placeholder authoring only**. It changes the two hardcoded values in the existing plist and creates one new `.service.in` file. It does **not** implement the rendering logic in `bin/conductor daemon install` — that is the separate downstream TASK-020 and must not be touched here.

## Context

The macOS daemon is defined by `com.tmux-conductor.daemon.plist` (repo root). It already templates `__REPO_ROOT__` in two places (`ProgramArguments` → `__REPO_ROOT__/daemon/node_modules/.bin/tsx` and `__REPO_ROOT__/daemon/index.ts`, and `WorkingDirectory` → `__REPO_ROOT__`), but two concerns are still machine-specific hardcodes:

- **Log paths (lines 19 and 21):** both `StandardOutPath` and `StandardErrorPath` are the literal `/Users/davidtaylor/.local/share/tmux-conductor/daemon.log` — David's home directory, baked in. Any other user (or a scratch `CONDUCTOR_HOME`) gets a path they can't write to, so launchd fails to open the log and the job is dead on arrival.
- **PATH (line 25):** the `EnvironmentVariables` → `PATH` is the fixed `/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin`. launchd starts jobs with a minimal PATH and **does not** inherit the user's shell environment, so an nvm-installed `node` (which lives under `~/.nvm/versions/node/<v>/bin`, never in any of those four dirs) is invisible. `tsx` then can't find a `node`, the daemon throws on spawn, and KeepAlive crash-loops it.

The fix mirrors the existing `__REPO_ROOT__` treatment: replace each machine-specific value with a placeholder token that the installer's renderer resolves at install time.

Linux has no launchd. The portal installer (ROADMAP-002 Phase 1) targets macOS first but the daemon must be installable on Linux too, where the idiomatic mechanism is a **systemd user unit** managed via `systemctl --user`. There is no systemd template in the repo yet — this task adds one that reuses the exact same placeholder vocabulary so the renderer stays init-system-agnostic.

**Authoritative facts (confirmed against the codebase):**

- Current plist `ProgramArguments` runs `tsx` via the daemon's local bin: `__REPO_ROOT__/daemon/node_modules/.bin/tsx __REPO_ROOT__/daemon/index.ts`. `KeepAlive` and `RunAtLoad` are both `true`. The systemd unit must reproduce this run command and restart-on-exit behavior.
- The three placeholders and their intended resolved values:
  - `__REPO_ROOT__` — absolute path to the cloned repo (already used in the plist).
  - `__LOG_PATH__` — absolute path to the daemon log file (e.g. `$CONDUCTOR_HOME/.local/share/tmux-conductor/daemon.log` or equivalent under the install home).
  - `__NODE_PATH__` — absolute path to the **directory** containing the active `node` binary (the nvm/Homebrew node `bin` dir), prepended to PATH.
- The renderer (TASK-020) owns choosing concrete values for these tokens; this task only guarantees the tokens are present and consistent across both files.

## Steps

### 1. Replace the hardcoded log paths in the plist with `__LOG_PATH__`

- [x] In `com.tmux-conductor.daemon.plist`, change the `StandardOutPath` `<string>` (line ~19) from `/Users/davidtaylor/.local/share/tmux-conductor/daemon.log` to `__LOG_PATH__`.
- [x] Change the `StandardErrorPath` `<string>` (line ~21) from the same literal to `__LOG_PATH__`.
- [x] Confirm both keys now point at the identical `__LOG_PATH__` token (stdout and stderr intentionally share one log file, preserving current behavior). <!-- Completed: 2026-06-12 -->

### 2. Prepend `__NODE_PATH__` to the plist PATH

- [x] In the `EnvironmentVariables` → `PATH` `<string>` (line ~25), change `/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin` to `__NODE_PATH__:/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin`.
- [x] Rationale to preserve in the value ordering: `__NODE_PATH__` must come **first** so the renderer-resolved nvm/Homebrew node bin dir wins over any system node, fixing the launchd crash-loop.
- [x] Leave `__REPO_ROOT__`, `Label`, `RunAtLoad`, `KeepAlive`, and the `ProgramArguments` array exactly as-is — no other plist edits in scope. <!-- Completed: 2026-06-12 -->

### 3. Create the systemd user-unit template `daemon/tmux-conductor-daemon.service.in`

- [x] Create the new file at `daemon/tmux-conductor-daemon.service.in` (a systemd **user** unit; `.in` suffix signals it is a pre-render template).
- [x] `[Unit]` section: a `Description=` (e.g. `tmux-conductor daemon`) and `After=network.target`.
- [x] `[Service]` section, reusing the **same** three placeholders as the plist:
  - `WorkingDirectory=__REPO_ROOT__`
  - `ExecStart=__REPO_ROOT__/daemon/node_modules/.bin/tsx __REPO_ROOT__/daemon/index.ts` (mirrors the plist `ProgramArguments` exactly — runs `tsx daemon/index.ts`).
  - `Environment=PATH=__NODE_PATH__:/usr/local/bin:/usr/bin:/bin` (prepend `__NODE_PATH__` for the same nvm-invisibility reason; Homebrew's `/opt/homebrew/bin` is macOS-only and may be omitted on Linux).
  - `StandardOutput` / `StandardError` directed to `__LOG_PATH__` using systemd's `append:__LOG_PATH__` form so stdout and stderr share the one log file (matching the plist).
  - `Restart=always` and a sane `RestartSec=` (e.g. `2`) — the systemd analogue of launchd `KeepAlive=true`.
- [x] `[Install]` section: `WantedBy=default.target` so `systemctl --user enable --now` activates it at user login.
- [x] Add a short header comment in the file noting it is a template rendered by the installer and that lingering (`loginctl enable-linger <user>`) is required for the unit to run without an active login session — but the install flow (TASK-020), not this file, performs that step. <!-- Completed: 2026-06-12 -->

### 4. Cross-file consistency check

- [x] Verify the **exact same three tokens** (`__REPO_ROOT__`, `__LOG_PATH__`, `__NODE_PATH__`) appear in both `com.tmux-conductor.daemon.plist` and `daemon/tmux-conductor-daemon.service.in`, spelled identically, so a single substitution map renders both.
- [x] Verify no machine-specific absolute path (no `/Users/davidtaylor`, no concrete nvm/node version path) remains in either file. <!-- Completed: 2026-06-12 -->

### 5. Static validation

- [x] Validate the plist is well-formed XML after the edits — `plutil -lint com.tmux-conductor.daemon.plist` (macOS) should report `OK`. (The unresolved `__…__` tokens are valid string contents; lint only checks XML structure.) <!-- Completed: 2026-06-12: plutil reports OK -->
- [x] Eyeball the `.service.in` for systemd unit-file syntax: section headers in square brackets, `Key=Value` lines, no trailing logic. (Full `systemd-analyze verify` requires resolved paths + a Linux host and is deferred to UAT/TASK-020.) <!-- Completed: 2026-06-12 -->

## Acceptance Criteria

- `com.tmux-conductor.daemon.plist` contains **no** hardcoded `/Users/davidtaylor` path and **no** fixed-only PATH: `StandardOutPath` and `StandardErrorPath` are both `__LOG_PATH__`, and `PATH` begins with `__NODE_PATH__:` followed by the original four system dirs.
- A new file `daemon/tmux-conductor-daemon.service.in` exists as a systemd user unit that runs `tsx daemon/index.ts` from `WorkingDirectory=__REPO_ROOT__`, has `Restart=always`, sends stdout+stderr to `__LOG_PATH__`, prepends `__NODE_PATH__` to PATH, and is enablable via `systemctl --user enable --now` (with `WantedBy=default.target`).
- Both files use the identical placeholder set `{__REPO_ROOT__, __LOG_PATH__, __NODE_PATH__}` and contain no other unresolved or machine-specific values.
- `plutil -lint` reports the plist as valid XML.
- No rendering / substitution code is added in this task (that is TASK-020); only the templates change.

## Dependencies

- **Depends on:** nothing active. The only prerequisite in ROADMAP-002 Phase 1 is "Complete ROADMAP-001 Phase 1 (SQLite foundation)", which is already satisfied (TASK-002/003/004 done 2026-06-12). The plist and the new `.service.in` are standalone template files with no code coupling.
- **Blocks:** **TASK-020** — "Sync `bin/conductor daemon install` to the rendered-template + bootout/bootstrap flow". TASK-020's renderer consumes the `__REPO_ROOT__` / `__LOG_PATH__` / `__NODE_PATH__` tokens defined here for both init systems; it cannot land a correct substitution map until these templates exist and agree on the token vocabulary.
- **Downstream (not blocked, but informed by this):** the install.sh work later in ROADMAP-002 Phase 1 invokes the daemon-service install path and therefore inherits these templates transitively via TASK-020.
