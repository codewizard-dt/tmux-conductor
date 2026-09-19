---
id: bash-version-guard
aliases: [bash-version-guard]
title: "Fixing the Bash-version fragility in the conductor shell scripts"
updated: 2026-09-13
sources:
  - ../../../raw/research/bash-version-guard/index.md
confidence: extracted
tags: [scripts, bash, portability, monitor-sh]
---

# Fixing the Bash-version fragility in the conductor shell scripts

The conductor's bash entry points (`scripts/monitor.sh`, `conductor.sh`, `spawn.sh`, `teardown.sh`, `add-task.sh`, `broadcast.sh`, and both `verify-*.sh` scripts) all depend on Bash ≥4.2 for `declare -gA` associative arrays, but **none of them self-check that dependency at runtime** — they simply trust that `#!/usr/bin/env bash` will keep resolving to a modern Homebrew bash forever. `scripts/lib/db.sh` is the single common thread: every one of those scripts sources it before doing anything bash4-specific of its own, and its `load_agents()`/`load_bg()` (plus `monitor.sh`'s own TASK-144-added `declare -gA PREV_TRANSITION_STATE`) are exactly where the requirement bites. When the assumption breaks — an explicit `/bin/bash` invocation, a stale `PATH` in a cron/launchd/CI context, or simply a fresh macOS box that hasn't had a Homebrew bash put first on `PATH` — the failure surfaces as bash's own bare `declare: -g: invalid option`, which names neither "bash version" nor "PATH" and gives no path back to the fix. This was reproduced live while building `[[UAT-128]]`'s scratch test harness.

**The codebase already has a proven, UAT-accepted guard pattern for this exact class of problem — but only half of it.** `install.sh`'s own preflight (`install.sh:196-218`) inspects the PATH-resolved bash's `--version` output and refuses to proceed below major version 4, with an actionable "brew install bash, then ensure `$(brew --prefix)/bin` precedes `/bin` on PATH" remedy — validated by `UAT-021`'s `UAT-STATIC-008` acceptance criterion. But that check runs once, at install time, and `install.sh`'s own header comment says as much: it deliberately does not execute the bash4-dependent runtime scripts, "we only CHECK that a PATH bash >= 4 exists for them." Nothing re-verifies that at the moment `monitor.sh` (or any sibling script) actually starts, days or months later.

**Recommended fix**: add a small `${BASH_VERSINFO[0]} -lt 4` guard once, at the top of `scripts/lib/db.sh` (right after `set -euo pipefail`, before any bash4-specific code), using the same fail-with-a-remedy shape `install.sh` already established. `BASH_VERSINFO` is the idiomatic, community-standard way to do this (present since Bash 2.0, safe to evaluate even under the old bash being tested — unlike a check that itself needs bash4 syntax). Because every exposed script sources `db.sh` first, this single insertion point protects all of them without duplicating the check seven times — the same "one shared enforcement point" pattern this codebase already uses for the Node-side hooks (`hooks/lib/write-state.js`).

relates_to::[[claude-code-hooks]] (same "one shared library enforces a cross-cutting concern once" pattern, on the Node side)

Full report and primary-source citations: `raw/research/bash-version-guard/index.md` / `sources.md`.
