---
topic: "Scoped follow-up to raw/research/shared-dev-commands/ (Phase 4 of ROADMAP-020 only): design the concrete ~/.claude/skills/dev-commands skill + scripts/dev-commands.sh bash script that gives an agent list/status/tail over the existing bg-<name>.log / bg-<name>.state conventions."
slug: shared-dev-commands
researched: 2026-09-13
sources: [./sources-4.md]
---

# Research: Phase 4 (Agent-side skill + script) implementation shape

> Builds on [index.md](index.md); this update covers only what that report left unresolved — the concrete file layout, CLI surface, and installer mechanics for the `~/.claude/skills/dev-commands` skill + script named in ROADMAP-020 Phase 4. No skill in this user's `~/.claude/skills/` currently bundles an executable `scripts/` directory, so there is no local skill-authoring precedent to copy; the closest analogue is `install-hooks.sh`'s repo-root-to-`~/.claude/` copy pattern for hooks. (Note: other `index-N.md`/`sources-N.md` files in this directory cover a different, concurrently-researched slice of the same roadmap — ROADMAP-020 Phase 3 UI/UX — not this topic; this file landed at `-4` after repeated same-session filename collisions with that concurrent research pass.)

## Research Questions
- What is this project's own convention for authoring a Claude Code skill, and what does `install-hooks.sh` do that a skill installer should mirror?
- What CLI surface (env vars, HTTP path, offline fallback) should `list`/`status`/`tail` use?
- Should project scoping (Phase 2/3, not yet built) be a hard dependency for `list`?
- Should the installer be new, or folded into `install-hooks.sh`?
- What testing/verification pattern does this repo use for new `scripts/*.sh`?

## Current State (Codebase)

- **No bundled-script skill precedent locally.** `find ~/.claude/skills -type d -name scripts` returns nothing; every existing skill under `~/.claude/skills/` is a `SKILL.md`-only slash-command skill [S1]. The new skill is a different shape (a *tool* skill Claude reaches for autonomously, not a `/slash-command`), closer to Anthropic's own "system skill" bundling convention already cited in `index.md`'s Key Findings (`SKILL.md` + `scripts/`) [S2].
- **`install-hooks.sh`'s copy mechanics** (repo root, per `architecture/script-integration` Serena memory and direct read): flags `--hook-dir`, `--settings-file`, `--install-dir` (default `$HOME/.claude/hooks/tmux-conductor`); copies `.js` files with `chmod +x`; then does a **separate, hook-specific** step — a single `jq` pass merging entries into `settings.json` by dedup-on-command. That merge step is **not applicable to skills**: Claude Code discovers skills by directory presence under `~/.claude/skills/<name>/SKILL.md` alone, no settings.json registration exists for skills [S3].
- **Env vars guaranteed present in every agent pane**, regardless of workdir: `CONDUCTOR_AGENT_NAME`, `CONDUCTOR_STATE_DIR`, `CONDUCTOR_LOG_DIR` — set in the `env_prefix` string that both `conductor.sh` (`scripts/conductor.sh:65,83`) and `spawn.sh` (`scripts/spawn.sh:56,73`) prepend to every `tmux send-keys` launch. No host-server base URL is exported today [S4].
- **Host-server is always host-native and always on a fixed, well-known port.** `AGENTS.md`/`CLAUDE.md`/`README.md` all state Fastify listens on `127.0.0.1:8788` (env `BACKEND_PORT`), "runs directly on the host — never Dockerized." Container/`EXEC_MODE=container` wrapping (`agent_exec.sh`, `scaffold.sh`) is archived under `scripts/.archive/` and not part of the live system per current `CLAUDE.md` [S5]. So `http://127.0.0.1:${BACKEND_PORT:-8788}` is a safe, always-reachable default for any agent's own script — no new env var plumbing required for the common case, though an override var keeps it working for a nonstandard `BACKEND_PORT`.
- **`GET /api/status` already returns everything `list` needs, unscoped.** `buildBgStatuses()` (`host-server/index.ts:147-163`) maps `conf.bgProcesses` to `BgStatus { name, workdir, launchCmd, windowPresent, state, logPath, statePath, linkedAgent }`, exposed at `bgProcesses: BgStatus[]` on the `/api/status` response (`host-server/index.ts:643,765,806,2404`) [S6]. There is no project-filtered variant yet — Phase 2/3 (project_id + a filtered endpoint) are still open roadmap items, being researched separately and concurrently in this same directory.
- **No existing `scripts/*.sh` uses a `list`/`status`/`tail`-style subcommand dispatch** (`case "$1" in ... esac`) — searched and found none; `dispatch.sh`/`add-task.sh` are single-purpose, positional-arg scripts. The closest reusable idiom is `add-task.sh`'s shape: `#!/usr/bin/env bash`, `set -euo pipefail`, `SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"`, a `Usage:` header comment, argument validation with a non-zero exit and a `Usage:` line on stderr [S7]. Critically, `add-task.sh` sources `scripts/lib/db.sh` — but that dependency is **not portable** to a user-scoped skill script, which must run standalone from an arbitrary agent workdir in an arbitrary project, not from inside this repo's `scripts/` tree.
- **Verification precedent for new/changed `scripts/*.sh`** (`TASK-155`, `TASK-129`): a syntax gate (`bash -n <script>`) run in the task's own `## Steps`, plus explicit `[DEFERRED-TO-UAT]`-tagged manual steps describing the exact commands to run and exact output to check, rather than a new automated harness per script [S8]. No generic bash-test framework (bats, shunit2) is present in the repo.
- **`jq` is already a documented optional dependency** ("Optional: `jq` for JSON config parsing", `CLAUDE.md` Prerequisites) [S9] — safe to use for parsing `/api/status` JSON in the happy path, with a fallback path that doesn't require it (see Recommendation).

## Key Findings

- The env vars a skill script needs (`CONDUCTOR_STATE_DIR`, `CONDUCTOR_LOG_DIR`) are already unconditionally exported to every agent pane today — zero new plumbing needed on the conductor side for `status`/`tail` to work [S4].
- `list` has no project-scoped backend to call yet (Phase 2/3 unbuilt), but the existing unscoped `GET /api/status` `bgProcesses` array already contains the exact fields (`name`, `state`, `windowPresent`, `logPath`, `statePath`) a `list` subcommand needs today — it can ship now against the flat list and adopt project filtering later without a rewrite of its output shape [S6].
- `install-hooks.sh`'s hook-registration (`jq`-merge into `settings.json`) is specific to Claude Code's hook system and has no equivalent requirement for skills, which are auto-discovered by directory presence — folding a skill-copy step into it should reuse its copy/idempotency shape (mkdir -p, cp, chmod +x, safe to re-run) but must not try to route skills through the hook-merge logic [S3].
- No prior `scripts/*.sh` in this repo has ever needed to run *outside* the tmux-conductor repo itself — every existing script assumes `scripts/lib/db.sh` and `conductor.conf` are reachable via `SCRIPT_DIR`. The dev-commands script breaks that assumption by design (it ships inside a skill bundle installed to `~/.claude/skills/`, invoked from arbitrary project directories) and so must be self-contained: env vars + `curl`/`jq` + local file globs only, no `source`-ing anything from this repo.

## Constraints

- Must not require the calling agent's shell to have anything beyond what a bare Claude Code agent pane already has: standard POSIX utilities, `curl` (used elsewhere for host-server calls per the dashboard's own `/api` conventions), and optionally `jq`.
- Must degrade gracefully if the host-server is down or unreachable (the whole point of the "offline fallback" from `index.md`'s Gap 3) — the script cannot hard-fail `list`/`status` just because port 8788 isn't answering.
- Must not duplicate or fork the `bg-<name>.log` / `bg-<name>.state` conventions — read-only consumer of both, per the existing Constraint in `index.md`.
- Filenames matching `bg-<name>.state`/`bg-<name>.log` are a documented convention (`host-server/index.ts` `buildBgStatuses`) — safe to glob directly as a fallback.

## Recommendation

**File layout** (repo root, mirroring where `hooks/` lives today):
```
skills/dev-commands/
  SKILL.md                  # frontmatter + usage guidance for Claude to invoke the script
  scripts/dev-commands.sh   # list / status / tail subcommands
```
Installed by extending `install-hooks.sh` (not a new installer script) with one additional, independent copy step — mkdir -p `~/.claude/skills/dev-commands`, cp the skill directory contents, `chmod +x scripts/dev-commands.sh` — reusing its existing idempotent-copy shape but **skipping its `jq`/`settings.json` merge entirely**, since skills need no registration. A `--skills-dir` flag (default `$HOME/.claude/skills/dev-commands`) mirrors its existing `--install-dir` flag for symmetry and testability.

**CLI surface** (`case "$1" in list|status|tail|*) ... esac`, following `add-task.sh`'s `set -euo pipefail` + `SCRIPT_DIR` + `Usage:`-on-stderr shape, but with no `source scripts/lib/db.sh` — this script is standalone):
- `dev-commands.sh list` — `curl -sf "http://127.0.0.1:${BACKEND_PORT:-8788}/api/status"`, pipe through `jq '.bgProcesses[] | {name, state, windowPresent}'` when `jq` is present; on curl failure or missing `jq`, fall back to globbing `"$CONDUCTOR_STATE_DIR"/bg-*.state` and printing the name (stripped of `bg-`/`.state`) plus raw file contents. No project filter today — ships against the flat list; once Phase 2/3 land a project-filtered endpoint, `list` swaps its URL/query param without changing its output columns.
- `dev-commands.sh status <name>` — print `$CONDUCTOR_STATE_DIR/bg-<name>.state` contents labeled "state file (may lag up to one poll interval)", and separately report the `windowPresent` field from `/api/status` (or, offline, note that the live cross-check is unavailable) — explicitly two labeled signals, matching the codebase's own pattern of never trusting the state file alone (`isTmuxWindowPresent`, `detectAgentStatus`).
- `dev-commands.sh tail <name> [-n N]` — `tail -n "${N:-50}" "$CONDUCTOR_LOG_DIR/bg-<name>.log"`.
- Missing `CONDUCTOR_STATE_DIR`/`CONDUCTOR_LOG_DIR` → clear `FATAL:`-prefixed error (matches `TASK-155`'s established error tone) rather than a raw `No such file or directory`.

**Testing**: no new automated harness — follow the `TASK-155`/`TASK-129` precedent: `bash -n scripts/dev-commands.sh` as a static gate in the task's own Steps, plus `[DEFERRED-TO-UAT]` manual steps exercising `list`/`status`/`tail` against a real running `make dev` + at least one registered bg process (host-server up), and again with the host-server killed (offline fallback path).

**Risks and mitigations**:
- *Drift from Phase 1-3 if they ship first and change the `/api/status` shape or add a project-filtered endpoint*: keep the `jq` filter expression isolated to one line so a later endpoint swap is a one-line change; do not hardcode field order.
- *`jq` absence*: never hard-require it; the glob fallback must work standalone since `jq` is documented as optional, not guaranteed.
- *BACKEND_PORT mismatch*: default to `8788` but always honor `$BACKEND_PORT` if exported, matching every other consumer's convention.

**Alternative if constraints change**: if a future decision makes the skill need to run project-aware from day one (i.e., Phase 2/3 must land first), swap the plan to sequence TASK-156 as blocked on the Phase 1-3 tasks (`depends_on`) instead of shipping unscoped now — not recommended today since no Phase 1-3 task files exist yet to depend on, and the unscoped version is fully forward-compatible.

## Next Steps

- `/task-add Create the ~/.claude/skills/dev-commands skill + scripts/dev-commands.sh (list/status/tail) and fold its install into install-hooks.sh` — being filed now as TASK-156.
- Once Phase 1-3 task files exist, consider linking TASK-156's Notes (not a hard `depends_on`) to the project-scoping task so `list`'s eventual upgrade path is discoverable.
