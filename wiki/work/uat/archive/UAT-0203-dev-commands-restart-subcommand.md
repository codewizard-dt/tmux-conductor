---
id: UAT-0203
aliases: [UAT-0203]
title: "UAT: Add a `restart` subcommand to the `dev-commands` skill"
status: passed
task: TASK-0203
created: 2026-09-20
updated: 2026-10-17
---

# UAT-0203 — UAT: Add a `restart` subcommand to the `dev-commands` skill

implements::[[TASK-0203]]

> **Source task**: [[TASK-0203]]
> **Generated**: 2026-09-20
>
> **What changed**: `skills/dev-commands/scripts/dev-commands.sh` gained `restart <name>`, a thin client over `POST /api/bg-processes/<slug>/restart` (TASK-0190 route, TASK-0193 cooldown + audit, TASK-0194 same-project guard). New helpers: `api_call <method> <path> [raw]` (`api_get` is now a wrapper), `RESTART_TIMEOUT_S=60`, `urlencode`, `json_field` (jq, else sed), `iso_to_epoch`, `parse_http_response`, `resolve_project_slug` (exact slug, then a bare name within the caller's project via `resolve_caller_project`, then a bare name matching exactly one process machine-wide; ambiguous returns 1) and `cmd_restart`. The script sends `X-Conductor-Agent: $CONDUCTOR_AGENT_NAME` when non-empty, maps the answer to messages and exit codes (`200` -> 0, `403` -> 3, `404` -> 1, `409` -> 4, `429` -> 5, `500` -> 6, other status -> 6, unreachable -> 2, no argument -> 1), never sleeps or retries, and uses no temp files. `SKILL.md` (front matter, "When to use", "Restart a process" with the exit-code table and etiquette, "Offline resilience"), `scripts/README.md`, `wiki/knowledge/concepts/background-process-registry.md` and `wiki/knowledge/sources/shared-dev-commands.md` were updated, and `scripts/verify-dev-commands-restart.sh` (new, stub-server regression script) was added.
>
> **Out of scope**: the server-side restart route, cooldown, audit log and same-project guard (UAT-0190, UAT-0193, UAT-0194); `status`/`tail`/`list` liveness and the clean-text tail (TASK-0204, which also extended `verify-dev-commands-restart.sh` with its own checks, so the script now holds more than the 71 checks TASK-0203 recorded); wiring the verify script into the aggregate run (TASK-0208); the dashboard restart button (TASK-0206). The `[DEFERRED-TO-UAT]` live smoke recipe from TASK-0203 Step 4 lives here (UAT-LIVE-001 .. UAT-LIVE-008), run on a private stack instead of `:8788`.

---

## Prerequisites

**Isolation rules (read first).** Every live case (UAT-API-*, UAT-LIVE-*) runs against a **private stack**: its own tmux server (`TMUX_TMPDIR=tmp/uat-0203/tmux`, session `uat0203`), its own conf, SQLite DB and `LOG_DIR` (`tmp/uat-0203/`), and its own host-server on port **18870**; port **18879** is used only as "a port nothing listens on". Use no other port for the live stack. Never send a request to `:8788` or `:4321`, never touch the live `conductor` tmux session, never restart the real `dev` / `dev-stack` bg processes, and never read or write the real `./data/conductor.db`, `./logs/bg-restarts.jsonl` or `./logs`. Every tmux command is prefixed with `env -u TMUX -u TMUX_PANE TMUX_TMPDIR="$PWD/tmp/uat-0203/tmux"` so it reaches the private server even from inside tmux. No `.env` file is read or written; all scratch files live in `./tmp/uat-0203/` (the unit-backed cases also write `./tmp/verify-dev-commands-restart/` and `./tmp/uat-0203-verify.out`).

**The judge is itself a conductor agent**, so `CONDUCTOR_AGENT_NAME`, `CONDUCTOR_STATE_DIR` and `BACKEND_PORT` are probably set in its shell. Every script invocation in a live case goes through the wrapper `tmp/uat-0203/dc.sh` created below, which unsets or sets `CONDUCTOR_AGENT_NAME` explicitly and always exports `BACKEND_PORT`, `CONDUCTOR_STATE_DIR` and `CONDUCTOR_LOG_DIR` to private values, so an inherited value can neither redirect the script to `:8788` nor change which project it resolves. Never call `dev-commands.sh` directly in a live case.

**Timing design.** The private conf sets `BG_RESTART_COOLDOWN_S=20` (the server default is 30). Cases that depend on the cooldown window are written as ONE shell block so latency between judge steps can never expire or pre-arm it: UAT-LIVE-002 starts with `sleep 21` (any cooldown armed by UAT-LIVE-001 has expired) and then performs its restarts back to back; the other live cases never depend on the cooldown. Run the live cases in the order written: they share one server, one fixture, one audit file and `tmp/uat-0203/out.txt`/`err.txt`. The whole live run takes about 2 minutes, most of it the waits in UAT-LIVE-002.

**Run the unit-backed cases alone.** `scripts/verify-dev-commands-restart.sh` writes to a fixed directory (`tmp/verify-dev-commands-restart/`), so two copies running at the same time (for example another session verifying TASK-0204) corrupt each other's stub server, log and `stderr.txt`; the visible symptom is a handful of spurious `FAIL:` lines whose "got" text is unrelated (such as another subcommand's usage line, or an empty stderr). If a unit-backed case fails, first check that nothing else is running it (`pgrep -fl verify-dev-commands-restart`) and re-run once before judging it failed. Its stub server listens on an ephemeral loopback port chosen by the OS (`127.0.0.1`, port 0), never on `:8788` or `:4321`.

- [ ] Run everything from the repo root `/Users/davidtaylor/Repositories/tmux-conductor`. Tools needed: `tmux` (>= 3.0), `node`, `curl`, `jq`, `lsof`, `bash`. Ports 18870 and 18879 are free (the command below prints nothing):
  ```bash
  lsof -ti tcp:18870 -sTCP:LISTEN; lsof -ti tcp:18879 -sTCP:LISTEN
  ```
- [ ] Only for the live cases: create the scratch dir, the private conf, an (empty) offline state dir used as `CONDUCTOR_STATE_DIR` by the script, and the wrapper:
  ```bash
  rm -rf tmp/uat-0203 && mkdir -p tmp/uat-0203/tmux tmp/uat-0203/data tmp/uat-0203/logs/state tmp/uat-0203/offline-state && printf '%s\n' 'SESSION_NAME="uat0203"' 'DB_PATH="./data/conductor.db"' 'LOG_DIR="./logs"' 'STATE_DIR="./logs/state"' 'POLL_INTERVAL=15' 'STATUS_POLL_MS=500' 'BG_RESTART_COOLDOWN_S=20' > tmp/uat-0203/conductor.conf
  ```
  ```bash
  printf '%s\n' '#!/bin/bash' '# dc.sh <agent-name|-> <port> <dev-commands args...>   ("-" = CONDUCTOR_AGENT_NAME unset)' 'who="$1"; port="$2"; shift 2' 'if [ "$who" = "-" ]; then unset CONDUCTOR_AGENT_NAME; else export CONDUCTOR_AGENT_NAME="$who"; fi' 'export CONDUCTOR_STATE_DIR="$PWD/tmp/uat-0203/offline-state" CONDUCTOR_LOG_DIR="$PWD/tmp/uat-0203/logs" BACKEND_PORT="$port"' '/bin/bash skills/dev-commands/scripts/dev-commands.sh "$@" > tmp/uat-0203/out.txt 2> tmp/uat-0203/err.txt' 'echo "rc=$?"' 'echo "--- stdout"; cat tmp/uat-0203/out.txt' 'echo "--- stderr"; cat tmp/uat-0203/err.txt' > tmp/uat-0203/dc.sh
  ```
- [ ] Start the private tmux server with a keeper window (the session must exist before the host-server starts, or every restart answers 409):
  ```bash
  env -u TMUX -u TMUX_PANE TMUX_TMPDIR="$PWD/tmp/uat-0203/tmux" tmux new-session -d -s uat0203 -n keeper 'sleep 3600'
  ```
- [ ] Start the private host-server from the working tree (background; it must stay up until UAT-API-003). It binds 127.0.0.1:18870 and reads `CONDUCTOR_CONF`, so it never touches `./data/conductor.db` or `./logs`:
  ```bash
  R="$PWD"; cd host-server && env -u TMUX -u TMUX_PANE TMUX_TMPDIR="$R/tmp/uat-0203/tmux" CONDUCTOR_CONF="$R/tmp/uat-0203/conductor.conf" BACKEND_PORT=18870 PORT=18870 nohup node --import tsx/esm index.ts > "$R/tmp/uat-0203/server.log" 2>&1 &
  ```
- [ ] Wait for it to answer and for its startup tmux work to settle (an empty agent list proves it is the private, empty DB; the `monitor` window appearing means startup is done):
  ```bash
  sleep 10 && curl -sS 'http://127.0.0.1:18870/api/agents'
  ```
  ```bash
  env -u TMUX -u TMUX_PANE TMUX_TMPDIR="$PWD/tmp/uat-0203/tmux" tmux list-windows -t uat0203 -F '#W'
  ```
  Expected: `[]`, then `keeper` and `monitor`. If the first does not print `[]`, stop and mark every live case BLOCKED.

Unit-backed, syntax, static-source and doc cases (UAT-UNIT-*, UAT-EDGE-*, UAT-INT-*, UAT-DOC-*) need none of the live stack.

---

## Test Cases

### UAT-UNIT-001: the whole `verify-dev-commands-restart.sh` stub-server suite passes
- **Description**: The script drives the real `dev-commands.sh` against a Node stub HTTP server (`/api/status`, `/api/agents/whoami`, `/api/bg-processes/<slug>/tail` and the restart route, with the status chosen by the slug) and asserts exit codes, messages, the forwarded header, exactly-one-request on 429, project-scoped bare-name resolution, the ambiguous-name exit, the no-`jq` path, the no-argument usage and the unreachable port. TASK-0203 recorded 71 checks; TASK-0204 later added its online `status`/`tail`/`list` checks to the same file (149 at the time this UAT was written), so the requirement is "no failures", not a fixed count.
- **Steps**:
  1. Make sure nothing else is running this script (see "Run the unit-backed cases alone" in the Prerequisites).
  2. Run the command below from the repo root.
- **Command**:
  ```bash
  mkdir -p tmp && bash scripts/verify-dev-commands-restart.sh > tmp/uat-0203-verify.out 2>&1; echo "rc=$?"; tail -n 1 tmp/uat-0203-verify.out; echo "pass=$(grep -c 'PASS:' tmp/uat-0203-verify.out) fail=$(grep -c 'FAIL:' tmp/uat-0203-verify.out) skip=$(grep -c 'SKIP:' tmp/uat-0203-verify.out)"
  ```
- **Expected Result**: `rc=0`; the last line is `[verify-dev-commands-restart] PASS — N check(s) passed, 0 skipped` with `N` at least 71; the counter line prints `pass=N fail=0 skip=0` with `pass` at least 71 (it prints 149 at the time of writing; `skip=0` because `node` and `jq` are installed, a `SKIP:` line means a prerequisite is missing, not a pass). Any `FAIL:` line fails the case (after the re-run described above).
- **Repeatable Unit Test**: Created: `scripts/verify-dev-commands-restart.sh` (added by TASK-0203 Step 4; a shell verification script with its own stub server, the repo's runner for this skill; this UAT run writes no new test file)
- **Unit Test Command**: `bash scripts/verify-dev-commands-restart.sh`
- [x] Pass <!-- 2026-10-17 -->

### UAT-EDGE-001: every HTTP status maps to the documented exit code and message
- **Scenario**: `200` -> exit 0 with `Restarted <slug> at <restartedAt>. Use 'dev-commands.sh tail <slug>' to watch it come back up.`; `403` -> exit 3 with `Refused: <slug> belongs to project <bg>, you are in project <caller> ...`, the server's `error` text and a do-not-retry line; `404` -> exit 1 with `No such background process: <slug>` and candidate slugs; `409` -> exit 4 with `The conductor tmux session is not running; nothing to restart.`; `500` -> exit 6 with the server `error`, `step:` and `status:`; any other status (418) -> exit 6 with `HTTP 418` and the body. Exactly one POST is sent for the `200` case.
- **Steps**:
  1. Run the command below (the script runs in full; the filter prints only the status-mapping lines).
- **Command**:
  ```bash
  bash scripts/verify-dev-commands-restart.sh 2>&1 | grep -E '(PASS|FAIL): (200|403|404|409|500|unexpected status)'
  ```
- **Expected Result**: no line contains `FAIL:`. The printed `PASS:` lines include `200 -> restart succeeds (exit 0)`, `200 message names the slug`, `200 message carries restartedAt`, `200 message has the tail hint`, `200: exactly one POST for ok-proc`, `403 -> refused (exit 3)`, `403 message says Refused`, `403 message includes the server error text`, `403 message says do not retry`, `404 -> unknown process (exit 1)`, `404 message names the slug`, `404 message lists candidate slugs`, `409 -> tmux session not running (exit 4)`, `409 message`, `500 -> restart failed (exit 6)`, `500 message prints the server error`, `500 message prints the step`, `500 message prints the status`, `unexpected status (418) -> exit 6 (exit 6)` and `unexpected status message prints the status and body` (20 lines at the time of writing).
- **Repeatable Unit Test**: Created: `scripts/verify-dev-commands-restart.sh` (Status mapping section)
- **Unit Test Command**: `bash scripts/verify-dev-commands-restart.sh`
- [x] Pass <!-- 2026-10-17 -->

### UAT-EDGE-002: a `429` cooldown is reported once and never retried, with `retryAfterS` from the body or the `Retry-After` header
- **Scenario**: The stub answers `429` for the process `cool` (body has `retryAfterS: 42`, `lastRestartAt` about 30 s ago, `lastRestartBy: agent-beta`, plus a `Retry-After: 42` header) and for `cool-hdr` (no `retryAfterS` in the body, `Retry-After: 17`, no `lastRestartBy`). The script must exit 5, print `Restart skipped: <slug> was restarted <n>s ago by <who>. Retry in <s>s (or check its output with 'tail' first).` (elapsed seconds computed from `lastRestartAt`, `the dashboard` when `lastRestartBy` is null, `retryAfterS` taken from the header when the body lacks it) plus `Do NOT retry in a loop`, and it must send exactly ONE POST: the stub counts requests, and a script that slept and retried would count two.
- **Steps**:
  1. Run the command below.
- **Command**:
  ```bash
  bash scripts/verify-dev-commands-restart.sh 2>&1 | grep -E '(PASS|FAIL): 429'
  ```
- **Expected Result**: no `FAIL:` line. The `PASS:` lines include `429 -> cooldown (exit 5)`, `429 message names the slug and who restarted it`, `429 message names lastRestartBy`, `429 message carries retryAfterS 42`, `429 message forbids retrying in a loop`, a `429 message reports the elapsed seconds from lastRestartAt (~30s, got Ns)` line, `429: NO retry, the stub saw exactly one POST for cool`, `429 without body retryAfterS -> cooldown (exit 5)`, `429 falls back to the Retry-After header (17)`, `429 without lastRestartBy names the dashboard` and `429 (header fallback): exactly one POST for cool-hdr` (11 lines at the time of writing).
- **Repeatable Unit Test**: Created: `scripts/verify-dev-commands-restart.sh` (429 checks)
- **Unit Test Command**: `bash scripts/verify-dev-commands-restart.sh`
- [x] Pass <!-- 2026-10-17 -->

### UAT-EDGE-003: `X-Conductor-Agent` is forwarded verbatim, and omitted when `CONDUCTOR_AGENT_NAME` is unset or empty
- **Scenario**: With `CONDUCTOR_AGENT_NAME=agent-alpha` the stub records `"agent":"agent-alpha"` on the restart POST; an odd but non-empty value (`weird name.1-x`) is forwarded byte for byte; with the variable unset or set to the empty string no header is sent (the stub records `"agent":null`) and the restart still succeeds (a header-less caller is the "dashboard" to the server).
- **Steps**:
  1. Run the command below.
- **Command**:
  ```bash
  bash scripts/verify-dev-commands-restart.sh 2>&1 | grep -E '(PASS|FAIL): (header|200: header|restart with CONDUCTOR_AGENT_NAME unset)'
  ```
- **Expected Result**: no `FAIL:` line. The `PASS:` lines are `200: header X-Conductor-Agent forwarded verbatim`, `header forwarded verbatim (unregistered/odd value)`, `restart with CONDUCTOR_AGENT_NAME unset still works (exit 0)`, `header NOT sent when CONDUCTOR_AGENT_NAME is unset` and `header NOT sent when CONDUCTOR_AGENT_NAME is empty`.
- **Repeatable Unit Test**: Created: `scripts/verify-dev-commands-restart.sh` (header checks)
- **Unit Test Command**: `bash scripts/verify-dev-commands-restart.sh`
- [x] Pass <!-- 2026-10-17 -->

### UAT-EDGE-004: argument resolution stays inside the caller's project, and an ambiguous bare name exits 1 without sending anything
- **Scenario**: The stub has two processes named `dev`: `alpha-dev` (project 1) and `beta-dev` (project 2). Caller `agent-alpha` running `restart dev` must POST to `alpha-dev` only (never `beta-dev`), announce `Resolved 'dev' to 'alpha-dev'` on stderr, and send exactly one POST; `agent-beta` resolves to `beta-dev`; an exact slug (`beta-dev` from `agent-alpha`) is sent as-is because the server, not the script, decides authorization. With no caller identity, or an identity the stub does not know, the bare name `dev` is ambiguous: the script prints `Ambiguous name 'dev'` and both candidates, exits 1 and sends NO POST (`status`/`tail` keep exit 2 for the same case; `restart` deliberately uses 1).
- **Steps**:
  1. Run the command below.
- **Command**:
  ```bash
  bash scripts/verify-dev-commands-restart.sh 2>&1 | grep -E '(PASS|FAIL): (bare|exact slug|ambiguous|unresolvable)'
  ```
- **Expected Result**: no `FAIL:` line. The `PASS:` lines include `bare 'dev' as agent-alpha resolves within its project (exit 0)`, `bare 'dev' as agent-alpha POSTs to alpha-dev`, `bare 'dev' as agent-alpha never POSTs to beta-dev`, `bare 'dev' as agent-alpha sends exactly one POST`, `bare-name resolution is announced on stderr`, `bare 'dev' as agent-beta POSTs to beta-dev`, `bare 'dev' as agent-beta never POSTs to alpha-dev`, `exact slug beta-dev is sent as-is (server enforces the guard)`, `ambiguous bare 'dev' with no caller project (exit 1)`, `ambiguous bare name says Ambiguous`, `ambiguous bare name lists alpha-dev`, `ambiguous bare name lists beta-dev`, `ambiguous bare name sends no POST`, `ambiguous bare 'dev' with an unresolvable caller (exit 1)` and `unresolvable caller + ambiguous name sends no POST`.
- **Repeatable Unit Test**: Created: `scripts/verify-dev-commands-restart.sh` (resolution checks, `jq` required)
- **Unit Test Command**: `bash scripts/verify-dev-commands-restart.sh`
- [x] Pass <!-- 2026-10-17 -->

### UAT-EDGE-005: without `jq` the script still restarts, parses the error bodies with `sed`, and accepts only an exact slug
- **Scenario**: The script runs under a `PATH` that holds only `curl`, `sed`, `head` and `date` (no `jq`). `restart ok-proc` succeeds and prints the `restartedAt` extracted with `sed`; a note says `jq is not installed`; `429`, `403` and `500` keep their exit codes (5, 3, 6) and their messages (`Retry in 42s`, `by agent-beta`, both project ids, `step: respawn-window`) and still send exactly one POST on 429; a bare name is not resolved but POSTed verbatim (the stub answers 404, exit 1); `tail` works with `curl` alone.
- **Steps**:
  1. Run the command below.
- **Command**:
  ```bash
  bash scripts/verify-dev-commands-restart.sh 2>&1 | grep -E '(PASS|FAIL|SKIP): no-jq'
  ```
- **Expected Result**: no `FAIL:` and no `SKIP:` line. The `PASS:` lines include `no-jq: 200 -> restart succeeds (exit 0)`, `no-jq: 200 message carries restartedAt (sed extraction)`, `no-jq: says jq is not installed`, `no-jq: 429 -> cooldown (exit 5)`, `no-jq: 429 message carries retryAfterS 42`, `no-jq: 429 message names lastRestartBy`, `no-jq: 429 sends exactly one POST`, `no-jq: 403 -> refused (exit 3)`, `no-jq: 403 message carries both project ids`, `no-jq: 500 -> restart failed (exit 6)`, `no-jq: 500 message carries the step`, `no-jq: bare name is not resolved -> 404 -> exit 1`, `no-jq: bare 'dev' is POSTed verbatim`, `no-jq: tail of a registered slug succeeds` and `no-jq: tail prints the server text body`.
- **Repeatable Unit Test**: Created: `scripts/verify-dev-commands-restart.sh` (no-`jq` checks)
- **Unit Test Command**: `bash scripts/verify-dev-commands-restart.sh`
- [x] Pass <!-- 2026-10-17 -->

### UAT-EDGE-006: no argument is a usage error (exit 1), and an unreachable host-server is exit 2 with no offline fallback
- **Scenario**: `restart` with no argument prints `Usage: dev-commands.sh restart <name>` and exits 1 without contacting anything (it runs against a dead port and needs no server). After the stub server is stopped, `restart ok-proc` against its now-free port exits 2 and prints `Cannot reach the conductor host-server on port <port>; restart needs it (there is no offline fallback).`
- **Steps**:
  1. Run the command below.
- **Command**:
  ```bash
  bash scripts/verify-dev-commands-restart.sh 2>&1 | grep -E '(PASS|FAIL): (restart with no argument|stub server stopped|unreachable)'
  ```
- **Expected Result**: no `FAIL:` line. The `PASS:` lines are `restart with no argument (exit 1)`, `restart with no argument prints usage`, `stub server stopped (pid <N> is gone)`, `unreachable port -> exit 2 (exit 2)`, `unreachable message names the port` and `unreachable message says there is no offline fallback`.
- **Repeatable Unit Test**: Created: `scripts/verify-dev-commands-restart.sh` (offline/argument section and the unreachable check)
- **Unit Test Command**: `bash scripts/verify-dev-commands-restart.sh`
- [x] Pass <!-- 2026-10-17 -->

### UAT-INT-001: all touched shell scripts parse, and the sibling offline verifiers still pass
- **Description**: `bash -n` on the skill script and the two verify scripts, then the pre-existing offline verifier (`status`/`tail`/`list` against fixture state files and a dead port, so it never reaches `:8788`) and the SKILL.md front-matter verifier. Adding `restart` and generalising `api_get` into `api_call` must not regress `list`, `status` or `tail` (TASK-0203 Step 3 required the front-matter verifier to be re-run and updated if it hard-codes the old `argument-hint`/`description`; it only checks `disable-model-invocation`).
- **Steps**:
  1. Run the two commands below as-is.
- **Command**:
  ```bash
  bash -n skills/dev-commands/scripts/dev-commands.sh && bash -n scripts/verify-dev-commands-restart.sh && bash -n scripts/verify-dev-commands.sh && echo SYNTAX_OK
  ```
  ```bash
  bash scripts/verify-dev-commands.sh 2>&1 | tail -n 1; bash scripts/verify-dev-commands-skill-frontmatter.sh
  ```
- **Expected Result**: the first prints `SYNTAX_OK`. The second prints `[verify-dev-commands] PASS — all dev-commands.sh behavioral checks passed` and then `[verify-dev-commands-skill-frontmatter] PASS — disable-model-invocation: false (autonomously reachable, per task design intent)`.
- **Repeatable Unit Test**: Not applicable: syntax check; the regression part is already covered by the existing shell verifiers named in the Command
- [x] Pass <!-- 2026-10-17 -->

### UAT-INT-002: the `restart` code path follows the task's structural rules (no sleep, no temp files, no tmux, named timeout)
- **Description**: The task fixes design constraints that a behavioural test can miss: the script must never sleep-and-retry, must not use temp files (headers and body are captured into one shell variable with `curl -sS -i`), must never run tmux itself (all policy and tmux work stay on the server), and must use the named constant `RESTART_TIMEOUT_S` (60) for the `--max-time` of the restart request. `api_get` must survive as a wrapper so `list`/`status`/`tail` callers are untouched.
- **Steps**:
  1. Search `skills/dev-commands/scripts/dev-commands.sh` with `mcp__serena__search_for_pattern` for `\bsleep\b` and for `mktemp|/tmp/|>\s*"\$[A-Za-z_]*(TMP|tmp)`.
  2. Search it for `\btmux\s+(send|new|respawn|list|kill|has|display|split)` (an actual tmux invocation; prose mentions in comments and messages do not count).
  3. Search it for `RESTART_TIMEOUT_S` and for `^api_get\(\)`.
  4. Read the `cmd_restart` function and count the `api_call POST` invocations.
- **Expected Result**: step 1 finds no match; step 2 finds no match; step 3 finds `RESTART_TIMEOUT_S=60` as a top-level assignment, `--max-time "$RESTART_TIMEOUT_S"` in `api_call`'s raw mode, and `api_get()` defined as a one-line wrapper around `api_call GET "$1"`; step 4 finds exactly one `api_call POST` in `cmd_restart` and no loop around it (the `429` branch returns 5 immediately).
- **Repeatable Unit Test**: Not applicable: static source-structure check; the behavioural consequences (one POST on 429) are already asserted by UAT-EDGE-002
- [x] Pass <!-- 2026-10-17 -->
  - _verified by source read_: `dev-commands.sh` has no `sleep`, no `mktemp`, no `/tmp/` and no tmux invocation (the only `tmux respawn` text is prose in the line 84 comment, which the case excludes); `RESTART_TIMEOUT_S=60` is a top-level assignment (line 86), used as `--max-time "$RESTART_TIMEOUT_S"` in both raw-mode `curl` calls of `api_call`; `api_get()` is a one-line wrapper (`api_call GET "$1"`); `cmd_restart` has exactly one `api_call POST` (line 834), no loop, and the 429 branch returns 5 immediately.

### UAT-DOC-001: `SKILL.md` documents `restart` for the agent reader
- **Description**: The task requires the front matter, a "Restart a process" section (usage, example output for success/cooldown/refused, exit-code table, etiquette), a "When to use this tool" entry, and an "Offline resilience" note.
- **Steps**:
  1. Read the front matter (first 8 lines) of `skills/dev-commands/SKILL.md`.
  2. Search the file with `mcp__serena__search_for_pattern` for `### Restart a process`, `The dev server crashed. Can I bring it back?`, `\*\*restart\*\*` and `Do NOT retry in a loop`.
  3. Read the "Restart a process" section and the "Offline resilience" section.
- **Expected Result**: the front matter has `argument-hint: "{list|status|tail|restart} [options]"` and a `description` that mentions restarting a crashed or wedged process in your own project. "When to use this tool" has the entry `"The dev server crashed. Can I bring it back?"` pointing at `status`/`tail` first and then `dev-commands.sh restart <name>`, own project only. The "Restart a process" section shows usage `dev-commands.sh restart <name>`, resolution order (exact slug, then bare name within the caller's project, then a bare name matching exactly one process machine-wide; ambiguous exits 1; without `jq` only an exact slug), states that the script never runs tmux, never retries and has no confirmation prompt, has example outputs for success (exit 0), cooldown (exit 5) and refused (exit 3), an exit-code table for 0 through 6 whose meanings match the script (0 restarted, 1 usage/no such process/ambiguous, 2 host-server unreachable, 3 refused, 4 tmux session not running, 5 cooldown, 6 restart failed or unexpected response), a "When to restart" paragraph (own diagnosis via `status`/`tail` says exited or wedged, not merely slow) and etiquette (check `tail` first, restart once then observe, never loop, another agent may already have restarted it, only your own project's processes). "Offline resilience" says `restart` needs the host-server, has no offline fallback, prints `Cannot reach the conductor host-server on port <BACKEND_PORT>; restart needs it (there is no offline fallback).` and exits 2.
- **Repeatable Unit Test**: Not applicable: documentation check
- [x] Pass <!-- 2026-10-17 -->
  - _verified by source read_: `skills/dev-commands/SKILL.md` front matter has `argument-hint: "{list|status|tail|restart} [options]"` and a `description` mentioning restarting a crashed or wedged process in your own project; "When to use this tool" has the `"The dev server crashed. Can I bring it back?"` entry (status/tail first, then `restart <name>`, own project only); `### Restart a process` has usage, resolution order, thin-client/never-tmux/never-retries/no-prompt statement, success/cooldown/refused examples (including `Do NOT retry in a loop`), the 0-6 exit-code table matching the script, a "When to restart" paragraph and etiquette; "Offline resilience" documents the no-fallback message and exit 2. (The step-2 search for the literal bold `**restart**` has no hit, but the entry it targets is present in plain-code form; the Expected Result does not depend on it.)

### UAT-DOC-002: the script's own comments and usage text, the README and the wiki pages describe `restart` and its exit codes
- **Description**: The task requires `dev-commands.sh` (header comment block and the usage text printed for an unknown subcommand), `scripts/README.md`, `wiki/knowledge/concepts/background-process-registry.md` and `wiki/knowledge/sources/shared-dev-commands.md` to reflect the new subcommand.
- **Steps**:
  1. Read the header comment block (first 70 lines) and the final `case` block of `skills/dev-commands/scripts/dev-commands.sh`.
  2. Search `scripts/README.md` with `mcp__serena__search_for_pattern` for `Agent-facing restart client`.
  3. Search `wiki/knowledge/concepts/background-process-registry.md` for `### Agent-facing restart path` and read that section.
  4. Search `wiki/knowledge/sources/shared-dev-commands.md` for `restart <name>`.
- **Expected Result**: the script header documents `dev-commands.sh restart <name>` and the seven exit codes 0 to 6 with the meanings used by the code (and that `restart` exits 1 for an ambiguous name where `status`/`tail` exit 2); the usage text shows `{list|status|tail|restart} [options]`, a `restart <name>` line and the exit-code summary line. `scripts/README.md` has the "Agent-facing restart client" paragraph with the same exit codes and the test line for `scripts/verify-dev-commands-restart.sh`. `background-process-registry.md` has the "Agent-facing restart path" section (script is a thin client, server owns guard/cooldown/audit, header sent when non-empty, no prompt, no retry, 60 s timeout, exit-code table). `shared-dev-commands.md` has a `> **Contradiction:**` callout saying the subcommand set is now `list|status|tail|restart`.
- **Repeatable Unit Test**: Not applicable: documentation check
- [x] Pass <!-- 2026-10-17 -->
  - _verified by source read_: the script header documents `dev-commands.sh restart <name>`, exit codes 0-6 with the code's meanings, and that `restart` exits 1 for an ambiguous name where `status`/`tail` exit 2; the usage text shows `{list|status|tail|restart} [options]`, the `restart <name>` line and the exit-code summary. `scripts/README.md` has "Agent-facing restart client" with the same codes and the `verify-dev-commands-restart.sh` test line. `background-process-registry.md` has "Agent-facing restart path" (thin client, server-owned guard/cooldown/audit, header when non-empty, no prompt/retry, 60 s timeout, exit-code contract). `shared-dev-commands.md` has the `> **Contradiction:**` callout naming the `list|status|tail|restart` set.

### UAT-API-001: GATE — the private host-server has the restart route (a nonexistent slug answers the route's own `404`)
- **Endpoint**: `POST /api/bg-processes/:slug/restart` (port 18870, private stack)
- **Description**: A server built before TASK-0190 has no such route and answers Fastify's generic `{"message":"Route POST:/api/bg-processes/no-such/restart not found","error":"Not Found","statusCode":404}`. The route this UAT depends on answers `404 {"error":"bg process 'no-such' not found"}` for an unknown slug (a 404 is not audited and arms no cooldown). **If the body is not the route's own `{"error":"bg process 'no-such' not found"}`, stop: mark every remaining live case (UAT-API-002 onward, UAT-LIVE-*) BLOCKED, not failed, and note that the server under test lacks the TASK-0190 route. Do not fall back to `:8788`.**
- **Steps**:
  1. Confirm the Prerequisites completed (private tmux, private server answering `[]`, `monitor` window present, wrapper created).
  2. Run the command below as-is.
- **Command**:
  ```bash
  curl -sS -i -X POST 'http://127.0.0.1:18870/api/bg-processes/no-such/restart' | tr -d '\r' | grep -iE '^(HTTP/|\{)'
  ```
- **Expected Result**: `HTTP/1.1 404 Not Found` then `{"error":"bg process 'no-such' not found"}`.
- **Repeatable Unit Test**: Not applicable: asserts the live Fastify route on the private stack
- [x] Pass <!-- 2026-10-17 -->

### UAT-API-002: register two projects, one agent in project A, and three bg processes (two named `dev`)
- **Endpoint**: `POST /api/projects`, `POST /api/projects/:id/agents`, `POST /api/bg-processes` (private stack)
- **Description**: The fixture for the live cases. Projects `uat0203pa` (id 1) and `uat0203pb` (id 2). One agent, `alice`, in `uat0203pa`: its tmux window name, and so the value a real agent carries in `CONDUCTOR_AGENT_NAME`, is `uat0203pa-alice` (only one agent is needed, so the transient `500 ... create window failed: index N in use` that a second agent registration produces on this stack is avoided). Bg processes `dev` and `web` in pa and `dev` in pb, giving slugs `uat0203pa-dev`, `uat0203pa-web`, `uat0203pb-dev` (two processes share the display name `dev`, so a wrong resolution cannot pass by name). Ids assume a fresh DB and this order.
- **Steps**:
  1. Create the projects, one at a time:
     ```bash
     curl -sS -X POST 'http://127.0.0.1:18870/api/projects' -H 'Content-Type: application/json' -d '{"name":"uat0203pa","workdir":"/Users/davidtaylor/Repositories/tmux-conductor/tmp/uat-0203"}' | jq -c '{id,name}'
     ```
     ```bash
     curl -sS -X POST 'http://127.0.0.1:18870/api/projects' -H 'Content-Type: application/json' -d '{"name":"uat0203pb","workdir":"/Users/davidtaylor/Repositories/tmux-conductor/tmp/uat-0203"}' | jq -c '{id,name}'
     ```
     Expect `{"id":1,"name":"uat0203pa"}` and `{"id":2,"name":"uat0203pb"}`.
  2. Create the agent, then wait:
     ```bash
     curl -sS -X POST 'http://127.0.0.1:18870/api/projects/1/agents' -H 'Content-Type: application/json' -d '{"name":"alice","launchCmd":"sleep 3600"}' | jq -c '{id,name,projectId}'; sleep 4
     ```
  3. Create the bg processes, waiting between calls:
     ```bash
     curl -sS -X POST 'http://127.0.0.1:18870/api/bg-processes' -H 'Content-Type: application/json' -d '{"name":"dev","projectId":1,"workdir":"/Users/davidtaylor/Repositories/tmux-conductor/tmp/uat-0203","launchCmd":"sleep 3600"}' | jq -c '{ok, slug: .bg.slug, projectId: .bg.projectId}'; sleep 4; curl -sS -X POST 'http://127.0.0.1:18870/api/bg-processes' -H 'Content-Type: application/json' -d '{"name":"web","projectId":1,"workdir":"/Users/davidtaylor/Repositories/tmux-conductor/tmp/uat-0203","launchCmd":"sleep 3600"}' | jq -c '{ok, slug: .bg.slug, projectId: .bg.projectId}'; sleep 4; curl -sS -X POST 'http://127.0.0.1:18870/api/bg-processes' -H 'Content-Type: application/json' -d '{"name":"dev","projectId":2,"workdir":"/Users/davidtaylor/Repositories/tmux-conductor/tmp/uat-0203","launchCmd":"sleep 3600"}' | jq -c '{ok, slug: .bg.slug, projectId: .bg.projectId}'; sleep 4
     ```
  4. Run the verification commands below as-is, one at a time.
- **Command**:
  ```bash
  curl -sS 'http://127.0.0.1:18870/api/agents' | jq -c 'map({name, projectId, projectName})'
  ```
  ```bash
  curl -sS 'http://127.0.0.1:18870/api/status' | jq -c '[.bgProcesses[] | {slug, projectId, windowPresent}] | sort_by(.slug)'
  ```
  ```bash
  curl -sS 'http://127.0.0.1:18870/api/agents/whoami' -H 'X-Conductor-Agent: uat0203pa-alice' | jq -c '{kind, projectId, projectName}'
  ```
- **Expected Result**: step 2 prints `{"id":1,"name":"alice","projectId":1}`; step 3 prints `{"ok":true,"slug":"uat0203pa-dev","projectId":1}`, `{"ok":true,"slug":"uat0203pa-web","projectId":1}`, `{"ok":true,"slug":"uat0203pb-dev","projectId":2}`. The verification prints `[{"name":"alice","projectId":1,"projectName":"uat0203pa"}]`, then `[{"slug":"uat0203pa-dev","projectId":1,"windowPresent":true},{"slug":"uat0203pa-web","projectId":1,"windowPresent":true},{"slug":"uat0203pb-dev","projectId":2,"windowPresent":true}]`, then `{"kind":"agent","projectId":1,"projectName":"uat0203pa"}`. If a registration failed, re-run only that one; a fixture that cannot be created makes the remaining live cases BLOCKED.
- **Repeatable Unit Test**: Not applicable: live HTTP + SQLite + tmux wiring for fixtures
- [x] Pass <!-- 2026-10-17 -->

### UAT-LIVE-001: a project-A agent restarts `dev` by bare name; the restart marker appears in the process's own log only
- **Description**: The core requirement, end to end. With `CONDUCTOR_AGENT_NAME=uat0203pa-alice` the script resolves the bare name `dev` within project `uat0203pa` (project `uat0203pb` also owns a `dev`), POSTs to `uat0203pa-dev`, and prints the success line with the server's `restartedAt`. The server's restart appends a `--- restart <ts> ---` marker to `bg-uat0203pa-dev.log`, visible both in the raw log and through `dev-commands.sh tail`, with the same timestamp the restart printed. `uat0203pb-dev` is untouched (no marker).
- **Steps**:
  1. Run the first command, note the timestamp after `Restarted uat0203pa-dev at `.
  2. Run the second command (raw log marker counts) and the third (the marker as seen through `tail`).
- **Command**:
  ```bash
  bash tmp/uat-0203/dc.sh uat0203pa-alice 18870 restart dev
  ```
  ```bash
  sleep 2; echo "pa-dev-markers=$(grep -c '^--- restart ' tmp/uat-0203/logs/bg-uat0203pa-dev.log) pb-dev-markers=$(grep -c '^--- restart ' tmp/uat-0203/logs/bg-uat0203pb-dev.log)"
  ```
  ```bash
  bash tmp/uat-0203/dc.sh uat0203pa-alice 18870 tail uat0203pa-dev -n 200 | grep -E '^--- restart '
  ```
- **Expected Result**: the first prints `rc=0`, `--- stdout`, `Restarted uat0203pa-dev at <ISO timestamp>. Use 'dev-commands.sh tail uat0203pa-dev' to watch it come back up.`, `--- stderr`, `Resolved 'dev' to 'uat0203pa-dev'`. The second prints `pa-dev-markers=1 pb-dev-markers=0`. The third prints exactly one line `--- restart <ISO timestamp> ---` whose timestamp equals the one the restart printed. Anything touching `uat0203pb-dev` (a marker in its log) is a FAIL.
- **Repeatable Unit Test**: Not applicable: live tmux respawn plus pipe-pane log capture; the script side of the flow is covered by UAT-EDGE-001 and UAT-EDGE-004
- [x] Pass <!-- 2026-10-17 -->

### UAT-LIVE-002: a second restart inside the cooldown exits 5 without waiting or retrying, and a restart after the cooldown succeeds again
- **Description**: The cooldown is 20 s on this stack. One block: wait out any cooldown from UAT-LIVE-001, restart (allowed), restart again at once (cooldown), then wait it out and restart a third time (allowed). The middle call is timed: a script that slept and retried would take at least the cooldown, so `elapsed` must stay a few seconds. The message names the caller that armed the cooldown (`uat0203pa-alice`), gives elapsed seconds and the retry time, and forbids looping.
- **Steps**:
  1. Run the command below as one block (about 45 seconds).
- **Command**:
  ```bash
  sleep 21; bash tmp/uat-0203/dc.sh uat0203pa-alice 18870 restart uat0203pa-dev | head -n 3; s=$(date +%s); bash tmp/uat-0203/dc.sh uat0203pa-alice 18870 restart uat0203pa-dev; echo "elapsed=$(( $(date +%s) - s ))s"; sleep 21; bash tmp/uat-0203/dc.sh uat0203pa-alice 18870 restart uat0203pa-dev | head -n 3
  ```
- **Expected Result**: first call: `rc=0`, `--- stdout`, `Restarted uat0203pa-dev at <ISO>. Use 'dev-commands.sh tail uat0203pa-dev' to watch it come back up.`. Second call: `rc=5`, an empty stdout section, and stderr exactly `Restart skipped: uat0203pa-dev was restarted <n>s ago by uat0203pa-alice. Retry in <m>s (or check its output with 'tail' first).` (`n` a whole number from 0 to 20, `m` from 1 to 20) followed by `Do NOT retry in a loop: the cooldown exists to stop restart loops. Check 'dev-commands.sh tail uat0203pa-dev' and wait.`, then `elapsed=` followed by 0 to 3 and `s` (more than a few seconds means the script slept or retried: FAIL). Third call: `rc=0` and a `Restarted uat0203pa-dev at <ISO>.` line.
- **Repeatable Unit Test**: Not applicable: needs the real server's cooldown clock; the script's 429 handling and the no-retry rule are covered by UAT-EDGE-002
- [x] Pass <!-- 2026-10-17 -->

### UAT-LIVE-003: a project-A agent is refused (exit 3) for a project-B process, and so is an unregistered caller; nothing is restarted
- **Description**: The same-project guard as seen through the script. `uat0203pa-alice` restarting the exact slug `uat0203pb-dev` gets `403 project-mismatch`; a caller name the server does not know (`uat0203pa-ghost`, an unregistered window name) gets `403 unknown-caller` with no project id. Both exit 3 with the do-not-retry line, and no marker reaches `bg-uat0203pb-dev.log`, proving no restart happened.
- **Steps**:
  1. Run the three commands below as-is, in order.
- **Command**:
  ```bash
  bash tmp/uat-0203/dc.sh uat0203pa-alice 18870 restart uat0203pb-dev
  ```
  ```bash
  bash tmp/uat-0203/dc.sh uat0203pa-ghost 18870 restart uat0203pb-dev
  ```
  ```bash
  echo "pb-dev-markers=$(grep -c '^--- restart ' tmp/uat-0203/logs/bg-uat0203pb-dev.log)"
  ```
- **Expected Result**: first: `rc=3`, empty stdout, stderr exactly `Refused: uat0203pb-dev belongs to project 2, you are in project 1 (or your agent identity could not be resolved).`, `Server said: restart denied: project-mismatch`, `Do not retry; only processes in your own project can be restarted.`. Second: `rc=3`, empty stdout, stderr `Refused: uat0203pb-dev belongs to project 2, you are in project (none) (or your agent identity could not be resolved).`, `Server said: restart denied: unknown-caller` and the same do-not-retry line. Third: `pb-dev-markers=0`.
- **Repeatable Unit Test**: Not applicable: live server guard; the script's 403 mapping is covered by UAT-EDGE-001
- [x] Pass <!-- 2026-10-17 -->

### UAT-LIVE-004: a header-less caller (a human at a plain shell, the dashboard's identity) restarts twice in a row: no header is sent, and the cooldown does not apply
- **Description**: With `CONDUCTOR_AGENT_NAME` unset the script sends no `X-Conductor-Agent` header, so the server treats the call as the dashboard: allowed for any project and exempt from the agent cooldown (the human confirmation lives in the dashboard, TASK-0206). The exact slug `uat0203pa-web` is used, so no `Resolved` note is printed.
- **Steps**:
  1. Run the command below as one block.
- **Command**:
  ```bash
  bash tmp/uat-0203/dc.sh - 18870 restart uat0203pa-web; bash tmp/uat-0203/dc.sh - 18870 restart uat0203pa-web
  ```
- **Expected Result**: both calls print `rc=0`, then `Restarted uat0203pa-web at <ISO>. Use 'dev-commands.sh tail uat0203pa-web' to watch it come back up.` under `--- stdout`, and nothing under `--- stderr`. The second call is not answered with a cooldown (exit 5 is a FAIL).
- **Repeatable Unit Test**: Not applicable: live server behaviour for a header-less caller; the omitted-header behaviour of the script is covered by UAT-EDGE-003
- [x] Pass <!-- 2026-10-17 -->

### UAT-LIVE-005: an unknown name exits 1 with candidates, and an ambiguous bare name exits 1 with candidates; neither reaches the audit log
- **Description**: `restart nonexistent` as `uat0203pa-alice` reaches the server, which answers `404` (a 404 is not audited); `restart dev` with no caller identity is ambiguous between `uat0203pa-dev` and `uat0203pb-dev` and must be rejected locally, with no POST at all. The audit line count is compared before and after to prove neither attempt added a record.
- **Steps**:
  1. Run the command below as one block.
- **Command**:
  ```bash
  before=$(wc -l < tmp/uat-0203/logs/bg-restarts.jsonl | tr -d ' '); bash tmp/uat-0203/dc.sh uat0203pa-alice 18870 restart nonexistent; bash tmp/uat-0203/dc.sh - 18870 restart dev; after=$(wc -l < tmp/uat-0203/logs/bg-restarts.jsonl | tr -d ' '); echo "new-audit-lines=$((after - before))"
  ```
- **Expected Result**: first call: `rc=1`, empty stdout, stderr `No such background process: nonexistent` followed by `Registered slugs:` and the three slugs `uat0203pa-dev`, `uat0203pa-web`, `uat0203pb-dev` (any order). Second call: `rc=1`, empty stdout, stderr `Ambiguous name 'dev' — matches 2 registered processes; use the full slug:` followed by `uat0203pa-dev` and `uat0203pb-dev`. Last line: `new-audit-lines=0`.
- **Repeatable Unit Test**: Not applicable: live server 404 and resolution against real `/api/status`; the script logic is covered by UAT-EDGE-001 and UAT-EDGE-004
- [x] Pass <!-- 2026-10-17 -->

### UAT-LIVE-006: an unreachable host-server exits 2 with the no-offline-fallback message
- **Description**: `BACKEND_PORT` points at 18879, where nothing listens, with a valid caller. Unlike `list`/`status`/`tail`, `restart` has no offline fallback, so it must fail clearly and exit 2 instead of reading state files.
- **Steps**:
  1. Run the command below as-is.
- **Command**:
  ```bash
  bash tmp/uat-0203/dc.sh uat0203pa-alice 18879 restart uat0203pa-dev
  ```
- **Expected Result**: `rc=2`, empty stdout, stderr exactly `Cannot reach the conductor host-server on port 18879; restart needs it (there is no offline fallback).`
- **Repeatable Unit Test**: Created: `scripts/verify-dev-commands-restart.sh` (its `unreachable port -> exit 2` checks assert the same message and exit code; this case repeats it with a valid caller on the private stack)
- **Unit Test Command**: `bash scripts/verify-dev-commands-restart.sh`
- [x] Pass <!-- 2026-10-17 -->

### UAT-LIVE-007: with the conductor tmux session gone, `restart` exits 4 with the session-not-running message
- **Description**: Kills the private tmux session (the last session, so the private tmux server exits too), then restarts as a valid project member. The server checks the session after the guard and before the cooldown, so it answers `409 session not running` and the script maps that to exit 4. **This case is destructive to the private stack's tmux server, so it runs after every case that needs tmux (UAT-LIVE-001 .. 006) and must be run immediately after the kill, as one block.** Later cases (UAT-LIVE-008, UAT-API-003) need only the private host-server and the audit file, not tmux.
- **Steps**:
  1. Run the command below as one block.
- **Command**:
  ```bash
  env -u TMUX -u TMUX_PANE TMUX_TMPDIR="$PWD/tmp/uat-0203/tmux" tmux kill-session -t uat0203; bash tmp/uat-0203/dc.sh uat0203pa-alice 18870 restart uat0203pa-web
  ```
- **Expected Result**: `rc=4`, empty stdout, stderr exactly `The conductor tmux session is not running; nothing to restart.`
- **Repeatable Unit Test**: Created: `scripts/verify-dev-commands-restart.sh` (its `409 -> tmux session not running (exit 4)` checks assert the script side against the stub; the live 409 needs the real server and tmux)
- **Unit Test Command**: `bash scripts/verify-dev-commands-restart.sh`
- [x] Pass <!-- 2026-10-17 -->

### UAT-LIVE-008: the server's audit log has exactly one record per restart attempt, attributed to the header the script sent
- **Description**: The end-to-end proof that the script's `X-Conductor-Agent` header reaches the server's audit trail and that each attempt (success, cooldown skip, denial, header-less restart, no-session failure) leaves exactly one line in `tmp/uat-0203/logs/bg-restarts.jsonl`, while the local-only outcomes (unknown slug 404, ambiguous name, unreachable server) leave none. Depends on UAT-LIVE-001 .. 007 having been run in order, once each.
- **Steps**:
  1. Run the command below as-is.
- **Command**:
  ```bash
  jq -c '[.bg, .callerKind, .caller, .outcome, (.reason // .step // "-")]' tmp/uat-0203/logs/bg-restarts.jsonl
  ```
- **Expected Result**: exactly nine lines, in this order:
  1. `["uat0203pa-dev","agent","uat0203pa-alice","restarted","-"]` (UAT-LIVE-001)
  2. `["uat0203pa-dev","agent","uat0203pa-alice","restarted","-"]` (UAT-LIVE-002 first call)
  3. `["uat0203pa-dev","agent","uat0203pa-alice","cooldown","-"]` (UAT-LIVE-002 second call)
  4. `["uat0203pa-dev","agent","uat0203pa-alice","restarted","-"]` (UAT-LIVE-002 third call)
  5. `["uat0203pb-dev","agent","uat0203pa-alice","denied","project-mismatch"]` (UAT-LIVE-003)
  6. `["uat0203pb-dev","agent","uat0203pa-ghost","denied","unknown-caller"]` (UAT-LIVE-003)
  7. `["uat0203pa-web","dashboard",null,"restarted","-"]` (UAT-LIVE-004)
  8. `["uat0203pa-web","dashboard",null,"restarted","-"]` (UAT-LIVE-004)
  9. `["uat0203pa-web","agent","uat0203pa-alice","failed","session-check"]` (UAT-LIVE-007)

  Each line's `caller` equals the `CONDUCTOR_AGENT_NAME` the wrapper exported for that call (`null` and `dashboard` for the header-less calls). Extra or missing lines mean an attempt was retried, dropped or mis-attributed (a case that was run twice or out of order legitimately changes the list; re-run the affected cases on a fresh stack rather than adjusting the expectation).
- **Repeatable Unit Test**: Not applicable: asserts the live audit file written by the real host-server (the record shape and append helper are unit-tested by UAT-0193)
- [x] Pass <!-- 2026-10-17 -->

### UAT-API-003: cleanup the private stack
- **Description**: Removes every artifact of the live cases: the private host-server, the private tmux server (already gone after UAT-LIVE-007, but killed here in case that case was skipped, which also removes the fixture agent and bg windows), and `tmp/uat-0203/`. Run last, and run it even if earlier cases failed or were blocked. The real `conductor` tmux session, `./data/conductor.db` and `./logs` are never involved. The unit-backed cases' own scratch files are removed too.
- **Steps**:
  1. Run the command below.
  2. Confirm the live `conductor` session is untouched and the fixture directory is gone.
- **Command**:
  ```bash
  (lsof -ti tcp:18870 -sTCP:LISTEN | xargs kill; sleep 2; env -u TMUX -u TMUX_PANE TMUX_TMPDIR="$PWD/tmp/uat-0203/tmux" tmux kill-server; rm -rf tmp/uat-0203 tmp/uat-0203-verify.out; curl -sS -m 2 -o /dev/null -w 'server=%{http_code}\n' 'http://127.0.0.1:18870/api/agents'; test -e tmp/uat-0203 && echo 'dir=present' || echo 'dir=gone'; tmux list-sessions -F '#S')
  ```
- **Expected Result**: `server=000` (connection refused, preceded by a curl `Failed to connect` line on stderr), `dir=gone`, and the final `tmux list-sessions` (the real server) still lists `conductor`. `tmux kill-server` prints `no server running on .../tmp/uat-0203/tmux/...` when the private server is already gone, and `xargs kill` may print a usage line if the port was already free; neither matters.
- **Repeatable Unit Test**: Not applicable: lifecycle cleanup of live processes and scratch files
- [x] Pass <!-- 2026-10-17 -->

---

## Notes for the judge

- **Auto-judgeable without the live stack**: UAT-UNIT-001 and UAT-EDGE-001 .. 006 (unit-backed: they all run `bash scripts/verify-dev-commands-restart.sh`, so a green UAT-UNIT-001 with an unchanged script implies the six EDGE cases, but each has its own filtered command and named lines), UAT-INT-001 (syntax + sibling verifiers), UAT-INT-002 (static search) and UAT-DOC-001/002 (text search). The live cases (UAT-API-001 .. 002, UAT-LIVE-001 .. 008) are machine-executable end to end on the private stack, gated by UAT-API-001 (route present); run them in the order written, because they share one server, one fixture and one audit file. UAT-LIVE-007 kills the private tmux server, so it must come after UAT-LIVE-001 .. 006. Always run UAT-API-003 (cleanup), even after failures.
- **Never call the script directly in a live case**: always through `tmp/uat-0203/dc.sh`. The judge's own `CONDUCTOR_AGENT_NAME` / `BACKEND_PORT` are typically set; an unwrapped call could resolve as the judge's own agent or hit `:8788`.
- **Parallel sessions**: the unit-backed cases share `tmp/verify-dev-commands-restart/` with anyone else running that script (a sibling UAT for TASK-0204 does); see "Run the unit-backed cases alone" in the Prerequisites. Do not judge a unit-backed case failed on a single run that overlapped another run.
- **Scope with TASK-0204**: `status`, `tail` and `list` were changed by TASK-0204 (liveness column, clean-text tail, project-aware slug resolution shared with `restart`). This UAT asserts only `restart`; the `verify-dev-commands-restart.sh` checks for the other subcommands run as part of UAT-UNIT-001 but belong to TASK-0204's UAT. If UAT-INT-001's `verify-dev-commands.sh` fails on a `status`/`tail`/`list` check, report it as a TASK-0204 (or later task) regression, not a TASK-0203 failure, unless the failing check exercises `restart` or `api_call`.
- **Known noise**: the private host-server prints tmux/monitor start-up lines to `tmp/uat-0203/server.log`; ignore it. The captured `tail` output of a bg process on this stack includes the developer's shell start-up banner (nvm and `npm_config_prefix` warnings, a prompt line) because the bg window runs the user's login shell; only the `--- restart <ts> ---` marker lines are asserted. A restart's `<n>s ago` in the cooldown message can legitimately read `0s` when the calls are back to back.
- **Not covered live** (covered against the stub only, by UAT-EDGE-001 .. 006): the `500` restart-failure branch (needs a server-side tmux failure), a `403` with `ambiguous-caller` / `unscoped` reasons (the agent-creation route refuses duplicate window names, and an unscoped bg process cannot be created since TASK-0195), and the `jq`-less path against a real server. Also not covered: an `exited` (crashed) process being revived and then reporting `liveness: running` (that is the TASK-0204/TASK-0191 status vocabulary; TASK-0204's UAT owns it) and the dashboard restart action (UAT-0206).
