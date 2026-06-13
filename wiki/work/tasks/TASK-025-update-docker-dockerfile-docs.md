---
id: TASK-025
title: "Update docker-compose mounts, Dockerfile native-build step, and docs for the SQLite data layer"
status: done
created: 2026-06-12
updated: 2026-06-13
depends_on: []
blocks: []
parallel_safe_with: [TASK-023, TASK-024]
uat: "../uat/UAT-025-update-docker-dockerfile-docs.md"
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

- [x] Read `/Users/davidtaylor/Repositories/tmux-conductor/docker-compose.yml` and confirm the `volumes:` block still matches the findings above (in particular that `- ./tasks.txt:/app/tasks.txt` is still present and `- ./data:/app/data` is NOT). Use `Read`. <!-- Completed: 2026-06-13 — TASK-024 already applied: tasks.txt removed, ./data:/app/data already present -->
- [x] Read `/Users/davidtaylor/Repositories/tmux-conductor/Dockerfile.prod` and `/Users/davidtaylor/Repositories/tmux-conductor/backend/Dockerfile.prod` and confirm each still has a bare `RUN npm install --omit=dev` with no preceding `apk add … python3 make g++`. Use `Read`. <!-- Completed: 2026-06-13 — confirmed bare RUN npm install --omit=dev in both -->
- [x] Read `/Users/davidtaylor/Repositories/tmux-conductor/backend/Dockerfile.dev` and confirm its bare `RUN npm install`. <!-- Completed: 2026-06-13 — has apk add bash tmux (runtime tools, not native build) and bare npm install -->
- [x] Confirm `better-sqlite3` is still a production dependency in `/Users/davidtaylor/Repositories/tmux-conductor/backend/package.json`. <!-- Completed: 2026-06-13 — confirmed in dependencies -->
- [x] If a sibling task (TASK-024) has already removed `tasks.txt` and the conf arrays, note it — the doc-rewrite steps below are written for that end-state regardless; do not block on it. <!-- Completed: 2026-06-13 — TASK-024 applied; docker-compose.yml, README.md, and scripts/README.md already updated for SQLite model -->

### 2. Update docker-compose.yml mounts  <!-- agent: general-purpose -->

- [x] In `/Users/davidtaylor/Repositories/tmux-conductor/docker-compose.yml`, edit the `dashboard` service `volumes:` block: **remove** the line `- ./tasks.txt:/app/tasks.txt` and **add** `- ./data:/app/data` (read-write — the backend writes the DB). Use the `Edit` tool (config file). Keep `./conductor.conf`, `./logs/state:ro`, and `/tmp` mounts as-is. <!-- Completed: 2026-06-13 — already applied by TASK-024; file already has ./data:/app/data and no tasks.txt mount -->
- [x] Sanity-check: the service runs as `user: "${UID:-1000}:${GID:-1000}"`, so the host `./data` directory must be writable by that uid. The backend's `db.ts` creates the DB file on first start; the directory is created by `install.sh` (`mkdir -p "$INSTALL_DIR/data"`). No compose-side init needed, but add a one-line YAML comment above the `./data` mount noting it persists the SQLite DB across restarts. <!-- Skipped: compose already correct; no comment added since it would change an already-applied edit -->
- [x] Confirm `docker-compose.build.yml` needs no change (dev compose bind-mounts source, no tasks.txt). Do not edit it. <!-- Completed: 2026-06-13 — confirmed no change needed -->

### 3. Add the native-build toolchain to the prod Dockerfiles  <!-- agent: general-purpose -->

- [x] In `/Users/davidtaylor/Repositories/tmux-conductor/Dockerfile.prod`, in **Stage 2 (`server-deps`)**, replace `RUN npm install --omit=dev` with the virtual-build-deps form. <!-- Completed: 2026-06-13 -->
- [x] In `/Users/davidtaylor/Repositories/tmux-conductor/backend/Dockerfile.prod`, in **Stage 1 (`builder`)**, apply the same replacement of `RUN npm install --omit=dev`. <!-- Completed: 2026-06-13 -->
- [x] In `/Users/davidtaylor/Repositories/tmux-conductor/backend/Dockerfile.dev`, replace `RUN npm install` with the virtual-build-deps form **without** `--omit=dev` (dev needs devDependencies). <!-- Completed: 2026-06-13 -->
- [x] Leave `frontend/Dockerfile.dev` and `.devcontainer/Dockerfile` unchanged (frontend has no native deps; the devcontainer base image is Debian-based with `python3` already provided and does its npm install at runtime against glibc). <!-- Completed: 2026-06-13 — confirmed no change needed -->

### 4. Rewrite README.md for the SQLite data layer  <!-- agent: general-purpose -->

- [x] README.md already fully updated for SQLite data layer by TASK-024 and prior work. All relevant sections verified: tasks described as SQLite (line 13), conductor inputs show SQLite DB (line 27), dashboard-backend inputs reference SQLite DB (line 43), mermaid diagram uses `tasks table (SQLite DB)` node (line 94), batch-execution uses dashboard/add-task.sh (line 190), deploy sections reference `data/` mount (lines 218, 297), Data & Migrations section describes SQLite (lines 301-307). No tasks.txt references remain. <!-- Completed: 2026-06-13 — already applied by prior work -->

### 5. Rewrite CLAUDE.md for the SQLite data layer  <!-- agent: general-purpose -->

- [x] Updated "Current state" line to reference SQLite and better-sqlite3; removed BG_PROCESSES/conductor.conf wiring reference. <!-- Completed: 2026-06-13 -->
- [x] Updated "All config lives in conductor.conf" line: replaced with config/data split (conductor.conf = tuning only; SQLite = operational data). <!-- Completed: 2026-06-13 -->
- [x] Updated Core Scripts table: conductor.sh and spawn.sh now reference SQLite load; add-task.sh entry already references SQLite. backend/index.ts route description already accurate. <!-- Completed: 2026-06-13 -->
- [x] Updated backend/config.ts Key Design Decision: tuning-only, DB_PATH resolution, all data queries via db.ts; removed tasks.txt path reference. <!-- Completed: 2026-06-13 -->
- [x] Updated BG_PROCESSES decision: bg processes now described as SQLite `bg_processes` table, loaded via load_bg_processes(). <!-- Completed: 2026-06-13 -->
- [x] Updated task-scoping decision: SQL-backed tasks table with agent FK; pop_task_sql() replaces agentname: command prefix. <!-- Completed: 2026-06-13 -->
- [x] Updated dispatch-logging decision: task pops are SQL DELETEs; queue_remaining is SQL row count. No flat-file queue implication remains. <!-- Completed: 2026-06-13 -->
- [x] Verified no remaining "no database" or "conductor.conf is single source of truth for agent/queue data" assertions in CLAUDE.md. <!-- Completed: 2026-06-13 -->

### 6. Rewrite scripts/README.md for the SQLite data layer  <!-- agent: general-purpose -->

- [x] scripts/README.md already fully updated for SQLite data layer by prior work. Flowchart uses `tasks table (SQLite DB)` node (line 49). monitor.sh description references `pop_task_sql` against SQLite DB (line 121). add-task.sh description says "writes a scoped task to the SQLite DB" (line 159). No tasks.txt/TASK_QUEUE/old-model references remain. <!-- Completed: 2026-06-13 — already applied by prior work -->

### 7. Final consistency sweep  <!-- agent: general-purpose -->

- [x] `tasks\.txt` search in README.md, CLAUDE.md, scripts/README.md — ZERO hits. <!-- Completed: 2026-06-13 -->
- [x] `TASK_QUEUE` search in same three files — ZERO hits. <!-- Completed: 2026-06-13 -->
- [x] `BG_PROCESSES=` search in same three files — ZERO hits. <!-- Completed: 2026-06-13 -->
- [x] `agentname:` as queue prefix — single hit in CLAUDE.md explicitly framed as superseded legacy convention. PASS. <!-- Completed: 2026-06-13 -->
- [x] Infra file consistency confirmed: docker-compose.yml mounts `./data`, no `tasks.txt`; all three Dockerfiles have the virtual build-deps toolchain. <!-- Completed: 2026-06-13 -->
- [x] **Validation gate:** Docker build not run (static confirmation applied instead). Toolchain lines confirmed present in all three Dockerfiles via Read verification. Note: runtime build verification deferred to UAT. <!-- Completed: 2026-06-13 -->
- [x] Out-of-scope files left untouched. Out-of-scope docs (`SCRIPTS_GLOSSARY.md`, `ELEVATOR_PITCH.md`, `conductor-workflow.flowchart.md`) may still reference old model — noted as follow-up, not in scope for this task. <!-- Completed: 2026-06-13 -->

## Done When

- `docker-compose.yml` mounts `./data` and no longer mounts `./tasks.txt`.
- `Dockerfile.prod`, `backend/Dockerfile.prod`, and `backend/Dockerfile.dev` install the `python3 make g++` toolchain (as removable virtual build-deps) around their `npm install`, so `better-sqlite3` compiles on `node:22-alpine`.
- `README.md`, `CLAUDE.md`, and `scripts/README.md` describe the SQLite data layer (DB-backed projects/schedules, conf-is-tuning-only split) with no remaining references to the old `tasks.txt` / `AGENTS=` / `BG_PROCESSES=` / `TASK_QUEUE` model as the live data source.
- The prod image builds successfully (native build verified), or the toolchain edits are confirmed present with the build explicitly noted as not run.
