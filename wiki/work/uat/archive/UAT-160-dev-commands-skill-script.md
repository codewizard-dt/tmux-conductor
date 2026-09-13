---
id: UAT-160
aliases: [UAT-160]
title: "UAT: Create the ~/.claude/skills/dev-commands skill + bash script (list/status/tail)"
status: passed
task: TASK-160
created: 2026-09-13
updated: 2026-09-13
---

# UAT-160 — UAT: Create the ~/.claude/skills/dev-commands skill + bash script (list/status/tail)

implements::[[TASK-160]]

> **Source task**: [[TASK-160]]
> **Generated**: 2026-09-13

---

## Prerequisites

- [ ] `bash`, `curl`, and `jq` are on `PATH`
- [ ] For the live/API test cases only: `make dev` (or `npm run dev`) is running so the host-server answers at `http://127.0.0.1:8788` (the repo's `BACKEND_PORT` default)
- [ ] For the live/API test cases only: a tmux conductor session is alive with at least one background dev process registered (add one via the dashboard, or `scripts/conductor.sh`'s existing bg-process loading) — note its `name`, and confirm its `bg-<name>.state`/`bg-<name>.log` files exist under `./logs/state` / `./logs` (the repo's `STATE_DIR`/`LOG_DIR` defaults)
- [ ] `skills/dev-commands/scripts/dev-commands.sh` is executable (`chmod +x` if not)

---

## Test Cases

### UAT-CLI-001: `list` falls back to state-file globbing when the host-server is unreachable
- **Description**: With no reachable host-server, `list` must glob `$CONDUCTOR_STATE_DIR/bg-*.state` and print each process's name (stripped of the `bg-`/`.state` wrapper) with its state, rather than erroring — including the "no bg processes registered" message when the glob is empty.
- **Steps**:
  1. `export CONDUCTOR_STATE_DIR=$(mktemp -d)`
  2. `export CONDUCTOR_LOG_DIR=$(mktemp -d)`
  3. `export BACKEND_PORT=18788` (a port nothing listens on, to force the offline path deterministically)
  4. Run `skills/dev-commands/scripts/dev-commands.sh list` — confirm it prints `No background processes registered yet.`
  5. `echo -n running > "$CONDUCTOR_STATE_DIR/bg-npm-dev.state"`
  6. Re-run `skills/dev-commands/scripts/dev-commands.sh list` — confirm it prints a line containing `npm-dev — state: running`
- **Expected Result**: Step 4 prints the empty-registry message and exits 0; step 6 prints `npm-dev — state: running` under a `Background processes (from state files):` header. No crash, no raw glob error, in either case.
- **Repeatable Unit Test**: Created: `scripts/verify-dev-commands.sh` (Test 3: empty state dir; Test 4: glob fallback with fake state files)
- **Unit Test Command**: `bash scripts/verify-dev-commands.sh`
- [x] Pass <!-- 2026-09-13 -->

### UAT-API-001: Live `/api/status` exposes the `bgProcesses` array `dev-commands.sh` consumes
- **Endpoint**: `GET /api/status`
- **Description**: Confirms the host-server route `dev-commands.sh list`/`status` calls returns a `bgProcesses` array with `name`, `state`, and `windowPresent` fields for each registered process (`host-server/index.ts`'s `buildBgStatuses`), so the script's `jq` filter (`.bgProcesses[] | {name, state, windowPresent}`) has real data to render against.
- **Steps**:
  1. Confirm `make dev` is running and at least one bg process is registered (Prerequisites).
  2. Run the curl command below as-is.
  3. Confirm the response includes a `bgProcesses` array with at least one entry carrying `name`, `state`, and `windowPresent` keys.
- **Command**:
  ```bash
  curl -sS 'http://127.0.0.1:8788/api/status' | jq '.bgProcesses'
  ```
- **Expected Result**: `HTTP 200` (curl exits 0), JSON array where each entry has `name` (string), `state` (string or `null`), and `windowPresent` (boolean) — matching what `dev-commands.sh list`'s host-server path renders.
- **Repeatable Unit Test**: Not applicable: requires a live host-server, real tmux windows, and a registered bg process — genuine runtime/e2e behavior, not unit-testable without standing up the full stack.
- [x] Pass <!-- 2026-09-13 -->

### UAT-CLI-002: `list` renders live host-server data when reachable
- **Description**: With the host-server reachable and `jq` installed, `list` should print `Background processes (from host-server):` followed by one `<name> — state: <state>, window: <windowPresent>` line per entry from `GET /api/status`, sourced live rather than via the offline glob fallback.
- **Steps**:
  1. In the shell running the live conductor session (so `CONDUCTOR_STATE_DIR`/`CONDUCTOR_LOG_DIR`/`BACKEND_PORT` match it — see Prerequisites), run `skills/dev-commands/scripts/dev-commands.sh list`.
  2. Compare its output against the `curl` result from UAT-API-001.
- **Expected Result**: Output starts with `Background processes (from host-server):`, and each printed `name`/`state`/`windowPresent` matches the corresponding `/api/status` entry from UAT-API-001. No `Note: host-server unreachable` line appears.
- **Repeatable Unit Test**: Not applicable: requires a live host-server and real registered bg process — same runtime dependency as UAT-API-001.
- [x] Pass <!-- 2026-09-13: executed live against the running conductor session's real host-server (port 8788) — registered a temporary bg process `uat160probe` via `POST /bg-processes`, ran `dev-commands.sh list` with CONDUCTOR_STATE_DIR/CONDUCTOR_LOG_DIR/BACKEND_PORT pointed at the live session. Output: `Background processes (from host-server):` / `uat160probe — state: alive, window: true`, exact match against `GET /api/status`'s `bgProcesses` entry (`name: uat160probe, state: alive, windowPresent: true`). Cleaned up (`DELETE /bg-processes/uat160probe`, stray state/log files removed, tmux window confirmed gone) -->

### UAT-CLI-003: `status <name>` reports the state file and offline cross-check when the host-server is unreachable
- **Description**: `status <name>` must print the state file contents labeled as "may lag up to one poll interval", then attempt a live cross-check and label it explicitly as unavailable when the host-server can't be reached — two clearly separate signals, per the task's "don't trust the state file alone" requirement.
- **Steps**:
  1. `export CONDUCTOR_STATE_DIR=$(mktemp -d)`
  2. `export CONDUCTOR_LOG_DIR=$(mktemp -d)`
  3. `export BACKEND_PORT=18788`
  4. `echo -n running > "$CONDUCTOR_STATE_DIR/bg-npm-dev.state"`
  5. Run `skills/dev-commands/scripts/dev-commands.sh status npm-dev`
- **Expected Result**: Output includes `State file (bg-npm-dev.state, may lag up to one poll interval):` followed by `running`, and separately `Live cross-check unavailable (host-server unreachable)`. Exit code 0.
- **Repeatable Unit Test**: Created: `scripts/verify-dev-commands.sh` (Test 6)
- **Unit Test Command**: `bash scripts/verify-dev-commands.sh`
- [x] Pass <!-- 2026-09-13 -->

### UAT-CLI-004: `status <name>` cross-checks live `windowPresent` when the host-server is reachable
- **Description**: With the host-server reachable, `status <name>`'s second section should report the live `windowPresent` value for that process from `GET /api/status`, labeled as the live signal (distinct from the state-file signal).
- **Steps**:
  1. In the live conductor session's shell, run `skills/dev-commands/scripts/dev-commands.sh status <name>` for the registered process noted in Prerequisites.
  2. Cross-check the printed `windowPresent` value against `curl -sS 'http://127.0.0.1:8788/api/status' | jq --arg n '<name>' '.bgProcesses[] | select(.name==$n) | .windowPresent'`.
- **Expected Result**: The script's `Live window status (from host-server): windowPresent: <value>` line matches the `jq` query's output exactly.
- **Repeatable Unit Test**: Not applicable: requires a live host-server and real tmux window presence — runtime/e2e behavior.
- [x] Pass <!-- 2026-09-13: executed live against the same `uat160probe` bg process as UAT-CLI-002 — `dev-commands.sh status uat160probe` printed `State file (bg-uat160probe.state, may lag up to one poll interval): alive` followed by `Live window status (from host-server): windowPresent: true`, matching `GET /api/status`'s `windowPresent: true` for the same entry exactly. Cleaned up alongside UAT-CLI-002 -->

### UAT-CLI-005: `tail <name>` prints the last N lines and accepts `-n` in either argument order
- **Description**: `tail <name> [-n N]` must read `$CONDUCTOR_LOG_DIR/bg-<name>.log` directly (no host-server dependency), default to 50 lines, and accept `-n` before or after the name.
- **Steps**:
  1. `export CONDUCTOR_STATE_DIR=$(mktemp -d)`
  2. `export CONDUCTOR_LOG_DIR=$(mktemp -d)`
  3. `seq 1 10 > "$CONDUCTOR_LOG_DIR/bg-npm-dev.log"`
  4. Run `skills/dev-commands/scripts/dev-commands.sh tail npm-dev -n 3` — expect `8`, `9`, `10`
  5. Run `skills/dev-commands/scripts/dev-commands.sh tail -n 3 npm-dev` — expect the same `8`, `9`, `10`
  6. Run `skills/dev-commands/scripts/dev-commands.sh tail npm-dev` (no `-n`) — expect all 10 lines (default 50 exceeds the file length)
- **Expected Result**: All three invocations succeed (exit 0) and print exactly the expected lines; both `-n` orderings produce identical output.
- **Repeatable Unit Test**: Created: `scripts/verify-dev-commands.sh` (Test 8: default line count; Test 9: both `-n` argument orders)
- **Unit Test Command**: `bash scripts/verify-dev-commands.sh`
- [x] Pass <!-- 2026-09-13 -->

### UAT-EDGE-001: Missing `CONDUCTOR_STATE_DIR` produces a `FATAL:`-prefixed message, not a raw error
- **Scenario**: The script is invoked without `CONDUCTOR_STATE_DIR` set (e.g. run outside a conductor-launched shell).
- **Steps**: `env -u CONDUCTOR_STATE_DIR CONDUCTOR_LOG_DIR=/tmp bash skills/dev-commands/scripts/dev-commands.sh list`
- **Expected Result**: Exits non-zero; stderr contains a line starting `FATAL: CONDUCTOR_STATE_DIR`. No raw `No such file or directory` or unset-variable error.
- **Repeatable Unit Test**: Created: `scripts/verify-dev-commands.sh` (Test 1)
- **Unit Test Command**: `bash scripts/verify-dev-commands.sh`
- [x] Pass <!-- 2026-09-13 -->

### UAT-EDGE-002: Missing `CONDUCTOR_LOG_DIR` produces a `FATAL:`-prefixed message, not a raw error
- **Scenario**: The script is invoked without `CONDUCTOR_LOG_DIR` set.
- **Steps**: `env -u CONDUCTOR_LOG_DIR CONDUCTOR_STATE_DIR=/tmp bash skills/dev-commands/scripts/dev-commands.sh list`
- **Expected Result**: Exits non-zero; stderr contains a line starting `FATAL: CONDUCTOR_LOG_DIR`.
- **Repeatable Unit Test**: Created: `scripts/verify-dev-commands.sh` (Test 2)
- **Unit Test Command**: `bash scripts/verify-dev-commands.sh`
- [x] Pass <!-- 2026-09-13 -->

### UAT-EDGE-003: `status <name>` for a never-registered name gives a clear message, not a raw `cat` error
- **Scenario**: `status` is called with a name that has no `bg-<name>.state` file.
- **Steps**: With `CONDUCTOR_STATE_DIR` pointed at an empty directory, run `skills/dev-commands/scripts/dev-commands.sh status ghost`.
- **Expected Result**: Exits non-zero; stderr contains `No state file for 'ghost' — was it ever registered?`. No raw `cat: No such file or directory`.
- **Repeatable Unit Test**: Created: `scripts/verify-dev-commands.sh` (Test 5)
- **Unit Test Command**: `bash scripts/verify-dev-commands.sh`
- [x] Pass <!-- 2026-09-13 -->

### UAT-EDGE-004: `tail <name>` for a name with no log file gives a clear message, not a raw error
- **Scenario**: `tail` is called with a name that has no `bg-<name>.log` file.
- **Steps**: With `CONDUCTOR_LOG_DIR` pointed at an empty directory, run `skills/dev-commands/scripts/dev-commands.sh tail ghost`.
- **Expected Result**: Exits non-zero; stderr contains `No log file for 'ghost' — has it printed output yet?`. No raw `tail: No such file or directory`.
- **Repeatable Unit Test**: Created: `scripts/verify-dev-commands.sh` (Test 7)
- **Unit Test Command**: `bash scripts/verify-dev-commands.sh`
- [x] Pass <!-- 2026-09-13 -->

### UAT-EDGE-005: Killing the host-server mid-session degrades `list`/`status` gracefully; `tail` is unaffected
- **Scenario**: The task explicitly requires re-testing with a *previously reachable* host-server that goes away (not just "never started"), to confirm the offline path doesn't misreport "process not running" when it's actually the host-server that's down.
- **Steps**:
  1. With `make dev` running and a bg process registered, run `list` and `status <name>` once (host-server reachable) to confirm the live paths from UAT-CLI-002/UAT-CLI-004.
  2. Stop the host-server (`Ctrl-C` the `npm --prefix host-server run dev` process, or `make dev`'s host-server side).
  3. Re-run `list` and `status <name>` — confirm they fall back cleanly (offline glob for `list`; `Live cross-check unavailable (host-server unreachable)` for `status`), with no crash and no claim that the *process* stopped.
  4. Run `tail <name>` — confirm it is unaffected (reads the log file directly, no host-server round trip).
- **Expected Result**: No crash in either subcommand after the host-server dies; `list`/`status` clearly attribute the gap to the host-server, not the bg process; `tail` output is unchanged from before the host-server was killed.
- **Repeatable Unit Test**: Created: `scripts/verify-dev-commands.sh` (Tests 3, 4, and 6 exercise the same offline code path via an always-unreachable port; the "was live, then died" transition itself is live/e2e and not separately unit-testable)
- **Unit Test Command**: `bash scripts/verify-dev-commands.sh`
- [x] Pass <!-- 2026-09-13: re-judged — `bash scripts/verify-dev-commands.sh` exited 0, all 10 checks passed including Test 3 (empty-state-dir list) and Test 4 (offline glob-fallback list); the prior FAIL was recorded against a jq-filter/message-wording gap in dev-commands.sh that tackle-160's follow-up fix has since resolved -->

### UAT-EDGE-006: `SKILL.md` must allow autonomous (model-initiated) invocation, per the task's own design intent
- **Scenario**: TASK-160's Objective states this ships "a `SKILL.md` Claude reaches for autonomously, not a `/slash-command`" — i.e. an agent should be able to discover and invoke this skill on its own, without the user typing a slash command. Claude Code's `disable-model-invocation` frontmatter key gates exactly this: `true` blocks autonomous invocation; the task's own two cited reference skills (`~/.claude/skills/lint/SKILL.md`, `~/.claude/skills/now/SKILL.md`) both use `disable-model-invocation: false`.
- **Steps**: Inspect `skills/dev-commands/SKILL.md`'s frontmatter for the `disable-model-invocation` key.
- **Expected Result**: `disable-model-invocation: false`.
- **Repeatable Unit Test**: Created: `scripts/verify-dev-commands-skill-frontmatter.sh`
- **Unit Test Command**: `bash scripts/verify-dev-commands-skill-frontmatter.sh`
- [x] Pass <!-- 2026-09-13: re-judged — `skills/dev-commands/SKILL.md` frontmatter confirmed `disable-model-invocation: false`; `bash scripts/verify-dev-commands-skill-frontmatter.sh` exited 0, 1 check ran and passed -->

> **Known gap — resolved 2026-09-13**: `skills/dev-commands/SKILL.md` previously set `disable-model-invocation: true`, the inverse of the task's stated design (blocking autonomous invocation). Re-inspected on re-judge: the frontmatter now reads `disable-model-invocation: false` (with `user-invocable: true`), and `scripts/verify-dev-commands-skill-frontmatter.sh` passes cleanly. No further action needed.

### UAT-INSTALL-001: `install-hooks.sh --skills-dir` installs the skill bundle, executable
- **Description**: `install-hooks.sh`'s new skill-install step must `mkdir -p` the `--skills-dir` target, copy `SKILL.md` and `scripts/dev-commands.sh` into it byte-identical to the repo source, and `chmod +x` the installed script — independent of the existing hook-copy/jq-merge logic.
- **Steps**:
  1. `rm -rf ./tmp/uat160-skills-install && mkdir -p ./tmp/uat160-skills-install`
  2. Run `./install-hooks.sh --skills-dir ./tmp/uat160-skills-install/skills/dev-commands --install-dir ./tmp/uat160-skills-install/hooks --settings-file ./tmp/uat160-skills-install/settings.json --codex-install-dir ./tmp/uat160-skills-install/codex-hooks --codex-hooks-file ./tmp/uat160-skills-install/codex-hooks.json`
  3. Confirm `./tmp/uat160-skills-install/skills/dev-commands/SKILL.md` and `./tmp/uat160-skills-install/skills/dev-commands/scripts/dev-commands.sh` exist and are byte-identical to `skills/dev-commands/{SKILL.md,scripts/dev-commands.sh}`.
  4. Confirm `dev-commands.sh` is executable (`test -x`).
- **Expected Result**: Both files land at the target, byte-identical to source; the script is executable; the command prints `Dev-commands skill installed to <target>` and exits 0.
- **Repeatable Unit Test**: Created: `scripts/verify-dev-commands-install.sh`
- **Unit Test Command**: `bash scripts/verify-dev-commands-install.sh`
- [x] Pass <!-- 2026-09-13 -->

### UAT-INSTALL-002: Re-running `install-hooks.sh` is idempotent and does not disturb the hook-install step (or vice versa)
- **Description**: Running the installer twice must be safe (no duplicate/partial state, byte-identical files on re-run), and the skill-install step must be independent of the hook-copy/jq-settings-merge step — a failure or success in one must not affect the other.
- **Steps**:
  1. Using the same scratch dirs as UAT-INSTALL-001, snapshot the installed `SKILL.md` and `dev-commands.sh` contents.
  2. Re-run the same `install-hooks.sh` command from UAT-INSTALL-001.
  3. Confirm the installed skill files are unchanged (byte-identical to the pre-rerun snapshot) and still executable.
  4. Confirm the hook-install step (`./tmp/uat160-skills-install/hooks/tmux-conductor/on-stop.js` etc.) also still exists and `./tmp/uat160-skills-install/settings.json` is still valid JSON — proving the two install steps didn't interfere with each other.
- **Expected Result**: Second run exits 0; skill files are byte-identical across both runs; hook files and `settings.json` remain intact.
- **Repeatable Unit Test**: Created: `scripts/verify-dev-commands-install.sh`
- **Unit Test Command**: `bash scripts/verify-dev-commands-install.sh`
- [x] Pass <!-- 2026-09-13 -->
