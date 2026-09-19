---
topic: "How do we fix issue #1? (scripts/monitor.sh needs Bash ≥4.2 on PATH — macOS's built-in /bin/bash is 3.2 and can't parse `declare -gA`, which TASK-144 added)"
slug: bash-version-guard
researched: 2026-09-13
sources: [./sources.md]
---

# Research: Fixing the Bash-version fragility in the conductor shell scripts

> The conductor's bash entry-point scripts (`monitor.sh`, `conductor.sh`, `spawn.sh`, `teardown.sh`, `add-task.sh`, `broadcast.sh`) all depend on Bash ≥4.2 (`declare -gA` associative arrays) but have **zero runtime self-check** — they rely entirely on `#!/usr/bin/env bash` resolving to a modern Homebrew bash at every future invocation, forever. When that assumption breaks (an explicit `/bin/bash` invocation, a stale `PATH` in a cron/launchd/CI context, a fresh macOS user who hasn't yet run `install.sh`), the failure is `scripts/lib/db.sh`'s bare `declare: -g: invalid option` — cryptic, unattributed, and silent about the real cause. The fix is a single `BASH_VERSINFO[0]` guard added once at the top of `scripts/lib/db.sh` (sourced by every affected script), using the exact install.sh-established message style already proven and UAT-accepted (TASK-021/UAT-021) elsewhere in this repo. This is a ~6-line, zero-risk, zero-dependency change.

## Research Questions
- What exactly breaks, and which bash version threshold is actually required?
- Which scripts are exposed to this failure, and is `monitor.sh` the only one?
- Does this codebase already have a precedent for guarding against this? Is it complete?
- What is the idiomatic, portable way to self-check a script's own bash version from inside a script that might be running under an old bash?
- Where is the single best insertion point that fixes every exposed script at once, without duplicating the check?

## Current State (Codebase)

- **Root cause, confirmed live**: `scripts/lib/db.sh`'s `load_agents()`/`load_bg()` (and `scripts/monitor.sh`'s own top-level code, added by TASK-144) use `declare -gA <name>` — the `-g` (global) flag for `declare` requires Bash **4.2+**. Running any of these scripts under macOS's built-in `/bin/bash` (3.2.57, unchanged since 2007 for licensing reasons) fails immediately: `declare: -g: invalid option`. Reproduced directly this session while building `UAT-128`'s scratch test harness [S1].
- **Every entry-point script that sources `scripts/lib/db.sh` is equally exposed**, not just `monitor.sh`: `scripts/conductor.sh`, `scripts/spawn.sh`, `scripts/teardown.sh`, `scripts/add-task.sh`, `scripts/broadcast.sh`, plus the verification scripts `scripts/verify-sqlite-migration.sh` and `scripts/verify-task-pop-soft-flip.sh` (the latter two `source lib/db.sh` from inline `bash -c` subshells) [S2]. `scripts/lib/db.sh` itself is the single common dependency across all of them — its own `declare -gA` calls live inside `load_agents()`/`load_bg()`, which every one of those scripts calls.
- **`monitor.sh` additionally declares its own top-level `declare -gA PREV_TRANSITION_STATE`** (TASK-144, `scripts/monitor.sh:38`) — but this runs *after* `scripts/monitor.sh` already sources `scripts/lib/db.sh` (line ~10), so a guard placed at the top of `db.sh` fires first and would catch this case too, before `monitor.sh`'s own bash4-only line is ever reached [S1].
- **A precedent for exactly this class of guard already exists and is UAT-accepted**, but only in `install.sh`, and only as a one-time preflight, not a runtime self-check baked into the scripts themselves:
  ```bash
  # install.sh:196-218 — inspects the PATH bash (not $BASH_VERSION), because
  # install.sh itself is deliberately authored to run under stock bash 3.2.
  path_bash="$(command -v bash 2>/dev/null || echo '')"
  bash_line="$("$path_bash" --version 2>/dev/null | head -n 1)"
  bash_ver="${bash_line#*version }"; bash_ver="${bash_ver%% *}"
  bash_major="${bash_ver%%.*}"
  case "$bash_major" in '' | *[!0-9]*) bash_major=0 ;; esac
  if [ "$bash_major" -ge 4 ]; then
    log "PASS: PATH bash $bash_ver (>= 4) at $path_bash"
  else
    log "FAIL: PATH bash $bash_ver (< 4) at $path_bash"
    if [ "$OS_NAME" = "Darwin" ]; then
      echo "  Remedy: brew install bash, then ensure \$(brew --prefix)/bin precedes /bin on PATH." >&2
    else
      echo "  Remedy: install bash >= 4 via your distro package manager and put it first on PATH." >&2
    fi
    die "the runtime scripts require bash >= 4 on PATH"
  fi
  ```
  This check runs once, at install time. It says nothing about whether PATH is still correct weeks or months later when `monitor.sh` is actually launched (a new terminal profile, a cron/launchd job with a minimal PATH, or — as happened live this session — a human or an agent typing `/bin/bash scripts/monitor.sh` out of habit). `install.sh`'s own header comment is explicit about this split: "The SCRIPT ITSELF is authored to run under stock macOS bash 3.2 ... The runtime scripts under scripts/ use bash >= 4 features ... and are NOT executed here — we only CHECK that a PATH bash >= 4 exists for them." [S3] That "check once, trust forever" gap is exactly what produced the cryptic failure.
- **The prerequisite is already documented in four places** (`CLAUDE.md`, `AGENTS.md`, `README.md`, and `DEC-0001`'s own acceptance criteria) as "bash >= 4.0 (macOS default is 3.2 — use `brew install bash` or adapt for indexed arrays)" [S4] — the gap isn't missing documentation, it's a missing *enforcement point* at the moment a runtime script actually starts.
- **`scripts/lib/db.sh`'s own top ~30 lines are already bash-3.2-safe** (`set -euo pipefail`, `[[ ]]`, `${VAR:-}`, command substitution — no associative arrays until `load_agents()`/`load_bg()` further down), so a guard can be inserted immediately after `set -euo pipefail` (line 5) with no reordering needed [S1].

## Key Findings

1. This is a **latent, not hypothetical** defect: it was triggered for real, twice, in the same session — once by an explicit `/bin/bash` invocation, and implicitly by the fact that nothing in `monitor.sh`/`conductor.sh`/etc. would catch a stale-PATH scenario before crashing into the same cryptic message [S1].
2. **`install.sh`'s guard pattern is proven and UAT-accepted** (TASK-021/UAT-021 explicitly tests "PATH bash >= 4 check inspects the PATH bash, not `$BASH_VERSION`" as an acceptance criterion) [S5] — but it solves a different sub-problem (install-time preflight of a bash install.sh itself won't run) than what's needed here (a runtime script protecting itself from being invoked under the wrong interpreter).
3. **The idiomatic, portable self-check for a script protecting itself (as opposed to inspecting a different candidate bash) is `${BASH_VERSINFO[0]}`, not parsing `bash --version`.** `BASH_VERSINFO` has existed since Bash 2.0 and is universally recommended across Stack Overflow / Unix&Linux SE / community snippets for exactly this purpose — it works correctly even when the running interpreter *is* the old bash being tested, unlike a `declare -A`/`[[ =~ ]]`-based test which would itself fail under 3.2 [S6, S7, S8].
   ```bash
   if [ -z "${BASH_VERSINFO:-}" ] || [ "${BASH_VERSINFO[0]}" -lt 4 ]; then
     echo "FATAL: this script requires bash >= 4 (found: ${BASH_VERSION:-unknown})." >&2
     echo "  Remedy: brew install bash, then ensure \$(brew --prefix)/bin precedes /bin on PATH." >&2
     exit 1
   fi
   ```
4. **A single insertion point — the top of `scripts/lib/db.sh` — protects every exposed script at once**, because every one of them (`monitor.sh`, `conductor.sh`, `spawn.sh`, `teardown.sh`, `add-task.sh`, `broadcast.sh`, both `verify-*.sh` scripts) sources it before doing anything bash4-specific of their own [S1, S2]. This avoids duplicating the guard seven times and matches this codebase's own stated preference for single shared-library enforcement points (the hooks' `write-state.js` is the same pattern on the Node side, per `CLAUDE.md`'s "Key Design Decisions").
5. **The failure mode without a guard is silent about its own cause**: `declare: -g: invalid option` names neither "bash version" nor "PATH" — a user or agent hitting it has no path back to the documented prerequisite without already knowing to suspect bash version (as this session did, only because it happened to be actively debugging a UAT harness).

## Constraints

- The guard must not itself use any bash ≥4 syntax (no `declare -A`, no `[[ =~ ]]` needed, no `${var^^}`) — `${BASH_VERSINFO[0]}` and `[ ]`/`[[ ]]` numeric comparisons are all bash-3.2-safe, confirmed by the `install.sh` precedent which is itself written to run under 3.2.
- Must not weaken or duplicate the existing `install.sh` preflight — this is a *runtime* self-check inside the already-bash4-committed scripts, not a replacement for the install-time UX.
- Message tone/format should match the existing `install.sh` remedy style (`Remedy: brew install bash, then ensure $(brew --prefix)/bin precedes /bin on PATH.`) for consistency, per `CLAUDE.md`'s convention of BSD/GNU-aware, actionable error messages elsewhere in these scripts (e.g. the `USAGE_CHECK_CMD` `/bin/true` incident documented in `conductor.conf`).
- Scope: this is a small, additive, backwards-compatible change (adds a fast-failing check; changes no existing behavior when bash ≥4 is already correctly resolved, which is every currently-working invocation). Low risk, no new dependencies.

## Recommendation

**Add a `${BASH_VERSINFO[0]} -lt 4` guard once, at the top of `scripts/lib/db.sh`** (immediately after `set -euo pipefail`, before the DB-path-resolution block), using the same "log the failure, print an actionable Remedy line, exit non-zero" shape `install.sh` already established:

```bash
set -euo pipefail

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

**Implementation outline:**
1. Insert the guard in `scripts/lib/db.sh` right after `set -euo pipefail` (line 5).
2. `bash -n` every script that sources it (`monitor.sh`, `conductor.sh`, `spawn.sh`, `teardown.sh`, `add-task.sh`, `broadcast.sh`, `verify-sqlite-migration.sh`, `verify-task-pop-soft-flip.sh`) to confirm no syntax regressions.
3. Manually verify the failure path: `/bin/bash scripts/monitor.sh` should now print the new `FATAL:`/`Remedy:` lines instead of `declare: -g: invalid option`, and exit non-zero before touching any state/lock file.
4. Manually verify the success path is unchanged: `bash scripts/monitor.sh` (PATH-resolved ≥4) starts exactly as before.
5. No other scripts need edits — the shared-library insertion point is sufficient.

**Risks and mitigations:**
- *Risk*: a future script sources something bash4-specific *before* sourcing `db.sh`. *Mitigation*: none needed today (no such script exists), but worth a one-line comment noting the ordering assumption, which the guard's own comment above already states.
- *Risk*: `${BASH_VERSINFO:-}` behaves unexpectedly under a non-bash shell (e.g. `sh scripts/monitor.sh`, `dash`). *Mitigation*: `BASH_VERSINFO` is simply unset under a non-bash shell, so `[ -z "${BASH_VERSINFO:-}" ]` is `true` and the guard fires with the same clear message — this is strictly better than today's behavior (an unrelated syntax error further down).

**Alternative if constraints change**: if this repo ever needs to support a shell with no `BASH_VERSINFO` at all reporting a false failure (extremely unlikely — it's been present since Bash 2.0, per Unix & Linux Stack Exchange), fall back to parsing `bash --version`'s first line the way `install.sh` already does — but that's solving a problem that doesn't currently exist here.

## Next Steps

- `/task-add` a small task: "Add a Bash ≥4 self-check guard to scripts/lib/db.sh" — scoped exactly as the Recommendation above (one file, ~10 lines, `bash -n` + two manual invocations as verification).
- Optional, lower priority: mention the new self-check in `scripts/README.md`'s troubleshooting section, so a future "declare: -g: invalid option" report — if it ever slips through some path that doesn't source `db.sh` first — has a documented next step.
