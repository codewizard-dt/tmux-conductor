---
id: UAT-0207
aliases: [UAT-0207]
title: "UAT: Show last restart time and the triggering agent next to each process"
status: passed
task: TASK-0207
created: 2026-09-20
updated: 2026-10-17
---

# UAT-0207 — UAT: Show last restart time and the triggering agent next to each process

implements::[[TASK-0207]]

> **Source task**: [[TASK-0207]]
> **Generated**: 2026-09-20
>
> **What changed**: (server) new pure `bgStatusChanged(prev, next)` in `host-server/bgDiff.ts`, used by `pollAndDiff` in `host-server/index.ts`; besides `windowPresent` / `state` / `liveness` it now compares `lastRestart.at` and `lastRestart.caller`, so a restart that leaves the window present and liveness `running` still broadcasts a `bg-update` SSE event. The restart route deliberately emits NO SSE of its own (decision recorded in the task): the poll diff carries `lastRestart` within one `STATUS_POLL_MS` tick. (frontend) new `lib/formatRelativeTime.ts`, `lib/useNow.ts` (30 s tick) and `components/BgLastRestart.tsx` (`data-testid="bg-last-restart"`), rendered on the bg process tile (`BgProcessRow` in `AgentList.tsx`, after the launch command) and on each row of the agent detail pane's Background tab (`BackgroundProcessesTab.tsx`, under the row, outside the select button). `handleBgRestarted(slug, result)` optimistically patches `lastRestart = { at: result.restartedAt, caller: null }`.
>
> **Out of scope**: the `lastRestart` value itself and the `bg-restarts.jsonl` audit log (TASK-0193, UAT-0193), the restart route and cooldown (TASK-0190 / TASK-0193), the Restart button (TASK-0206), the `dev-commands.sh restart` subcommand (TASK-0203). The task's `[DEFERRED-TO-UAT]` live recipe is carried here (UAT-LIVE-001 .. 003, UAT-UI-001 .. 005) on a private stack; TASK-0208 owns the roadmap-level end-to-end pass.
>
> **Requirement gap found during generation (fixed)**: the first live run showed that a restart performed from the dashboard rendered the ABSOLUTE local time (`Restarted 9/20/2026, 2:48:50 AM from the dashboard`) instead of `Restarted just now from the dashboard` for up to 30 s (the `useNow` sample lagged the fresh server timestamp and `formatRelativeTime` treated it as a future time). The unit test `BgLastRestart: reads "just now" for a restart that lands between useNow ticks` encodes the requirement; the implementer has since fixed `BgLastRestart.tsx`, and UAT-UNIT-003 and UAT-UI-002 guard against a regression.

---

## Prerequisites

**Isolation rules (read first).** Every live case (UAT-LIVE-*, UAT-UI-*) runs against a **private stack**: its own tmux server (`TMUX_TMPDIR=tmp/uat-0207/tmux`, session `uat0207`), its own conf, SQLite DB and `LOG_DIR` (`tmp/uat-0207/`), its own host-server on port **18795**, and its own Vite dev server on port **18796** proxying to it. Never send a request to `:8788` or `:4321`, never touch the live `conductor` tmux session, never restart the real `dev` / `dev-stack` bg processes, and never read or write the real `logs/bg-restarts.jsonl` (the private log is `tmp/uat-0207/logs/bg-restarts.jsonl`). Every tmux command is prefixed with `env -u TMUX -u TMUX_PANE TMUX_TMPDIR="$PWD/tmp/uat-0207/tmux"`. No `.env` file is read or written by you; all scratch files live in `./tmp/uat-0207/`.

**Timing.** The private conf sets `BG_RESTART_COOLDOWN_S=15` (agent restarts are refused inside 15 s of ANY successful restart; header-less dashboard restarts are exempt). Cases that send an agent restart begin with `sleep 16`. Run the live cases in the order written; they share one agent and two throwaway bg processes. The live run takes about 3 minutes.

- [ ] Run everything from the repo root `/Users/davidtaylor/Repositories/tmux-conductor`. Tools needed: `tmux` (>= 3.0), `node`, `npx`, `curl`, `jq`, `lsof`. Ports 18795 and 18796 are free (`lsof -ti tcp:18795 -sTCP:LISTEN` and the same for 18796 print nothing).
- [ ] Only for the live cases: create the scratch dir and private conf (short cooldown, fast status poll):
  ```bash
  rm -rf tmp/uat-0207 && mkdir -p tmp/uat-0207/tmux tmp/uat-0207/data tmp/uat-0207/logs/state && printf '%s\n' 'SESSION_NAME="uat0207"' 'DB_PATH="./data/conductor.db"' 'LOG_DIR="./logs"' 'STATE_DIR="./logs/state"' 'POLL_INTERVAL=15' 'STATUS_POLL_MS=500' 'BG_RESTART_COOLDOWN_S=15' > tmp/uat-0207/conductor.conf
  ```
- [ ] Start the private tmux server with a keeper window (the session must exist so the restart route does not answer 409):
  ```bash
  env -u TMUX -u TMUX_PANE TMUX_TMPDIR="$PWD/tmp/uat-0207/tmux" tmux new-session -d -s uat0207 -n keeper 'sleep 3600'
  ```
- [ ] Start the private host-server from the working tree (background; it must stay up until UAT-UI-005). It reads `CONDUCTOR_CONF`, so it never touches `./data/conductor.db` or `./logs`:
  ```bash
  R="$PWD"; cd host-server && env -u TMUX -u TMUX_PANE TMUX_TMPDIR="$R/tmp/uat-0207/tmux" CONDUCTOR_CONF="$R/tmp/uat-0207/conductor.conf" BACKEND_PORT=18795 PORT=18795 nohup node --import tsx/esm index.ts > "$R/tmp/uat-0207/server.log" 2>&1 &
  ```
- [ ] Wait for it to answer and for its monitor auto-heal to settle (an empty agent list proves it is the private, empty DB):
  ```bash
  sleep 9 && curl -sS 'http://127.0.0.1:18795/api/agents'
  ```
  ```bash
  env -u TMUX -u TMUX_PANE TMUX_TMPDIR="$PWD/tmp/uat-0207/tmux" tmux list-windows -t uat0207 -F '#W'
  ```
  Expected: `[]`, then `keeper` and `monitor`. If the first does not print `[]`, stop and mark every live case BLOCKED.
- [ ] Only for the UI cases (UAT-UI-*): start the private Vite dev server pointed at the private host-server. It listens on `localhost` (open `http://localhost:18796/`, not `127.0.0.1`):
  ```bash
  cd frontend && (PROXY_TARGET=http://127.0.0.1:18795 FRONTEND_PORT=18796 nohup npx vite --strictPort > ../tmp/uat-0207/vite.log 2>&1 &) ; sleep 5
  ```

Unit, typecheck and lint cases (UAT-UNIT-*, UAT-INT-*) need none of the live stack.

---

## Test Cases

### UAT-UNIT-001: `bgStatusChanged` predicate and the `pollAndDiff` wiring (10 tests)
- **Description**: The pure predicate flips on first sight, on each of `windowPresent` / `state` / `liveness`, on null to non-null `lastRestart` (and back), on a changed `lastRestart.at`, and on a changed `lastRestart.caller` (agent to dashboard); it does NOT flip for identical statuses, or for both `lastRestart` null / absent. A source-text pin proves `index.ts` imports it and `pollAndDiff` broadcasts `bg-update` through it (no inline field comparison).
- **Steps**:
  1. Run the command below from the repo root.
- **Command**:
  ```bash
  cd host-server && node --import tsx/esm --test bgDiff.test.ts
  ```
- **Expected Result**: `tests 10`, `pass 10`, `fail 0`, `cancelled 0`, `skipped 0`; exit code 0. (A later task may add tests; the requirement is `fail 0` with `pass` equal to `tests` and `tests` at least 10.)
- **Repeatable Unit Test**: Created: `host-server/bgDiff.test.ts` (9 cases by the implementer; the `pollAndDiff` wiring pin added by UAT generation)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test bgDiff.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-UNIT-002: `formatRelativeTime` boundaries and degradations (6 tests)
- **Description**: `just now` below 5 s, `Ns ago` from 5 s, `Nm ago` from 60 s, `Nh ago` from 60 min, `Nd ago` from 24 h; an unparseable timestamp yields `unknown time`; up to 5 s of clock skew reads `just now`; a timestamp clearly in the future degrades to the absolute local time.
- **Steps**:
  1. Run the command below.
- **Command**:
  ```bash
  cd frontend && npx vitest run src/lib/formatRelativeTime.test.ts
  ```
- **Expected Result**: `Test Files  1 passed (1)`, `Tests  6 passed (6)`; exit code 0.
- **Repeatable Unit Test**: Created: `frontend/src/lib/formatRelativeTime.test.ts`
- **Unit Test Command**: `cd frontend && npx vitest run src/lib/formatRelativeTime.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-UNIT-003: `BgLastRestart` text, tooltip, `<time>`, aging, and the fresh-restart "just now" regression (7 tests)
- **Description**: Agent caller renders verbatim in mono as `Restarted 3m ago by <caller>` with a tooltip holding the full ISO timestamp, the caller and `reported by the caller`; a `null` caller renders `... from the dashboard`; `null` / absent `lastRestart` renders `No restarts recorded`; a semantic `<time datetime>` carries the ISO timestamp; `className` is applied; the label ages when the 30 s `useNow` tick fires; and (the requirement gap found in generation) a restart landing between two ticks reads `Restarted just now from the dashboard`, never an absolute timestamp.
- **Steps**:
  1. Run the command below.
- **Command**:
  ```bash
  cd frontend && npx vitest run src/components/BgLastRestart.test.tsx
  ```
- **Expected Result**: `Test Files  1 passed (1)`, `Tests  7 passed (7)`; exit code 0. The test named `reads "just now" for a restart that lands between useNow ticks` must be among them; a failure of that test is a FAIL of the "just now immediately" requirement.
- **Repeatable Unit Test**: Created: `frontend/src/components/BgLastRestart.test.tsx` (6 tests by the implementer; the between-ticks regression test added by UAT generation)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/BgLastRestart.test.tsx`
- [x] Pass <!-- 2026-09-20 -->

### UAT-UNIT-004: Background tab rows show the line outside the select button and re-render on a new `lastRestart`
- **Description**: Each tab row renders its own `bg-last-restart` line (`Restarted 3m ago by proj-cool-agent` for the restarted one, `No restarts recorded` for the other); the line is NOT inside the select button, so the button's accessible name is unchanged; a row receiving a new `lastRestart` re-renders the text.
- **Steps**:
  1. Run the command below.
- **Command**:
  ```bash
  cd frontend && npx vitest run src/components/BackgroundProcessesTab.test.tsx -t 'last restart line'
  ```
- **Expected Result**: `Test Files  1 passed (1)`, `Tests  2 passed`, no failures; exit code 0.
- **Repeatable Unit Test**: Created: `frontend/src/components/BackgroundProcessesTab.test.tsx`
- **Unit Test Command**: `cd frontend && npx vitest run src/components/BackgroundProcessesTab.test.tsx -t 'last restart line'`
- [x] Pass <!-- 2026-09-20 -->

### UAT-UNIT-005: tile line, live `bg-update` SSE update, and the optimistic dashboard-restart patch (AgentList)
- **Description**: The tile shows `Restarted 3m ago by alpha-agent` for a restarted process and `No restarts recorded` for one without; a `bg-update` SSE event carrying a new `lastRestart` updates the rendered tab-row text without a reload; a successful dashboard restart optimistically flips the row line to `Restarted ... from the dashboard` (the `(slug, result)` callback carrying `restartedAt`, `caller: null`).
- **Steps**:
  1. Run the command below.
- **Command**:
  ```bash
  cd frontend && npx vitest run src/components/AgentList.test.tsx -t 'the tile shows the last restart line|a bg-update SSE carrying a new lastRestart|optimistically sets the row line'
  ```
- **Expected Result**: `Test Files  1 passed (1)`, `Tests  3 passed`, the remainder skipped, no failures; exit code 0.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx`
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t 'the tile shows the last restart line|a bg-update SSE carrying a new lastRestart|optimistically sets the row line'`
- [x] Pass <!-- 2026-09-20 -->

### UAT-INT-001: both packages typecheck (touched files)
- **Description**: `host-server` and `frontend` typecheck under their strict configs with `bgDiff.ts`, the `lastRestart` diff call site, `BgLastRestart`, `formatRelativeTime`, `useNow` and the `(slug, result)` callback signature change. Other in-flight sessions may leave unrelated errors, so the frontend command filters to the files this task touched.
- **Steps**:
  1. Run the two commands below.
- **Command**:
  ```bash
  cd host-server && npx tsc --noEmit 2>&1 | grep -E 'bgDiff|index\.ts' || echo 'no errors in touched host-server files'
  ```
  ```bash
  cd frontend && npx tsc --noEmit 2>&1 | grep -E 'BgLastRestart|formatRelativeTime|useNow|BackgroundProcessesTab|AgentList' || echo 'no errors in touched frontend files'
  ```
- **Expected Result**: each prints `no errors in touched host-server files` / `no errors in touched frontend files` (grep finds nothing). Any printed `error TS` line naming those files is a FAIL.
- **Repeatable Unit Test**: Not applicable: type-level check, covered by the typecheck gate rather than a runtime assertion
- [x] Pass <!-- 2026-09-20 -->

### UAT-INT-002: eslint is clean on the touched frontend files
- **Description**: The new and edited frontend files lint clean (the task's frontend gate).
- **Steps**:
  1. Run the command below.
- **Command**:
  ```bash
  cd frontend && npx eslint src/components/BgLastRestart.tsx src/components/BgLastRestart.test.tsx src/lib/formatRelativeTime.ts src/lib/formatRelativeTime.test.ts src/lib/useNow.ts src/components/BackgroundProcessesTab.tsx src/components/BackgroundProcessesTab.test.tsx
  ```
- **Expected Result**: no output; exit code 0.
- **Repeatable Unit Test**: Not applicable: lint gate
- [x] Pass <!-- 2026-09-20 -->

### UAT-LIVE-001: GATE — register the fixtures; the bg status payload carries `lastRestart` (null before any restart)
- **Endpoint**: `POST /api/projects`, `POST /api/projects/1/agents`, `POST /api/bg-processes` (twice), `GET /api/status` (port 18795, private stack)
- **Description**: Fixture: project `uat0207proj`, one agent `alice` (its tmux window name `uat0207proj-alice` is a legitimate `X-Conductor-Agent` identity), and two bg processes in that project: `smoke` (restarted by the later cases) and `spare` (never restarted by the API cases, so the "No restarts recorded" state stays observable). Before any restart both report `lastRestart: null`. **If `hasKey` is `false`, mark every remaining live case BLOCKED (the server lacks the TASK-0193 status field); do not judge them as failures.**
- **Steps**:
  1. Create the project (a fresh DB assigns id `1`), the agent, and both bg processes, one at a time:
     ```bash
     curl -sS -X POST 'http://127.0.0.1:18795/api/projects' -H 'Content-Type: application/json' -d '{"name":"uat0207proj","workdir":"/Users/davidtaylor/Repositories/tmux-conductor/tmp/uat-0207"}' | jq -c '{id,name}'
     ```
     ```bash
     curl -sS -X POST 'http://127.0.0.1:18795/api/projects/1/agents' -H 'Content-Type: application/json' -d '{"name":"alice","launchCmd":"sleep 3600"}' | jq -c '{id,name,projectId}'
     ```
     ```bash
     curl -sS -X POST 'http://127.0.0.1:18795/api/bg-processes' -H 'Content-Type: application/json' -d '{"name":"spare","projectId":1,"workdir":"/Users/davidtaylor/Repositories/tmux-conductor/tmp/uat-0207","launchCmd":"sleep 3600"}' | jq -c '{ok, slug: .bg.slug}'
     ```
     Expect `{"id":1,"name":"uat0207proj"}`, `{"id":1,"name":"alice","projectId":1}`, `{"ok":true,"slug":"uat0207proj-spare"}`.
  2. Run the command below (registers `smoke`, waits for the status poll, then reads both payload entries).
- **Command**:
  ```bash
  curl -sS -X POST 'http://127.0.0.1:18795/api/bg-processes' -H 'Content-Type: application/json' -d '{"name":"smoke","projectId":1,"workdir":"/Users/davidtaylor/Repositories/tmux-conductor/tmp/uat-0207","launchCmd":"i=0; while true; do i=$((i+1)); echo \"tick $i\"; sleep 1; done"}' | jq -c '{ok, slug: .bg.slug}'; sleep 3; curl -sS 'http://127.0.0.1:18795/api/status' | jq -c '[.bgProcesses[] | {slug, hasKey: has("lastRestart"), lastRestart, liveness}] | sort_by(.slug)'
  ```
- **Expected Result**: `{"ok":true,"slug":"uat0207proj-smoke"}` then `[{"slug":"uat0207proj-smoke","hasKey":true,"lastRestart":null,"liveness":"running"},{"slug":"uat0207proj-spare","hasKey":true,"lastRestart":null,"liveness":"running"}]`.
- **Repeatable Unit Test**: Not applicable: live HTTP + SQLite + tmux fixture wiring
- [x] Pass <!-- 2026-09-20 -->

### UAT-LIVE-002: a dashboard (header-less) restart reaches SSE clients as a `bg-update` carrying `lastRestart` within one poll tick, with liveness unchanged
- **Endpoint**: `GET /api/events` (SSE) while `POST /api/bg-processes/uat0207proj-smoke/restart` runs
- **Description**: The core server fix. The SSE stream first replays the current state (`smoke` with `lastRestart: null`), then, after the restart, must deliver a `bg-update` whose `lastRestart` is `{ at: <ISO-8601 UTC>, caller: null }` within a few seconds (no reload, no polling by the client). The restart re-creates the window in place, so `windowPresent` stays `true` and `liveness` stays `running` in that event: only `lastRestart` differs from the previous snapshot, which proves the poll diff now compares `lastRestart` (before TASK-0207 no event was sent for such a restart). The route emits no SSE itself, so the event comes from `pollAndDiff` (`STATUS_POLL_MS=500`).
- **Steps**:
  1. Run the block below as-is (one shell command: opens the SSE stream in the background, restarts as a dashboard caller, waits 4 s, closes the stream, and analyses the captured events for `smoke`).
- **Command**:
  ```bash
  (curl -sN 'http://127.0.0.1:18795/api/events' > tmp/uat-0207/sse-dashboard.log 2>&1 & echo $! > tmp/uat-0207/sse.pid); sleep 2; curl -sS -X POST 'http://127.0.0.1:18795/api/bg-processes/uat0207proj-smoke/restart' | jq -c '{ok, mechanism}'; sleep 4; kill $(cat tmp/uat-0207/sse.pid); grep '^data: ' tmp/uat-0207/sse-dashboard.log | cut -c7- | jq -s -c '[.[] | select(.slug=="uat0207proj-smoke")] | {replayHasLastRestart: (.[0].lastRestart != null), updates: [.[1:][] | select(.lastRestart != null)] | {atLeastOne: (length >= 1), allDashboard: all(.[]; .lastRestart.caller == null), allIso: all(.[]; .lastRestart.at | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$")), stillRunning: all(.[]; .liveness == "running" and .windowPresent == true)}}'
  ```
- **Expected Result**: `{"ok":true,"mechanism":"respawn-window"}` then `{"replayHasLastRestart":false,"updates":{"atLeastOne":true,"allDashboard":true,"allIso":true,"stillRunning":true}}`. `atLeastOne: false` (no `bg-update` carrying `lastRestart` within ~4 s) is a FAIL.
- **Repeatable Unit Test**: Created: `host-server/bgDiff.test.ts` (`null to non-null lastRestart flips it`, plus the `pollAndDiff` wiring pin; the live SSE delivery needs the running server)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test bgDiff.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-LIVE-003: an agent restart (a change of only `lastRestart.caller`) reaches SSE clients, and a fresh SSE client is replayed the last restart
- **Endpoint**: `GET /api/events` (SSE) while `POST /api/bg-processes/uat0207proj-smoke/restart` runs with `X-Conductor-Agent: uat0207proj-alice`
- **Description**: After UAT-LIVE-002 the last restart is the dashboard's. The block waits 16 s (the 15 s cooldown armed by that restart expires), opens a new SSE stream (whose replay must already carry the dashboard `lastRestart`: a late-connecting client is consistent without waiting for a diff), restarts as `alice`, and requires a `bg-update` with `lastRestart.caller == "uat0207proj-alice"` (the caller changed from `null`; the diff compares `caller`, not just `at`).
- **Steps**:
  1. Run the block below as-is (one shell command).
- **Command**:
  ```bash
  sleep 16; (curl -sN 'http://127.0.0.1:18795/api/events' > tmp/uat-0207/sse-agent.log 2>&1 & echo $! > tmp/uat-0207/sse.pid); sleep 2; curl -sS -X POST 'http://127.0.0.1:18795/api/bg-processes/uat0207proj-smoke/restart' -H 'X-Conductor-Agent: uat0207proj-alice' | jq -c '{ok, mechanism}'; sleep 4; kill $(cat tmp/uat-0207/sse.pid); grep '^data: ' tmp/uat-0207/sse-agent.log | cut -c7- | jq -s -c '[.[] | select(.slug=="uat0207proj-smoke")] | {replayHasLastRestart: (.[0].lastRestart != null), replayCaller: .[0].lastRestart.caller, updates: [.[1:][] | select(.lastRestart != null and .lastRestart.caller == "uat0207proj-alice")] | {atLeastOne: (length >= 1), allIso: all(.[]; .lastRestart.at | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$")), stillRunning: all(.[]; .liveness == "running" and .windowPresent == true)}}'
  ```
- **Expected Result**: `{"ok":true,"mechanism":"respawn-window"}` then `{"replayHasLastRestart":true,"replayCaller":null,"updates":{"atLeastOne":true,"allIso":true,"stillRunning":true}}`. A `429` for `alice` (the `ok` line would be `null`) means the cooldown had not expired: re-run the block.
- **Repeatable Unit Test**: Created: `host-server/bgDiff.test.ts` (`lastRestart.caller change flips it (agent to dashboard)`; the live SSE delivery needs the running server)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test bgDiff.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-LIVE-004: the last restart persists across a host-server restart (comes from `bg-restarts.jsonl`, not memory) and is replayed to a fresh SSE client
- **Description**: The value shown after a page reload must come from the audit log. The block kills the private host-server (waiting until the port is free), starts a fresh one from the same conf, confirms it is a different process, then reads `GET /api/status` and a fresh SSE replay: both must still report `alice` as `lastRestart.caller` with an ISO `at`; the audit log's last two lines are the dashboard restart and the agent restart. (No 16 s wait is needed: nothing is restarted.) The fresh server keeps running for the UI cases.
- **Steps**:
  1. Run the block below as-is (one shell command).
- **Command**:
  ```bash
  R="$PWD"; OLD=$(lsof -ti tcp:18795 -sTCP:LISTEN); kill $OLD; for i in $(seq 1 40); do lsof -ti tcp:18795 -sTCP:LISTEN >/dev/null || break; sleep 0.5; done; (cd host-server && env -u TMUX -u TMUX_PANE TMUX_TMPDIR="$R/tmp/uat-0207/tmux" CONDUCTOR_CONF="$R/tmp/uat-0207/conductor.conf" BACKEND_PORT=18795 PORT=18795 nohup node --import tsx/esm index.ts > "$R/tmp/uat-0207/server2.log" 2>&1 &); for i in $(seq 1 40); do curl -sS -m 2 -o /dev/null 'http://127.0.0.1:18795/api/agents' 2>/dev/null && break; sleep 0.5; done; NEW=$(lsof -ti tcp:18795 -sTCP:LISTEN); [ -n "$NEW" ] && [ "$OLD" != "$NEW" ] && echo 'server=restarted' || echo 'server=NOT-RESTARTED'; sleep 3; curl -sS 'http://127.0.0.1:18795/api/status' | jq -c '.bgProcesses[] | select(.slug=="uat0207proj-smoke") | {statusCaller: .lastRestart.caller, atIso: (.lastRestart.at | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$"))}'; curl -sN -m 3 'http://127.0.0.1:18795/api/events' | grep '^data: ' | cut -c7- | jq -c 'select(.slug=="uat0207proj-smoke") | {replayCaller: .lastRestart.caller}'; tail -n 2 tmp/uat-0207/logs/bg-restarts.jsonl | jq -c '{caller, outcome}'
  ```
- **Expected Result**: `server=restarted`, then `{"statusCaller":"uat0207proj-alice","atIso":true}`, then `{"replayCaller":"uat0207proj-alice"}`, then `{"caller":null,"outcome":"restarted"}` and `{"caller":"uat0207proj-alice","outcome":"restarted"}`. `server=NOT-RESTARTED` makes the case inconclusive (re-run it); a `null` caller after the restart is a FAIL.
- **Repeatable Unit Test**: Not applicable: needs a real process restart of the host-server; the seeding itself is unit-covered by UAT-0193 (`history reseeded from a fixture after a simulated module restart`)
- [x] Pass <!-- 2026-09-20 -->

### UAT-UI-001: the bg process tile shows the last restart line (agent caller, tooltip) and `No restarts recorded` for a never-restarted process
- **Page**: `http://localhost:18796/` (Agents page, private stack). Component: `BgProcessRow` in `frontend/src/components/AgentList.tsx`, `BgLastRestart` line after the launch-command span.
- **Description**: After UAT-LIVE-004 the `smoke` process was last restarted by `uat0207proj-alice`; `spare` was never restarted.
- **Steps**:
  1. Open `http://localhost:18796/` in a browser (hard-reload if it was already open).
  2. In the main area under the heading `Background processes`, find the `uat0207proj` group and its two tiles, `smoke` and `spare`.
  3. Read the muted line after each tile's launch command; hover the `smoke` line.
- **Expected Result**: the `smoke` tile reads `Restarted <N>s ago by uat0207proj-alice` (`uat0207proj-alice` in a monospace face; the age is a relative label such as `1m ago`); the `spare` tile reads `No restarts recorded`. Hovering the `smoke` line shows a tooltip with the full ISO timestamp and `restarted by uat0207proj-alice (reported by the caller)`. The tile does not grow taller or overflow: the line is one `text-[11px]` muted line that truncates rather than wraps.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`the tile shows the last restart line (agent caller), and "No restarts recorded" when absent`; layout, tooltip hover and the live data need a browser)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t 'the tile shows the last restart line'`
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-10-17 -->

### UAT-UI-002: a dashboard restart shows `Restarted just now from the dashboard` immediately (no absolute timestamp, no reload), then ages
- **Page**: `http://localhost:18796/` (Agents page). Components: `BgRestartButton` (TASK-0206) + the optimistic patch in `handleBgRestarted` + `BgLastRestart`.
- **Description**: This is the case where generation found the requirement gap: the line must read a relative `just now` the moment the restart lands, not the absolute local time. Restart `spare` from the dashboard (a header-less caller, exempt from the cooldown).
- **Steps**:
  1. On the Agents page, in the `spare` tile click `Restart`, then confirm with the `Restart` button in the confirmation popover (`Restart "spare" (project uat0207proj)?`).
  2. Immediately read the `spare` tile's line, without reloading the page.
  3. Wait about 40 seconds (one `useNow` tick is 30 s) and read the line again.
- **Expected Result**: right after the confirmation the line changes from `No restarts recorded` to `Restarted just now from the dashboard` (the tooltip shows the ISO timestamp and `restarted from the dashboard`). The text must NOT be an absolute date/time such as `9/20/2026, 2:48:50 AM`. After the wait the label has aged to a seconds label such as `Restarted 35s ago from the dashboard`.
- **Repeatable Unit Test**: Created: `frontend/src/components/BgLastRestart.test.tsx` (`reads "just now" for a restart that lands between useNow ticks` and `ages the label when the useNow tick fires`), `frontend/src/components/AgentList.test.tsx` (`a successful dashboard restart optimistically sets the row line`)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/BgLastRestart.test.tsx`
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-10-17 -->

### UAT-UI-003: the Background tab rows show the line under each row, outside the select button
- **Page**: `http://localhost:18796/`, agent `alice`'s detail pane, tab `Background (2)`. Component: `frontend/src/components/BackgroundProcessesTab.tsx`.
- **Description**: The same line appears on the tab rows (the tab's `<li>` is a column: select/restart row on top, the line beneath), and it is not part of the select button's accessible name.
- **Steps**:
  1. Click the sidebar row `alice detail` to open the detail pane, then the tab `Background (2)`.
  2. Read the line under each of the two rows (`uat0207proj-smoke`, `uat0207proj-spare`).
  3. Inspect the accessible name of the row's select button (browser accessibility tree, or the Playwright snapshot): it must be `uat0207proj-smoke running <launch command>` style text with no `Restarted` in it.
- **Expected Result**: the `smoke` row shows `Restarted <N> ago by uat0207proj-alice`, the `spare` row shows the restart from UAT-UI-002 (`Restarted <N>s ago from the dashboard`). Each line sits under its row, is not inside the select button, and the button's accessible name contains no `Restarted` text.
- **Repeatable Unit Test**: Created: `frontend/src/components/BackgroundProcessesTab.test.tsx` (`shows each row's last restart line, outside the select button`; the real layout needs a browser)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/BackgroundProcessesTab.test.tsx -t 'last restart line'`
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-10-17 -->

### UAT-UI-004: an agent restart done outside the browser shows up on the open page within a couple of seconds, without a reload
- **Page**: `http://localhost:18796/` with the Background tab or the tile visible (leave the page open; do not reload).
- **Description**: The live SSE path end to end: a restart sent to the host-server by an agent (the `X-Conductor-Agent` header, as `dev-commands.sh restart` sends it) must update the open dashboard through the `bg-update` event.
- **Steps**:
  1. With the page open on the Agents page (do not reload), run the command below (waits 16 s first so the cooldown armed by UAT-UI-002 has expired).
  2. Watch the `smoke` tile / row line while and after it runs.
- **Command**:
  ```bash
  sleep 16; curl -sS -X POST 'http://127.0.0.1:18795/api/bg-processes/uat0207proj-smoke/restart' -H 'X-Conductor-Agent: uat0207proj-alice' | jq -c '{ok, mechanism}'
  ```
- **Expected Result**: the command prints `{"ok":true,"mechanism":"respawn-window"}`; within about 2 to 3 seconds the `smoke` line changes from an age such as `3m ago` to `just now` (or a few seconds), still `... by uat0207proj-alice`, with no page reload. (The caller was already `alice`, so this proves the `at` change alone flips the diff.)
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`a bg-update SSE carrying a new lastRestart updates the tab row text`; the real event stream needs the running stack, covered server-side by UAT-LIVE-002 / 003)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t 'a bg-update SSE carrying a new lastRestart'`
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-10-17 -->

### UAT-UI-005: after a page reload the values persist
- **Page**: `http://localhost:18796/`.
- **Description**: The line's data comes from `bg-restarts.jsonl` through `GET /api/status` and the SSE replay, not from browser memory or the optimistic patch.
- **Steps**:
  1. Reload the page (hard reload).
  2. Read the `smoke` and `spare` lines on the tiles.
- **Expected Result**: `smoke` reads `Restarted <N> ago by uat0207proj-alice` (its most recent restart, from UAT-UI-004); `spare` reads `Restarted <N> ago from the dashboard` (from UAT-UI-002). Neither reverts to `No restarts recorded`.
- **Repeatable Unit Test**: Not applicable: reload persistence needs a browser session and the audit log; the server side is covered by UAT-LIVE-004
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-10-17 -->

### UAT-LIVE-005: cleanup the private stack
- **Description**: Removes every artifact of the live cases: the private Vite server, the private host-server, the private tmux server, and `tmp/uat-0207/` (including the private audit log). Run last, and run it even if earlier cases failed or were blocked. The real `conductor` tmux session, `./data/conductor.db` and `./logs/bg-restarts.jsonl` are never involved. Close any browser tab still open on `localhost:18796`.
- **Steps**:
  1. Run the command below.
  2. Confirm the live `conductor` session is untouched and the fixture directory is gone.
- **Command**:
  ```bash
  (curl -sS -X DELETE 'http://127.0.0.1:18795/api/bg-processes/uat0207proj-smoke'; curl -sS -X DELETE 'http://127.0.0.1:18795/api/bg-processes/uat0207proj-spare'; lsof -ti tcp:18796 -sTCP:LISTEN | xargs kill; lsof -ti tcp:18795 -sTCP:LISTEN | xargs kill; sleep 2; env -u TMUX -u TMUX_PANE TMUX_TMPDIR="$PWD/tmp/uat-0207/tmux" tmux kill-server; rm -rf tmp/uat-0207; curl -sS -m 2 -o /dev/null -w 'server=%{http_code}\n' 'http://127.0.0.1:18795/api/agents'; lsof -ti tcp:18796 -sTCP:LISTEN >/dev/null && echo 'vite=up' || echo 'vite=down'; test -e tmp/uat-0207 && echo 'dir=present' || echo 'dir=gone'; tmux list-sessions -F '#S')
  ```
- **Expected Result**: `server=000` (connection refused), `vite=down`, `dir=gone`, and the final `tmux list-sessions` (the real server) still lists `conductor`. The two DELETEs may print `{"ok":true,"removed":"..."}` or a connection error if the server was already down; none of that matters.
- **Repeatable Unit Test**: Not applicable: lifecycle cleanup of live processes and scratch files
- [x] Pass <!-- 2026-09-20 -->

---

## Notes for the judge

- **Auto-judgeable without the live stack**: UAT-UNIT-001 .. 005 (each has a file-scoped unit command), UAT-INT-001 (typecheck, filtered to touched files), UAT-INT-002 (eslint). The live cases UAT-LIVE-001 .. 004 are machine-executable end to end on the private stack, gated by UAT-LIVE-001 (`hasKey`), and must run in the order written. UAT-UI-001 .. 005 are browser checks: each is unit-backed for its logic (the `Unit Test Command` is its auto-judge evidence channel), the visual and cross-process behaviour is Manual; they use the same private host-server, so they can also be driven with a browser automation tool against `http://localhost:18796/`. Always run UAT-LIVE-005 (cleanup), even after failures.
- **Verified recipe**: the live cases were dry-run once during generation on the private ports (fixtures, both SSE captures, the host-server restart persistence check, the tile / tab UI). Observed: `updates.n = 1` per restart, `liveness: running` / `windowPresent: true` in the carrying event (proves the diff fires on `lastRestart` alone), replay after a host-server restart carrying `uat0207proj-alice`, tile reading `just now` after the fix.
- **Design decision (not a gap)**: the restart route emits no `bg-update` itself; an immediate broadcast could publish a transient mid-respawn liveness the next poll would never correct. The requirement "updates live" is satisfied by the poll diff within one tick (UAT-LIVE-002 asserts delivery within ~4 s with `STATUS_POLL_MS=500`; the production default poll is 2 s).
- **Callers must be real project members**: the live cases use `uat0207proj-alice`, registered in the same project as the bg process, so they pass with or without the TASK-0194 same-project guard. Do not substitute made-up caller names (an unregistered name is answered `403`).
- **Never touch**: `:8788`, `:4321`, the live `conductor` tmux session, the real `dev` / `dev-stack` bg processes, any `.env` file.
