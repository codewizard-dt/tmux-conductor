---
id: UAT-0197
aliases: [UAT-0197]
title: "UAT: Stop reading and writing bg_processes.linked_agent_id (link input, API/status fields, CONDUCTOR_BG_* env injection, AGENT_BG_LINKS)"
status: passed
task: TASK-0197
created: 2026-09-20
updated: 2026-10-17
---

# UAT-0197 — UAT: Stop reading and writing bg_processes.linked_agent_id

implements::[[TASK-0197]]

> **Source task**: [[TASK-0197]]
> **Generated**: 2026-09-20
>
> **What changed**: every reader and writer of the bg-to-agent link was removed. Backend: `createBgProcess`/`BgProcess`/`mapBgProcess` carry no link, `seedFromLegacy` writes none, `BgStatus.linkedAgent` and its SSE diff term are gone, the legacy agent-side `linkedBg` and `config.ts` `AGENT_BG_LINKS` are gone, and `POST`/`PATCH /bg-processes` ignore a stale `linkedAgent`/`linkedAgentId`. Scripts: `lib/db.sh::load_agents` no longer joins `bg_processes`, and `conductor.sh`/`spawn.sh` no longer inject `CONDUCTOR_BG_NAME|LOG|STATE`. Frontend: no "Link to Agent" select, no `linkedAgent` type/label/POST field.
>
> **Out of scope**: the column and DDL (TASK-0198 drops them in a v12 migration, implemented concurrently). No test here asserts the column exists or is absent; the runtime checks read it only when present.
>
> **Isolation design**: the host-server on `:8788` is a stale process and the `conductor` tmux session is live, so **no test in this file contacts either**. Live behavior is exercised by `scripts/verify-bg-link-retired.sh`, which (mode `env`) runs the real `conductor.sh`/`spawn.sh` against a scratch DB with a logging `tmux` stub on PATH, and (mode `api`) boots the real host-server from the working tree on private port `18797` with a scratch `conductor.conf`/DB and a private tmux server (`TMUX_TMPDIR` under `./tmp/`). Because that server is started fresh from the tree it cannot be stale, so no stale-server gate is needed.
>
> **Deviation from the task's deferred step**: the task asks to confirm `env | grep CONDUCTOR_BG` prints nothing inside a really spawned agent. The only channel that ever put those variables into an agent shell was the text typed by `conductor.sh`/`spawn.sh` (the `env_prefix`/`_bg_env` interpolation); UAT-EDGE-001/002 assert that typed text on the stub log, and UAT-EDGE-005 pins that no code path builds it. Spawning a real agent (or running `conductor.sh`'s `monitor` window, which locks on the live `STATE_DIR`) is deliberately not done. UAT-UI-003 is the manual dashboard walk.

---

## Prerequisites

- [ ] Run everything from the repo root `/Users/davidtaylor/Repositories/tmux-conductor`. No `.env` file is read or written; scratch artifacts land in `./tmp/verify-bg-link-retired/` only.
- [ ] `bash` >= 4 first on `PATH` (the scripts guard on it), plus `sqlite3`, `jq`, `curl`, `tmux`, and `node` with `host-server/node_modules` installed.
- [ ] TCP port `18797` is free (the API script refuses to run if anything already answers there, and kills only the server it started).
- [ ] `host-server/` and `frontend/` dependencies installed (`npx tsx`, `npx vitest`, `npx tsc` resolve).

---

## Test Cases

### UAT-API-001: POST /bg-processes ignores a stale `linkedAgent` / `linkedAgentId`
- **Endpoint**: `POST /api/bg-processes` (private host-server on `:18797`, private tmux server)
- **Description**: An old client that still sends `linkedAgent: "agent1"` and `linkedAgentId: <id>` alongside a valid body must get a normal `201`, the response must not echo any link field, and nothing may be persisted into the legacy column (checked only while the column still exists).
- **Steps**:
  1. Run the command below (about 10 to 20 seconds: it boots the server, drives the API, and tears both processes down)
  2. Read the `api:` lines for POST
- **Command**:
  ```bash
  bash scripts/verify-bg-link-retired.sh api
  ```
- **Expected Result**: the output contains these PASS lines and no FAIL line, and the exit code is 0:
  - `PASS: api: POST /bg-processes with stale linkedAgent/linkedAgentId -> 201`
  - `PASS: api: POST 201 body does not echo any link field`
  - `PASS: api: stale link from POST body was not persisted`
- **Repeatable Unit Test**: Created: `scripts/verify-bg-link-retired.sh` (mode `api`, repeatable and self-cleaning) and `host-server/bgLinkRetired.test.ts` (static pin `TASK-0197: POST/PATCH /bg-processes handlers do not destructure any link field`)
- **Unit Test Command**: `bash scripts/verify-bg-link-retired.sh api`
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-002: /api/status carries no `linkedAgent` on bg rows and no `linkedBg` on agent rows
- **Endpoint**: `GET /api/status` (private host-server)
- **Description**: After creating a bg process and an agent, the status payload (and thus the SSE `bg-update` snapshot source) exposes neither `bgProcesses[].linkedAgent` nor `agents[].linkedBg`. The check waits for the poll-loop snapshot to include the new bg row and requires at least one bg row and one agent row to have been inspected, so it cannot pass vacuously.
- **Steps**:
  1. Run the command below
  2. Read the `/status` lines
- **Command**:
  ```bash
  bash scripts/verify-bg-link-retired.sh api
  ```
- **Expected Result**: PASS lines, no FAIL line:
  - `PASS: api: /status lists the created bg process (positive control)`
  - `PASS: api: /status bgProcesses[] have no linkedAgent`
  - `PASS: api: /status agents[] have no linkedBg (and at least one agent was checked)`
- **Repeatable Unit Test**: Created: `scripts/verify-bg-link-retired.sh` (mode `api`) and `host-server/bgLinkRetired.test.ts` (`TASK-0197: host-server code no longer reads, writes or exposes a bg-to-agent link`)
- **Unit Test Command**: `bash scripts/verify-bg-link-retired.sh api`
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-003: PATCH /bg-processes/:slug ignores a stale `linkedAgentId` but still applies real fields
- **Endpoint**: `PATCH /api/bg-processes/t0197-proj-dev` (private host-server)
- **Description**: A body of `{launchCmd, linkedAgentId, linkedAgent}` returns `200`, applies `launchCmd` (positive control: the PATCH really ran), does not persist any link, and the response carries no link field.
- **Steps**:
  1. Run the command below
  2. Read the PATCH lines
- **Command**:
  ```bash
  bash scripts/verify-bg-link-retired.sh api
  ```
- **Expected Result**: PASS lines, no FAIL line:
  - `PASS: api: PATCH with stale link fields -> 200`
  - `PASS: api: PATCH applied launchCmd (positive control)`
  - `PASS: api: stale link from PATCH body was not persisted`
  - `PASS: api: PATCH response carries no link field`
- **Repeatable Unit Test**: Created: `scripts/verify-bg-link-retired.sh` (mode `api`)
- **Unit Test Command**: `bash scripts/verify-bg-link-retired.sh api`
- [x] Pass <!-- 2026-09-20 -->

### UAT-EDGE-001: `conductor.sh` types no `CONDUCTOR_BG_*` into any launch line, even when a legacy link is populated
- **Scenario**: A DB whose bg row still has `linked_agent_id` pointing at an agent (the exact input that used to make `load_agents` join the bg name and inject `CONDUCTOR_BG_NAME/LOG/STATE`).
- **Steps**:
  1. Run the command below (real `scripts/conductor.sh`, `tmux` replaced by a logging stub, scratch DB; no tmux server is contacted)
  2. Read the `conductor.sh` lines
- **Command**:
  ```bash
  bash scripts/verify-bg-link-retired.sh env
  ```
- **Expected Result**: PASS lines, no FAIL line, exit 0:
  - `PASS: env: fixture bg row carries a populated legacy linked_agent_id (check is non-vacuous)`
  - `PASS: env: conductor.sh launched the agent with CONDUCTOR_AGENT_NAME (positive control)`
  - `PASS: env: conductor.sh spawned the bg process`
  - `PASS: env: conductor.sh injects no CONDUCTOR_BG_* into any launch text`
  The check was mutation-verified: run against the pre-change (`git show HEAD:`) copies of `conductor.sh`, `spawn.sh`, `lib/db.sh` and `conductor.conf` it FAILs.
- **Repeatable Unit Test**: Created: `scripts/verify-bg-link-retired.sh` (mode `env`)
- **Unit Test Command**: `bash scripts/verify-bg-link-retired.sh env`
- [x] Pass <!-- 2026-09-20 -->

### UAT-EDGE-002: `spawn.sh` types no `CONDUCTOR_BG_*` into any launch line
- **Scenario**: Same populated-legacy-link DB, split-pane launcher.
- **Steps**:
  1. Run the command below
  2. Read the `spawn.sh` lines
- **Command**:
  ```bash
  bash scripts/verify-bg-link-retired.sh env
  ```
- **Expected Result**: PASS lines, no FAIL line, exit 0:
  - `PASS: env: spawn.sh launched the agent with CONDUCTOR_AGENT_NAME (positive control)`
  - `PASS: env: spawn.sh spawned the bg process`
  - `PASS: env: spawn.sh injects no CONDUCTOR_BG_* into any launch text`
- **Repeatable Unit Test**: Created: `scripts/verify-bg-link-retired.sh` (mode `env`)
- **Unit Test Command**: `bash scripts/verify-bg-link-retired.sh env`
- [x] Pass <!-- 2026-09-20 -->

### UAT-EDGE-003: `load_agents` keeps its six agent fields and defines no `AGENT_BG` array
- **Scenario**: Removing the `LEFT JOIN bg_processes` shifts positional fields. Sourcing the real `scripts/lib/db.sh` against the scratch DB must still yield the agent name, the project-prefixed window name and the project id, and must not define `AGENT_BG`.
- **Steps**:
  1. Run the command below
  2. Read the `load_agents` line
- **Command**:
  ```bash
  bash scripts/verify-bg-link-retired.sh env
  ```
- **Expected Result**: `PASS: env: load_agents still yields name/window/project and defines no AGENT_BG array`, no FAIL line, exit 0.
- **Repeatable Unit Test**: Created: `scripts/verify-bg-link-retired.sh` (mode `env`) and `host-server/bgLinkRetired.test.ts` (`TASK-0197: shell scripts inject no CONDUCTOR_BG_* and load_agents does not join bg_processes`)
- **Unit Test Command**: `bash scripts/verify-bg-link-retired.sh env`
- [x] Pass <!-- 2026-09-20 -->

### UAT-EDGE-004: No host-server code references any retired link identifier
- **Scenario**: `host-server/index.ts`, `db.ts` and `config.ts` must contain none of `linkedAgent`, `linkedBg`, `agentBgLinks`, `bgLinks`, `AGENT_BG_LINKS`, `CONDUCTOR_BG_` in executable code (comments may explain history). This covers `BgStatus.linkedAgent`, its SSE diff term, the agent-side `linkedBg`, the `config.ts` `declare -p` list/parse/field, and the `createBgProcess`/`BgProcess`/`mapBgProcess` surface. It never names the DB column, so it stays valid after TASK-0198.
- **Steps**:
  1. Run the command below
- **Command**:
  ```bash
  node --import tsx/esm --test --test-name-pattern='TASK-0197: host-server code' host-server/bgLinkRetired.test.ts
  ```
- **Expected Result**: `1` test, `pass 1`, `fail 0`, exit 0.
- **Repeatable Unit Test**: Created: `host-server/bgLinkRetired.test.ts`
- **Unit Test Command**: `node --import tsx/esm --test --test-name-pattern='TASK-0197: host-server code' host-server/bgLinkRetired.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-EDGE-005: POST/PATCH handlers take no link field and the POST 201 body is exactly `{ok, bg:{slug,name,workdir,launchCmd,projectId}}`
- **Scenario**: Static pin on the two handler heads (Body type and destructuring) and on the 201 response shape, complementing the runtime check in UAT-API-001/003.
- **Steps**:
  1. Run the command below
- **Command**:
  ```bash
  node --import tsx/esm --test --test-name-pattern='TASK-0197: POST/PATCH' host-server/bgLinkRetired.test.ts
  ```
- **Expected Result**: `1` test, `pass 1`, `fail 0`, exit 0.
- **Repeatable Unit Test**: Created: `host-server/bgLinkRetired.test.ts`
- **Unit Test Command**: `node --import tsx/esm --test --test-name-pattern='TASK-0197: POST/PATCH' host-server/bgLinkRetired.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-EDGE-006: Scripts and conf are clean: no `CONDUCTOR_BG_*`, no `AGENT_BG`, no `bg_processes` join in `load_agents`, no `AGENT_BG_LINKS`
- **Scenario**: Static pin over `scripts/conductor.sh`, `scripts/spawn.sh`, `scripts/lib/db.sh` (including the `load_agents` body and its six-field `read -r` list) and `conductor.conf`.
- **Steps**:
  1. Run the command below
- **Command**:
  ```bash
  node --import tsx/esm --test --test-name-pattern='TASK-0197: (conductor.conf declares|shell scripts inject)' host-server/bgLinkRetired.test.ts
  ```
- **Expected Result**: `2` tests, `pass 2`, `fail 0`, exit 0.
- **Repeatable Unit Test**: Created: `host-server/bgLinkRetired.test.ts`
- **Unit Test Command**: `node --import tsx/esm --test --test-name-pattern='TASK-0197: (conductor.conf declares|shell scripts inject)' host-server/bgLinkRetired.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-EDGE-007: `createBgProcess` neither accepts nor sets a link and `BgProcess` exposes none
- **Scenario**: A fresh row created through `createBgProcess` has no `linkedAgentId` property on the returned `BgProcess`; the legacy column (read only while it exists) is NULL for every create; deleting an agent never touches bg rows (`project_id` is the sole ownership boundary); `listBgProcesses` round-trips the same object.
- **Steps**:
  1. Run the command below
- **Command**:
  ```bash
  node --import tsx/esm --test --test-name-pattern='TASK-159: createBgProcess' host-server/db.test.ts
  ```
- **Expected Result**: `1` test, `pass 1`, `fail 0`, exit 0.
- **Repeatable Unit Test**: Created: `host-server/db.test.ts` (`TASK-159: createBgProcess, listBgProcesses, deleteBgProcess provide full CRUD for bg processes (TASK-0197: no link is read or written)`)
- **Unit Test Command**: `node --import tsx/esm --test --test-name-pattern='TASK-159: createBgProcess' host-server/db.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-EDGE-008: conductor.conf no longer claims agent-to-bg links exist, and the docs record the retirement
- **Scenario**: The task deleted the `AGENT_BG_LINKS` block, but the conf header comment (line 8) still says "Agents, background processes, agent↔bg links, and the task queue now live in SQLite". That statement is false once the link is retired. `CLAUDE.md` and `scripts/README.md` must state the retirement (`bg-to-agent link is retired (TASK-0197)`).
- **Steps**:
  1. Run the command below
- **Command**:
  ```bash
  node --import tsx/esm --test --test-name-pattern='TASK-0197: (conductor.conf no longer claims|CLAUDE.md and scripts/README.md)' host-server/bgLinkRetired.test.ts
  ```
- **Expected Result**: `2` tests, `pass 2`, `fail 0`, exit 0. **Known gap at generation time**: the first test FAILs with `stale header comment still mentions agent<->bg links` until the `conductor.conf` line 8 comment drops "agent↔bg links". Written against the requirement, not the current text.
- **Repeatable Unit Test**: Created: `host-server/bgLinkRetired.test.ts`
- **Unit Test Command**: `node --import tsx/esm --test --test-name-pattern='TASK-0197: (conductor.conf no longer claims|CLAUDE.md and scripts/README.md)' host-server/bgLinkRetired.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-EDGE-009: Type-checks and shell syntax are clean after the removal
- **Scenario**: Removing `BgProcess.linkedAgentId`, `BgStatus.linkedAgent`, `BgProcessDefinition.linkedAgentId` and the script fields must leave no dangling consumer in either package, and the four edited scripts (plus the two that source `db.sh`) must parse.
- **Steps**:
  1. Run the command below
- **Command**:
  ```bash
  cd host-server && npx tsc --noEmit && cd ../frontend && npx tsc --noEmit && cd .. && bash -n scripts/conductor.sh && bash -n scripts/spawn.sh && bash -n scripts/lib/db.sh && bash -n scripts/verify-teardown-window-mapping.sh && bash -n scripts/verify-bg-link-retired.sh
  ```
- **Expected Result**: no output, exit 0. Any `error TS` line or `bash: syntax error` is a FAIL.
- **Repeatable Unit Test**: Not applicable: whole-package type-check and syntax gate (already the repo's standard gate; not a single unit)
- [x] Pass <!-- 2026-09-20 -->

### UAT-UI-001: The Add Background Process form has no "Link to Agent" input and POSTs no `linkedAgent`
- **Page**: dashboard `http://localhost:4321`, NavBar "Add Background Process" modal (`frontend/src/components/AddBgProcessForm.tsx`)
- **Description**: The modal must not contain "Show advanced", a "Link to Agent" select, or help text mentioning `CONDUCTOR_BG_*`, must not fetch `/status` to populate agents, and the submitted body must be exactly `name`, `workdir`, `launchCmd`, `projectId` with no `linkedAgent`/`linkedAgentId`.
- **Steps**:
  1. Run the command below (11 tests in the file; the TASK-0197 case is `has no "Link to Agent" input and sends no linkedAgent in the POST body`)
- **Command**:
  ```bash
  cd frontend && npx vitest run src/components/AddBgProcessForm.test.tsx
  ```
- **Expected Result**: `Test Files 1 passed`, `Tests 11 passed`, exit 0.
- **Repeatable Unit Test**: Created: `frontend/src/components/AddBgProcessForm.test.tsx`
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AddBgProcessForm.test.tsx`
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk (diagnostic: unit run 11/11 passed)] <!-- 2026-10-17 -->

### UAT-UI-002: A bg process tile renders no "linked to <agent>" label and the frontend has no link type or API field
- **Page**: dashboard agents area (`frontend/src/components/AgentList.tsx`)
- **Description**: `BgProcess` in `AgentList.tsx` has no `linkedAgent`, the tile has no `linked to` label, and `BgProcessDefinition` in `frontend/src/lib/api.ts` has no `linkedAgentId`. The render test in `AgentList.test.tsx` uses a fixture with no link, so on its own it would pass even if the conditional label survived; the static pin (`TASK-0197: frontend has no link input...`) is what proves the label and fields are gone from source, so both must pass.
- **Steps**:
  1. Run the command below (render assertion, then source pin)
- **Command**:
  ```bash
  cd frontend && npx vitest run src/components/AgentList.test.tsx -t 'leaves background-process cards visible' && cd .. && node --import tsx/esm --test --test-name-pattern='TASK-0197: frontend has no link' host-server/bgLinkRetired.test.ts
  ```
- **Expected Result**: vitest `Tests 1 passed`, then node test `pass 1`, `fail 0`, exit 0.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (render assertion) and `host-server/bgLinkRetired.test.ts` (source pin)
- **Unit Test Command**: `node --import tsx/esm --test --test-name-pattern='TASK-0197: frontend has no link' host-server/bgLinkRetired.test.ts`
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk (diagnostic: render test 1/1 passed, source pin 1/1 passed)] <!-- 2026-10-17 -->

### UAT-UI-003: Manual dashboard walk: create a bg process without a link field
- **Page**: `http://localhost:4321` against a host-server restarted on the TASK-0197 code (the process on `:8788` is stale: a stale server still accepts and stores a link, so do this only after restarting it, e.g. `make dev`)
- **Description**: The task's deferred check. A human confirms the shipped UI end to end. Use a **throwaway** project and process name (for example project `t0197-manual`, process `smoke`, command `sleep 600`); never touch the real `dev` or `dev-stack` processes. This is judged by a human because it needs a real browser and a real tmux window.
- **Steps**:
  1. Open the dashboard and open the Add Background Process modal from the NavBar
  2. Confirm the modal has Project, Name, Working directory and Launch command inputs only: no "Show advanced" toggle, no "Link to Agent" select, no text about `CONDUCTOR_BG_*`
  3. Submit with the throwaway values; the modal closes and the new bg tile appears with no "linked to ..." text
  4. In the browser devtools Network tab, confirm the `POST /api/bg-processes` request body has no `linkedAgent` key
  5. Remove the throwaway bg process and project from the dashboard
- **Expected Result**: all of the above hold; the tile appears and works without any link.
- **Repeatable Unit Test**: Created: `frontend/src/components/AddBgProcessForm.test.tsx` (form contents and POST body are unit-covered by UAT-UI-001; the live window spawn and visual check are not automatable here)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AddBgProcessForm.test.tsx`
- [FAIL: auto-judge: UI/manual test requires human verification — manual dashboard walk] <!-- 2026-10-17 -->
