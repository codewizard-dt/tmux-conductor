---
id: UAT-0196
aliases: [UAT-0196]
title: "UAT: Per-project bg process name uniqueness with a derived project-name slug identity"
status: passed
task: TASK-0196
created: 2026-09-20
updated: 2026-09-20
---

# UAT-0196 — UAT: Per-project bg process name uniqueness with a derived slug identity

implements::[[TASK-0196]]

> **Source task**: [[TASK-0196]]
> **Generated**: 2026-09-20
>
> **What changed**: `bg_processes.name` is no longer globally `UNIQUE`; `(project_id, name)` is (schema **v11**, not v10). The addressable identity is the derived slug `<projectName>-<name>`, used for the tmux window name, `$LOG_DIR/bg-<slug>.log`, `$STATE_DIR/bg-<slug>.state`, the `/bg-processes/:slug` routes, SSE payloads, `dev-commands.sh status|tail`, and the frontend. Create rejects a slug that collides with another bg slug or an agent window name (hyphen ambiguity). A `PATCH` that changes `projectId` changes the slug and is refused with 409 while the window is open.
>
> **Out of scope**: dropping `linked_agent_id` (TASK-0198); the restart route (TASK-0190); a startup rename of legacy bare-name `bg-<name>.log|state` files (decided against: left in place and ignored).

---

## Prerequisites

- [ ] Run everything from the repo root `/Users/davidtaylor/Repositories/tmux-conductor`. No `.env` file is read or written.
- [ ] **Live tests (UAT-API-*) need a host-server running the TASK-0195/0196 code.** The process on `:8788` may be a stale pre-change build. UAT-API-000 is a hard gate: if it fails, restart the host-server and re-run it; if it still fails, mark every other UAT-API test blocked. Never run UAT-API-001 onward against a stale server: old code would create bg rows and windows under bare names.
- [ ] tmux session `conductor` is alive (`GET /api/status` → `"sessionAlive": true`); the live tests spawn real windows (`sleep 600`, inert).
- [ ] Scratch directory: `mkdir -p /Users/davidtaylor/Repositories/tmux-conductor/tmp/t0196-smoke`
- [ ] No leftovers from an earlier run: no project whose name starts with `t0196-smoke` (UAT-API-024 checks this at the end; sweep with `DELETE /api/projects/:id` if needed).
- [ ] The pre-change DB backup exists: `./tmp/conductor.db.bak-task0196` (schema_version 10; 2 bg rows: `dev-stack` in project 3 `wetware`, `dev` in project 10 `davill`). The EDGE upgrade tests run on **copies** of it and never open the live `./data/conductor.db`.
- [ ] Frontend dev server on `http://localhost:4321` (only for the manual UI test).

**Safety rules for live tests.** Use only the throwaway projects `t0196-smoke`, `t0196-smoke-b`, `t0196-smoke-c` and the throwaway bg process name `dev` **inside those projects** (slugs `t0196-smoke-dev`, `t0196-smoke-b-dev`, `t0196-smoke-c-dev`). Never PATCH, DELETE, close, or restart the real `dev` (project `davill`) or `dev-stack` (project `wetware`) processes, and never send a bare `dev` to any mutating route. Ids are assigned by SQLite, so commands resolve them at run time by project name with a nested `$(curl ... | jq ...)` (a deliberate deviation from the single-`curl` rule). Errors from tests that expect a 4xx use `curl -i` so the status line is part of the evidence.

**Scenario note.** The hyphen ambiguity is exercised on purpose: project `t0196-smoke` + process `b-dev` and project `t0196-smoke-b` + process `dev` both derive the slug `t0196-smoke-b-dev`.

---

## Test Cases

### UAT-API-000: Host-server runs the TASK-0196 code (stale-server gate)
- **Endpoint**: `GET /api/status`
- **Description**: Before TASK-0196 `BgStatus` had no `slug` field. The new build gives every bg row a non-null `slug`. Read-only probe. The live DB has bg rows (`dev`, `dev-stack`), so the `length > 0` guard makes the check non-vacuous. **If this test does not return `true`, stop: mark every other UAT-API test blocked.**
- **Steps**:
  1. Run the curl command below as-is
- **Command**:
  ```bash
  curl -sS 'http://127.0.0.1:8788/api/status' | jq '(.bgProcesses | length > 0) and all(.bgProcesses[]; .slug != null)'
  ```
- **Expected Result**: `true`. `false` means the running server predates TASK-0196 (restart it).
- **Repeatable Unit Test**: Not applicable: probes the live process to detect a stale build
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-001: Create throwaway project A
- **Endpoint**: `POST /api/projects`
- **Description**: Fixture. Creates `t0196-smoke`.
- **Steps**:
  1. Run the curl command below as-is
- **Command**:
  ```bash
  curl -sS -i -X POST 'http://127.0.0.1:8788/api/projects' -H 'Content-Type: application/json' -d '{"name":"t0196-smoke","workdir":"/Users/davidtaylor/Repositories/tmux-conductor/tmp/t0196-smoke"}'
  ```
- **Expected Result**: `201 Created`; body has `"name":"t0196-smoke"` and an integer `id`.
- **Repeatable Unit Test**: Not applicable: fixture setup over real HTTP
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-002: Create throwaway project B
- **Endpoint**: `POST /api/projects`
- **Description**: Fixture. Creates `t0196-smoke-b` (its name is `t0196-smoke` plus `-b`, which sets up the hyphen collision in UAT-API-007).
- **Steps**:
  1. Run the curl command below as-is
- **Command**:
  ```bash
  curl -sS -i -X POST 'http://127.0.0.1:8788/api/projects' -H 'Content-Type: application/json' -d '{"name":"t0196-smoke-b","workdir":"/Users/davidtaylor/Repositories/tmux-conductor/tmp/t0196-smoke"}'
  ```
- **Expected Result**: `201 Created`; body has `"name":"t0196-smoke-b"` and an integer `id` different from project A's.
- **Repeatable Unit Test**: Not applicable: fixture setup over real HTTP
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-003: Create throwaway project C
- **Endpoint**: `POST /api/projects`
- **Description**: Fixture. Creates `t0196-smoke-c`, the target of the slug-changing move in UAT-API-018.
- **Steps**:
  1. Run the curl command below as-is
- **Command**:
  ```bash
  curl -sS -i -X POST 'http://127.0.0.1:8788/api/projects' -H 'Content-Type: application/json' -d '{"name":"t0196-smoke-c","workdir":"/Users/davidtaylor/Repositories/tmux-conductor/tmp/t0196-smoke"}'
  ```
- **Expected Result**: `201 Created`; body has `"name":"t0196-smoke-c"` and an integer `id`.
- **Repeatable Unit Test**: Not applicable: fixture setup over real HTTP
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-004: Create `dev` in project A (slug `t0196-smoke-dev`)
- **Endpoint**: `POST /api/bg-processes`
- **Description**: Happy path. The `201` bg object carries the derived slug and the window is spawned under it.
- **Steps**:
  1. Run the curl command below as-is
- **Command**:
  ```bash
  curl -sS -i -X POST 'http://127.0.0.1:8788/api/bg-processes' -H 'Content-Type: application/json' -d "{\"name\":\"dev\",\"workdir\":\"/Users/davidtaylor/Repositories/tmux-conductor/tmp/t0196-smoke\",\"launchCmd\":\"sleep 600\",\"projectId\":$(curl -sS 'http://127.0.0.1:8788/api/projects' | jq -r '.[] | select(.name==\"t0196-smoke\") | .id')}"
  ```
- **Expected Result**: `201 Created`; body `{"ok":true,"bg":{"slug":"t0196-smoke-dev","name":"dev", ..., "projectId":<id of t0196-smoke>}}`. A `409 session not running` means the tmux session is down: mark this and all dependent tests blocked.
- **Repeatable Unit Test**: Created: `host-server/db.test.ts` (static pin that the POST handler derives the slug and uses it for `new-window -n` and the `pipe-pane` log path: `TASK-0196: index.ts bg routes key by slug via getBgBySlug and never build bg-<name> paths`); the live spawn needs tmux and a bound port
- **Unit Test Command**: `node --import tsx/esm --test --test-name-pattern='TASK-0196: index.ts bg routes' host-server/db.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-005: Create `dev` in project B: the same name in another project is accepted
- **Endpoint**: `POST /api/bg-processes`
- **Description**: The core requirement. Before TASK-0196 the global `UNIQUE(name)` made this a 409. Now the two rows coexist under different slugs.
- **Steps**:
  1. Run the curl command below as-is
- **Command**:
  ```bash
  curl -sS -i -X POST 'http://127.0.0.1:8788/api/bg-processes' -H 'Content-Type: application/json' -d "{\"name\":\"dev\",\"workdir\":\"/Users/davidtaylor/Repositories/tmux-conductor/tmp/t0196-smoke\",\"launchCmd\":\"sleep 600\",\"projectId\":$(curl -sS 'http://127.0.0.1:8788/api/projects' | jq -r '.[] | select(.name==\"t0196-smoke-b\") | .id')}"
  ```
- **Expected Result**: `201 Created`; body `{"ok":true,"bg":{"slug":"t0196-smoke-b-dev","name":"dev", ..., "projectId":<id of t0196-smoke-b>}}`.
- **Repeatable Unit Test**: Created: `host-server/db.migration.test.ts` (schema-level: `TASK-0196: v11 rebuilds bg_processes with per-project uniqueness, ...` asserts a same name in a different project is accepted) and `host-server/db.test.ts` (`TASK-0196: getBgBySlug/listBgSlugs resolve project-scoped rows, allow the same name in two projects, ...`)
- **Unit Test Command**: `node --import tsx/esm --test --test-name-pattern='TASK-0196: (v11 rebuilds|getBgBySlug)' host-server/db.migration.test.ts host-server/db.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-006: A duplicate `dev` in the same project is rejected
- **Endpoint**: `POST /api/bg-processes`
- **Description**: Uniqueness is per `(project_id, name)`: a second `dev` in project A must be a 409 that names the slug, and must not create a row or a window.
- **Steps**:
  1. Run the curl command below as-is
- **Command**:
  ```bash
  curl -sS -i -X POST 'http://127.0.0.1:8788/api/bg-processes' -H 'Content-Type: application/json' -d "{\"name\":\"dev\",\"workdir\":\"/Users/davidtaylor/Repositories/tmux-conductor/tmp/t0196-smoke\",\"launchCmd\":\"sleep 600\",\"projectId\":$(curl -sS 'http://127.0.0.1:8788/api/projects' | jq -r '.[] | select(.name==\"t0196-smoke\") | .id')}"
  ```
- **Expected Result**: `409 Conflict`, body `{"error":"bg process 'dev' already defined in this project (slug 't0196-smoke-dev')"}`.
- **Repeatable Unit Test**: Created: `host-server/db.migration.test.ts` (`TASK-0196: v11 rebuilds ...` asserts a same-`(project, name)` insert throws `UNIQUE`); the route message is pinned only by the live call
- **Unit Test Command**: `node --import tsx/esm --test --test-name-pattern='TASK-0196: v11 rebuilds' host-server/db.migration.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-007: A hyphen-ambiguous slug collision is rejected
- **Endpoint**: `POST /api/bg-processes`
- **Description**: Project A (`t0196-smoke`) has no process called `b-dev`, so the per-project check passes, but the derived slug `t0196-smoke-b-dev` equals project B's `dev` slug. Create must reject it with the slug-collision message, and must not spawn a window (which would clash in the shared tmux namespace).
- **Steps**:
  1. Run the curl command below as-is
- **Command**:
  ```bash
  curl -sS -i -X POST 'http://127.0.0.1:8788/api/bg-processes' -H 'Content-Type: application/json' -d "{\"name\":\"b-dev\",\"workdir\":\"/Users/davidtaylor/Repositories/tmux-conductor/tmp/t0196-smoke\",\"launchCmd\":\"sleep 600\",\"projectId\":$(curl -sS 'http://127.0.0.1:8788/api/projects' | jq -r '.[] | select(.name==\"t0196-smoke\") | .id')}"
  ```
- **Expected Result**: `409 Conflict`, body `{"error":"slug 't0196-smoke-b-dev' collides with an existing bg process or agent window"}`.
- **Repeatable Unit Test**: Created: `host-server/db.test.ts` (`TASK-0196: bgSlugCollides flags an equal bg slug or agent window name and nothing else` and `TASK-0196: bgSlugCollides catches the hyphen ambiguity against real DB slugs and agent windows`, plus the static route pin that POST calls `bgSlugCollides(slug, listBgSlugs(db), ...)`)
- **Unit Test Command**: `node --import tsx/esm --test --test-name-pattern='TASK-0196: (bgSlugCollides|index.ts bg routes)' host-server/db.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-008: Status lists both same-named rows under distinct slugs, windows, and log files
- **Endpoint**: `GET /api/status`
- **Description**: `BgStatus` gains `slug`; `name` stays the display label; `logPath` is `bg-<slug>.log`; each row's window is looked up by slug, so both read present. The failed creates in UAT-API-006/007 must have added nothing.
- **Steps**:
  1. Run the curl command below as-is
- **Command**:
  ```bash
  curl -sS 'http://127.0.0.1:8788/api/status' | jq -c '[.bgProcesses[] | select(.slug | startswith("t0196-smoke")) | {slug, name, projectName, windowPresent, logFile: (.logPath | split("/") | last)}] | sort_by(.slug)'
  ```
- **Expected Result**: exactly `[{"slug":"t0196-smoke-b-dev","name":"dev","projectName":"t0196-smoke-b","windowPresent":true,"logFile":"bg-t0196-smoke-b-dev.log"},{"slug":"t0196-smoke-dev","name":"dev","projectName":"t0196-smoke","windowPresent":true,"logFile":"bg-t0196-smoke-dev.log"}]`
- **Repeatable Unit Test**: Not applicable: live HTTP + tmux window inventory (`buildBgStatuses` is not exported and needs a live session)
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-009: tmux has one window per slug, and no bare-name window
- **Endpoint**: tmux session `conductor`
- **Description**: The window names are the slugs. Only windows starting with `t0196-smoke` are listed, so the real `dev` window is not touched or shown.
- **Steps**:
  1. Run the command below as-is
- **Command**:
  ```bash
  tmux list-windows -t conductor -F '#{window_name}' | grep '^t0196-smoke' | sort
  ```
- **Expected Result**: exactly two lines: `t0196-smoke-b-dev` and `t0196-smoke-dev`.
- **Repeatable Unit Test**: Not applicable: depends on live tmux windows (the `-n ${slug}` naming is pinned statically by UAT-API-004's test)
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-010: Each slug gets its own log file
- **Endpoint**: `$LOG_DIR` (`./logs`)
- **Description**: `pipe-pane` writes `bg-<slug>.log`, never `bg-dev.log` for the new processes. (A pre-existing legacy `bg-dev.log` may already be present from the real `dev` process; it is ignored here because the filter only lists `t0196-smoke` files.)
- **Steps**:
  1. Run the command below as-is
- **Command**:
  ```bash
  ls /Users/davidtaylor/Repositories/tmux-conductor/logs | grep '^bg-t0196-smoke' | sort
  ```
- **Expected Result**: exactly two lines: `bg-t0196-smoke-b-dev.log` and `bg-t0196-smoke-dev.log`.
- **Repeatable Unit Test**: Created: `host-server/db.test.ts` (static pin that the route builds `bg-${slug}.log` and never `bg-${bg.name}`: `TASK-0196: index.ts bg routes key by slug via getBgBySlug and never build bg-<name> paths`)
- **Unit Test Command**: `node --import tsx/esm --test --test-name-pattern='TASK-0196: index.ts bg routes' host-server/db.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-011: `GET /bg-processes/:slug/tail` resolves by slug and returns `slug` and `name`
- **Endpoint**: `GET /api/bg-processes/:slug/tail`
- **Description**: A registered slug whose log has no output yet still returns 200. The payload now includes `slug` alongside `name`.
- **Steps**:
  1. Run the curl command below as-is
- **Command**:
  ```bash
  curl -sS 'http://127.0.0.1:8788/api/bg-processes/t0196-smoke-b-dev/tail?lines=5' | jq -c '{slug, name, isArray: (.lines | type == "array")}'
  ```
- **Expected Result**: `{"slug":"t0196-smoke-b-dev","name":"dev","isArray":true}`.
- **Repeatable Unit Test**: Not applicable: live HTTP; the route registration is pinned by UAT-API-004's static test
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-012: A bare name is not a slug and returns 404
- **Endpoint**: `GET /api/bg-processes/:slug/tail`
- **Description**: The route param is the slug. A bare `dev` matches no registered slug (every row has a project), so it must be a 404 and must not fall back to a name lookup. **Read-only GET**: the real `dev` is not affected. Never send a bare name to a mutating route.
- **Steps**:
  1. Run the curl command below as-is
- **Command**:
  ```bash
  curl -sS -i 'http://127.0.0.1:8788/api/bg-processes/dev/tail'
  ```
- **Expected Result**: `404 Not Found`, body `{"error":"bg process 'dev' not found"}`.
- **Repeatable Unit Test**: Created: `host-server/db.test.ts` (`TASK-0196: getBgBySlug/listBgSlugs resolve project-scoped rows, ...` asserts `getBgBySlug(db, 'dev')` is `undefined` once the row has a project)
- **Unit Test Command**: `node --import tsx/esm --test --test-name-pattern='TASK-0196: getBgBySlug' host-server/db.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-013: The SSE snapshot carries `slug` on bg updates
- **Endpoint**: `GET /api/events` (SSE)
- **Description**: On connect the server replays a `bg-update` per bg process. Its payload must include the slug so clients can key by it. `curl --max-time 3` ends the stream, so its own exit code (28) is expected; only the counted output is judged.
- **Steps**:
  1. Run the command below as-is
- **Command**:
  ```bash
  curl -sN --max-time 3 'http://127.0.0.1:8788/api/events' | grep -c '"slug":"t0196-smoke-dev"'
  ```
- **Expected Result**: an integer `>= 1`. `0` means the snapshot carries no slug.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (client half: `bg-update merges by slug ...` and `bg-removed removes only the row whose slug matches ...`); the server SSE payload needs a live server
- **Unit Test Command**: `npm test --workspace ui -- src/components/AgentList.test.tsx -t 'TASK-0196'`
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-014: `dev-commands.sh list` prints slugs
- **Endpoint**: `skills/dev-commands/scripts/dev-commands.sh list`
- **Description**: The skill script lists `.bgProcesses[].slug`. Only the throwaway rows are counted, so the real rows are not judged.
- **Steps**:
  1. Run the command below as-is
- **Command**:
  ```bash
  CONDUCTOR_STATE_DIR=/Users/davidtaylor/Repositories/tmux-conductor/logs/state CONDUCTOR_LOG_DIR=/Users/davidtaylor/Repositories/tmux-conductor/logs bash /Users/davidtaylor/Repositories/tmux-conductor/skills/dev-commands/scripts/dev-commands.sh list | grep -c '^t0196-smoke-\(b-\)\{0,1\}dev '
  ```
- **Expected Result**: `2` (the lines `t0196-smoke-dev — state: ...` and `t0196-smoke-b-dev — state: ...`).
- **Repeatable Unit Test**: Created: `scripts/verify-dev-commands.sh` (fixture-only shell checks for slug resolution: exact slug, unique-suffix bare name, ambiguous exit 2, unknown exit 1; see UAT-STATIC-002); the live `list` wiring needs the running server
- **Unit Test Command**: `bash scripts/verify-dev-commands.sh`
- [SKIP: User skipped; earlier auto-judge failure: command printed 0, expected 2 — `dev-commands.sh list` is now project-scoped (defaults to the caller's project, here tmux-conductor, and prints "No background processes registered for project tmux-conductor"); `list --all` does show both slugs t0196-smoke-dev and t0196-smoke-b-dev, so the slug behavior is correct and the UAT command is stale after TASK-0194/0197 scoping] <!-- 2026-09-20 -->

### UAT-API-015: PATCH by slug edits metadata while the window is open
- **Endpoint**: `PATCH /api/bg-processes/:slug`
- **Description**: A change that does not alter the slug (no `projectId` change) is allowed with the window open. The route is keyed by slug and writes SQLite only (it never restarts the window).
- **Steps**:
  1. Run the curl command below as-is
- **Command**:
  ```bash
  curl -sS -X PATCH 'http://127.0.0.1:8788/api/bg-processes/t0196-smoke-dev' -H 'Content-Type: application/json' -d '{"launchCmd":"sleep 601"}' | jq -c '{name, launchCmd}'
  ```
- **Expected Result**: `{"name":"dev","launchCmd":"sleep 601"}`.
- **Repeatable Unit Test**: Not applicable: live HTTP + SQLite wiring
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-016: Changing the project while the window is open is rejected (409)
- **Endpoint**: `PATCH /api/bg-processes/:slug`
- **Description**: Moving `t0196-smoke-dev` to project C would change its slug to `t0196-smoke-c-dev`, but the running window keeps the old name. The window-open check fires first, so this is a 409 with the "close the window first" message, and the row is unchanged.
- **Steps**:
  1. Run the curl command below as-is
- **Command**:
  ```bash
  curl -sS -i -X PATCH 'http://127.0.0.1:8788/api/bg-processes/t0196-smoke-dev' -H 'Content-Type: application/json' -d "{\"projectId\":$(curl -sS 'http://127.0.0.1:8788/api/projects' | jq -r '.[] | select(.name==\"t0196-smoke-c\") | .id')}"
  ```
- **Expected Result**: `409 Conflict`, body `{"error":"cannot change project while window 't0196-smoke-dev' is open: close the window first (the slug would change to 't0196-smoke-c-dev')"}`.
- **Repeatable Unit Test**: Created: `host-server/db.test.ts` (static pin that the PATCH body contains the `cannot change project while window` message and a `status(409)`: `TASK-0196: index.ts bg routes key by slug via getBgBySlug and never build bg-<name> paths`); the live ordering (window-open check before collision check) is only judged live
- **Unit Test Command**: `node --import tsx/esm --test --test-name-pattern='TASK-0196: index.ts bg routes' host-server/db.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-017: Close the window by slug
- **Endpoint**: `DELETE /api/bg-processes/:slug/window`
- **Description**: The inverse of the recreate route; keyed by slug. Only project A's throwaway window is closed.
- **Steps**:
  1. Run the curl command below as-is
- **Command**:
  ```bash
  curl -sS -i -X DELETE 'http://127.0.0.1:8788/api/bg-processes/t0196-smoke-dev/window'
  ```
- **Expected Result**: `200 OK`, body `{"ok":true,"closed":"t0196-smoke-dev"}`. Afterwards `tmux list-windows -t conductor -F '#{window_name}' | grep -c '^t0196-smoke-dev$'` prints `0`, while `t0196-smoke-b-dev` is still present.
- **Repeatable Unit Test**: Not applicable: kills a real tmux window over HTTP (the slug keying is pinned by UAT-API-004's static test)
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-018: A move whose target slug collides is rejected even with the window closed
- **Endpoint**: `PATCH /api/bg-processes/:slug`
- **Description**: With the window closed, moving A's `dev` into project B would yield slug `t0196-smoke-b-dev`, which already belongs to B's `dev` (and would also violate `(project_id, name)`). It must be a 409 with the slug-collision message and leave the row in project A.
- **Steps**:
  1. Run the curl command below as-is
- **Command**:
  ```bash
  curl -sS -i -X PATCH 'http://127.0.0.1:8788/api/bg-processes/t0196-smoke-dev' -H 'Content-Type: application/json' -d "{\"projectId\":$(curl -sS 'http://127.0.0.1:8788/api/projects' | jq -r '.[] | select(.name==\"t0196-smoke-b\") | .id')}"
  ```
- **Expected Result**: `409 Conflict`, body `{"error":"slug 't0196-smoke-b-dev' collides with an existing bg process or agent window"}`.
- **Repeatable Unit Test**: Created: `host-server/db.test.ts` (`TASK-0196: bgSlugCollides catches the hyphen ambiguity against real DB slugs and agent windows`, the predicate the PATCH route calls); the route ordering is judged live
- **Unit Test Command**: `node --import tsx/esm --test --test-name-pattern='TASK-0196: bgSlugCollides' host-server/db.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-019: A slug-changing move with the window closed is a metadata-only rename
- **Endpoint**: `PATCH /api/bg-processes/:slug`
- **Description**: Moving A's `dev` to project C (no `dev` there, no slug collision) is allowed because the window is closed. The response is the updated definition with the new `projectId`.
- **Steps**:
  1. Run the curl command below as-is
- **Command**:
  ```bash
  curl -sS -X PATCH 'http://127.0.0.1:8788/api/bg-processes/t0196-smoke-dev' -H 'Content-Type: application/json' -d "{\"projectId\":$(curl -sS 'http://127.0.0.1:8788/api/projects' | jq -r '.[] | select(.name==\"t0196-smoke-c\") | .id')}" | jq -c '{name, projectId}'
  ```
- **Expected Result**: `{"name":"dev","projectId":<id of t0196-smoke-c>}`.
- **Repeatable Unit Test**: Not applicable: live HTTP + SQLite + window-state ordering
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-020: After the move the old slug is gone and the new slug is listed with no window
- **Endpoint**: `GET /api/status` and `GET /api/bg-processes/:slug/tail`
- **Description**: The row is now `t0196-smoke-c-dev`; its window does not exist (the old one was closed and nothing renamed a legacy one). The old slug must no longer resolve.
- **Steps**:
  1. Run the first command below as-is
  2. Run the second command below as-is
- **Command**:
  ```bash
  curl -sS 'http://127.0.0.1:8788/api/status' | jq -c '[.bgProcesses[] | select(.slug | startswith("t0196-smoke-c")) | {slug, projectName, windowPresent}]'
  ```
  ```bash
  curl -sS -i 'http://127.0.0.1:8788/api/bg-processes/t0196-smoke-dev/tail'
  ```
- **Expected Result**: Step 1 prints `[{"slug":"t0196-smoke-c-dev","projectName":"t0196-smoke-c","windowPresent":false}]`. Step 2 returns `404 Not Found`, body `{"error":"bg process 't0196-smoke-dev' not found"}`.
- **Repeatable Unit Test**: Not applicable: live HTTP + tmux window inventory
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-021: Recreate the window under the new slug
- **Endpoint**: `POST /api/bg-processes/:slug/window`
- **Description**: This is the documented way to recover after a slug change or an upgrade (existing bare-name windows are not matched and must be recreated). The window and log take the new slug.
- **Steps**:
  1. Run the curl command below as-is
  2. Run the tmux command below as-is
- **Command**:
  ```bash
  curl -sS -i -X POST 'http://127.0.0.1:8788/api/bg-processes/t0196-smoke-c-dev/window'
  ```
  ```bash
  tmux list-windows -t conductor -F '#{window_name}' | grep '^t0196-smoke' | sort
  ```
- **Expected Result**: Step 1 returns `201 Created`, body `{"ok":true,"bg":{"slug":"t0196-smoke-c-dev","name":"dev", ...}}`. Step 2 prints exactly two lines: `t0196-smoke-b-dev` and `t0196-smoke-c-dev` (and no `t0196-smoke-dev`).
- **Repeatable Unit Test**: Not applicable: spawns a real tmux window over HTTP
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-022: Delete a bg process by slug
- **Endpoint**: `DELETE /api/bg-processes/:slug`
- **Description**: Kills the window, deletes the row, and unlinks `bg-<slug>.state`. Only project B's throwaway `dev` is deleted; project C's `dev` (a different row with the same name) must survive.
- **Steps**:
  1. Run the curl command below as-is
  2. Run the tmux command below as-is
- **Command**:
  ```bash
  curl -sS -i -X DELETE 'http://127.0.0.1:8788/api/bg-processes/t0196-smoke-b-dev'
  ```
  ```bash
  tmux list-windows -t conductor -F '#{window_name}' | grep '^t0196-smoke' | sort
  ```
- **Expected Result**: Step 1 returns `200 OK`, body `{"ok":true,"removed":"t0196-smoke-b-dev"}`. Step 2 prints exactly one line: `t0196-smoke-c-dev`.
- **Repeatable Unit Test**: Not applicable: kills a real window over HTTP (the slug keying is pinned by UAT-API-004's static test)
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-023: Deleting a project cascades to its bg processes and closes their slug-named windows
- **Endpoint**: `DELETE /api/projects/:id`
- **Description**: Project C owns `dev` (slug `t0196-smoke-c-dev`, window open). The route must delete the row and project atomically, return the removed process **names** (bare, per the task's contract), and kill the window by its **slug** (the project name is captured before the delete).
- **Steps**:
  1. Run the curl command below as-is
  2. Run the tmux command below as-is
- **Command**:
  ```bash
  curl -sS -i -X DELETE "http://127.0.0.1:8788/api/projects/$(curl -sS 'http://127.0.0.1:8788/api/projects' | jq -r '.[] | select(.name=="t0196-smoke-c") | .id')"
  ```
  ```bash
  tmux list-windows -t conductor -F '#{window_name}' | grep -c '^t0196-smoke'
  ```
- **Expected Result**: Step 1 returns `200 OK`, body `{"ok":true,"removedBgProcesses":["dev"]}`. Step 2 prints `0` (the `grep -c` exit status 1 for zero matches is fine).
- **Repeatable Unit Test**: Created: `host-server/db.test.ts` (`TASK-0195: deleteProject removes the project's bg processes, returns them, and leaves other projects' bg processes alone`, plus the static pin that the delete route kills the window and unlinks `bg-${slug}.state`)
- **Unit Test Command**: `node --import tsx/esm --test --test-name-pattern='TASK-0195: (deleteProject|index.ts requires)' host-server/db.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-024: Clean up the remaining throwaway projects and verify nothing is left
- **Endpoint**: `DELETE /api/projects/:id` and `GET /api/projects`
- **Description**: Deletes projects A and B (both now have no bg processes, so `removedBgProcesses` is empty), then confirms no fixture project or bg row remains.
- **Steps**:
  1. Run the first command (project A), expect `{"ok":true,"removedBgProcesses":[]}`
  2. Run the second command (project B), expect `{"ok":true,"removedBgProcesses":[]}`
  3. Run the third command (verification)
  4. Optionally remove scratch files: `rm -rf /Users/davidtaylor/Repositories/tmux-conductor/tmp/t0196-smoke` and the `logs/bg-t0196-smoke-*.log` files
- **Command**:
  ```bash
  curl -sS -X DELETE "http://127.0.0.1:8788/api/projects/$(curl -sS 'http://127.0.0.1:8788/api/projects' | jq -r '.[] | select(.name=="t0196-smoke") | .id')"
  ```
  ```bash
  curl -sS -X DELETE "http://127.0.0.1:8788/api/projects/$(curl -sS 'http://127.0.0.1:8788/api/projects' | jq -r '.[] | select(.name=="t0196-smoke-b") | .id')"
  ```
  ```bash
  curl -sS 'http://127.0.0.1:8788/api/status' | jq -c '{fixtureBg: [.bgProcesses[] | select(.slug | startswith("t0196-smoke"))] | length}'
  ```
- **Expected Result**: Steps 1 and 2 each print `{"ok":true,"removedBgProcesses":[]}`. Step 3 prints `{"fixtureBg":0}`, and `GET /api/projects` has no project whose name starts with `t0196-smoke`. The real `dev` and `dev-stack` rows are still listed.
- **Repeatable Unit Test**: Not applicable: live environment cleanup check
- [x] Pass <!-- 2026-09-20 -->

### UAT-EDGE-001: Schema v11 rebuild preserves rows, swaps global uniqueness for per-project, enforces NOT NULL and cascade
- **Scenario**: A faithful post-v10 fixture (real v1 `name TEXT NOT NULL UNIQUE CHECK (GLOB)` shape, `legacy_import='1'`) with three rows, one with a `NULL` project whose workdir matches a project (trailing slash). After `openDb`: `schema_version >= 11`; `project_id` is `NOT NULL`; every column and `id` preserved (the `NULL` row backfilled to its project); only `idx_bg_processes_project_name` remains; no `bg_processes_v11` temp table; `foreign_key_check` clean; a same name in another project accepted; a same `(project, name)` rejected (`UNIQUE`); a `NULL`-project insert rejected (`NOT NULL`); the `GLOB` name `CHECK` survives; `linked_agent_id` still `ON DELETE SET NULL`; deleting a project cascades to its bg rows; a reopen is a no-op.
- **Steps**:
  1. Run the unit test command below
- **Expected Result**: 2 tests pass (this case plus UAT-EDGE-002 share the pattern); 0 fail.
- **Repeatable Unit Test**: Created: `host-server/db.migration.test.ts` (`TASK-0196: v11 rebuilds bg_processes with per-project uniqueness, NOT NULL project_id and cascade, preserving every row`)
- **Unit Test Command**: `node --import tsx/esm --test --test-name-pattern='TASK-0196: v11' host-server/db.migration.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-EDGE-002: v11 never fails startup on unmatched NULL-project rows; NOT NULL is deferred and enforced later
- **Scenario**: A pre-v11 DB with a `NULL`-project row whose workdir matches no project (`orphan`). `openDb` must not throw; `schema_version` becomes 11 with `project_id` still nullable and a partial unique index keeping `NULL`-project names unique; the unmatched row is named in a warning and survives intact; per-project uniqueness works meanwhile. After the operator assigns the row to a project, the **next** `openDb` promotes the column to `NOT NULL` (`enforceBgProjectRequired`), drops the partial index, and leaves `schema_version` unchanged.
- **Steps**:
  1. Run the unit test command below
- **Expected Result**: 1 test passes; 0 fail.
- **Repeatable Unit Test**: Created: `host-server/db.migration.test.ts` (`TASK-0196: v11 never fails startup on unmatched NULL-project rows; it keeps project_id nullable (partial unique index) and enforces NOT NULL on a later open once resolved`)
- **Unit Test Command**: `node --import tsx/esm --test --test-name-pattern='TASK-0196: v11 never fails startup' host-server/db.migration.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-EDGE-003: v11 upgrade of a COPY of the real pre-change DB
- **Scenario**: The pre-change backup is a real v10 DB with 2 bg rows (`dev-stack` in project 3 `wetware`, `dev` in project 10 `davill`, both with a project). `openDb` on a copy must migrate to v11 with `project_id NOT NULL`, keep both rows and ids, leave only the per-project unique index, and expose the slugs `davill-dev` and `wetware-dev-stack`; a bare `dev` must not resolve. The live DB is never opened. The `confPath:` line printed by the host-server config module is noise; only the last output line (JSON) is judged.
- **Steps**:
  1. Refresh the copy: `rm -f ./tmp/t0196-uat.db ./tmp/t0196-uat.db-wal ./tmp/t0196-uat.db-shm && cp ./tmp/conductor.db.bak-task0196 ./tmp/t0196-uat.db`
  2. Run the command below as-is
- **Command**:
  ```bash
  node --import tsx/esm --input-type=module -e "import { openDb, listBgSlugs, getBgBySlug } from './host-server/db.ts'; const db = openDb('./tmp/t0196-uat.db'); const one = (q) => db.prepare(q).get(); console.log(JSON.stringify({ version: one(\"select value from meta where key='schema_version'\").value, slugs: listBgSlugs(db).sort(), notNull: db.pragma('table_info(bg_processes)').find((c) => c.name === 'project_id').notnull, indexes: db.pragma('index_list(bg_processes)').map((i) => i.name).filter((n) => !n.startsWith('sqlite_autoindex')), rows: db.prepare('select id,name,workdir,launch_cmd,linked_agent_id,project_id from bg_processes order by id').all(), davill: getBgBySlug(db, 'davill-dev')?.id, bare: getBgBySlug(db, 'dev') ?? null })); db.close()" | tail -n 1
  ```
- **Expected Result**: exactly `{"version":"11","slugs":["davill-dev","wetware-dev-stack"],"notNull":1,"indexes":["idx_bg_processes_project_name"],"rows":[{"id":1,"name":"dev-stack","workdir":"/Users/davidtaylor/Repositories/gauntlet/wetware-factory","launch_cmd":"make dev","linked_agent_id":null,"project_id":3},{"id":2,"name":"dev","workdir":"/Users/davidtaylor/Repositories/davill","launch_cmd":"npm run dev","linked_agent_id":null,"project_id":10}],"davill":2,"bare":null}`. (Verified against the backup at generation time.)
- **Repeatable Unit Test**: Created: `host-server/db.migration.test.ts` (`TASK-0196: v11 rebuilds ...`, the fixture-based equivalent; this case adds the real-data shape)
- **Unit Test Command**: `node --import tsx/esm --test --test-name-pattern='TASK-0196: v11 rebuilds' host-server/db.migration.test.ts`
- [SKIP: User skipped; earlier auto-judge failure: command errored with "SqliteError: no such column: linked_agent_id" and expected `"version":"11"`; on the current tree openDb migrates the copy on to schema v12 (TASK-0198 dropped bg_processes.linked_agent_id). Same command minus that column shows version "12", slugs ["davill-dev","wetware-dev-stack"], notNull 1, single idx_bg_processes_project_name, ids 1/2 and project_ids 3/10 preserved, bare 'dev' null — the v11 behavior is intact, the UAT command is stale after TASK-0198] <!-- 2026-09-20 -->

### UAT-EDGE-004: On the migrated copy, cross-project duplicates are accepted and the DB enforces the per-project and NOT NULL rules
- **Scenario**: Continues UAT-EDGE-003 on the same copy (`./tmp/t0196-uat.db`, already v11). A second `dev` in a different project (project 1 `tmux-conductor`) inserts fine; a second `dev` in project 10 fails on the `(project_id, name)` unique index; a `NULL`-project row fails `NOT NULL`. Finally the copy is removed and the backup is confirmed untouched (still schema 10).
- **Steps**:
  1. Cross-project duplicate: `sqlite3 ./tmp/t0196-uat.db "INSERT INTO bg_processes (name, workdir, launch_cmd, project_id) VALUES ('dev','/Users/davidtaylor/Repositories/tmux-conductor','sleep 1',1)"` → no output, exit 0
  2. Same-project duplicate: `sqlite3 ./tmp/t0196-uat.db "INSERT INTO bg_processes (name, workdir, launch_cmd, project_id) VALUES ('dev','/Users/davidtaylor/Repositories/davill','sleep 1',10)"` → `UNIQUE constraint failed: bg_processes.project_id, bg_processes.name`
  3. Project-less row: `sqlite3 ./tmp/t0196-uat.db "INSERT INTO bg_processes (name, workdir, launch_cmd, project_id) VALUES ('x','/tmp','sleep 1',NULL)"` → `NOT NULL constraint failed: bg_processes.project_id`
  4. Cleanup: `rm -f ./tmp/t0196-uat.db ./tmp/t0196-uat.db-wal ./tmp/t0196-uat.db-shm`
  5. Run the command below as-is
- **Command**:
  ```bash
  sqlite3 ./tmp/conductor.db.bak-task0196 "select value from meta where key='schema_version'"
  ```
- **Expected Result**: Step 1 succeeds silently. Step 2 fails with the `UNIQUE` message above. Step 3 fails with the `NOT NULL` message above. Step 5 prints `10` (the backup was never modified).
- **Repeatable Unit Test**: Created: `host-server/db.migration.test.ts` (`TASK-0196: v11 rebuilds ...` asserts the same three rules on a fixture)
- **Unit Test Command**: `node --import tsx/esm --test --test-name-pattern='TASK-0196: v11 rebuilds' host-server/db.migration.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-EDGE-005: `seedFromLegacy` seeds only bg rows whose workdir matches exactly one project, and skips the rest with a warning
- **Scenario**: `seedFromLegacy` (conf-driven legacy import) can no longer insert a project-less bg row. Given a scratch conf with two conf bg entries (`seedok` whose workdir equals project 3 `wetware`'s workdir, `seedmiss` whose workdir matches nothing) and a copy of the backup with the `legacy_import` guard removed, `openDb` must seed `seedok` into project 3, skip `seedmiss` with a warning naming it, keep the two existing rows, and set the guard. The real `conductor.conf` and DB are never used (`CONDUCTOR_CONF` points at the scratch conf).
- **Steps**:
  1. Create the scratch conf: `printf 'SESSION_NAME=t0196-seed\nSTATE_DIR=./state\nLOG_DIR=./logs\nDB_PATH=./t0196-seed.db\nBG_PROCESSES=("seedok:/Users/davidtaylor/Repositories/gauntlet/wetware-factory:sleep 1" "seedmiss:/w/nowhere:sleep 1")\n' > ./tmp/t0196-seed.conf`
  2. Create the DB copy without the guard: `rm -f ./tmp/t0196-seed.db ./tmp/t0196-seed.db-wal ./tmp/t0196-seed.db-shm && cp ./tmp/conductor.db.bak-task0196 ./tmp/t0196-seed.db && sqlite3 ./tmp/t0196-seed.db "DELETE FROM meta WHERE key='legacy_import'"`
  3. Run the command below as-is
  4. Query the result: `sqlite3 ./tmp/t0196-seed.db "select id, name, project_id from bg_processes order by id; select value from meta where key='legacy_import'"`
  5. Cleanup: `rm -f ./tmp/t0196-seed.db ./tmp/t0196-seed.db-wal ./tmp/t0196-seed.db-shm ./tmp/t0196-seed.conf`
- **Command**:
  ```bash
  CONDUCTOR_CONF=./tmp/t0196-seed.conf node --import tsx/esm --input-type=module -e "import { openDb } from './host-server/db.ts'; openDb('./tmp/t0196-seed.db').close()" 2>&1 | grep -E 'seedFromLegacy|Legacy import'
  ```
- **Expected Result**: Step 3 prints two lines: `[conductor] seedFromLegacy: skipping bg process 'seedmiss' — no unique project matches workdir /w/nowhere; add it via the dashboard once its project exists` and `[conductor] Legacy import complete — agents: 0`. Step 4 prints exactly `1|dev-stack|3`, `2|dev|10`, `3|seedok|3`, then `1`; no `seedmiss` row.
- **Repeatable Unit Test**: Blocked: promotable in principle (deterministic, no server), but `seedFromLegacy` is not exported and reads `conductor.conf` through `readConductorConf`; a test needs either an export or a `CONDUCTOR_CONF` fixture harness plus a source or test-file change, which this generation run was not permitted to make (see Gaps)
- [x] Pass <!-- 2026-09-20 -->

### UAT-EDGE-006: Slug rule and DB lookup helpers
- **Scenario**: `bgSlug(bg, projectName)` returns `<projectName>-<name>` (hyphens legal on both sides), falling back to the bare name when there is no project, and different `(project, name)` pairs can produce one slug (`dev` + `stack` versus null + `dev-stack`). `getBgBySlug`/`listBgSlugs` resolve project-scoped rows (returning `projectName`), allow the same name in two projects, reject a same-project duplicate, return `undefined` for a bare name once the row has a project, and (deferred-nullable state) use the bare name for a project-less legacy row while keeping its name unique via the partial index.
- **Steps**:
  1. Run the unit test command below
- **Expected Result**: 3 tests pass (`bgSlug` prefixes, `getBgBySlug/listBgSlugs` project-scoped, `getBgBySlug/listBgSlugs` project-less legacy row); 0 fail.
- **Repeatable Unit Test**: Created: `host-server/db.test.ts` (`TASK-0196: bgSlug prefixes the project name, ...`; `TASK-0196: getBgBySlug/listBgSlugs resolve project-scoped rows, ...`; `TASK-0196: getBgBySlug/listBgSlugs use the bare name for a project-less legacy row`)
- **Unit Test Command**: `node --import tsx/esm --test --test-name-pattern='TASK-0196: (bgSlug prefixes|getBgBySlug)' host-server/db.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-EDGE-007: Slug-collision predicate
- **Scenario**: `bgSlugCollides(slug, bgSlugs, agentWindowNames)` is true only when the candidate equals an existing bg slug or an agent window name (prefix/suffix overlap is not a collision, any iterable is accepted), and against a real DB it catches the hyphen ambiguity (`dev-stack` in a project named `task196c`, and a bg process whose slug equals an agent window `agent1`) while accepting a unique name.
- **Steps**:
  1. Run the unit test command below
- **Expected Result**: 2 tests pass; 0 fail.
- **Repeatable Unit Test**: Created: `host-server/db.test.ts` (`TASK-0196: bgSlugCollides flags an equal bg slug or agent window name and nothing else`; `TASK-0196: bgSlugCollides catches the hyphen ambiguity against real DB slugs and agent windows`)
- **Unit Test Command**: `node --import tsx/esm --test --test-name-pattern='TASK-0196: bgSlugCollides' host-server/db.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-EDGE-008: A fresh database is created NOT NULL + cascade
- **Scenario**: A brand-new DB (no legacy rows, so no deferral) has `bg_processes.project_id NOT NULL`: a project-less insert throws `NOT NULL`, and a raw `DELETE FROM projects` cascades to the project's bg rows at the schema level (not via `deleteProject`).
- **Steps**:
  1. Run the unit test command below
- **Expected Result**: 1 test passes; 0 fail.
- **Repeatable Unit Test**: Created: `host-server/db.test.ts` (`TASK-0196: a fresh DB makes bg_processes.project_id NOT NULL and cascades project deletes at the schema level`)
- **Unit Test Command**: `node --import tsx/esm --test --test-name-pattern='TASK-0196: a fresh DB' host-server/db.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-EDGE-009: Every bg route is keyed by slug, and no route or path builds a `bg-<name>` identity
- **Scenario**: Static pin over `host-server/index.ts` (the routes cannot be exercised in a unit test because the module binds a port on import): no `listBgProcesses(db).find(` name lookups; no `bg-${name}` / `bg-${bg.name}` paths; no `/bg-processes/:name` routes; `/bg-processes/:slug`, `/window` and `/tail` present; POST uses `bgSlugCollides(slug, listBgSlugs(db), ...)`, a per-project `listBgProcesses(db, { projectId })` duplicate check, `-n ${slug}` and `bg-${slug}.log`; PATCH contains the `cannot change project while window` 409.
- **Steps**:
  1. Run the unit test command below
- **Expected Result**: 1 test passes; 0 fail.
- **Repeatable Unit Test**: Created: `host-server/db.test.ts` (`TASK-0196: index.ts bg routes key by slug via getBgBySlug and never build bg-<name> paths`)
- **Unit Test Command**: `node --import tsx/esm --test --test-name-pattern='TASK-0196: index.ts bg routes' host-server/db.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-EDGE-010: The complete host-server DB suites still pass
- **Scenario**: Regression guard for the v11 rebuild against every earlier migration test and DB helper (project delete cascade, backfill, task queue, agents).
- **Steps**:
  1. Run the unit test command below
- **Expected Result**: all tests pass (62 at generation time, `fail 0`); the count may grow.
- **Repeatable Unit Test**: Created: `host-server/db.test.ts` and `host-server/db.migration.test.ts`
- **Unit Test Command**: `node --import tsx/esm --test host-server/db.test.ts host-server/db.migration.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-EDGE-011: Legacy bare-name log/state files are left in place and documented, not renamed
- **Scenario**: The task decided against a startup rename of `$LOG_DIR/bg-<name>.log` / `$STATE_DIR/bg-<name>.state`: they are left in place and ignored, and the docs say so (`CLAUDE.md`, `scripts/README.md`, `wiki/knowledge/concepts/background-process-registry.md`). Also confirms nothing was renamed on the live system: the real `dev` process's legacy log is still present under its old name.
- **Steps**:
  1. Run the first command below as-is (docs)
  2. Run the second command below as-is (legacy log untouched)
- **Command**:
  ```bash
  grep -c 'left in place and ignored' /Users/davidtaylor/Repositories/tmux-conductor/CLAUDE.md /Users/davidtaylor/Repositories/tmux-conductor/scripts/README.md /Users/davidtaylor/Repositories/tmux-conductor/wiki/knowledge/concepts/background-process-registry.md
  ```
  ```bash
  ls /Users/davidtaylor/Repositories/tmux-conductor/logs | grep -c '^bg-dev\.log$'
  ```
- **Expected Result**: Step 1 prints each of the three paths with a count of at least `1`. Step 2 prints `1` (the pre-existing `bg-dev.log` was neither renamed nor deleted by the change or by this UAT).
- **Repeatable Unit Test**: Not applicable: documentation and live-filesystem check
- [x] Pass <!-- 2026-09-20 -->

### UAT-UI-001: Two same-named bg rows in different projects render, and every action targets the clicked row's slug
- **Page**: `/` (Agents page), Background processes section (`frontend/src/components/AgentList.tsx`)
- **Description**: With two bg processes named `dev` in projects `alpha` and `beta`: two `dev` rows render, each with its slug (`alpha-dev`, `beta-dev`) as a secondary detail; Remove hits `DELETE /bg-processes/beta-dev` for the clicked row only; Close window hits `DELETE /bg-processes/alpha-dev/window`; saving an edit PATCHes `/bg-processes/beta-dev` and updates only that row; an SSE `bg-removed {slug:'alpha-dev'}` removes only alpha's row; an SSE `bg-update` for beta merges by slug without clobbering alpha (React keys, SSE handlers and `updateBgProcess(slug, ...)` all use `slug`).
- **Steps**:
  1. Run the unit test command below
- **Expected Result**: 6 vitest tests pass (`describe 'AgentList bg processes sharing a name across projects (TASK-0196)'`); 0 fail.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx`
- **Unit Test Command**: `npm test --workspace ui -- src/components/AgentList.test.tsx -t 'TASK-0196'`
- [SKIP: User skipped] <!-- 2026-09-20 -->

### UAT-UI-002: Manual visual check of two same-named rows in the real dashboard
- **Page**: `http://localhost:4321/` (Agents page, Background processes section)
- **Description**: **Manual**: jsdom cannot judge layout or that the slug detail is readable. Run this **between UAT-API-008 and UAT-API-015** (while both `t0196-smoke` and `t0196-smoke-b` still have a `dev` with an open window). **Read-only: do not click Remove, Close window, or Edit on any row, especially the real `davill` `dev` and `wetware` `dev-stack` rows.**
- **Steps**:
  1. Open `http://localhost:4321/` and expand the Background processes section
  2. Find the `t0196-smoke` and `t0196-smoke-b` project groups
  3. Compare the two `dev` rows, and the real `davill` `dev` row
- **Expected Result**: Two `dev` rows appear, one under each throwaway project group, each labelled `dev` with a secondary slug detail (`t0196-smoke-dev` and `t0196-smoke-b-dev`), and both show a live window (not "window missing"). The real `davill` `dev` row shows `davill-dev` as its slug detail. Rows are visually distinguishable and no row is duplicated or missing. Known nit (not a failure): the Remove/Close confirm dialogs still show the bare `name`, recorded as a follow-up in TASK-0196 step 5.
- **Repeatable Unit Test**: Not applicable: visual layout review (row keying and slug wiring are covered by UAT-UI-001)
- [SKIP: User skipped] <!-- 2026-09-20 -->

### UAT-STATIC-001: Host-server and frontend typecheck clean
- **Scenario**: `BgStatus` gains `slug`; the frontend `BgProcess` type gains `slug`; `bgSlug`/`getBgBySlug`/`listBgSlugs`/`bgSlugCollides` are exported and used; `updateBgProcess(slug, ...)` changed its first parameter.
- **Steps**:
  1. Run the command below
- **Command**:
  ```bash
  npm run typecheck
  ```
- **Expected Result**: Both the `host` and `frontend` typecheck tasks exit with code 0 and print no `error TS`.
- **Repeatable Unit Test**: Not applicable: static type gate, not a unit test
- [x] Pass <!-- 2026-09-20 -->

### UAT-STATIC-002: Shell scripts parse, and the dev-commands slug resolution behaves
- **Scenario**: Every touched script parses under `bash -n`, and `scripts/verify-dev-commands.sh` (fixture-only, no live server needed) passes its slug-resolution checks: exact slug wins; a bare name resolves when exactly one slug ends in `-<name>`; an ambiguous bare name exits 2 and lists the candidates; an unknown argument exits 1 and lists the closest slugs.
- **Steps**:
  1. Run the first command, expect `bash -n` to print nothing and exit 0 for every file
  2. Run the second command, expect `PASS — all dev-commands.sh behavioral checks passed`
- **Command**:
  ```bash
  for f in scripts/conductor.sh scripts/spawn.sh scripts/monitor.sh scripts/teardown.sh scripts/broadcast.sh scripts/lib/db.sh skills/dev-commands/scripts/dev-commands.sh scripts/verify-dev-commands.sh scripts/verify-teardown-window-mapping.sh; do bash -n "$f" || echo "SYNTAX ERROR: $f"; done
  ```
  ```bash
  bash scripts/verify-dev-commands.sh
  ```
- **Expected Result**: Step 1 prints no `SYNTAX ERROR` line. Step 2 ends with `[verify-dev-commands] PASS — all dev-commands.sh behavioral checks passed` and exits 0 (15 checks at generation time).
- **Repeatable Unit Test**: Created: `scripts/verify-dev-commands.sh` (extended by TASK-0196 with the slug fixtures)
- **Unit Test Command**: `bash scripts/verify-dev-commands.sh`
- [x] Pass <!-- 2026-09-20 -->

### UAT-STATIC-003: Teardown window mapping still works with project-scoped fixtures
- **Scenario**: `scripts/verify-teardown-window-mapping.sh` runs the real `teardown.sh` against a **scratch** tmux session (`teardown-verify-<pid>`, never the live `conductor` session) and a fixture DB that now includes `bg_processes.project_id` and the `(project_id, name)` index. It must still send `/exit` to the mapped agent window and kill the scratch session.
- **Steps**:
  1. Run the command below
- **Command**:
  ```bash
  bash scripts/verify-teardown-window-mapping.sh
  ```
- **Expected Result**: Ends with `[verify-teardown] PASS — teardown.sh's window-name mapping (BUG-0009) verified` and exits 0.
- **Repeatable Unit Test**: Created: `scripts/verify-teardown-window-mapping.sh` (fixture updated by TASK-0196)
- **Unit Test Command**: `bash scripts/verify-teardown-window-mapping.sh`
- [x] Pass <!-- 2026-09-20 -->

---

## Gaps

- **`scripts/lib/db.sh` `load_bg` / `load_agents` slug output has no dedicated assertion.** The slug expression `COALESCE(p.name || '-' || b.name, b.name)` (`BG_NAMES`, `BG_DIRS`, `BG_CMDS`, and the linked-bg `AGENT_BG` value) is only exercised indirectly (`bash -n`, the teardown fixture). A promotable check is a fixture script in the style of `scripts/verify-dev-commands.sh`: build a temp DB with two projects each owning a `dev`, `source scripts/lib/db.sh` with `CONDUCTOR_DB` pointing at it, call `load_bg`, and assert `BG_NAMES` is `alpha-dev beta-dev`. It was not written because this generation run was restricted to UAT and wiki files, and the inline `bash -c`/heredoc forms of the same check were not runnable in the generation environment. The same applies to the `conductor.sh`/`spawn.sh`/`monitor.sh`/`teardown.sh` consumers, which needed no edits because they derive every name and path from the loaded values.
- **`seedFromLegacy` skip behavior (UAT-EDGE-005)** is verified only by a scratch-conf script, not a repeatable unit test. Promoting it needs `seedFromLegacy` exported (or a `CONDUCTOR_CONF` fixture harness in a `db.test.ts` case). The skipped-and-warned path and the exact-workdir-match rule are therefore judged by running the command, not by `npm test`.
- **Monitor state file for bg slugs and the teardown path for slug-named bg windows** (`scripts/monitor.sh` liveness loop writing `bg-<slug>.state`; `scripts/teardown.sh` `C-c` to slug windows) are not covered live: exercising them would need the monitor or teardown to run against the real `conductor` session, which this UAT does not touch. They are covered only by the shared-loader argument above and `bash -n`.
- **`BgProcessRow` confirm dialogs still show the bare `name`** (recorded as a follow-up nit in TASK-0196 step 5). It is not asserted anywhere and is not a UAT failure.
- **Renaming legacy files** is intentionally absent (UAT-EDGE-011 checks the decision and the docs, not a behavior).
- **`linked_agent_id` removal** is TASK-0198; UAT-EDGE-001 only asserts that the column and its `ON DELETE SET NULL` FK survive the v11 rebuild.
