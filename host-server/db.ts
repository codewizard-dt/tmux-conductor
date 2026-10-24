import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { readConductorConf, DEFAULT_CONF_PATH, type ConductorConf } from './config.ts';
import { getGitRoot, tryCreateWorktree, siblingWorktreePath, removeWorktree, branchExists, deleteBranch, pruneWorktrees } from './git.ts';
import { WorktreeError } from './worktreeErrors.ts';
import { applyRoleFragmentToWorktree } from './rolePresets.ts';

// ─── Row interfaces ───────────────────────────────────────────────────────────

export interface Project {
  id: number;
  name: string;
  workdir: string;
  defaultLaunchCmd: string;
  createdAt: string;
}

export interface Agent {
  id: number;
  name: string;
  workdir: string;
  launchCmd: string;
  projectId: number | null;
  projectName: string | null;
  worktreePath: string | null;
  branch: string | null;
  role: string;
  description: string | null;
  createdAt: string;
}

/** Globally unique tmux window name for an agent. Project-scoped agents get
 *  `${project}-${agent}` so two agents with the same short name in different
 *  projects never collide in the shared tmux session namespace. */
export function agentWindowName(agent: Pick<Agent, 'name' | 'projectName'>): string {
  return agent.projectName ? `${agent.projectName}-${agent.name}` : agent.name;
}

/**
 * Derived bg-process identity (TASK-0196): `<projectName>-<name>`, or the bare
 * `name` for a legacy row that has no project. Mirrors `agentWindowName()`; drives the
 * tmux window name, `$LOG_DIR/bg-<slug>.log`, `$STATE_DIR/bg-<slug>.state` and the
 * `/bg-processes/:slug` routes. `-` is legal in both parts, so distinct
 * (project, name) pairs can collide on one slug — creation must check `listBgSlugs`.
 */
export function bgSlug(bg: Pick<BgProcess, 'name'>, projectName: string | null | undefined): string {
  return projectName ? `${projectName}-${bg.name}` : bg.name;
}

const BG_SLUG_SQL = `COALESCE(p.name || '-' || b.name, b.name)`;

/** Resolve a bg process by its derived slug. On a (pre-existing) slug collision the lowest id wins. */
export function getBgBySlug(db: Database.Database, slug: string): (BgProcess & { projectName: string | null }) | undefined {
  const row = db
    .prepare(
      `SELECT b.*, p.name AS project_name FROM bg_processes b LEFT JOIN projects p ON p.id = b.project_id WHERE ${BG_SLUG_SQL} = ? ORDER BY b.id LIMIT 1`
    )
    .get(slug) as (BgProcessRow & { project_name: string | null }) | undefined;
  if (!row) return undefined;
  return { ...mapBgProcess(row), projectName: row.project_name };
}

/** Every bg process's slug, for slug-collision checks on create/update. */
export function listBgSlugs(db: Database.Database): string[] {
  const rows = db
    .prepare(`SELECT ${BG_SLUG_SQL} AS slug FROM bg_processes b LEFT JOIN projects p ON p.id = b.project_id ORDER BY b.id`)
    .all() as Array<{ slug: string }>;
  return rows.map((r) => r.slug);
}

/**
 * Pure slug-collision predicate (TASK-0196). A candidate bg slug is taken when it
 * equals another bg slug, or an agent tmux window name (`agentWindowName()`) — agent
 * and bg windows share one tmux session namespace. `-` is legal in project and process
 * names, so different (project, name) pairs can produce the same slug.
 */
export function bgSlugCollides(slug: string, bgSlugs: Iterable<string>, agentWindowNames: Iterable<string>): boolean {
  for (const s of bgSlugs) if (s === slug) return true;
  for (const w of agentWindowNames) if (w === slug) return true;
  return false;
}

export interface BgProcess {
  id: number;
  name: string;
  workdir: string;
  launchCmd: string;
  projectId: number | null;
}

export interface Task {
  id: number;
  command: string;
  agentId: number | null;
  projectId: number | null;
  position: number;
  status: 'queued' | 'backlog' | 'done';
  source: 'manual' | 'schedule';
  scheduleId: number | null;
  createdAt: string;
  completedAt?: string | null;
}

export interface Schedule {
  id: number;
  name: string | null;
  command: string;
  intervalSeconds: number;
  action: 'append' | 'jump';
  agentId: number | null;
  projectId: number | null;
  enabled: number;
  skipIfPending: number;
  lastEnqueuedAt: number | null;
  createdAt: string;
}

/** One row per (agent, session): rolling per-session token/cost totals that the
 *  poll-cycle writer overwrites idempotently (per-message JSONL usage values are
 *  streaming snapshots, not durable increments). */
export interface AgentUsage {
  id: number;
  agentId: number;
  sessionStart: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  costUsd: number;
  updatedAt: string;
}

export interface AgentUsageTotals {
  agentId: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  costUsd: number;
  sessions: number;
}

export interface AgentCheckpoint {
  id: number;
  agentId: number;
  ts: number;
  stashRef: string;
  createdAt: number;
}


export interface AgentTerminalLog {
  id: number;
  agentId: number;
  ts: string;
  chunk: string;
}

// Raw DB row shapes (snake_case from SQLite) ──────────────────────────────────

interface ProjectRow {
  id: number;
  name: string;
  workdir: string;
  default_launch_cmd: string;
  created_at: string;
}

interface AgentRow {
  id: number;
  name: string;
  workdir: string;
  launch_cmd: string;
  project_id: number | null;
  worktree_path?: string | null;
  branch?: string | null;
  role: string;
  description?: string | null;
  created_at: string;
}

interface AgentWithProjectRow extends AgentRow {
  project_name: string | null;
}

interface BgProcessRow {
  id: number;
  name: string;
  workdir: string;
  launch_cmd: string;
  project_id: number | null;
}

interface TaskRow {
  id: number;
  command: string;
  agent_id: number | null;
  project_id: number | null;
  position: number;
  status: string;
  source: string;
  schedule_id: number | null;
  created_at: string;
  completed_at: string | null;
}

interface ScheduleRow {
  id: number;
  name: string | null;
  command: string;
  interval_seconds: number;
  action: string;
  agent_id: number | null;
  project_id: number | null;
  enabled: number;
  skip_if_pending: number;
  last_enqueued_at: number | null;
  created_at: string;
}

interface AgentUsageRow {
  id: number;
  agent_id: number;
  session_start: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  cost_usd: number;
  updated_at: string;
}

interface AgentCheckpointRow {
  id: number;
  agent_id: number;
  ts: number;
  stash_ref: string;
  created_at: number;
}


interface AgentTerminalLogRow {
  id: number;
  agent_id: number;
  ts: string;
  chunk: string;
}

// ─── Row mappers ──────────────────────────────────────────────────────────────

function mapProject(r: ProjectRow): Project {
  return { id: r.id, name: r.name, workdir: r.workdir, defaultLaunchCmd: r.default_launch_cmd, createdAt: r.created_at };
}

function mapAgent(r: AgentRow | AgentWithProjectRow): Agent {
  const projectName = 'project_name' in r ? r.project_name : null;
  return { id: r.id, name: r.name, workdir: r.workdir, launchCmd: r.launch_cmd, projectId: r.project_id, projectName, worktreePath: r.worktree_path ?? null, branch: r.branch ?? null, role: r.role, description: r.description ?? null, createdAt: r.created_at };
}

function mapBgProcess(r: BgProcessRow): BgProcess {
  return { id: r.id, name: r.name, workdir: r.workdir, launchCmd: r.launch_cmd, projectId: r.project_id };
}

function mapTask(r: TaskRow): Task {
  return {
    id: r.id, command: r.command, agentId: r.agent_id, projectId: r.project_id,
    position: r.position, status: r.status as Task['status'], source: r.source as Task['source'],
    scheduleId: r.schedule_id, createdAt: r.created_at, completedAt: r.completed_at,
  };
}

function mapSchedule(r: ScheduleRow): Schedule {
  return {
    id: r.id, name: r.name, command: r.command, intervalSeconds: r.interval_seconds,
    action: r.action as Schedule['action'], agentId: r.agent_id, projectId: r.project_id,
    enabled: r.enabled, skipIfPending: r.skip_if_pending, lastEnqueuedAt: r.last_enqueued_at,
    createdAt: r.created_at,
  };
}

function mapAgentUsage(r: AgentUsageRow): AgentUsage {
  return {
    id: r.id, agentId: r.agent_id, sessionStart: r.session_start,
    inputTokens: r.input_tokens, outputTokens: r.output_tokens,
    cacheCreationInputTokens: r.cache_creation_input_tokens,
    cacheReadInputTokens: r.cache_read_input_tokens,
    costUsd: r.cost_usd, updatedAt: r.updated_at,
  };
}

function mapAgentCheckpoint(r: AgentCheckpointRow): AgentCheckpoint {
  return { id: r.id, agentId: r.agent_id, ts: r.ts, stashRef: r.stash_ref, createdAt: r.created_at };
}


function mapAgentTerminalLog(r: AgentTerminalLogRow): AgentTerminalLog {
  return { id: r.id, agentId: r.agent_id, ts: r.ts, chunk: r.chunk };
}

// ─── DB path resolution ───────────────────────────────────────────────────────

export function getDbPath(conf: ConductorConf): string {
  if (process.env['CONDUCTOR_DB']) return process.env['CONDUCTOR_DB'];
  const confDir = path.dirname(path.resolve(conf._confPath || DEFAULT_CONF_PATH));
  if (conf.dbPath) return path.resolve(confDir, conf.dbPath);
  return path.join(confDir, 'data', 'conductor.db');
}

// ─── Open / bootstrap ─────────────────────────────────────────────────────────

export function openDb(dbPath: string): Database.Database {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  runMigrations(db);
  seedFromLegacy(db);
  backfillBgProcessProjects(db);
  enforceBgProjectRequired(db);
  return db;
}

// ─── Migrations ───────────────────────────────────────────────────────────────

function runMigrations(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  const versionRow = db.prepare(`SELECT value FROM meta WHERE key='schema_version'`).get() as { value: string } | undefined;
  const version = versionRow ? parseInt(versionRow.value, 10) : 0;
  if (version < 1) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE CHECK (name GLOB '[A-Za-z0-9_-]*'),
        workdir TEXT NOT NULL,
        default_launch_cmd TEXT NOT NULL DEFAULT 'claude --dangerously-skip-permissions --append-system-prompt-file ~/.claude/rules/agent-teams-preference.md',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      );
      CREATE TABLE IF NOT EXISTS agents (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE CHECK (name GLOB '[A-Za-z0-9_-]*'),
        workdir TEXT NOT NULL,
        launch_cmd TEXT NOT NULL,
        project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      );
      CREATE TABLE IF NOT EXISTS bg_processes (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE CHECK (name GLOB '[A-Za-z0-9_-]*'),
        workdir TEXT NOT NULL,
        launch_cmd TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS schedules (
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
      CREATE TABLE IF NOT EXISTS tasks (
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
      CREATE INDEX IF NOT EXISTS idx_tasks_pick ON tasks(status, position);
    `);
    db.prepare(`INSERT OR REPLACE INTO meta VALUES ('schema_version', '1')`).run();
  }
  if (version < 2) {
    // Replace global UNIQUE on agents.name with per-project uniqueness.
    // SQLite requires a full table rebuild to change constraints.
    db.pragma('foreign_keys = OFF');
    db.transaction(() => {
      db.exec(`
        CREATE TABLE agents_v2 (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL CHECK (name GLOB '[A-Za-z0-9_-]*'),
          workdir TEXT NOT NULL,
          launch_cmd TEXT NOT NULL,
          project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
        );
        INSERT INTO agents_v2 SELECT * FROM agents;
        DROP TABLE agents;
        ALTER TABLE agents_v2 RENAME TO agents;
        CREATE UNIQUE INDEX idx_agents_project_name ON agents(project_id, name) WHERE project_id IS NOT NULL;
        CREATE UNIQUE INDEX idx_agents_null_name ON agents(name) WHERE project_id IS NULL;
      `);
    })();
    db.pragma('foreign_keys = ON');
    db.prepare(`INSERT OR REPLACE INTO meta VALUES ('schema_version', '2')`).run();
  }
  if (version < 3) {
    db.exec(`ALTER TABLE agents ADD COLUMN worktree_path TEXT`);
    db.exec(`ALTER TABLE agents ADD COLUMN branch TEXT`);
    db.prepare(`INSERT OR REPLACE INTO meta VALUES ('schema_version', '3')`).run();
  }
  if (version < 4) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS agent_usage (
        id INTEGER PRIMARY KEY,
        agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        session_start TEXT NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cache_creation_input_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read_input_tokens INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
        UNIQUE (agent_id, session_start)
      );
    `);
    db.prepare(`INSERT OR REPLACE INTO meta VALUES ('schema_version', '4')`).run();
  }
  if (version < 5) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS agent_checkpoints (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        ts INTEGER NOT NULL,
        stash_ref TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_agent_checkpoints_agent_id ON agent_checkpoints(agent_id);
    `);
    db.prepare(`INSERT OR REPLACE INTO meta VALUES ('schema_version', '5')`).run();
  }
  if (version < 6) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS agent_terminal_log (
        id INTEGER PRIMARY KEY,
        agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
        chunk TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_agent_terminal_log_agent_ts ON agent_terminal_log(agent_id, ts);
    `);
    db.prepare(`INSERT OR REPLACE INTO meta VALUES ('schema_version', '6')`).run();
  }
  if (version < 7) {
    db.exec(`ALTER TABLE agents ADD COLUMN role TEXT NOT NULL DEFAULT 'generic' CHECK (role IN ('generic','frontend','backend','qa','devops','security','architect'))`);
    db.prepare(`INSERT OR REPLACE INTO meta VALUES ('schema_version', '7')`).run();
  }
  if (version < 8) {
    // TASK-125: task pop moves from a hard DELETE to a soft status flip
    // (status='done' + completed_at set) so completed tasks remain queryable
    // for a history view instead of vanishing on dispatch. SQLite cannot
    // ALTER a CHECK constraint in place, so widening tasks.status's allowed
    // values to include 'done' requires the same table-rebuild pattern used
    // for the v2 agents migration above: create the new-shape table, copy
    // every row across explicitly (never SELECT *, so column order/defaults
    // can't silently mismatch), drop the old table, rename, recreate the index.
    db.pragma('foreign_keys = OFF');
    db.transaction(() => {
      db.exec(`
        CREATE TABLE tasks_v8 (
          id INTEGER PRIMARY KEY,
          command TEXT NOT NULL,
          agent_id INTEGER REFERENCES agents(id) ON DELETE CASCADE,
          project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
          position REAL NOT NULL,
          status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','backlog','done')),
          source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','schedule')),
          schedule_id INTEGER REFERENCES schedules(id) ON DELETE SET NULL,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
          completed_at TEXT,
          CHECK (agent_id IS NULL OR project_id IS NULL)
        );
        INSERT INTO tasks_v8 (id, command, agent_id, project_id, position, status, source, schedule_id, created_at)
          SELECT id, command, agent_id, project_id, position, status, source, schedule_id, created_at FROM tasks;
        DROP TABLE tasks;
        ALTER TABLE tasks_v8 RENAME TO tasks;
        CREATE INDEX IF NOT EXISTS idx_tasks_pick ON tasks(status, position);
      `);
    })();
    db.pragma('foreign_keys = ON');
    db.prepare(`INSERT OR REPLACE INTO meta VALUES ('schema_version', '8')`).run();
  }
  if (version < 9) {
    db.exec(`ALTER TABLE bg_processes ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL`);
    db.prepare(`INSERT OR REPLACE INTO meta VALUES ('schema_version', '9')`).run();
  }
  if (version < 10) {
    // The default launch command gained --append-system-prompt-file so every
    // agent loads the parallel-dispatch naming rule. Upgrade rows that still
    // hold the exact old default; customised commands are left untouched.
    const oldDefault = 'claude --dangerously-skip-permissions';
    const newDefault = 'claude --dangerously-skip-permissions --append-system-prompt-file ~/.claude/rules/agent-teams-preference.md';
    db.prepare(`UPDATE agents SET launch_cmd=? WHERE TRIM(launch_cmd)=?`).run(newDefault, oldDefault);
    db.prepare(`UPDATE projects SET default_launch_cmd=? WHERE TRIM(default_launch_cmd)=?`).run(newDefault, oldDefault);
    db.prepare(`INSERT OR REPLACE INTO meta VALUES ('schema_version', '10')`).run();
  }
  if (version < 11) {
    // TASK-0196: bg process names become unique per project, not globally, and
    // every bg process must belong to a project (TASK-0186 amendment). Rebuild
    // bg_processes (see rebuildBgProcesses). Legacy rows with no matching project
    // must not block startup: when any exist, the rebuild keeps project_id nullable
    // (guarded by a partial unique index on name) and enforceBgProjectRequired()
    // promotes it to NOT NULL on a later openDb once backfill/manual assignment has
    // resolved them. schema_version is bumped either way so later migrations are
    // never blocked by an unmatched row.
    seedBgProjectFromLinkedAgent(db);
    rebuildBgProcesses(db, { projectNotNull: countBgRowsMissingProject(db) === 0 });
    db.prepare(`INSERT OR REPLACE INTO meta VALUES ('schema_version', '11')`).run();
  }
  if (version < 12) {
    // TASK-0198: drop bg_processes.linked_agent_id (retired by TASK-0187, no longer
    // read or written since TASK-0197). rebuildBgProcesses always omits the column,
    // so a DB that still carries it (v11 or older that skipped the rebuild) is
    // seeded from the linked agent's project, then rebuilt. A DB that never had the
    // column (fresh install, or already rebuilt by v11 above) needs nothing.
    if (bgHasLinkedAgentColumn(db)) {
      seedBgProjectFromLinkedAgent(db);
      rebuildBgProcesses(db, { projectNotNull: countBgRowsMissingProject(db) === 0 });
    }
    db.prepare(`INSERT OR REPLACE INTO meta VALUES ('schema_version', '12')`).run();
  }
  if (version < 13) {
    // TASK-0199: free-text agent description (specialized-agent catalog). Nullable,
    // no CHECK — a plain ADD COLUMN suffices.
    db.exec(`ALTER TABLE agents ADD COLUMN description TEXT`);
    db.prepare(`INSERT OR REPLACE INTO meta VALUES ('schema_version', '13')`).run();
  }
}

function seedFromLegacy(db: Database.Database): void {
  const guard = db.prepare(`SELECT value FROM meta WHERE key='legacy_import'`).get() as { value: string } | undefined;
  if (guard) return; // already imported

  let conf: ConductorConf;
  try {
    conf = readConductorConf();
  } catch {
    console.warn('[conductor] seedFromLegacy: could not read conf, skipping legacy import');
    db.prepare(`INSERT INTO meta VALUES ('legacy_import', '0')`).run();
    return;
  }

  const insertAgent = db.prepare(`INSERT OR IGNORE INTO agents (name, workdir, launch_cmd) VALUES (?, ?, ?)`);
  // bg_processes names are unique per project (schema v11) and every bg process
  // needs a project, so a legacy conf bg entry is only seeded when its workdir
  // resolves to exactly one project; otherwise it is skipped with a warning
  // (a NULL-project row would violate NOT NULL, or, on a deferred DB, sit unowned).
  // INSERT OR IGNORE now dedupes on (project_id, name), so re-seeding never
  // duplicates an existing row.
  const insertBg = db.prepare(`INSERT OR IGNORE INTO bg_processes (name, workdir, launch_cmd, project_id) VALUES (?, ?, ?, ?)`);

  const seedTx = db.transaction(() => {
    for (const agent of conf.agents) {
      insertAgent.run(agent.name, agent.workdir, agent.launchCmd);
    }
    const projects = db.prepare(`SELECT id, workdir FROM projects`).all() as Array<{ id: number; workdir: string }>;
    for (const bg of conf.bgProcesses) {
      const projectId = matchProjectIdByWorkdir(projects, bg.workdir);
      if (projectId === null) {
        console.warn(`[conductor] seedFromLegacy: skipping bg process '${bg.name}' — no unique project matches workdir ${bg.workdir}; add it via the dashboard once its project exists`);
        continue;
      }
      insertBg.run(bg.name, bg.workdir, bg.launchCmd, projectId);
    }

    db.prepare(`INSERT INTO meta VALUES ('legacy_import', '1')`).run();
  });

  seedTx();
  console.log(`[conductor] Legacy import complete — agents: ${String(conf.agents.length)}`);
}

// TASK-0195: every bg process must belong to a project. Rows created before
// that rule (bg_processes.project_id IS NULL) are backfilled by matching the
// bg process's workdir to a project's workdir (trailing slashes ignored). A row
// with no match, or with several equally-good matches, is left NULL and
// reported via console.warn for manual assignment; this never throws or drops
// rows. Idempotent and non-versioned: it runs on every openDb() (after the
// migrations and legacy seed) and only touches rows that are still NULL. The
// NOT NULL / ON DELETE CASCADE column rebuild is deliberately NOT done here
// (TASK-0196); it should be gated on this returning `unmatched: []`.
export function backfillBgProcessProjects(db: Database.Database): { matched: string[]; unmatched: string[] } {
  const norm = (p: string): string => (p.length > 1 ? p.replace(/\/+$/, '') : p);
  const orphans = db.prepare(`SELECT id, name, workdir FROM bg_processes WHERE project_id IS NULL ORDER BY name`).all() as Array<{ id: number; name: string; workdir: string }>;
  if (orphans.length === 0) return { matched: [], unmatched: [] };

  const projects = db.prepare(`SELECT id, workdir FROM projects`).all() as Array<{ id: number; workdir: string }>;
  const setProject = db.prepare(`UPDATE bg_processes SET project_id=? WHERE id=? AND project_id IS NULL`);
  const matched: string[] = [];
  const unmatched: string[] = [];
  db.transaction(() => {
    for (const bg of orphans) {
      const candidates = projects.filter((p) => norm(p.workdir) === norm(bg.workdir));
      const [only] = candidates;
      if (candidates.length === 1 && only) {
        setProject.run(only.id, bg.id);
        matched.push(bg.name);
      } else {
        unmatched.push(bg.name);
      }
    }
  })();
  if (matched.length > 0) {
    console.log(`[conductor] Backfilled project_id for ${String(matched.length)} bg process(es) by workdir: ${matched.join(', ')}`);
  }
  if (unmatched.length > 0) {
    console.warn(`[conductor] ${String(unmatched.length)} bg process(es) have no project and could not be matched to a project by workdir (assign a project manually): ${unmatched.join(', ')}`);
  }
  return { matched, unmatched };
}

/**
 * Count bg_processes rows that cannot satisfy `project_id NOT NULL REFERENCES
 * projects(id)`: rows with a NULL project_id or one that points at a project
 * that no longer exists. (SQLite only enforces the FK when foreign_keys=ON,
 * so a dangling id can survive from an older run.)
 */
function countBgRowsMissingProject(db: Database.Database): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM bg_processes WHERE project_id IS NULL OR project_id NOT IN (SELECT id FROM projects)`)
    .get() as { n: number };
  return row.n;
}

/** True while `bg_processes` still carries the retired `linked_agent_id` column (pre-v12 shape). */
function bgHasLinkedAgentColumn(db: Database.Database): boolean {
  const cols = db.pragma('table_info(bg_processes)') as Array<{ name: string }>;
  return cols.some((c) => c.name === 'linked_agent_id');
}

/**
 * Before `linked_agent_id` is dropped (TASK-0198), let it contribute its last bit of
 * data: an unscoped row (`project_id IS NULL`) inherits the project of the agent it
 * was linked to. Rows that already have a project are never overwritten, and rows
 * whose agent has no project stay NULL for the workdir backfill to handle. No-op once
 * the column is gone.
 */
function seedBgProjectFromLinkedAgent(db: Database.Database): void {
  if (!bgHasLinkedAgentColumn(db)) return;
  db.exec(`
    UPDATE bg_processes
       SET project_id = (SELECT a.project_id FROM agents a WHERE a.id = bg_processes.linked_agent_id)
     WHERE project_id IS NULL AND linked_agent_id IS NOT NULL
  `);
}

/**
 * Rebuild `bg_processes` into its per-project-unique shape (schema v11, TASK-0196).
 * SQLite cannot drop a column-level UNIQUE or add NOT NULL in place, so this follows
 * the v2/v8 table-rebuild pattern: foreign_keys=OFF, one transaction, create
 * `bg_processes_v11`, explicit-column INSERT...SELECT preserving `id`, DROP, RENAME,
 * recreate indexes, foreign_keys=ON.
 *
 * - The global `UNIQUE` on `name` is dropped; the `GLOB` CHECK is kept.
 * - `(project_id, name)` becomes the unique key (`idx_bg_processes_project_name`).
 * - `project_id` is `REFERENCES projects(id) ON DELETE CASCADE`, and `NOT NULL` when
 *   `projectNotNull` is true. When false (some legacy rows have no matching project
 *   yet) the column stays nullable and a partial unique index on `name WHERE
 *   project_id IS NULL` keeps NULL-project names unique, because SQLite treats NULLs
 *   as distinct inside a plain unique index.
 * - The retired `linked_agent_id` column is never copied (TASK-0198, schema v12), so any
 *   rebuild drops it. Callers that need its data (the project seed) must run
 *   `seedBgProjectFromLinkedAgent` first. A dangling `project_id` is nulled in the copy.
 *
 * Callers must ensure that, when `projectNotNull` is true, `countBgRowsMissingProject`
 * is 0. Idempotent in effect: safe to call again with the same shape.
 */
function rebuildBgProcesses(db: Database.Database, opts: { projectNotNull: boolean }): void {
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      db.exec(`
        DROP TABLE IF EXISTS bg_processes_v11;
        CREATE TABLE bg_processes_v11 (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL CHECK (name GLOB '[A-Za-z0-9_-]*'),
          workdir TEXT NOT NULL,
          launch_cmd TEXT NOT NULL,
          project_id INTEGER ${opts.projectNotNull ? 'NOT NULL ' : ''}REFERENCES projects(id) ON DELETE CASCADE
        );
        INSERT INTO bg_processes_v11 (id, name, workdir, launch_cmd, project_id)
          SELECT id, name, workdir, launch_cmd,
                 CASE WHEN project_id IN (SELECT id FROM projects) THEN project_id END
            FROM bg_processes ORDER BY id;
        DROP TABLE bg_processes;
        ALTER TABLE bg_processes_v11 RENAME TO bg_processes;
        CREATE UNIQUE INDEX idx_bg_processes_project_name ON bg_processes(project_id, name);
      `);
      if (!opts.projectNotNull) {
        db.exec(`CREATE UNIQUE INDEX idx_bg_processes_null_name ON bg_processes(name) WHERE project_id IS NULL`);
      }
      const violations = db.pragma('foreign_key_check(bg_processes)') as unknown[];
      if (violations.length > 0) {
        console.warn(`[conductor] bg_processes rebuild left ${String(violations.length)} foreign-key violation(s)`);
      }
    })();
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

/**
 * Deferred half of the TASK-0196 NOT NULL enforcement. Schema v11 leaves
 * `bg_processes.project_id` nullable when some legacy rows could not be matched to a
 * project (server startup must never fail on them). Once every row has a project —
 * after `backfillBgProcessProjects` or the operator assigning one — this promotes the
 * column to NOT NULL. Non-versioned and idempotent: a cheap `table_info` check on every
 * open, a rebuild at most once.
 */
function enforceBgProjectRequired(db: Database.Database): void {
  const cols = db.pragma('table_info(bg_processes)') as Array<{ name: string; notnull: number }>;
  const projectCol = cols.find((c) => c.name === 'project_id');
  if (!projectCol || projectCol.notnull === 1) return;
  if (countBgRowsMissingProject(db) > 0) return;
  rebuildBgProcesses(db, { projectNotNull: true });
  console.log('[conductor] bg_processes.project_id is now NOT NULL (every bg process has a project)');
}

/** Exact (trailing-slash-normalised) workdir match against exactly one project, else null. */
function matchProjectIdByWorkdir(projects: Array<{ id: number; workdir: string }>, workdir: string): number | null {
  const norm = (p: string): string => (p.length > 1 ? p.replace(/\/+$/, '') : p);
  const candidates = projects.filter((p) => norm(p.workdir) === norm(workdir));
  const [only] = candidates;
  return candidates.length === 1 && only ? only.id : null;
}

// ─── Projects CRUD ────────────────────────────────────────────────────────────

export function listProjects(db: Database.Database): Project[] {
  return (db.prepare(`SELECT * FROM projects ORDER BY name`).all() as ProjectRow[]).map(mapProject);
}

export function createProject(db: Database.Database, data: { name: string; workdir: string; defaultLaunchCmd?: string }): Project {
  const row = db.prepare(
    `INSERT INTO projects (name, workdir, default_launch_cmd) VALUES (?, ?, ?) RETURNING *`
  ).get(data.name, data.workdir, data.defaultLaunchCmd ?? 'claude --dangerously-skip-permissions --append-system-prompt-file ~/.claude/rules/agent-teams-preference.md') as ProjectRow;
  return mapProject(row);
}

export function updateProject(db: Database.Database, id: number, data: Partial<{ name: string; workdir: string; defaultLaunchCmd: string }>): Project {
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (data.name !== undefined) { sets.push('name=?'); vals.push(data.name); }
  if (data.workdir !== undefined) { sets.push('workdir=?'); vals.push(data.workdir); }
  if (data.defaultLaunchCmd !== undefined) { sets.push('default_launch_cmd=?'); vals.push(data.defaultLaunchCmd); }
  if (sets.length === 0) return listProjects(db).find(p => p.id === id) as Project;
  vals.push(id);
  const row = db.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id=? RETURNING *`).get(...vals) as ProjectRow | undefined;
  if (!row) throw new Error(`Project ${String(id)} not found`);
  return mapProject(row);
}

// Deletes a project together with every bg process scoped to it (TASK-0195:
// a bg process must always belong to a project, so it cannot outlive its
// project). The cascade is explicit here (so the removed rows can be returned
// for tmux cleanup) even though bg_processes.project_id is also ON DELETE
// CASCADE at the schema level since v11 (TASK-0196).
// The agents-conflict check runs before any write, and the bg-row deletes plus
// the project delete share one transaction. Returns the removed bg process
// rows so the caller can close their tmux windows / unlink state files.
export function deleteProject(db: Database.Database, id: number, force = false): BgProcess[] {
  if (!force) {
    const count = (db.prepare(`SELECT COUNT(*) as n FROM agents WHERE project_id=?`).get(id) as { n: number }).n;
    if (count > 0) throw new Error(`Project ${String(id)} has ${String(count)} agent(s) — pass force=true to delete anyway`);
  }
  return db.transaction((): BgProcess[] => {
    const removed = listBgProcesses(db, { projectId: id });
    db.prepare(`DELETE FROM bg_processes WHERE project_id=?`).run(id);
    db.prepare(`DELETE FROM projects WHERE id=?`).run(id);
    return removed;
  })();
}

export function nextAgentName(db: Database.Database, projectId: number, role: string = 'generic'): string {
  const project = db.prepare(`SELECT name FROM projects WHERE id=?`).get(projectId) as { name: string } | undefined;
  if (!project) throw new Error(`Project ${String(projectId)} not found`);
  const prefix = `${project.name}-${role}-`;
  const existing = db.prepare(`SELECT name FROM agents WHERE name GLOB ?`).all(prefix + '*') as { name: string }[];
  let max = 0;
  for (const a of existing) {
    if (a.name.startsWith(prefix)) {
      const n = parseInt(a.name.slice(prefix.length), 10);
      if (!isNaN(n) && n > max) max = n;
    }
  }
  return `${prefix}${String(max + 1)}`;
}

/**
 * Derive a unique name for a clone of `source`, starting from
 * `${source.name}-copy` and, on collision, trying `-copy-2`, `-copy-3`, …
 * until a free name is found. Collision scope mirrors the DB's uniqueness
 * indexes (idx_agents_project_name / idx_agents_null_name): scoped to
 * `source.projectId` when set, to project_id IS NULL otherwise.
 */
export function deriveCloneName(db: Database.Database, source: Agent): string {
  const rows = source.projectId != null
    ? db.prepare(`SELECT name FROM agents WHERE project_id = ?`).all(source.projectId) as { name: string }[]
    : db.prepare(`SELECT name FROM agents WHERE project_id IS NULL`).all() as { name: string }[];
  const existing = new Set(rows.map((r) => r.name));

  const base = `${source.name}-copy`;
  if (!existing.has(base)) return base;
  let n = 2;
  while (existing.has(`${base}-${String(n)}`)) n++;
  return `${base}-${String(n)}`;
}

// ─── Agents CRUD ──────────────────────────────────────────────────────────────

export function listAgents(db: Database.Database): Agent[] {
  return (db.prepare(
    `SELECT a.*, p.name AS project_name FROM agents a LEFT JOIN projects p ON a.project_id = p.id ORDER BY a.name`
  ).all() as AgentWithProjectRow[]).map(mapAgent);
}

function findAgentById(db: Database.Database, id: number): Agent {
  const agent = getAgentById(db, id);
  if (!agent) throw new Error(`Agent ${String(id)} not found`);
  return agent;
}

/** Resolve an agent by its globally-unique id, or undefined if absent. Agent
 *  names are only unique per project, so HTTP routes must address agents by id. */
export function getAgentById(db: Database.Database, id: number): Agent | undefined {
  const row = db.prepare(
    `SELECT a.*, p.name AS project_name FROM agents a LEFT JOIN projects p ON a.project_id = p.id WHERE a.id=?`
  ).get(id) as AgentWithProjectRow | undefined;
  return row ? mapAgent(row) : undefined;
}

export function createAgent(db: Database.Database, data: { name: string; workdir: string; launchCmd: string; projectId?: number; role?: string; description?: string; useWorktree?: boolean; requireWorktree?: boolean }): Agent {
  // TASK-0213: `requireWorktree` turns the best-effort worktree step below into
  // a hard requirement (an explicit "clone into a new worktree" request must
  // never silently hand back a second agent on the same directory). The
  // common not-a-repo case is refused before any row is written.
  const requireWorktree = data.useWorktree === true && data.requireWorktree === true;
  if (requireWorktree && !getGitRoot(data.workdir)) {
    throw new WorktreeError('not-git-repo', `workdir ${data.workdir} is not inside a git repository`);
  }

  // Guard against two agents resolving to the same tmux window name. The DB's
  // per-project name uniqueness doesn't catch cross-scope collisions on the
  // computed `${project}-${name}` window name, and a duplicate window name is
  // unaddressable in the shared tmux session (see the wake path's ambiguity
  // branch). Reject up front rather than spawning an un-wakeable agent.
  const projectName = data.projectId != null
    ? (db.prepare(`SELECT name FROM projects WHERE id=?`).get(data.projectId) as { name: string } | undefined)?.name ?? null
    : null;
  const newWindowName = agentWindowName({ name: data.name, projectName });
  if (listAgents(db).some((a) => agentWindowName(a) === newWindowName)) {
    throw new Error(`an agent with tmux window name '${newWindowName}' already exists`);
  }
  const row = db.prepare(
    `INSERT INTO agents (name, workdir, launch_cmd, project_id, role, description) VALUES (?, ?, ?, ?, ?, ?) RETURNING id`
  ).get(data.name, data.workdir, data.launchCmd, data.projectId ?? null, data.role ?? 'generic', data.description ?? null) as { id: number };

  // ROADMAP-007: worktree creation is opt-in only (data.useWorktree), never
  // automatic — it used to run for every agent whose workdir sat inside a
  // git repo, which silently created a worktree the caller never asked for.
  // `gitRoot` is `null` when workdir isn't a git repo (or git is
  // unavailable/times out); in that case we proceed without a worktree.
  // Worktree creation itself is still best-effort: a failure is logged as a
  // warning and the columns are left NULL, but it never aborts agent creation
  // — unless `requireWorktree` is set, in which case the just-inserted row is
  // rolled back and a WorktreeError is thrown.
  if (data.useWorktree) {
    const gitRoot = getGitRoot(data.workdir);
    if (gitRoot) {
      const worktreePath = siblingWorktreePath(gitRoot, row.id);
      const branch = `conductor/${String(row.id)}`;
      const existedBefore = fs.existsSync(worktreePath);
      // Recorded before the attempt: `git worktree add -b` can create the
      // branch and then fail (e.g. the sibling dir is a plain file), and agent
      // ids are reused (no AUTOINCREMENT), so a stray branch would collide with
      // the next agent. Only a branch that did not pre-exist is ours to drop.
      const branchExistedBefore = branchExists(gitRoot, branch);
      const created = tryCreateWorktree(gitRoot, worktreePath, branch);
      if (created.ok) {
        db.prepare(`UPDATE agents SET worktree_path = ?, branch = ? WHERE id = ?`).run(worktreePath, branch, row.id);
        applyRoleFragmentToWorktree(worktreePath, data.role ?? 'generic');
      } else if (requireWorktree) {
        db.prepare(`DELETE FROM agents WHERE id = ?`).run(row.id);
        // Best-effort: drop a partially created worktree, but never a directory
        // that was already there before this attempt (it is not ours).
        if (!existedBefore && fs.existsSync(worktreePath)) {
          removeWorktree(gitRoot, worktreePath);
          fs.rmSync(worktreePath, { recursive: true, force: true });
        }
        // Best-effort: drop a branch the failed attempt left behind, but never
        // one that already existed before it. Prune first so a stale worktree
        // registration does not make `branch -D` refuse.
        if (!branchExistedBefore && branchExists(gitRoot, branch)) {
          pruneWorktrees(gitRoot);
          deleteBranch(gitRoot, branch);
        }
        throw new WorktreeError('git-failed', `failed to create git worktree at ${worktreePath}: ${created.reason}`);
      } else {
        console.warn(`[conductor] createAgent: failed to create worktree at ${worktreePath} for branch ${branch} (agent ${String(row.id)}): ${created.reason}; continuing without a worktree`);
      }
    } else if (requireWorktree) {
      // Raced with the preflight (repo vanished between the two git calls).
      db.prepare(`DELETE FROM agents WHERE id = ?`).run(row.id);
      throw new WorktreeError('not-git-repo', `workdir ${data.workdir} is not inside a git repository`);
    }
  }

  return findAgentById(db, row.id);
}

/**
 * TASK-0213: create a clone of `source` (same workdir/launchCmd/project/role,
 * derived unique name). The clone gets its own worktree when `forceWorktree`
 * is set — a FRESH branch off the repo's detected base branch, not a copy of
 * the source's branch or uncommitted work, whether or not the source has one —
 * and otherwise only when the source itself has one (previous behaviour).
 * A forced clone that cannot get its worktree throws a WorktreeError and
 * leaves no `agents` row behind.
 */
export function cloneAgentRecord(db: Database.Database, source: Agent, opts: { forceWorktree?: boolean } = {}): Agent {
  const forceWorktree = opts.forceWorktree === true;
  return createAgent(db, {
    name: deriveCloneName(db, source),
    workdir: source.workdir,
    launchCmd: source.launchCmd,
    ...(source.projectId != null ? { projectId: source.projectId } : {}),
    role: source.role,
    ...(source.description ? { description: source.description } : {}),
    useWorktree: forceWorktree || Boolean(source.worktreePath),
    requireWorktree: forceWorktree,
  });
}

/**
 * Opt-in worktree creation for an EXISTING agent (the AgentDetailModal "Create
 * worktree" action) — the retroactive counterpart to createAgent's
 * `useWorktree` flag. Throws a plain `Error` with a caller-facing message on
 * any precondition failure so the route can map it to the right HTTP status;
 * this is a deliberate user-initiated action, not a best-effort side effect,
 * so (unlike createAgent) failures are not swallowed.
 */
export function addWorktreeToAgent(db: Database.Database, agentId: number): Agent {
  const agent = getAgentById(db, agentId);
  if (!agent) {
    throw new WorktreeError('not-found', `agent ${String(agentId)} not found`);
  }
  if (agent.worktreePath) {
    throw new WorktreeError('already-has-worktree', `agent ${String(agentId)} already has a worktree`);
  }
  const gitRoot = getGitRoot(agent.workdir);
  if (!gitRoot) {
    throw new WorktreeError('not-git-repo', `agent ${String(agentId)} workdir is not inside a git repository`);
  }
  const worktreePath = siblingWorktreePath(gitRoot, agentId);
  const branch = `conductor/${String(agentId)}`;
  const result = tryCreateWorktree(gitRoot, worktreePath, branch);
  if (!result.ok) {
    throw new WorktreeError('git-failed', `failed to create git worktree at ${worktreePath}: ${result.reason}`);
  }
  db.prepare(`UPDATE agents SET worktree_path = ?, branch = ? WHERE id = ?`).run(worktreePath, branch, agentId);
  applyRoleFragmentToWorktree(worktreePath, agent.role);
  return findAgentById(db, agentId);
}


/**
 * Lazily heals a stale worktree reference: if the worktree directory behind
 * an agent's `worktree_path`/`branch` columns was removed outside the app's
 * own delete-agent flow (e.g. the user ran `git worktree remove` by hand
 * instead of going through the dashboard, which runs `git worktree remove
 * --force` itself), the DB row still points at a directory that no longer
 * exists. Callers detect that on read (via `fs.existsSync` at serialization
 * time) and call this once to clear the columns so subsequent reads don't
 * need to re-check. Never invoked by a background sweep — "live check on
 * read" only.
 */
export function clearAgentWorktree(db: Database.Database, agentId: number): void {
  db.prepare(`UPDATE agents SET worktree_path = NULL, branch = NULL WHERE id = ?`).run(agentId);
}

export function deleteAgent(db: Database.Database, id: number): void {
  db.prepare(`DELETE FROM agents WHERE id=?`).run(id);
}

export function updateAgentName(db: Database.Database, id: number, newName: string): Agent {
  const updated = db.prepare(`UPDATE agents SET name=? WHERE id=?`).run(newName, id);
  if (updated.changes === 0) throw new Error(`Agent ${String(id)} not found`);
  return findAgentById(db, id);
}

export function updateAgentRole(db: Database.Database, id: number, role: string): Agent {
  const updated = db.prepare(`UPDATE agents SET role=? WHERE id=?`).run(role, id);
  if (updated.changes === 0) throw new Error(`Agent ${String(id)} not found`);
  return findAgentById(db, id);
}

export function updateAgentDescription(db: Database.Database, id: number, description: string | null): Agent {
  const updated = db.prepare(`UPDATE agents SET description=? WHERE id=?`).run(description, id);
  if (updated.changes === 0) throw new Error(`Agent ${String(id)} not found`);
  return findAgentById(db, id);
}

// ─── BgProcesses CRUD ────────────────────────────────────────────────────────

export function listBgProcesses(db: Database.Database, opts?: { projectId?: number }): BgProcess[] {
  if (opts?.projectId !== undefined) {
    return (db.prepare(`SELECT * FROM bg_processes WHERE project_id = ? ORDER BY name`).all(opts.projectId) as BgProcessRow[]).map(mapBgProcess);
  }
  return (db.prepare(`SELECT * FROM bg_processes ORDER BY name`).all() as BgProcessRow[]).map(mapBgProcess);
}

export function createBgProcess(db: Database.Database, data: { name: string; workdir: string; launchCmd: string; projectId: number }): BgProcess {
  const row = db.prepare(
    `INSERT INTO bg_processes (name, workdir, launch_cmd, project_id) VALUES (?, ?, ?, ?) RETURNING *`
  ).get(data.name, data.workdir, data.launchCmd, data.projectId) as BgProcessRow;
  return mapBgProcess(row);
}

// Updates a bg process's stored definition only (workdir, launchCmd, projectId).
// name is immutable (it's the tmux window key and the route param for
// delete/window actions) and is never accepted here. Semantics: this writes
// SQLite only — the launchCmd may already be running inside a live tmux
// window, and this function never touches that window. The new values take
// effect the next time the window is (re)created (POST /bg-processes/:name/window,
// or a fresh conductor.sh/spawn.sh run) — not retroactively.
export function updateBgProcess(db: Database.Database, id: number, data: Partial<{ workdir: string; launchCmd: string; projectId: number }>): BgProcess {
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (data.workdir !== undefined) { sets.push('workdir=?'); vals.push(data.workdir); }
  if (data.launchCmd !== undefined) { sets.push('launch_cmd=?'); vals.push(data.launchCmd); }
  if (data.projectId !== undefined) { sets.push('project_id=?'); vals.push(data.projectId); }
  if (sets.length === 0) {
    const row = db.prepare(`SELECT * FROM bg_processes WHERE id=?`).get(id) as BgProcessRow | undefined;
    if (!row) throw new Error(`bg process ${String(id)} not found`);
    return mapBgProcess(row);
  }
  vals.push(id);
  const row = db.prepare(`UPDATE bg_processes SET ${sets.join(', ')} WHERE id=? RETURNING *`).get(...vals) as BgProcessRow | undefined;
  if (!row) throw new Error(`bg process ${String(id)} not found`);
  return mapBgProcess(row);
}

export function deleteBgProcess(db: Database.Database, id: number): void {
  db.prepare(`DELETE FROM bg_processes WHERE id=?`).run(id);
}

// ─── Task queue ───────────────────────────────────────────────────────────────

export function listTasksByProject(db: Database.Database, projectId: number): Task[] {
  const rows = db.prepare(
    `SELECT * FROM tasks WHERE project_id = ? AND status = 'queued' ORDER BY position ASC`
  ).all(projectId) as TaskRow[];
  return rows.map(mapTask);
}

/** Queue for one agent, addressed by its id (and its project for project-scoped
 *  tasks). Keyed by id, not name — agent names are only unique per project, so a
 *  name lookup would resolve two same-named agents to the same (first) row. */
export function listTasksForAgentId(db: Database.Database, agentId: number, projectId: number | null): Task[] {
  const rows = db.prepare(`
    SELECT t.* FROM tasks t
    WHERE t.status = 'queued' AND (
         (t.agent_id IS NOT NULL AND t.agent_id = ?)
      OR (t.project_id IS NOT NULL AND ? IS NOT NULL AND t.project_id = ?)
      OR (t.agent_id IS NULL AND t.project_id IS NULL))
    ORDER BY
      CASE WHEN t.agent_id IS NOT NULL THEN 0
           WHEN t.project_id IS NOT NULL THEN 1 ELSE 2 END,
      t.position
  `).all(agentId, projectId, projectId) as TaskRow[];
  return rows.map(mapTask);
}


// TASK-126: read-side companion to TASK-125's soft-delete pop — surfaces
// popped (status='done') tasks for the dashboard's task history view.
// Optional filters mirror listTasksForAgentId's scoping knobs; unlike that
// function's fixed queued-only ordering, history is newest-completed-first.
export function listCompletedTasks(
  db: Database.Database,
  opts?: { agentId?: number; projectId?: number; limit?: number }
): Task[] {
  const clauses = [`status = 'done'`];
  const params: number[] = [];
  if (opts?.agentId !== undefined) {
    clauses.push('agent_id = ?');
    params.push(opts.agentId);
  }
  if (opts?.projectId !== undefined) {
    clauses.push('project_id = ?');
    params.push(opts.projectId);
  }
  let sql = `SELECT * FROM tasks WHERE ${clauses.join(' AND ')} ORDER BY completed_at DESC`;
  if (opts?.limit !== undefined) {
    sql += ' LIMIT ?';
    params.push(opts.limit);
  }
  const rows = db.prepare(sql).all(...params) as TaskRow[];
  return rows.map(mapTask);
}

export function addTask(db: Database.Database, data: {
  command: string;
  agentId?: number;
  projectId?: number;
  placement?: 'tail' | 'head';
  source?: 'manual' | 'schedule';
  scheduleId?: number;
}): Task {
  const placement = data.placement ?? 'tail';
  let position: number;
  if (placement === 'tail') {
    const r = db.prepare(`SELECT MAX(position) as m FROM tasks WHERE status='queued'`).get() as { m: number | null };
    position = (r.m ?? 0) + 1.0;
  } else {
    const r = db.prepare(`SELECT MIN(position) as m FROM tasks WHERE status='queued'`).get() as { m: number | null };
    position = (r.m ?? 0) - 1.0;
  }
  const row = db.prepare(
    `INSERT INTO tasks (command, agent_id, project_id, position, source, schedule_id)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING *`
  ).get(
    data.command,
    data.agentId ?? null,
    data.projectId ?? null,
    position,
    data.source ?? 'manual',
    data.scheduleId ?? null,
  ) as TaskRow;
  return mapTask(row);
}

export function deleteTask(db: Database.Database, id: number): void {
  db.prepare(`DELETE FROM tasks WHERE id=?`).run(id);
}

export function reorderTasks(db: Database.Database, orderedIds: number[]): void {
  if (orderedIds.length === 0) return;
  // Fetch current positions for these rows and reassign in the given order
  const placeholders = orderedIds.map(() => '?').join(',');
  const current = db.prepare(
    `SELECT id, position FROM tasks WHERE id IN (${placeholders}) ORDER BY position`
  ).all(...orderedIds) as { id: number; position: number }[];

  const positions = current.map(r => r.position).sort((a, b) => a - b);
  const update = db.prepare(`UPDATE tasks SET position=? WHERE id=?`);
  const tx = db.transaction(() => {
    for (let i = 0; i < orderedIds.length; i++) {
      const pos = positions[i];
      const id = orderedIds[i];
      if (pos !== undefined && id !== undefined) {
        update.run(pos, id);
      }
    }
  });
  tx();
}

export function jumpTaskToHead(db: Database.Database, id: number): void {
  const r = db.prepare(`SELECT MIN(position) as m FROM tasks WHERE status='queued'`).get() as { m: number | null };
  const newPos = (r.m ?? 0) - 1.0;
  db.prepare(`UPDATE tasks SET position=? WHERE id=?`).run(newPos, id);
}


export function moveTaskToProject(db: Database.Database, id: number): { ok: true; task: Task } | { ok: false; reason: 'not-found' | 'not-queued' | 'not-agent-scoped' | 'agent-has-no-project' } {
  const row = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as TaskRow | undefined;
  if (!row) return { ok: false, reason: 'not-found' };
  if (row.status !== 'queued') return { ok: false, reason: 'not-queued' };
  if (row.agent_id === null) return { ok: false, reason: 'not-agent-scoped' };

  const agent = db.prepare(`SELECT project_id FROM agents WHERE id = ?`).get(row.agent_id) as { project_id: number | null } | undefined;
  if (!agent || agent.project_id === null) return { ok: false, reason: 'agent-has-no-project' };

  const updated = db.prepare(
    `UPDATE tasks SET project_id = ?, agent_id = NULL WHERE id = ? RETURNING *`
  ).get(agent.project_id, id) as TaskRow;
  return { ok: true, task: mapTask(updated) };
}

export function popTask(db: Database.Database, agentName: string): { id: number; command: string; kind: 'scoped' | 'project' | 'global' } | null {
  // TASK-125: soft flip instead of DELETE — the popped row's status becomes
  // 'done' with completed_at set, so it remains queryable for task history
  // instead of vanishing. The candidate-selection subquery is unchanged: it
  // still only matches status='queued' rows, so a popped row can never be
  // picked again once its status flips.
  const row = db.prepare(`
    UPDATE tasks SET status='done', completed_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = (
      SELECT t.id FROM tasks t
      WHERE t.status = 'queued' AND (
           (t.agent_id IS NOT NULL AND t.agent_id = (SELECT id FROM agents WHERE name=?))
        OR (t.project_id IS NOT NULL AND t.project_id = (SELECT project_id FROM agents WHERE name=?))
        OR (t.agent_id IS NULL AND t.project_id IS NULL))
      ORDER BY CASE WHEN t.agent_id IS NOT NULL THEN 0
                    WHEN t.project_id IS NOT NULL THEN 1 ELSE 2 END,
               t.position
      LIMIT 1)
    RETURNING id, command,
      CASE WHEN agent_id IS NOT NULL THEN 'scoped'
           WHEN project_id IS NOT NULL THEN 'project' ELSE 'global' END AS kind
  `).get(agentName, agentName) as { id: number; command: string; kind: string } | undefined;

  if (!row) return null;
  return { id: row.id, command: row.command, kind: row.kind as 'scoped' | 'project' | 'global' };
}

export function moveToBacklog(db: Database.Database, agentId: number): void {
  db.prepare(`UPDATE tasks SET status='backlog' WHERE agent_id=? AND status='queued'`).run(agentId);
}

export function restoreBacklog(db: Database.Database, agentId: number): void {
  db.prepare(`UPDATE tasks SET status='queued' WHERE agent_id=? AND status='backlog'`).run(agentId);
}

// ─── Schedules CRUD ───────────────────────────────────────────────────────────

export function listSchedules(db: Database.Database): Schedule[] {
  return (db.prepare(`SELECT * FROM schedules ORDER BY id`).all() as ScheduleRow[]).map(mapSchedule);
}

export function createSchedule(db: Database.Database, data: {
  name?: string;
  command: string;
  intervalSeconds: number;
  action?: 'append' | 'jump';
  agentId?: number;
  projectId?: number;
  skipIfPending?: boolean;
}): Schedule {
  const row = db.prepare(
    `INSERT INTO schedules (name, command, interval_seconds, action, agent_id, project_id, skip_if_pending)
     VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`
  ).get(
    data.name ?? null,
    data.command,
    data.intervalSeconds,
    data.action ?? 'append',
    data.agentId ?? null,
    data.projectId ?? null,
    data.skipIfPending !== false ? 1 : 0,
  ) as ScheduleRow;
  return mapSchedule(row);
}

export function updateSchedule(db: Database.Database, id: number, data: Partial<{
  name: string | null;
  command: string;
  intervalSeconds: number;
  action: 'append' | 'jump';
  agentId: number | null;
  projectId: number | null;
  enabled: number;
  skipIfPending: number;
}>): Schedule {
  const sets: string[] = [];
  const vals: unknown[] = [];
  if ('name' in data) { sets.push('name=?'); vals.push(data.name ?? null); }
  if (data.command !== undefined) { sets.push('command=?'); vals.push(data.command); }
  if (data.intervalSeconds !== undefined) { sets.push('interval_seconds=?'); vals.push(data.intervalSeconds); }
  if (data.action !== undefined) { sets.push('action=?'); vals.push(data.action); }
  if ('agentId' in data) { sets.push('agent_id=?'); vals.push(data.agentId ?? null); }
  if ('projectId' in data) { sets.push('project_id=?'); vals.push(data.projectId ?? null); }
  if (data.enabled !== undefined) { sets.push('enabled=?'); vals.push(data.enabled); }
  if (data.skipIfPending !== undefined) { sets.push('skip_if_pending=?'); vals.push(data.skipIfPending); }
  if (sets.length === 0) {
    const row = db.prepare(`SELECT * FROM schedules WHERE id=?`).get(id) as ScheduleRow | undefined;
    if (!row) throw new Error(`Schedule ${String(id)} not found`);
    return mapSchedule(row);
  }
  vals.push(id);
  const row = db.prepare(`UPDATE schedules SET ${sets.join(', ')} WHERE id=? RETURNING *`).get(...vals) as ScheduleRow | undefined;
  if (!row) throw new Error(`Schedule ${String(id)} not found`);
  return mapSchedule(row);
}

export function deleteSchedule(db: Database.Database, id: number): void {
  db.prepare(`DELETE FROM schedules WHERE id=?`).run(id);
}

export function dueSchedules(db: Database.Database, nowEpoch: number): Schedule[] {
  const rows = db.prepare(
    `SELECT * FROM schedules WHERE enabled=1 AND (last_enqueued_at IS NULL OR last_enqueued_at + interval_seconds <= ?)`
  ).all(nowEpoch) as ScheduleRow[];
  return rows.map(mapSchedule);
}

export function fireSchedule(db: Database.Database, schedule: Schedule, nowEpoch: number): Task | null {
  let result: Task | null = null;
  const tx = db.transaction(() => {
    if (schedule.skipIfPending) {
      const pending = db.prepare(
        `SELECT 1 FROM tasks WHERE schedule_id=? AND status='queued' LIMIT 1`
      ).get(schedule.id);
      if (pending) return;
    }
    const taskData: Parameters<typeof addTask>[1] = {
      command: schedule.command,
      placement: schedule.action === 'jump' ? 'head' : 'tail',
      source: 'schedule',
      scheduleId: schedule.id,
    };
    if (schedule.agentId !== null) taskData.agentId = schedule.agentId;
    if (schedule.projectId !== null) taskData.projectId = schedule.projectId;
    result = addTask(db, taskData);
    db.prepare(`UPDATE schedules SET last_enqueued_at=? WHERE id=?`).run(nowEpoch, schedule.id);
  });
  tx();
  return result;
}

// ─── Agent usage (per-session token/cost totals) ──────────────────────────────

/** Idempotent upsert keyed on (agent_id, session_start): the writer passes
 *  absolute session totals, so a re-run overwrites rather than accumulates. */
export function upsertAgentUsage(db: Database.Database, data: {
  agentId: number;
  sessionStart: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  costUsd: number;
}): AgentUsage {
  const row = db.prepare(
    `INSERT INTO agent_usage (agent_id, session_start, input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens, cost_usd)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(agent_id, session_start) DO UPDATE SET
       input_tokens=excluded.input_tokens,
       output_tokens=excluded.output_tokens,
       cache_creation_input_tokens=excluded.cache_creation_input_tokens,
       cache_read_input_tokens=excluded.cache_read_input_tokens,
       cost_usd=excluded.cost_usd,
       updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
     RETURNING *`
  ).get(
    data.agentId,
    data.sessionStart,
    data.inputTokens,
    data.outputTokens,
    data.cacheCreationInputTokens ?? 0,
    data.cacheReadInputTokens ?? 0,
    data.costUsd,
  ) as AgentUsageRow;
  return mapAgentUsage(row);
}

export function listAgentUsage(db: Database.Database, agentId: number): AgentUsage[] {
  const rows = db.prepare(
    `SELECT * FROM agent_usage WHERE agent_id = ? ORDER BY session_start DESC`
  ).all(agentId) as AgentUsageRow[];
  return rows.map(mapAgentUsage);
}

export function getAgentUsageTotals(db: Database.Database, agentId: number): AgentUsageTotals {
  const row = db.prepare(`
    SELECT COALESCE(SUM(input_tokens), 0) AS input_tokens,
           COALESCE(SUM(output_tokens), 0) AS output_tokens,
           COALESCE(SUM(cache_creation_input_tokens), 0) AS cache_creation_input_tokens,
           COALESCE(SUM(cache_read_input_tokens), 0) AS cache_read_input_tokens,
           COALESCE(SUM(cost_usd), 0) AS cost_usd,
           COUNT(*) AS sessions
    FROM agent_usage WHERE agent_id = ?
  `).get(agentId) as {
    input_tokens: number; output_tokens: number;
    cache_creation_input_tokens: number; cache_read_input_tokens: number;
    cost_usd: number; sessions: number;
  };
  return {
    agentId,
    inputTokens: row.input_tokens, outputTokens: row.output_tokens,
    cacheCreationInputTokens: row.cache_creation_input_tokens,
    cacheReadInputTokens: row.cache_read_input_tokens,
    costUsd: row.cost_usd, sessions: row.sessions,
  };
}

export function getAllAgentUsageTotals(db: Database.Database): AgentUsageTotals[] {
  const rows = db.prepare(`
    SELECT agent_id,
           SUM(input_tokens) AS input_tokens,
           SUM(output_tokens) AS output_tokens,
           SUM(cache_creation_input_tokens) AS cache_creation_input_tokens,
           SUM(cache_read_input_tokens) AS cache_read_input_tokens,
           SUM(cost_usd) AS cost_usd,
           COUNT(*) AS sessions
    FROM agent_usage GROUP BY agent_id
  `).all() as {
    agent_id: number; input_tokens: number; output_tokens: number;
    cache_creation_input_tokens: number; cache_read_input_tokens: number;
    cost_usd: number; sessions: number;
  }[];
  return rows.map((r) => ({
    agentId: r.agent_id,
    inputTokens: r.input_tokens, outputTokens: r.output_tokens,
    cacheCreationInputTokens: r.cache_creation_input_tokens,
    cacheReadInputTokens: r.cache_read_input_tokens,
    costUsd: r.cost_usd, sessions: r.sessions,
  }));
}

// ─── Agent checkpoints ─────────────────────────────────────────────────────────

export function insertCheckpoint(db: Database.Database, agentId: number, ts: number, stashRef: string): AgentCheckpoint {
  const row = db.prepare(
    `INSERT INTO agent_checkpoints (agent_id, ts, stash_ref) VALUES (?, ?, ?) RETURNING *`
  ).get(agentId, ts, stashRef) as AgentCheckpointRow;
  return mapAgentCheckpoint(row);
}

export function listCheckpoints(db: Database.Database, agentId: number): AgentCheckpoint[] {
  return (db.prepare(
    `SELECT * FROM agent_checkpoints WHERE agent_id = ? ORDER BY ts DESC`
  ).all(agentId) as AgentCheckpointRow[]).map(mapAgentCheckpoint);
}

export function getCheckpoint(db: Database.Database, id: number): AgentCheckpoint | undefined {
  const row = db.prepare(`SELECT * FROM agent_checkpoints WHERE id = ?`).get(id) as AgentCheckpointRow | undefined;
  return row ? mapAgentCheckpoint(row) : undefined;
}


// ─── Agent terminal log ─────────────────────────────────────────────────────────

export function appendTerminalLogChunk(db: Database.Database, agentId: number, chunk: string, maxRowsPerAgent: number): AgentTerminalLog {
  let result!: AgentTerminalLog;
  const tx = db.transaction(() => {
    const row = db.prepare(
      `INSERT INTO agent_terminal_log (agent_id, chunk) VALUES (?, ?) RETURNING *`
    ).get(agentId, chunk) as AgentTerminalLogRow;
    db.prepare(
      `DELETE FROM agent_terminal_log
       WHERE agent_id = ? AND id NOT IN (
         SELECT id FROM agent_terminal_log
         WHERE agent_id = ?
         ORDER BY ts DESC, id DESC
         LIMIT ?
       )`
    ).run(agentId, agentId, maxRowsPerAgent);
    result = mapAgentTerminalLog(row);
  });
  tx();
  return result;
}

export function listTerminalLog(db: Database.Database, agentId: number): AgentTerminalLog[] {
  return (db.prepare(
    `SELECT * FROM agent_terminal_log WHERE agent_id = ? ORDER BY ts ASC, id ASC`
  ).all(agentId) as AgentTerminalLogRow[]).map(mapAgentTerminalLog);
}
