---
id: UAT-0204
aliases: [UAT-0204]
title: "UAT: Point `dev-commands status`/`tail` at the new liveness and output endpoints and fix the `SKILL.md` state vocabulary"
status: pending
task: TASK-0204
created: 2026-09-20
updated: 2026-09-20
---

# UAT-0204 — UAT: Point `dev-commands status`/`tail` at the new liveness and output endpoints and fix the `SKILL.md` state vocabulary

implements::[[TASK-0204]]

> **Source task**: [[TASK-0204]]
> **Generated**: 2026-09-20
>
> **What changed**: `skills/dev-commands/scripts/dev-commands.sh` `cmd_status` is now online-first: it reads `GET /api/status`, selects the process by slug and prints `BgStatus.liveness` (`running | exited | stopped`, the authoritative signal), `windowPresent` (`present | absent`), `lastRestart` (`<ISO ts> by <caller>`, `by the dashboard` when the caller is null, `never` when the field is `null`, omitted when the field is absent) and the poll-lagged state file, followed by one sentence interpreting the liveness (`print_bg_status_online`). It exits 0 whenever the process is found, 1 for an unknown name, and against a server without `liveness` prints `liveness:     unknown (host-server predates liveness reporting)`. Offline (server unreachable, or `jq` missing) it prints the state file with its meaning (`describe_bg_state_value`: `running` / `exited` / `dead`, anything else `(legacy value)`) and the unchanged `Live cross-check unavailable (...)` line. `cmd_tail` validates `-n` as a positive integer (clamped locally to 1000), calls `GET /api/bg-processes/<slug>/tail?lines=N&format=text` and prints the body as-is (404 -> `No such background process: <slug>` + candidates, exit 1; empty body -> `(no output yet for <slug>)`, exit 0); offline it reads `bg-<slug>.log` through `strip_terminal_escapes` (a `sed -E` cleaner) with a stderr note. `status`/`tail` share `resolve_target_slug` with `restart` (`resolve_project_slug`); `parse_http_response` is shared with `restart`. `cmd_list` lines gained `liveness: <running|exited|stopped|unknown>` before `state:` and `window:`. `skills/dev-commands/SKILL.md` replaces the never-written `idle/busy/running` vocabulary with liveness `running | exited | stopped` and state file `running | exited | dead`. `scripts/verify-dev-commands.sh` (28 checks) and `scripts/verify-dev-commands-restart.sh` (149 checks) were updated/extended; `scripts/README.md` and `wiki/knowledge/concepts/background-process-registry.md` describe the behaviour.
>
> **Out of scope**: the host-server routes themselves (liveness: UAT-0191; tail endpoint: UAT-0192; restart cooldown/`lastRestart` source: UAT-0193), the `restart` subcommand (UAT-0203), the `list` project scoping (UAT-0202), and the aggregate verify script (TASK-0208). This UAT covers the skill script's consumption of those endpoints and the `SKILL.md` wording.
>
> **Stale sibling assertions (not failures of this task)**: UAT-0202's UAT-LIVE-006 asserts the pre-TASK-0204 `status` output (`State file (bg-<slug>.state, ...)` / `Live window status (from host-server):`), and its `list` cases assert lines without the `liveness:` column. Both were superseded by this task on purpose; judge them there as "superseded by TASK-0204".

---

## Prerequisites

**Isolation rules (read first).** Every case that talks to a server (UAT-API-*, UAT-LIVE-*, UAT-EDGE-004, UAT-EDGE-007) runs against a **private stack**: its own tmux server (`TMUX_TMPDIR=tmp/uat-0204/tmux`, session `uat0204`), its own conf, SQLite DB and `LOG_DIR` (all under `tmp/uat-0204/`), and its own host-server on port **18880**. Port **18889** is used only as "a port nothing listens on" (the offline cases). Only ports 18880 .. 18889 are ever used. Never send a request to `:8788` or `:4321`, never touch the live `conductor` tmux session, never touch the real `dev` / `dev-stack` bg processes, never read or write the real `./data/conductor.db` or `./logs`. Every tmux command is prefixed with `env -u TMUX -u TMUX_PANE TMUX_TMPDIR="$PWD/tmp/uat-0204/tmux"` so it reaches the private server even from inside tmux. No `.env` file is read or written.

**The judge is itself a conductor agent**, so `CONDUCTOR_AGENT_NAME` and `BACKEND_PORT` are probably set in its shell. Every script invocation below goes through the wrapper `tmp/uat-0204/dc.sh` created in the prerequisites, which unsets or sets `CONDUCTOR_AGENT_NAME` explicitly and always exports `BACKEND_PORT` to the port given, so an inherited value can neither redirect the script to `:8788` nor change which project it resolves. Never call `dev-commands.sh` directly in a live or offline case. The wrapper takes `<agent-name|-> <port> <state-dir> <dev-commands args...>` (`-` = `CONDUCTOR_AGENT_NAME` unset) and prints `rc=<exit>`, `--- stdout`, the stdout, `--- stderr`, the stderr; it also leaves stdout in `tmp/uat-0204/out.txt` and stderr in `tmp/uat-0204/err.txt` for the check commands. **Write the wrapper's arguments out literally** (never keep them in an unquoted variable: zsh does not word-split it).

- [ ] Run everything from the repo root `/Users/davidtaylor/Repositories/tmux-conductor`. Tools needed: `tmux` (>= 3.0), `node`, `curl`, `jq`, `lsof`. Ports 18880 and 18889 are free (the command below prints nothing):
  ```bash
  lsof -ti tcp:18880 -sTCP:LISTEN; lsof -ti tcp:18889 -sTCP:LISTEN
  ```
- [ ] Create the scratch dir (including the three state dirs), the private conf, and the wrapper. Do this **once, first**; UAT-UNIT-002 writes into the same directory and UAT-API-003 removes it:
  ```bash
  rm -rf tmp/uat-0204 && mkdir -p tmp/uat-0204/tmux tmp/uat-0204/data tmp/uat-0204/logs/state tmp/uat-0204/empty-state tmp/uat-0204/stale-state tmp/uat-0204/offline-state && printf '%s\n' 'SESSION_NAME="uat0204"' 'DB_PATH="./data/conductor.db"' 'LOG_DIR="./logs"' 'STATE_DIR="./logs/state"' 'POLL_INTERVAL=15' 'STATUS_POLL_MS=500' > tmp/uat-0204/conductor.conf
  ```
  ```bash
  printf '%s\n' '#!/bin/bash' '# dc.sh <agent-name|-> <port> <state-dir> <dev-commands args...>   ("-" = CONDUCTOR_AGENT_NAME unset)' 'who="$1"; port="$2"; sd="$3"; shift 3' 'if [ "$who" = "-" ]; then unset CONDUCTOR_AGENT_NAME; else export CONDUCTOR_AGENT_NAME="$who"; fi' 'export CONDUCTOR_STATE_DIR="$sd" CONDUCTOR_LOG_DIR="$PWD/tmp/uat-0204/logs" BACKEND_PORT="$port"' '/bin/bash skills/dev-commands/scripts/dev-commands.sh "$@" > tmp/uat-0204/out.txt 2> tmp/uat-0204/err.txt' 'echo "rc=$?"' 'echo "--- stdout"; cat tmp/uat-0204/out.txt' 'echo "--- stderr"; cat tmp/uat-0204/err.txt' > tmp/uat-0204/dc.sh
  ```
- [ ] Only for the offline cases (UAT-EDGE-005, UAT-EDGE-006): create the fixture state files and the escape-laden log (the wrapper points `CONDUCTOR_LOG_DIR` at `tmp/uat-0204/logs`):
  ```bash
  printf exited > tmp/uat-0204/offline-state/bg-uat0204off-vite.state && printf dead > tmp/uat-0204/offline-state/bg-uat0204off-gone.state && printf busy > tmp/uat-0204/offline-state/bg-uat0204off-old.state && printf running > tmp/uat-0204/offline-state/bg-uat0204off-run.state
  ```
  ```bash
  printf 'plain\n\033[31mred\033[0m text\n\033]0;title\007after-osc\nprog 10%%\rprog 50%%\rprog 100%%\ncrlf line\r\n' > tmp/uat-0204/logs/bg-uat0204off-vite.log
  ```
- [ ] Only for the live cases (UAT-API-001 .. 003, UAT-LIVE-*, UAT-EDGE-001 .. 004, UAT-EDGE-007): start the private tmux server with a keeper window (the session must exist before the host-server starts):
  ```bash
  env -u TMUX -u TMUX_PANE TMUX_TMPDIR="$PWD/tmp/uat-0204/tmux" tmux new-session -d -s uat0204 -n keeper 'sleep 3600'
  ```
- [ ] Start the private host-server from the working tree (background; it must stay up until UAT-API-003). It binds 127.0.0.1:18880 and reads `CONDUCTOR_CONF`, so it never touches `./data/conductor.db` or `./logs`:
  ```bash
  R="$PWD"; cd host-server && env -u TMUX -u TMUX_PANE TMUX_TMPDIR="$R/tmp/uat-0204/tmux" CONDUCTOR_CONF="$R/tmp/uat-0204/conductor.conf" BACKEND_PORT=18880 PORT=18880 nohup node --import tsx/esm index.ts > "$R/tmp/uat-0204/server.log" 2>&1 &
  ```
- [ ] Wait for it to answer and for its startup tmux work to settle (an empty agent list proves it is the private, empty DB; the `monitor` window appearing means startup is done):
  ```bash
  sleep 10 && curl -sS 'http://127.0.0.1:18880/api/agents'
  ```
  ```bash
  env -u TMUX -u TMUX_PANE TMUX_TMPDIR="$PWD/tmp/uat-0204/tmux" tmux list-windows -t uat0204 -F '#W'
  ```
  Expected: `[]`, then `keeper` and `monitor`. If the first does not print `[]`, stop and mark every live case BLOCKED.

Unit, syntax and doc cases (UAT-UNIT-*, UAT-INT-001, UAT-DOC-001, UAT-EDGE-008) and the offline cases need no live stack. `scripts/verify-dev-commands-restart.sh` uses one fixed scratch dir (`tmp/verify-dev-commands-restart/`, wiped on start and on exit), so it must not run at the same time as another agent running it; if it reports a mass of failures with empty stdout/stderr, that is such a collision, so re-run it once.

---

## Test Cases

### UAT-UNIT-001: offline verify script passes all checks (28), including the corrected vocabulary and the escape cleaner
- **Description**: `scripts/verify-dev-commands.sh` drives `dev-commands.sh` against fixture state files and logs with `BACKEND_PORT` pointing at a port nothing listens on (so it never reaches `:8788`). After this task it asserts: offline `status` of `exited` / `dead` / `busy` state files (real vocabulary, `busy` flagged `(legacy value)`), the unchanged labelled strings (`State file (bg-npm-dev.state, may lag up to one poll interval):` and `Live cross-check unavailable (host-server unreachable)`), offline `tail` passing plain lines through byte-identical, the stderr note `Note: host-server unreachable; showing the raw log with a best-effort escape strip.`, `-n` accepted in both argument orders, `-n abc|0|-2|1.5` rejected with the positive-integer message (exit 1), the missing-log message `No log file for 'ghost'`, and a fixture with an SGR colour, a cursor-move/erase CSI, an OSC window title, a `\r` progress redraw and a CRLF line reduced to clean text.
- **Steps**:
  1. Run the command below as-is (it writes to `tmp/uat-0204/`, created in the prerequisites).
- **Command**:
  ```bash
  bash scripts/verify-dev-commands.sh > tmp/uat-0204/verify-offline.out 2>&1; echo "rc=$?"; tail -n 1 tmp/uat-0204/verify-offline.out; grep -c 'PASS:' tmp/uat-0204/verify-offline.out; grep -c 'FAIL:' tmp/uat-0204/verify-offline.out
  ```
- **Expected Result**: `rc=0`, the last line `[verify-dev-commands] PASS — all dev-commands.sh behavioral checks passed`, then `28` (the number of `PASS:` lines; more if a later task appends checks, never fewer), then `0` (no `FAIL:` line). The output contains `PASS: status offline interprets state 'exited'`, `PASS: status offline interprets state 'dead'`, `PASS: status offline flags a pre-TASK-0191 value as legacy`, `PASS: tail offline strips SGR/CSI/OSC escapes, keeps the last \r redraw, keeps CRLF lines`, and four `PASS: tail -n '<bad>' -> usage error, exit 1` lines.
- **Repeatable Unit Test**: Created: `scripts/verify-dev-commands.sh` (a shell verification script, the repo's runner for this skill; edited in place by TASK-0204)
- **Unit Test Command**: `bash scripts/verify-dev-commands.sh`
- [ ] Pass

### UAT-UNIT-002: stub-server verify script passes all checks (149) for `status`, `tail`, `list` and `restart`
- **Description**: `scripts/verify-dev-commands-restart.sh` runs `dev-commands.sh` against a Node stub HTTP server on a private ephemeral port (127.0.0.1, port 0), never `:8788`, and records every request. TASK-0204's additions assert: `status` renders liveness `running`/`exited`/`stopped`, the window, `last restart: <ts> by <caller>` / `by the dashboard` / `never`, the poll-lagged state-file label and each interpretive sentence; exit 0 for an `exited` process; the degraded `liveness:     unknown (host-server predates liveness reporting)` line and no `last restart` line for a server lacking both fields; bare-name resolution shared with `restart` (`status dev` as each agent, ambiguity exit 2, unknown exit 1 with candidates); `list` lines with the `liveness:` column; `tail` passing the server's text body through unchanged, requesting `format=text` with `lines=50` by default, forwarding `-n 7` in both argument orders, clamping `-n 5000` to `lines=1000` with a note, rejecting `abc|0|-3|1.5|""` with no request sent, printing `(no output yet for quiet-proc)` for an empty body, 404 -> exit 1 with candidates, ambiguity exit 2, and working without `jq`.
- **Steps**:
  1. Run the command below as-is. Its output file is reused by UAT-EDGE-008.
- **Command**:
  ```bash
  bash scripts/verify-dev-commands-restart.sh > tmp/uat-0204/verify-restart.out 2>&1; echo "rc=$?"; tail -n 1 tmp/uat-0204/verify-restart.out; grep -c 'PASS:' tmp/uat-0204/verify-restart.out; grep -c 'FAIL:' tmp/uat-0204/verify-restart.out; grep -c 'SKIP:' tmp/uat-0204/verify-restart.out
  ```
- **Expected Result**: `rc=0`, the last line `[verify-dev-commands-restart] PASS — 149 check(s) passed, 0 skipped` (`149` or more if a later task appends checks), then `149` (the number of `PASS:` lines, equal to the check count), `0` (no `FAIL:` line) and `0` (no `SKIP:` line; a skip means `jq` or `node` is missing, so report the case BLOCKED rather than passed). If it reports many `FAIL:` lines with empty `stdout=`/`stderr=` text, another run collided on the shared scratch dir: re-run once.
- **Repeatable Unit Test**: Created: `scripts/verify-dev-commands-restart.sh` (extended in place by TASK-0204; the filename keeps its TASK-0203 name)
- **Unit Test Command**: `bash scripts/verify-dev-commands-restart.sh`
- [ ] Pass

### UAT-INT-001: the skill script and both verify scripts parse, and the skill frontmatter verifier passes
- **Description**: `bash -n` on the three shell files TASK-0204 touched, then `scripts/verify-dev-commands-skill-frontmatter.sh`, which checks the `SKILL.md` frontmatter (the task requires `description`/`argument-hint` to stay in step with TASK-0203's edit: `{list|status|tail|restart}`).
- **Steps**:
  1. Run the two commands below as-is.
- **Command**:
  ```bash
  bash -n skills/dev-commands/scripts/dev-commands.sh && bash -n scripts/verify-dev-commands.sh && bash -n scripts/verify-dev-commands-restart.sh && echo SYNTAX_OK
  ```
  ```bash
  bash scripts/verify-dev-commands-skill-frontmatter.sh; echo "rc=$?"
  ```
- **Expected Result**: the first prints `SYNTAX_OK`. The second prints a `[verify-dev-commands-skill-frontmatter] PASS — ...` line (currently `PASS — disable-model-invocation: false (autonomously reachable, per task design intent)`) and `rc=0`.
- **Repeatable Unit Test**: Created: `scripts/verify-dev-commands-skill-frontmatter.sh` (existing frontmatter verifier; the syntax half is a `bash -n` gate)
- **Unit Test Command**: `bash scripts/verify-dev-commands-skill-frontmatter.sh`
- [ ] Pass

### UAT-DOC-001: `SKILL.md`, the script header, `scripts/README.md` and the wiki concept page use the real vocabulary
- **Description**: The task's `SKILL.md` requirement: every `idle/busy/running` mention for bg processes is replaced by liveness `running | exited | stopped` (server) and state-file `running | exited | dead` (monitor); the distinction is explained once near the top in agent-facing words; the `list`, `status`, `tail`, offline-resilience and notes sections are updated. `scripts/README.md` and `wiki/knowledge/concepts/background-process-registry.md` describe the new behaviour.
- **Steps**:
  1. Search `skills/dev-commands/SKILL.md` with `mcp__serena__search_for_pattern` for `idle|busy`.
  2. Read `skills/dev-commands/SKILL.md` and check the items in the expected result.
  3. Read the comment block at the top of `skills/dev-commands/scripts/dev-commands.sh` (lines 1-67) and its usage text (`mcp__serena__search_for_pattern` for `Usage: dev-commands.sh \{list`).
  4. Search `scripts/README.md` and `wiki/knowledge/concepts/background-process-registry.md` for `TASK-0204`.
- **Expected Result**:
  - Step 1 finds only the one deliberate sentence saying older state files may still hold `alive`, `idle` or `busy` as legacy values; no other line calls `idle` or `busy` a bg-process state.
  - `SKILL.md` has a "Liveness vocabulary" explanation near the top (before "When to use this tool"): `running` = window open and process alive, `exited` = window open but the process is gone (crashed or finished), pane at a shell prompt, `stopped` = no tmux window; state file `running | exited | dead` with `dead` = window not found; the state file is poll-lagged and can trail reality.
  - The process description list names the state file values `running` / `exited` / `dead`; the `list` section shows the line format `<slug> — liveness: <running|exited|stopped|unknown>, state: <state>, window: <true|false>` and says `liveness: unknown` means the host-server predates liveness reporting; the `status` section describes the four printed fields (liveness, window, last restart, poll-lagged state file), the interpretive sentence, exit 0 for a found process even when `exited`, exit 1 for an unknown name, works with no state file, and the worked example shows `liveness:     exited` next to `state file:   running`; the `tail` section documents clean text (escapes stripped, `\r` redraws collapsed, `--- restart <ts> ---` markers), the default 50 and the 1000 cap, the positive-integer rule (usage error, exit 1), `(no output yet for <slug>)` and exit 1 with candidates for an unknown process; "Offline resilience" says `tail` still works offline through a best-effort `sed` strip with the stderr note, and `status` offline has no liveness and says `Live cross-check unavailable (host-server unreachable)`; the frontmatter `description` and `argument-hint` (`{list|status|tail|restart} [options]`) mention all four subcommands.
  - The script header states that `status` is online-first, that offline it prints the state file with `running | exited | dead`, and that `tail` reads `GET /api/bg-processes/<slug>/tail?format=text` with N capped at 1000; the usage text lists `status <slug>` with `liveness (running|exited|stopped)` and `tail <slug> [-n N]` with `max 1000`.
  - `scripts/README.md` and the wiki concept page each have a paragraph/section tagged `TASK-0204` describing the online-first `status`, the text-endpoint `tail`, the offline strip and the liveness column in `list`.
- **Repeatable Unit Test**: Not applicable: documentation and comment check
- [ ] Pass

### UAT-API-001: GATE — the private host-server reports `liveness` and serves the text tail route
- **Endpoint**: `GET /api/status` (`bgProcesses[].liveness`, `lastRestart`) and `GET /api/bg-processes/:slug/tail?format=text` (port 18880, private stack)
- **Description**: A server built before TASK-0191/0192/0193 has no `liveness`/`lastRestart` on `BgStatus` and no tail route (Fastify answers its generic `404` JSON). This case fixes the server contract the script consumes, using the fixture registered in UAT-API-002, so **run it after UAT-API-002 in this order: UAT-API-002 first, then this gate**. **If either check fails, stop: mark every remaining live case (UAT-LIVE-*, UAT-EDGE-001 .. 004, UAT-EDGE-007) BLOCKED, not failed, and note that the server under test lacks the TASK-0191/0192 routes. Do not fall back to `:8788`.**
- **Steps**:
  1. Confirm the Prerequisites completed (private tmux, private server answering `[]`, `monitor` window present, wrapper created) and UAT-API-002 passed.
  2. Run the two commands below as-is.
- **Command**:
  ```bash
  curl -sS 'http://127.0.0.1:18880/api/status' | jq -c '[.bgProcesses[] | {slug, liveness, windowPresent, lastRestart}] | sort_by(.slug)'
  ```
  ```bash
  curl -sS -i 'http://127.0.0.1:18880/api/bg-processes/uat0204pa-dev/tail?lines=2&format=text' | tr -d '\r' | grep -iE '^(HTTP/|content-type)'
  ```
- **Expected Result**: the first prints `[{"slug":"uat0204pa-dev","liveness":"running","windowPresent":true,"lastRestart":null},{"slug":"uat0204pb-dev","liveness":"running","windowPresent":true,"lastRestart":null}]`. The second prints `HTTP/1.1 200 OK` and `content-type: text/plain; charset=utf-8`.
- **Repeatable Unit Test**: Not applicable: asserts the live Fastify routes (the pure logic behind them is unit-tested by UAT-0191/0192/0193)
- [ ] Pass

### UAT-API-002: register the fixture — projects A and B, one agent, and one `dev` bg process in each
- **Endpoint**: `POST /api/projects`, `POST /api/projects/:id/agents`, `POST /api/bg-processes` (private stack)
- **Description**: Projects `uat0204pa` (id 1) and `uat0204pb` (id 2). Agent `alice` in pa, whose tmux window name and therefore `CONDUCTOR_AGENT_NAME` is `uat0204pa-alice`. Bg process `dev` in each project (slugs `uat0204pa-dev` and `uat0204pb-dev`, so the bare name `dev` is ambiguous without an identity). `uat0204pa-dev` runs a launch command that prints an SGR colour, a `\r` progress redraw and then blocks: `printf '\033[31mred\033[0m text\nprog 10%%\rprog 100%%\n'; sleep 3600`; `uat0204pb-dev` just runs `sleep 3600`. A bg window is a real interactive shell that the launch command is typed into (so the log also holds the shell's own prompt escapes and start-up noise), and when the `sleep` is killed the pane falls back to that shell, which is exactly the `exited` state. Ids assume a fresh DB and this order. The agent spawn can fail transiently with `500 ... index N in use`; the agent DB row is written first, so it is harmless as long as the verification lists `alice`.
- **Steps**:
  1. Create the projects, one at a time:
     ```bash
     curl -sS -X POST 'http://127.0.0.1:18880/api/projects' -H 'Content-Type: application/json' -d '{"name":"uat0204pa","workdir":"/Users/davidtaylor/Repositories/tmux-conductor/tmp/uat-0204"}' | jq -c '{id,name}'
     ```
     ```bash
     curl -sS -X POST 'http://127.0.0.1:18880/api/projects' -H 'Content-Type: application/json' -d '{"name":"uat0204pb","workdir":"/Users/davidtaylor/Repositories/tmux-conductor/tmp/uat-0204"}' | jq -c '{id,name}'
     ```
     Expect `{"id":1,"name":"uat0204pa"}` and `{"id":2,"name":"uat0204pb"}`.
  2. Create the agent (ignore a transient `500` body; the verification below decides):
     ```bash
     curl -sS -X POST 'http://127.0.0.1:18880/api/projects/1/agents' -H 'Content-Type: application/json' -d '{"name":"alice","launchCmd":"sleep 3600"}' | jq -c '{id,name,projectId}'; sleep 3
     ```
  3. Create the bg processes, waiting between calls:
     ```bash
     curl -sS -X POST 'http://127.0.0.1:18880/api/bg-processes' -H 'Content-Type: application/json' -d '{"name":"dev","projectId":1,"workdir":"/Users/davidtaylor/Repositories/tmux-conductor/tmp/uat-0204","launchCmd":"printf '"'"'\\033[31mred\\033[0m text\\nprog 10%%\\rprog 100%%\\n'"'"'; sleep 3600"}' | jq -c '{ok, slug: .bg.slug, projectId: .bg.projectId}'; sleep 3; curl -sS -X POST 'http://127.0.0.1:18880/api/bg-processes' -H 'Content-Type: application/json' -d '{"name":"dev","projectId":2,"workdir":"/Users/davidtaylor/Repositories/tmux-conductor/tmp/uat-0204","launchCmd":"sleep 3600"}' | jq -c '{ok, slug: .bg.slug, projectId: .bg.projectId}'
     ```
  4. Wait for both shells to start their commands (the shell start-up prints some `nvm`/prompt noise first), then run the verification command below as-is.
- **Command**:
  ```bash
  sleep 12 && curl -sS 'http://127.0.0.1:18880/api/agents' | jq -c 'map({name, projectId, projectName})' && curl -sS 'http://127.0.0.1:18880/api/status' | jq -c '[.bgProcesses[] | {slug, projectId, liveness}] | sort_by(.slug)'
  ```
- **Expected Result**: step 3 prints `{"ok":true,"slug":"uat0204pa-dev","projectId":1}` then `{"ok":true,"slug":"uat0204pb-dev","projectId":2}`. The verification prints `[{"name":"alice","projectId":1,"projectName":"uat0204pa"}]` and then `[{"slug":"uat0204pa-dev","projectId":1,"liveness":"running"},{"slug":"uat0204pb-dev","projectId":2,"liveness":"running"}]`. If the agent row is missing, re-run only step 2; a bg registration that failed is re-run alone; a fixture that cannot be created makes the remaining live cases BLOCKED.
- **Repeatable Unit Test**: Not applicable: live HTTP + SQLite + tmux wiring for fixtures
- [ ] Pass

### UAT-LIVE-001: `status <bare name>` as an agent reports liveness, window, last restart and the state file, with no state file on disk
- **Description**: The core requirement. `CONDUCTOR_AGENT_NAME=uat0204pa-alice` resolves the bare name `dev` to `uat0204pa-dev` within the caller's project (announced on stderr), asks `GET /api/status`, and prints the four fields plus the interpretive sentence. `tmp/uat-0204/empty-state` holds no state file, so `state file:` must read `(none)` and the command must still succeed (the server knows the process). `last restart: never` because nothing has restarted it yet (`lastRestart: null`).
- **Steps**:
  1. Run the command below as-is.
- **Command**:
  ```bash
  bash tmp/uat-0204/dc.sh uat0204pa-alice 18880 tmp/uat-0204/empty-state status dev
  ```
- **Expected Result**: `rc=0`; stdout exactly these six lines: `uat0204pa-dev (project uat0204pa)`, `  liveness:     running`, `  window:       present`, `  last restart: never`, `  state file:   (none)  (poll-lagged, may be up to one poll interval old)`, `The process is running (its window is open and a process is in the pane).`; stderr exactly `Resolved 'dev' to 'uat0204pa-dev'`. A `State file (bg-...` header, a `Live window status` line or a missing `liveness:` line means the old state-file-first behaviour is still in place (FAIL).
- **Repeatable Unit Test**: Created: `scripts/verify-dev-commands-restart.sh` (stub cases assert the same field layout and sentences; this case proves it against the real server payload)
- **Unit Test Command**: `bash scripts/verify-dev-commands-restart.sh`
- [ ] Pass

### UAT-LIVE-002: `tail` prints clean text from the server while the raw log still holds the escapes
- **Description**: The point of switching to the endpoint. The raw log `tmp/uat-0204/logs/bg-uat0204pa-dev.log` holds the shell's prompt escape sequences, `\r` bytes (CRLF from the pty, plus the `prog 10%` -> `prog 100%` redraw) and the SGR colour from the `printf`; `dev-commands.sh tail` must print none of those bytes, keep only the final state of the `\r` redraw (`prog 100%`, never a standalone `prog 10%` line), and contain no restart marker yet. `-n 3` must return exactly 3 lines in either argument order (the value is forwarded as `lines=3`).
- **Steps**:
  1. Run the first command, then its check command (`-n 1000` is the server maximum, so the whole log is returned).
  2. Run the two `-n 3` commands, each followed by `wc -l < tmp/uat-0204/out.txt`.
- **Command**:
  ```bash
  bash tmp/uat-0204/dc.sh uat0204pa-alice 18880 tmp/uat-0204/empty-state tail dev -n 1000
  ```
  ```bash
  echo "esc-cr-bytes=$(LC_ALL=C tr -cd '\033\r' < tmp/uat-0204/out.txt | wc -c | tr -d ' ') red-text=$(grep -c 'red text' tmp/uat-0204/out.txt) prog100=$(grep -c '^prog 100%$' tmp/uat-0204/out.txt) prog10=$(grep -c '^prog 10%$' tmp/uat-0204/out.txt) markers=$(grep -c '^--- restart ' tmp/uat-0204/out.txt) raw-esc-bytes=$(LC_ALL=C tr -cd '\033' < tmp/uat-0204/logs/bg-uat0204pa-dev.log | wc -c | tr -d ' ')"
  ```
  ```bash
  bash tmp/uat-0204/dc.sh uat0204pa-alice 18880 tmp/uat-0204/empty-state tail uat0204pa-dev -n 3; wc -l < tmp/uat-0204/out.txt
  ```
  ```bash
  bash tmp/uat-0204/dc.sh uat0204pa-alice 18880 tmp/uat-0204/empty-state tail -n 3 uat0204pa-dev; wc -l < tmp/uat-0204/out.txt
  ```
- **Expected Result**: the first prints `rc=0` and the log text (stderr `Resolved 'dev' to 'uat0204pa-dev'`). The check prints `esc-cr-bytes=0 red-text=1 prog100=1 prog10=0 markers=0 raw-esc-bytes=<N>` with `<N>` greater than 0 (`red-text` may be higher than 1 only if the shell printed the text twice; it must be at least 1; `raw-esc-bytes` above 0 proves the raw file would have failed the old raw-`tail` behaviour). Each `-n 3` command prints `rc=0` and exactly 3 stdout lines, and `wc -l` prints `3`.
- **Repeatable Unit Test**: Created: `scripts/verify-dev-commands-restart.sh` (stub cases assert the text body is passed through unchanged and that `-n` is forwarded as `lines=` in both argument orders; the real ANSI stripping is the server's, UAT-0192)
- **Unit Test Command**: `bash scripts/verify-dev-commands-restart.sh`
- [ ] Pass

### UAT-LIVE-003: a process that crashed back to a shell reads `exited`, exit 0, even while the state file still says `running`
- **Description**: The stale-signal trap the task exists to fix. A `running` state file is written by hand into `tmp/uat-0204/stale-state/` (the poll-lagged file the monitor would have left), then `Ctrl-C` is sent to the `uat0204pa-dev` window so `sleep 3600` dies and the pane falls back to its shell. `status` must put the server's `liveness: exited` first, keep `window: present`, show the stale `running` state file labelled poll-lagged, interpret `exited`, and still exit 0 (the exit code reports the lookup, not the process's health). `list` must carry `liveness: exited` ahead of `state:` and `window:` in the line, keeping the older tokens in order.
- **Steps**:
  1. Run the first command (writes the stale state file and interrupts the process), wait, then run the two script commands.
- **Command**:
  ```bash
  printf running > tmp/uat-0204/stale-state/bg-uat0204pa-dev.state && env -u TMUX -u TMUX_PANE TMUX_TMPDIR="$PWD/tmp/uat-0204/tmux" tmux send-keys -t uat0204:uat0204pa-dev C-c
  ```
  ```bash
  sleep 5 && bash tmp/uat-0204/dc.sh uat0204pa-alice 18880 tmp/uat-0204/stale-state status uat0204pa-dev
  ```
  ```bash
  bash tmp/uat-0204/dc.sh - 18880 tmp/uat-0204/stale-state list --all
  ```
- **Expected Result**: the status command prints `rc=0`; stdout exactly `uat0204pa-dev (project uat0204pa)`, `  liveness:     exited`, `  window:       present`, `  last restart: never`, `  state file:   running  (poll-lagged, may be up to one poll interval old)`, `The process is not running (window is at a shell prompt); check 'tail', then 'restart' if appropriate.`; empty stderr. The list command prints `rc=0`, `Background processes (all projects):` and, in this order, `uat0204pa-dev — liveness: exited, state: <S>, window: true, project: uat0204pa` and `uat0204pb-dev — liveness: running, state: <S>, window: true, project: uat0204pb` (`<S>` is whatever the server reports for the state, observed `null`; any single token without a comma is accepted).
- **Repeatable Unit Test**: Created: `scripts/verify-dev-commands-restart.sh` (stub cases assert the `exited` layout and sentence, exit 0, and the `list` liveness column; this case proves it against a real crashed pane)
- **Unit Test Command**: `bash scripts/verify-dev-commands-restart.sh`
- [ ] Pass

### UAT-LIVE-004: after a restart, `status` shows `running` with the restart, and `tail` carries one `--- restart <ts> ---` marker with clean text on both sides
- **Description**: The task's live smoke recipe (steps 6-7). `restart dev` as `uat0204pa-alice` (this is the TASK-0203 subcommand, used here only to create the restart; the cooldown is 30 s, so do not repeat it) then `status` must show `liveness: running` and `last restart: <ts> by uat0204pa-alice`, and `tail` must show exactly one restart marker whose timestamp equals that `last restart` timestamp, no ESC or CR bytes anywhere, and `prog 100%` once before and once after the marker.
- **Steps**:
  1. Run the restart command, then (after the wait) the status command, then the tail command and its check, then the timestamp-match command.
- **Command**:
  ```bash
  bash tmp/uat-0204/dc.sh uat0204pa-alice 18880 tmp/uat-0204/stale-state restart dev
  ```
  ```bash
  sleep 8 && bash tmp/uat-0204/dc.sh uat0204pa-alice 18880 tmp/uat-0204/stale-state status uat0204pa-dev
  ```
  ```bash
  bash tmp/uat-0204/dc.sh uat0204pa-alice 18880 tmp/uat-0204/stale-state tail dev -n 1000 > /dev/null; echo "markers=$(grep -c '^--- restart 20[0-9T:.Z-]* ---$' tmp/uat-0204/out.txt) esc-cr-bytes=$(LC_ALL=C tr -cd '\033\r' < tmp/uat-0204/out.txt | wc -c | tr -d ' ') prog100=$(grep -c '^prog 100%$' tmp/uat-0204/out.txt) prog10=$(grep -c '^prog 10%$' tmp/uat-0204/out.txt)"
  ```
  ```bash
  M=$(grep '^--- restart ' tmp/uat-0204/out.txt | sed 's/^--- restart \(.*\) ---$/\1/'); bash tmp/uat-0204/dc.sh uat0204pa-alice 18880 tmp/uat-0204/stale-state status uat0204pa-dev > /dev/null; echo "marker-ts=$M ts-match=$(grep -c "last restart: $M by uat0204pa-alice" tmp/uat-0204/out.txt)"
  ```
- **Expected Result**: the restart command prints `rc=0` and stdout `Restarted uat0204pa-dev at <ISO ts>. Use 'dev-commands.sh tail uat0204pa-dev' to watch it come back up.` (stderr `Resolved 'dev' to 'uat0204pa-dev'`). The status command prints `rc=0` and stdout `uat0204pa-dev (project uat0204pa)`, `  liveness:     running`, `  window:       present`, `  last restart: <ISO ts> by uat0204pa-alice`, the `state file:` line (still `running` from the hand-written file), and `The process is running (its window is open and a process is in the pane).`. The tail check prints `markers=1 esc-cr-bytes=0 prog100=2 prog10=0` (`prog100` at least 2: once from the output before the crash and once after the restart). The last command prints `marker-ts=<ISO ts> ts-match=1` with the same ISO ts as in the restart line.
- **Repeatable Unit Test**: Not applicable: live tmux respawn plus the server's marker; the stub cases in UAT-UNIT-002 cover the rendering of `lastRestart` and the pass-through of the marker text
- [ ] Pass

### UAT-EDGE-001: `tail -n` must be a positive integer; larger values are clamped to the 1000 cap; both argument orders work
- **Scenario**: A non-integer, zero, negative or fractional `-n`, and a missing value, are usage errors (exit 1, no request); `-n 5000` still succeeds but is clamped locally and says so on stderr (the server maximum is 1000, so a larger request must not quietly return a misleading result).
- **Steps**:
  1. Run the four commands below as-is.
- **Command**:
  ```bash
  for bad in abc 0 -3 1.5; do bash tmp/uat-0204/dc.sh uat0204pa-alice 18880 tmp/uat-0204/empty-state tail dev -n "$bad" | grep -E '^(rc=|Usage)'; done
  ```
  ```bash
  bash tmp/uat-0204/dc.sh uat0204pa-alice 18880 tmp/uat-0204/empty-state tail dev -n
  ```
  ```bash
  bash tmp/uat-0204/dc.sh uat0204pa-alice 18880 tmp/uat-0204/empty-state tail dev -n 5000 | grep -E '^(rc=|Note)'
  ```
  ```bash
  bash tmp/uat-0204/dc.sh uat0204pa-alice 18880 tmp/uat-0204/empty-state tail
  ```
- **Expected Result**: the loop prints, for each of `abc`, `0`, `-3`, `1.5`, `rc=1` and `Usage: dev-commands.sh tail <slug> [-n N]  (N must be a positive integer, got '<bad>')` (eight lines). The second prints `rc=1`, empty stdout, stderr `Usage: dev-commands.sh tail <slug> [-n N]`. The third prints `rc=0` and `Note: -n is capped at 1000 lines (the host-server maximum).`. The fourth prints `rc=1`, empty stdout and stderr `Usage: dev-commands.sh tail <slug> [-n N]`. (The `-n 3` in both orders is asserted in UAT-LIVE-002.)
- **Repeatable Unit Test**: Created: `scripts/verify-dev-commands-restart.sh` (asserts the same rules against the stub, including that no request is sent for an invalid `-n`, and the 1000 clamp as `lines=1000`) and `scripts/verify-dev-commands.sh` (offline `-n abc|0|-2|1.5`)
- **Unit Test Command**: `bash scripts/verify-dev-commands-restart.sh`
- [ ] Pass

### UAT-EDGE-002: an unknown name is exit 1 with the candidate list, for both `status` and `tail`
- **Scenario**: `ghost` is not registered on the server and has no state file. `status` must say so and list the registered slugs; `tail` gets the endpoint's 404 and reports it the same way. Neither prints a raw shell or curl error.
- **Steps**:
  1. Run the two commands below as-is.
- **Command**:
  ```bash
  bash tmp/uat-0204/dc.sh uat0204pa-alice 18880 tmp/uat-0204/empty-state status ghost
  ```
  ```bash
  bash tmp/uat-0204/dc.sh uat0204pa-alice 18880 tmp/uat-0204/empty-state tail ghost
  ```
- **Expected Result**: first: `rc=1`, empty stdout, stderr `No such background process 'ghost' (not registered on the host-server, and no state file).`, `Registered slugs:`, `  uat0204pa-dev`, `  uat0204pb-dev`. Second: `rc=1`, empty stdout, stderr `No such background process: ghost`, `Registered slugs:`, `  uat0204pa-dev`, `  uat0204pb-dev`.
- **Repeatable Unit Test**: Created: `scripts/verify-dev-commands-restart.sh` (`status <unknown>` -> exit 1 + candidates, `tail <unknown>` -> 404 -> exit 1 + candidates, against the stub)
- **Unit Test Command**: `bash scripts/verify-dev-commands-restart.sh`
- [ ] Pass

### UAT-EDGE-003: an ambiguous bare name is exit 2 for `status`/`tail` (exit 1 for `restart`), and no request is made against either process
- **Scenario**: Both projects own a process called `dev`. With no caller identity (`CONDUCTOR_AGENT_NAME` unset) the bare name matches two slugs, so all three subcommands must list the candidates and refuse; `status`/`tail` keep their historical exit 2, `restart` exits 1 (and must not restart anything).
- **Steps**:
  1. Run the three commands below as-is.
- **Command**:
  ```bash
  bash tmp/uat-0204/dc.sh - 18880 tmp/uat-0204/empty-state status dev
  ```
  ```bash
  bash tmp/uat-0204/dc.sh - 18880 tmp/uat-0204/empty-state tail dev
  ```
  ```bash
  bash tmp/uat-0204/dc.sh - 18880 tmp/uat-0204/empty-state restart dev
  ```
- **Expected Result**: the first two print `rc=2`, empty stdout, and stderr `Ambiguous name 'dev' — matches 2 registered processes; use the full slug:`, `  uat0204pa-dev`, `  uat0204pb-dev`. The third prints `rc=1`, empty stdout and the same three stderr lines. (`status dev` as `uat0204pa-alice` resolving to `uat0204pa-dev` is asserted in UAT-LIVE-001.)
- **Repeatable Unit Test**: Created: `scripts/verify-dev-commands-restart.sh` (ambiguous bare name: `status`/`tail` exit 2 with both candidates, `restart` exit 1 with no POST sent)
- **Unit Test Command**: `bash scripts/verify-dev-commands-restart.sh`
- [ ] Pass

### UAT-EDGE-004: a registered process with no log yet is `(no output yet for <slug>)`, exit 0
- **Scenario**: The endpoint answers 200 with an empty body for a registered process whose log file does not exist; that is not an error. The log of `uat0204pb-dev` is deleted (its `pipe-pane` writer keeps an unlinked handle, so the server sees no file).
- **Steps**:
  1. Run the two commands below as-is.
- **Command**:
  ```bash
  rm -f tmp/uat-0204/logs/bg-uat0204pb-dev.log && bash tmp/uat-0204/dc.sh - 18880 tmp/uat-0204/empty-state tail uat0204pb-dev
  ```
  ```bash
  bash tmp/uat-0204/dc.sh - 18880 tmp/uat-0204/empty-state status uat0204pb-dev
  ```
- **Expected Result**: the first prints `rc=0`, stdout exactly `(no output yet for uat0204pb-dev)` and empty stderr. The second prints `rc=0` and stdout `uat0204pb-dev (project uat0204pb)`, `  liveness:     running`, `  window:       present`, `  last restart: never`, `  state file:   (none)  (poll-lagged, may be up to one poll interval old)` and the running sentence (a missing log does not affect status).
- **Repeatable Unit Test**: Created: `scripts/verify-dev-commands-restart.sh` (`tail quiet-proc`: empty body -> `(no output yet for quiet-proc)`, exit 0)
- **Unit Test Command**: `bash scripts/verify-dev-commands-restart.sh`
- [ ] Pass

### UAT-EDGE-005: offline `status` prints the state file in the real vocabulary, with the unchanged labelled strings
- **Scenario**: The host-server is unreachable (`BACKEND_PORT=18889`, nothing listens). `status` must fall back to the state file, labelled poll-lagged, interpret `exited` / `dead` / `running` with the monitor's vocabulary, print a pre-TASK-0191 value (`busy`) as-is flagged `(legacy value)`, print the unchanged `Live cross-check unavailable (host-server unreachable)` line (so the older verify strings keep matching), resolve a bare name against the state-file names only, and never print a `liveness:` line. An unknown name has no state file: exit 1.
- **Steps**:
  1. Run the six commands below as-is (offline fixtures from the prerequisites).
- **Command**:
  ```bash
  bash tmp/uat-0204/dc.sh uat0204pa-alice 18889 tmp/uat-0204/offline-state status uat0204off-vite
  ```
  ```bash
  bash tmp/uat-0204/dc.sh uat0204pa-alice 18889 tmp/uat-0204/offline-state status uat0204off-gone
  ```
  ```bash
  bash tmp/uat-0204/dc.sh uat0204pa-alice 18889 tmp/uat-0204/offline-state status uat0204off-run
  ```
  ```bash
  bash tmp/uat-0204/dc.sh uat0204pa-alice 18889 tmp/uat-0204/offline-state status uat0204off-old
  ```
  ```bash
  bash tmp/uat-0204/dc.sh uat0204pa-alice 18889 tmp/uat-0204/offline-state status vite
  ```
  ```bash
  bash tmp/uat-0204/dc.sh uat0204pa-alice 18889 tmp/uat-0204/offline-state status uat0204off-nope
  ```
- **Expected Result**: every found process prints `rc=0`, the header `State file (bg-<slug>.state, may lag up to one poll interval):`, then the state line, an empty line and `Live cross-check unavailable (host-server unreachable)`, with empty stderr (except the `vite` run) and no `liveness:` text anywhere. The state lines are, in order: `  exited  (window open but the process is gone (crashed or finished))`; `  dead  (window not found)`; `  running  (alive in its window at the last poll)`; `  busy  (legacy value)`. The `status vite` run prints the same as the first (with slug `uat0204off-vite`) and stderr `Resolved 'vite' to 'uat0204off-vite'`. The last prints `rc=1`, empty stdout, stderr `No state file for 'uat0204off-nope' — was it ever registered?` then `Registered slugs:` and the state-file slugs.
- **Repeatable Unit Test**: Created: `scripts/verify-dev-commands.sh` (offline `status` for `exited`, `dead`, legacy `busy`, the labelled strings, and the no-state-file exit 1)
- **Unit Test Command**: `bash scripts/verify-dev-commands.sh`
- [ ] Pass

### UAT-EDGE-006: offline `tail` strips terminal escapes best-effort and keeps the missing-file message
- **Scenario**: With the host-server unreachable, `tail` reads `bg-<slug>.log` directly. The fixture log holds an SGR colour, an OSC window title, a `\r` progress redraw (`prog 10%` -> `prog 50%` -> `prog 100%`) and a CRLF line. The output must be the clean text only, the stderr note must say what happened, and a missing log keeps its message and exit 1.
- **Steps**:
  1. Run the three commands below as-is (offline log fixture from the prerequisites).
- **Command**:
  ```bash
  bash tmp/uat-0204/dc.sh uat0204pa-alice 18889 tmp/uat-0204/offline-state tail uat0204off-vite
  ```
  ```bash
  echo "esc-cr-bytes=$(LC_ALL=C tr -cd '\033\r' < tmp/uat-0204/out.txt | wc -c | tr -d ' ') lines=$(wc -l < tmp/uat-0204/out.txt | tr -d ' ')"
  ```
  ```bash
  bash tmp/uat-0204/dc.sh uat0204pa-alice 18889 tmp/uat-0204/offline-state tail uat0204off-nolog
  ```
- **Expected Result**: the first prints `rc=0`; stdout exactly `plain`, `red text`, `after-osc`, `prog 100%`, `crlf line`; stderr exactly `Note: host-server unreachable; showing the raw log with a best-effort escape strip.`. The check prints `esc-cr-bytes=0 lines=5`. The third prints `rc=1`, empty stdout, and stderr `No log file for 'uat0204off-nolog' — has it printed output yet?` followed by the `Registered slugs:` list.
- **Repeatable Unit Test**: Created: `scripts/verify-dev-commands.sh` (offline `tail`: fixture with SGR, cursor-move CSI, OSC, `\r` redraw and CRLF; the stderr note; the `No log file for 'ghost'` message; plain lines byte-identical)
- **Unit Test Command**: `bash scripts/verify-dev-commands.sh`
- [ ] Pass

### UAT-EDGE-007: without `jq`, `status` degrades to the offline state-file report; `tail` still works online
- **Scenario**: `jq` is not on `PATH` (a scratch `PATH` with only `curl`, `basename`, `sed`, `cat`, `tail`, `head`, `date`), the live server is reachable. `status` needs `jq` to read the JSON, so it must fall back to the state file with the cross-check line naming `jq`, exit 0. `tail` needs only `curl` (the body is printed as-is), so it must still return the server's clean text for an exact slug.
- **Steps**:
  1. Run the two commands below as-is (state file `bg-uat0204pa-dev.state` exists in `tmp/uat-0204/stale-state` from UAT-LIVE-003; if that case was skipped, run `printf running > tmp/uat-0204/stale-state/bg-uat0204pa-dev.state` first).
- **Command**:
  ```bash
  mkdir -p tmp/uat-0204/nojq-bin && for t in curl basename sed cat tail head date; do ln -sf "$(command -v $t)" tmp/uat-0204/nojq-bin/$t; done; PATH="$PWD/tmp/uat-0204/nojq-bin" /bin/bash tmp/uat-0204/dc.sh uat0204pa-alice 18880 tmp/uat-0204/stale-state status uat0204pa-dev
  ```
  ```bash
  PATH="$PWD/tmp/uat-0204/nojq-bin" /bin/bash tmp/uat-0204/dc.sh uat0204pa-alice 18880 tmp/uat-0204/stale-state tail uat0204pa-dev -n 3; wc -l < tmp/uat-0204/out.txt
  ```
- **Expected Result**: the first prints `rc=0`; stdout `State file (bg-uat0204pa-dev.state, may lag up to one poll interval):`, `  running  (alive in its window at the last poll)`, an empty line, `Live cross-check unavailable (jq not installed)`; empty stderr; no `liveness:` line. The second prints `rc=0`, exactly 3 lines of clean log text on stdout (no ESC or CR bytes), empty stderr, and `wc -l` prints `3`.
- **Repeatable Unit Test**: Created: `scripts/verify-dev-commands-restart.sh` (its no-`jq` block asserts `tail` against the stub with a `jq`-less `PATH`; the `status` fallback text is the same code path as the offline check in UAT-EDGE-005)
- **Unit Test Command**: `bash scripts/verify-dev-commands-restart.sh`
- [ ] Pass

### UAT-EDGE-008: a host-server that predates liveness reporting degrades instead of failing (stub server)
- **Scenario**: A server whose `/api/status` entries carry neither `liveness` nor `lastRestart` (an older host-server) must not break `status`: it prints `liveness:     unknown (host-server predates liveness reporting)`, falls back to the `window:` line, omits the `last restart` line entirely, exits 0, and `list` prints `liveness: unknown`. A real old server cannot be started from this working tree, so the stub-server checks of UAT-UNIT-002 are the evidence (its `ok-proc` entry carries neither field).
- **Steps**:
  1. Run UAT-UNIT-002 first (it writes `tmp/uat-0204/verify-restart.out`), then run the command below as-is.
- **Command**:
  ```bash
  grep -E 'PASS: (status against a server without liveness exits 0|status degrades when liveness is absent|status still reports the window when liveness is absent|status omits the last-restart line when the field is absent|list shows .unknown. liveness for a server without the field)' tmp/uat-0204/verify-restart.out
  ```
- **Expected Result**: exactly five `[verify-dev-commands-restart] PASS: ...` lines are printed (one per alternative above) and none of them is a `FAIL:`. An empty output means UAT-UNIT-002 was not run first, or the checks were renamed: in that case search the file for `liveness is absent` / `without liveness` and judge on the equivalent lines.
- **Repeatable Unit Test**: Created: `scripts/verify-dev-commands-restart.sh` (the five checks named above)
- **Unit Test Command**: `bash scripts/verify-dev-commands-restart.sh`
- [ ] Pass

### UAT-API-003: cleanup the private stack
- **Description**: Removes every artifact of the live cases: the private host-server, the private tmux server (which also kills the fixture agent and bg windows), and `tmp/uat-0204/`. Run last, and run it even if earlier cases failed or were blocked. The real `conductor` tmux session, `./data/conductor.db` and `./logs` are never involved.
- **Steps**:
  1. Run the command below.
  2. Confirm the live `conductor` session is untouched and the fixture directory is gone.
- **Command**:
  ```bash
  (lsof -ti tcp:18880 -sTCP:LISTEN | xargs kill; sleep 2; env -u TMUX -u TMUX_PANE TMUX_TMPDIR="$PWD/tmp/uat-0204/tmux" tmux kill-server; rm -rf tmp/uat-0204; curl -sS -m 2 -o /dev/null -w 'server=%{http_code}\n' 'http://127.0.0.1:18880/api/agents'; test -e tmp/uat-0204 && echo 'dir=present' || echo 'dir=gone'; lsof -ti tcp:18880 -sTCP:LISTEN | wc -l | tr -d ' '; tmux list-sessions -F '#S')
  ```
- **Expected Result**: `server=000` (connection refused, preceded by a curl `Failed to connect` line on stderr), `dir=gone`, `0` (nothing listening on 18880), and the final `tmux list-sessions` (the real server) still lists `conductor`. `tmux kill-server` may print `no server running on .../tmp/uat-0204/tmux/...` if the private server was already gone, and `xargs kill` may print a usage line if the port was already free; neither matters.
- **Repeatable Unit Test**: Not applicable: lifecycle cleanup of live processes and scratch files
- [ ] Pass

---

## Notes for the judge

- **Auto-judgeable without the live stack**: UAT-UNIT-001, UAT-UNIT-002 (unit-backed; run them from the repo root after the first prerequisite block), UAT-INT-001, UAT-DOC-001 (text search), UAT-EDGE-008 (reads UAT-UNIT-002's output), and the offline cases UAT-EDGE-005 and UAT-EDGE-006 (they need only the scratch dir, wrapper and offline fixtures, no server). The live cases (UAT-API-001, UAT-API-002, UAT-LIVE-001 .. 004, UAT-EDGE-001 .. 004, UAT-EDGE-007) are machine-executable end to end on the private stack; run them **in the order written except that UAT-API-002 runs before UAT-API-001**, because they share one server, one fixture, the `uat0204pa-dev` process state (running -> exited -> restarted) and `tmp/uat-0204/out.txt`/`err.txt`. Always run UAT-API-003 (cleanup), even after failures.
- **Never call the script directly**: always through `tmp/uat-0204/dc.sh`. The judge's own `CONDUCTOR_AGENT_NAME` / `BACKEND_PORT` are typically set; an unwrapped call could resolve as the judge's own agent or hit `:8788`.
- **Bg windows are real shells**: the launch command is typed into an interactive shell, so the raw log also contains the shell's prompt, its own escape sequences and start-up noise (for example an `nvm ... npm_config_prefix` warning printed by the tester's shell profile) and a title-set escape that can leave the word `printf` glued to a line (`printfred text`). None of that is under test; the assertions above deliberately match on the marker lines (`prog 100%`, `red text`, `--- restart ...`) and on the absence of ESC/CR bytes only. Do not tighten them to whole-file equality.
- **Timing**: liveness `running` is reported for a shell within a 3 s startup grace, then by the pane command. After `Ctrl-C` (UAT-LIVE-003) allow the 5 s wait; after `restart` (UAT-LIVE-004) allow the 8 s wait, and if a check races the shell start-up (the second `prog 100%` line missing), wait a few more seconds and re-run only that check command. `restart` has a 30 s per-process cooldown for identified agents: never run it twice in a row.
- **State column value**: on the private stack the server reports a bg process `state` of `null` (the monitor writes no `bg-*.state` file there), so `list` shows `state: null` and `status` shows `state file:   (none)` unless a file is written by hand into the state dir passed to the wrapper (as UAT-LIVE-003 does). Cases accept any single token without a comma for `<S>`.
- **`ambiguous` and old-server paths**: an old (no-`liveness`) host-server and a caller-identity edge cannot be produced on demand from this working tree, so they are proven with the stub server of `scripts/verify-dev-commands-restart.sh` (UAT-EDGE-008, UAT-EDGE-003).
- **Superseded sibling assertions**: UAT-0202's UAT-LIVE-006 (old `status` layout) and its no-liveness-column `list` assertions are superseded by this task; do not count them against TASK-0204.
- **Not covered here (deferred)**: GNU `sed` behaviour of the offline cleaner (only BSD `sed` on macOS is available locally; the patterns use POSIX ERE features common to both, per the task); the aggregate wiring into `scripts/verify-*.sh` runs (TASK-0208); the dashboard.
