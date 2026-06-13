---
id: TASK-003
title: "Create backend/db.ts — schema migrations and typed query helpers"
status: done
created: 2026-06-12
updated: 2026-06-12
depends_on: [TASK-002]
blocks: [TASK-004, TASK-005, TASK-006, TASK-007, TASK-008]
parallel_safe_with: [TASK-001]
uat: ""
tags: [backend, sqlite, db]
---

# TASK-003 — Create backend/db.ts — schema migrations and typed query helpers

## Objective

Create `backend/db.ts` — the SQLite database module for tmux-conductor. It opens (or creates) the conductor.db, runs schema migrations keyed off a `meta` table, and exposes typed synchronous query helpers for all domain entities: projects, agents, bg_processes, tasks, and schedules. This is the central data-access layer that all Phase 2 routes, Phase 3 shell scripts, and Phase 4 frontend changes build on top of.

## Approach

Uses `better-sqlite3` for synchronous SQLite access (consistent with the backend's synchronous Fastify handler style). Schema is versioned via a `meta` table — `openDb()` checks `meta.schema_version` and runs only the missing migration steps. Full schema is defined in the design plan at `/Users/davidtaylor/.claude/plans/let-s-figure-out-a-sequential-bengio.md`.

Key design choices from the plan:
- WAL mode + `busy_timeout=5000` for cross-process safety with shell scripts
- `foreign_keys=ON` per-connection (SQLite pragma, not persistent)
- `seedFromLegacy()` runs once on first open (guarded by `meta.legacy_import`): imports `AGENTS`/`BG_PROCESSES`/`AGENT_BG_LINKS` from conf + `tasks.txt` and `tasks.backlog.txt`
- All query helpers are synchronous (better-sqlite3 `.prepare().run()` / `.get()` / `.all()`)
- Atomic pop is a single `DELETE … RETURNING` with priority ordering: agent-scoped → project-scoped → global

## Steps

### 1. Create backend/db.ts with openDb and schema  <!-- agent: general-purpose -->

- [ ] Create `backend/db.ts` (new file — use `Write` tool, this is a new file not an existing one)
- [ ] Import `Database` from `better-sqlite3`; import `readConductorConf` from `./config` (needed for seed)
- [ ] Implement `openDb(dbPath: string): Database.Database`:
  - `fs.mkdirSync(path.dirname(dbPath), { recursive: true })`
  - Open DB: `const db = new Database(dbPath)`
  - Set pragmas: `PRAGMA journal_mode = WAL`, `PRAGMA foreign_keys = ON`, `PRAGMA busy_timeout = 5000`
  - Run `runMigrations(db)`
  - Call `seedFromLegacy(db)` (no-op if already seeded)
  - Return `db`
- [ ] Implement `runMigrations(db)`:
  - Create `meta` table if not exists: `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`
  - Read `meta.schema_version`; if missing or < 1, run migration 1 (all table CREATE statements below)
  - Update `meta.schema_version` to `'1'` after success
- [ ] Migration 1 — create all tables per the schema in the design plan:
  ```sql
  CREATE TABLE projects (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE CHECK (name GLOB '[A-Za-z0-9_-]*'),
    workdir TEXT NOT NULL,
    default_launch_cmd TEXT NOT NULL DEFAULT 'claude --dangerously-skip-permissions',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  );
  CREATE TABLE agents (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE CHECK (name GLOB '[A-Za-z0-9_-]*'),
    workdir TEXT NOT NULL,
    launch_cmd TEXT NOT NULL,
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  );
  CREATE TABLE bg_processes (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE CHECK (name GLOB '[A-Za-z0-9_-]*'),
    workdir TEXT NOT NULL,
    launch_cmd TEXT NOT NULL,
    linked_agent_id INTEGER REFERENCES agents(id) ON DELETE SET NULL
  );
  CREATE TABLE schedules (
    id INTEGER PRIMARY KEY,
    name TEXT,
    command TEXT NOT NULL,
    interval_seconds INTEGER NOT NULL CHECK (interval_seconds >= 5),
    action TEXT NOT NULL DEFAULT 'append' CHECK (action IN ('append','jump')),
    agent_id INTEGER REFERENCES agents(id) ON DELETE CASCADE,
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    enabled INTEGER NOT NULL DEFAULT 1,
    skip_if_pending INTEGER NOT NULL DEFAULT 1,
    last_enqueued_at INTEGER,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    CHECK (agent_id IS NULL OR project_id IS NULL)
  );
  CREATE TABLE tasks (
    id INTEGER PRIMARY KEY,
    command TEXT NOT NULL,
    agent_id INTEGER REFERENCES agents(id) ON DELETE CASCADE,
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    position REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','backlog')),
    source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','schedule')),
    schedule_id INTEGER REFERENCES schedules(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    CHECK (agent_id IS NULL OR project_id IS NULL)
  );
  CREATE INDEX idx_tasks_pick ON tasks(status, position);
  ```

### 2. Typed interfaces and DB path resolution  <!-- agent: general-purpose -->

- [ ] Export TypeScript interfaces matching DB rows:
  - `Project`, `Agent`, `BgProcess`, `Task`, `Schedule` — field names in camelCase matching the DB columns (snake→camel)
- [ ] Export `getDbPath(conf: ConductorConf): string` — reads `conf.dbPath` (if set) else falls back to `path.join(path.dirname(conf._confPath), 'data/conductor.db')`
  - Note: `conf._confPath` — check if ConductorConf already exposes the conf file path; if not, add it to the interface in `backend/config.ts` (the conf loader already knows the path)

### 3. Projects CRUD helpers  <!-- agent: general-purpose -->

- [ ] `listProjects(db): Project[]` — `SELECT * FROM projects ORDER BY name`
- [ ] `createProject(db, data: {name, workdir, defaultLaunchCmd?}): Project`
- [ ] `updateProject(db, id, data: Partial<{name, workdir, defaultLaunchCmd}>): Project`
- [ ] `deleteProject(db, id, force?: boolean): void` — throws if agents exist and `!force`; with force, SET NULL via FK cascade
- [ ] `nextAgentName(db, projectId: number): string` — SELECT agents WHERE project_id=?, find max suffix N of `<project>-N`, return `<project>-(N+1)` or `<project>-1`

### 4. Agents and BgProcesses CRUD helpers  <!-- agent: general-purpose -->

- [ ] `listAgents(db): Agent[]` — `SELECT * FROM agents ORDER BY name`
- [ ] `createAgent(db, data: {name, workdir, launchCmd, projectId?}): Agent`
- [ ] `deleteAgent(db, id: number): void`
- [ ] `listBgProcesses(db): BgProcess[]`
- [ ] `createBgProcess(db, data: {name, workdir, launchCmd, linkedAgentId?}): BgProcess`
- [ ] `deleteBgProcess(db, id: number): void`

### 5. Task queue helpers  <!-- agent: general-purpose -->

- [ ] `listTasksForAgent(db, agentName: string): Task[]` — mirrors the atomic pop SELECT (same precedence): agent-scoped + project-scoped + global, status='queued', ordered by scope priority then position
- [ ] `addTask(db, data: {command, agentId?, projectId?, placement?: 'tail'|'head', source?: 'manual'|'schedule', scheduleId?}): Task`
  - tail: `position = MAX(position)+1` (or 1.0 if empty)
  - head: `position = MIN(position)-1` (or -1.0 if empty)
- [ ] `deleteTask(db, id: number): void`
- [ ] `reorderTasks(db, orderedIds: number[]): void` — transaction: read current positions of those rows, reassign them in the given order
- [ ] `jumpTaskToHead(db, id: number): void` — `UPDATE tasks SET position = (SELECT MIN(position)-1 FROM tasks WHERE status='queued') WHERE id=?`
- [ ] `popTask(db, agentName: string): {id: number, command: string, kind: 'scoped'|'project'|'global'} | null` — atomic `DELETE … RETURNING` per the design plan SQL
- [ ] `moveToBacklog(db, agentId: number): void` — `UPDATE tasks SET status='backlog' WHERE agent_id=? AND status='queued'`
- [ ] `restoreBacklog(db, agentId: number): void` — `UPDATE tasks SET status='queued' WHERE agent_id=? AND status='backlog'`

### 6. Schedules CRUD + scheduler helpers  <!-- agent: general-purpose -->

- [ ] `listSchedules(db): Schedule[]`
- [ ] `createSchedule(db, data: {name?, command, intervalSeconds, action?, agentId?, projectId?, skipIfPending?}): Schedule`
- [ ] `updateSchedule(db, id, data: Partial<Schedule>): Schedule`
- [ ] `deleteSchedule(db, id: number): void`
- [ ] `dueSchedules(db, nowEpoch: number): Schedule[]` — `SELECT * FROM schedules WHERE enabled=1 AND (last_enqueued_at IS NULL OR last_enqueued_at + interval_seconds <= ?)`
- [ ] `fireSchedule(db, schedule: Schedule, nowEpoch: number): Task | null` — transaction:
  - If `skip_if_pending=1`, check if a task from this schedule already exists queued: `SELECT 1 FROM tasks WHERE schedule_id=? AND status='queued' LIMIT 1` — if yes, return null
  - Call `addTask(db, {command, agentId, projectId, placement: action==='jump'?'head':'tail', source:'schedule', scheduleId: schedule.id})`
  - `UPDATE schedules SET last_enqueued_at=? WHERE id=?`
  - Return the inserted task row

### 7. seedFromLegacy  <!-- agent: general-purpose -->

- [ ] `seedFromLegacy(db)`:
  - Check `db.prepare("SELECT value FROM meta WHERE key='legacy_import'").get()` — if exists, return immediately (idempotent)
  - Call `readConductorConf()` to get conf (agents, bgProcesses, agentBgLinks, taskQueue)
  - For each agent in `conf.agents`: `createAgent(db, {name, workdir, launchCmd})`
  - For each bgProcess in `conf.bgProcesses`: `createBgProcess(db, {name, workdir, launchCmd})`
  - For each link in `conf.agentBgLinks`: `UPDATE bg_processes SET linked_agent_id=(SELECT id FROM agents WHERE name=?) WHERE name=?`
  - Read `tasks.txt` (resolve against conf dir): parse scoped lines (`agentname: cmd`) and global lines; insert via `addTask` with appropriate `agentId` or null
  - Read `tasks.backlog.txt` if present: same parsing, but `status='backlog'`
  - `db.prepare("INSERT INTO meta VALUES ('legacy_import','1')").run()`
  - Log: `console.log('[conductor] Legacy import complete — agents:', conf.agents.length, 'tasks:', taskCount)`

### 8. Static verification  <!-- agent: general-purpose -->

- [ ] Run `cd backend && npx tsc --noEmit` to confirm no type errors in `db.ts` or related files
- [ ] If `config.ts` was modified (to expose `_confPath`), verify it still compiles and no references broke
