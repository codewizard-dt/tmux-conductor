---
id: TASK-024
title: "Strip AGENTS/BG_PROCESSES/AGENT_BG_LINKS/TASK_QUEUE from conductor.conf and retire tasks.txt"
status: todo
created: 2026-06-12
updated: 2026-06-12
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

- [ ] Use Serena `search_for_pattern` over `backend/` for `declare -p AGENTS` / `parseDeclare\(.*'AGENTS'` / `appendAgentToConf|removeAgentFromConf|appendBgProcessToConf|removeBgProcessFromConf|addBgLink|removeBgLink`.
  - If any of these still exist in `backend/config.ts`, TASK-023 is **not** complete — STOP and report the blocker rather than stripping the conf (a live reader would break).
- [ ] Confirm `scripts/lib/db.sh` defines `load_agents`, `load_bg`, and `pop_task_sql`, and that `scripts/monitor.sh`'s `pop_task` delegates to `pop_task_sql` (these are the SQLite replacements proving the conf arrays / `tasks.txt` are no longer the runtime source).

### 1. Strip the four data blocks from conductor.conf  <!-- agent: general-purpose -->

- [ ] Edit `conductor.conf` (config file → use the `Edit` tool, not Serena symbolic edits):
  - [ ] Delete the `# --- Agents ---` data block: remove the `AGENTS=(…)` array (currently lines ~21–25) and the now-stale array-format comment lines (~9–16) that document the `name:working_dir:launch_cmd` array shape. Keep `CLAUDE_FLAGS` but reword its comment so it no longer says "passed to every agent launch command in AGENTS"; make it array-agnostic ("appended to each DB-defined agent's launch command").
  - [ ] Delete the entire `# --- Background processes ---` comment header + `BG_PROCESSES=(…)` array (currently lines ~27–37).
  - [ ] Delete the entire `# --- Agent ↔ bg-process links ---` comment header + `AGENT_BG_LINKS=(…)` array (currently lines ~39–49), including the `CONDUCTOR_BG_NAME/LOG/STATE` explanatory comment.
  - [ ] Delete the entire `# --- Task queue ---` comment header + `TASK_QUEUE="./tasks.txt"` line and its examples (currently lines ~121–133).
- [ ] Add a one-line breadcrumb near the top of the conf noting that agents, background processes, agent↔bg links, and the task queue now live in SQLite (`DB_PATH`), managed via the dashboard and `scripts/add-task.sh`.
- [ ] Verify the resulting conf contains ONLY tuning keys and no remaining `AGENTS=`/`BG_PROCESSES=`/`AGENT_BG_LINKS=`/`TASK_QUEUE=` tokens.

### 2. Remove tasks.txt plumbing from the spawn scripts  <!-- agent: general-purpose -->

- [ ] `scripts/conductor.sh` (shell → use Serena file/line tools, not `sed`):
  - [ ] Remove the `TASK_QUEUE` path-resolution `case` line (~26).
  - [ ] Remove the entire backlog-restore block (~31–41): `_backlog_file=…tasks.backlog.txt`, the `if [ -f … ]` concat/`mv`/truncate logic, and the trailing `unset _backlog_file _backlog_count _tmp_queue`.
  - [ ] Fix the startup summary `echo "Queue:    $TASK_QUEUE (…)"` (~47): replace with a SQLite-derived count (e.g. query `sql "SELECT COUNT(*) FROM tasks WHERE status='queued'"` via `db.sh`) or drop the Queue line entirely if a count helper isn't readily available — pick whichever keeps output truthful.
  - [ ] Update the top-of-file comment (~10–11) that lists `TASK_QUEUE` among the vars the explicit conf-source provides, since it no longer exists.
- [ ] `scripts/spawn.sh`: apply the identical removals — `TASK_QUEUE` `case` line (~24), backlog-restore block (~29–37), and any `$TASK_QUEUE` echo/summary reference.
- [ ] Confirm `CONDUCTOR_BG_NAME/CONDUCTOR_BG_LOG/CONDUCTOR_BG_STATE` env construction in both scripts is left intact — those derive from the DB-loaded `AGENT_BG`/`load_bg` arrays, not from the conf keys being removed.

### 3. Drop the docker mount and the backend legacy file-import  <!-- agent: general-purpose -->

- [ ] `docker-compose.yml` (config → `Edit` tool): remove the `- ./tasks.txt:/app/tasks.txt` volume mount line (~17). Verify no other service references `tasks.txt`.
- [ ] `backend/db.ts` (TypeScript → Serena symbolic/file edits): in `seedFromLegacy()`, remove the `tasks.txt` import branch — the `conf.taskQueue` guard, `fs.readFileSync(conf.taskQueue, …)`, the `backlogPath = conf.taskQueue.replace(/\.txt$/, '.backlog.txt')` derivation, and the `tasks.backlog.txt` read (~259–271). Leave the function's agent/bg/link seeding alone if TASK-023 hasn't already removed it (it becomes inert once `conf.agents/bgProcesses/agentBgLinks` are gone); only the file-queue import is this task's concern.
  - [ ] If removing the import leaves `importTaskLines()` (~280–320) with no callers, delete it too. Use Serena `find_referencing_symbols` on `importTaskLines` to decide.
- [ ] Run `make typecheck` (or the project's backend tsc target) and fix any type errors introduced by the `db.ts` edit before proceeding.

### 4. Delete the legacy queue files  <!-- agent: general-purpose -->

- [ ] `git rm tasks.txt tasks.backlog.txt` at the repo root (both are tracked; not gitignored). Use `git rm` so the deletion is staged, not a bare `rm`.
- [ ] Confirm `.gitignore` already gitignores `data/` (line ~220) so the SQLite DB stays untracked — no `.gitignore` change is required for tasks.txt (it was tracked, now removed). Add an explanatory note only if the team wants to prevent re-creation; otherwise leave `.gitignore` unchanged.

### 5. Sync live documentation  <!-- agent: general-purpose -->

- [ ] Update each of these live docs to describe the SQLite-backed model and remove claims that the conf holds AGENTS/BG_PROCESSES/AGENT_BG_LINKS/TASK_QUEUE or that the queue is `tasks.txt`:
  - [ ] `README.md` — the "Tasks are stored in a plain-text file (tasks.txt)" line, the "Inputs: conductor.conf (AGENTS array, BG_PROCESSES, …, TASK_QUEUE), tasks.txt" line, and the `QUEUE["tasks.txt\ntask queue"]` mermaid node (relabel to the SQLite tasks table).
  - [ ] `CONDUCTOR.md` — tasks.txt format/examples/manual-edit guidance → describe DB-backed queue + `add-task.sh` / dashboard.
  - [ ] `ELEVATOR_PITCH.md` — tasks.txt queue + scoped-prefix description.
  - [ ] `conductor-workflow.flowchart.md` — tasks.txt workflow node.
  - [ ] `SCRIPTS_GLOSSARY.md` — `monitor.sh`/`add-task.sh` descriptions that mention tasks.txt.
  - [ ] `CLAUDE.md` — the `add-task.sh` "appends to tasks.txt" line and any `BG_PROCESSES`/array-parsing prose in the script table and Key Design Decisions that now contradict the DB model. Keep edits minimal and factual; do not rewrite unrelated sections.
- [ ] Do NOT touch `wiki/work/**`, `.docs/**`, or `raw/**` — those are historical/immutable records of prior state.

### 6. Verify the cutover is clean  <!-- agent: general-purpose -->

- [ ] `bash -n scripts/conductor.sh && bash -n scripts/spawn.sh && bash -n scripts/monitor.sh` — all parse with no syntax errors.
- [ ] `make typecheck` (backend) passes.
- [ ] Serena `search_for_pattern` for `tasks\.txt|tasks\.backlog` excluding `wiki/**`, `.docs/**`, `raw/**`, `node_modules/**` → expect ZERO live hits.
- [ ] Serena `search_for_pattern` for `^\s*AGENTS=\(|^\s*BG_PROCESSES=\(|^\s*AGENT_BG_LINKS=\(|^\s*TASK_QUEUE=` across the repo (same exclusions) → expect ZERO hits (conf is now tuning-only).
- [ ] `mcp__serena__list_dir(".")` confirms `tasks.txt` and `tasks.backlog.txt` no longer exist at the repo root.
- [ ] Smoke: start the backend, confirm it boots without errors (no attempt to read a missing `tasks.txt`), and that `GET /agents` / `GET /queue/:agent` still return DB-backed data. Defer full end-to-end queue/dispatch validation to TASK-026 (the e2e verification suite).
