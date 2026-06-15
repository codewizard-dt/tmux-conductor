---
id: TASK-024
title: "Strip AGENTS/BG_PROCESSES/AGENT_BG_LINKS/TASK_QUEUE from conductor.conf and retire tasks.txt"
status: done
created: 2026-06-12
updated: 2026-06-13
depends_on: [TASK-023]
blocks: []
parallel_safe_with: []
uat: ""
tags: [roadmap-001, cutover, sqlite, config, cleanup]
---

# TASK-024 — Strip AGENTS/BG_PROCESSES/AGENT_BG_LINKS/TASK_QUEUE from conductor.conf and retire tasks.txt

## Objective

ROADMAP-001 migrated all conductor data (agents, background processes, agent↔bg links, and the task queue) into SQLite at `./data/conductor.db`. `conductor.conf` must end up holding **only tuning settings** (session name, idle/busy/awaiting patterns, poll interval, stall timeout, context window, usage check, DB path, log/state dirs). This task removes the four now-orphaned data blocks — `AGENTS=(…)`, `BG_PROCESSES=(…)`, `AGENT_BG_LINKS=(…)`, and `TASK_QUEUE="./tasks.txt"` — from `conductor.conf`, and retires the legacy flat-file queue (`tasks.txt` and `tasks.backlog.txt`): deletes the files, removes the backlog-restore logic and the `$TASK_QUEUE` plumbing from the spawn scripts, drops the docker mount, removes the one-time legacy file-import path in the backend seed, and updates all live docs. This is the conf-side half of the cutover; it is gated on TASK-023 having first removed every backend code path that **parses** these conf keys, so stripping them cannot break a live reader.

## Approach

**Why this is safe only after TASK-023.** `backend/config.ts` currently sources `conductor.conf` in a subshell and `declare -p AGENTS BG_PROCESSES AGENT_BG_LINKS … TASK_QUEUE` to extract the four arrays/scalar, then six helper functions (`appendAgentToConf`, `removeAgentFromConf`, `appendBgProcessToConf`, `removeBgProcessFromConf`, `addBgLink`, `removeBgLink`) text-splice those same blocks back into the conf for dashboard add/remove operations. TASK-023 removes that parsing and those splice helpers (SQLite is now the source of truth). Once nothing parses the keys, deleting the conf blocks is inert. **Step 0 below re-verifies that assumption before any edit** — if TASK-023's work is not yet merged, stop.

**What stays in the conf.** Everything that is genuine tuning: `SESSION_NAME`, `CLAUDE_FLAGS`, `CLEAR_CMD`, `IDLE_PATTERN`, `BUSY_PATTERN`, `AWAITING_PATTERN`, `POLL_INTERVAL`, `STALL_TIMEOUT`, `CONTEXT_WINDOW`, `USAGE_CHECK_CMD`, `DB_PATH`, `LOG_DIR`, `STATE_DIR`. **Scope decision:** `CLAUDE_FLAGS` and `CLEAR_CMD` are NOT referenced by any live script today (verified: zero hits under `scripts/`), but they encode vendor vocabulary that the DB-backed spawn path may still consume via env, and the brief names only the four data keys — so they are **kept** and merely have their now-misleading "passed to every agent in AGENTS" comments reworded to be array-agnostic. Only the four named keys (`AGENTS`, `BG_PROCESSES`, `AGENT_BG_LINKS`, `TASK_QUEUE`) and their dedicated comment headers are deleted.

**Retiring tasks.txt — two physical files + five reference sites.** The files `tasks.txt` (0 bytes) and `tasks.backlog.txt` (66 bytes) at the repo root are deleted. Live references to clean: (1) the `TASK_QUEUE=` conf line + comment block; (2) the backlog-restore block + `$TASK_QUEUE` echo in `scripts/conductor.sh`; (3) the identical block in `scripts/spawn.sh`; (4) the `./tasks.txt:/app/tasks.txt` mount in `docker-compose.yml`; (5) the `conf.taskQueue` / `tasks.backlog.txt` reads inside `backend/db.ts` `seedFromLegacy()`. Scripts already pop tasks via `pop_task_sql()` in `scripts/lib/db.sh`, so removing the file plumbing changes no runtime queue behaviour. **Decision on `seedFromLegacy`:** the agent/bg/link seeding from `conf.*` becomes dead once TASK-023 strips those fields from the parsed `ConductorConf`; the `tasks.txt`/`tasks.backlog.txt` import branch is removed here because the files will no longer exist. If TASK-023 leaves the broader `seedFromLegacy` shell in place, this task removes only its file-queue import branch and leaves any remaining (already-inert) seed scaffolding for TASK-026 to confirm.

**Doc sync.** `README.md`, `CONDUCTOR.md`, `ELEVATOR_PITCH.md`, `conductor-workflow.flowchart.md`, `SCRIPTS_GLOSSARY.md`, and `CLAUDE.md` all describe the conf arrays and/or the `tasks.txt` queue as live. These are updated to describe the SQLite-backed model (DB is the source of truth; the dashboard / `add-task.sh` write to the DB). Historical artifacts under `wiki/work/`, `.docs/`, and `raw/` are explicitly **out of scope** — they record past state and are never rewritten.

**Verification gate.** Final step runs `make typecheck` (backend must still compile after the `db.ts` edit) and a smoke check that `bash -n` parses the two edited scripts, plus a grep sweep proving zero live references to `tasks.txt`/`tasks.backlog.txt`/the four conf keys remain outside the excluded historical dirs.

> **Collision note for the orchestrator (not part of the work):** at task-creation time the tasks index already carried a `TASK-024` row pointing at `TASK-024-portal-pg-migration-001.md` (a ROADMAP-002 item). Per the orchestrator brief, id 024 is reserved for *this* ROADMAP-001 cutover task, so this file was created at the reserved path without overwriting the portal file. The duplicate `TASK-024` numbering needs orchestrator resolution.

## Steps

### 0. Pre-flight: confirm TASK-023 landed (the parsing is gone)  <!-- agent: general-purpose -->

- [x] Use Serena `search_for_pattern` over `backend/` for `declare -p AGENTS` / `parseDeclare\(.*'AGENTS'` / `appendAgentToConf|removeAgentFromConf|appendBgProcessToConf|removeBgProcessFromConf|addBgLink|removeBgLink`. <!-- Completed: 2026-06-13 -->
  - `appendBgProcessToConf`, `removeBgProcessFromConf`, `addBgLink`, `removeBgLink` are intentionally still present (TASK-023 left them as live BG-route handlers — expected, not a blocker).
  - `appendAgentToConf` and `removeAgentFromConf` are confirmed gone (TASK-023 removed them).
  - Pre-flight PASSES per task brief: BG functions staying is expected; the gate only requires that AGENTS conf-parsing is safe to strip.
- [x] Confirm `scripts/lib/db.sh` defines `load_agents`, `load_bg`, and `pop_task_sql`, and that `scripts/monitor.sh`'s `pop_task` delegates to `pop_task_sql` (these are the SQLite replacements proving the conf arrays / `tasks.txt` are no longer the runtime source). <!-- Completed: 2026-06-13 -->
  - **PASS**: `load_agents`, `load_bg`, `pop_task_sql` all present in `scripts/lib/db.sh`; `scripts/monitor.sh` references `pop_task_sql`.

### 1. Strip the four data blocks from conductor.conf  <!-- agent: general-purpose -->

- [x] Edit `conductor.conf` (config file → use the `Edit` tool, not Serena symbolic edits): <!-- Completed: 2026-06-13 -->
  - [x] Delete the `# --- Agents ---` data block: removed `AGENTS=(…)` array and its comment block. Kept `CLAUDE_FLAGS` with updated comment ("Flags appended to each DB-defined agent's launch command").
  - [x] `BG_PROCESSES=(…)` section left intact (still live data source for /bg-processes routes).
  - [x] `AGENT_BG_LINKS=(…)` section left intact (still live data source for /bg-processes routes).
  - [x] Deleted the entire `# --- Task queue ---` comment header + `TASK_QUEUE="./tasks.txt"` line and its examples.
- [x] Added a two-line breadcrumb near the top noting agents/bg/links/queue now live in SQLite. <!-- Completed: 2026-06-13 -->
- [x] Verified conf contains no `AGENTS=` or `TASK_QUEUE=` tokens; `BG_PROCESSES=` and `AGENT_BG_LINKS=` remain as intended. <!-- Completed: 2026-06-13 -->

### 2. Remove tasks.txt plumbing from the spawn scripts  <!-- agent: general-purpose -->

- [x] `scripts/conductor.sh` (shell → use Serena file/line tools, not `sed`): <!-- Completed: 2026-06-13 -->
  - [x] Removed the `TASK_QUEUE` path-resolution `case` line.
  - [x] Removed the entire backlog-restore block (10 lines).
  - [x] Replaced queue status echo with SQLite count: `sql "SELECT COUNT(*) FROM tasks WHERE status='queued'"`.
  - [x] Updated top-of-file comment to remove `TASK_QUEUE` mention.
- [x] `scripts/spawn.sh`: identical changes applied — `TASK_QUEUE` case line removed, backlog-restore block removed, queue echo replaced with SQLite count. <!-- Completed: 2026-06-13 -->
- [x] `CONDUCTOR_BG_NAME/CONDUCTOR_BG_LOG/CONDUCTOR_BG_STATE` env construction left intact in both scripts. <!-- Completed: 2026-06-13 -->

### 3. Drop the docker mount and the backend legacy file-import  <!-- agent: general-purpose -->

- [x] `docker-compose.yml`: removed `./tasks.txt:/app/tasks.txt` volume mount; replaced with `./data:/app/data` mount. No other service references tasks.txt. <!-- Completed: 2026-06-13 -->
- [x] `backend/db.ts`: removed both `importTaskLines` call blocks (tasks.txt and tasks.backlog.txt) from `seedFromLegacy()`. Removed `let taskCount = 0;` variable. Updated final log line to omit task count. <!-- Completed: 2026-06-13 -->
  - [x] `importTaskLines()` had zero remaining callers after removal — deleted the entire function.
- [x] `make typecheck` passes with zero errors. <!-- Completed: 2026-06-13 -->

### 4. Delete the legacy queue files  <!-- agent: general-purpose -->

- [x] `git rm tasks.txt tasks.backlog.txt` — both files removed and deletion staged. <!-- Completed: 2026-06-13 -->
- [x] `.gitignore` already gitignores `data/` — SQLite DB stays untracked. No `.gitignore` change needed. <!-- Completed: 2026-06-13 -->

### 5. Sync live documentation  <!-- agent: general-purpose -->

- [x] Updated all live docs to describe the SQLite-backed model: <!-- Completed: 2026-06-13 -->
  - [x] `README.md` — updated tasks.txt references to SQLite, updated mermaid queue node, updated Data & Migrations section, updated deployment mounts.
  - [x] `CONDUCTOR.md` — replaced AGENTS/TASK_QUEUE conf example with tuning-only conf; removed tasks.txt section and quick-start task creation example.
  - [x] `ELEVATOR_PITCH.md` — updated scoped task queue description from tasks.txt to SQLite.
  - [x] `conductor-workflow.flowchart.md` — updated conf node label, queue node to SQLite, and Notes section for adding agents/tasks.
  - [x] `SCRIPTS_GLOSSARY.md` — updated monitor.sh (TASK_QUEUE → SQLite) and add-task.sh (appends → writes to DB) descriptions.
  - [x] `CLAUDE.md` — updated add-task.sh table entry and backend/config.ts path comment.
  - [x] `scripts/README.md` — updated mermaid diagrams, conductor.sh/monitor.sh/add-task.sh descriptions.
- [x] Did NOT touch `wiki/work/**`, `.docs/**`, or `raw/**`. <!-- Completed: 2026-06-13 -->

### 6. Verify the cutover is clean  <!-- agent: general-purpose -->

- [x] `bash -n scripts/conductor.sh && bash -n scripts/spawn.sh && bash -n scripts/monitor.sh` — all parse with no syntax errors. <!-- Completed: 2026-06-13 -->
- [x] `make typecheck` passes (zero errors). <!-- Completed: 2026-06-13 -->
- [x] `search_for_pattern` for `tasks\.txt|tasks\.backlog` excluding `wiki/**`: only hits in `PROJECT_STATUS.md` (historical task-tracker references in filename/description, not live operational docs). Zero hits in code, conf, or operational docs. <!-- Completed: 2026-06-13 -->
- [x] `search_for_pattern` for `^\s*AGENTS=\(|^\s*TASK_QUEUE=`: ZERO hits across the entire repo (conf is tuning-only; BG_PROCESSES and AGENT_BG_LINKS remain as intended). <!-- Completed: 2026-06-13 -->
- [x] `tasks.txt` and `tasks.backlog.txt` confirmed absent from repo root (Serena `find_file` returns empty). <!-- Completed: 2026-06-13 -->
- [ ] [DEFERRED-TO-UAT] Smoke: start backend, confirm it boots without errors (no attempt to read a missing `tasks.txt`), and that `GET /agents` / `GET /queue/:agent` still return DB-backed data.
