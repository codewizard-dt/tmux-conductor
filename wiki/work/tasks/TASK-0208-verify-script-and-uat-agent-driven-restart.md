---
id: TASK-0208
aliases: [TASK-0208]
title: "Extend `verify-dev-commands.sh` and write a UAT for an agent-driven restart"
status: in-progress
created: 2026-09-20
updated: 2026-09-20
depends_on: [TASK-0190, TASK-0191, TASK-0192, TASK-0193, TASK-0194, TASK-0195, TASK-0196, TASK-0202, TASK-0203, TASK-0204, TASK-0205, TASK-0206, TASK-0207]
blocks: []
parallel_safe_with: []
uat: ""
tags: [bg-processes, verification, uat, dev-commands, restart, roadmap-0024]
---

# TASK-0208 — Extend `verify-dev-commands.sh` and write a UAT for an agent-driven restart

relates_to::[[ROADMAP-0024]]
relates_to::[[bg-process-agent-access]]
relates_to::[[background-process-registry]]
relates_to::[[shared-dev-commands]]
depends_on::[[TASK-0190]]
depends_on::[[TASK-0191]]
depends_on::[[TASK-0192]]
depends_on::[[TASK-0193]]
depends_on::[[TASK-0194]]
depends_on::[[TASK-0195]]
depends_on::[[TASK-0196]]
depends_on::[[TASK-0202]]
depends_on::[[TASK-0203]]
depends_on::[[TASK-0204]]
depends_on::[[TASK-0205]]
depends_on::[[TASK-0206]]
depends_on::[[TASK-0207]]

> ROADMAP-0024 Phase 4, the closing integration task. Every earlier ROADMAP-0024 task deferred its live check to UAT (`[DEFERRED-TO-UAT]`); this task is where those recipes become one runnable regression script plus one end-to-end UAT, so it must run last, after the backend (`TASK-0190`..`0196`), the skill (`TASK-0202`..`0204`) and the dashboard (`TASK-0205`..`0207`) are all merged.

## Objective

Prove the feature the roadmap set out to deliver: **an agent in a project can list only its project's bg processes, see that one has crashed, read its clean output, and restart it in one safe, audited action, and the dashboard shows and does the same.** Two deliverables: (1) extend `scripts/verify-dev-commands.sh` so the deterministic parts run in one command (and an opt-in `--live` mode runs the restart scenario against an isolated host-server), and (2) write the UAT file that walks the full agent-driven restart end to end, consolidating the deferred recipes from `TASK-0190`..`0207`.

## Approach

- **Current state.** `scripts/verify-dev-commands.sh` covers only the deterministic offline parts of `list`/`status`/`tail` (FATAL guards, offline fallback, `-n` ordering) against an unused port, and its header says the live host-server round trip "is covered by UAT, not here". Sibling scripts: `scripts/verify-dev-commands-skill-frontmatter.sh`, `scripts/verify-dev-commands-install.sh`, `scripts/verify-bg-liveness.sh` (`TASK-0191`, private tmux socket) and `scripts/verify-dev-commands-restart.sh` (`TASK-0203`/`TASK-0204`, Node stub server). Keep that hermetic-by-default contract.
- **Default mode (hermetic, no server needed).** Update the header comment; keep tests 1-9 (fixed up by `TASK-0204`); add a section that runs the sibling verifiers as sub-steps and folds their pass/fail into the summary (`scripts/verify-dev-commands-restart.sh` stub-server cases: response mapping, header forwarding, no retry on 429, project-scoped name resolution; `verify-dev-commands-skill-frontmatter.sh`; `verify-dev-commands-install.sh` extended to assert the installed skill dir contains the `restart` subcommand and the new `SKILL.md` text). Add static assertions on the script text itself that would catch regressions cheaply: `restart` is dispatched, the usage text lists all four subcommands, `SKILL.md` no longer contains the stale `idle/busy/running` vocabulary for bg processes, and `SKILL.md` documents `--all` and the `restart` exit codes. All artifacts under `./tmp/verify-dev-commands/` (gitignored), never `/tmp`.
- **`--live` mode (opt-in, isolated).** `bash scripts/verify-dev-commands.sh --live` stands up a throwaway world that cannot touch the user's real conductor, then runs the scenario the UAT describes, machine-checkable:
  - Isolation: a private `conductor.conf` under `./tmp/verify-dev-commands/live/` (via `CONDUCTOR_CONF`, which `host-server/config.ts` honors) with its own `DB_PATH`, `STATE_DIR`, `LOG_DIR` and a unique `SESSION_NAME`; a private tmux server via `TMUX_TMPDIR=./tmp/verify-dev-commands/live/tmux` (a separate socket directory, so the user's real tmux server is never addressed); `BACKEND_PORT` an unused high port (default `18789`, overridable); host-server started in the background with the repo's `tsx` and killed by a `trap ... EXIT` that also runs `tmux kill-server` against the private socket only.
  - Seed via the real API: two projects (`alpha`, `beta`), one agent in each (a harmless launch command such as `sleep 3600`; the agent's tmux window name is the caller identity), and one bg process named `dev` in each project (per-project name uniqueness, `TASK-0196`) with a launch command that prints a counter.
  - Scenario assertions (each a PASS/FAIL line, same style as the existing tests): `list` from alpha's agent env shows only alpha's `dev`; `list --all` shows both; kill alpha's `dev` process in its window and `status` reports `exited` within a bounded wait; `tail` returns escape-free text; `restart dev` as alpha exits 0, the log gains exactly one `--- restart <ts> ---` marker followed by new output, `status` is `running`, `logs/bg-restarts.jsonl` gains one `outcome: restarted, callerKind: agent` line naming alpha's agent; an immediate second `restart dev` exits 5 (cooldown), adds a `cooldown` audit line and **no** second marker; alpha's agent restarting beta's process by slug exits 3, adds a `denied` audit line and no marker; a request with an unknown `X-Conductor-Agent` value returns 403; a header-less `curl -X POST` (dashboard caller) restarts successfully inside the cooldown and is audited `callerKind: dashboard`; a `launchCmd` containing `"`, `$HOME` and a backtick runs literally (quoting fix from `TASK-0190`); `GET /api/status` shows `lastRestart` with the right caller.
  - `--live` skips with a clear message (exit 0, "SKIPPED") when `tmux`, `node` or `jq` is missing, or the chosen port is busy; it never runs by default, so CI and quick local runs stay hermetic. Wall-clock waits are bounded polls (deadline loop, not fixed sleeps), with a named timeout constant.
- **UAT file.** Create `wiki/work/uat/UAT-0208-agent-driven-bg-restart.md` via `/uat-generate TASK-0208` (frontmatter `status: pending`, `task: TASK-0208`, `implements::[[TASK-0208]]`, same layout as `UAT-0192`), requiring at least these cases, and set this task's `uat:` to `[[UAT-0208]]` and its status to `pending-uat` when done. Cases with a runnable command carry a `**Command**` block; UI cases carry Playwright or manual steps:
  1. **Prerequisites/setup**: two projects (`alpha`, `beta`), an agent and a `dev` bg process in each, all created through the dashboard forms/API; `dev-commands` skill installed with `install-skills` (or the installer the repo uses), `jq` present.
  2. **Project-scoped list** (`TASK-0202`): from alpha's agent, `dev-commands.sh list` shows only alpha's `dev`; `--all` shows both with project names; an unresolvable caller falls back to all with the stderr note.
  3. **Crash visible** (`TASK-0191`/`0204`): kill the process inside alpha's `dev` window; `status` reports `exited` (not `running`), and the dashboard badge agrees.
  4. **Clean output** (`TASK-0192`/`0204`): `tail dev -n 30` prints escape-free text with no `\r` artefacts.
  5. **Agent-driven restart** (`TASK-0190`/`0203`): `restart dev` from alpha's agent exits 0; log marker present; process `running` again; the output continues in the same `bg-<slug>.log`.
  6. **Cooldown** (`TASK-0193`): immediate second restart exits 5 with a retry hint, no second marker, `cooldown` audit line.
  7. **Cross-project guard** (`TASK-0194`): alpha's agent cannot restart beta's process (exit 3, `denied` audit line, beta's process untouched); unknown caller header gets 403.
  8. **Audit log** (`TASK-0193`): `logs/bg-restarts.jsonl` has one well-formed JSON line per attempt above with the right `outcome`, `callerKind`, `caller`.
  9. **Quoting safety** (`TASK-0190`): a bg process whose launch command contains `"`, `$HOME` and backticks restarts and runs literally.
  10. **Background tab** (`TASK-0205`): selecting alpha's agent shows a Background tab with only alpha's process, badge, and a live-updating clean tail; an agent with no project shows no such tab; polling stops when switching tabs (network panel).
  11. **Dashboard restart** (`TASK-0206`): Restart on the tab row and on the tile each open a confirmation; Cancel sends nothing; Confirm restarts; the header-less dashboard restart works inside the agent cooldown and is audited `dashboard`.
  12. **Last restart display** (`TASK-0207`): the line reads the agent's window name after case 5 (no reload needed) and "from the dashboard" after case 11, and survives a page reload.
  13. **Cleanup**: delete the throwaway processes/agents/projects and confirm no `alpha`/`beta` windows remain; never touches real processes.
  - Each case gets a **Repeatable Unit Test** or **Verify script** line pointing to the check that covers its deterministic half (`host-server/bgRestart.test.ts`, `bgRestartPolicy.test.ts`, `bgAccess.test.ts`, `state.test.ts`, the frontend component tests, `verify-dev-commands.sh --live`), and a documented gap for anything only a live run can prove.
- **Do not duplicate consumer UATs.** `UAT-0191` and `UAT-0192` already cover liveness and the output endpoint at the API level; this UAT references them and only re-checks their behavior as seen through the skill and the dashboard.
- **Safety.** Every command in the script and UAT operates on throwaway names in isolated state; the UAT says explicitly never to restart the user's real dev processes. `--live` mode must refuse to run if `CONDUCTOR_CONF` is unset or resolves to the repo's real `conductor.conf`, and must refuse a `SESSION_NAME` equal to the real one.

## Steps

### 1. Read inputs  <!-- agent: Explore -->

- [ ] Read the merged results of `TASK-0190`..`0207` (each task's `## Notes`/deferred recipes and `[DEFERRED-TO-UAT]` steps) with Serena, and list every deferred live check; make sure each maps to a UAT case above
- [ ] Read `scripts/verify-dev-commands.sh`, `verify-dev-commands-restart.sh`, `verify-dev-commands-skill-frontmatter.sh`, `verify-dev-commands-install.sh`, `verify-bg-liveness.sh`, and `host-server/config.ts` (`CONDUCTOR_CONF`, `SESSION_NAME`, `DB_PATH`, `STATE_DIR`, `LOG_DIR` sourcing) plus how the host-server starts (root `package.json` scripts, `npx tsx`), how a session is started (`POST /api/session` or `conductor.sh`), and how the API seeds projects/agents/bg processes
- [ ] Check `Makefile`, `package.json` scripts, `.github/workflows/` and `scripts/README.md` for where `verify-dev-commands.sh` is wired (search with Serena `search_for_pattern`) so new sub-verifiers are run where the old one is

### 2. Extend the verify script (hermetic part)  <!-- agent: general-purpose -->

- [ ] Update `scripts/verify-dev-commands.sh`: header comment (subcommands, modes), `--live` flag parsing (unknown flag -> usage, exit 2), a section invoking the sibling verifiers and aggregating their exit codes, and the static text assertions listed in Approach; keep the existing `set -uo pipefail`, `pass`/`fail` helpers and `./tmp/verify-dev-commands/` layout
- [ ] Extend `scripts/verify-dev-commands-install.sh` to assert the installed skill bundle includes the `restart` subcommand and updated `SKILL.md`
- [ ] `bash -n` every touched script; run `bash scripts/verify-dev-commands.sh` (default mode) and confirm it is green and hermetic (no network, no tmux)

### 3. `--live` mode  <!-- agent: general-purpose -->

- [ ] Implement the isolated world and scenario assertions from Approach in `scripts/verify-dev-commands.sh` (or, if it grows past a comfortable size, `scripts/lib/verify-dev-commands-live.sh` sourced only in `--live`), including the safety refusals, the `trap` cleanup, bounded waits and the SKIPPED path
- [ ] Run `bash scripts/verify-dev-commands.sh --live` once against the merged code; fix flakiness (deadline polling, not sleeps); confirm afterwards `tmux ls` on the user's real server is unchanged and no stray `verify`/`alpha`/`beta` windows or host-server process remains (`pgrep`), and that nothing outside `./tmp/verify-dev-commands/` was written
- [ ] If any assertion reveals a defect in an earlier task's code, do not patch it here: record it via `/bug-file` (or a note in the earlier task) and mark the assertion `[KNOWN-FAILING: BUG-NNNN]` only with the user's agreement; otherwise the check must pass

### 4. Write the UAT  <!-- agent: general-purpose -->

- [ ] Run `/uat-generate TASK-0208` seeded with the case list above; confirm the file is `wiki/work/uat/UAT-0208-agent-driven-bg-restart.md`, uses the `UAT-0192` layout, every case has Steps/Command/Expected Result and the safety note, and that each earlier task's deferred recipe is covered (cross-reference the task numbers in the case titles)
- [ ] Reference `UAT-0191`/`UAT-0192` instead of repeating their API cases

### 5. Docs and index  <!-- agent: general-purpose -->

- [ ] Update `scripts/README.md` (verify scripts section: default vs `--live`, isolation guarantees, how to run) and `wiki/knowledge/concepts/background-process-registry.md` (verification section: what is automated vs UAT); the family index/log/status flips follow `/uat-generate`
- [ ] Set this task's `uat: "[[UAT-0208]]"` and status `pending-uat` when the script is green and the UAT exists

## Files touched

- Edited: `scripts/verify-dev-commands.sh`, `scripts/verify-dev-commands-install.sh`, `scripts/README.md`, `wiki/knowledge/concepts/background-process-registry.md`
- New: `wiki/work/uat/UAT-0208-agent-driven-bg-restart.md`; possibly `scripts/lib/verify-dev-commands-live.sh`
- Possibly touched read-only for wiring: `Makefile`, `package.json`, CI workflow (only if the verifiers are listed there)
- No `host-server/` or `frontend/` source edits. Collision notes: the verify scripts were also touched by `TASK-0202`, `TASK-0203`, `TASK-0204`; this task runs last, so re-read them before editing.

## Dependencies

- Depends on: everything the feature is made of: `TASK-0190` (restart route), `TASK-0191` (liveness), `TASK-0192` (output endpoint), `TASK-0193` (cooldown + audit), `TASK-0194` (same-project guard), `TASK-0195` (project required), `TASK-0196` (slug identity), `TASK-0202`/`0203`/`0204` (skill), `TASK-0205`/`0206`/`0207` (dashboard).
- Blocks: nothing; it is the last item of ROADMAP-0024 and closes the roadmap once its UAT passes.
- Parallel-safe with: nothing (it verifies the integrated result).
