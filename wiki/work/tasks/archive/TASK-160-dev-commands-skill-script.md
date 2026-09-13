---
id: TASK-160
aliases: [TASK-160]
title: "Create the ~/.claude/skills/dev-commands skill + bash script (list/status/tail)"
status: done
created: 2026-09-13
updated: 2026-09-13
depends_on: []
blocks: []
parallel_safe_with: []
uat: "[[UAT-160]]"
tags: [skills, scripts, bg-processes, agent-tooling]
---

# TASK-160 — Create the ~/.claude/skills/dev-commands skill + bash script (list/status/tail)

## Objective

ROADMAP-020 Phase 4 (`wiki/work/roadmaps/ROADMAP-020-shared-dev-commands-implementation.md`): give any agent — not just one specially "linked" agent — a documented, discoverable way to ask "what dev commands are registered, are they running, and what have they printed" without knowing tmux/file-path conventions by heart. `bg_processes` (background dev processes like `npm run dev`/`make dev`) already capture this via a tmux window per process, `pipe-pane` output capture to `$CONDUCTOR_LOG_DIR/bg-<name>.log`, and poll-driven liveness written to `$CONDUCTOR_STATE_DIR/bg-<name>.state` — but every agent other than the one `conductor.conf`'s `AGENT_BG_LINKS` explicitly wires up has no way to learn a process's name or reconstruct these paths. Ship a `~/.claude/skills/dev-commands` skill (a `SKILL.md` Claude reaches for autonomously, not a `/slash-command`) bundling `scripts/dev-commands.sh` with `list`/`status`/`tail` subcommands that wrap the existing conventions read-only — no new registry, no new file formats, no new daemon.

Full research: `raw/research/shared-dev-commands/index.md` (original feature research) and `raw/research/shared-dev-commands/index-4.md` / `sources-4.md` (this task's scoped follow-up on the skill/script/installer shape).

## Approach

- **File layout** — new repo-root directory `skills/dev-commands/{SKILL.md, scripts/dev-commands.sh}`, mirroring where `hooks/` already lives at repo root as the canonical, version-controlled source that gets installed elsewhere.
- **Script must be fully standalone** — unlike every other `scripts/*.sh` in this repo, it ships inside a skill bundle installed to `~/.claude/skills/` and is invoked from an *arbitrary* agent's own project directory, not from inside this repo. It must not `source scripts/lib/db.sh` or assume `conductor.conf` is reachable; only `CONDUCTOR_STATE_DIR`/`CONDUCTOR_LOG_DIR` (already exported into every agent's launch env by `conductor.sh`/`spawn.sh`) plus `curl`/`jq` against the host-server's fixed, always-host-native address (`http://127.0.0.1:${BACKEND_PORT:-8788}`).
- **Subcommands, each degrading gracefully offline:**
  - `list` — `curl -sf "$BASE/api/status"`, extract `.bgProcesses[]` (`{name, state, windowPresent}`) via `jq` when present; if the host-server is unreachable or `jq` is missing, fall back to globbing `"$CONDUCTOR_STATE_DIR"/bg-*.state` and printing each name (stripped of the `bg-`/`.state` wrapper) with its raw file contents. No project filter yet (ROADMAP-020 Phase 2/3, project scoping, is unbuilt) — ship against today's flat, unscoped list; this is forward-compatible, not a blocker (see Notes).
  - `status <name>` — print `$CONDUCTOR_STATE_DIR/bg-<name>.state`'s contents labeled explicitly as "state file (may lag up to one poll interval)", and separately report the live `windowPresent` field from `/api/status` (or note the live cross-check is unavailable when offline) — two labeled signals, never presented as one fact, matching the codebase's existing "don't trust the state file alone" pattern (`isTmuxWindowPresent`/`detectAgentStatus`).
  - `tail <name> [-n N]` — `tail -n "${N:-50}" "$CONDUCTOR_LOG_DIR/bg-<name>.log"`.
  - Missing `CONDUCTOR_STATE_DIR`/`CONDUCTOR_LOG_DIR` env → a clear `FATAL:`-prefixed message (matching `TASK-155`'s established tone), not a raw `No such file or directory`.
- **Installer** — extend `install-hooks.sh` (do not add a new installer script) with one additional, independent copy step: `mkdir -p` a `--skills-dir` target (default `$HOME/.claude/skills/dev-commands`), copy `skills/dev-commands/` into it, `chmod +x` the script. Reuse its existing idempotent-copy shape (safe to re-run, second run byte-identical) but explicitly skip its `jq`/`settings.json` hook-merge logic — skills need no registration; Claude Code discovers them by directory presence alone.
- **`SKILL.md` frontmatter** — follow this repo's own skill convention (`name`, `description`, plus the fields already used by other skills such as `category`/`argument-hint` where applicable), with a description that makes clear this is a tool an agent invokes proactively when it needs to check a registered dev process, not a user-typed `/slash-command`.

## Steps

### 1. Author skills/dev-commands/scripts/dev-commands.sh  <!-- agent: general-purpose -->

- [x] Create `skills/dev-commands/scripts/dev-commands.sh`: `#!/usr/bin/env bash`, `set -euo pipefail`, a `Usage:` header comment, `case "$1" in list|status|tail|*) ... esac` dispatch (no `SCRIPT_DIR`-relative sourcing of anything in this repo — the script must run standalone from any project directory).
- [x] Implement `list`: `curl -sf "http://127.0.0.1:${BACKEND_PORT:-8788}/api/status"` piped through `jq '.bgProcesses[] | {name, state, windowPresent}'` when `jq` is on PATH; on curl failure (non-zero exit) or missing `jq`, fall back to globbing `"$CONDUCTOR_STATE_DIR"/bg-*.state` and printing `<name>: <state file contents>` per match (empty glob → "no bg processes registered" message, not an error).
- [x] Implement `status <name>`: read `"$CONDUCTOR_STATE_DIR/bg-$name.state"` (missing file → clear "no state file for '<name>' — was it ever registered?" message, not a raw cat error), print it labeled as the poll-lagged signal; then attempt the same `/api/status` call as `list` and print that entry's `windowPresent` as the live cross-check, labeled separately, or "live cross-check unavailable (host-server unreachable)" when the curl fails.
- [x] Implement `tail <name> [-n N]`: `tail -n "${N:-50}" "$CONDUCTOR_LOG_DIR/bg-$name.log"` (missing log file → clear message, not a raw error); accept `-n` in either `tail -n 100 <name>` or `tail <name> -n 100` argument order.
- [x] Guard both `CONDUCTOR_STATE_DIR` and `CONDUCTOR_LOG_DIR` being unset/empty at the top of the script with a `FATAL:`-prefixed message and non-zero exit, before any subcommand logic runs.
- [x] `bash -n skills/dev-commands/scripts/dev-commands.sh` — clean syntax check.

### 2. Author skills/dev-commands/SKILL.md  <!-- agent: general-purpose -->

- [x] Write `skills/dev-commands/SKILL.md` with frontmatter matching this repo's own skill convention (check a couple of existing `~/.claude/skills/*/SKILL.md` files for the exact key set/style in use) and a description explaining: what a "bg process" is in this system, when an agent should reach for this skill (checking whether a shared dev server is running, or reading its recent output, before assuming a failure is its own), and the three subcommands with one example invocation each.

### 3. Wire the skill install into install-hooks.sh  <!-- agent: general-purpose -->

- [x] Add a `--skills-dir` flag to `install-hooks.sh` (default `$HOME/.claude/skills/dev-commands`), and a new copy step — independent of the existing hook copy/jq-merge logic — that `mkdir -p`s the target and copies `skills/dev-commands/{SKILL.md,scripts/}` into it, then `chmod +x` on the installed script. Do not route this step through the jq/settings.json merge; skills need no registration there.
- [x] Confirm the step is idempotent (safe to re-run, no duplicate/partial state) and that a failure copying the skill does not abort the existing hook-installation steps (or vice versa) — keep the two concerns independently failing/succeeding, matching the script's existing "foreign entries survive" resilience posture.
- [x] `bash -n install-hooks.sh` — clean syntax check.

### 4. Verify  <!-- agent: general-purpose -->

- [x] Run `./install-hooks.sh` (or with `--skills-dir ./tmp/skills-install-check` to avoid touching the real `~/.claude/skills/` during verification) and confirm `dev-commands.sh` lands at the expected path, executable.
- [DEFERRED-TO-UAT] With `make dev` running and at least one bg process registered (add one via the dashboard or `scripts/conductor.sh`'s existing bg-process loading), run `dev-commands.sh list`, `status <name>`, and `tail <name>` from a separate shell with `CONDUCTOR_STATE_DIR`/`CONDUCTOR_LOG_DIR`/`BACKEND_PORT` exported to match the running session, and confirm each subcommand's output matches the real state/log file contents and the live `/api/status` response.
- [DEFERRED-TO-UAT] Kill the host-server and re-run `list`/`status`, confirming the offline glob fallback activates cleanly (no crash, no misleading "process not running" claim when it's actually the host-server that's unreachable) and that `tail` (which never talks to the host-server) is unaffected.
- [DEFERRED-TO-UAT] Confirm `status <name>` for a name with no state file yet, and `tail <name>` for a name with no log file yet, both produce the clear not-yet-registered message from Step 1 rather than a raw shell error.

<!-- Updated: 2026-09-13 14:40 -->

## Notes

- **No hard dependency on ROADMAP-020 Phase 1-3.** Project scoping (`project_id` on `bg_processes`, a project-filtered listing endpoint, and the dashboard UI grouping) is separate, unstarted work tracked by other Phase items on this same roadmap. This task's `list` subcommand ships against today's flat, unscoped `bgProcesses` array by design — per `raw/research/shared-dev-commands/index-4.md`'s Recommendation, this is forward-compatible: once a project-filtered endpoint exists, `list`'s URL/query param changes without touching its output shape. `depends_on` is intentionally empty; no Phase 1-3 task files exist yet to depend on regardless.
- **The split-brain bug** described in `raw/research/shared-dev-commands/index.md` Gap 1 (dashboard API writes bg-process *definitions* to `conductor.conf`, while the shell scripts read them from SQLite) affects *registering/removing* bg processes, not this task's read-only `list`/`status`/`tail` surface — `GET /api/status`'s `bgProcesses` array is unaffected by which store is authoritative for writes, so this task does not need Phase 1 to land first either.
- **ID note:** this task went through several renumberings (TASK-156, TASK-158, and a first TASK-160 attempt) due to repeated same-session collisions with other concurrently-running agents also filing tasks against this same roadmap's other phases (TASK-156 bg-processes-project-scoping, TASK-157 unrelated, TASK-158 shared-dev-commands-assess-reresearch, TASK-159 bg-processes-sqlite-source-of-truth, plus a transient second TASK-160 claim for the Phase 3 project-selector/grouping task that had itself moved on by the time this file finalized). Confirmed free via a live directory rescan immediately before this write.
