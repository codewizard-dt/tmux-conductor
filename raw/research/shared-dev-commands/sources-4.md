---
topic: "Scoped follow-up to raw/research/shared-dev-commands/ (Phase 4 of ROADMAP-020 only): design the concrete ~/.claude/skills/dev-commands skill + scripts/dev-commands.sh bash script that gives an agent list/status/tail over the existing bg-<name>.log / bg-<name>.state conventions."
slug: shared-dev-commands
researched: 2026-09-13
---

# Primary Sources — Phase 4 (Agent-side skill + script) implementation shape

| ID | Type | Locator | Accessed | What it contributed |
|----|------|---------|----------|---------------------|
| S1 | codebase (host, outside repo) | `~/.claude/skills/*` directory listing + `~/.claude/skills/demo/` | 2026-09-13 | Confirmed no existing skill bundles an executable `scripts/` directory locally; all are `SKILL.md`-only |
| S2 | codebase | `raw/research/shared-dev-commands/index.md` (prior research, Key Findings) | 2026-09-13 | Anthropic's own "system skill pattern" (`SKILL.md` + `scripts/`) already cited as the right shape |
| S3 | codebase (Serena memory) | `architecture/script-integration` memory, `install-hooks.sh` section | 2026-09-13 | `install-hooks.sh`'s copy-then-jq-merge shape; the jq/settings.json merge is hook-specific, not needed for skills |
| S4 | codebase | `scripts/conductor.sh:65,83`, `scripts/spawn.sh:56,73` | 2026-09-13 | `env_prefix="CONDUCTOR_AGENT_NAME='...' CONDUCTOR_STATE_DIR='...' CONDUCTOR_LOG_DIR='...'..."` exported into every agent's launch, unconditionally |
| S5 | codebase | `AGENTS.md:18`, `CLAUDE.md:18`, `README.md:65,222,239-242` | 2026-09-13 | Host-server always native on `127.0.0.1:8788` (env `BACKEND_PORT`), never Dockerized; container/`EXEC_MODE` wrapping is archived |
| S6 | codebase | `host-server/index.ts:136-163,643,765,806,2404` | 2026-09-13 | `BgStatus` interface + `buildBgStatuses()` + `bgProcesses: BgStatus[]` field on the `/api/status` response snapshot |
| S7 | codebase | `scripts/add-task.sh:1-18` | 2026-09-13 | Established single-script conventions: `set -euo pipefail`, `SCRIPT_DIR` via `BASH_SOURCE`, `Usage:` header + stderr usage on bad args |
| S8 | codebase | `wiki/work/tasks/TASK-155-bash-version-guard-scripts-lib-db-sh.md` steps 1-2 | 2026-09-13 | Verification precedent for new/changed `scripts/*.sh`: `bash -n` static gate + `[DEFERRED-TO-UAT]`-tagged manual exercise steps, no bats/shunit2 harness |
| S9 | codebase | `CLAUDE.md` Prerequisites section | 2026-09-13 | "Optional: `jq` for JSON config parsing" — confirms `jq` cannot be a hard dependency |

## Excerpts

### S3 — `architecture/script-integration` Serena memory
(internal memory, not a URL)
> Copies the four per-event `.js` scripts ... into `$INSTALL_DIR` with `chmod +x`, plus `hooks/lib/write-state.js` into `$INSTALL_DIR/lib/`. Then a single jq invocation **merges** (not replaces) hook entries into `settings.json` ... Idempotent (second run is byte-identical). Foreign hook entries are preserved.

### S4 — `scripts/conductor.sh`
`scripts/conductor.sh:65`
> `env_prefix="CONDUCTOR_AGENT_NAME='$window_name' CONDUCTOR_STATE_DIR='$STATE_DIR' CONDUCTOR_LOG_DIR='$LOG_DIR'$_bg_env"`

### S6 — `host-server/index.ts`
`host-server/index.ts:136-145`
> ```
> interface BgStatus {
>   name: string;
>   workdir: string;
>   launchCmd: string;
>   windowPresent: boolean;
>   state: string | null;
>   logPath: string;
>   statePath: string;
>   linkedAgent: string | null;
> }
> ```

### S9 — `CLAUDE.md`
> Optional: `jq` for JSON config parsing
