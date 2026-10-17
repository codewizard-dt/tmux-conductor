---
id: UAT-0190
aliases: [UAT-0190]
title: "UAT: Add one atomic restart operation for a bg process that reattaches log capture and writes a restart marker"
status: passed
task: TASK-0190
created: 2026-09-20
updated: 2026-09-20
---

# UAT-0190 — UAT: Add one atomic restart operation for a bg process that reattaches log capture and writes a restart marker

implements::[[TASK-0190]]

> **Source task**: [[TASK-0190]]
> **Generated**: 2026-09-20
>
> **What changed**: new `host-server/bgRestart.ts` (`buildBgSpawnArgs`, `restartBgProcess`, `startBgWindow`, `formatRestartMarker`, `shellSingleQuote`, `descendantPids`, `defaultBgRestartDeps`) and a new route `POST /api/bg-processes/:slug/restart` in `host-server/index.ts`. `POST /api/bg-processes/:slug/window` and window creation in `POST /api/bg-processes` now spawn through `startBgWindow` (argv arrays, so `launchCmd`/`workdir` are no longer mangled by shell re-parsing). The restart sequence is the one measured in TASK-0189: `respawn-window -k` with no command, SIGKILL any survivor of the old process tree, re-attach `pipe-pane` (never `-o`) only when `#{pane_pipe}` reads `0`, append a server-side `--- restart <ts> ---` marker after the respawn and before typing, then `send-keys -l --` and a separate `Enter`. A missing window takes the start path (`new-window`).
>
> **Out of scope**: cooldown and caller audit (TASK-0193), same-project guard (TASK-0194), liveness (TASK-0191), output endpoint (TASK-0192). No SSE event is emitted by the restart route by design; the dashboard picks the new state up on its next poll.

This UAT carries the live smoke recipe that TASK-0190 Step 5 marked `[DEFERRED-TO-UAT]`.

---

## Prerequisites

**Isolation rules (read first).** Every live case (UAT-API-*, UAT-LIVE-*) runs against a **private stack**: its own tmux server (`TMUX_TMPDIR=tmp/uat-0190/tmux`, session `uat0190`), its own conf and SQLite DB (`tmp/uat-0190/`), and its own host-server on port **18790**. Never send a request to `:8788`, never touch the live `conductor` tmux session, and never restart the real `dev` / `dev-stack` bg processes. The host-server on `:8788` may be a stale build without the restart route; it is deliberately not used. Every tmux command below is prefixed with `env -u TMUX -u TMUX_PANE TMUX_TMPDIR="$PWD/tmp/uat-0190/tmux"` so it reaches the private server even when the shell itself runs inside tmux. No `.env` file is read or written; all scratch files live in `./tmp/uat-0190/`.

- [ ] Run everything from the repo root `/Users/davidtaylor/Repositories/tmux-conductor`. Tools needed: `tmux` (>= 3.0), `node`, `curl`, `jq`, `lsof`. Port 18790 is free.
- [ ] Only for the live cases: create a fresh scratch dir (also holds a workdir containing a space) and private conf:
  ```bash
  rm -rf tmp/uat-0190 && mkdir -p tmp/uat-0190/tmux 'tmp/uat-0190/work dir' tmp/uat-0190/data tmp/uat-0190/logs/state && printf '%s\n' 'SESSION_NAME="uat0190"' 'DB_PATH="./data/conductor.db"' 'LOG_DIR="./logs"' 'STATE_DIR="./logs/state"' 'POLL_INTERVAL=15' > tmp/uat-0190/conductor.conf
  ```
- [ ] Start the private tmux server with a keeper window (the session must exist so the restart route does not answer 409):
  ```bash
  env -u TMUX -u TMUX_PANE TMUX_TMPDIR="$PWD/tmp/uat-0190/tmux" tmux new-session -d -s uat0190 -n keeper 'sleep 3600'
  ```
- [ ] Start the private host-server from the working tree (run in the background; it needs to stay up until UAT-API-008). It binds 127.0.0.1:18790 and reads `CONDUCTOR_CONF`, so it never touches `./data/conductor.db`:
  ```bash
  R="$PWD"; cd host-server && env -u TMUX -u TMUX_PANE TMUX_TMPDIR="$R/tmp/uat-0190/tmux" CONDUCTOR_CONF="$R/tmp/uat-0190/conductor.conf" BACKEND_PORT=18790 PORT=18790 nohup node --import tsx/esm index.ts > "$R/tmp/uat-0190/server.log" 2>&1 &
  ```
- [ ] Wait for it to answer (an empty agent list proves it is the private, empty DB, not the live server):
  ```bash
  sleep 6 && curl -sS 'http://127.0.0.1:18790/api/agents'
  ```
  Expected: `[]`. If this does not print `[]`, stop and mark every live case BLOCKED.

Unit and typecheck cases (UAT-UNIT-*, UAT-EDGE-*, UAT-INT-001, UAT-DOC-001) need none of the live stack.

---

## Test Cases

### UAT-UNIT-001: whole `bgRestart.test.ts` suite passes (45 tests)
- **Description**: The module-level suite covers every documented behaviour of the shared spawn/restart module against stub deps (no live tmux): quoting, ordering, start path, failure handling, marker format, process-tree walk.
- **Steps**:
  1. Run the command below from the repo root.
- **Command**:
  ```bash
  cd host-server && node --import tsx/esm --test bgRestart.test.ts
  ```
- **Expected Result**: `tests 45`, `pass 45`, `fail 0`, `cancelled 0`, `skipped 0`; exit code 0.
- **Repeatable Unit Test**: Created: `host-server/bgRestart.test.ts`
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test bgRestart.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-EDGE-001: launchCmd and workdir reach tmux as single intact argv elements (never shell-interpolated)
- **Scenario**: A `launchCmd` containing `"`, `$HOME`, backticks and spaces, and a `workdir` containing a space, must each be exactly one argv element (`-l --` typed element, and the element after `-c`). The only shell string is the `pipe-pane` target with a single-quote-escaped log path (a `'` in the log dir is escaped as `'\''`), and `Enter` is always a separate `send-keys` call.
- **Steps**:
  1. Run the command below (the `buildBgSpawnArgs`, `shellSingleQuote` and `formatRestartMarker` suites).
- **Command**:
  ```bash
  cd host-server && node --import tsx/esm --test --test-name-pattern='buildBgSpawnArgs|shellSingleQuote' bgRestart.test.ts
  ```
- **Expected Result**: `tests 11`, `pass 11`, `fail 0`. Tests include `passes a launchCmd containing ", $HOME, backticks and quotes as ONE intact argv element`, `passes a workdir with spaces as its own element after -c`, `pipePane has no -o and its single-quoted shell string is the ONLY element containing cat >>`, `never interpolates launchCmd or workdir into any other element`.
- **Repeatable Unit Test**: Created: `host-server/bgRestart.test.ts`
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern='buildBgSpawnArgs|shellSingleQuote' bgRestart.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-EDGE-002: restart runs the exact TASK-0189 ordered sequence, with the marker after respawn and before typing
- **Scenario**: Window present. Order must be: capture `#{pane_pid}` and descendants, `respawn-window -k -t <session>:=<slug> -c <workdir>` (no command element), SIGKILL only captured pids still alive and only after the respawn (never the root before it), the `#{pane_pipe}` guard, marker written exactly once, then `send-keys -l --` and a separate `Enter`. Every call after the respawn uses the exact-match target. Marker format is `--- restart <ISO-8601 UTC> ---`.
- **Steps**:
  1. Run the command below (the `window present` suite plus the marker-format tests).
- **Command**:
  ```bash
  cd host-server && node --import tsx/esm --test --test-name-pattern='window present|formatRestartMarker|descendantPids' bgRestart.test.ts
  ```
- **Expected Result**: `tests 16`, `pass 16`, `fail 0`. Includes `runs the exact ordered sequence when the pipe survived the respawn`, `kills only captured pids that are still alive, all AFTER respawn-window; never the root before it`, `writes the marker exactly once, after respawn (and reattach) and before the typed send-keys`, and `matches the documented --- restart <ts> --- format exactly`.
- **Repeatable Unit Test**: Created: `host-server/bgRestart.test.ts`
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern='window present|formatRestartMarker|descendantPids' bgRestart.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-EDGE-003: the pipe-pane reattach never toggles a live pipe off
- **Scenario**: `pipe-pane -o` toggles an existing pipe off, so it must never be issued. The restart must run no `pipe-pane` at all when `#{pane_pipe}` reads `1`, and a plain `pipe-pane` (no `-o`) before the marker only when it reads `0`.
- **Steps**:
  1. Run the command below.
- **Command**:
  ```bash
  cd host-server && node --import tsx/esm --test --test-name-pattern='pane_pipe' bgRestart.test.ts
  ```
- **Expected Result**: `tests 4`, `pass 4`, `fail 0`. Includes `does not run pipe-pane at all when #{pane_pipe} reads 1` and `reattaches with a plain pipe-pane (no -o) only when #{pane_pipe} reads 0, before the marker`.
- **Repeatable Unit Test**: Created: `host-server/bgRestart.test.ts`
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern='pane_pipe' bgRestart.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-EDGE-004: a missing window takes the start path; the open-window helper types after capture is attached and writes no marker
- **Scenario**: `restartBgProcess` with the window absent behaves like start (`new-window -d`, `pipe-pane` before typing, marker, type, Enter) and never respawns, reads the pane pid, walks the process table or kills anything. `startBgWindow` (used by `POST /bg-processes/:slug/window` and window creation in `POST /bg-processes`) does the same without a marker.
- **Steps**:
  1. Run the command below.
- **Command**:
  ```bash
  cd host-server && node --import tsx/esm --test --test-name-pattern='window missing|startBgWindow' bgRestart.test.ts
  ```
- **Expected Result**: `tests 7`, `pass 7`, `fail 0`.
- **Repeatable Unit Test**: Created: `host-server/bgRestart.test.ts`
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern='window missing|startBgWindow' bgRestart.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-EDGE-005: any failing tmux step returns a typed error, writes no marker before the failure point, and types nothing
- **Scenario**: A failure at `new-window`, `pipe-pane`, `pane-pid`, `respawn-window` or `pane-pipe` returns `{ ok: false, step, status }` with no marker written and nothing typed; a `respawn-window` failure kills no survivor; a failed marker write returns step `write-marker` (status `null`) and types nothing; a `send-keys` / separate-`Enter` failure returns `send-keys` / `send-enter` with the marker already written once (the TASK-0189 ordering).
- **Steps**:
  1. Run the command below.
- **Command**:
  ```bash
  cd host-server && node --import tsx/esm --test --test-name-pattern='failures' bgRestart.test.ts
  ```
- **Expected Result**: `tests 11`, `pass 11`, `fail 0`.
- **Repeatable Unit Test**: Created: `host-server/bgRestart.test.ts`
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern='failures' bgRestart.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-INT-001: host-server typechecks with the new module and routes
- **Description**: `bgRestart.ts` and the route wiring in `host-server/index.ts` typecheck under the repo's strict config.
- **Steps**:
  1. Run the command below.
- **Command**:
  ```bash
  cd host-server && npx tsc --noEmit
  ```
- **Expected Result**: no output; exit code 0.
- **Repeatable Unit Test**: Not applicable: type-level check, covered by the host-server typecheck gate rather than a runtime assertion
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-001: GATE — the private host-server has the restart route (unknown slug returns the route's own 404)
- **Endpoint**: `POST /api/bg-processes/:slug/restart` (port 18790, private stack)
- **Description**: A server without the route answers Fastify's generic `{"message":"Route POST:/api/bg-processes/.../restart not found","error":"Not Found","statusCode":404}`. The new route answers a slug it cannot resolve with `{"error":"bg process '<slug>' not found"}`. This test both pins the route as present and proves the 404 contract for an unknown slug. **If the body does not match exactly, stop: mark every remaining live case (UAT-API-002 onward, UAT-LIVE-*) BLOCKED.** Do not fall back to `:8788`.
- **Steps**:
  1. Confirm the Prerequisites completed (private tmux, private server answering `[]`).
  2. Run the curl command below as-is.
- **Command**:
  ```bash
  curl -sS -i -X POST 'http://127.0.0.1:18790/api/bg-processes/uat0190proj-nope/restart'
  ```
- **Expected Result**: `HTTP/1.1 404 Not Found` and body exactly `{"error":"bg process 'uat0190proj-nope' not found"}` (no `"message"` / `"statusCode"` keys).
- **Repeatable Unit Test**: Not applicable: asserts the live Fastify route; `host-server/index.ts` has no route-level test harness (it calls `listen()` at import time)
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-002: register a throwaway project and a bg process whose command and workdir need quoting
- **Endpoint**: `POST /api/projects`, then `POST /api/bg-processes` (private stack)
- **Description**: The smoke fixture from TASK-0190 Step 5. The bg process has a workdir containing a space and a `launchCmd` with double quotes and `$HOME`, so the shared `startBgWindow` path is exercised for real. Slug is `<projectName>-<name>` = `uat0190proj-smoke`.
- **Steps**:
  1. Create the project (a fresh DB assigns id `1`):
     ```bash
     curl -sS -X POST 'http://127.0.0.1:18790/api/projects' -H 'Content-Type: application/json' -d '{"name":"uat0190proj","workdir":"/Users/davidtaylor/Repositories/tmux-conductor/tmp/uat-0190"}' | jq -c '{id,name}'
     ```
     Expect `{"id":1,"name":"uat0190proj"}`.
  2. Run the curl command below as-is.
- **Command**:
  ```bash
  curl -sS -X POST 'http://127.0.0.1:18790/api/bg-processes' -H 'Content-Type: application/json' -d '{"name":"smoke","projectId":1,"workdir":"/Users/davidtaylor/Repositories/tmux-conductor/tmp/uat-0190/work dir","launchCmd":"i=0; while true; do i=$((i+1)); echo \"tick $i $HOME\"; sleep 1; done"}' | jq -c '{ok, slug: .bg.slug, projectId: .bg.projectId}'
  ```
- **Expected Result**: HTTP 201 body reduced by jq to `{"ok":true,"slug":"uat0190proj-smoke","projectId":1}`.
- **Repeatable Unit Test**: Not applicable: live HTTP + SQLite + tmux wiring (the spawn argv it delegates to is unit-covered by UAT-EDGE-001 and UAT-EDGE-004)
- [x] Pass <!-- 2026-09-20 -->

### UAT-LIVE-001: the started process saw its workdir with a space and a correctly expanded `$HOME`
- **Description**: Proves the quoting fix on the real spawn path. The pane's current directory must be the spaced workdir (passed as one `-c` element), and `$HOME` must have been expanded by the shell at run time (`tick 1 /Users/...`), not mangled or expanded by the server.
- **Steps**:
  1. Wait 4 seconds after UAT-API-002 and run the two commands below.
- **Command**:
  ```bash
  sleep 4 && env -u TMUX -u TMUX_PANE TMUX_TMPDIR="$PWD/tmp/uat-0190/tmux" tmux display-message -p -t 'uat0190:=uat0190proj-smoke' '#{pane_current_path}'
  ```
  ```bash
  curl -sS 'http://127.0.0.1:18790/api/bg-processes/uat0190proj-smoke/tail?lines=60&format=text' | grep -oE 'tick [0-9]+ /[^ ]*' | head -3
  ```
- **Expected Result**: First command prints `/Users/davidtaylor/Repositories/tmux-conductor/tmp/uat-0190/work dir`. Second prints three lines of the form `tick 1 /Users/davidtaylor`, `tick 2 /Users/davidtaylor`, `tick 3 /Users/davidtaylor` (the counter climbs and the second field is an absolute path, never the literal `$HOME`). Shell start-up noise elsewhere in the log (prompt redraws, nvm warnings) is expected and ignored.
- **Repeatable Unit Test**: Not applicable: needs a real interactive shell in a real tmux pane (argv-level quoting is unit-covered by UAT-EDGE-001)
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-003: restart of a running process returns 200 with the documented body
- **Endpoint**: `POST /api/bg-processes/uat0190proj-smoke/restart`
- **Description**: The window exists, so the mechanism is `respawn-window`. The body is `{ ok, name, restartedAt, mechanism }`, with `name` the slug and `restartedAt` an ISO-8601 UTC timestamp.
- **Steps**:
  1. Confirm UAT-LIVE-001 showed at least `tick 3` (the process has been running a few seconds).
  2. Run the curl command below as-is.
- **Command**:
  ```bash
  curl -sS -X POST 'http://127.0.0.1:18790/api/bg-processes/uat0190proj-smoke/restart' | jq -c '{ok, name, mechanism, iso: (.restartedAt | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$"))}'
  ```
- **Expected Result**: HTTP 200; `{"ok":true,"name":"uat0190proj-smoke","mechanism":"respawn-window","iso":true}`.
- **Repeatable Unit Test**: Not applicable: live route response envelope; the underlying result shape is unit-covered by UAT-EDGE-002
- [x] Pass <!-- 2026-09-20 -->

### UAT-LIVE-002: log shows the restart marker followed by a reset counter, with nothing from the old process after it
- **Description**: The core TASK-0190 acceptance check. In `bg-uat0190proj-smoke.log` the `--- restart <ts> ---` line is followed by fresh output starting at `tick 1`, counting up by exactly one with no repeats (a repeat or a jump would mean the old loop was still writing, or two loops were running). Exactly one marker exists after one restart.
- **Steps**:
  1. Wait 4 seconds after UAT-API-003, then run the two commands below.
- **Command**:
  ```bash
  sleep 4 && curl -sS 'http://127.0.0.1:18790/api/bg-processes/uat0190proj-smoke/tail?lines=200&format=text' | grep -c '^--- restart '
  ```
  ```bash
  curl -sS 'http://127.0.0.1:18790/api/bg-processes/uat0190proj-smoke/tail?lines=200&format=text' | awk '/^--- restart /{n=0;delete t;next} match($0,/tick [0-9]+ \//){v=substr($0,RSTART+5,RLENGTH-7)+0; t[++n]=v} END{ok=(n>=2 && t[1]==1); for(i=2;i<=n;i++) if(t[i]!=t[i-1]+1) ok=0; print "ticks_after_marker=" n, "first=" t[1], "sequential=" (ok?"yes":"no")}'
  ```
- **Expected Result**: First command prints `1`. Second prints `ticks_after_marker=N first=1 sequential=yes` with `N` >= 2 (about 3 to 5 after the wait). `sequential=no` or `first` other than `1` is a FAIL.
- **Repeatable Unit Test**: Not applicable: needs a live process writing through a real `pipe-pane`; marker ordering relative to typing is unit-covered by UAT-EDGE-002
- [x] Pass <!-- 2026-09-20 -->

### UAT-LIVE-003: log capture is still attached after the respawn, and the pane is the same window
- **Description**: The TASK-0189 finding is that the pipe survives `respawn-window -k` with no command, so `#{pane_pipe}` must still read `1` (a bare `pipe-pane -o` here would have toggled it off, and the log above would have stopped growing).
- **Steps**:
  1. Run the command below.
- **Command**:
  ```bash
  env -u TMUX -u TMUX_PANE TMUX_TMPDIR="$PWD/tmp/uat-0190/tmux" tmux display-message -p -t 'uat0190:=uat0190proj-smoke' '#{pane_pipe}'
  ```
- **Expected Result**: prints `1`.
- **Repeatable Unit Test**: Not applicable: reads live tmux pane state (the guard logic is unit-covered by UAT-EDGE-003)
- [x] Pass <!-- 2026-09-20 -->

### UAT-LIVE-004: a HUP/TERM-ignoring old process does not survive the restart as an orphan
- **Description**: `respawn-window -k` only hangs up the pty, so a process that ignores `HUP`/`TERM` outlives it and would keep holding a dev-server port. The restart must SIGKILL survivors of the old tree. The control below proves this fixture is discriminating: with a bare `respawn-window -k` and no SIGKILL the old shell **does** survive. If the control prints `gone`, the fixture is inconclusive and this case must not be marked Pass.
- **Steps**:
  1. Register a bg process whose shell ignores `HUP` and `TERM`:
     ```bash
     curl -sS -X POST 'http://127.0.0.1:18790/api/bg-processes' -H 'Content-Type: application/json' -d '{"name":"trap","projectId":1,"workdir":"/Users/davidtaylor/Repositories/tmux-conductor/tmp/uat-0190","launchCmd":"trap \"\" HUP TERM; while true; do echo held; sleep 1; done"}' | jq -c '{ok, slug: .bg.slug}'
     ```
     Expect `{"ok":true,"slug":"uat0190proj-trap"}`.
  2. Run the CONTROL command (a bare `respawn-window -k` in a scratch window, then cleans up after itself).
  3. Run the RESTART command below.
- **Command**:
  ```bash
  R="$PWD"; T() { env -u TMUX -u TMUX_PANE TMUX_TMPDIR="$R/tmp/uat-0190/tmux" tmux "$@"; }; T new-window -d -t uat0190: -n ctl -c "$R/tmp/uat-0190"; T send-keys -t 'uat0190:=ctl' -l -- 'trap "" HUP TERM; while true; do sleep 1; done'; T send-keys -t 'uat0190:=ctl' Enter; sleep 3; OLD=$(T display-message -p -t 'uat0190:=ctl' '#{pane_pid}'); T respawn-window -k -t 'uat0190:=ctl' -c "$R/tmp/uat-0190"; sleep 1; if kill -0 "$OLD" 2>/dev/null; then echo "CONTROL: survivor alive"; else echo "CONTROL: gone"; fi; kill -9 "$OLD" 2>/dev/null; T kill-window -t 'uat0190:=ctl'
  ```
  ```bash
  R="$PWD"; T() { env -u TMUX -u TMUX_PANE TMUX_TMPDIR="$R/tmp/uat-0190/tmux" tmux "$@"; }; sleep 3; OLD=$(T display-message -p -t 'uat0190:=uat0190proj-trap' '#{pane_pid}'); if kill -0 "$OLD" 2>/dev/null; then echo "before: pid $OLD alive"; fi; curl -sS -X POST 'http://127.0.0.1:18790/api/bg-processes/uat0190proj-trap/restart' | jq -c '{ok, mechanism}'; sleep 1; if kill -0 "$OLD" 2>/dev/null; then echo "AFTER: SURVIVED"; else echo "AFTER: KILLED"; fi
  ```
- **Expected Result**: CONTROL prints `CONTROL: survivor alive`. RESTART prints `before: pid <N> alive`, then `{"ok":true,"mechanism":"respawn-window"}`, then `AFTER: KILLED`. `AFTER: SURVIVED` is a FAIL.
- **Repeatable Unit Test**: Created: `host-server/bgRestart.test.ts` (`kills only captured pids that are still alive, all AFTER respawn-window; never the root before it`; covers the kill ordering and liveness filter, not that a real HUP-immune process dies, which needs the live fixture)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern='kills only captured pids' bgRestart.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-004: restart with no window takes the start path (`new-window`) and still writes the marker before fresh output
- **Endpoint**: `POST /api/bg-processes/uat0190proj-smoke/restart`
- **Description**: A registered process whose window has died is brought back by one call. The mechanism is `new-window`, the pipe is attached before the command is typed, and the marker precedes the fresh counter (which restarts at 1).
- **Steps**:
  1. Kill only the smoke window (private tmux server):
     ```bash
     env -u TMUX -u TMUX_PANE TMUX_TMPDIR="$PWD/tmp/uat-0190/tmux" tmux kill-window -t 'uat0190:=uat0190proj-smoke'
     ```
  2. Run the curl command below as-is.
  3. Wait 4 seconds, then run the two verification commands below.
- **Command**:
  ```bash
  curl -sS -X POST 'http://127.0.0.1:18790/api/bg-processes/uat0190proj-smoke/restart' | jq -c '{ok, name, mechanism}'
  ```
  ```bash
  sleep 4 && curl -sS 'http://127.0.0.1:18790/api/bg-processes/uat0190proj-smoke/tail?lines=200&format=text' | awk '/^--- restart /{c++;n=0;delete t;next} match($0,/tick [0-9]+ \//){v=substr($0,RSTART+5,RLENGTH-7)+0; t[++n]=v} END{ok=(n>=2 && t[1]==1); for(i=2;i<=n;i++) if(t[i]!=t[i-1]+1) ok=0; print "markers=" c, "ticks_after_last_marker=" n, "first=" t[1], "sequential=" (ok?"yes":"no")}'
  ```
  ```bash
  env -u TMUX -u TMUX_PANE TMUX_TMPDIR="$PWD/tmp/uat-0190/tmux" tmux display-message -p -t 'uat0190:=uat0190proj-smoke' '#{pane_pipe}'
  ```
- **Expected Result**: Restart prints `{"ok":true,"name":"uat0190proj-smoke","mechanism":"new-window"}`. The awk line prints `markers=2 ticks_after_last_marker=N first=1 sequential=yes` (N >= 2; two markers because UAT-API-003 wrote the first). `#{pane_pipe}` prints `1`.
- **Repeatable Unit Test**: Created: `host-server/bgRestart.test.ts` (`window missing (start path)` suite; the mechanism selection and ordering, not the live tmux effect)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern='window missing' bgRestart.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-005: open-window route still answers 409 while the window exists
- **Endpoint**: `POST /api/bg-processes/uat0190proj-smoke/window`
- **Description**: Regression check on the refactored route: behaviour is otherwise unchanged, so a live window still yields `409 window already exists` and nothing is respawned or typed.
- **Steps**:
  1. Run the curl command below as-is (the window exists after UAT-API-004).
- **Command**:
  ```bash
  curl -sS -i -X POST 'http://127.0.0.1:18790/api/bg-processes/uat0190proj-smoke/window'
  ```
- **Expected Result**: `HTTP/1.1 409 Conflict` and body `{"error":"window already exists"}`.
- **Repeatable Unit Test**: Not applicable: route-level precondition in `host-server/index.ts` (no route test harness)
- [x] Pass <!-- 2026-09-20 -->

### UAT-LIVE-005: the refactored open-window route recreates a closed window through `startBgWindow` and writes no restart marker
- **Description**: After closing the window with `DELETE .../window`, `POST .../window` must return 201, spawn through the shared helper (workdir with a space and `$HOME` still correct), and leave the marker count unchanged (a plain open is not a restart).
- **Steps**:
  1. Close the window:
     ```bash
     curl -sS -X DELETE 'http://127.0.0.1:18790/api/bg-processes/uat0190proj-smoke/window'
     ```
     Expect `{"ok":true,"closed":"uat0190proj-smoke"}`.
  2. Reopen it:
     ```bash
     curl -sS -X POST 'http://127.0.0.1:18790/api/bg-processes/uat0190proj-smoke/window' | jq -c '{ok, slug: .bg.slug}'
     ```
     Expect `{"ok":true,"slug":"uat0190proj-smoke"}`.
  3. Wait 4 seconds and run the commands below.
- **Command**:
  ```bash
  sleep 4 && curl -sS 'http://127.0.0.1:18790/api/bg-processes/uat0190proj-smoke/tail?lines=400&format=text' | grep -c '^--- restart '
  ```
  ```bash
  env -u TMUX -u TMUX_PANE TMUX_TMPDIR="$PWD/tmp/uat-0190/tmux" tmux display-message -p -t 'uat0190:=uat0190proj-smoke' '#{pane_current_path} pipe=#{pane_pipe}'
  ```
- **Expected Result**: The marker count prints `2` (unchanged from UAT-API-004: the open did not add one). The tmux line prints `/Users/davidtaylor/Repositories/tmux-conductor/tmp/uat-0190/work dir pipe=1`.
- **Repeatable Unit Test**: Created: `host-server/bgRestart.test.ts` (`startBgWindow` suite: pipe-pane before typing, no marker, separate Enter)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern='startBgWindow' bgRestart.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-006: restart returns 409 `session not running` when the tmux session is absent
- **Endpoint**: `POST /api/bg-processes/uat0190proj-smoke/restart`
- **Description**: The route (not the module) owns the session check. It must answer 409 before any tmux mutation. **Run after every other live case: it destroys the private tmux server.**
- **Steps**:
  1. Kill the private session (this only affects the private tmux server, never the live `conductor` session):
     ```bash
     env -u TMUX -u TMUX_PANE TMUX_TMPDIR="$PWD/tmp/uat-0190/tmux" tmux kill-session -t uat0190
     ```
  2. Run the curl command below as-is.
- **Command**:
  ```bash
  curl -sS -i -X POST 'http://127.0.0.1:18790/api/bg-processes/uat0190proj-smoke/restart'
  ```
- **Expected Result**: `HTTP/1.1 409 Conflict` and body `{"error":"session not running","sessionAlive":false}`.
- **Repeatable Unit Test**: Not applicable: route-level precondition (the module intentionally leaves the session check to the route)
- [x] Pass <!-- 2026-09-20 -->

### UAT-DOC-001: CLAUDE.md and scripts/README.md document the new route
- **Description**: The `host-server/index.ts` row of the Core Scripts table in `CLAUDE.md` lists `POST /bg-processes/:slug/restart` (atomic stop+start via `bgRestart.ts`, `respawn-window -k`, keeps/re-attaches `pipe-pane`, appends a `--- restart <ts> ---` marker to `bg-<slug>.log`), and `scripts/README.md` (bg-process slug paragraph) mentions the same route.
- **Steps**:
  1. Search `CLAUDE.md` and `scripts/README.md` for `bg-processes/:slug/restart` (use `search_for_pattern` or `Read`).
  2. Read the matched text.
- **Expected Result**: `CLAUDE.md` (line ~46, inside the `host-server/index.ts` table row) and `scripts/README.md` (line ~123) each contain `POST /bg-processes/:slug/restart` with the atomic stop+start / marker description.
- **Repeatable Unit Test**: Not applicable: documentation check
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-007: cleanup the private stack
- **Description**: Removes every artifact of the live cases: the private host-server, the private tmux server, and `tmp/uat-0190/`. Run last, and run it even if earlier cases failed or were blocked. The real `conductor` tmux session and `./data/conductor.db` are never involved.
- **Steps**:
  1. Run the command below.
  2. Confirm the live `conductor` session is untouched and the fixture directory is gone.
- **Command**:
  ```bash
  (curl -sS -X DELETE 'http://127.0.0.1:18790/api/bg-processes/uat0190proj-smoke'; curl -sS -X DELETE 'http://127.0.0.1:18790/api/bg-processes/uat0190proj-trap'; lsof -ti tcp:18790 -sTCP:LISTEN | xargs kill; sleep 2; env -u TMUX -u TMUX_PANE TMUX_TMPDIR="$PWD/tmp/uat-0190/tmux" tmux kill-server; rm -rf tmp/uat-0190; curl -sS -m 2 -o /dev/null -w 'server=%{http_code}\n' 'http://127.0.0.1:18790/api/agents'; test -e tmp/uat-0190 && echo 'dir=present' || echo 'dir=gone'; tmux list-sessions -F '#S')
  ```
- **Expected Result**: `curl` reports `server=000` (connection refused; the private server is stopped), `dir=gone`, and the final `tmux list-sessions` (the real server) still lists `conductor`. Deleting the two bg processes may print `{"ok":true,"removed":"..."}` lines or 404/connection errors if the server was already down; neither matters.
- **Repeatable Unit Test**: Not applicable: lifecycle cleanup of live processes and scratch files
- [x] Pass <!-- 2026-09-20 -->

---

## Notes for the judge

- **Auto-judgeable without the live stack**: UAT-UNIT-001, UAT-EDGE-001 .. 005 (unit-backed), UAT-INT-001 (typecheck), UAT-DOC-001 (text search). The live cases (UAT-API-001 .. 006, UAT-LIVE-001 .. 005) are machine-executable end to end on the private stack, gated by UAT-API-001; they must run in the order written because they share one throwaway process.
- **Known noise in the log**: the pane runs the user's interactive zsh, so `bg-uat0190proj-smoke.log` contains prompt redraws and rc-file warnings (for example an `nvm` / `npm_config_prefix` warning when the shell is started from an npm-run parent). The commands above match only `tick N /...` and `--- restart ... ---` lines and ignore the rest.
- **Not covered live**: the route's 500 mapping (`{error:'restart failed', step, status}`) is a one-line map over the module's typed failure, which UAT-EDGE-005 covers at the module level; no reliable way exists to make a real tmux step fail on demand without breaking the private stack.
