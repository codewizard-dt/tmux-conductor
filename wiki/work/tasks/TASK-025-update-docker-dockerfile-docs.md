---
id: TASK-025
title: "Update docker-compose mounts, Dockerfile native-build step, and docs for the SQLite data layer"
status: todo
created: 2026-06-12
updated: 2026-06-12
depends_on: []
blocks: []
parallel_safe_with: [TASK-023, TASK-024]
uat: ""
tags: [roadmap-001, phase-5, cutover, docker, dockerfile, docs, sqlite, infra]
---

# TASK-025 — Update docker-compose mounts, Dockerfile native-build step, and docs for the SQLite data layer

## Objective

ROADMAP-001 migrated all conductor operational data — projects, agents, bg processes, the task queue, and schedules — into SQLite at `./data/conductor.db` using `better-sqlite3` (a native module). This task brings the **infrastructure and documentation** in line with that end-state. Three concrete deliverables:

1. **docker-compose** — the production `docker-compose.yml` must mount `./data` (so the SQLite DB survives container restarts; the DB is gitignored so it only exists as a host volume) and drop the obsolete `./tasks.txt` mount.
2. **Dockerfile native-build step** — both production images build on `node:22-alpine`. `better-sqlite3`'s prebuilt binaries are glibc-linked and **do not work on Alpine's musl libc**, so the package compiles from source on `npm install`. That compile needs a toolchain (`python3`, `make`, `g++`/`build-base`) which is currently **absent** from the `npm install` build stages — meaning the images will fail to build (or ship a broken native module) the moment `better-sqlite3` is a real dependency. Add the toolchain to the dependency-install stage of each prod Dockerfile.
3. **Docs** — `README.md`, `CLAUDE.md`, and `scripts/README.md` still describe the old flat-file model (`tasks.txt`, the `conductor.conf` `AGENTS`/`BG_PROCESSES`/`TASK_QUEUE` arrays, the `agentname: command` scoped-line queue). Rewrite those sections to describe the SQLite data layer, DB-backed projects/schedules, and the new "conf is tuning-only, data is in SQLite" split.

## Approach

### Scope boundary (collision-safety with concurrent siblings)

This task is **collision-safe to run in parallel** with the other ROADMAP-001 Phase 5 tasks because it touches a disjoint set of files:

- **TASK-023** (`TASK-023-remove-legacy-conf-queue-code-backend.md`) edits `backend/config.ts` and `backend/state.ts` (deletes dead conf-splice + flat-file queue code).
- **TASK-024** (the Phase 5 conductor.conf-stripping item — "Strip AGENTS/BG_PROCESSES/AGENT_BG_LINKS/TASK_QUEUE from conductor.conf and retire tasks.txt") edits `conductor.conf` and removes `tasks.txt`.
- **TASK-025 (this task)** edits `docker-compose.yml`, the prod Dockerfiles, and the Markdown docs — and touches **none** of those code/config files.

`depends_on` is intentionally **empty** so this can run concurrently. However, this task *documents the end-state that 023 and 024 produce*. Therefore the doc wording below is written assuming 023 and 024 land (e.g. "`tasks.txt` no longer exists", "`conductor.conf` no longer defines `AGENTS`/`BG_PROCESSES`"). That is `parallel_safe_with` — collision-safe but semantically downstream. **Do not** edit `conductor.conf`, `tasks.txt`, `backend/config.ts`, or `backend/state.ts` in this task; those belong to the sibling tasks.

> **Do NOT edit the roadmap file.** The orchestrator links this task into ROADMAP-001 separately.

### Current-state findings (researched, do not re-derive — verify only)

- **`docker-compose.yml`** (`/Users/davidtaylor/Repositories/tmux-conductor/docker-compose.yml`) — single `dashboard` service, `image: ghcr.io/codewizard-dt/tmux-conductor-dashboard:latest`. `volumes:` block (lines 14–18):
  ```yaml
      volumes:
        - ./conductor.conf:/app/conductor.conf
        - ./logs/state:/app/logs/state:ro
        - ./tasks.txt:/app/tasks.txt        # ← OBSOLETE: remove
        - /tmp:/tmp
  ```
  `CONDUCTOR_CONF: /app/conductor.conf` is set in `environment:`. Runs as `user: "${UID:-1000}:${GID:-1000}"` — relevant because the mounted `./data` dir must be writable by that uid.
- **`docker-compose.build.yml`** — dev compose, bind-mounts `./backend` and `./frontend` source; mounts **no** `tasks.txt` or data volume. **No change needed.**
- **`Dockerfile.prod`** (root, `/Users/davidtaylor/Repositories/tmux-conductor/Dockerfile.prod`) — 3 stages on `node:22-alpine`. Stage 2 `server-deps` runs `RUN npm install --omit=dev` (line 15) where `better-sqlite3` compiles. Stage 3 `COPY --from=server-deps /app/node_modules ./node_modules`. **Toolchain must be added to stage 2 (`server-deps`)**, because that is where `npm install` runs and where the native `.node` artifact is produced before it is copied into the runtime stage.
- **`backend/Dockerfile.prod`** (`/Users/davidtaylor/Repositories/tmux-conductor/backend/Dockerfile.prod`) — 2 stages on `node:22-alpine`. Stage 1 `builder` runs `RUN npm install --omit=dev` (line 4); stage 2 copies node_modules from it. **Toolchain must be added to stage 1 (`builder`)**.
- **`backend/Dockerfile.dev`** / **`frontend/Dockerfile.dev`** / **`.devcontainer/Dockerfile`** — dev/devcontainer images. `backend/Dockerfile.dev` runs `npm install` on `node:22-alpine` too, so it has the **same musl compile problem** — add the toolchain there as well for dev parity (otherwise `npm install` breaks in the dev container). frontend has no native deps → no change.
- **`backend/package.json`** — confirms `"better-sqlite3": "^12.0.0"` in `dependencies` and `"@types/better-sqlite3": "^7.6.0"` in `devDependencies`. So the native module IS a production dependency.
- **`.gitignore`** line 220 = `data/` → the DB is **not** committed; it must be a host volume mount for any persistence. Confirms deliverable (1).
- **Docs with old-model references** (targets for the rewrite):
  - `README.md` — lines ~13 (tasks.txt plain-text queue), ~27 (conf inputs: AGENTS/BG_PROCESSES/POLL_INTERVAL/TASK_QUEUE + tasks.txt), ~44 (backend reads tasks.txt per request), ~49 (architecture mermaid node `QUEUE["tasks.txt\ntask queue"]`), ~190 (preload tasks.txt), ~218 + ~297 (compose mounts conductor.conf/logs/state/tasks.txt), ~301–307 ("No database… plain-text files" Data & Migrations section).
  - `CLAUDE.md` — lines ~9 ("Current state" / `BG_PROCESSES` wiring), ~13 ("All config lives in conductor.conf — … task queue path"), ~23–29 (Core Scripts table referencing the conf arrays + flat queue), ~33 (backend route list described against flat files), ~51 (`config.ts` resolves `./tasks.txt`), ~52 (`BG_PROCESSES` host windows), ~55 (`agentname: command` scoped task-queue prefix), ~56 (dispatch logging w/ task pops).
  - `scripts/README.md` — flowchart node `Queue[("tasks.txt")]` (~lines 49–50), `monitor.sh` description "pop_task against TASK_QUEUE" (~line 122), `add-task.sh` "appends a line `<agent>: <cmd>` to ../tasks.txt" (~line 159).
  - **No change:** `frontend/README.md` (Astro boilerplate), `hooks/README.md` (per-agent state files, unaffected by the DB migration). `.docs/**`, `wiki/**`, `SCRIPTS_GLOSSARY.md`, `ELEVATOR_PITCH.md`, `conductor-workflow.flowchart.md` are historical/secondary — **out of scope** for this task; if any are trivially in the way, leave them and note them in the completion summary rather than expanding scope.

### Alpine native-build snippet (the canonical fix)

Use a virtual build-deps package so the toolchain can be dropped after install, keeping the layer small. Apply in the `npm install` stage of each affected Dockerfile:

```dockerfile
RUN apk add --no-cache --virtual .build-deps python3 make g++ \
 && npm install --omit=dev \
 && apk del .build-deps
```

(For `backend/Dockerfile.dev`, mirror this but with plain `npm install` — no `--omit=dev` — so devDependencies are still installed.) `--virtual .build-deps` + `apk del .build-deps` in the **same `RUN`** layer is what keeps the toolchain out of the final image. If the existing `RUN npm install …` line is standalone, replace it with the combined form above so the `apk del` runs in the same layer.

## Steps

### 1. Verify current state before editing  <!-- agent: general-purpose -->

- [ ] Read `/Users/davidtaylor/Repositories/tmux-conductor/docker-compose.yml` and confirm the `volumes:` block still matches the findings above (in particular that `- ./tasks.txt:/app/tasks.txt` is still present and `- ./data:/app/data` is NOT). Use `Read`.
- [ ] Read `/Users/davidtaylor/Repositories/tmux-conductor/Dockerfile.prod` and `/Users/davidtaylor/Repositories/tmux-conductor/backend/Dockerfile.prod` and confirm each still has a bare `RUN npm install --omit=dev` with no preceding `apk add … python3 make g++`. Use `Read`.
- [ ] Read `/Users/davidtaylor/Repositories/tmux-conductor/backend/Dockerfile.dev` and confirm its bare `RUN npm install`.
- [ ] Confirm `better-sqlite3` is still a production dependency in `/Users/davidtaylor/Repositories/tmux-conductor/backend/package.json`.
- [ ] If a sibling task (TASK-024) has already removed `tasks.txt` and the conf arrays, note it — the doc-rewrite steps below are written for that end-state regardless; do not block on it.

### 2. Update docker-compose.yml mounts  <!-- agent: general-purpose -->

- [ ] In `/Users/davidtaylor/Repositories/tmux-conductor/docker-compose.yml`, edit the `dashboard` service `volumes:` block: **remove** the line `- ./tasks.txt:/app/tasks.txt` and **add** `- ./data:/app/data` (read-write — the backend writes the DB). Use the `Edit` tool (config file). Keep `./conductor.conf`, `./logs/state:ro`, and `/tmp` mounts as-is. Resulting block:
  ```yaml
      volumes:
        - ./conductor.conf:/app/conductor.conf
        - ./logs/state:/app/logs/state:ro
        - ./data:/app/data
        - /tmp:/tmp
  ```
- [ ] Sanity-check: the service runs as `user: "${UID:-1000}:${GID:-1000}"`, so the host `./data` directory must be writable by that uid. The backend's `db.ts` creates the DB file on first start; the directory is created by `install.sh` (`mkdir -p "$INSTALL_DIR/data"`). No compose-side init needed, but add a one-line YAML comment above the `./data` mount noting it persists the SQLite DB across restarts.
- [ ] Confirm `docker-compose.build.yml` needs no change (dev compose bind-mounts source, no tasks.txt). Do not edit it.

### 3. Add the native-build toolchain to the prod Dockerfiles  <!-- agent: general-purpose -->

- [ ] In `/Users/davidtaylor/Repositories/tmux-conductor/Dockerfile.prod`, in **Stage 2 (`server-deps`)**, replace `RUN npm install --omit=dev` with the virtual-build-deps form:
  ```dockerfile
  RUN apk add --no-cache --virtual .build-deps python3 make g++ \
   && npm install --omit=dev \
   && apk del .build-deps
  ```
  Use the `Edit` tool. Do not touch Stage 1 (`ui-builder`, no native deps) or Stage 3 (runtime — it only copies the prebuilt node_modules; no toolchain needed there).
- [ ] In `/Users/davidtaylor/Repositories/tmux-conductor/backend/Dockerfile.prod`, in **Stage 1 (`builder`)**, apply the same replacement of `RUN npm install --omit=dev`.
- [ ] In `/Users/davidtaylor/Repositories/tmux-conductor/backend/Dockerfile.dev`, replace `RUN npm install` with the virtual-build-deps form **without** `--omit=dev` (dev needs devDependencies):
  ```dockerfile
  RUN apk add --no-cache --virtual .build-deps python3 make g++ \
   && npm install \
   && apk del .build-deps
  ```
- [ ] Leave `frontend/Dockerfile.dev` and `.devcontainer/Dockerfile` unchanged (frontend has no native deps; the devcontainer base image is Debian-based with `python3` already provided and does its npm install at runtime against glibc).

### 4. Rewrite README.md for the SQLite data layer  <!-- agent: general-purpose -->

- [ ] In `/Users/davidtaylor/Repositories/tmux-conductor/README.md`, rewrite the task-storage description (~line 13): tasks now live in the `tasks` table of `./data/conductor.db` (SQLite), with agent/project scoping via foreign keys, not a plain-text file. Use `Edit`.
- [ ] Update the conductor inputs line (~line 27): `conductor.conf` now holds **only tuning/debug settings** (poll interval, idle/busy/awaiting patterns, usage checks, `DB_PATH`); agents, bg processes, projects, the task queue, and schedules live in SQLite. Remove `AGENTS array`, `BG_PROCESSES`, `TASK_QUEUE`, and `tasks.txt` from the input list.
- [ ] Update the dashboard-backend inputs line (~line 44): backend reads/writes the SQLite DB (via `better-sqlite3`); `conductor.conf` is still parsed for tuning; state files are still read. Remove "tasks.txt (read on each request)".
- [ ] Update the architecture mermaid diagram (~line 49): change the queue node from `QUEUE["tasks.txt\ntask queue"]` to `QUEUE[("data/conductor.db\nSQLite")]` (DB shape `[(...)]`). Verify no other diagram node still names `tasks.txt`.
- [ ] Update the batch-execution use-case (~line 190): "preload the task queue via the dashboard or `scripts/add-task.sh`" instead of "preload tasks.txt".
- [ ] Update both deployment/compose mount descriptions (~lines 218 and 297): the container mounts `conductor.conf`, `logs/state/`, and **`data/`** (for persistent SQLite state across restarts); it no longer mounts `tasks.txt`.
- [ ] Replace the "Data & Migrations" section (~lines 301–307): conductor now uses a **SQLite database** at `./data/conductor.db` (gitignored; persisted via the `./data` volume mount). State files (`logs/state/<agent>.state`) and the dispatch log (`logs/dispatch.jsonl`) remain plain files. Migrations are **code-based**, applied automatically on backend start by `backend/db.ts` (`runMigrations()` / schema-version meta table). To reset: stop the stack and delete `./data/conductor.db` (the backend re-creates and re-seeds it). Note the first-start **legacy seed** that imports any pre-existing agents/tasks into the DB.

### 5. Rewrite CLAUDE.md for the SQLite data layer  <!-- agent: general-purpose -->

- [ ] In `/Users/davidtaylor/Repositories/tmux-conductor/CLAUDE.md`, update "Current state" (~line 9) to reference ROADMAP-001: conductor data lives in SQLite (`./data/conductor.db`) via `better-sqlite3`; `conductor.conf` holds tuning only; the dashboard manages projects and recurring schedules. Use `Edit`.
- [ ] Update the "All config lives in conductor.conf" line (~line 13): split into **config** (conductor.conf: tuning — poll interval, detection patterns, usage checks, `DB_PATH`) vs **data** (SQLite: agents, bg processes, projects, tasks, schedules).
- [ ] Update the Core Scripts table (~lines 23–29) and the `backend/index.ts` route description (~line 33): the queue/agents/projects/schedules routes read and mutate the SQLite DB (via `backend/db.ts` helpers — `popTask`, `listTasksForAgent`, `addTask`, project/schedule CRUD), not flat files or conf arrays. Keep the route URLs accurate.
- [ ] Update the `backend/config.ts` Key Design Decision (~line 51): `config.ts` reads `conductor.conf` for tuning; it no longer resolves a `./tasks.txt` path. DB path resolution and all data queries live in `backend/db.ts` (resolves `DB_PATH` relative to the conf dir).
- [ ] Update the `BG_PROCESSES` decision (~line 52): bg processes are stored in the SQLite `bg_processes` table (not the `conductor.conf` `BG_PROCESSES` array); they are still spawned as host windows, unmonitored, and `C-c`'d on teardown.
- [ ] Update the task-scoping decision (~line 55): task scoping is now SQL (agent/project foreign keys + `popTask` selecting scoped rows before global), replacing the `agentname: command` plain-text prefix.
- [ ] Update the dispatch-logging decision (~line 56) only where it implies the queue is a flat file: pops are SQL deletes/updates against the `tasks` table; `dispatch.jsonl` logging is unchanged.
- [ ] Remove or rephrase any remaining sentence in CLAUDE.md that asserts there is "no database" or that `conductor.conf` is the single source of truth for agent/queue data.

### 6. Rewrite scripts/README.md for the SQLite data layer  <!-- agent: general-purpose -->

- [ ] In `/Users/davidtaylor/Repositories/tmux-conductor/scripts/README.md`, update the orchestration-loop flowchart (~lines 49–50): replace `Queue[("tasks.txt")]` with `Queue[("data/conductor.db\ntasks table")]` and relabel the monitor→queue edge from "pop_task (scoped → global)" to a SQL pop (`scripts/lib/db.sh sql()` → `popTask`). Use `Edit`.
- [ ] Update the `monitor.sh` description (~line 122): on idle it pops the next task via SQL (`scripts/lib/db.sh`), scoped rows first then global, instead of reading `TASK_QUEUE`/`tasks.txt`.
- [ ] Update the `add-task.sh` description (~line 159): it **inserts a row into the `tasks` table** (via `scripts/lib/db.sh`) using the caller's CWD name as the agent scope, instead of appending `<agent>: <cmd>` to `../tasks.txt`.
- [ ] Scan the rest of `scripts/README.md` for any other `tasks.txt` / `TASK_QUEUE` / `AGENTS` / `BG_PROCESSES` mention and bring it in line (e.g. references to `scripts/lib/db.sh` as the shell DB helper added in TASK-009).

### 7. Final consistency sweep  <!-- agent: general-purpose -->

- [ ] Run `mcp__serena__search_for_pattern` for `tasks\.txt` across `README.md`, `CLAUDE.md`, and `scripts/README.md` (paths_include_glob each, or repo-root with those globs) — confirm **zero** remaining references in those three files. Any hit that is genuinely required (e.g. a "legacy seed imports pre-existing tasks.txt" note) must be explicitly framed as legacy/migration, not current model.
- [ ] Run `mcp__serena__search_for_pattern` for `TASK_QUEUE` and for `BG_PROCESSES=` across the same three files — confirm none describe them as the live data source.
- [ ] Confirm the three edited infra files are internally consistent: `docker-compose.yml` mounts `./data` and not `tasks.txt`; both prod Dockerfiles + `backend/Dockerfile.dev` have the `apk add --virtual .build-deps python3 make g++ … apk del .build-deps` toolchain wrapping their `npm install`.
- [ ] **Validation gate:** build the prod image to prove the native step works — `docker build -f Dockerfile.prod -t tmux-conductor:tc025-verify .` (run from repo root; use the repo-local `./tmp` for any scratch). It must complete with `better-sqlite3` compiling against musl and no `node-gyp` / missing-`python3` errors. If Docker is unavailable in the execution environment, instead `docker build`-lint by confirming the toolchain lines are present and note that the build was not run; do not mark the gate passed without one or the other.
- [ ] Leave `conductor.conf`, `tasks.txt`, `backend/config.ts`, `backend/state.ts`, and `wiki/work/roadmaps/ROADMAP-001-*.md` **untouched** (owned by sibling tasks / the orchestrator). If any out-of-scope doc (`SCRIPTS_GLOSSARY.md`, `ELEVATOR_PITCH.md`, `conductor-workflow.flowchart.md`, `.docs/**`) still references the old model, note it in the completion summary as follow-up rather than editing it here.

## Done When

- `docker-compose.yml` mounts `./data` and no longer mounts `./tasks.txt`.
- `Dockerfile.prod`, `backend/Dockerfile.prod`, and `backend/Dockerfile.dev` install the `python3 make g++` toolchain (as removable virtual build-deps) around their `npm install`, so `better-sqlite3` compiles on `node:22-alpine`.
- `README.md`, `CLAUDE.md`, and `scripts/README.md` describe the SQLite data layer (DB-backed projects/schedules, conf-is-tuning-only split) with no remaining references to the old `tasks.txt` / `AGENTS=` / `BG_PROCESSES=` / `TASK_QUEUE` model as the live data source.
- The prod image builds successfully (native build verified), or the toolchain edits are confirmed present with the build explicitly noted as not run.
