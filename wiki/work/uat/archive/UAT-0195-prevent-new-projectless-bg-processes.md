---
id: UAT-0195
aliases: [UAT-0195]
title: "UAT: Require a project for every bg process (validate POST/PATCH, cascade on project delete, backfill, remove Unassigned UI)"
status: passed
task: TASK-0195
created: 2026-09-20
updated: 2026-09-20
---

# UAT-0195 — UAT: Require a project for every bg process

implements::[[TASK-0195]]

> **Source task**: [[TASK-0195]]
> **Generated**: 2026-09-20
>
> **Out of scope (deferred to TASK-0196)**: schema-level `NOT NULL` and `ON DELETE CASCADE` on `bg_processes.project_id`. No test here asserts either. Enforcement under test is the route-level validation, the code-level cascade in `DELETE /projects/:id`, and the startup backfill.

---

## Prerequisites

- [ ] Host-server is running **the TASK-0195 code** (restart it if it started before the change). UAT-API-000 is a hard gate: it fails closed on a stale server. Do NOT run any other live UAT-API test against a stale server: the old code accepts `projectId: null` and would create or mutate real rows.
- [ ] tmux session `conductor` is alive (`GET /api/status` → `"sessionAlive": true`), because UAT-API-008 spawns a real tmux window.
- [ ] Scratch directory exists: `mkdir -p /Users/davidtaylor/Repositories/tmux-conductor/tmp/t0195-smoke`
- [ ] No leftover fixtures from a previous run: `GET /api/projects` contains no project whose name starts with `t0195-smoke` (UAT-API-021 checks this at the end; if it fails, sweep with `DELETE /api/projects/:id` for each leftover).
- [ ] Frontend dev server on `http://localhost:4321` (only for the manual UI tests).
- [ ] Every live test uses only the throwaway names `t0195-smoke` (project A), `t0195-smoke-b` (project B) and `t0195-smoke-bg` (bg process). Never touch real projects, agents or bg processes (`dev`, `dev-stack`, ...). No `.env` file is read or written.

**Note on project ids.** Project ids are assigned by SQLite, so the live commands resolve them at run time by name with a nested `$(curl ... | jq ...)`. This is the one deliberate deviation from the single-`curl` rule. Errors from tests that expect a 4xx use `curl -i` so the status line is part of the evidence.

**Note on bg slugs (TASK-0196).** A bg process is addressed by the derived slug `<projectName>-<name>`, not its bare name: every `/api/bg-processes/:slug` route, the tmux window name and `bg-<slug>.log` use the slug. `t0195-smoke-bg` in project `t0195-smoke` therefore has slug `t0195-smoke-t0195-smoke-bg`; after it moves to project `t0195-smoke-b` its slug becomes `t0195-smoke-b-t0195-smoke-bg`. `POST /api/bg-processes` still takes the bare `name`, and `/api/status` `.bgProcesses[].name` is still the bare name. Bare-name URLs return 404.

**Note on nested quoting.** Inside `"...$(curl ... | jq ...)..."` the `$(...)` opens a fresh quoting context, so the inner jq filter is written with plain (unescaped) double quotes. Backslash-escaping them there makes jq fail to compile.

**Isolated runs.** When run headless by `/uat-auto` against a private stack, substitute the private host-server port for `8788` and the private tmux session/socket for `conductor`; the assertions are otherwise identical.

**Test data.** Workdir for all fixtures: `/Users/davidtaylor/Repositories/tmux-conductor/tmp/t0195-smoke`. Launch command for the bg process: `sleep 600` (inert).

---

## Test Cases

### UAT-API-000: Host-server runs the TASK-0195 code (stale-server gate)
- **Endpoint**: `DELETE /api/projects/:id`
- **Description**: Before TASK-0195 this route returned `204 No Content`; it now returns `200 {"ok":true,"removedBgProcesses":[...]}`. Using a nonexistent id (999999) makes the probe a harmless no-op on both old and new code, so it safely proves which code is live. **If this test does not pass, stop: mark every other UAT-API test blocked.**
- **Steps**:
  1. Run the curl command below as-is
- **Command**:
  ```bash
  curl -sS -i -X DELETE 'http://127.0.0.1:8788/api/projects/999999'
  ```
- **Expected Result**: `HTTP/1.1 200 OK` with body `{"ok":true,"removedBgProcesses":[]}`. A `204 No Content` means the running server predates TASK-0195 and must be restarted.
- **Repeatable Unit Test**: Not applicable: probes the live process to detect a stale build
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-001: Create throwaway project A
- **Endpoint**: `POST /api/projects`
- **Description**: Fixture. Creates `t0195-smoke` so later tests have a valid project.
- **Steps**:
  1. Run the curl command below as-is
- **Command**:
  ```bash
  curl -sS -i -X POST 'http://127.0.0.1:8788/api/projects' -H 'Content-Type: application/json' -d '{"name":"t0195-smoke","workdir":"/Users/davidtaylor/Repositories/tmux-conductor/tmp/t0195-smoke"}'
  ```
- **Expected Result**: `201 Created`; body has `"name":"t0195-smoke"` and an integer `id`.
- **Repeatable Unit Test**: Not applicable: fixture setup over real HTTP
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-002: Create throwaway project B
- **Endpoint**: `POST /api/projects`
- **Description**: Fixture. Creates `t0195-smoke-b`, the target for the "move to another existing project" test.
- **Steps**:
  1. Run the curl command below as-is
- **Command**:
  ```bash
  curl -sS -i -X POST 'http://127.0.0.1:8788/api/projects' -H 'Content-Type: application/json' -d '{"name":"t0195-smoke-b","workdir":"/Users/davidtaylor/Repositories/tmux-conductor/tmp/t0195-smoke"}'
  ```
- **Expected Result**: `201 Created`; body has `"name":"t0195-smoke-b"` and an integer `id` different from project A's.
- **Repeatable Unit Test**: Not applicable: fixture setup over real HTTP
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-003: POST /bg-processes without projectId is rejected
- **Endpoint**: `POST /api/bg-processes`
- **Description**: A request with all other fields valid but no `projectId` must be a 400, and no bg row or tmux window may be created.
- **Steps**:
  1. Run the curl command below as-is
- **Command**:
  ```bash
  curl -sS -i -X POST 'http://127.0.0.1:8788/api/bg-processes' -H 'Content-Type: application/json' -d '{"name":"t0195-smoke-bg","workdir":"/Users/davidtaylor/Repositories/tmux-conductor/tmp/t0195-smoke","launchCmd":"sleep 600"}'
  ```
- **Expected Result**: `400 Bad Request`, body `{"error":"projectId is required"}`.
- **Repeatable Unit Test**: Created: `host-server/db.test.ts` (static route pin: `TASK-0195: index.ts requires projectId on POST /bg-processes, ...`); the live 400 is not unit-testable because `index.ts` binds a port on import
- **Unit Test Command**: `node --import tsx/esm --test --test-name-pattern='TASK-0195: index.ts requires' host-server/db.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-004: POST /bg-processes with projectId null is rejected
- **Endpoint**: `POST /api/bg-processes`
- **Description**: An explicit `null` counts as missing.
- **Steps**:
  1. Run the curl command below as-is
- **Command**:
  ```bash
  curl -sS -i -X POST 'http://127.0.0.1:8788/api/bg-processes' -H 'Content-Type: application/json' -d '{"name":"t0195-smoke-bg","workdir":"/Users/davidtaylor/Repositories/tmux-conductor/tmp/t0195-smoke","launchCmd":"sleep 600","projectId":null}'
  ```
- **Expected Result**: `400 Bad Request`, body `{"error":"projectId is required"}`.
- **Repeatable Unit Test**: Not applicable: live HTTP behavior; the message is pinned by UAT-API-003's static test
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-005: POST /bg-processes with a non-integer projectId (string) is rejected
- **Endpoint**: `POST /api/bg-processes`
- **Description**: `projectId` must be a JSON integer; a numeric string is not accepted.
- **Steps**:
  1. Run the curl command below as-is
- **Command**:
  ```bash
  curl -sS -i -X POST 'http://127.0.0.1:8788/api/bg-processes' -H 'Content-Type: application/json' -d '{"name":"t0195-smoke-bg","workdir":"/Users/davidtaylor/Repositories/tmux-conductor/tmp/t0195-smoke","launchCmd":"sleep 600","projectId":"1"}'
  ```
- **Expected Result**: `400 Bad Request`, body `{"error":"projectId must be an integer"}`.
- **Repeatable Unit Test**: Not applicable: live HTTP behavior; the message is pinned by UAT-API-003's static test
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-006: POST /bg-processes with a non-integer projectId (float) is rejected
- **Endpoint**: `POST /api/bg-processes`
- **Description**: A fractional number is not an integer.
- **Steps**:
  1. Run the curl command below as-is
- **Command**:
  ```bash
  curl -sS -i -X POST 'http://127.0.0.1:8788/api/bg-processes' -H 'Content-Type: application/json' -d '{"name":"t0195-smoke-bg","workdir":"/Users/davidtaylor/Repositories/tmux-conductor/tmp/t0195-smoke","launchCmd":"sleep 600","projectId":1.5}'
  ```
- **Expected Result**: `400 Bad Request`, body `{"error":"projectId must be an integer"}`.
- **Repeatable Unit Test**: Not applicable: live HTTP behavior; the message is pinned by UAT-API-003's static test
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-007: POST /bg-processes with an unknown projectId is rejected
- **Endpoint**: `POST /api/bg-processes`
- **Description**: An integer that matches no project must be a 400, not a 5xx or a silent orphan row.
- **Steps**:
  1. Run the curl command below as-is
- **Command**:
  ```bash
  curl -sS -i -X POST 'http://127.0.0.1:8788/api/bg-processes' -H 'Content-Type: application/json' -d '{"name":"t0195-smoke-bg","workdir":"/Users/davidtaylor/Repositories/tmux-conductor/tmp/t0195-smoke","launchCmd":"sleep 600","projectId":999999}'
  ```
- **Expected Result**: `400 Bad Request`, body `{"error":"project 999999 not found"}`.
- **Repeatable Unit Test**: Not applicable: live HTTP behavior; the message is pinned by UAT-API-003's static test
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-008: POST /bg-processes with a valid projectId succeeds and is scoped to that project
- **Endpoint**: `POST /api/bg-processes`
- **Description**: Happy path. Creates `t0195-smoke-bg` in project A and spawns its tmux window (`sleep 600`).
- **Steps**:
  1. Confirm UAT-API-003..007 all passed (a failed one means a project-less row may already exist; investigate first)
  2. Run the curl command below as-is
- **Command**:
  ```bash
  curl -sS -i -X POST 'http://127.0.0.1:8788/api/bg-processes' -H 'Content-Type: application/json' -d "{\"name\":\"t0195-smoke-bg\",\"workdir\":\"/Users/davidtaylor/Repositories/tmux-conductor/tmp/t0195-smoke\",\"launchCmd\":\"sleep 600\",\"projectId\":$(curl -sS 'http://127.0.0.1:8788/api/projects' | jq -r '.[] | select(.name=="t0195-smoke") | .id')}"
  ```
- **Expected Result**: `201 Created`; body `{"ok":true,"bg":{"name":"t0195-smoke-bg", ..., "projectId":<id of t0195-smoke>}}` with an integer (non-null) `projectId`. A `409 session not running` means the tmux session is down: mark this and all dependent tests blocked.
- **Repeatable Unit Test**: Not applicable: spawns a real tmux window over HTTP
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-009: The new bg process is listed under project A
- **Endpoint**: `GET /api/projects/:id/bg-processes`
- **Description**: Confirms the row persisted with the right `project_id`.
- **Steps**:
  1. Run the curl command below as-is
- **Command**:
  ```bash
  curl -sS "http://127.0.0.1:8788/api/projects/$(curl -sS 'http://127.0.0.1:8788/api/projects' | jq -r '.[] | select(.name=="t0195-smoke") | .id')/bg-processes" | jq -c '[.[] | .name]'
  ```
- **Expected Result**: `["t0195-smoke-bg"]`.
- **Repeatable Unit Test**: Not applicable: live HTTP + SQLite wiring
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-010: PATCH projectId null is rejected
- **Endpoint**: `PATCH /api/bg-processes/:slug`
- **Description**: A bg process can never be unassigned. The URL uses the slug `t0195-smoke-t0195-smoke-bg` (see the slug note above).
- **Steps**:
  1. Run the curl command below as-is
- **Command**:
  ```bash
  curl -sS -i -X PATCH 'http://127.0.0.1:8788/api/bg-processes/t0195-smoke-t0195-smoke-bg' -H 'Content-Type: application/json' -d '{"projectId":null}'
  ```
- **Expected Result**: `400 Bad Request`, body `{"error":"projectId cannot be null: a bg process must belong to a project"}`.
- **Repeatable Unit Test**: Created: `host-server/db.test.ts` (static route pin: `TASK-0195: index.ts requires projectId on POST /bg-processes, rejects null on PATCH, ...`)
- **Unit Test Command**: `node --import tsx/esm --test --test-name-pattern='TASK-0195: index.ts requires' host-server/db.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-011: PATCH with a non-integer projectId is rejected
- **Endpoint**: `PATCH /api/bg-processes/:slug`
- **Description**: Type validation on PATCH.
- **Steps**:
  1. Run the curl command below as-is
- **Command**:
  ```bash
  curl -sS -i -X PATCH 'http://127.0.0.1:8788/api/bg-processes/t0195-smoke-t0195-smoke-bg' -H 'Content-Type: application/json' -d '{"projectId":"abc"}'
  ```
- **Expected Result**: `400 Bad Request`, body `{"error":"projectId must be an integer"}`.
- **Repeatable Unit Test**: Not applicable: live HTTP behavior; the message is pinned by the PATCH static test in UAT-API-010
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-012: PATCH to an unknown project is rejected
- **Endpoint**: `PATCH /api/bg-processes/:slug`
- **Description**: The target project must exist.
- **Steps**:
  1. Run the curl command below as-is
- **Command**:
  ```bash
  curl -sS -i -X PATCH 'http://127.0.0.1:8788/api/bg-processes/t0195-smoke-t0195-smoke-bg' -H 'Content-Type: application/json' -d '{"projectId":999999}'
  ```
- **Expected Result**: `400 Bad Request`, body `{"error":"project 999999 not found"}`.
- **Repeatable Unit Test**: Not applicable: live HTTP behavior; the message is pinned by the PATCH static test in UAT-API-010
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-013: Rejected PATCHes left the bg process in project A
- **Endpoint**: `GET /api/projects/:id/bg-processes`
- **Description**: The three 400s above must not have changed or cleared the row's project.
- **Steps**:
  1. Run the curl command below as-is
- **Command**:
  ```bash
  curl -sS "http://127.0.0.1:8788/api/projects/$(curl -sS 'http://127.0.0.1:8788/api/projects' | jq -r '.[] | select(.name=="t0195-smoke") | .id')/bg-processes" | jq -c '[.[] | .name]'
  ```
- **Expected Result**: `["t0195-smoke-bg"]`.
- **Repeatable Unit Test**: Not applicable: live HTTP + SQLite wiring
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-014: PATCH moves the bg process to another existing project
- **Endpoint**: `PATCH /api/bg-processes/:slug`
- **Description**: Re-assigning to a different valid project still works, but only once the bg process's window is closed (the slug changes with the project, so the server refuses while the window is open). Each command runs in its own Bash call, in order.
- **Steps**:
  1. Assert the open-window guard. With the window from UAT-API-008 still open, run the curl command below as-is. It must return `409 Conflict` with an error starting `cannot change project while window 't0195-smoke-t0195-smoke-bg' is open: close the window first`, and the row must not move.
  2. Close the window: `curl -sS -i -X DELETE 'http://127.0.0.1:8788/api/bg-processes/t0195-smoke-t0195-smoke-bg/window'` (expect `200 OK`)
  3. Run the same PATCH curl again (expect `200 OK`, see Expected Result)
- **Command**:
  ```bash
  curl -sS -i -X PATCH 'http://127.0.0.1:8788/api/bg-processes/t0195-smoke-t0195-smoke-bg' -H 'Content-Type: application/json' -d "{\"projectId\":$(curl -sS 'http://127.0.0.1:8788/api/projects' | jq -r '.[] | select(.name=="t0195-smoke-b") | .id')}"
  ```
- **Expected Result**: Step 1: `409 Conflict` (window open). Step 3, after the window is closed: `200 OK`; body has `"name":"t0195-smoke-bg"` and `"projectId"` equal to the id of `t0195-smoke-b` (not null). The bg process's slug is now `t0195-smoke-b-t0195-smoke-bg`.
- **Repeatable Unit Test**: Not applicable: live HTTP behavior
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-015: After the move the bg process is under project B and no longer under A
- **Endpoint**: `GET /api/projects/:id/bg-processes` (both projects)
- **Description**: Confirms the reassignment persisted.
- **Steps**:
  1. Run the curl command below as-is (project B)
  2. Run it again with `t0195-smoke` in place of `t0195-smoke-b` (project A)
- **Command**:
  ```bash
  curl -sS "http://127.0.0.1:8788/api/projects/$(curl -sS 'http://127.0.0.1:8788/api/projects' | jq -r '.[] | select(.name=="t0195-smoke-b") | .id')/bg-processes" | jq -c '[.[] | .name]'
  ```
- **Expected Result**: Project B returns `["t0195-smoke-bg"]`; project A (step 2) returns `[]`.
- **Repeatable Unit Test**: Not applicable: live HTTP + SQLite wiring
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-016: Deleting a project with no bg processes returns an empty removed list
- **Endpoint**: `DELETE /api/projects/:id`
- **Description**: Project A now has no bg processes. The route returns `200` (was `204` before this task) with an empty `removedBgProcesses`. Also proves deleting A does not touch the bg process that now lives in B.
- **Steps**:
  1. Run the curl command below as-is
- **Command**:
  ```bash
  curl -sS -i -X DELETE "http://127.0.0.1:8788/api/projects/$(curl -sS 'http://127.0.0.1:8788/api/projects' | jq -r '.[] | select(.name=="t0195-smoke") | .id')"
  ```
- **Expected Result**: `200 OK`, body `{"ok":true,"removedBgProcesses":[]}`.
- **Repeatable Unit Test**: Created: `host-server/db.test.ts` (`TASK-0195: deleteProject on a project with no bg processes succeeds and returns []`)
- **Unit Test Command**: `node --import tsx/esm --test --test-name-pattern='TASK-0195: deleteProject' host-server/db.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-017: Deleting an unrelated project does not affect a bg process with an open window in project B
- **Endpoint**: `GET /api/status`
- **Description**: Self-contained fixture, independent of the move in UAT-API-014. Project B gets a second bg process `t0195-smoke-keep` whose window is open; a third throwaway project `t0195-smoke-c` is then deleted. B's window and row must be untouched. Each command runs in its own Bash call, in order.
- **Steps**:
  1. Create project C: `curl -sS -i -X POST 'http://127.0.0.1:8788/api/projects' -H 'Content-Type: application/json' -d '{"name":"t0195-smoke-c","workdir":"/Users/davidtaylor/Repositories/tmux-conductor/tmp/t0195-smoke"}'` (expect `201 Created`)
  2. Create the open-window bg process in project B: `curl -sS -i -X POST 'http://127.0.0.1:8788/api/bg-processes' -H 'Content-Type: application/json' -d "{\"name\":\"t0195-smoke-keep\",\"workdir\":\"/Users/davidtaylor/Repositories/tmux-conductor/tmp/t0195-smoke\",\"launchCmd\":\"sleep 600\",\"projectId\":$(curl -sS 'http://127.0.0.1:8788/api/projects' | jq -r '.[] | select(.name=="t0195-smoke-b") | .id')}"` (expect `201 Created`; its slug is `t0195-smoke-b-t0195-smoke-keep`)
  3. Positive control, proves the window exists under its slug name before the delete: `tmux list-windows -t conductor -F '#{window_name}' | grep -c '^t0195-smoke-b-t0195-smoke-keep$'` (expect `1`)
  4. Delete project C: `curl -sS -i -X DELETE "http://127.0.0.1:8788/api/projects/$(curl -sS 'http://127.0.0.1:8788/api/projects' | jq -r '.[] | select(.name=="t0195-smoke-c") | .id')"` (expect `200 OK`, body `{"ok":true,"removedBgProcesses":[]}`)
  5. Run the assertion curl command below as-is
- **Command**:
  ```bash
  curl -sS 'http://127.0.0.1:8788/api/status' | jq -c '[.bgProcesses[] | select(.name=="t0195-smoke-keep") | {windowPresent, projectName}]'
  ```
- **Expected Result**: `[{"windowPresent":true,"projectName":"t0195-smoke-b"}]`, and the step 3 control printed `1`.
- **Repeatable Unit Test**: Not applicable: depends on a live tmux window
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-018: Deleting a project cascades to its bg processes
- **Endpoint**: `DELETE /api/projects/:id`
- **Description**: Project B owns `t0195-smoke-bg` (window already closed in UAT-API-014) and `t0195-smoke-keep` (window open, from UAT-API-017). The delete must remove both rows and the project in one step and report the removed names so the UI can display them.
- **Steps**:
  1. Run the curl command below as-is
- **Command**:
  ```bash
  curl -sS -i -X DELETE "http://127.0.0.1:8788/api/projects/$(curl -sS 'http://127.0.0.1:8788/api/projects' | jq -r '.[] | select(.name=="t0195-smoke-b") | .id')"
  ```
- **Expected Result**: `200 OK`, body `{"ok":true,"removedBgProcesses":[...]}` whose array holds exactly the two names `t0195-smoke-bg` and `t0195-smoke-keep`, in either order.
- **Repeatable Unit Test**: Created: `host-server/db.test.ts` (`TASK-0195: deleteProject removes the project's bg processes, returns them, and leaves other projects' bg processes alone`)
- **Unit Test Command**: `node --import tsx/esm --test --test-name-pattern='TASK-0195: deleteProject' host-server/db.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-019: The cascade closed the bg process's tmux window
- **Endpoint**: tmux session `conductor`
- **Description**: The tmux window for the removed bg process must be gone (the route kills it after the DB transaction commits). Windows are named by slug, so the grep targets the slug names, not the bare name (a bare-name grep is vacuous). `t0195-smoke-b-t0195-smoke-keep` had an open window (the UAT-API-017 step 3 control printed `1`), so a `0` here is meaningful; `t0195-smoke-b-t0195-smoke-bg` was closed earlier. `grep -c` prints the match count and exits 1 when the count is 0; a printed `0` is a pass.
- **Steps**:
  1. Run the command below as-is
- **Command**:
  ```bash
  tmux list-windows -t conductor -F '#{window_name}' | grep -c -e '^t0195-smoke-b-t0195-smoke-bg$' -e '^t0195-smoke-b-t0195-smoke-keep$'
  ```
- **Expected Result**: Output `0`.
- **Repeatable Unit Test**: Created: `host-server/db.test.ts` (static pin that the delete route contains the `kill-window` call and the `bg-${bgName}.state` unlink: `TASK-0195: index.ts requires projectId on POST /bg-processes, rejects null on PATCH, and cascades project delete`); the live window kill needs tmux
- **Unit Test Command**: `node --import tsx/esm --test --test-name-pattern='TASK-0195: index.ts requires' host-server/db.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-020: The cascade removed the bg process row
- **Endpoint**: `GET /api/status`
- **Description**: Neither `t0195-smoke-bg` nor `t0195-smoke-keep` may appear in the bg process list any more.
- **Steps**:
  1. Run the curl command below as-is
- **Command**:
  ```bash
  curl -sS 'http://127.0.0.1:8788/api/status' | jq '[.bgProcesses[] | select(.name | startswith("t0195-smoke"))] | length'
  ```
- **Expected Result**: `0`.
- **Repeatable Unit Test**: Not applicable: live HTTP + SQLite wiring (DB half covered by UAT-API-018's unit test)
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-021: No throwaway fixtures remain
- **Endpoint**: `GET /api/projects`
- **Description**: Cleanup verification. Both throwaway projects are gone.
- **Steps**:
  1. Run the curl command below as-is
  2. If the result is not `0`, delete each leftover `t0195-smoke*` project with `DELETE /api/projects/:id`, then re-run
  3. Optionally remove the scratch dir and the slug-named logs: `rm -rf /Users/davidtaylor/Repositories/tmux-conductor/tmp/t0195-smoke /Users/davidtaylor/Repositories/tmux-conductor/logs/bg-t0195-smoke-*.log`
- **Command**:
  ```bash
  curl -sS 'http://127.0.0.1:8788/api/projects' | jq '[.[] | select(.name | startswith("t0195-smoke"))] | length'
  ```
- **Expected Result**: `0`.
- **Repeatable Unit Test**: Not applicable: live environment cleanup check
- [x] Pass <!-- 2026-09-20 -->

### UAT-EDGE-001: Live database has no project-less bg processes after startup backfill
- **Scenario**: `backfillBgProcessProjects(db)` runs at every `openDb` and assigns a project to each existing `NULL` row by exact workdir match. After it has run against the live database, no bg process row should be without a project (the live DB had matching workdirs for `dev` and `dev-stack`). Strictly read-only: the query opens `./data/conductor.db` with `sqlite3 -readonly`, never writes, and does not call the live host-server. If a real unmatched row exists it is a data finding to report (the backfill leaves such rows `NULL` and only warns), not a test to weaken. Record the returned count as evidence.
- **Steps**:
  1. From the repo root, run the command below as-is
- **Command**:
  ```bash
  sqlite3 -readonly ./data/conductor.db "SELECT COUNT(*) FROM bg_processes WHERE project_id IS NULL;"
  ```
- **Expected Result**: `0`.
- **Repeatable Unit Test**: Created: `host-server/db.test.ts` (`TASK-0195: backfillBgProcessProjects ...`) and `host-server/db.migration.test.ts` (`TASK-0195: openDb backfills bg_processes.project_id by workdir; ...`)
- **Unit Test Command**: `node --import tsx/esm --test --test-name-pattern='TASK-0195: .*backfill' host-server/db.test.ts host-server/db.migration.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-EDGE-002: Backfill matches by workdir, leaves unmatched/ambiguous rows NULL, never reassigns scoped rows, is idempotent, and never fails startup
- **Scenario**: Pre-migration fixture with matched (including trailing-slash workdir), unmatched, ambiguous (two projects share a normalized workdir) and already-scoped rows. Unmatched and ambiguous rows are listed in one warning and survive; an already-scoped row whose workdir would match a different project is untouched; a second run matches nothing new; `openDb` completes.
- **Steps**:
  1. Run the unit test command below
- **Expected Result**: 2 tests pass (`backfillBgProcessProjects` unit test and the `openDb` migration-fixture test); 0 fail.
- **Repeatable Unit Test**: Created: `host-server/db.test.ts`, `host-server/db.migration.test.ts`
- **Unit Test Command**: `node --import tsx/esm --test --test-name-pattern='TASK-0195: .*backfill' host-server/db.test.ts host-server/db.migration.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-EDGE-003: A rejected project delete (agents conflict) keeps the project's bg processes
- **Scenario**: `DELETE /api/projects/:id` on a project that still has agents and no `?force=1` must fail before anything is deleted, so neither the bg rows nor their tmux windows are touched. The DB half is unit-tested (`deleteProject` throws before its transaction; bg rows survive; `force=true` then cascades). The route half is structural: `deleteProject(...)` runs first and its throw returns `409` before the window-teardown loop is reached. A live check is deliberately not included: it would need a throwaway agent whose idle window could receive a real queued task from the monitor.
- **Steps**:
  1. Run the unit test command below
- **Expected Result**: 3 tests pass (`deleteProject` cascade, `deleteProject` on an empty project, non-forced delete blocked by agents leaves bg rows); 0 fail.
- **Repeatable Unit Test**: Created: `host-server/db.test.ts` (`TASK-0195: a non-forced deleteProject blocked by agents throws before touching the project's bg processes`)
- **Unit Test Command**: `node --import tsx/esm --test --test-name-pattern='TASK-0195: (deleteProject|a non-forced)' host-server/db.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-EDGE-004: POST /bg-processes validates projectId before the tmux session check
- **Scenario**: A bad `projectId` must return 400 even when the tmux session is down (otherwise the caller would see a misleading `409 session not running`). The live server cannot be put in that state safely, so this is pinned statically: in the POST handler source, the `projectId is required` check precedes the `has-session` call.
- **Steps**:
  1. Run the unit test command below
- **Expected Result**: 1 test passes; 0 fail.
- **Repeatable Unit Test**: Created: `host-server/db.test.ts` (`TASK-0195: index.ts requires projectId on POST /bg-processes, rejects null on PATCH, and cascades project delete`)
- **Unit Test Command**: `node --import tsx/esm --test --test-name-pattern='TASK-0195: index.ts requires' host-server/db.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-UI-001: Bg process sidebar has no Unassigned group and the edit form has no Unassigned option
- **Page**: `/` (Agents page), Background processes section and a bg process's Edit form (`frontend/src/components/AgentList.tsx`)
- **Description**: Bg rows are grouped only by real project sub-headers (no `Unassigned` header), and the edit form's Project `<select>` offers only real projects (no `— Unassigned —` option). The agent-row "Unassigned" pill (`ProjectBadge`) is intentionally kept; only bg rows lost it.
- **Steps**:
  1. Run the unit test command below
- **Expected Result**: 2 vitest tests pass (`groups background processes under per-project sub-headers ... with no Unassigned group (TASK-161, TASK-0195)` and `editing workdir/launchCmd/project and saving PATCHes /bg-processes/:name ...`, which asserts no `unassigned` option); 0 fail.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx`
- **Unit Test Command**: `npm test --workspace ui -- src/components/AgentList.test.tsx -t 'TASK-0195|editing workdir/launchCmd/project'`
- [SKIP: User skipped (2 vitest cases pass, 2 passed | 259 skipped)] <!-- 2026-09-20 -->

### UAT-UI-002: Project Delete confirmation names the bg processes that will be removed
- **Page**: `http://localhost:4321/projects` (`frontend/src/components/ProjectList.tsx`)
- **Description**: Clicking Delete on a project that has bg processes shows a warning listing them before the second click confirms. **Manual**: no automated test exists for `ProjectList` (see Gaps).
- **Steps**:
  1. Create fixtures with the API (a project and one bg process; ids resolved by name):
     `curl -sS -X POST 'http://127.0.0.1:8788/api/projects' -H 'Content-Type: application/json' -d '{"name":"t0195-smoke-ui","workdir":"/Users/davidtaylor/Repositories/tmux-conductor/tmp/t0195-smoke"}'`, then `curl -sS -X POST 'http://127.0.0.1:8788/api/bg-processes' -H 'Content-Type: application/json' -d "{\"name\":\"t0195-smoke-ui-bg\",\"workdir\":\"/Users/davidtaylor/Repositories/tmux-conductor/tmp/t0195-smoke\",\"launchCmd\":\"sleep 600\",\"projectId\":$(curl -sS 'http://127.0.0.1:8788/api/projects' | jq -r '.[] | select(.name=="t0195-smoke-ui") | .id')}"`
  2. Open `http://localhost:4321/projects`
  3. On the `t0195-smoke-ui` row click **Delete** once
  4. Read the text under the row
  5. Also click Delete once on a project with NO bg processes (for example another throwaway project) and confirm no warning line appears
  6. Back on `t0195-smoke-ui`, click **Delete** (button now reads `Confirm?`), then click **Confirm?**
- **Expected Result**: After step 3 the button reads `Confirm?` and a red line reads `Deleting this project will also stop and delete 1 background process: t0195-smoke-ui-bg`. Step 5 shows no such line. After step 6 the project row disappears, no error line is shown, and `tmux list-windows -t conductor -F '#{window_name}' | grep -c '^t0195-smoke-ui-t0195-smoke-ui-bg$'` (the slug window name) prints `0`. Only throwaway projects are touched.
- **Repeatable Unit Test**: Not applicable: no component test for `ProjectList` exists; see Gaps
- [SKIP: User skipped] <!-- 2026-09-20 -->

### UAT-STATIC-001: Both workspaces typecheck clean
- **Scenario**: `BgProcess.projectId` is now `number` on the frontend, `deleteProject` in `frontend/src/lib/api.ts` returns `{ removedBgProcesses: string[] }`, and the host-server route/db changes all compile. This also guards every caller that relied on the old nullable type.
- **Steps**:
  1. Run the command below
- **Command**:
  ```bash
  npm run typecheck
  ```
- **Expected Result**: Both `host` and `frontend` typecheck tasks exit with code 0 and print no `error TS`.
- **Repeatable Unit Test**: Not applicable: static type gate, not a unit test
- [x] Pass <!-- 2026-09-20 -->

---

## Gaps

- **`ProjectList` delete-confirm text (UAT-UI-002)** is promotable to a vitest component test (mock `../lib/api`; assert the `Deleting this project will also stop and delete N background process(es): ...` line and its absence when the list is empty). It was not written because this generation run was restricted to UAT and wiki files only. Adding `frontend/src/components/ProjectList.test.tsx` would let `/uat-auto` judge UAT-UI-002 without a human.
- **Surfacing the new POST/PATCH 400 messages in the UI** is not tested: the Add and Edit forms constrain the project to a valid id, so a 400 cannot be triggered from the UI without tampering with requests. The messages themselves are covered by UAT-API-003..007 and 010..012.
- **`DELETE /api/projects/:id` with agents, live (windows survive a rejected delete)** is covered only by the unit/static tests in UAT-EDGE-003; see that case for why no live agent is spawned.
- **Bg state-file unlink on cascade** is pinned statically (UAT-API-019's unit test asserts the `bg-${bgName}.state` unlink exists) but not checked live, because a throwaway bg process may never have a state file to remove.
- **Schema-level `NOT NULL` / `ON DELETE CASCADE`** on `bg_processes.project_id` is deferred to TASK-0196 and intentionally untested here.
