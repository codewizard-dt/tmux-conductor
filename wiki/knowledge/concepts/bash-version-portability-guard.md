---
id: bash-version-portability-guard
aliases: [bash-version-portability-guard, bash-version-guard-pattern]
title: "Bash-version portability guard (single shared-library check-once pattern)"
updated: 2026-09-13
sources:
  - ../../../raw/research/bash-version-guard/index.md
confidence: extracted
tags: [scripts, bash, portability, conventions]
---

# Bash-version portability guard

This project's shell scripts split into two tiers with different bash-version requirements, per `CLAUDE.md`'s prerequisites: **`install.sh` itself is deliberately authored to run under stock macOS bash 3.2** (no associative arrays, no `mapfile`, no `${var^^}`/`${var,,}` case-conversion), while **every `scripts/*.sh` runtime script requires Bash ≥4.2** (`declare -gA` associative arrays, used throughout `scripts/lib/db.sh` and `scripts/monitor.sh`).

`install.sh` already contains a proven, UAT-accepted preflight (`install.sh:196-218`, validated by `UAT-021`'s `UAT-STATIC-008`) that inspects the PATH-resolved `bash --version` and refuses to proceed if its major version is below 4, with an actionable OS-aware remedy (`brew install bash, then ensure $(brew --prefix)/bin precedes /bin on PATH` on Darwin). **That check is install-time-only** — it verifies the environment is correct *right now*, not that it will still be correct whenever a runtime script (`monitor.sh`, `conductor.sh`, …) is actually launched later. `PATH` can silently regress after install (an explicit `/bin/bash` invocation out of habit, a cron/launchd job with a minimal `PATH`, a different terminal profile) with no warning until a bash4-only construct hits and produces bash's own cryptic, unattributed error (e.g. `declare: -g: invalid option` for `declare -gA` under 3.2).

**The general pattern this project should follow — derived and recommended in `raw/research/bash-version-guard/index.md` — is: put a runtime self-check in the one shared library every affected script already sources, not in each script individually.** For the `scripts/*.sh` family, that shared library is `scripts/lib/db.sh` (sourced by `monitor.sh`, `conductor.sh`, `spawn.sh`, `teardown.sh`, `add-task.sh`, `broadcast.sh`, and the `verify-*.sh` scripts) — a single `${BASH_VERSINFO[0]} -lt 4` guard placed right after `set -euo pipefail` there protects every one of them without duplicating the check. `BASH_VERSINFO` (not `bash --version` parsing) is the correct idiom for a script checking *its own* interpreter, since it's been available since Bash 2.0 and evaluates safely even under the old bash being tested — `install.sh`'s `--version`-parsing approach is specifically for the *different* case of inspecting a candidate bash that isn't the one currently running.

**This is the same "one shared choke point enforces a cross-cutting concern once" shape already used elsewhere in this codebase** — most directly, `hooks/lib/write-state.js` centralizing state-file writes so every Claude Code lifecycle hook (`on-session-start.js`, `on-stop.js`, …) gets consistent behavior from one place rather than five copies. See `[[claude-code-hooks]]`.

relates_to::[[claude-code-hooks]]
