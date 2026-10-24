---
id: UAT-0193
aliases: [UAT-0193]
title: "UAT: Add a restart cooldown and an audit log recording which agent triggered each restart"
status: passed
task: TASK-0193
created: 2026-09-20
updated: 2026-10-17
---

# UAT-0193 — UAT: Add a restart cooldown and an audit log recording which agent triggered each restart

implements::[[TASK-0193]]

> **Source task**: [[TASK-0193]]
> **Generated**: 2026-09-20
>
> **What changed**: new `host-server/bgRestartPolicy.ts` (`parseCallerHeader`, `callerKindFor`, `evaluateCooldown`, `buildAuditRecord`, `appendAuditRecord`, `RestartHistory`, `getRestartHistory`). `POST /api/bg-processes/:slug/restart` in `host-server/index.ts` now reads the `X-Conductor-Agent` header, evaluates a per-bg cooldown before calling `restartBgProcess`, answers `429` with `Retry-After` when an identified agent restarts too soon after ANY successful restart, and appends one JSONL record per attempt to `$LOG_DIR/bg-restarts.jsonl` (`outcome` = `restarted` | `cooldown` | `failed`). A `409 session not running` is audited as `failed` / `session-check`; a `404` is not audited. `BG_RESTART_COOLDOWN_S` (default 30) is a new tuning key in `conductor.conf`, parsed by `host-server/config.ts` as `bgRestartCooldownMs`. `BgStatus` gains `lastRestart: { at, caller } | null` (visible on `GET /api/status` under `bgProcesses[]`), mirrored type-only as `BgLastRestart` in `frontend/src/lib/api.ts` and an optional `lastRestart` on `BgProcess` in `frontend/src/components/AgentList.tsx`.
>
> **Out of scope**: the `denied` outcome and the same-project guard (TASK-0194, implemented concurrently; the live cases below use callers that are legitimate members of the bg process's project, so they pass with or without that guard), the `dev-commands` script that sends the header (Phase 3), the dashboard rendering of `lastRestart` (Phase 4), and `bg-update` SSE broadcast of `lastRestart` changes (TASK-0207). This UAT carries the live smoke recipe that TASK-0193 Step 5 marked `[DEFERRED-TO-UAT]`, run on a private stack instead of `:8788`.

---

## Prerequisites

**Isolation rules (read first).** Every live case (UAT-API-*, UAT-LIVE-*) runs against a **private stack**: its own tmux server (`TMUX_TMPDIR=tmp/uat-0193/tmux`, session `uat0193`), its own conf, SQLite DB and `LOG_DIR` (`tmp/uat-0193/`), and its own host-server on port **18791**. Never send a request to `:8788`, never touch the live `conductor` tmux session, never restart the real `dev` / `dev-stack` bg processes, and never read or write the real `logs/bg-restarts.jsonl` (the private log is `tmp/uat-0193/logs/bg-restarts.jsonl`). Every tmux command is prefixed with `env -u TMUX -u TMUX_PANE TMUX_TMPDIR="$PWD/tmp/uat-0193/tmux"` so it reaches the private server even from inside tmux. No `.env` file is read or written; all scratch files live in `./tmp/uat-0193/`.

**Timing design.** The private conf sets `BG_RESTART_COOLDOWN_S=15`. Cases that depend on the cooldown window are written as ONE shell block that begins with `sleep 16` (so the cooldown from any earlier case has expired) and performs its restarts back to back, so latency between judge steps can never expire or pre-arm the cooldown. Run the live cases in the order written; they share one throwaway bg process and one audit file. The whole live run takes about 2.5 minutes, most of it those waits.

- [ ] Run everything from the repo root `/Users/davidtaylor/Repositories/tmux-conductor`. Tools needed: `tmux` (>= 3.0), `node`, `curl`, `jq`, `lsof`. Port 18791 is free (`lsof -ti tcp:18791 -sTCP:LISTEN` prints nothing).
- [ ] Only for the live cases: create the scratch dir and private conf (note the short cooldown and fast status poll):
  ```bash
  rm -rf tmp/uat-0193 && mkdir -p tmp/uat-0193/tmux tmp/uat-0193/data tmp/uat-0193/logs/state && printf '%s\n' 'SESSION_NAME="uat0193"' 'DB_PATH="./data/conductor.db"' 'LOG_DIR="./logs"' 'STATE_DIR="./logs/state"' 'POLL_INTERVAL=15' 'STATUS_POLL_MS=500' 'BG_RESTART_COOLDOWN_S=15' > tmp/uat-0193/conductor.conf
  ```
- [ ] Start the private tmux server with a keeper window (the session must exist so the restart route does not answer 409):
  ```bash
  env -u TMUX -u TMUX_PANE TMUX_TMPDIR="$PWD/tmp/uat-0193/tmux" tmux new-session -d -s uat0193 -n keeper 'sleep 3600'
  ```
- [ ] Start the private host-server from the working tree (background; it must stay up until UAT-API-008). It binds 127.0.0.1:18791 and reads `CONDUCTOR_CONF`, so it never touches `./data/conductor.db` or `./logs`:
  ```bash
  R="$PWD"; cd host-server && env -u TMUX -u TMUX_PANE TMUX_TMPDIR="$R/tmp/uat-0193/tmux" CONDUCTOR_CONF="$R/tmp/uat-0193/conductor.conf" BACKEND_PORT=18791 PORT=18791 nohup node --import tsx/esm index.ts > "$R/tmp/uat-0193/server.log" 2>&1 &
  ```
- [ ] Wait for it to answer and for its monitor auto-heal to settle (an empty agent list proves it is the private, empty DB; the `monitor` window appearing means the server's startup tmux work is done, which avoids a transient race when registering fixtures):
  ```bash
  sleep 8 && curl -sS 'http://127.0.0.1:18791/api/agents'
  ```
  ```bash
  env -u TMUX -u TMUX_PANE TMUX_TMPDIR="$PWD/tmp/uat-0193/tmux" tmux list-windows -t uat0193 -F '#W'
  ```
  Expected: `[]`, then `keeper` and `monitor`. If the first does not print `[]`, stop and mark every live case BLOCKED.

Unit, typecheck and doc cases (UAT-UNIT-*, UAT-EDGE-*, UAT-INT-*, UAT-DOC-*) need none of the live stack.

---

## Test Cases

### UAT-UNIT-001: whole `bgRestartPolicy.test.ts` suite passes (36 tests)
- **Description**: The policy module suite covers every documented rule against injected clocks and fake filesystems (no live tmux, no server): header parsing, cooldown decisions, history seeding, audit records, the append helper, and the source-text pins of the route wiring.
- **Steps**:
  1. Run the command below from the repo root.
- **Command**:
  ```bash
  cd host-server && node --import tsx/esm --test bgRestartPolicy.test.ts
  ```
- **Expected Result**: `tests 36`, `pass 36`, `fail 0`, `cancelled 0`, `skipped 0`; exit code 0. (A later task may add tests; the requirement is `fail 0` with `pass` equal to `tests` and `tests` at least 36.)
- **Repeatable Unit Test**: Created: `host-server/bgRestartPolicy.test.ts`
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test bgRestartPolicy.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-EDGE-001: caller header parsing (empty, whitespace, repeated, control characters, oversized)
- **Scenario**: `X-Conductor-Agent` is trimmed, stripped of control characters (CR/LF/NUL/DEL and C1), capped at 128 characters and re-trimmed after truncation; an array (repeated header) uses its first element; absent, empty, whitespace-only, non-string, or nothing-left-after-stripping values yield `null` (a dashboard caller). `callerKindFor(null)` is `dashboard`, any identity is `agent`.
- **Steps**:
  1. Run the command below (the `parseCallerHeader` and `callerKindFor` tests).
- **Command**:
  ```bash
  cd host-server && node --import tsx/esm --test --test-name-pattern='parseCallerHeader|callerKindFor' bgRestartPolicy.test.ts
  ```
- **Expected Result**: `tests 7`, `pass 7`, `fail 0`. Includes `parseCallerHeader: caps oversized values at BG_CALLER_MAX_LENGTH` and `parseCallerHeader: strips control characters (incl. CR/LF/NUL/DEL) and yields null if nothing remains`.
- **Repeatable Unit Test**: Created: `host-server/bgRestartPolicy.test.ts`
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern='parseCallerHeader|callerKindFor' bgRestartPolicy.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-EDGE-002: cooldown decision rules
- **Scenario**: An agent inside the cooldown is rejected with `retryAfterS` = remaining whole seconds rounded up (minimum 1); an agent at or after the cooldown is allowed (boundary: exactly `cooldownMs` allowed, 1 ms before rejected); a dashboard caller is always exempt; never-restarted is allowed; `cooldownMs <= 0` disables the cooldown; a restart by any caller arms it for every other agent; a failed restart does not arm it (only `restarted` lines seed the history).
- **Steps**:
  1. Run the command below.
- **Command**:
  ```bash
  cd host-server && node --import tsx/esm --test --test-name-pattern='evaluateCooldown|cooldown applies across|failed restart does not arm' bgRestartPolicy.test.ts
  ```
- **Expected Result**: `tests 9`, `pass 9`, `fail 0`. Includes `evaluateCooldown: agent inside the cooldown is rejected with correct retryAfterS`, `evaluateCooldown: dashboard caller is exempt inside the cooldown`, `cooldown applies across different agent callers ...`, and `failed restart does not arm the cooldown ...`.
- **Repeatable Unit Test**: Created: `host-server/bgRestartPolicy.test.ts`
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern='evaluateCooldown|cooldown applies across|failed restart does not arm' bgRestartPolicy.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-EDGE-003: restart history is seeded lazily from the audit log tail and survives a "module restart"
- **Scenario**: `RestartHistory` reads the JSONL tail once, on first access (not at construction), keeps the latest `restarted` timestamp per bg even for out-of-order lines, ignores `cooldown` / `failed` / `denied` lines, skips malformed lines without aborting, records a non-string caller as `null`, seeds nothing from a missing/unreadable log, drops the partial first line of a truncated large file, and a fresh instance over the same fixture file reproduces the cooldown state (the "host-server restart does not reset the cooldown" requirement). `getRestartHistory(logDir)` returns one shared instance per `logDir`.
- **Steps**:
  1. Run the command below.
- **Command**:
  ```bash
  cd host-server && node --import tsx/esm --test --test-name-pattern='seeding|reseeded|malformed|non-string caller|missing log|lazy seeding|recordSuccess|readLogTail|getRestartHistory' bgRestartPolicy.test.ts
  ```
- **Expected Result**: `tests 10`, `pass 10`, `fail 0`. Includes `history reseeded from a fixture after a simulated module restart: cooldown survives` and `malformed JSONL lines are skipped without aborting seeding`.
- **Repeatable Unit Test**: Created: `host-server/bgRestartPolicy.test.ts`
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern='seeding|reseeded|malformed|non-string caller|missing log|lazy seeding|recordSuccess|readLogTail|getRestartHistory' bgRestartPolicy.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-EDGE-004: audit record shape and the append helper
- **Scenario**: `buildAuditRecord` emits `ts` (ISO), `bg`, `callerKind`, `caller` (null preserved) and `outcome`, includes the optional `cooldownRemainingS` / `mechanism` / `step` / `status` only when supplied (a value of `0` counts as supplied) and omits undefined keys; the record round-trips through `JSON.stringify` / `JSON.parse`. `appendAuditRecord` creates `LOG_DIR`, appends exactly one newline-terminated JSON line to `<logDir>/bg-restarts.jsonl`, and swallows `mkdir` / `appendFile` failures (returns `false`, never throws, so audit logging can never break the control plane).
- **Steps**:
  1. Run the command below.
- **Command**:
  ```bash
  cd host-server && node --import tsx/esm --test --test-name-pattern='buildAuditRecord|appendAuditRecord' bgRestartPolicy.test.ts
  ```
- **Expected Result**: `tests 8`, `pass 8`, `fail 0`.
- **Repeatable Unit Test**: Created: `host-server/bgRestartPolicy.test.ts`
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern='buildAuditRecord|appendAuditRecord' bgRestartPolicy.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-EDGE-005: `BG_RESTART_COOLDOWN_S` config parsing (default 30s, explicit value, non-positive fallback)
- **Scenario**: `conductor.conf` seconds become `bgRestartCooldownMs` (milliseconds) on `ConductorConf`: absent => 30000, `90` => 90000, `0` (non-positive) => falls back to 30000.
- **Steps**:
  1. Run the command below.
- **Command**:
  ```bash
  cd host-server && node --import tsx/esm --test --test-name-pattern='BG_RESTART_COOLDOWN_S' config.test.ts
  ```
- **Expected Result**: `tests 3`, `pass 3`, `fail 0`.
- **Repeatable Unit Test**: Created: `host-server/config.test.ts`
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern='BG_RESTART_COOLDOWN_S' config.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-INT-001: host-server typechecks with the new module, config field and route wiring
- **Description**: `bgRestartPolicy.ts`, the `bgRestartCooldownMs` config field and the `lastRestart` field on `BgStatus` / the restart route typecheck under the repo's strict config.
- **Steps**:
  1. Run the command below.
- **Command**:
  ```bash
  cd host-server && npx tsc --noEmit
  ```
- **Expected Result**: no output; exit code 0.
- **Repeatable Unit Test**: Not applicable: type-level check, covered by the host-server typecheck gate rather than a runtime assertion
- [x] Pass <!-- 2026-09-20 -->

### UAT-INT-002: the route is wired to the policy module in the documented order
- **Description**: `host-server/index.ts` imports `./bgRestartPolicy.ts`, reads the header through `parseCallerHeader`, evaluates `evaluateCooldown` before calling `restartBgProcess`, sets `Retry-After`, answers `429` `restart cooldown`, audits through `appendAuditRecord`, records successes on the shared `getRestartHistory`, and `buildBgStatuses` populates `lastRestart` from the same history. `index.ts` has top-level side effects and cannot be imported by a unit test, so the wiring is pinned by the source-text tests; the live cases UAT-API-004 .. 008 prove the behaviour.
- **Steps**:
  1. Run the command below.
- **Command**:
  ```bash
  cd host-server && node --import tsx/esm --test --test-name-pattern='index.ts wires|TASK-0194 marker' bgRestartPolicy.test.ts
  ```
- **Expected Result**: `tests 2`, `pass 2`, `fail 0`.
- **Repeatable Unit Test**: Created: `host-server/bgRestartPolicy.test.ts`
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern='index.ts wires|TASK-0194 marker' bgRestartPolicy.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-DOC-001: the audit log, header convention and guardrail caveat are documented in all three places
- **Description**: The task requires the `bg-restarts.jsonl` fields, the `X-Conductor-Agent` convention and the "guardrail, not authentication" caveat in `CLAUDE.md`, `scripts/README.md` and `wiki/knowledge/concepts/background-process-registry.md`.
- **Steps**:
  1. Search each file with `mcp__serena__search_for_pattern` (or `Read`) for the patterns below and read the matched text:
     - `CLAUDE.md`: `bg-restarts\.jsonl` (the observability table row, near line 55).
     - `scripts/README.md`: `BG_RESTART_COOLDOWN_S` (tuning-keys table row) and `Bg restart audit log and caller header` (the block after it).
     - `wiki/knowledge/concepts/background-process-registry.md`: `### Restart cooldown and audit \(TASK-0193\)`.
- **Expected Result**: Each of the three files documents all of: the record fields `ts`, `bg`, `callerKind` (`agent` | `dashboard`), `caller`, `outcome` (`restarted` | `cooldown` | `failed`, with `denied` noted as the TASK-0194 outcome), `cooldownRemainingS`, `mechanism`, `step`; the `X-Conductor-Agent` header (trimmed, capped at 128 chars, absent = dashboard, exempt from the cooldown); and the statement that this is a runaway-loop guardrail and not authentication (an agent that omits the header bypasses the cooldown). `CLAUDE.md` and `scripts/README.md` state that the log is not rotated; the registry page states it as a known limit.
- **Repeatable Unit Test**: Not applicable: documentation check
- [x] Pass <!-- 2026-10-17 --> Verified by search/read: CLAUDE.md:55, scripts/README.md:192-210 and background-process-registry.md:65-72 each document the record fields (`ts`, `bg`, `callerKind`, `caller`, `outcome` incl. `denied`, `cooldownRemainingS`, `mechanism`, `step`), the `X-Conductor-Agent` header (trimmed, 128-char cap, absent = dashboard, cooldown-exempt), the guardrail-not-authentication caveat, and no log rotation.

### UAT-DOC-002: `conductor.conf` default and the frontend types are in place
- **Description**: `conductor.conf` sets `BG_RESTART_COOLDOWN_S=30` with an explanatory comment; the frontend carries the type-only `BgLastRestart` and the optional `lastRestart` on `BgProcess`. (The frontend `tsc` is deliberately not part of this case: it currently fails on an unrelated untracked file from another session, `frontend/src/lib/lastPayload.ts`.)
- **Steps**:
  1. Run the command below (sources the repo conf exactly as `host-server/config.ts` does).
  2. Search `frontend/src/lib/api.ts` for `export interface BgLastRestart` and read the block; search `frontend/src/components/AgentList.tsx` for `lastRestart\?: BgLastRestart`.
- **Command**:
  ```bash
  bash -c 'source conductor.conf && echo "$BG_RESTART_COOLDOWN_S"'
  ```
- **Expected Result**: the command prints `30`. `api.ts` declares `export interface BgLastRestart { at: string; caller: string | null }` (with a doc comment naming TASK-0193), and `AgentList.tsx` declares `lastRestart?: BgLastRestart | null` on the `BgProcess` interface and imports `type BgLastRestart` from `../lib/api`.
- **Repeatable Unit Test**: Not applicable: configuration and type-declaration presence check
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-001: GATE — the private host-server has the restart route; an unknown slug is a 404 that is NOT audited
- **Endpoint**: `POST /api/bg-processes/:slug/restart` (port 18791, private stack)
- **Description**: A server without the route answers Fastify's generic `{"message":"Route POST:... not found","error":"Not Found","statusCode":404}`. The route answers a slug it cannot resolve with `{"error":"bg process '<slug>' not found"}` and, per the task, writes no audit record for it (the audit log does not even exist yet on this fresh stack). **If the body does not match exactly, stop: mark every remaining live case (UAT-API-002 onward, UAT-LIVE-*) BLOCKED.** Do not fall back to `:8788`.
- **Steps**:
  1. Confirm the Prerequisites completed (private tmux, private server answering `[]`, `monitor` window present).
  2. Run the two commands below as-is.
- **Command**:
  ```bash
  curl -sS -i -X POST 'http://127.0.0.1:18791/api/bg-processes/uat0193proj-nope/restart'
  ```
  ```bash
  test -e tmp/uat-0193/logs/bg-restarts.jsonl && echo present || echo absent
  ```
- **Expected Result**: `HTTP/1.1 404 Not Found` with body exactly `{"error":"bg process 'uat0193proj-nope' not found"}` (no `"message"` / `"statusCode"` keys); the second command prints `absent`.
- **Repeatable Unit Test**: Not applicable: asserts the live Fastify route; `host-server/index.ts` has no route-level test harness (it calls `listen()` at import time)
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-002: register a throwaway project, two agents in it, and one bg process
- **Endpoint**: `POST /api/projects`, `POST /api/projects/1/agents` (twice), `POST /api/bg-processes` (private stack)
- **Description**: The smoke fixture from TASK-0193 Step 5. Two agents (`alice`, `bob`) in the same project as the bg process give the cooldown cases two distinct, legitimate `X-Conductor-Agent` identities (their tmux window names `uat0193proj-alice` / `uat0193proj-bob`); this also keeps the cases valid when the TASK-0194 same-project guard is present. The bg process slug is `<projectName>-<name>` = `uat0193proj-smoke`. The restart route only consults the database rows for identity, so an agent whose window failed to spawn (a transient tmux race seen once while writing this UAT) is still a valid caller; re-run the agent registration only if the row is missing from the final check.
- **Steps**:
  1. Create the project (a fresh DB assigns id `1`):
     ```bash
     curl -sS -X POST 'http://127.0.0.1:18791/api/projects' -H 'Content-Type: application/json' -d '{"name":"uat0193proj","workdir":"/Users/davidtaylor/Repositories/tmux-conductor/tmp/uat-0193"}' | jq -c '{id,name}'
     ```
     Expect `{"id":1,"name":"uat0193proj"}`.
  2. Create the two agents, one at a time:
     ```bash
     curl -sS -X POST 'http://127.0.0.1:18791/api/projects/1/agents' -H 'Content-Type: application/json' -d '{"name":"alice","launchCmd":"sleep 3600"}' | jq -c '{id,name,projectId}'
     ```
     ```bash
     curl -sS -X POST 'http://127.0.0.1:18791/api/projects/1/agents' -H 'Content-Type: application/json' -d '{"name":"bob","launchCmd":"sleep 3600"}' | jq -c '{id,name,projectId}'
     ```
     Expect `{"id":1,"name":"alice","projectId":1}` and `{"id":2,"name":"bob","projectId":1}`.
  3. Run the curl command below as-is, then the verification command.
- **Command**:
  ```bash
  curl -sS -X POST 'http://127.0.0.1:18791/api/bg-processes' -H 'Content-Type: application/json' -d '{"name":"smoke","projectId":1,"workdir":"/Users/davidtaylor/Repositories/tmux-conductor/tmp/uat-0193","launchCmd":"i=0; while true; do i=$((i+1)); echo \"tick $i\"; sleep 1; done"}' | jq -c '{ok, slug: .bg.slug, projectId: .bg.projectId}'
  ```
  ```bash
  curl -sS 'http://127.0.0.1:18791/api/agents' | jq -c 'map(.name) | sort'
  ```
- **Expected Result**: the bg registration prints `{"ok":true,"slug":"uat0193proj-smoke","projectId":1}`; the verification prints `["alice","bob"]`.
- **Repeatable Unit Test**: Not applicable: live HTTP + SQLite + tmux wiring for fixtures
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-003: GATE — the bg status payload carries the `lastRestart` field (null before any restart)
- **Endpoint**: `GET /api/status` (`bgProcesses[]`)
- **Description**: A server built before TASK-0193 omits the `lastRestart` key from every bg entry entirely. This gate proves the private server has the feature before the behavioural cases run. Before any restart the value is `null`. **If `hasKey` is `false`, mark every remaining live case BLOCKED (the server lacks the TASK-0193 behaviour); do not judge them as failures.**
- **Steps**:
  1. Run the command below as-is (the sleep lets the 500 ms status poll pick up the new bg process).
- **Command**:
  ```bash
  sleep 3 && curl -sS 'http://127.0.0.1:18791/api/status' | jq -c '.bgProcesses[] | select(.slug=="uat0193proj-smoke") | {hasKey: has("lastRestart"), lastRestart}'
  ```
- **Expected Result**: `{"hasKey":true,"lastRestart":null}`.
- **Repeatable Unit Test**: Not applicable: live status payload (`getRestartHistory(...).lastRestart` is unit-covered by UAT-EDGE-003)
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-004: an identified agent's first restart succeeds and is audited as `restarted` with the caller and mechanism
- **Endpoint**: `POST /api/bg-processes/uat0193proj-smoke/restart` with `X-Conductor-Agent: uat0193proj-alice`
- **Description**: No successful restart exists yet, so the cooldown does not apply. The response is the unchanged TASK-0190 envelope; the audit log now exists and holds exactly one JSON line for this attempt with `callerKind: agent`, `caller` = the raw header value, `outcome: restarted`, `mechanism: respawn-window` (the window is present) and no `cooldownRemainingS`.
- **Steps**:
  1. Run the curl command below as-is.
  2. Run the audit command.
- **Command**:
  ```bash
  curl -sS -X POST 'http://127.0.0.1:18791/api/bg-processes/uat0193proj-smoke/restart' -H 'X-Conductor-Agent: uat0193proj-alice' | jq -c '{ok, name, mechanism}'
  ```
  ```bash
  tail -n 1 tmp/uat-0193/logs/bg-restarts.jsonl | jq -c '{bg, callerKind, caller, outcome, mechanism, hasTs: (.ts | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$")), cooldownRemainingS}'
  ```
- **Expected Result**: HTTP 200 body reduced by jq to `{"ok":true,"name":"uat0193proj-smoke","mechanism":"respawn-window"}`; the audit line is `{"bg":"uat0193proj-smoke","callerKind":"agent","caller":"uat0193proj-alice","outcome":"restarted","mechanism":"respawn-window","hasTs":true,"cooldownRemainingS":null}`.
- **Repeatable Unit Test**: Created: `host-server/bgRestartPolicy.test.ts` (`buildAuditRecord` / `appendAuditRecord` tests cover the record shape and append; the live route response and file location need the running server)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern='buildAuditRecord|appendAuditRecord' bgRestartPolicy.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-LIVE-001: the status payload exposes the last successful restart (time and caller)
- **Description**: After UAT-API-004 the bg status entry's `lastRestart` is `{ at, caller }` with `at` an ISO-8601 UTC timestamp and `caller` the agent that restarted it (Phase 4's "last restart time and triggering agent"). The status snapshot refreshes on the 500 ms poll, so allow a few seconds.
- **Steps**:
  1. Run the command below as-is.
- **Command**:
  ```bash
  sleep 3 && curl -sS 'http://127.0.0.1:18791/api/status' | jq -c '.bgProcesses[] | select(.slug=="uat0193proj-smoke") | {caller: .lastRestart.caller, atIso: (.lastRestart.at | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$"))}'
  ```
- **Expected Result**: `{"caller":"uat0193proj-alice","atIso":true}`.
- **Repeatable Unit Test**: Created: `host-server/bgRestartPolicy.test.ts` (`recordSuccess after seeding overrides the seeded value, and lastRestart returns an ISO string`; the live `/api/status` wiring needs the running server)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern='recordSuccess' bgRestartPolicy.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-005: a DIFFERENT agent inside the cooldown gets 429 with `Retry-After`, the documented body, and a `cooldown` audit line
- **Endpoint**: `POST /api/bg-processes/uat0193proj-smoke/restart`
- **Description**: The cooldown is armed by a successful restart by ANY caller and applies to every identified agent. The block waits 16 s (the 15 s cooldown from UAT-API-004 has expired), restarts as `alice` (200), then immediately restarts as `bob`, which must be refused. The 429 carries a `Retry-After` header (whole seconds, 1..15) and body `{ error, retryAfterS, lastRestartAt, lastRestartBy }` where `lastRestartBy` is `alice`. The refused attempt is audited as `cooldown` with `cooldownRemainingS` and no `mechanism`, and does not itself arm or extend the cooldown.
- **Steps**:
  1. Run the restart block below as-is (one shell command).
  2. Run the audit command.
- **Command**:
  ```bash
  U='http://127.0.0.1:18791/api/bg-processes/uat0193proj-smoke/restart'; sleep 16; curl -sS -X POST "$U" -H 'X-Conductor-Agent: uat0193proj-alice' | jq -c '{first: .ok}'; curl -sS -i -X POST "$U" -H 'X-Conductor-Agent: uat0193proj-bob' | tr -d '\r' | grep -iE '^(HTTP/|retry-after:|\{)'
  ```
  ```bash
  tail -n 2 tmp/uat-0193/logs/bg-restarts.jsonl | jq -c '{caller, outcome, callerKind, mechanism, cooldownRemainingS}'
  ```
- **Expected Result**: First block prints `{"first":true}`, then `HTTP/1.1 429 Too Many Requests`, then `retry-after: N` with `N` an integer from 1 to 15, then the body `{"error":"restart cooldown","retryAfterS":N,"lastRestartAt":"<ISO-8601 UTC>","lastRestartBy":"uat0193proj-alice"}` (same `N` as the header). Audit command prints `{"caller":"uat0193proj-alice","outcome":"restarted","callerKind":"agent","mechanism":"respawn-window","cooldownRemainingS":null}` then `{"caller":"uat0193proj-bob","outcome":"cooldown","callerKind":"agent","mechanism":null,"cooldownRemainingS":N}` with `N` in 1..15. A 200 for `bob` is a FAIL.
- **Repeatable Unit Test**: Created: `host-server/bgRestartPolicy.test.ts` (`evaluateCooldown` and `cooldown applies across different agent callers` tests cover the pure rule and cross-caller arming; the live 429 / header / audit wiring needs the running server)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern='evaluateCooldown|cooldown applies across' bgRestartPolicy.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-006: a dashboard (header-less) caller is exempt inside the cooldown, still arms it, and is audited with `caller: null`
- **Endpoint**: `POST /api/bg-processes/uat0193proj-smoke/restart`
- **Description**: A human double-click is not a loop, so a request without `X-Conductor-Agent` bypasses the cooldown, but its successful restart arms the cooldown for agents (it is a successful restart by "anyone"), and `lastRestartBy` is then `null`. The block waits 16 s, restarts as `alice` (200), restarts with no header inside the cooldown (must be 200), then restarts as `bob` (must be 429).
- **Steps**:
  1. Run the block below as-is (one shell command).
  2. Run the audit command.
- **Command**:
  ```bash
  U='http://127.0.0.1:18791/api/bg-processes/uat0193proj-smoke/restart'; sleep 16; curl -sS -X POST "$U" -H 'X-Conductor-Agent: uat0193proj-alice' | jq -c '{step:"agent", ok, error}'; curl -sS -X POST "$U" | jq -c '{step:"dashboard", ok, error}'; curl -sS -X POST "$U" -H 'X-Conductor-Agent: uat0193proj-bob' | jq -c '{step:"agent-after-dashboard", ok, error, lastRestartBy}'
  ```
  ```bash
  tail -n 3 tmp/uat-0193/logs/bg-restarts.jsonl | jq -c '{callerKind, caller, outcome}'
  ```
- **Expected Result**: The block prints `{"step":"agent","ok":true,"error":null}`, `{"step":"dashboard","ok":true,"error":null}` and `{"step":"agent-after-dashboard","ok":null,"error":"restart cooldown","lastRestartBy":null}`. The audit command prints `{"callerKind":"agent","caller":"uat0193proj-alice","outcome":"restarted"}`, `{"callerKind":"dashboard","caller":null,"outcome":"restarted"}`, `{"callerKind":"agent","caller":"uat0193proj-bob","outcome":"cooldown"}`. A 429 for the header-less call, or a 200 for the third call, is a FAIL.
- **Repeatable Unit Test**: Created: `host-server/bgRestartPolicy.test.ts` (`evaluateCooldown: dashboard caller is exempt inside the cooldown`; the live end-to-end sequence needs the running server)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern='dashboard caller is exempt' bgRestartPolicy.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-007: an agent is allowed again once the cooldown has elapsed
- **Endpoint**: `POST /api/bg-processes/uat0193proj-smoke/restart`
- **Description**: The 429 is temporary. After the 15 s cooldown from UAT-API-006 the same agent that was refused restarts successfully.
- **Steps**:
  1. Run the command below as-is (waits 16 s first).
- **Command**:
  ```bash
  sleep 16; curl -sS -X POST 'http://127.0.0.1:18791/api/bg-processes/uat0193proj-smoke/restart' -H 'X-Conductor-Agent: uat0193proj-bob' | jq -c '{ok, mechanism}'
  ```
- **Expected Result**: `{"ok":true,"mechanism":"respawn-window"}`.
- **Repeatable Unit Test**: Created: `host-server/bgRestartPolicy.test.ts` (`evaluateCooldown: agent after the cooldown is allowed`, plus the boundary test; the live wall-clock expiry needs the running server)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern='agent after the cooldown is allowed|boundary' bgRestartPolicy.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-008: an EMPTY `X-Conductor-Agent` header is a dashboard caller (cooldown-exempt, `caller: null`)
- **Endpoint**: `POST /api/bg-processes/uat0193proj-smoke/restart`
- **Description**: The task says an absent OR empty header means a dashboard caller. `curl -H 'X-Conductor-Agent;'` sends the header with an empty value. The block waits 16 s, restarts as `alice` (arming the cooldown), then restarts with the empty header inside it: if the empty header were treated as an agent this would be a 429.
- **Steps**:
  1. Run the block below as-is (one shell command).
  2. Run the audit command.
- **Command**:
  ```bash
  U='http://127.0.0.1:18791/api/bg-processes/uat0193proj-smoke/restart'; sleep 16; curl -sS -X POST "$U" -H 'X-Conductor-Agent: uat0193proj-alice' | jq -c '{step:"agent", ok}'; curl -sS -X POST "$U" -H 'X-Conductor-Agent;' | jq -c '{step:"empty-header", ok, error}'
  ```
  ```bash
  tail -n 1 tmp/uat-0193/logs/bg-restarts.jsonl | jq -c '{callerKind, caller, outcome}'
  ```
- **Expected Result**: The block prints `{"step":"agent","ok":true}` and `{"step":"empty-header","ok":true,"error":null}`. The audit command prints `{"callerKind":"dashboard","caller":null,"outcome":"restarted"}`.
- **Repeatable Unit Test**: Created: `host-server/bgRestartPolicy.test.ts` (`parseCallerHeader: undefined, empty, whitespace-only and non-string values yield null`; the live header round-trip needs the running server)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern='undefined, empty, whitespace-only' bgRestartPolicy.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-LIVE-002: the cooldown survives a host-server restart (history re-seeded from `bg-restarts.jsonl`)
- **Description**: The last-restart state is seeded lazily from the tail of the audit log, so restarting the host-server must not reset the cooldown. The block waits 16 s, restarts as `alice`, kills the private host-server (waiting until the port is free), starts a fresh one from the same conf, waits until it answers, confirms it is a different process, then asks as `bob` inside the cooldown: it must still be refused with `lastRestartBy` = `alice`. Startup takes about 2 s on this machine, well inside the 15 s cooldown; if the host is so slow that startup exceeds 15 s the case is inconclusive, not a failure.
- **Steps**:
  1. Run the block below as-is (one shell command; the fresh server keeps running for the remaining cases).
- **Command**:
  ```bash
  R="$PWD"; U='http://127.0.0.1:18791/api/bg-processes/uat0193proj-smoke/restart'; sleep 16; curl -sS -X POST "$U" -H 'X-Conductor-Agent: uat0193proj-alice' | jq -c '{armed: .ok}'; OLD=$(lsof -ti tcp:18791 -sTCP:LISTEN); kill $OLD; for i in $(seq 1 40); do lsof -ti tcp:18791 -sTCP:LISTEN >/dev/null || break; sleep 0.5; done; (cd host-server && env -u TMUX -u TMUX_PANE TMUX_TMPDIR="$R/tmp/uat-0193/tmux" CONDUCTOR_CONF="$R/tmp/uat-0193/conductor.conf" BACKEND_PORT=18791 PORT=18791 nohup node --import tsx/esm index.ts > "$R/tmp/uat-0193/server2.log" 2>&1 &); for i in $(seq 1 40); do curl -sS -m 2 -o /dev/null 'http://127.0.0.1:18791/api/agents' 2>/dev/null && break; sleep 0.5; done; NEW=$(lsof -ti tcp:18791 -sTCP:LISTEN); [ -n "$NEW" ] && [ "$OLD" != "$NEW" ] && echo 'server=restarted' || echo 'server=NOT-RESTARTED'; curl -sS -X POST "$U" -H 'X-Conductor-Agent: uat0193proj-bob' | jq -c '{error, lastRestartBy}'
  ```
- **Expected Result**: `{"armed":true}`, then `server=restarted`, then `{"error":"restart cooldown","lastRestartBy":"uat0193proj-alice"}`. `server=NOT-RESTARTED` makes the case inconclusive (re-run it); `{"error":null,"lastRestartBy":null}` (a 200 for `bob`) is a FAIL.
- **Repeatable Unit Test**: Created: `host-server/bgRestartPolicy.test.ts` (`history reseeded from a fixture after a simulated module restart: cooldown survives`; the live process restart needs the running server)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern='reseeded' bgRestartPolicy.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-009: a 409 `session not running` is audited as `failed` / `session-check` and does not replace the last successful restart
- **Endpoint**: `POST /api/bg-processes/uat0193proj-smoke/restart`
- **Description**: The route answers `409` before any tmux mutation when the session is absent, and audits it as `failed` with `step: session-check`. A failed restart must not arm or overwrite the cooldown state: the status payload must still report `alice` (the last SUCCESS) as `lastRestart.caller`, not `bob` (the failed attempt). **Run after every other live case except cleanup: it destroys the private tmux server.**
- **Steps**:
  1. Kill the private session (this only affects the private tmux server, never the live `conductor` session):
     ```bash
     env -u TMUX -u TMUX_PANE TMUX_TMPDIR="$PWD/tmp/uat-0193/tmux" tmux kill-session -t uat0193
     ```
  2. Run the curl command below as-is, then the audit command, then the status command.
- **Command**:
  ```bash
  curl -sS -i -X POST 'http://127.0.0.1:18791/api/bg-processes/uat0193proj-smoke/restart' -H 'X-Conductor-Agent: uat0193proj-bob' | tr -d '\r' | grep -iE '^(HTTP/|\{)'
  ```
  ```bash
  tail -n 1 tmp/uat-0193/logs/bg-restarts.jsonl | jq -c '{callerKind, caller, outcome, step}'
  ```
  ```bash
  sleep 3; curl -sS 'http://127.0.0.1:18791/api/status' | jq -c '.bgProcesses[] | select(.slug=="uat0193proj-smoke") | {caller: .lastRestart.caller}'
  ```
- **Expected Result**: `HTTP/1.1 409 Conflict` then `{"error":"session not running","sessionAlive":false}`; the audit line is `{"callerKind":"agent","caller":"uat0193proj-bob","outcome":"failed","step":"session-check"}`; the status line is `{"caller":"uat0193proj-alice"}`.
- **Repeatable Unit Test**: Created: `host-server/bgRestartPolicy.test.ts` (`failed restart does not arm the cooldown: only failed/cooldown/denied lines => last() null and evaluateCooldown allows`; the live 409 route precondition needs the running server)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern='failed restart does not arm' bgRestartPolicy.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-010: the whole audit log is valid JSONL with the documented shape, one line per attempt, and no line for the 404
- **Description**: Integrity check over the entire private `bg-restarts.jsonl` after all previous live cases. `jq -s` fails outright on any invalid JSON line. Every record has an ISO `ts`, the smoke slug as `bg`, a valid `callerKind`, a `caller` key, and an `outcome` in the documented set; every `cooldown` line has a numeric `cooldownRemainingS`; every `restarted` line has a `mechanism`; the unknown-slug 404 from UAT-API-001 left no line; the file has at least 12 lines if each live case ran once in order (API-004: 1, API-005: 2, API-006: 3, API-007: 1, API-008: 2, LIVE-002: 2, API-009: 1) and the outcomes seen are exactly `cooldown`, `failed`, `restarted`.
- **Steps**:
  1. Run the command below as-is.
- **Command**:
  ```bash
  jq -s -c '{lines: length, linesAtLeast12: (length >= 12), allValid: all(.[]; (.ts | type == "string") and (.bg == "uat0193proj-smoke") and (.callerKind | IN("agent","dashboard")) and has("caller") and (.outcome | IN("restarted","cooldown","failed","denied"))), cooldownHasRemaining: all(.[]; if .outcome == "cooldown" then (.cooldownRemainingS | type == "number") else true end), restartedHasMechanism: all(.[]; if .outcome == "restarted" then (.mechanism | IN("respawn-window","new-window")) else true end), noNope: (map(select(.bg == "uat0193proj-nope")) | length), outcomes: (map(.outcome) | unique)}' tmp/uat-0193/logs/bg-restarts.jsonl
  ```
- **Expected Result**: `{"lines":12,"linesAtLeast12":true,"allValid":true,"cooldownHasRemaining":true,"restartedHasMechanism":true,"noNope":0,"outcomes":["cooldown","failed","restarted"]}`. `lines` is exactly 12 when every live case ran exactly once in order (more if a case was re-run); `linesAtLeast12`, `allValid`, `cooldownHasRemaining` and `restartedHasMechanism` must be `true`, `noNope` must be `0`.
- **Repeatable Unit Test**: Created: `host-server/bgRestartPolicy.test.ts` (`buildAuditRecord ... round-trips through JSON` and `appendAuditRecord: ... one newline-terminated valid JSON line`)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test --test-name-pattern='buildAuditRecord|appendAuditRecord' bgRestartPolicy.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-011: cleanup the private stack
- **Description**: Removes every artifact of the live cases: the private host-server, the private tmux server, and `tmp/uat-0193/` (including the private audit log). Run last, and run it even if earlier cases failed or were blocked. The real `conductor` tmux session, `./data/conductor.db` and `./logs/bg-restarts.jsonl` are never involved.
- **Steps**:
  1. Run the command below.
  2. Confirm the live `conductor` session is untouched and the fixture directory is gone.
- **Command**:
  ```bash
  (curl -sS -X DELETE 'http://127.0.0.1:18791/api/bg-processes/uat0193proj-smoke'; lsof -ti tcp:18791 -sTCP:LISTEN | xargs kill; sleep 2; env -u TMUX -u TMUX_PANE TMUX_TMPDIR="$PWD/tmp/uat-0193/tmux" tmux kill-server; rm -rf tmp/uat-0193; curl -sS -m 2 -o /dev/null -w 'server=%{http_code}\n' 'http://127.0.0.1:18791/api/agents'; test -e tmp/uat-0193 && echo 'dir=present' || echo 'dir=gone'; tmux list-sessions -F '#S')
  ```
- **Expected Result**: `curl` reports `server=000` (connection refused; the private server is stopped), `dir=gone`, and the final `tmux list-sessions` (the real server) still lists `conductor`. Deleting the bg process may print `{"ok":true,"removed":"uat0193proj-smoke"}` or a connection error if the server was already down, and `tmux kill-server` may print `no server running on .../tmp/uat-0193/tmux/...` if UAT-API-009 already destroyed the private server; none of these matter.
- **Repeatable Unit Test**: Not applicable: lifecycle cleanup of live processes and scratch files
- [x] Pass <!-- 2026-09-20 -->

---

## Notes for the judge

- **Auto-judgeable without the live stack**: UAT-UNIT-001, UAT-EDGE-001 .. 005 (unit-backed), UAT-INT-001 (typecheck), UAT-INT-002 (source-text pins), UAT-DOC-002 (conf value command plus text search), UAT-DOC-001 (text search). The live cases (UAT-API-001 .. 010, UAT-LIVE-001 .. 002) are machine-executable end to end on the private stack, gated by UAT-API-001 (route present) and UAT-API-003 (server has the TASK-0193 status field); they must run in the order written. Always run UAT-API-011 (cleanup), even after failures.
- **Frontend typecheck is intentionally omitted**: `frontend` `tsc --noEmit` currently fails on an unrelated untracked file (`frontend/src/lib/lastPayload.ts`, another in-flight session). The frontend change in this task is type-only and is checked by UAT-DOC-002.
- **Callers must be real project members**: the live cases use `uat0193proj-alice` and `uat0193proj-bob`, registered in the same project as the bg process, so they pass with or without the TASK-0194 same-project guard. Do not substitute made-up caller names; with the guard present an unregistered name is answered `403` (the `denied` outcome, tested by UAT-0194, not here).
- **Not covered live**: a 500 `restart failed` from a real tmux step failure (no reliable way to make one tmux step fail on demand without breaking the private stack; the module-level typed failure is covered by UAT-0190), the 128-character cap on an oversized header (a header that long can never equal an agent's window name, so with the TASK-0194 guard present it would be denied; it is covered at the unit level by UAT-EDGE-001), and log rotation (none by design; documented as a known limit).
- **Known noise**: the private host-server may print tmux/monitor start-up lines to `tmp/uat-0193/server.log`; ignore it. A transient 500 while registering one of the fixture agents (window spawn race at server start) leaves a valid DB row and does not affect the restart cases.
