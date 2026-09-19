---
topic: "How do we fix issue #1? (scripts/monitor.sh needs Bash ≥4.2 on PATH — macOS's built-in /bin/bash is 3.2 and can't parse `declare -gA`, which TASK-144 added)"
slug: bash-version-guard
researched: 2026-09-13
---

# Primary Sources — Fixing the Bash-version fragility in the conductor shell scripts

| ID | Type | Locator | Accessed | What it contributed |
|----|------|---------|----------|---------------------|
| S1 | codebase | `scripts/lib/db.sh` (lines 1-45, `declare -gA` in `load_agents()`/`load_bg()`) + live repro this session (`bash scripts/monitor.sh` under `/bin/bash` → `declare: -g: invalid option`) | 2026-09-13 | Confirmed root cause, exact error text, and that `db.sh`'s pre-`load_agents` code is already bash-3.2-safe (valid guard insertion point) |
| S2 | codebase | `scripts/monitor.sh`, `scripts/conductor.sh`, `scripts/spawn.sh`, `scripts/teardown.sh`, `scripts/add-task.sh`, `scripts/broadcast.sh`, `scripts/verify-sqlite-migration.sh`, `scripts/verify-task-pop-soft-flip.sh` (`source .../lib/db.sh` call sites, via `mcp__serena__search_for_pattern`) | 2026-09-13 | Confirmed every one of these 8 scripts sources `lib/db.sh` and is therefore equally exposed to the same crash |
| S3 | codebase | `install.sh` lines 1-10 (header comment) and 196-218 (PATH-bash version preflight) | 2026-09-13 | The existing, UAT-accepted guard pattern in this repo; confirmed it is install-time-only and does not protect later runtime invocations |
| S4 | codebase | `CLAUDE.md:76`, `AGENTS.md:75`, `README.md:187`, `wiki/work/decisions/archive/DEC-0001-usage-check-hardening.md:151` | 2026-09-13 | Confirmed the bash>=4 prerequisite is already documented in four places — the gap is enforcement, not documentation |
| S5 | codebase | `wiki/work/uat/archive/UAT-021-install-sh-curl-bash.md:111-112` (`UAT-STATIC-008`) | 2026-09-13 | Confirmed `install.sh`'s PATH-bash check (not `$BASH_VERSION`) is an accepted, tested requirement — establishes the "inspect PATH bash" idiom as intentional prior art |
| S6 | web | https://askubuntu.com/questions/916976/check-if-bash-version-is-given-version-number | 2026-09-13 | "BASH_VERSINFO is a readonly array variable ... Since it was introduced with bash 2.0, it is likely supported by all bash versions you will encounter." |
| S7 | web | https://unix.stackexchange.com/questions/573827/how-can-i-detect-bash-4-0 | 2026-09-13 | Documents `BASH_VERSINFO[0]` as the major-version element; confirms `((BASH_VERSINFO[0] >= 4))` as a standard, idiomatic check |
| S8 | web | https://www.commandlinefu.com/commands/view/7962/make-sure-your-script-runs-with-a-minimum-bash-version | 2026-09-13 | Community-standard one-liner guard shape (`if [ -z "${BASH_VERSINFO}" ] ... -lt 4 ... exit 1`), matching the pattern recommended in this report |

## Excerpts

### S3 — install.sh header comment
`install.sh` (repo root)
> Idempotent `curl ... | bash` installer. The SCRIPT ITSELF is authored to run under stock macOS bash 3.2 (no associative arrays, no mapfile/readarray, no ${var^^}/${var,,} case-conversion). The runtime scripts under scripts/ use bash >= 4 features (declare -A) and are NOT executed here — we only CHECK that a PATH bash >= 4 exists for them.

### S3 — install.sh PATH-bash preflight
`install.sh:196-218`
> # PATH bash >= 4 (hard). Inspect the PATH bash, NOT $BASH_VERSION.
> path_bash="$(command -v bash 2>/dev/null || echo '')"
> ...
> die "the runtime scripts require bash >= 4 on PATH"

### S4 — documented prerequisite (identical wording in 3 files)
`CLAUDE.md:76`, `AGENTS.md:75`, `README.md:187`
> bash >= 4.0 (macOS default is 3.2 — use `brew install bash` or adapt for indexed arrays)

### S5 — UAT-021 acceptance criterion
`wiki/work/uat/archive/UAT-021-install-sh-curl-bash.md:111-112`
> ### UAT-STATIC-008: PATH bash >= 4 check inspects the PATH bash, not $BASH_VERSION
> - **Description**: The runtime scripts need bash >= 4 on PATH, but the installer itself runs on 3.2. The check must inspect `command -v bash` via `--version`, NOT the running shell's `$BASH_VERSION`

### S6 — Ask Ubuntu, "Check if Bash version is >= given version number"
https://askubuntu.com/questions/916976/check-if-bash-version-is-given-version-number
> BASH_VERSINFO is a readonly array variable whose members hold version information for this instance of bash. Since it was introduced with bash 2.0, it is likely supported by all bash versions you will encounter.

### S7 — Unix & Linux Stack Exchange, "How can I detect Bash >=4.0?"
https://unix.stackexchange.com/questions/573827/how-can-i-detect-bash-4-0
> BASH_VERSINFO[0] The major version number (the release). ... You can also use ((BASH_VERSINFO[0] >= 4)) if you find it more clear.

### S8 — commandlinefu.com, "Make sure your script runs with a minimum Bash version"
https://www.commandlinefu.com/commands/view/7962/make-sure-your-script-runs-with-a-minimum-bash-version
> if [ -z "${BASH_VERSINFO}" ] || [ -z "${BASH_VERSINFO[0]}" ] || [ ${BASH_VERSINFO[0]} -lt 4 ]; then echo "This script requires Bash version >= 4"; exit 1; fi
