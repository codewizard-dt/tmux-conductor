---
id: TASK-0208
aliases: [TASK-0208]
title: "Extend `verify-dev-commands.sh` and write a UAT for an agent-driven restart"
status: pending-uat
created: 2026-09-20
updated: 2026-09-20
depends_on: [TASK-0190, TASK-0191, TASK-0192, TASK-0193, TASK-0194, TASK-0195, TASK-0196, TASK-0202, TASK-0203, TASK-0204, TASK-0205, TASK-0206, TASK-0207]
blocks: []
parallel_safe_with: []
uat: "[[UAT-0208]]"
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

- [x] Read the merged results of `TASK-0190`..`0207` (each task's `## Notes`/deferred recipes and `[DEFERRED-TO-UAT]` steps) with Serena, and list every deferred live check; make sure each maps to a UAT case above
- [x] Read `scripts/verify-dev-commands.sh`, `verify-dev-commands-restart.sh`, `verify-dev-commands-skill-frontmatter.sh`, `verify-dev-commands-install.sh`, `verify-bg-liveness.sh`, and `host-server/config.ts` (`CONDUCTOR_CONF`, `SESSION_NAME`, `DB_PATH`, `STATE_DIR`, `LOG_DIR` sourcing) plus how the host-server starts (root `package.json` scripts, `npx tsx`), how a session is started (`POST /api/session` or `conductor.sh`), and how the API seeds projects/agents/bg processes
- [x] Check `Makefile`, `package.json` scripts, `.github/workflows/` and `scripts/README.md` for where `verify-dev-commands.sh` is wired (search with Serena `search_for_pattern`) so new sub-verifiers are run where the old one is

**Findings (for Step 2/3 agents):**
- Deferred checks found: (a) `verify-dev-commands.sh` end-of-file comment — live `list`/`list --all` project-scoping smoke, `whoami` cross-check, unknown-`CONDUCTOR_AGENT_NAME` fallback note (TASK-0202); (b)/(c) `verify-dev-commands-restart.sh` two end-of-file comment blocks (TASK-0203/TASK-0204) — live `restart` success+marker, cooldown exit 5, cross-project exit 3, `bg-restarts.jsonl` growth; kill→`exited` liveness, `restart`→`running`+`last restart: <ts> by <caller>`, tail escape-free with restart marker. All three map into the case list in this file's Approach section. TASK-0195/0197/0198 also have stray `[DEFERRED-TO-UAT]`/verification notes but those tasks are **not** in this task's `depends_on` and are orthogonal (project-route validation, env-var retirement, migration safety) — intentionally out of scope, no new case needed.
- `scripts/verify-dev-commands.sh` (333 lines): hermetic only, `BACKEND_PORT=18788` unused port forces offline paths; tests 1-19 cover FATAL guards, offline list/status/tail fixtures, slug resolution (TASK-0196), `list [--all]` project scoping (TASK-0202, offline only). Ends with the deferred-live comment block (~line 309-321). No CLI flags today.
- `scripts/verify-dev-commands-restart.sh` (672 lines): spins up an inline Node stub HTTP server (ephemeral port via `PORT_FILE`) mocking `/api/status`, `/api/agents/whoami`, `/api/bg-processes/:slug/tail`, `/api/bg-processes/:slug/restart` by canned slug→response mapping (200/403/409/429 w/ and w/o `Retry-After`/`retryAfterS`, 500, 418, 404). Logs every stub request to `requests.jsonl` for exact-count assertions (e.g. "no retry on 429"). Has `skip()`/`SKIPS` counter for missing `node`/`jq`. Two deferred-live comment blocks at the end (~line 631-659), explicitly "owned by TASK-0208's UAT".
- `scripts/verify-dev-commands-skill-frontmatter.sh` (38 lines): trivial frontmatter assertion on `skills/dev-commands/SKILL.md`, unrelated to restart.
- `scripts/verify-dev-commands-install.sh` (113 lines): runs real `install-hooks.sh` twice into scratch dirs, diffs whole files for byte-identity + idempotency. Needs new assertions (not a rewrite) to check the installed bundle contains the `restart` subcommand / updated `SKILL.md` text.
- `scripts/verify-bg-liveness.sh` (183 lines): the only one of the five touching real tmux, via a **private socket** (`tmux -S $SOCK -f /dev/null`, under `./tmp/verify-bg-liveness/`); replicates `is_shell_cmd`/`launch_cmd_name`/`bg_pane_exited` inline rather than sourcing `monitor.sh`. `GRACE_WAIT_S=4` must exceed the host-server's 3s `BG_STARTUP_GRACE_MS`. Its header comment says it is "exercised in UAT (TASK-0191), not in CI" today.
- `host-server/config.ts`: `CONDUCTOR_CONF` env var selects the conf file (`DEFAULT_CONF_PATH` falls back to repo-root `conductor.conf`); `readConductorConf()` caches 5s, shells out via `execSync('bash -c "source <conf> && declare -p ..."')`. `STATE_DIR`/`LOG_DIR`/`DB_PATH` resolve relative to the **conf file's own directory**, not cwd. `SESSION_NAME` has no fallback default (empty string if absent) — a `--live` harness must supply its own scratch conf with a unique `SESSION_NAME` plus `CONDUCTOR_CONF` pointed at it for isolation. `BG_RESTART_COOLDOWN_S` (seconds in conf) → `bgRestartCooldownMs` (ms) is the knob to shrink for fast cooldown tests.
- Host-server start: `host-server/package.json` `"start": "node --import tsx/esm index.ts"` (no-reload) or `"dev": "tsx watch index.ts"`. Port via `PORT`/`BACKEND_PORT` env (default 8788), host `HOST` env (default `127.0.0.1`).
- Session start: `POST /session/start` (`host-server/index.ts:874-905`) — reconnects if a tmux session named `conf.sessionName` already exists, else runs `scripts/conductor.sh` via `spawnSync` with `CONDUCTOR_NO_ATTACH=1` env (keeps it from attaching to a terminal) — the right env for a scripted `--live` harness.
- Seed endpoints: `POST /projects` `{name, workdir, defaultLaunchCmd?}` (`index.ts:2394`); `POST /agents` `{name, workdir, launchCmd?, role?, useWorktree?}`, requires session running + window name free (`index.ts:1080`); `POST /bg-processes` `{name, workdir, launchCmd, projectId}` — `projectId` required (TASK-0195), slug is `<projectName>-<name>` via `bgSlug()`, requires session running (`index.ts:1958`); `GET /agents/whoami` resolves the `x-conductor-agent` header (`BG_CALLER_HEADER`, `host-server/bgRestartPolicy.ts:21`) to a caller descriptor (`index.ts:1949`); `POST /bg-processes/:slug/restart` order of checks is 404→403(same-project)→409(session)→429(cooldown)→500(failure)→200 success, auditing every attempt past 404 to `bg-restarts.jsonl` (`index.ts:2165-2251`); `GET /bg-processes/:slug/tail` at `index.ts:2289`.
- Wiring: **no automated wiring exists today** — no `Makefile` `verify` target, no root `package.json` script runs any `verify-*.sh`, no `.github/workflows/` directory at all (no CI in this repo). `scripts/README.md` only mentions `verify-dev-commands.sh`/`verify-dev-commands-restart.sh` in TASK-0203/0204 prose, not in its scripts table; `verify-dev-commands-skill-frontmatter.sh`, `verify-dev-commands-install.sh`, `verify-bg-liveness.sh` aren't documented there at all. `wiki/knowledge/concepts/background-process-registry.md` and `TASK-0203`'s own file explicitly say TASK-0208 is what wires these into an aggregate run — there is nothing pre-existing to "find and extend" for wiring; Step 2 creates the aggregation inside `verify-dev-commands.sh` itself per this task's Approach (no new Makefile/CI target called for).

<!-- Updated: 2026-10-17 00:00 -->

### 2. Extend the verify script (hermetic part)  <!-- agent: general-purpose -->

- [x] Update `scripts/verify-dev-commands.sh`: header comment (subcommands, modes), `--live` flag parsing (unknown flag -> usage, exit 2), a section invoking the sibling verifiers and aggregating their exit codes, and the static text assertions listed in Approach; keep the existing `set -uo pipefail`, `pass`/`fail` helpers and `./tmp/verify-dev-commands/` layout
- [x] Extend `scripts/verify-dev-commands-install.sh` to assert the installed skill bundle includes the `restart` subcommand and updated `SKILL.md`
- [x] `bash -n` every touched script; run `bash scripts/verify-dev-commands.sh` (default mode) and confirm it is green and hermetic (no network, no tmux)

<!-- Updated: 2026-10-17 01:00 -->

### 3. `--live` mode  <!-- agent: general-purpose -->

- [x] Implement the isolated world and scenario assertions from Approach in `scripts/verify-dev-commands.sh` (or, if it grows past a comfortable size, `scripts/lib/verify-dev-commands-live.sh` sourced only in `--live`), including the safety refusals, the `trap` cleanup, bounded waits and the SKIPPED path
- [x] Run `bash scripts/verify-dev-commands.sh --live` once against the merged code; fix flakiness (deadline polling, not sleeps); confirm afterwards `tmux ls` on the user's real server is unchanged and no stray `verify`/`alpha`/`beta` windows or host-server process remains (`pgrep`), and that nothing outside `./tmp/verify-dev-commands/` was written
- [x] If any assertion reveals a defect in an earlier task's code, do not patch it here: record it via `/bug-file` (or a note in the earlier task) and mark the assertion `[KNOWN-FAILING: BUG-NNNN]` only with the user's agreement; otherwise the check must pass

**Findings:** No defect in any earlier task's code was found — every scenario assertion passed cleanly (no `[KNOWN-FAILING]` markers needed). Implemented as `scripts/lib/verify-dev-commands-live.sh` (grew past a comfortable size for the main script), sourced only from `run_live()` in `scripts/verify-dev-commands.sh` when `--live` is passed. The private world lives entirely under `./tmp/verify-dev-commands/live/` (own `conductor.conf`/`SESSION_NAME=verifydevcmds0208`/`DB_PATH`/`STATE_DIR`/`LOG_DIR`/tmux socket dir, port 18789 default via `VERIFY_LIVE_PORT`), seeded through the real API (`POST /api/projects`, `/api/projects/:id/agents`, `/api/bg-processes`) and exercised through the real `skills/dev-commands/scripts/dev-commands.sh` client plus a few raw `curl` calls for the header-edge cases (unknown caller, header-less dashboard restart). 25 scenario PASS lines cover: project-scoped `list`/`list --all`; a quoting fixture (`"`, `$HOME`, backtick in `launchCmd`) proving TASK-0190's literal-typing fix; kill→`exited` liveness; escape-free `tail`; agent restart (exit 0, exactly one log marker, new output after it, `liveness: running`, one `outcome:restarted` audit line naming the caller, `GET /api/status` lastRestart.caller); immediate cooldown retry (exit 5, no second marker, one `outcome:cooldown` audit line); cross-project restart by slug (exit 3, denied audit, target process untouched); unknown `X-Conductor-Agent` header (403, no marker added); header-less dashboard restart inside the agent cooldown (succeeds, second marker, `callerKind:dashboard` audit line); and a final check that no fixture window leaked onto the operator's real (default-socket) tmux server. One implementation bug was found and fixed during this step (not an earlier-task defect): the first refusal-guard draft `cd`'d into `$LV_DIR/live`, a directory that doesn't exist until later in setup, so it always refused; fixed by resolving `VERIFY_DIR` (which does exist) and appending `/live` as a string. A second fix: `list`/`status`/`tail` all read a server-side cached poll snapshot (`GET /api/status`, refreshed every `STATUS_POLL_MS`), so the scenario now waits (bounded, deadline-loop) for that snapshot to pick up freshly-created bg processes before asserting against it, instead of racing it. Verified 4 consecutive green `--live` runs (no flakiness) plus the default (hermetic) mode staying green (`exit 0`, 36 top-level PASS / 0 FAIL, both sibling verifiers' 149+1 checks also green); `bash -n` clean on both files. Before/after `tmux list-sessions`/`list-windows -a` and `pgrep -fl index.ts` on the real server were byte-identical (session `conductor`, same 10 windows, same 4 real PIDs) across every run, and `./tmp/verify-dev-commands/live/` is fully removed by the `trap`-driven cleanup after each run (confirmed via a post-run directory listing).

### 4. Write the UAT  <!-- agent: general-purpose -->

- [x] Run `/uat-generate TASK-0208` seeded with the case list above; confirm the file is `wiki/work/uat/UAT-0208-agent-driven-bg-restart.md`, uses the `UAT-0192` layout, every case has Steps/Command/Expected Result and the safety note, and that each earlier task's deferred recipe is covered (cross-reference the task numbers in the case titles)
- [x] Reference `UAT-0191`/`UAT-0192` instead of repeating their API cases

<!-- Updated: 2026-10-17 01:30 -->

### 5. Docs and index  <!-- agent: general-purpose -->

- [x] Update `scripts/README.md` (verify scripts section: default vs `--live`, isolation guarantees, how to run) and `wiki/knowledge/concepts/background-process-registry.md` (verification section: what is automated vs UAT); the family index/log/status flips follow `/uat-generate`
- [x] Set this task's `uat: "[[UAT-0208]]"` and status `pending-uat` when the script is green and the UAT exists

## Files touched

- Edited: `scripts/verify-dev-commands.sh`, `scripts/verify-dev-commands-install.sh`, `scripts/README.md`, `wiki/knowledge/concepts/background-process-registry.md`
- New: `wiki/work/uat/UAT-0208-agent-driven-bg-restart.md`; possibly `scripts/lib/verify-dev-commands-live.sh`
- Possibly touched read-only for wiring: `Makefile`, `package.json`, CI workflow (only if the verifiers are listed there)
- No `host-server/` or `frontend/` source edits. Collision notes: the verify scripts were also touched by `TASK-0202`, `TASK-0203`, `TASK-0204`; this task runs last, so re-read them before editing.

## Dependencies

- Depends on: everything the feature is made of: `TASK-0190` (restart route), `TASK-0191` (liveness), `TASK-0192` (output endpoint), `TASK-0193` (cooldown + audit), `TASK-0194` (same-project guard), `TASK-0195` (project required), `TASK-0196` (slug identity), `TASK-0202`/`0203`/`0204` (skill), `TASK-0205`/`0206`/`0207` (dashboard).
- Blocks: nothing; it is the last item of ROADMAP-0024 and closes the roadmap once its UAT passes.
- Parallel-safe with: nothing (it verifies the integrated result).
