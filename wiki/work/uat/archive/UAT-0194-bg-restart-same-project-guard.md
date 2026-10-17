---
id: UAT-0194
aliases: [UAT-0194]
title: "UAT: Resolve the calling agent's project on the server and restrict bg restart to same-project callers"
status: passed
task: TASK-0194
created: 2026-09-20
updated: 2026-09-20
---

# UAT-0194 — UAT: Resolve the calling agent's project on the server and restrict bg restart to same-project callers

implements::[[TASK-0194]]

> **Source task**: [[TASK-0194]]
> **Generated**: 2026-09-20
>
> **What changed**: new `host-server/bgAccess.ts` with two pure functions. `resolveCallerProject(header, agents)` matches the `X-Conductor-Agent` header by exact equality with `agentWindowName()` and returns `human | agent | unknown | ambiguous`. `authorizeRestart(caller, bg, policy)` allows a human, allows an agent only in the bg process's own project, and denies an agent on a bg process with no project (TASK-0186 policy `must-assign`, one-line switch `UNSCOPED_BG_POLICY`), an unknown caller and an ambiguous caller. `null === null` never authorizes. `host-server/bgRestartPolicy.ts` gained `BgRestartDenyReason` and an optional `reason` on the audit input/record. The route `POST /api/bg-processes/:slug/restart` in `host-server/index.ts` returns `403 { error, reason, callerProjectId, bgProjectId }` and writes a `denied` line to `bg-restarts.jsonl`; a denial does not touch tmux and does not arm the cooldown. Check order is now 404, 403, 409 (session not running), 429 (cooldown), restart.
>
> **Out of scope**: `GET /agents/whoami` (TASK-0202); the window open/close, PATCH and DELETE routes and the read routes stay unguarded by design; the guard is not a security boundary (self-declared header on a no-auth localhost server).

This UAT carries the live 403 smoke recipe that TASK-0194 Step 5 marked `[DEFERRED-TO-UAT]`, extended to the full check-order matrix.

---

## Prerequisites

**Isolation rules (read first).** Every live case (UAT-API-*, UAT-LIVE-*) runs against a **private stack**: its own tmux server (`TMUX_TMPDIR=tmp/uat-0194/tmux`, session `uat0194`), its own conf, SQLite DB and `LOG_DIR` (all under `tmp/uat-0194/`), and its own host-server on port **18794**. Never send a request to `:8788` (a stale build), never touch the live `conductor` tmux session, never restart the real `dev` / `dev-stack` bg processes, and never read or write the real `logs/bg-restarts.jsonl` (the private `LOG_DIR` is `tmp/uat-0194/logs`). Every tmux command is prefixed with `env -u TMUX -u TMUX_PANE TMUX_TMPDIR="$PWD/tmp/uat-0194/tmux"` so it reaches the private server even when the shell runs inside tmux. No `.env` file is read or written; every scratch file lives in `./tmp/uat-0194/`.

Unit, static, typecheck and doc cases (UAT-UNIT-*, UAT-EDGE-*, UAT-INT-001, UAT-DOC-001) need none of the live stack.

- [ ] Run everything from the repo root `/Users/davidtaylor/Repositories/tmux-conductor`. Tools needed: `tmux` (>= 3.0), `node`, `curl`, `jq`, `sqlite3`, `lsof`. Port 18794 is free (`lsof -ti tcp:18794` prints nothing).
- [ ] Live cases only: create the scratch dir and the private conf (`BG_RESTART_COOLDOWN_S=120` keeps the cooldown window comfortably longer than the case sequence):
  ```bash
  rm -rf tmp/uat-0194 && mkdir -p tmp/uat-0194/tmux tmp/uat-0194/data tmp/uat-0194/logs/state && printf '%s\n' 'SESSION_NAME="uat0194"' 'DB_PATH="./data/conductor.db"' 'LOG_DIR="./logs"' 'STATE_DIR="./logs/state"' 'POLL_INTERVAL=15' 'BG_RESTART_COOLDOWN_S=120' > tmp/uat-0194/conductor.conf
  ```
- [ ] Start the private tmux server with a keeper window (the session must exist so the restart route does not answer 409 until UAT-API-012 kills it on purpose):
  ```bash
  env -u TMUX -u TMUX_PANE TMUX_TMPDIR="$PWD/tmp/uat-0194/tmux" tmux new-session -d -s uat0194 -n keeper 'sleep 3600'
  ```
- [ ] Start the private host-server from the working tree (background; it must stay up until UAT-API-014). It reads `CONDUCTOR_CONF`, so it never touches `./data/conductor.db`:
  ```bash
  R="$PWD"; cd host-server && env -u TMUX -u TMUX_PANE TMUX_TMPDIR="$R/tmp/uat-0194/tmux" CONDUCTOR_CONF="$R/tmp/uat-0194/conductor.conf" BACKEND_PORT=18794 PORT=18794 nohup node --import tsx/esm index.ts > "$R/tmp/uat-0194/server.log" 2>&1 &
  ```
- [ ] Wait for it to answer. An empty agent list proves it is the private, empty DB and not the live server:
  ```bash
  sleep 10 && curl -sS 'http://127.0.0.1:18794/api/agents'
  ```
  Expected: `[]`. If this does not print `[]`, stop and mark every live case BLOCKED.
- [ ] Create the fixtures: project A `uat0194a` (id 1) with agent `alpha` (window `uat0194a-alpha`) and bg process `web` (slug `uat0194a-web`); project B `uat0194b` (id 2) with agent `beta` (window `uat0194b-beta`); one project-less agent `solo` (window `solo`). The agent windows run an inert `sleep 3600`. `POST /api/projects/:id/agents` and `POST /api/agents` can answer `500` right after a fresh start even though the agent row was written (observed on the second and third agent), so the next step's listing is the fixture check, not these responses; if a row is missing, re-run just that line.
  ```bash
  W="$PWD/tmp/uat-0194"; B=http://127.0.0.1:18794/api; H='Content-Type: application/json'; curl -sS -o /dev/null -X POST "$B/projects" -H "$H" -d "{\"name\":\"uat0194a\",\"workdir\":\"$W\"}"; sleep 1; curl -sS -o /dev/null -X POST "$B/projects" -H "$H" -d "{\"name\":\"uat0194b\",\"workdir\":\"$W\"}"; sleep 1; curl -sS -o /dev/null -X POST "$B/projects/1/agents" -H "$H" -d '{"name":"alpha","launchCmd":"sleep 3600"}'; sleep 1; curl -sS -o /dev/null -X POST "$B/projects/2/agents" -H "$H" -d '{"name":"beta","launchCmd":"sleep 3600"}'; sleep 1; curl -sS -o /dev/null -X POST "$B/agents" -H "$H" -d "{\"name\":\"solo\",\"workdir\":\"$W\",\"launchCmd\":\"sleep 3600\"}"; sleep 1; curl -sS -o /dev/null -X POST "$B/bg-processes" -H "$H" -d "{\"name\":\"web\",\"projectId\":1,\"workdir\":\"$W\",\"launchCmd\":\"i=0; while true; do i=\$((i+1)); echo tick \$i; sleep 1; done\"}"; sleep 3
  ```
- [ ] Verify the fixtures and record the bg process's baseline pane pid (used by UAT-LIVE-001 and UAT-LIVE-002):
  ```bash
  W="$PWD/tmp/uat-0194"; curl -sS 'http://127.0.0.1:18794/api/agents' | jq -c '[.[] | .name + ":" + (.projectName // "-")] | sort'; env -u TMUX -u TMUX_PANE TMUX_TMPDIR="$W/tmux" tmux display-message -p -t 'uat0194:=uat0194a-web' '#{pane_pid}' > "$W/pid.before"; cat "$W/pid.before"
  ```
  Expected: `["alpha:uat0194a","beta:uat0194b","solo:-"]` then one integer (the pid). Anything else: stop and mark every live case BLOCKED.

---

## Test Cases

### UAT-UNIT-001: whole `bgAccess.test.ts` and `bgRestartPolicy.test.ts` suites pass (57 tests)
- **Description**: `bgAccess.test.ts` (21 tests) covers the resolver, the guard matrix, the denied audit record and a static pin of the route wiring. `bgRestartPolicy.test.ts` (36 tests) covers the cooldown/audit module the guard builds on, including the extended audit record. File-scoped, so other in-flight sessions' test files cannot affect the result.
- **Steps**:
  1. Run the command below from the repo root.
- **Command**:
  ```bash
  cd host-server && node --import tsx/esm --test bgAccess.test.ts bgRestartPolicy.test.ts
  ```
- **Expected Result**: `tests 57`, `pass 57`, `fail 0`, `cancelled 0`, `skipped 0`; exit code 0.
- **Repeatable Unit Test**: Created: `host-server/bgAccess.test.ts`, `host-server/bgRestartPolicy.test.ts` (written by the TASK-0194 implementer; no new test file was written by this UAT)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test bgAccess.test.ts bgRestartPolicy.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-EDGE-001: the resolver matches the header by exact window name only and reports ambiguity
- **Scenario**: `resolveCallerProject` returns `human` for an absent header, `agent` (with its `projectId`, `null` for a project-less agent) for an exact `agentWindowName()` match, `unknown` for the bare short name of a project agent, and for near-miss / prefix / suffix / case-different / whitespace / empty headers. `foo` never matches `foo-copy` and vice versa. Two agents sharing a window name (project `a-b` + agent `c` versus project `a` + agent `b-c`, or a project-less agent named like a project window) resolve to `ambiguous`.
- **Steps**:
  1. Run the command below.
- **Command**:
  ```bash
  cd host-server && node --import tsx/esm --test --test-name-pattern='resolveCallerProject' bgAccess.test.ts
  ```
- **Expected Result**: `tests 9`, `pass 9`, `fail 0`. Includes `near-miss, prefix, suffix and case-different headers do not match`, the `foo` versus `foo-copy` test, and `ambiguous when two agents share a window name (project a-b + c vs project a + b-c)`.
- **Repeatable Unit Test**: Created: `host-server/bgAccess.test.ts`
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern='resolveCallerProject' bgAccess.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-EDGE-002: the guard matrix allows a human and a same-project agent and fails closed on everything else
- **Scenario**: `authorizeRestart` allows a human under every policy and bg scope; allows an agent only when `caller.projectId !== null && caller.projectId === bg.projectId`; denies a different-project agent and a project-less agent against a scoped bg with `project-mismatch` (carrying both project ids); denies any agent, including a project-less one (`null === null`), against an unscoped bg with `unscoped` under `must-assign` and `hidden`, and allows it only under `visible`; denies `unknown` and `ambiguous` callers with `unknown-caller` / `ambiguous-caller` even against an unscoped bg under `visible`. The default policy is the TASK-0186 decision `must-assign`.
- **Steps**:
  1. Run the command below.
- **Command**:
  ```bash
  cd host-server && node --import tsx/esm --test --test-name-pattern='authorizeRestart' bgAccess.test.ts
  ```
- **Expected Result**: `tests 8`, `pass 8`, `fail 0`. Includes `null === null never authorizes (project-less agent, unscoped bg)` and `the default policy is the TASK-0186 decision (must-assign, agents denied)`.
- **Repeatable Unit Test**: Created: `host-server/bgAccess.test.ts`
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern='authorizeRestart' bgAccess.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-EDGE-003: a denied request produces an audit record with `outcome: denied` and a `reason`, and old records are unchanged
- **Scenario**: Through the injectable appender, a denied restart is written as exactly `{ts, bg, callerKind:'agent', caller, outcome:'denied', reason:'project-mismatch'}` to `<logDir>/bg-restarts.jsonl`. `buildAuditRecord` adds no `reason` key unless one is given, so existing `restarted` / `cooldown` / `failed` records keep their exact shape.
- **Steps**:
  1. Run the command below.
- **Command**:
  ```bash
  cd host-server && node --import tsx/esm --test --test-name-pattern='denied request produces|backwards-compatible' bgAccess.test.ts
  ```
- **Expected Result**: `tests 2`, `pass 2`, `fail 0`.
- **Repeatable Unit Test**: Created: `host-server/bgAccess.test.ts`
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern='denied request produces|backwards-compatible' bgAccess.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-EDGE-004: the route runs the guard before the session check and the cooldown (static pin)
- **Scenario**: `index.ts` imports `bgAccess.ts`, calls `resolveCallerProject(` and `authorizeRestart(`, answers `403`, writes `outcome: 'denied'`, and the guard appears in source before `step: 'session-check'`, which appears before `evaluateCooldown(`. (`index.ts` binds a port on import, so the route is pinned statically here and exercised for real by UAT-API-001 .. 013.)
- **Steps**:
  1. Run the command below.
- **Command**:
  ```bash
  cd host-server && node --import tsx/esm --test --test-name-pattern='index.ts wires the guard' bgAccess.test.ts
  ```
- **Expected Result**: `tests 1`, `pass 1`, `fail 0`.
- **Repeatable Unit Test**: Created: `host-server/bgAccess.test.ts`
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern='index.ts wires the guard' bgAccess.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-EDGE-005: the header normalizer feeds the resolver correctly (trim, repeated header, length cap, case)
- **Scenario**: The route resolves `parseCallerHeader(req.headers['x-conductor-agent'])`, not the raw header. Against one agent `alpha` in project `a` (window `a-alpha`): an absent header and a whitespace-only header are `human` (the TASK-0193 dashboard convention); surrounding whitespace and a tab are trimmed so `'  a-alpha\t'` is `agent`; a repeated header uses its first element (`agent`); a 200-character header is capped at 128 characters and no longer equals the window name (`unknown`); `A-ALPHA` (case) and the bare short name `alpha` are `unknown`. This documents the accepted spoof caveat too: omitting the header is a human, by design.
- **Steps**:
  1. Run the command below and read the last line of its output (importing the modules also prints a `confPath:` block, which is noise).
- **Command**:
  ```bash
  cd host-server && node --import tsx/esm -e "Promise.all([import('./bgRestartPolicy.ts'),import('./bgAccess.ts')]).then(([p,a])=>{const A=[{id:1,name:'alpha',projectId:1,projectName:'a'}];const r=(h)=>a.resolveCallerProject(p.parseCallerHeader(h),A).kind;console.log([r(undefined),r('   '),r('  a-alpha\t'),r(['a-alpha','x']),r('a-alpha'.padEnd(200,'x')),r('A-ALPHA'),r('alpha')].join(' '))})" | tail -1
  ```
- **Expected Result**: exactly `human human agent agent unknown unknown unknown`.
- **Repeatable Unit Test**: Not applicable: ad-hoc chain check of two already unit-tested modules; not promoted to a test file because this UAT run was scoped to not edit test sources (the resolver and `parseCallerHeader` are each unit-covered by UAT-EDGE-001 and `bgRestartPolicy.test.ts`; only their composition is checked here)
- [x] Pass <!-- 2026-09-20 -->

### UAT-INT-001: the new and changed host-server files typecheck
- **Description**: `bgAccess.ts`, `bgRestartPolicy.ts` and `index.ts` (plus their tests) produce no `tsc` diagnostics. The filter keeps another in-flight session's errors (for example `agentDiff.test.ts`, `hookLastPrompt.test.ts`) from failing this case.
- **Steps**:
  1. Run the command below.
- **Command**:
  ```bash
  cd host-server && npx tsc --noEmit 2>&1 | grep -E '^(bgAccess|bgRestartPolicy|index)(\.test)?\.ts' | wc -l | tr -d ' '
  ```
- **Expected Result**: prints `0`. Any other number is a FAIL; run `cd host-server && npx tsc --noEmit` to see the diagnostics.
- **Repeatable Unit Test**: Not applicable: type-level check, covered by the host-server typecheck gate rather than a runtime assertion
- [x] Pass <!-- 2026-09-20 -->

### UAT-DOC-001: the guard is documented (CLAUDE.md row, concept page, route comment, restart-log docs)
- **Description**: `CLAUDE.md`'s `host-server/index.ts` row mentions the same-project guard (`TASK-0194`, `not a security boundary`); `wiki/knowledge/concepts/background-process-registry.md` has the `### Same-project restart guard (TASK-0194)` section with the rule table (all four reasons) and the `**Caveat:** not a security boundary` paragraph; the route comment in `host-server/index.ts` states the guard order (`404 unknown bg -> 403 guard -> 409 session -> 429 cooldown -> restart`), the not-a-security-boundary caveat and that the other routes stay `unauthenticated by design`; `scripts/README.md` documents the `X-Conductor-Agent` header and the `denied` outcome.
- **Steps**:
  1. Run the command below.
- **Command**:
  ```bash
  node -e "const fs=require('fs');const rd=(f)=>fs.readFileSync(f,'utf8');const c=rd('CLAUDE.md'),w=rd('wiki/knowledge/concepts/background-process-registry.md'),i=rd('host-server/index.ts').replace(/\n\s*\/\/\s*/g,' '),s=rd('scripts/README.md');console.log(JSON.stringify({claudeRow:c.includes('same-project guard (TASK-0194')&&c.includes('not a security boundary'),registry:w.includes('### Same-project restart guard (TASK-0194)')&&['project-mismatch','unscoped','unknown-caller','ambiguous-caller'].every((k)=>w.includes(k))&&w.includes('**Caveat:** not a security boundary'),routeComment:i.includes('404 unknown bg -> 403 guard -> 409 session -> 429 cooldown -> restart')&&i.includes('NOT a security boundary')&&i.includes('unauthenticated by design'),scriptsReadme:s.includes('X-Conductor-Agent')&&s.includes('denied')}))"
  ```
- **Expected Result**: exactly `{"claudeRow":true,"registry":true,"routeComment":true,"scriptsReadme":true}`.
- **Repeatable Unit Test**: Not applicable: documentation check
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-001: GATE — a cross-project agent is refused with 403 and the documented body
- **Endpoint**: `POST /api/bg-processes/uat0194a-web/restart` with `X-Conductor-Agent: uat0194b-beta` (private stack, port 18794)
- **Description**: Agent `beta` belongs to project B (id 2); bg process `uat0194a-web` belongs to project A (id 1). A server without the guard would answer `200` and restart the process (harmless on the private stack, but it fails this gate). **If the status is not 403 with exactly this body, stop: mark every remaining live case (UAT-API-002 onward, UAT-LIVE-*) BLOCKED.** Do not fall back to `:8788`.
- **Steps**:
  1. Confirm the Prerequisites completed (fixtures verified, `pid.before` written).
  2. Run the curl command below as-is.
- **Command**:
  ```bash
  curl -sS -i -X POST -H 'X-Conductor-Agent: uat0194b-beta' 'http://127.0.0.1:18794/api/bg-processes/uat0194a-web/restart' | sed -n '1p;$p'
  ```
- **Expected Result**: `HTTP/1.1 403 Forbidden` and body exactly `{"error":"restart denied: project-mismatch","reason":"project-mismatch","callerProjectId":2,"bgProjectId":1}`.
- **Repeatable Unit Test**: Created: `host-server/bgAccess.test.ts` (`authorizeRestart: different-project agent is denied with project-mismatch and both project ids`; the pure decision only, the live 403 needs the real route)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern='different-project agent is denied' bgAccess.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-002: an unregistered header value is refused with 403 `unknown-caller` (fail closed)
- **Endpoint**: `POST /api/bg-processes/uat0194a-web/restart` with `X-Conductor-Agent: nobody`
- **Description**: A header that matches no agent's window name must never widen access; it is denied, not treated as a human.
- **Steps**:
  1. Run the curl command below as-is.
- **Command**:
  ```bash
  curl -sS -i -X POST -H 'X-Conductor-Agent: nobody' 'http://127.0.0.1:18794/api/bg-processes/uat0194a-web/restart' | sed -n '1p;$p'
  ```
- **Expected Result**: `HTTP/1.1 403 Forbidden` and body exactly `{"error":"restart denied: unknown-caller","reason":"unknown-caller","callerProjectId":null,"bgProjectId":1}`.
- **Repeatable Unit Test**: Created: `host-server/bgAccess.test.ts` (`authorizeRestart: unknown and ambiguous callers are denied fail-closed...`)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern='unknown and ambiguous callers are denied' bgAccess.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-003: near-miss identities (bare short name, wrong case, prefix) are refused as `unknown-caller`
- **Endpoint**: `POST /api/bg-processes/uat0194a-web/restart` with three headers in turn
- **Description**: The real agent `alpha` lives in the same project as the bg process, so it would be allowed by its window name `uat0194a-alpha`. Its bare short name `alpha`, an upper-cased window name and a prefix of the window name must not match (no prefix, substring or case-insensitive match).
- **Steps**:
  1. Run the command below as-is (three requests).
- **Command**:
  ```bash
  for h in alpha UAT0194A-ALPHA uat0194a-alph; do curl -sS -X POST -H "X-Conductor-Agent: $h" 'http://127.0.0.1:18794/api/bg-processes/uat0194a-web/restart' | jq -r '.reason'; done
  ```
- **Expected Result**: three lines, each `unknown-caller`.
- **Repeatable Unit Test**: Created: `host-server/bgAccess.test.ts` (`resolveCallerProject: near-miss, prefix, suffix and case-different headers do not match`)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern='near-miss, prefix, suffix' bgAccess.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-004: a project-less agent is refused against a project-scoped bg process
- **Endpoint**: `POST /api/bg-processes/uat0194a-web/restart` with `X-Conductor-Agent: solo`
- **Description**: `solo` is a registered agent with no project (`projectId` null). A null project must never match a scoped bg process.
- **Steps**:
  1. Run the curl command below as-is.
- **Command**:
  ```bash
  curl -sS -i -X POST -H 'X-Conductor-Agent: solo' 'http://127.0.0.1:18794/api/bg-processes/uat0194a-web/restart' | sed -n '1p;$p'
  ```
- **Expected Result**: `HTTP/1.1 403 Forbidden` and body exactly `{"error":"restart denied: project-mismatch","reason":"project-mismatch","callerProjectId":null,"bgProjectId":1}`.
- **Repeatable Unit Test**: Created: `host-server/bgAccess.test.ts` (`authorizeRestart: project-less agent against a scoped bg is denied (project-mismatch)`)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern='project-less agent against a scoped bg' bgAccess.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-LIVE-001: the six denials did not touch tmux, wrote no restart marker, and armed nothing
- **Description**: A denial must return before any tmux mutation and must not record a successful restart (which is what arms the cooldown). After UAT-API-001 .. 004 (six denied requests) the bg window's pane pid must equal the baseline in `pid.before`, the process log must hold zero `--- restart <ts> ---` markers, and the audit log must contain only `denied` outcomes.
- **Steps**:
  1. Run the command below.
- **Command**:
  ```bash
  W="$PWD/tmp/uat-0194"; NOW=$(env -u TMUX -u TMUX_PANE TMUX_TMPDIR="$W/tmux" tmux display-message -p -t 'uat0194:=uat0194a-web' '#{pane_pid}'); if [ "$NOW" = "$(cat "$W/pid.before")" ]; then echo 'pane_pid unchanged'; else echo 'pane_pid CHANGED'; fi; echo "markers=$(curl -sS 'http://127.0.0.1:18794/api/bg-processes/uat0194a-web/tail?lines=400&format=text' | grep -c '^--- restart ')"; jq -rs '"outcomes=" + (map(.outcome) | unique | join(",")) + " lines=" + (length | tostring)' "$W/logs/bg-restarts.jsonl"
  ```
- **Expected Result**: three lines: `pane_pid unchanged`, `markers=0`, `outcomes=denied lines=6`.
- **Repeatable Unit Test**: Not applicable: reads live tmux pane state and the live audit file (the route wiring order is pinned by UAT-EDGE-004)
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-005: each denial is audited with `outcome: denied` and its own reason
- **Endpoint**: private `tmp/uat-0194/logs/bg-restarts.jsonl`
- **Description**: Six lines, one per denied request from UAT-API-001 .. 004 in order, each with `callerKind: agent`, the verbatim caller header, `outcome: denied` and the matching `reason`. `ts` is dropped for comparison.
- **Steps**:
  1. Run the command below.
- **Command**:
  ```bash
  jq -c 'del(.ts)' "$PWD/tmp/uat-0194/logs/bg-restarts.jsonl"
  ```
- **Expected Result**: exactly these six lines, in order:
  ```
  {"bg":"uat0194a-web","callerKind":"agent","caller":"uat0194b-beta","outcome":"denied","reason":"project-mismatch"}
  {"bg":"uat0194a-web","callerKind":"agent","caller":"nobody","outcome":"denied","reason":"unknown-caller"}
  {"bg":"uat0194a-web","callerKind":"agent","caller":"alpha","outcome":"denied","reason":"unknown-caller"}
  {"bg":"uat0194a-web","callerKind":"agent","caller":"UAT0194A-ALPHA","outcome":"denied","reason":"unknown-caller"}
  {"bg":"uat0194a-web","callerKind":"agent","caller":"uat0194a-alph","outcome":"denied","reason":"unknown-caller"}
  {"bg":"uat0194a-web","callerKind":"agent","caller":"solo","outcome":"denied","reason":"project-mismatch"}
  ```
- **Repeatable Unit Test**: Created: `host-server/bgAccess.test.ts` (`a denied request produces an audit record with outcome denied and the reason`; the record shape, not the live file write)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern='denied request produces' bgAccess.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-006: a same-project agent is allowed (200), proving the denials armed no cooldown
- **Endpoint**: `POST /api/bg-processes/uat0194a-web/restart` with `X-Conductor-Agent: uat0194a-alpha`
- **Description**: `alpha` is in project A, the bg process's project. This is an agent caller, so it is subject to the cooldown; it must get `200`, not `429`, even though six requests were denied just before (a denial never records a success).
- **Steps**:
  1. Run the curl command below as-is.
- **Command**:
  ```bash
  curl -sS -X POST -H 'X-Conductor-Agent: uat0194a-alpha' 'http://127.0.0.1:18794/api/bg-processes/uat0194a-web/restart' | jq -c '{ok, name, mechanism}'
  ```
- **Expected Result**: HTTP 200 body reduced by jq to `{"ok":true,"name":"uat0194a-web","mechanism":"respawn-window"}`.
- **Repeatable Unit Test**: Created: `host-server/bgAccess.test.ts` (`authorizeRestart: same-project agent is allowed`; the live restart and cooldown state need the real route)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern='same-project agent is allowed' bgAccess.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-LIVE-002: the allowed restart really happened (new pane pid, one restart marker)
- **Description**: Proves UAT-API-006 was a real restart and that UAT-LIVE-001's "unchanged" is a discriminating check: after the allowed restart the pane pid differs from the baseline and the log holds exactly one marker.
- **Steps**:
  1. Run the command below (it waits 3 seconds for the marker to flush).
- **Command**:
  ```bash
  sleep 3; W="$PWD/tmp/uat-0194"; NOW=$(env -u TMUX -u TMUX_PANE TMUX_TMPDIR="$W/tmux" tmux display-message -p -t 'uat0194:=uat0194a-web' '#{pane_pid}'); if [ "$NOW" != "$(cat "$W/pid.before")" ]; then echo 'pane_pid changed'; else echo 'pane_pid SAME'; fi; echo "markers=$(curl -sS 'http://127.0.0.1:18794/api/bg-processes/uat0194a-web/tail?lines=400&format=text' | grep -c '^--- restart ')"
  ```
- **Expected Result**: `pane_pid changed` and `markers=1`.
- **Repeatable Unit Test**: Not applicable: needs a live tmux pane and a real `pipe-pane` log (the restart sequence itself is unit-covered by TASK-0190's `bgRestart.test.ts`)
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-007: the guard runs before the cooldown (a denied caller never sees 429), and the cooldown is live for the allowed caller
- **Endpoint**: `POST /api/bg-processes/uat0194a-web/restart`, two requests
- **Description**: The cooldown is armed by UAT-API-006 (120 s). The cross-project agent `beta` must still get `403 project-mismatch` (it must not learn the cooldown state); the same-project agent `alpha` must get `429 restart cooldown`, which proves the cooldown is armed and makes the 403 result meaningful.
- **Steps**:
  1. Run both commands below as-is, in this order, within 120 seconds of UAT-API-006.
- **Command**:
  ```bash
  curl -sS -i -X POST -H 'X-Conductor-Agent: uat0194b-beta' 'http://127.0.0.1:18794/api/bg-processes/uat0194a-web/restart' | sed -n '1p;$p'
  ```
  ```bash
  curl -sS -i -X POST -H 'X-Conductor-Agent: uat0194a-alpha' 'http://127.0.0.1:18794/api/bg-processes/uat0194a-web/restart' | sed -n '1p;$p'
  ```
- **Expected Result**: First command: `HTTP/1.1 403 Forbidden` and body exactly `{"error":"restart denied: project-mismatch","reason":"project-mismatch","callerProjectId":2,"bgProjectId":1}` (no `retryAfterS`, no `Retry-After`). Second command: `HTTP/1.1 429 Too Many Requests` and a body starting `{"error":"restart cooldown","retryAfterS":` (a value between 1 and 120) and containing `"lastRestartBy":"uat0194a-alpha"`.
- **Repeatable Unit Test**: Created: `host-server/bgAccess.test.ts` (`index.ts wires the guard ... before the cooldown check`; the static order only)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern='index.ts wires the guard' bgAccess.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-008: a header-less human/dashboard caller is unaffected (200, cooldown-exempt)
- **Endpoint**: `POST /api/bg-processes/uat0194a-web/restart` with no `X-Conductor-Agent`
- **Description**: Run while the cooldown from UAT-API-006 is still armed: a human is neither guarded nor rate-limited, exactly as before TASK-0194.
- **Steps**:
  1. Run the curl command below as-is.
- **Command**:
  ```bash
  curl -sS -X POST 'http://127.0.0.1:18794/api/bg-processes/uat0194a-web/restart' | jq -c '{ok, name, mechanism}'
  ```
- **Expected Result**: HTTP 200 body reduced by jq to `{"ok":true,"name":"uat0194a-web","mechanism":"respawn-window"}`.
- **Repeatable Unit Test**: Created: `host-server/bgAccess.test.ts` (`authorizeRestart: human/dashboard caller is allowed, scoped or unscoped bg, under every policy`)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern='human/dashboard caller is allowed' bgAccess.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-009: an unknown bg process is 404 even for a caller that would be denied (404 before 403)
- **Endpoint**: `POST /api/bg-processes/uat0194a-nope/restart` with `X-Conductor-Agent: uat0194b-beta`
- **Description**: The slug does not exist, so there is no bg project to compare against. The 404 must win, and (unchanged from TASK-0193) a 404 is not written to the audit log.
- **Steps**:
  1. Run the curl command below as-is.
- **Command**:
  ```bash
  curl -sS -i -X POST -H 'X-Conductor-Agent: uat0194b-beta' 'http://127.0.0.1:18794/api/bg-processes/uat0194a-nope/restart' | sed -n '1p;$p'
  ```
- **Expected Result**: `HTTP/1.1 404 Not Found` and body exactly `{"error":"bg process 'uat0194a-nope' not found"}`.
- **Repeatable Unit Test**: Not applicable: route-level precondition in `host-server/index.ts` (no route test harness; it binds a port on import)
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-010: a header matching two agents is refused as `ambiguous-caller`
- **Endpoint**: `POST /api/bg-processes/uat0194a-web/restart` with `X-Conductor-Agent: uat0194x-y-z`
- **Description**: `<project>-<name>` is not injective: project `uat0194x-y` + agent `z` and project `uat0194x` + agent `y-z` both have the window name `uat0194x-y-z`. The API refuses to create the second one (`createAgent` rejects a duplicate window name with a 500), so the colliding rows are seeded directly into the **private** DB with `sqlite3`, standing in for legacy data that predates that check. The resolver must refuse the header instead of picking one of the two projects.
- **Steps**:
  1. Create both projects and seed the two agents (private DB only), then confirm the collision:
     ```bash
     W="$PWD/tmp/uat-0194"; B=http://127.0.0.1:18794/api; H='Content-Type: application/json'; curl -sS -o /dev/null -X POST "$B/projects" -H "$H" -d "{\"name\":\"uat0194x-y\",\"workdir\":\"$W\"}"; curl -sS -o /dev/null -X POST "$B/projects" -H "$H" -d "{\"name\":\"uat0194x\",\"workdir\":\"$W\"}"; sqlite3 "$W/data/conductor.db" "INSERT INTO agents(name,workdir,launch_cmd,project_id) VALUES ('z','$W','sleep 3600',(SELECT id FROM projects WHERE name='uat0194x-y')),('y-z','$W','sleep 3600',(SELECT id FROM projects WHERE name='uat0194x'));"; curl -sS "$B/agents" | jq -c '[.[] | select((.projectName // "") | startswith("uat0194x")) | .projectName + "-" + .name] | sort'
     ```
     Expect `["uat0194x-y-z","uat0194x-y-z"]`. If the listing does not show two identical entries, mark this case BLOCKED (the resolver's ambiguous branch is still covered by UAT-EDGE-001).
  2. Run the curl command below as-is.
- **Command**:
  ```bash
  curl -sS -i -X POST -H 'X-Conductor-Agent: uat0194x-y-z' 'http://127.0.0.1:18794/api/bg-processes/uat0194a-web/restart' | sed -n '1p;$p'
  ```
- **Expected Result**: `HTTP/1.1 403 Forbidden` and body exactly `{"error":"restart denied: ambiguous-caller","reason":"ambiguous-caller","callerProjectId":null,"bgProjectId":1}`.
- **Repeatable Unit Test**: Created: `host-server/bgAccess.test.ts` (`resolveCallerProject: ambiguous when two agents share a window name...` and `authorizeRestart: unknown and ambiguous callers are denied fail-closed...`)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern='ambiguous' bgAccess.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-011: agents are refused on a bg process with no project (`unscoped`); a human is still allowed
- **Endpoint**: `POST /api/bg-processes/legacy/restart`
- **Description**: Every bg process has a project (TASK-0195/0196 enforce it), so on a current DB an unscoped row cannot exist. The guard keeps a fail-closed branch for one that slips through (for example on a DB the `NOT NULL` migration has not run on). This case simulates that in the **private** DB only: the `bg_processes` table is rebuilt with a nullable `project_id` and a `legacy` row with no project is inserted. Both a scoped agent (`alpha`, project A) and a project-less agent (`solo`, where `null === null` must not authorize) are denied with `unscoped`; a header-less human is allowed (its window does not exist, so the mechanism is `new-window`).
- **Steps**:
  1. Rebuild the table with a nullable `project_id`, insert the unscoped row (private DB only) and confirm it:
     ```bash
     W="$PWD/tmp/uat-0194"; sqlite3 "$W/data/conductor.db" "PRAGMA foreign_keys=OFF; BEGIN; CREATE TABLE bg_processes_n (id INTEGER PRIMARY KEY, name TEXT NOT NULL CHECK (name GLOB '[A-Za-z0-9_-]*'), workdir TEXT NOT NULL, launch_cmd TEXT NOT NULL, project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE); INSERT INTO bg_processes_n SELECT id,name,workdir,launch_cmd,project_id FROM bg_processes; DROP TABLE bg_processes; ALTER TABLE bg_processes_n RENAME TO bg_processes; CREATE UNIQUE INDEX idx_bg_processes_project_name ON bg_processes(project_id, name); INSERT INTO bg_processes(name,workdir,launch_cmd,project_id) VALUES ('legacy','$W','sleep 3600',NULL); COMMIT;" && sqlite3 "$W/data/conductor.db" "SELECT name, project_id IS NULL FROM bg_processes ORDER BY id;"
     ```
     Expect the two lines `web|0` and `legacy|1`. If the rebuild fails or prints anything else, mark this case BLOCKED (the `unscoped` branch is still covered by UAT-EDGE-002), not FAIL.
  2. Run the three commands below as-is, in order.
- **Command**:
  ```bash
  for h in uat0194a-alpha solo; do curl -sS -i -X POST -H "X-Conductor-Agent: $h" 'http://127.0.0.1:18794/api/bg-processes/legacy/restart' | sed -n '1p;$p'; echo; done
  ```
  ```bash
  curl -sS -X POST 'http://127.0.0.1:18794/api/bg-processes/legacy/restart' | jq -c '{ok, name, mechanism}'
  ```
- **Expected Result**: First command prints, for `uat0194a-alpha`, `HTTP/1.1 403 Forbidden` and `{"error":"restart denied: unscoped","reason":"unscoped","callerProjectId":1,"bgProjectId":null}`, then a blank line, then for `solo`, `HTTP/1.1 403 Forbidden` and `{"error":"restart denied: unscoped","reason":"unscoped","callerProjectId":null,"bgProjectId":null}`, then a blank line. Second command prints `{"ok":true,"name":"legacy","mechanism":"new-window"}`.
- **Repeatable Unit Test**: Created: `host-server/bgAccess.test.ts` (`authorizeRestart: scoped agent against an unscoped bg, per policy branch` and `null === null never authorizes`)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern='unscoped bg' bgAccess.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-012: the guard runs before the session check (403 before 409) while the session is absent
- **Endpoint**: `POST /api/bg-processes/uat0194a-web/restart`, four requests
- **Description**: With the tmux session gone, the cross-project agent must still get `403` (it must learn nothing about session state), while allowed callers (same-project agent, human) reach the session check and get `409 session not running`; an unknown slug is still `404`. **Run after every other live case: it destroys the private tmux server** (agent rows and the private DB survive, so caller resolution is unchanged).
- **Steps**:
  1. Kill the private session (private tmux server only, never the live `conductor` session):
     ```bash
     env -u TMUX -u TMUX_PANE TMUX_TMPDIR="$PWD/tmp/uat-0194/tmux" tmux kill-session -t uat0194
     ```
  2. Run the command below as-is.
- **Command**:
  ```bash
  U='http://127.0.0.1:18794/api/bg-processes/uat0194a-web/restart'; for h in uat0194b-beta uat0194a-alpha; do curl -sS -i -X POST -H "X-Conductor-Agent: $h" "$U" | sed -n '1p;$p'; echo; done; curl -sS -i -X POST "$U" | sed -n '1p;$p'; echo; curl -sS -i -X POST -H 'X-Conductor-Agent: uat0194b-beta' 'http://127.0.0.1:18794/api/bg-processes/uat0194a-nope/restart' | sed -n '1p;$p'
  ```
- **Expected Result**: For `uat0194b-beta`: `HTTP/1.1 403 Forbidden` and `{"error":"restart denied: project-mismatch","reason":"project-mismatch","callerProjectId":2,"bgProjectId":1}`. For `uat0194a-alpha`: `HTTP/1.1 409 Conflict` and `{"error":"session not running","sessionAlive":false}`. For the header-less human: `HTTP/1.1 409 Conflict` and `{"error":"session not running","sessionAlive":false}`. For the unknown slug: `HTTP/1.1 404 Not Found` and `{"error":"bg process 'uat0194a-nope' not found"}`.
- **Repeatable Unit Test**: Created: `host-server/bgAccess.test.ts` (`index.ts wires the guard ... precede the session check and the cooldown`; the static order only)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern='index.ts wires the guard' bgAccess.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-013: the audit log for the whole run has exactly the expected outcomes, and no 404 or extra line
- **Endpoint**: private `tmp/uat-0194/logs/bg-restarts.jsonl`
- **Description**: Seventeen lines in request order. Denials carry a `reason`; the two successes carry `mechanism`; the 429 is `cooldown` (its `cooldownRemainingS` varies and is dropped with `ts`); the two session-absent requests are `failed` with `step: session-check`; the 404 requests (UAT-API-009 and the last request of UAT-API-012) are absent. The 403 in UAT-API-007 is a `denied` line, not a `cooldown` line.
- **Steps**:
  1. Run the command below.
- **Command**:
  ```bash
  jq -c 'del(.ts, .cooldownRemainingS)' "$PWD/tmp/uat-0194/logs/bg-restarts.jsonl"
  ```
- **Expected Result**: exactly these 17 lines, in order:
  ```
  {"bg":"uat0194a-web","callerKind":"agent","caller":"uat0194b-beta","outcome":"denied","reason":"project-mismatch"}
  {"bg":"uat0194a-web","callerKind":"agent","caller":"nobody","outcome":"denied","reason":"unknown-caller"}
  {"bg":"uat0194a-web","callerKind":"agent","caller":"alpha","outcome":"denied","reason":"unknown-caller"}
  {"bg":"uat0194a-web","callerKind":"agent","caller":"UAT0194A-ALPHA","outcome":"denied","reason":"unknown-caller"}
  {"bg":"uat0194a-web","callerKind":"agent","caller":"uat0194a-alph","outcome":"denied","reason":"unknown-caller"}
  {"bg":"uat0194a-web","callerKind":"agent","caller":"solo","outcome":"denied","reason":"project-mismatch"}
  {"bg":"uat0194a-web","callerKind":"agent","caller":"uat0194a-alpha","outcome":"restarted","mechanism":"respawn-window"}
  {"bg":"uat0194a-web","callerKind":"agent","caller":"uat0194b-beta","outcome":"denied","reason":"project-mismatch"}
  {"bg":"uat0194a-web","callerKind":"agent","caller":"uat0194a-alpha","outcome":"cooldown"}
  {"bg":"uat0194a-web","callerKind":"dashboard","caller":null,"outcome":"restarted","mechanism":"respawn-window"}
  {"bg":"uat0194a-web","callerKind":"agent","caller":"uat0194x-y-z","outcome":"denied","reason":"ambiguous-caller"}
  {"bg":"legacy","callerKind":"agent","caller":"uat0194a-alpha","outcome":"denied","reason":"unscoped"}
  {"bg":"legacy","callerKind":"agent","caller":"solo","outcome":"denied","reason":"unscoped"}
  {"bg":"legacy","callerKind":"dashboard","caller":null,"outcome":"restarted","mechanism":"new-window"}
  {"bg":"uat0194a-web","callerKind":"agent","caller":"uat0194b-beta","outcome":"denied","reason":"project-mismatch"}
  {"bg":"uat0194a-web","callerKind":"agent","caller":"uat0194a-alpha","outcome":"failed","step":"session-check"}
  {"bg":"uat0194a-web","callerKind":"dashboard","caller":null,"outcome":"failed","step":"session-check"}
  ```
  If UAT-API-010 or UAT-API-011 was marked BLOCKED, the lines belonging to it are legitimately absent; every other line must match.
- **Repeatable Unit Test**: Not applicable: asserts the live audit file written by the real route
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-014: cleanup the private stack
- **Description**: Removes every artifact of the live cases: the private host-server, the private tmux server and `tmp/uat-0194/` (which holds the private DB, conf and audit log). Run last, and run it even if earlier cases failed or were blocked. The real `conductor` tmux session, `./data/conductor.db` and `./logs/bg-restarts.jsonl` are never involved.
- **Steps**:
  1. Run the command below.
  2. Confirm the live `conductor` session is untouched and the fixture directory is gone.
- **Command**:
  ```bash
  (lsof -ti tcp:18794 -sTCP:LISTEN | xargs kill; sleep 2; env -u TMUX -u TMUX_PANE TMUX_TMPDIR="$PWD/tmp/uat-0194/tmux" tmux kill-server; rm -rf tmp/uat-0194; curl -sS -m 2 -o /dev/null -w 'server=%{http_code}\n' 'http://127.0.0.1:18794/api/agents'; test -e tmp/uat-0194 && echo 'dir=present' || echo 'dir=gone'; tmux list-sessions -F '#S')
  ```
- **Expected Result**: `curl` reports `server=000` (connection refused; a `curl: (7)` message on stderr is expected), `dir=gone`, and the final `tmux list-sessions` (the real server) still lists `conductor`. A `no server running on .../tmp/uat-0194/tmux/...` message from `kill-server` is expected when UAT-API-012 already killed the private server.
- **Repeatable Unit Test**: Not applicable: lifecycle cleanup of live processes and scratch files
- [x] Pass <!-- 2026-09-20 -->

---

## Notes for the judge

- **Auto-judgeable without the live stack**: UAT-UNIT-001, UAT-EDGE-001 .. 005 (unit-backed or a deterministic node one-liner), UAT-INT-001 (scoped typecheck) and UAT-DOC-001 (a node one-liner). The live cases (UAT-API-001 .. 014, UAT-LIVE-001 .. 002) are machine-executable end to end on the private stack. They must run in the order written: they share one throwaway bg process, one cooldown window (120 s from UAT-API-006, so UAT-API-007 and UAT-API-008 must run within it) and, in UAT-API-012, a private tmux server that is killed on purpose.
- **Gate**: UAT-API-001 is a discriminating gate. Against a server without the guard the same request returns `200` and restarts the process. If it does not return the exact 403 body, every later live case is BLOCKED.
- **Known flake in fixture setup**: `POST /api/projects/:id/agents` and `POST /api/agents` may answer `500` right after a fresh server start even though the agent row exists (the guard resolves against DB rows, not tmux windows, so this does not affect any case). The fixture listing in the Prerequisites is the check.
- **Two fixtures are seeded straight into the private SQLite DB** (UAT-API-010 colliding window names, UAT-API-011 an unscoped bg row) because the current API refuses to create either. That is the point of the guard's fail-closed branches, so they cannot be reached over HTTP on a current DB. Both are marked BLOCKED, not FAIL, if the seeding cannot be done; their logic stays covered by UAT-EDGE-001 and UAT-EDGE-002.
- **Not covered here**: `GET /agents/whoami` (TASK-0202); the window open/close, PATCH and DELETE routes and the read routes remain unguarded by design (the task's follow-up suggestion). Header spoofing and omitting the header are accepted, documented caveats, not defects (UAT-EDGE-005 pins the header-less-is-human behaviour).
- **Dry run**: every live command above was executed once against a private stack during generation with the exact expected outputs listed here, and the stack was torn down (no `tmp/uat-0194` residue, live `conductor` session untouched).
