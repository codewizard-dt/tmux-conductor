---
id: TASK-155
aliases: [TASK-155]
title: "Add a Bash ≥4 self-check guard to scripts/lib/db.sh"
status: done
created: 2026-09-13
updated: 2026-09-13
depends_on: []
blocks: []
parallel_safe_with: []
uat: "[[UAT-155]]"
tags: [scripts, bash, portability, hardening]
---

# TASK-155 — Add a Bash ≥4 self-check guard to scripts/lib/db.sh

## Objective

Every `scripts/*.sh` entry point (`monitor.sh`, `conductor.sh`, `spawn.sh`, `teardown.sh`, `add-task.sh`, `broadcast.sh`, plus `verify-sqlite-migration.sh` and `verify-task-pop-soft-flip.sh`) sources `scripts/lib/db.sh`, whose `load_agents()`/`load_bg()` use `declare -gA` — a Bash ≥4.2 feature. None of these scripts have a runtime self-check for this: `install.sh` only verifies a PATH bash ≥4 exists once, at install time (`install.sh:196-218`), and nothing re-checks it at the moment a runtime script actually starts. When the assumption breaks — an explicit `/bin/bash` invocation, a stale `PATH` in a cron/launchd/CI context, or a fresh macOS box before `brew install bash` has put a modern bash first on `PATH` — the failure is bash's own bare `declare: -g: invalid option`, which names neither "bash version" nor "PATH" and gives no path back to the documented fix. This was reproduced live while building `UAT-128`'s scratch test harness. Add one guard, once, in the single shared library every affected script already sources, and report this machine's own current status as part of the completion report.

Full research and citations: `raw/research/bash-version-guard/index.md` and `wiki/knowledge/sources/bash-version-guard.md` / `wiki/knowledge/concepts/bash-version-portability-guard.md`.

## Approach

Insert a `${BASH_VERSINFO[0]} -lt 4` guard immediately after `set -euo pipefail` in `scripts/lib/db.sh` (before the DB-path-resolution block, which is already bash-3.2-safe) — this is the single insertion point that protects every sourcing script at once, since none of them do anything bash4-specific of their own before sourcing this file (`monitor.sh`'s own `declare -gA PREV_TRANSITION_STATE` at its line 38 runs *after* it sources `db.sh` at line ~10). `BASH_VERSINFO` is the idiomatic self-check (present since Bash 2.0, safe to evaluate even under the old bash being tested), unlike `install.sh`'s `bash --version`-parsing approach, which solves the different problem of inspecting a *different* candidate bash than the one currently running. Message tone should match `install.sh`'s existing "log the failure, print an actionable Remedy line, exit non-zero" shape for consistency.

## Steps

### 1. Add the guard to scripts/lib/db.sh  <!-- agent: general-purpose -->

- [x] In `scripts/lib/db.sh`, insert immediately after `set -euo pipefail` (line 5), before the `LIB_DIR=...`/DB-path-resolution block:
  ```bash
  # Fail fast and clearly when sourced under a bash too old to run load_agents/
  # load_bg below (declare -gA requires bash >= 4.2). Without this, the only
  # symptom is bash's own cryptic "declare: -g: invalid option" with no mention
  # of bash version or PATH — install.sh checks this once at install time
  # (see install.sh's PATH-bash preflight), but nothing re-checks it at the
  # moment a runtime script actually starts, and PATH can silently regress
  # (explicit /bin/bash invocation, a minimal cron/launchd PATH, a pre-install
  # environment). Every scripts/*.sh entry point sources this file before doing
  # anything bash4-specific of its own, so one guard here covers all of them.
  if [ -z "${BASH_VERSINFO:-}" ] || [ "${BASH_VERSINFO[0]}" -lt 4 ]; then
    echo "FATAL: this script requires bash >= 4 (found: ${BASH_VERSION:-unknown})." >&2
    echo "  Remedy: brew install bash, then ensure \$(brew --prefix)/bin precedes /bin on PATH." >&2
    exit 1
  fi
  ```
  - On Linux the remedy differs from `install.sh`'s Darwin-specific text — reuse `install.sh`'s own `$OS_NAME`-branching pattern if `db.sh` already has a way to detect OS, otherwise keep the message OS-neutral (e.g. "install bash >= 4 via your package manager (macOS: brew install bash) and ensure it precedes any older bash on PATH") rather than assuming Darwin unconditionally — check `install.sh`'s exact branch before deciding which shape to copy.
- [x] `bash -n scripts/lib/db.sh` — clean syntax check.
- [x] `bash -n` every script that sources it, to confirm no syntax regressions from the edit rippling through: `scripts/monitor.sh`, `scripts/conductor.sh`, `scripts/spawn.sh`, `scripts/teardown.sh`, `scripts/add-task.sh`, `scripts/broadcast.sh`, `scripts/verify-sqlite-migration.sh`, `scripts/verify-task-pop-soft-flip.sh`.

<!-- Updated: 2026-09-17 -->
<!-- Guard inserted verbatim after set -euo pipefail (line 5), before the LIB_DIR block. install.sh's remedy text branches on a local OS_NAME variable computed inside main() — db.sh has no equivalent OS-detection of its own, and adding one just for this message would be scope creep, so used the task's own OS-neutral fallback phrasing verbatim. bash -n clean on all 9 files (db.sh + the 8 sourcing scripts); none were executed, only syntax-checked, since several (monitor.sh, conductor.sh) would interact with the real live conductor session if run. -->

### 2. Verify and report this machine's status to the user  <!-- agent: general-purpose -->

- [x] Run `command -v bash` and `bash --version | head -1` and record the exact PATH-resolved bash path + version found on this machine.
- [x] In the final report (and in this task file, appended under this step), state plainly whether this machine's current PATH bash already satisfies the new guard (≥4) or not. If it does not, give the exact remedy for this machine's OS (macOS: `brew install bash`, then confirm `$(brew --prefix)/bin` precedes `/bin` on `PATH` in the active shell profile; Linux: install via the distro package manager and confirm ordering) — do not just say "see the error message," give the actual command to run and how to verify it worked (`bash --version` again, `command -v bash` again).

<!-- Updated: 2026-09-17 -->
<!-- `command -v bash` -> /opt/homebrew/bin/bash. `bash --version | head -1` -> GNU bash, version 5.3.9(1)-release (aarch64-apple-darwin25.1.0). This machine's PATH-resolved bash is version 5, which satisfies the new >=4 guard in scripts/lib/db.sh — no remedy needed; Homebrew bash already precedes /bin/bash on PATH. -->

- [x] Manually verify the failure path: invoke `/bin/bash scripts/monitor.sh` (or any sourcing script) from a clean scratch directory and confirm the new `FATAL:`/`Remedy:` lines print instead of the old cryptic `declare: -g: invalid option`, and the script exits non-zero before touching any state/lock file or the real conductor.
- [x] Manually verify the success path is unchanged: invoke via PATH-resolved `bash` (≥4) and confirm the sourcing script starts exactly as it did before this change.

<!-- Updated: 2026-09-17 -->
<!-- Verified live, but by sourcing scripts/lib/db.sh directly (not a full entry-point script like monitor.sh, to avoid any interaction with the real live conductor session this environment is running). Failure path: /bin/bash --version confirmed 3.2.57 (macOS system bash); /bin/bash -c 'source .../db.sh' printed the new "FATAL: this script requires bash >= 4 (found: 3.2.57(1)-release)." + Remedy line and exited 1 — not the old cryptic "declare: -g: invalid option". Success path: a throwaway ./tmp/ scratch wrapper sourcing db.sh under PATH-resolved bash 5.3.9 succeeded (exit 0) and correctly resolved CONDUCTOR_DB to the real conductor.db path (note: the wrapper originally guessed the variable name as DB_PATH, which is wrong — db.sh actually exposes CONDUCTOR_DB; corrected before re-running). Scratch file deleted after. -->


## Notes

No roadmap link — this is infrastructure/hardening discovered during ad-hoc investigation (the same `UAT-128` scratch-harness session that also produced `TASK-128`), matching the precedent set by `TASK-127`/`TASK-128`/`TASK-129`, none of which are tracked on an active roadmap.
