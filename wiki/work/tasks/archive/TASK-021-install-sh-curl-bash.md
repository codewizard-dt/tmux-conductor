---
id: TASK-021
title: "Write install.sh — bash-3.2-safe, idempotent curl|bash installer"
status: done
created: 2026-06-12
updated: 2026-06-12
depends_on: [TASK-020]
blocks: [TASK-022]
parallel_safe_with: []
uat: "../../uat/UAT-021-install-sh-curl-bash.md"
tags: [installer, bash, daemon, devops, roadmap-002]
---

# TASK-021 — Write install.sh — bash-3.2-safe, idempotent curl|bash installer

## Objective

Create a repo-root `install.sh` designed to be run as `curl … | bash`, which stands up a complete tmux-conductor installation from a clean machine: it checks prerequisites (with actionable remedies), clones or fast-forward-updates the repo into `CONDUCTOR_HOME`, runs the per-package `npm install`s, runs the DB migration, installs the Claude Code hooks, symlinks the `conductor` CLI onto `PATH`, installs and health-checks the daemon background service, and performs an optional machine-pairing step. The whole run must be **idempotent** (safe to re-run with no clobbering or duplication) and **bash-3.2-safe** (it executes under stock macOS `/bin/bash` 3.2, so no `declare -A`, no `mapfile`, no `${var^^}`).

This is ROADMAP-002 Phase 1's installer item (`wiki/work/roadmaps/ROADMAP-002-hosted-portal-oauth-relay-installer.md`, Phase 1, line 26). It is the one-line install entry point the whole hosted-portal onboarding flow depends on.

## Approach

### Authoritative design source

Implementation plan, Workstream E "install.sh": `/Users/davidtaylor/.claude/plans/the-time-has-come-peppy-cupcake.md` (referenced from ROADMAP-002). The section breakdown below is the contract; follow the ordering exactly.

### Hard constraints (verified against the current tree)

- **bash-3.2-safe authoring.** The *installer script itself* runs under whatever shell `bash` resolves to (stock macOS is 3.2). It therefore MUST avoid: associative arrays (`declare -A`), `mapfile`/`readarray`, `${var^^}`/`${var,,}` case-conversion, and `&>>` appends used as the only redirection form is fine but prefer `>>file 2>&1`. Use plain positional iteration and POSIX-ish constructs. NOTE the distinction: the **runtime** scripts under `scripts/` *do* use `declare -A` and require a `PATH` bash ≥4 — so the installer must *check for* a bash ≥4 on `PATH` (and advise `brew install bash` on macOS if absent) while *itself* running fine on 3.2.
- **Truncated-download guard.** Wrap the entire body in a single function and invoke it at the very end:
  ```bash
  main() {
    # … whole installer …
  }
  main "$@"
  ```
  so a partially-downloaded pipe (curl dies mid-stream) never executes a half-script.
- **`set -euo pipefail`** at the top, matching the house style in `bin/conductor`.
- **Logging.** Tee meaningful progress to `~/.local/share/tmux-conductor/install.log` (`mkdir -p` its dir first). Keep stdout human-readable; the log is the full transcript.
- **Temp/scratch (host rule):** any scratch the installer needs on the host goes under the install dir or the XDG data dir — never `/tmp`, `$TMPDIR`, or `mktemp -d`. (The installer's "home" is `~/.local/share/tmux-conductor/`.)
- **No file edits via `sed`/`awk`/`echo >>` to *project* files** — but note this script *is* shell and legitimately uses such tools at runtime; that's fine. The MCP-tools rule about not using `sed`/`awk` applies to *authoring* the markdown/config, not to the shell the script emits.

### Environment grounding (current real state — do NOT assume the plan's numbers blindly)

- **`bin/conductor` already exists** and exposes `daemon install` (currently macOS-plist only) and a `daemon` group (`start|stop|status|install`). It does **not** yet expose a `pair` subcommand — that arrives in ROADMAP-002 Phase 3. The pairing step MUST degrade gracefully when `conductor pair` is absent.
- **Daemon socket + health endpoint are fixed:** `$HOME/.local/share/tmux-conductor/daemon.sock`, health route `GET /healthz` (see `bin/conductor` lines 4, 12). Poll it with `curl -s --unix-socket "$SOCK" http://localhost/healthz`.
- **Node engine floors differ across packages — take the MAX.** `frontend/package.json` declares `node >=22.12.0`; **`backend/package.json` currently declares `node >=26.0.0`** and `daemon/package.json` declares none. The plan text cites 22.12 as the floor, but the installer must enforce the **highest** declared floor it can detect (today that is 26 from backend). Implement: hard-fail under 22.12 (frontend floor, the documented minimum), and additionally **warn** (or fail, see Steps) if Node is below the backend's declared floor. Read the floors from the package.json `engines.node` fields rather than hardcoding, if practical; otherwise hardcode 22.12 as the documented minimum and emit a clear note about the backend's stricter requirement. Record this discrepancy as an inline comment.
- **`db:migrate` / `db:verify` npm scripts are NOT yet present** in `backend/package.json` (ROADMAP-001 Phase 1 delivered the SQLite layer but the migrate/verify script names may live elsewhere or be added later). The installer MUST therefore call them defensively: detect whether `npm run db:migrate` exists (`npm run` listing or `node -e` package.json probe) and **warn-skip** rather than hard-fail if absent. `db:verify` is warn-only by design.
- **`install-hooks.sh` exists at repo root** and requires `jq` — hence `jq` is a hard prereq.
- The daemon-service install is owned by **TASK-020** (plist/systemd template rendering + `daemon install` bootout/bootstrap flow). This installer **calls** `"$INSTALL_DIR/bin/conductor" daemon install` and does NOT re-implement plist/systemd rendering.

### Idempotency contract

Re-running `install.sh` on an already-installed machine must:
- fast-forward-pull (never clone-over, never clobber a dirty tree),
- re-run `npm install` (npm is itself idempotent),
- re-run migrations safely (they must be no-op when already applied — that's ROADMAP-001's responsibility, the installer just invokes),
- re-run `install-hooks.sh` (already dedup-by-command per CLAUDE.md),
- re-create the symlink with `ln -sf` (replace, don't duplicate),
- re-call `daemon install` (TASK-020 owns making that idempotent),
- skip pairing if already paired or if the subcommand is missing.

## Steps

### 1. Scaffold the script skeleton & guards  <!-- agent: general-purpose --> <!-- Completed: 2026-06-12 -->

- [x] Create repo-root `install.sh`, `chmod +x` it.
- [x] Shebang `#!/usr/bin/env bash`, then `set -euo pipefail`.
- [x] Define `main() { … }` wrapping the entire body; final line is `main "$@"` (truncated-download guard).
- [x] At the top of `main`, set up logging: `LOG_DIR="$HOME/.local/share/tmux-conductor"`, `mkdir -p "$LOG_DIR"`, `LOG_FILE="$LOG_DIR/install.log"`. Provide a `log()` helper that appends a timestamped line to `$LOG_FILE` and echoes to stdout. Do NOT use `${var^^}` or `declare -A` anywhere.
- [x] Add a short `die()` helper (`log` an error then `exit 1`).

### 2. Section 1 — Env-overridable settings  <!-- agent: general-purpose --> <!-- Completed: 2026-06-12 -->

- [x] `INSTALL_DIR="${CONDUCTOR_HOME:-$HOME/.tmux-conductor}"`
- [x] `REPO_URL="${CONDUCTOR_REPO_URL:-<canonical git url>}"` (use the repo's own origin URL as the default; allow override). — defaults to `https://github.com/codewizard-dt/tmux-conductor.git` (HTTPS form of origin for unauthenticated clone).
- [x] `BRANCH="${CONDUCTOR_BRANCH:-main}"`
- [x] `CONDUCTOR_PAIRING_CODE="${CONDUCTOR_PAIRING_CODE:-}"` (empty means "prompt at the pairing step").
- [x] `SOCK="${CONDUCTOR_DAEMON_SOCK:-$HOME/.local/share/tmux-conductor/daemon.sock}"` (match `bin/conductor`).

### 3. Section 2 — Prereq checks with remedies  <!-- agent: general-purpose --> <!-- Completed: 2026-06-12 -->

Each check logs PASS/FAIL and, on a hard failure, prints a copy-pasteable remedy then `die`s. Warn-only checks print a remedy and continue.

- [x] **git** (hard): `command -v git` — remedy: install Xcode CLT (`xcode-select --install`) or distro git package.
- [x] **tmux ≥ 3.0** (hard): parse `tmux -V` → strip any trailing letter suffix (e.g. `3.4a` → `3.4`) before numeric compare. Remedy: `brew install tmux` / distro package.
- [x] **node ≥ 22.12** (hard, documented floor): parse `node -v` (`vMAJOR.MINOR.PATCH`). Compare against 22.12.0. **Additionally**: detect the backend's stricter `engines.node` floor (currently `>=26.0.0`) and **warn** if Node is below it (call out that the backend will refuse to run otherwise — leave the warn-vs-hard-fail decision documented inline; default to WARN so the rest of the install still completes). Remedy: install via `nvm`/`fnm` or the Node installer; mention the repo `.nvmrc`.
- [x] **npm** (hard): `command -v npm`. Remedy: ships with Node.
- [x] **PATH bash ≥ 4** (hard — runtime scripts use `declare -A`): inspect the bash on `PATH` (`bash --version` of `command -v bash`, NOT `$BASH_VERSION` which is the 3.2 running us). Remedy on macOS: `brew install bash` and ensure `$(brew --prefix)/bin` precedes `/bin` on `PATH`.
- [x] **jq** (hard — `install-hooks.sh` needs it): `command -v jq`. Remedy: `brew install jq` / distro package.
- [x] **sqlite3** (warn-only): `command -v sqlite3`. Note it's used for CLI inspection; better-sqlite3 bundles its own engine.
- [x] **Xcode CLT / make + g++** (warn-only): probe `command -v make` and a C++ compiler. Note better-sqlite3 has a prebuilt-binary fallback, so this is only needed if a source build is triggered.

### 4. Section 3 — Clone or fast-forward update  <!-- agent: general-purpose --> <!-- Completed: 2026-06-12 -->

- [x] If `INSTALL_DIR` does NOT exist: `git clone --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"`.
- [x] If `INSTALL_DIR` exists and is a git repo: refuse to touch a **dirty** tree — `git -C "$INSTALL_DIR" status --porcelain` non-empty → log a clear "working tree dirty, skipping update; resolve manually" warning and continue (do NOT clobber). If clean: `git -C "$INSTALL_DIR" fetch` then **fast-forward-only** `git -C "$INSTALL_DIR" merge --ff-only "origin/$BRANCH"` (or `git pull --ff-only`). On a non-fast-forward, warn and continue without forcing.
- [x] If `INSTALL_DIR` exists but is NOT a git repo: `die` with a clear message (don't overwrite user data).

### 5. Section 4 — npm installs (backend, frontend, daemon)  <!-- agent: general-purpose --> <!-- Completed: 2026-06-12 -->

- [x] For each of `backend/`, `frontend/`, `daemon/` under `$INSTALL_DIR`: run `npm install` (tee output into `$LOG_FILE`). — exit captured via `${PIPESTATUS[0]}` (bash-3.2-safe).
- [x] After the installs, `grep` the log for node-gyp / node-pre-gyp build failures (better-sqlite3 native build). On a match, print a **targeted remedy**: install Xcode CLT (`xcode-select --install`) or build-essential, then re-run; mention the prebuilt-binary fallback usually avoids this.
- [x] Keep going (warn) on a gyp failure rather than hard-failing the whole installer, but make the remedy prominent.

### 6. Section 5 — Data dir + DB migrate  <!-- agent: general-purpose --> <!-- Completed: 2026-06-12 -->

- [x] `mkdir -p "$INSTALL_DIR/data"` (matches the repo's `data/` dir).
- [x] Probe whether `npm run db:migrate` exists (e.g. `node -e "process.exit(require('./backend/package.json').scripts['db:migrate']?0:1)"` run from `$INSTALL_DIR`, or parse `npm run` output). If present, run it (from the correct workspace — backend/). If absent, **warn-skip** with a note that the migrate script isn't wired yet (ROADMAP-001 surface). — currently absent, so warn-skips by design.
- [x] Run `db:verify` the same way but **warn-only** regardless of outcome.

### 7. Section 6 — Install Claude Code hooks  <!-- agent: general-purpose --> <!-- Completed: 2026-06-12 -->

- [x] Run `"$INSTALL_DIR/install-hooks.sh"` (it's already idempotent / dedup-by-command per CLAUDE.md). Tee to log; on non-zero exit, warn (hooks are not strictly required for a first boot) with the remedy "ensure jq is installed and re-run install-hooks.sh".

### 8. Section 7 — Symlink the conductor CLI onto PATH  <!-- agent: general-purpose --> <!-- Completed: 2026-06-12 -->

- [x] `mkdir -p "$HOME/.local/bin"`.
- [x] `ln -sf "$INSTALL_DIR/bin/conductor" "$HOME/.local/bin/conductor"` (`-sf` makes re-runs idempotent — replace, never duplicate).
- [x] Detect whether `$HOME/.local/bin` is on `PATH`; if not, print a one-line instruction to add it to the user's shell rc (do NOT auto-edit their rc file).

### 9. Section 8 — Daemon service install + health poll  <!-- agent: general-purpose --> <!-- Completed: 2026-06-12 -->

- [x] Call `"$INSTALL_DIR/bin/conductor" daemon install` (TASK-020 owns the plist/systemd rendering + bootout/bootstrap — do NOT re-implement it here).
- [x] Health-poll the daemon: loop up to ~10 tries with a 1s sleep, `curl -s --unix-socket "$SOCK" http://localhost/healthz` until it succeeds. On success, log "daemon healthy". On timeout, **warn** (not die) with the remedy to check `~/.local/share/tmux-conductor/daemon.log` and run `conductor daemon status`.

### 10. Section 9 — Pairing (graceful degrade)  <!-- agent: general-purpose --> <!-- Completed: 2026-06-12 -->

- [x] First check the `pair` subcommand exists: e.g. `"$INSTALL_DIR/bin/conductor" pair --help` or grep the CLI; if the subcommand is **absent** (Phase 3 not yet shipped), log "pairing not available yet — skipping" and continue. This is the key graceful-degrade path. — currently absent, so this path triggers.
- [x] If `CONDUCTOR_PAIRING_CODE` is set, use it directly: `"$INSTALL_DIR/bin/conductor" pair "$CONDUCTOR_PAIRING_CODE"`.
- [x] Else, attempt an interactive prompt — but read from **`/dev/tty`**, NOT stdin (under `curl|bash`, stdin is the script text). Guard with a tty check: `if [ -r /dev/tty ]; then read -r code </dev/tty; … else log "non-interactive, no pairing code — skipping"; fi`.
- [x] On a successful pair, log it; on failure, warn with the remedy to re-run `conductor pair <code>` manually. Never hard-fail the installer on pairing.

### 11. Section 10 — Summary + next steps  <!-- agent: general-purpose --> <!-- Completed: 2026-06-12 -->

- [x] Print a concise success summary: install dir, whether daemon is healthy, whether paired (or how to pair later), the `conductor` command location, and the PATH note if applicable.
- [x] Print next-step commands: `conductor start`, `conductor list`, dashboard URLs (backend :8788, frontend :4321 per CLAUDE.md), and where the log lives.

### 12. Self-test the script (no full machine run required)  <!-- agent: general-purpose --> <!-- Completed: 2026-06-12 -->

- [x] `bash -n install.sh` — syntax check, must pass clean. — PASS under harness bash AND real `/bin/bash 3.2.57`.
- [x] Run `shellcheck install.sh` if available (warn-only) and resolve any genuine bash-3.2-incompatibility findings (associative arrays, `mapfile`, `${var^^}`). — shellcheck not installed on this machine; skipped (warn-only).
- [x] Verify under bash 3.2 semantics: confirm no `declare -A`, no `mapfile`/`readarray`, no `${var^^}`/`${var,,}` appear in the script (grep the file). — zero functional occurrences (only inside the doc comment block).
- [x] Confirm the body is fully enclosed by `main() { … }` and the only top-level executable line after the function is `main "$@"` (line 476).
- [x] Do a dry-conceptual idempotency pass: re-running must hit `ln -sf` (replace), `git … --ff-only` (no clobber), warn-skip on dirty tree, and skip pairing when already paired / subcommand missing.

## Dependencies

- **DEPENDS ON [TASK-020]** — the daemon-service install hardening (parameterized plist + systemd user-unit template + `bin/conductor daemon install` bootout/bootstrap flow). This installer *calls* `bin/conductor daemon install` and must not re-implement the rendering; it relies on TASK-020 making that subcommand idempotent and cross-platform. (TASK-020 is the ROADMAP-002 Phase 1 items at lines 24–25; create it before/alongside this task.)
- **DEPENDS ON ROADMAP-001 Phase 1** — the SQLite data layer / `db:migrate` surface (TASK-002/003/004, complete 2026-06-12). The installer invokes `db:migrate`/`db:verify`; until those npm scripts are wired the installer warn-skips them.
- **BLOCKS [TASK-022]** — end-to-end installer verification into a scratch `CONDUCTOR_HOME` on macOS (ROADMAP-002 Phase 1, line 27). That task cannot run until this script exists.

### Roadmap

Implements ROADMAP-002 Phase 1, item "Write install.sh (…)" — `wiki/work/roadmaps/ROADMAP-002-hosted-portal-oauth-relay-installer.md` (line 26). Per instruction, this task file does not flip the roadmap checkbox; the roadmap reference is recorded here for traceability only.
