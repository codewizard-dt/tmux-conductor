---
id: UAT-0202
aliases: [UAT-0202]
title: "UAT: Make `dev-commands list` default to the caller's project, with an all-projects option"
status: passed
task: TASK-0202
created: 2026-09-20
updated: 2026-10-17
---

# UAT-0202 — UAT: Make `dev-commands list` default to the caller's project, with an all-projects option

implements::[[TASK-0202]]

> **Source task**: [[TASK-0202]]
> **Generated**: 2026-09-20
>
> **What changed**: `GET /api/agents/whoami` (`host-server/index.ts`, right after `GET /agents`) reads the `X-Conductor-Agent` header and always answers `200` with `{ kind: 'agent', agentId, agentName, projectId, projectName }` or `{ kind: 'human' | 'unknown' | 'ambiguous' }`, built by the new pure `describeCaller(resolution, agents)` and the `WhoamiResponse` type in `host-server/bgAccess.ts`. `skills/dev-commands/scripts/dev-commands.sh` gained `api_get` (sends `X-Conductor-Agent` only when `CONDUCTOR_AGENT_NAME` is non-empty), `resolve_caller_project`, and `list [--all]`: by default `list` filters `GET /api/status` `.bgProcesses[]` to the caller's `projectId`; `--all` shows every project with `, project: <name>` on each line; every unresolved case falls back to all projects with a stderr `Note:` and exit 0. `SKILL.md`, `CLAUDE.md` and `scripts/verify-dev-commands.sh` (new offline `list` checks, 19 total) were updated.
>
> **Out of scope**: the `restart` subcommand (TASK-0203) and the liveness/status column changes (TASK-0204), which edit the same script and `SKILL.md` later; the same-project restart guard and its resolver tests (TASK-0194, UAT-0194); the dashboard. The `[DEFERRED-TO-UAT]` live smoke recipe from TASK-0202 Step 4 lives here, run on a private stack instead of `:8788`.

---

## Prerequisites

**Isolation rules (read first).** Every live case (UAT-API-*, UAT-LIVE-*, UAT-EDGE-002 .. 007) runs against a **private stack**: its own tmux server (`TMUX_TMPDIR=tmp/uat-0202/tmux`, session `uat0202`), its own conf, SQLite DB and `LOG_DIR` (`tmp/uat-0202/`), and its own host-server on port **18793**; one case also uses a throwaway stub HTTP server on **18794**, and one uses **18795** as a port nothing listens on. Never send a request to `:8788` (stale), never touch the live `conductor` tmux session, never touch the real `dev` / `dev-stack` bg processes, never read or write the real `./data/conductor.db` or `./logs`. Every tmux command is prefixed with `env -u TMUX -u TMUX_PANE TMUX_TMPDIR="$PWD/tmp/uat-0202/tmux"` so it reaches the private server even from inside tmux. No `.env` file is read or written; all scratch files live in `./tmp/uat-0202/`.

**The judge is itself a conductor agent**, so `CONDUCTOR_AGENT_NAME` and `BACKEND_PORT` are probably set in its shell. Every script invocation below goes through the wrapper `tmp/uat-0202/dc.sh` created in the prerequisites, which unsets or sets `CONDUCTOR_AGENT_NAME` explicitly and always exports `BACKEND_PORT` to the private port, so an inherited value can neither redirect the script to `:8788` nor change which project it resolves. Never call `dev-commands.sh` directly in a live case.

- [ ] Run everything from the repo root `/Users/davidtaylor/Repositories/tmux-conductor`. Tools needed: `tmux` (>= 3.0), `node`, `curl`, `jq`, `lsof`. Ports 18793, 18794 and 18795 are free (the command below prints nothing):
  ```bash
  lsof -ti tcp:18793 -sTCP:LISTEN; lsof -ti tcp:18794 -sTCP:LISTEN; lsof -ti tcp:18795 -sTCP:LISTEN
  ```
- [ ] Only for the live cases: create the scratch dir, the private conf, two offline state files (used as `CONDUCTOR_STATE_DIR` by the script) and the wrapper:
  ```bash
  rm -rf tmp/uat-0202 && mkdir -p tmp/uat-0202/tmux tmp/uat-0202/data tmp/uat-0202/logs/state tmp/uat-0202/offline-state && printf '%s\n' 'SESSION_NAME="uat0202"' 'DB_PATH="./data/conductor.db"' 'LOG_DIR="./logs"' 'STATE_DIR="./logs/state"' 'POLL_INTERVAL=15' 'STATUS_POLL_MS=500' > tmp/uat-0202/conductor.conf && printf running > tmp/uat-0202/offline-state/bg-uat0202pa-dev.state && printf running > tmp/uat-0202/offline-state/bg-uat0202pb-dev.state
  ```
  ```bash
  printf '%s\n' '#!/bin/bash' '# dc.sh <agent-name|-> <port> <state-dir> <dev-commands args...>   ("-" = CONDUCTOR_AGENT_NAME unset)' 'who="$1"; port="$2"; sd="$3"; shift 3' 'if [ "$who" = "-" ]; then unset CONDUCTOR_AGENT_NAME; else export CONDUCTOR_AGENT_NAME="$who"; fi' 'export CONDUCTOR_STATE_DIR="$sd" CONDUCTOR_LOG_DIR="$PWD/tmp/uat-0202/logs" BACKEND_PORT="$port"' '/bin/bash skills/dev-commands/scripts/dev-commands.sh "$@" > tmp/uat-0202/out.txt 2> tmp/uat-0202/err.txt' 'echo "rc=$?"' 'echo "--- stdout"; cat tmp/uat-0202/out.txt' 'echo "--- stderr"; cat tmp/uat-0202/err.txt' > tmp/uat-0202/dc.sh
  ```
- [ ] Start the private tmux server with a keeper window (the session must exist before the host-server starts):
  ```bash
  env -u TMUX -u TMUX_PANE TMUX_TMPDIR="$PWD/tmp/uat-0202/tmux" tmux new-session -d -s uat0202 -n keeper 'sleep 3600'
  ```
- [ ] Start the private host-server from the working tree (background; it must stay up until UAT-API-005). It binds 127.0.0.1:18793 and reads `CONDUCTOR_CONF`, so it never touches `./data/conductor.db` or `./logs`:
  ```bash
  R="$PWD"; cd host-server && env -u TMUX -u TMUX_PANE TMUX_TMPDIR="$R/tmp/uat-0202/tmux" CONDUCTOR_CONF="$R/tmp/uat-0202/conductor.conf" BACKEND_PORT=18793 PORT=18793 nohup node --import tsx/esm index.ts > "$R/tmp/uat-0202/server.log" 2>&1 &
  ```
- [ ] Wait for it to answer and for its startup tmux work to settle (an empty agent list proves it is the private, empty DB; the `monitor` window appearing means startup is done):
  ```bash
  sleep 9 && curl -sS 'http://127.0.0.1:18793/api/agents'
  ```
  ```bash
  env -u TMUX -u TMUX_PANE TMUX_TMPDIR="$PWD/tmp/uat-0202/tmux" tmux list-windows -t uat0202 -F '#W'
  ```
  Expected: `[]`, then `keeper` and `monitor`. If the first does not print `[]`, stop and mark every live case BLOCKED.
- [ ] Only for UAT-EDGE-004: start the stub HTTP server on 18794 (run from the repo root; it answers `/api/status` with two fake projects and `/api/agents/whoami` with a canned reply chosen by the `X-Conductor-Agent` header, and logs every request as `<url> <header|NOHEADER>` to `tmp/uat-0202/stub-requests.log`):
  ```bash
  nohup node -e 'const http=require("http"),fs=require("fs");const st={bgProcesses:[{slug:"sa-dev",name:"dev",projectId:7,projectName:"sa",state:"running",windowPresent:true},{slug:"sb-dev",name:"dev",projectId:8,projectName:"sb",state:"running",windowPresent:true}]};const who={"stub-ok":{kind:"agent",agentId:1,agentName:"a",projectId:7,projectName:"sa"},"stub-nullproj":{kind:"agent",agentId:2,agentName:"b",projectId:null,projectName:null},"stub-human":{kind:"human"},"stub-ambiguous":{kind:"ambiguous"},"stub-badid":{kind:"agent",agentId:3,agentName:"c",projectId:"abc",projectName:"x"}};http.createServer((q,r)=>{const h=q.headers["x-conductor-agent"];fs.appendFileSync("tmp/uat-0202/stub-requests.log",q.url+" "+(h===undefined?"NOHEADER":h)+"\n");if(q.url==="/api/status"){r.setHeader("content-type","application/json");return r.end(JSON.stringify(st));}if(q.url==="/api/agents/whoami"){if(h==="stub-500"){r.statusCode=500;return r.end("boom");}if(h==="stub-garbage"){return r.end("not json");}if(who[h]){r.setHeader("content-type","application/json");return r.end(JSON.stringify(who[h]));}}r.statusCode=404;r.end("");}).listen(18794,"127.0.0.1");' > tmp/uat-0202/stub.log 2>&1 &
  ```

Unit, typecheck, syntax and doc cases (UAT-UNIT-*, UAT-EDGE-001, UAT-INT-*, UAT-DOC-*) need none of the live stack.

---

## Test Cases

### UAT-UNIT-001: whole `bgAccess.test.ts` suite passes (25 tests)
- **Description**: The access module suite covers the resolver (TASK-0194), the restart authorization decision, the route-wiring pin for the restart guard, and the four new `describeCaller` tests (TASK-0202) with no live server, tmux or filesystem state.
- **Steps**:
  1. Run the command below from the repo root.
- **Command**:
  ```bash
  cd host-server && node --import tsx/esm --test bgAccess.test.ts
  ```
- **Expected Result**: `tests 25`, `pass 25`, `fail 0`, `cancelled 0`, `skipped 0`; exit code 0. (A later task may add tests; the requirement is `fail 0` with `pass` equal to `tests` and `tests` at least 25.)
- **Repeatable Unit Test**: Created: `host-server/bgAccess.test.ts`
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test bgAccess.test.ts`
- [x] Pass <!-- 2026-09-20 -->
  - _auto-judge (unit-backed)_: tests 25, pass 25, fail 0, cancelled 0, skipped 0.

### UAT-EDGE-001: `describeCaller` maps every resolver outcome to the whoami wire shape
- **Scenario**: For a resolved agent, `describeCaller` returns `{ kind: 'agent', agentId, agentName, projectId, projectName }` with `projectName` read from the matched agent row; for a project-less agent both `projectId` and `projectName` are `null`; for `human`, `unknown` and `ambiguous` the result is exactly `{ kind }` with no other keys (so the script can branch on `kind` alone); and it composes end to end with `resolveCallerProject` for a `<project>-<name>` header, an unregistered name (`unknown`) and a `null` header (`human`).
- **Steps**:
  1. Run the command below (only the `describeCaller` tests).
- **Command**:
  ```bash
  cd host-server && node --import tsx/esm --test --test-name-pattern='describeCaller' bgAccess.test.ts
  ```
- **Expected Result**: `tests 4`, `pass 4`, `fail 0`. The four names are `describeCaller: agent with a project includes projectName`, `describeCaller: project-less agent has projectId and projectName null`, `describeCaller: human, unknown and ambiguous are exactly \`{ kind }\``, `describeCaller: end to end with a \`<project>-<name>\` header`.
- **Repeatable Unit Test**: Created: `host-server/bgAccess.test.ts`
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern='describeCaller' bgAccess.test.ts`
- [x] Pass <!-- 2026-09-20 -->
  - _auto-judge (unit-backed)_: tests 4, pass 4, fail 0; all four named describeCaller tests ran.

### UAT-INT-001: the whoami helper, route and its imports typecheck under the strict config
- **Description**: `describeCaller` / `WhoamiResponse` in `bgAccess.ts`, the new tests in `bgAccess.test.ts`, and the `api.get('/agents/whoami', ...)` handler in `index.ts` typecheck. The whole host-server project is checked, but other in-flight sessions may leave unrelated diagnostics, so the judge scopes the verdict as described below.
- **Steps**:
  1. Run the command below.
  2. If it prints nothing, the case passes. If it prints diagnostics, the case fails only when a diagnostic is in `bgAccess.ts` or `bgAccess.test.ts`, or in `index.ts` inside the `/agents/whoami` handler (locate it with `mcp__serena__search_for_pattern` on `api\.get\('/agents/whoami'`; the handler is 5 lines). Diagnostics in other files or other regions of `index.ts` belong to other sessions and do not fail this case; record them in the verdict notes.
- **Command**:
  ```bash
  cd host-server && npx tsc --noEmit
  ```
- **Expected Result**: no output and exit code 0 (observed clean when this UAT was written), or diagnostics only outside the scope named in step 2.
- **Repeatable Unit Test**: Not applicable: type-level check, covered by the host-server typecheck gate rather than a runtime assertion
- [x] Pass <!-- 2026-09-20 -->
  - _auto-judge_: `npx tsc --noEmit` printed nothing (clean).

### UAT-INT-002: both shell scripts parse, and the offline verify script passes all 19 checks
- **Description**: `bash -n` on the skill script and on `scripts/verify-dev-commands.sh`, then the verify script itself, which drives `dev-commands.sh` against fixture state files with `BACKEND_PORT` pointing at a port nothing listens on (so it never reaches `:8788`). It covers `list --all` offline (no filter note), `list --bogus` (exit 1 + usage with `list [--all]`), `list` offline without and with `CONDUCTOR_AGENT_NAME` (both print `cannot filter by project offline` and still list), plus the pre-existing `status`/`tail`/slug checks.
- **Steps**:
  1. Run the two commands below as-is.
- **Command**:
  ```bash
  bash -n skills/dev-commands/scripts/dev-commands.sh && bash -n scripts/verify-dev-commands.sh && echo SYNTAX_OK
  ```
  ```bash
  mkdir -p tmp && bash scripts/verify-dev-commands.sh 2>&1 | tee tmp/verify-dev-commands-0202.out | tail -n 1; grep -c 'PASS:' tmp/verify-dev-commands-0202.out; grep -c 'FAIL:' tmp/verify-dev-commands-0202.out
  ```
- **Expected Result**: the first prints `SYNTAX_OK`. The second prints `[verify-dev-commands] PASS — all dev-commands.sh behavioral checks passed`, then `19` (the number of `PASS:` lines; more if a later task appends checks), then `0` (no `FAIL:` line). The four new list checks appear in `tmp/verify-dev-commands-0202.out` as `PASS: list --all offline -> exit 0, lists state files, no project-filter note`, `PASS: list --bogus -> exit 1 + usage with list [--all]`, `PASS: list (no CONDUCTOR_AGENT_NAME, offline) -> 'cannot filter by project offline' note + still lists` and `PASS: list (CONDUCTOR_AGENT_NAME set, host-server unreachable) -> same offline note + still lists`.
- **Repeatable Unit Test**: Created: `scripts/verify-dev-commands.sh` (a shell verification script, the repo's runner for this skill; it has no server and so cannot cover the live cases below)
- **Unit Test Command**: `bash scripts/verify-dev-commands.sh`
- [x] Pass <!-- 2026-09-20 -->
  - _auto-judge_: `SYNTAX_OK`; verify script printed `PASS — all dev-commands.sh behavioral checks passed`, 19 `PASS:` lines, 0 `FAIL:`; the four new list checks are present.

### UAT-INT-003: the whoami route is a static path with no parametric collision
- **Description**: `GET /agents/whoami` is registered once, right after `GET /agents`, and no `GET /agents/:param` route exists that Fastify could match instead (the task required a route-table check before merging). `index.ts` has top-level side effects and cannot be imported by a unit test, so this is a source search; the live case UAT-API-001 proves the behaviour.
- **Steps**:
  1. Search `host-server/index.ts` with `mcp__serena__search_for_pattern` for `api\.get\('/agents/whoami'`.
  2. Search it again for `api\.get(?:<[^>]*>)?\('/agents/:[A-Za-z]+'` (a GET whose path is `/agents/` plus exactly one parameter and nothing after it).
  3. Search `host-server/bgAccess.ts` for `export function describeCaller` and `export type WhoamiResponse`.
- **Expected Result**: step 1 finds exactly one match, whose handler calls `parseCallerHeader(req.headers[BG_CALLER_HEADER])`, `listAgents(db)`, and replies with `describeCaller(resolveCallerProject(caller, agents), agents)` with no `status(...)` call (always 200); step 2 finds no match; step 3 finds both exports.
- **Repeatable Unit Test**: Not applicable: `index.ts` calls `listen()` at import time and cannot be loaded by a unit test; route behaviour is asserted live by UAT-API-001 and UAT-API-003
- [x] Pass <!-- 2026-09-20 -->
  - _auto-judge_: exactly one `api.get('/agents/whoami'` match (index.ts:1949) calling `parseCallerHeader`, `listAgents(db)`, replying `describeCaller(resolveCallerProject(...))` with no `status(...)`; no `/agents/:param` GET match; `describeCaller` and `WhoamiResponse` exported from bgAccess.ts.

### UAT-DOC-001: docs describe the new default, `--all`, whoami and the fallback notes
- **Description**: The task requires `SKILL.md` (list section, "When to use", "Offline resilience"), `CLAUDE.md` (routes row) and the script's own header comment and usage text to describe the new behaviour.
- **Steps**:
  1. Search `CLAUDE.md` with `mcp__serena__search_for_pattern` for `GET /agents/whoami`.
  2. Read `skills/dev-commands/SKILL.md` and search it for `list --all`, `/api/agents/whoami`, `could not resolve your project`, `cannot filter by project offline`, `not authentication`, and `Background processes (from host-server)`.
  3. Read the comment block and the usage `echo` lines at the top and bottom of `skills/dev-commands/scripts/dev-commands.sh`.
- **Expected Result**: `CLAUDE.md` mentions `GET /agents/whoami` as read-only, header-based, always 200 with `kind: agent|human|unknown|ambiguous`, for the dev-commands skill. `SKILL.md` documents: `list` defaults to the caller's project via `X-Conductor-Agent` / `GET /api/agents/whoami`; `--all` shows every project with `, project: <name>`; the fallback to all projects with the stderr `Note: could not resolve your project (<reason>); showing all projects.` and its reasons (variable unset, unknown or ambiguous agent, agent without a project, whoami unreachable, `jq` missing); that identity is self-declared and not authentication; the offline path `cannot filter by project offline`; `list --bogus` prints `Unknown option` plus the usage line and exits 1. The old header string `Background processes (from host-server)` appears nowhere in `SKILL.md` or the script. The script's header comment and usage text show `list [--all]`.
- **Repeatable Unit Test**: Not applicable: documentation check
- [x] Pass <!-- 2026-09-20 -->
  - _auto-judge_: CLAUDE.md routes row documents `GET /agents/whoami`; SKILL.md covers default scope, `--all`, whoami, Note reasons, "not authentication", offline note, `Unknown option`/usage; old `(from host-server)` header absent; script header and usage lines show `list [--all]`.

### UAT-API-001: GATE — the private host-server has `GET /api/agents/whoami` and a header-less call is `human` with status 200
- **Endpoint**: `GET /api/agents/whoami` (port 18793, private stack)
- **Description**: A server built before TASK-0202 has no such route and answers Fastify's generic `{"message":"Route GET:/api/agents/whoami not found","error":"Not Found","statusCode":404}`. With no `X-Conductor-Agent` header the resolver returns `human`, and the route must answer `200 {"kind":"human"}`, never a 4xx. **If the status is not 200 or the body is not `{"kind":"human"}`, stop: mark every remaining live case (UAT-API-002 onward, UAT-LIVE-*, UAT-EDGE-002 .. 007) BLOCKED, not failed, and note that the server under test lacks the TASK-0202 route. Do not fall back to `:8788`.**
- **Steps**:
  1. Confirm the Prerequisites completed (private tmux, private server answering `[]`, `monitor` window present, wrapper created).
  2. Run the command below as-is.
- **Command**:
  ```bash
  curl -sS -i 'http://127.0.0.1:18793/api/agents/whoami' | tr -d '\r' | grep -iE '^(HTTP/|\{)'
  ```
- **Expected Result**: `HTTP/1.1 200 OK` then `{"kind":"human"}`.
- **Repeatable Unit Test**: Not applicable: asserts the live Fastify route (the pure mapping is covered by UAT-EDGE-001)
- [x] Pass <!-- 2026-09-20 -->
  - _auto-judge_: `HTTP/1.1 200 OK` + `{"kind":"human"}`.

### UAT-API-002: register three projects, one agent in each, and three bg processes (two named `dev`)
- **Endpoint**: `POST /api/projects`, `POST /api/projects/:id/agents`, `POST /api/bg-processes` (private stack)
- **Description**: The fixture for the project-filtering cases. Projects `uat0202pa` (id 1), `uat0202pb` (id 2) and `uat0202pc` (id 3, deliberately owns no bg process). Agents `alice` (in pa), `bob` (in pb), `carol` (in pc): their tmux window names, and therefore the values a real agent would carry in `CONDUCTOR_AGENT_NAME`, are `uat0202pa-alice`, `uat0202pb-bob`, `uat0202pc-carol`. Bg processes `dev` and `web` in pa and `dev` in pb, giving slugs `uat0202pa-dev`, `uat0202pa-web`, `uat0202pb-dev` (two processes share the display name `dev`, so a wrong filter cannot pass by name). Registering the second and third agent typically fails the tmux window spawn with `500 ... create window failed: index N in use` (observed on every run of this recipe, even with the sleeps); the agent DB row is written before the spawn, so the `500` (printed by `jq` as a row of `null`s) is harmless as long as the verification command lists all three agents. Ids assume a fresh DB and this order.
- **Steps**:
  1. Create the projects, one at a time:
     ```bash
     curl -sS -X POST 'http://127.0.0.1:18793/api/projects' -H 'Content-Type: application/json' -d '{"name":"uat0202pa","workdir":"/Users/davidtaylor/Repositories/tmux-conductor/tmp/uat-0202"}' | jq -c '{id,name}'
     ```
     ```bash
     curl -sS -X POST 'http://127.0.0.1:18793/api/projects' -H 'Content-Type: application/json' -d '{"name":"uat0202pb","workdir":"/Users/davidtaylor/Repositories/tmux-conductor/tmp/uat-0202"}' | jq -c '{id,name}'
     ```
     ```bash
     curl -sS -X POST 'http://127.0.0.1:18793/api/projects' -H 'Content-Type: application/json' -d '{"name":"uat0202pc","workdir":"/Users/davidtaylor/Repositories/tmux-conductor/tmp/uat-0202"}' | jq -c '{id,name}'
     ```
     Expect `{"id":1,"name":"uat0202pa"}`, `{"id":2,"name":"uat0202pb"}`, `{"id":3,"name":"uat0202pc"}`.
  2. Create the agents, waiting between calls (ignore a transient `500` body; the verification below decides):
     ```bash
     curl -sS -X POST 'http://127.0.0.1:18793/api/projects/1/agents' -H 'Content-Type: application/json' -d '{"name":"alice","launchCmd":"sleep 3600"}' | jq -c '{id,name,projectId}'; sleep 3; curl -sS -X POST 'http://127.0.0.1:18793/api/projects/2/agents' -H 'Content-Type: application/json' -d '{"name":"bob","launchCmd":"sleep 3600"}' | jq -c '{id,name,projectId}'; sleep 3; curl -sS -X POST 'http://127.0.0.1:18793/api/projects/3/agents' -H 'Content-Type: application/json' -d '{"name":"carol","launchCmd":"sleep 3600"}' | jq -c '{id,name,projectId}'; sleep 3
     ```
  3. Create the bg processes, waiting between calls:
     ```bash
     curl -sS -X POST 'http://127.0.0.1:18793/api/bg-processes' -H 'Content-Type: application/json' -d '{"name":"dev","projectId":1,"workdir":"/Users/davidtaylor/Repositories/tmux-conductor/tmp/uat-0202","launchCmd":"sleep 3600"}' | jq -c '{ok, slug: .bg.slug, projectId: .bg.projectId}'; sleep 3; curl -sS -X POST 'http://127.0.0.1:18793/api/bg-processes' -H 'Content-Type: application/json' -d '{"name":"web","projectId":1,"workdir":"/Users/davidtaylor/Repositories/tmux-conductor/tmp/uat-0202","launchCmd":"sleep 3600"}' | jq -c '{ok, slug: .bg.slug, projectId: .bg.projectId}'; sleep 3; curl -sS -X POST 'http://127.0.0.1:18793/api/bg-processes' -H 'Content-Type: application/json' -d '{"name":"dev","projectId":2,"workdir":"/Users/davidtaylor/Repositories/tmux-conductor/tmp/uat-0202","launchCmd":"sleep 3600"}' | jq -c '{ok, slug: .bg.slug, projectId: .bg.projectId}'; sleep 3
     ```
  4. Run the verification command below as-is.
- **Command**:
  ```bash
  curl -sS 'http://127.0.0.1:18793/api/agents' | jq -c 'map({name, projectId, projectName}) | sort_by(.name)'
  ```
- **Expected Result**: step 3 prints `{"ok":true,"slug":"uat0202pa-dev","projectId":1}`, `{"ok":true,"slug":"uat0202pa-web","projectId":1}`, `{"ok":true,"slug":"uat0202pb-dev","projectId":2}`. The verification prints `[{"name":"alice","projectId":1,"projectName":"uat0202pa"},{"name":"bob","projectId":2,"projectName":"uat0202pb"},{"name":"carol","projectId":3,"projectName":"uat0202pc"}]`. If an agent row is missing, re-run only that agent's registration (a row that exists needs no retry). If a bg registration failed, re-run only that one; a fixture that cannot be created makes the remaining live cases BLOCKED.
- **Repeatable Unit Test**: Not applicable: live HTTP + SQLite + tmux wiring for fixtures
- [x] Pass <!-- 2026-09-20 -->
  - _auto-judge_: projects ids 1/2/3 created; verification printed the expected three agents (bob/carol POSTs returned the known `null` rows, rows exist). Bg processes created as `uat0202pa-dev`, `uat0202pa-web`, `uat0202pb-dev` with projectId 1/1/2 (one first attempt was mis-issued by the judge's shell loop and simply re-run).

### UAT-API-003: whoami resolves each caller kind, always with status 200
- **Endpoint**: `GET /api/agents/whoami` with `X-Conductor-Agent`
- **Description**: The header carries the agent's tmux window name `<project>-<name>`. A registered agent resolves to its own project (id and name); a well-formed but unregistered window name and a bare agent name (not the window name) are `unknown`; an absent or empty header is `human`. Every answer is HTTP 200 so the script can branch on `kind` without parsing status codes. (`ambiguous` cannot be built live: the agent-creation route refuses a duplicate tmux window name, so `ambiguous` is covered by UAT-EDGE-001 and, for the script branch, by UAT-EDGE-004.)
- **Steps**:
  1. Run the commands below as-is, one at a time.
- **Command**:
  ```bash
  curl -sS 'http://127.0.0.1:18793/api/agents/whoami' -H 'X-Conductor-Agent: uat0202pa-alice' | jq -c '{kind, agentName, projectId, projectName}'
  ```
  ```bash
  curl -sS 'http://127.0.0.1:18793/api/agents/whoami' -H 'X-Conductor-Agent: uat0202pb-bob' | jq -c '{kind, agentName, projectId, projectName}'
  ```
  ```bash
  curl -sS -i 'http://127.0.0.1:18793/api/agents/whoami' -H 'X-Conductor-Agent: uat0202pa-nobody' | tr -d '\r' | grep -iE '^(HTTP/|\{)'
  ```
  ```bash
  curl -sS -i 'http://127.0.0.1:18793/api/agents/whoami' -H 'X-Conductor-Agent: alice' | tr -d '\r' | grep -iE '^(HTTP/|\{)'
  ```
  ```bash
  curl -sS -i 'http://127.0.0.1:18793/api/agents/whoami' -H 'X-Conductor-Agent;' | tr -d '\r' | grep -iE '^(HTTP/|\{)'
  ```
- **Expected Result**: `{"kind":"agent","agentName":"alice","projectId":1,"projectName":"uat0202pa"}`; `{"kind":"agent","agentName":"bob","projectId":2,"projectName":"uat0202pb"}`; then `HTTP/1.1 200 OK` with `{"kind":"unknown"}` (unregistered window name); `HTTP/1.1 200 OK` with `{"kind":"unknown"}` (bare `alice`); `HTTP/1.1 200 OK` with `{"kind":"human"}` (empty header). An `unknown` or `human` body carries no other keys. Any 4xx/5xx is a FAIL.
- **Repeatable Unit Test**: Created: `host-server/bgAccess.test.ts` (`describeCaller` tests cover the mapping; the live header parsing, agent lookup and status code need the running server)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern='describeCaller' bgAccess.test.ts`
- [x] Pass <!-- 2026-09-20 -->
  - _auto-judge (live command)_: all five outputs match Expected exactly (alice/pa id 1, bob/pb id 2, unknown 200, bare `alice` unknown 200, empty header human 200).

### UAT-API-004: `/api/status` carries `slug`, `projectId` and `projectName` per bg process (the input the script filters)
- **Endpoint**: `GET /api/status` (`bgProcesses[]`)
- **Description**: The script does not use a new list route; it filters `.bgProcesses[]` client-side on `projectId`. This proves the private server exposes those fields for every fixture process. The status snapshot refreshes on the 500 ms poll, so the command waits a few seconds.
- **Steps**:
  1. Run the command below as-is.
- **Command**:
  ```bash
  sleep 3 && curl -sS 'http://127.0.0.1:18793/api/status' | jq -c '[.bgProcesses[] | {slug, projectId, projectName}] | sort_by(.slug)'
  ```
- **Expected Result**: `[{"slug":"uat0202pa-dev","projectId":1,"projectName":"uat0202pa"},{"slug":"uat0202pa-web","projectId":1,"projectName":"uat0202pa"},{"slug":"uat0202pb-dev","projectId":2,"projectName":"uat0202pb"}]`.
- **Repeatable Unit Test**: Not applicable: live status payload (`BgStatus` construction is not unit-testable in isolation from `index.ts`; unchanged by this task)
- [x] Pass <!-- 2026-09-20 -->
  - _auto-judge_: output equals the expected three-element array exactly.

### UAT-LIVE-001: `list` as an agent in project A shows only project A's processes
- **Description**: The core requirement. With `CONDUCTOR_AGENT_NAME=uat0202pa-alice` the script asks whoami, gets project `uat0202pa` (id 1), and prints only that project's processes in the existing line format (`<slug> — state: <state>, window: <bool>`, no `project:` suffix, no liveness column). Nothing from `uat0202pb` appears, stderr is empty, exit is 0. `<S>` is whatever state the private server reports for a bg process (observed `null`); it must be a single token with no comma.
- **Steps**:
  1. Run the command below as-is, then the check command.
- **Command**:
  ```bash
  bash tmp/uat-0202/dc.sh uat0202pa-alice 18793 tmp/uat-0202/offline-state list
  ```
  ```bash
  echo "pa-lines=$(grep -cE '^uat0202pa-(dev|web) — state: [^,]+, window: (true|false)$' tmp/uat-0202/out.txt) pb-mentions=$(grep -c 'uat0202pb' tmp/uat-0202/out.txt) project-suffix=$(grep -c ', project:' tmp/uat-0202/out.txt) stderr-bytes=$(wc -c < tmp/uat-0202/err.txt | tr -d ' ')"
  ```
- **Expected Result**: the first command prints exactly `rc=0`, `--- stdout`, `Background processes for project uat0202pa (use --all for every project):`, `uat0202pa-dev — state: <S>, window: true`, `uat0202pa-web — state: <S>, window: true`, `--- stderr` and then nothing. The second prints `pa-lines=2 pb-mentions=0 project-suffix=0 stderr-bytes=0`. Seeing `uat0202pb-dev`, the all-projects header, or a `Note:` line is a FAIL (the default did not scope to the caller's project).
- **Repeatable Unit Test**: Not applicable: shell script against a live host-server; the filter is `jq` over the live payload (offline paths are covered by UAT-INT-002)
- [x] Pass <!-- 2026-09-20 -->
  - _auto-judge_: rc=0, project-scoped header, two pa lines, `pa-lines=2 pb-mentions=0 project-suffix=0 stderr-bytes=0`.

### UAT-LIVE-002: `list` as an agent in project B shows only project B's processes (same process name `dev`)
- **Description**: Symmetry check. Both projects own a process named `dev`; the caller in project B must see only `uat0202pb-dev`, proving the filter keys on project and not on the process name, and that the caller header is honoured per call.
- **Steps**:
  1. Run the command below as-is, then the check command.
- **Command**:
  ```bash
  bash tmp/uat-0202/dc.sh uat0202pb-bob 18793 tmp/uat-0202/offline-state list
  ```
  ```bash
  echo "pb-lines=$(grep -cE '^uat0202pb-dev — state: [^,]+, window: (true|false)$' tmp/uat-0202/out.txt) pa-mentions=$(grep -c 'uat0202pa' tmp/uat-0202/out.txt) stderr-bytes=$(wc -c < tmp/uat-0202/err.txt | tr -d ' ')"
  ```
- **Expected Result**: `rc=0`, stdout `Background processes for project uat0202pb (use --all for every project):` then `uat0202pb-dev — state: <S>, window: true`, empty stderr. The second command prints `pb-lines=1 pa-mentions=0 stderr-bytes=0`.
- **Repeatable Unit Test**: Not applicable: shell script against a live host-server
- [x] Pass <!-- 2026-09-20 -->
  - _auto-judge_: `pb-lines=1 pa-mentions=0 stderr-bytes=0`, rc=0, correct header.

### UAT-LIVE-003: `list --all` as a project-A agent shows every project, grouped, with project names
- **Description**: `--all` skips project resolution and prints every project's processes under `Background processes (all projects):`, sorted by project name then slug, each line ending `, project: <name>`. Stderr is empty (`--all` is explicit, so there is nothing to note).
- **Steps**:
  1. Run the command below as-is, then the check command.
- **Command**:
  ```bash
  bash tmp/uat-0202/dc.sh uat0202pa-alice 18793 tmp/uat-0202/offline-state list --all
  ```
  ```bash
  echo "lines=$(grep -cE '^uat0202p[ab]-[a-z]+ — state: [^,]+, window: (true|false), project: uat0202p[ab]$' tmp/uat-0202/out.txt) pa-dev=$(grep -cE '^uat0202pa-dev .*project: uat0202pa$' tmp/uat-0202/out.txt) pa-web=$(grep -cE '^uat0202pa-web .*project: uat0202pa$' tmp/uat-0202/out.txt) pb-dev=$(grep -cE '^uat0202pb-dev .*project: uat0202pb$' tmp/uat-0202/out.txt) stderr-bytes=$(wc -c < tmp/uat-0202/err.txt | tr -d ' ')"
  ```
- **Expected Result**: `rc=0`, then stdout `Background processes (all projects):`, `uat0202pa-dev — state: <S>, window: true, project: uat0202pa`, `uat0202pa-web — state: <S>, window: true, project: uat0202pa`, `uat0202pb-dev — state: <S>, window: true, project: uat0202pb` in that order, and an empty stderr. The second command prints `lines=3 pa-dev=1 pa-web=1 pb-dev=1 stderr-bytes=0`.
- **Repeatable Unit Test**: Not applicable: shell script against a live host-server
- [x] Pass <!-- 2026-09-20 -->
  - _auto-judge_: `lines=3 pa-dev=1 pa-web=1 pb-dev=1 stderr-bytes=0`, rc=0, sorted order as expected.

### UAT-LIVE-004: `list --all` without `CONDUCTOR_AGENT_NAME` needs no identity and prints no note
- **Description**: `--all` must work for a human at a plain shell (variable unset) without the "could not resolve" note, because the note is only for the default scoped mode.
- **Steps**:
  1. Run the command below as-is.
- **Command**:
  ```bash
  bash tmp/uat-0202/dc.sh - 18793 tmp/uat-0202/offline-state list --all
  ```
- **Expected Result**: identical stdout to UAT-LIVE-003 (header `Background processes (all projects):` and the three `, project:` lines), `rc=0`, and nothing under `--- stderr`.
- **Repeatable Unit Test**: Not applicable: shell script against a live host-server
- [x] Pass <!-- 2026-09-20 -->
  - _auto-judge_: stdout identical to UAT-LIVE-003 (header + three `, project:` lines), rc=0, empty stderr.

### UAT-LIVE-005: a caller whose project owns no bg process gets an explicit empty result, not the other projects
- **Description**: `uat0202pc` has an agent (`carol`) but no bg process. The script must scope to that project and say so; falling back to all projects here would be the "showing more" fallback wrongly applied to a resolved caller, so no stderr note is expected.
- **Steps**:
  1. Run the command below as-is.
- **Command**:
  ```bash
  bash tmp/uat-0202/dc.sh uat0202pc-carol 18793 tmp/uat-0202/offline-state list
  ```
- **Expected Result**: `rc=0`; stdout is exactly `Background processes for project uat0202pc (use --all for every project):` then `No background processes registered for project uat0202pc.`; nothing under `--- stderr`. No `uat0202pa-*` or `uat0202pb-*` line anywhere.
- **Repeatable Unit Test**: Not applicable: shell script against a live host-server
- [x] Pass <!-- 2026-09-20 -->
  - _auto-judge_: rc=0, exactly the two expected stdout lines, empty stderr, no pa/pb lines.

### UAT-EDGE-002: no or empty `CONDUCTOR_AGENT_NAME` falls back to all projects with a stderr note, exit 0
- **Scenario**: A shell with the variable unset, and one with it set to the empty string (the script treats both as unset and must not send an `X-Conductor-Agent` header).
- **Steps**:
  1. Run the two commands below as-is.
- **Command**:
  ```bash
  bash tmp/uat-0202/dc.sh - 18793 tmp/uat-0202/offline-state list
  ```
  ```bash
  bash tmp/uat-0202/dc.sh '' 18793 tmp/uat-0202/offline-state list
  ```
- **Expected Result**: for both: `rc=0`; stdout is the all-projects listing (`Background processes (all projects):` then the three `, project:` lines of UAT-LIVE-003); stderr is exactly the single line `Note: could not resolve your project (CONDUCTOR_AGENT_NAME is not set); showing all projects.`
- **Repeatable Unit Test**: Not applicable: shell script against a live host-server
- [x] Pass <!-- 2026-09-20 -->
  - _auto-judge_: both runs rc=0, all-projects listing, stderr exactly the single expected `CONDUCTOR_AGENT_NAME is not set` note.

### UAT-EDGE-003: an unregistered window name, and a bare agent name, fall back to all projects with the `unknown` note
- **Scenario**: `CONDUCTOR_AGENT_NAME` is set but the host-server does not know it: a plausible-looking `<project>-<name>` that is not registered, and the bare agent name `alice` (the identity is the tmux window name, not the agent name). The whoami answer is `unknown`, so the script must show every project rather than hide processes from a caller it cannot place.
- **Steps**:
  1. Run the two commands below as-is.
- **Command**:
  ```bash
  bash tmp/uat-0202/dc.sh uat0202pa-nobody 18793 tmp/uat-0202/offline-state list
  ```
  ```bash
  bash tmp/uat-0202/dc.sh alice 18793 tmp/uat-0202/offline-state list
  ```
- **Expected Result**: for both: `rc=0`; stdout is the all-projects listing (`Background processes (all projects):` and the three `, project:` lines); stderr is exactly `Note: could not resolve your project (not a registered agent (whoami kind: unknown)); showing all projects.`
- **Repeatable Unit Test**: Not applicable: shell script against a live host-server
- [x] Pass <!-- 2026-09-20 -->
  - _auto-judge_: both runs rc=0, all-projects listing, stderr exactly `Note: could not resolve your project (not a registered agent (whoami kind: unknown)); showing all projects.`

### UAT-EDGE-004: every other unresolved-caller branch falls back with its own reason, and the header rides on both requests (stub server)
- **Scenario**: Branches the real server cannot produce on demand, driven through the stub on port 18794 (started in the Prerequisites; two fake projects `sa` id 7 and `sb` id 8, one process each): a resolved agent (`stub-ok`, project sa) is scoped to sa; an agent with `projectId: null` (`stub-nullproj`); a non-JSON whoami body (`stub-garbage`); whoami `human` (`stub-human`); whoami `ambiguous` (`stub-ambiguous`); whoami answering HTTP 500 (`stub-500`); a non-integer `projectId` (`stub-badid`, must never reach `jq --argjson`). Also proves `api_get` sends `X-Conductor-Agent` on both `/api/status` and `/api/agents/whoami` when the variable is set, and sends none when it is unset. Every fallback exits 0 and shows both projects.
- **Steps**:
  1. Run the first command (prints a compact transcript per header), then the second (sends one header-less `--all` request), then the third (the request log).
- **Command**:
  ```bash
  rm -f tmp/uat-0202/stub-requests.log; for H in stub-ok stub-nullproj stub-garbage stub-human stub-ambiguous stub-500 stub-badid; do echo "=== $H"; bash tmp/uat-0202/dc.sh $H 18794 tmp/uat-0202/offline-state list | grep -E '^(rc=|Background|Note:|sa-|sb-)'; done
  ```
  ```bash
  bash tmp/uat-0202/dc.sh - 18794 tmp/uat-0202/offline-state list --all > /dev/null
  ```
  ```bash
  cat tmp/uat-0202/stub-requests.log
  ```
- **Expected Result**:
  - `=== stub-ok`: `rc=0`, `Background processes for project sa (use --all for every project):`, `sa-dev — state: running, window: true` and no `sb-dev` line, no `Note:`.
  - `=== stub-nullproj`: `rc=0`, `Background processes (all projects):`, `sa-dev — state: running, window: true, project: sa`, `sb-dev — state: running, window: true, project: sb`, `Note: could not resolve your project (agent has no project); showing all projects.`
  - `=== stub-garbage`: same shape, note `... (unparseable whoami response); showing all projects.`
  - `=== stub-human`: same shape, note `... (whoami kind: human); showing all projects.`
  - `=== stub-ambiguous`: same shape, note `... (ambiguous agent name (whoami kind: ambiguous)); showing all projects.`
  - `=== stub-500`: same shape, note `... (host-server did not answer /api/agents/whoami); showing all projects.`
  - `=== stub-badid`: same shape, note `... (unparseable whoami response); showing all projects.`
  - Each note line begins `Note: could not resolve your project (` exactly as in UAT-EDGE-002.
  - The request log has 15 lines: for each of the seven headers in order, `/api/status <header>` then `/api/agents/whoami <header>` (14 lines), then a last line `/api/status NOHEADER` with no `/api/agents/whoami` line after it (`--all` skips resolution, and an unset variable sends no header).
- **Repeatable Unit Test**: Not applicable: shell script against a stub HTTP server; the repo's only shell verifier (`scripts/verify-dev-commands.sh`) has no server, so these branches have no existing runner. Candidate for TASK-0208's consolidated live checks.
- [x] Pass <!-- 2026-09-20 -->
  - _auto-judge_: all seven transcripts match Expected (stub-ok scoped to sa with no Note; six fallbacks with the exact reason wording); request log has the 15 expected lines ending `/api/status NOHEADER` with no trailing whoami.

### UAT-EDGE-005: host-server unreachable falls back to the offline state files with the "cannot filter by project offline" note
- **Scenario**: `BACKEND_PORT` points at 18795 where nothing listens, with `CONDUCTOR_AGENT_NAME` set to a valid agent. State files cannot be filtered by project (a file name is a slug with no project field), so the default lists every state file and says so; `--all` lists the same without the filter clause. Exit 0 either way.
- **Steps**:
  1. Run the two commands below as-is.
- **Command**:
  ```bash
  bash tmp/uat-0202/dc.sh uat0202pa-alice 18795 tmp/uat-0202/offline-state list
  ```
  ```bash
  bash tmp/uat-0202/dc.sh uat0202pa-alice 18795 tmp/uat-0202/offline-state list --all
  ```
- **Expected Result**: first: `rc=0`, stdout `Background processes (from state files):`, `uat0202pa-dev — state: running`, `uat0202pb-dev — state: running`; stderr exactly `Note: host-server unreachable; using offline state files instead. (cannot filter by project offline)`. Second: same stdout and `rc=0`; stderr exactly `Note: host-server unreachable; using offline state files instead.` (no filter clause). Both state files appear in both runs (they belong to different projects, and nothing is hidden).
- **Repeatable Unit Test**: Created: `scripts/verify-dev-commands.sh` (its offline checks assert the same notes and exit codes against fixture state files; this case adds the valid-agent-name variant on the private stack)
- **Unit Test Command**: `bash scripts/verify-dev-commands.sh`
- [x] Pass <!-- 2026-09-20 -->
  - _auto-judge (live command)_: both runs rc=0, offline header + both state files; stderr exactly matches (with clause for default, without for `--all`).

### UAT-EDGE-006: `jq` missing degrades to all projects with a note that names `jq`, exit 0
- **Scenario**: `list` run where `jq` is not on `PATH` (a scratch `PATH` containing only `curl`, `basename`, `sed`, `cat`) against the live private server. Project scoping needs `jq` to parse whoami and filter, so the script must not pretend to filter: it must show everything, say why on stderr, and exit 0. (The task text describes this as the same `Could not resolve your project (jq ...)` note; the implemented and documented behaviour is the earlier offline fallback with a `jq not available` note. Either satisfies the requirement that fallbacks show more, never less, and say so; this case asserts that requirement and the documented wording.)
- **Steps**:
  1. Run the command below as-is.
- **Command**:
  ```bash
  mkdir -p tmp/uat-0202/nojq-bin && for t in curl basename sed cat; do ln -sf "$(command -v $t)" tmp/uat-0202/nojq-bin/$t; done; PATH="$PWD/tmp/uat-0202/nojq-bin" /bin/bash tmp/uat-0202/dc.sh uat0202pa-alice 18793 tmp/uat-0202/offline-state list
  ```
- **Expected Result**: `rc=0`; stdout `Background processes (from state files):` then `uat0202pa-dev — state: running` and `uat0202pb-dev — state: running` (every project's state file, none filtered out); stderr exactly `Note: jq not available; using offline state files instead. (cannot filter by project offline)`. A crash, a non-zero exit, or output containing only project A's process is a FAIL.
- **Repeatable Unit Test**: Not applicable: needs a live host-server plus a `jq`-less `PATH`; no existing shell runner covers it
- [x] Pass <!-- 2026-09-20 -->
  - _auto-judge_: rc=0, both projects' state files listed, stderr exactly `Note: jq not available; using offline state files instead. (cannot filter by project offline)`.

### UAT-EDGE-007: an unknown `list` option is a usage error, exit 1, with no listing
- **Scenario**: `list --bogus` (and any flag other than `--all`) exits 1 with the option named and the usage line on stderr, and prints nothing on stdout, even with a healthy host-server. Only `--all` was added; there is no `--project`.
- **Steps**:
  1. Run the two commands below as-is.
- **Command**:
  ```bash
  bash tmp/uat-0202/dc.sh uat0202pa-alice 18793 tmp/uat-0202/offline-state list --bogus
  ```
  ```bash
  bash tmp/uat-0202/dc.sh uat0202pa-alice 18793 tmp/uat-0202/offline-state list --project uat0202pb
  ```
- **Expected Result**: first: `rc=1`, empty stdout, stderr `Unknown option: --bogus` then `Usage: dev-commands.sh list [--all]`. Second: `rc=1`, empty stdout, stderr `Unknown option: --project` then the same usage line (the first bad argument stops parsing; `uat0202pb` is never treated as a project filter).
- **Repeatable Unit Test**: Created: `scripts/verify-dev-commands.sh` (the `list --bogus` check asserts exit 1, the `Unknown option` line and the `list [--all]` usage against a dead port)
- **Unit Test Command**: `bash scripts/verify-dev-commands.sh`
- [x] Pass <!-- 2026-09-20 -->
  - _auto-judge (live command)_: both runs rc=1, empty stdout, stderr `Unknown option: --bogus` / `--project` then `Usage: dev-commands.sh list [--all]`.

### UAT-LIVE-006: `status <slug>` still works through the migrated `api_get` and shows the live window
- **Description**: `fetch_api_status` was migrated onto the new `api_get`, which `status` and the slug resolver (`list_slugs`) use. A regression there would break `status` even though `list` works. The state file for `uat0202pa-dev` exists in the scratch state dir; the live cross-check must come from the private host-server, once with the header set (an agent) and once with it unset.
- **Steps**:
  1. Run the two commands below as-is.
- **Command**:
  ```bash
  bash tmp/uat-0202/dc.sh uat0202pa-alice 18793 tmp/uat-0202/offline-state status uat0202pa-dev
  ```
  ```bash
  bash tmp/uat-0202/dc.sh - 18793 tmp/uat-0202/offline-state status uat0202pb-dev
  ```
- **Expected Result** (updated 2026-10-17: TASK-0204 replaced the original `State file (...)` / `Live window status (from host-server):` / `windowPresent: true` layout with the liveness-first format; the intent is unchanged: `status` works through the migrated `api_get` and shows live host-server data): each prints `rc=0`, then stdout `<slug> (project <name>)`, `  liveness:     <running|exited|stopped>` (observed `running`), `  window:       present`, `  last restart: never` (a `last restart:` line appears when the server reports `lastRestart`; `never` when none is on record), `  state file:   <state or (none)>  (poll-lagged, may be up to one poll interval old)` and one interpreting sentence, with an empty stderr; `<slug>` is `uat0202pa-dev` then `uat0202pb-dev`. `Live cross-check unavailable` or `unknown (host-server predates liveness reporting)` in either output is a FAIL.
- **Repeatable Unit Test**: Created: `scripts/verify-dev-commands.sh` (asserts the offline `status` output; the live cross-check needs the running server, hence this case)
- **Unit Test Command**: `bash scripts/verify-dev-commands.sh`
- [x] Pass <!-- 2026-10-17 -->
  - _resolution (2026-10-17)_: the earlier FAIL was a stale-spec mismatch, not a defect. Expected text updated to the TASK-0204 `status` format; verified against `print_bg_status_online` in `skills/dev-commands/scripts/dev-commands.sh` (prints `<slug> (project <name>)`, `liveness:`, `window:`, `last restart:`, `state file:`, then a sentence) and `bash scripts/verify-dev-commands.sh` (184 PASS, 0 FAIL, hermetic). The earlier live re-run below already showed exactly this output with rc=0 and empty stderr.
  - _evidence_: re-run on a fresh private stack (ports/fixtures rebuilt; a stale leftover private server from an earlier interrupted run was found holding :18793 and torn down first). Both runs still rc=0, empty stderr, no `Live cross-check unavailable`; output is now `<slug> (project <name>)` / `liveness: running` / `window: present` / `last restart: never` / `state file: running (poll-lagged...)`, confirmed against the current `cmd_status`/`print_bg_status_online` source (`skills/dev-commands/scripts/dev-commands.sh`) — the online path with a resolved entry never emits the old literal lines at all, so this is a permanent format change, not a flake. The intent (status works through the migrated `api_get` and shows live host-server data) is demonstrably met; only the wording changed. Recommend `/uat-skip` or re-pass by a human once TASK-0204's UAT covers `status`.

### UAT-API-005: cleanup the private stack
- **Description**: Removes every artifact of the live cases: the private host-server, the stub server, the private tmux server (which also kills the fixture agent and bg windows), and `tmp/uat-0202/`. Run last, and run it even if earlier cases failed or were blocked. The real `conductor` tmux session, `./data/conductor.db` and `./logs` are never involved.
- **Steps**:
  1. Run the command below.
  2. Confirm the live `conductor` session is untouched and the fixture directory is gone.
- **Command**:
  ```bash
  (lsof -ti tcp:18793 -sTCP:LISTEN | xargs kill; lsof -ti tcp:18794 -sTCP:LISTEN | xargs kill; sleep 2; env -u TMUX -u TMUX_PANE TMUX_TMPDIR="$PWD/tmp/uat-0202/tmux" tmux kill-server; rm -rf tmp/uat-0202; curl -sS -m 2 -o /dev/null -w 'server=%{http_code}\n' 'http://127.0.0.1:18793/api/agents'; curl -sS -m 2 -o /dev/null -w 'stub=%{http_code}\n' 'http://127.0.0.1:18794/api/status'; test -e tmp/uat-0202 && echo 'dir=present' || echo 'dir=gone'; tmux list-sessions -F '#S')
  ```
- **Expected Result**: `server=000` and `stub=000` (connection refused, each preceded by a curl `Failed to connect` line on stderr), `dir=gone`, and the final `tmux list-sessions` (the real server) still lists `conductor`. `tmux kill-server` may print `no server running on .../tmp/uat-0202/tmux/...` if the private server was already gone, and `xargs kill` may print a usage line if a port was already free; neither matters.
- **Repeatable Unit Test**: Not applicable: lifecycle cleanup of live processes and scratch files
- [x] Pass <!-- 2026-09-20 -->
  - _auto-judge_: `server=000`, `stub=000`, `dir=gone`, real tmux still lists `conductor`.

---

## Notes for the judge

- **Auto-judgeable without the live stack**: UAT-UNIT-001, UAT-EDGE-001 (unit-backed), UAT-INT-001 (typecheck, scoped), UAT-INT-002 (syntax + `verify-dev-commands.sh`), UAT-INT-003 and UAT-DOC-001 (text search). The live cases (UAT-API-001 .. 004, UAT-LIVE-001 .. 006, UAT-EDGE-002 .. 007) are machine-executable end to end on the private stack, gated by UAT-API-001 (route present); run them in the order written because they share one server, one fixture and `tmp/uat-0202/out.txt`/`err.txt`. Always run UAT-API-005 (cleanup), even after failures.
- **Never call the script directly**: always through `tmp/uat-0202/dc.sh`. The judge's own `CONDUCTOR_AGENT_NAME` / `BACKEND_PORT` are typically set; an unwrapped call could resolve as the judge's own agent or hit `:8788`.
- **`ambiguous` is not live-testable**: the agent-creation route rejects a second agent whose tmux window name equals an existing one (`500 an agent with tmux window name '...' already exists`, TASK-0196), so no `X-Conductor-Agent` value can be ambiguous on a real server. It is covered by the resolver tests (UAT-0194) and UAT-EDGE-001 at the mapping level, and by the stub in UAT-EDGE-004 at the script level.
- **Scope with TASK-0203 / TASK-0204**: they edit the same script and `SKILL.md` later. If `dev-commands.sh` now has a `restart` subcommand or a liveness column in `status`/`list` lines, judge only the TASK-0202 behaviour asserted here; if a later task deliberately changed the `list` line format, that is a legitimate cause of a UAT-LIVE-* mismatch to report as "superseded by TASK-0204", not a TASK-0202 failure.
- **State column value**: on the private stack the server reports a bg process `state` of `null` (no state file is written for it); the cases accept any single token without a comma. `window: true` is required for the fixture processes (their tmux windows are live).
- **Known noise**: a transient `500 ... create window failed: index N in use` while registering fixture agents leaves a valid DB row (see UAT-API-002); the private host-server may print tmux/monitor start-up lines to `tmp/uat-0202/server.log`; ignore it. The other-session `transitionsLog.test.ts` source-regex failure noted in the task is not part of this UAT.
- **Not covered**: a project-less agent (`projectId: null`) on a real server (agent rows carry a project since TASK-0195; the script branch is covered by the `stub-nullproj` stub in UAT-EDGE-004 and the mapping by UAT-EDGE-001); `dev-commands.sh` run from inside a real agent pane with the spawn-time `CONDUCTOR_AGENT_NAME` (that env var is set by `host-server/index.ts` spawn code and is unchanged by this task).
