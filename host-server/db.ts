import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { readConductorConf, DEFAULT_CONF_PATH, type ConductorConf } from './config.ts';
import { getGitRoot, createWorktree, siblingWorktreePath } from './git.ts';
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
  createdAt: string;
}

/** Globally unique tmux window name for an agent. Project-scoped agents get
 *  `${project}-${agent}` so two agents with the same short name in different
 *  projects never collide in the shared tmux session namespace. */
export function agentWindowName(agent: Pick<Agent, 'name' | 'projectName'>): string {
  return agent.projectName ? `${agent.projectName}-${agent.name}` : agent.name;
}

export interface BgProcess {
  id: number;
  name: string;
  workdir: string;
  launchCmd: string;
  linkedAgentId: number | null;
}

export interface Task {
  id: number;
  command: string;
  agentId: number | null;
  projectId: number | null;
  position: number;
  status: 'queued' | 'backlog';
  source: 'manual' | 'schedule';
  scheduleId: number | null;
  createdAt: string;
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
  linked_agent_id: number | null;
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
  return { id: r.id, name: r.name, workdir: r.workdir, launchCmd: r.launch_cmd, projectId: r.project_id, projectName, worktreePath: r.worktree_path ?? null, branch: r.branch ?? null, role: r.role, createdAt: r.created_at };
}

function mapBgProcess(r: BgProcessRow): BgProcess {
  return { id: r.id, name: r.name, workdir: r.workdir, launchCmd: r.launch_cmd, linkedAgentId: r.linked_agent_id };
}

function mapTask(r: TaskRow): Task {
  return {
    id: r.id, command: r.command, agentId: r.agent_id, projectId: r.project_id,
    position: r.position, status: r.status as Task['status'], source: r.source as Task['source'],
    scheduleId: r.schedule_id, createdAt: r.created_at,
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
        default_launch_cmd TEXT NOT NULL DEFAULT 'claude --dangerously-skip-permissions',
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
        launch_cmd TEXT NOT NULL,
        linked_agent_id INTEGER REFERENCES agents(id) ON DELETE SET NULL
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
  const insertBg = db.prepare(`INSERT OR IGNORE INTO bg_processes (name, workdir, launch_cmd) VALUES (?, ?, ?)`);
  const linkBg = db.prepare(`UPDATE bg_processes SET linked_agent_id=(SELECT id FROM agents WHERE name=?) WHERE name=?`);

  const seedTx = db.transaction(() => {
    for (const agent of conf.agents) {
      insertAgent.run(agent.name, agent.workdir, agent.launchCmd);
    }
    for (const bg of conf.bgProcesses) {
      insertBg.run(bg.name, bg.workdir, bg.launchCmd);
    }
    for (const [agentName, bgName] of Object.entries(conf.agentBgLinks)) {
      linkBg.run(agentName, bgName);
    }

    db.prepare(`INSERT INTO meta VALUES ('legacy_import', '1')`).run();
  });

  seedTx();
  console.log(`[conductor] Legacy import complete — agents: ${String(conf.agents.length)}`);
}

// ─── Projects CRUD ────────────────────────────────────────────────────────────

export function listProjects(db: Database.Database): Project[] {
  return (db.prepare(`SELECT * FROM projects ORDER BY name`).all() as ProjectRow[]).map(mapProject);
}

export function createProject(db: Database.Database, data: { name: string; workdir: string; defaultLaunchCmd?: string }): Project {
  const row = db.prepare(
    `INSERT INTO projects (name, workdir, default_launch_cmd) VALUES (?, ?, ?) RETURNING *`
  ).get(data.name, data.workdir, data.defaultLaunchCmd ?? 'claude --dangerously-skip-permissions') as ProjectRow;
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

export function deleteProject(db: Database.Database, id: number, force = false): void {
  if (!force) {
    const count = (db.prepare(`SELECT COUNT(*) as n FROM agents WHERE project_id=?`).get(id) as { n: number }).n;
    if (count > 0) throw new Error(`Project ${String(id)} has ${String(count)} agent(s) — pass force=true to delete anyway`);
  }
  db.prepare(`DELETE FROM projects WHERE id=?`).run(id);
}

export function nextAgentName(db: Database.Database, projectId: number): string {
  const project = db.prepare(`SELECT name FROM projects WHERE id=?`).get(projectId) as { name: string } | undefined;
  if (!project) throw new Error(`Project ${String(projectId)} not found`);
  const existing = db.prepare(`SELECT name FROM agents WHERE name GLOB ?`).all(project.name + '-*') as { name: string }[];
  const prefix = project.name + '-';
  let max = 0;
  for (const a of existing) {
    if (a.name.startsWith(prefix)) {
      const n = parseInt(a.name.slice(prefix.length), 10);
      if (!isNaN(n) && n > max) max = n;
    }
  }
  return `${project.name}-${String(max + 1)}`;
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

export function createAgent(db: Database.Database, data: { name: string; workdir: string; launchCmd: string; projectId?: number; role?: string; useWorktree?: boolean }): Agent {
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
    `INSERT INTO agents (name, workdir, launch_cmd, project_id, role) VALUES (?, ?, ?, ?, ?) RETURNING id`
  ).get(data.name, data.workdir, data.launchCmd, data.projectId ?? null, data.role ?? 'generic') as { id: number };

  // ROADMAP-007: worktree creation is opt-in only (data.useWorktree), never
  // automatic — it used to run for every agent whose workdir sat inside a
  // git repo, which silently created a worktree the caller never asked for.
  // `gitRoot` is `null` when workdir isn't a git repo (or git is
  // unavailable/times out); in that case we proceed without a worktree.
  // Worktree creation itself is still best-effort: a failure is logged as a
  // warning and the columns are left NULL, but it never aborts agent creation.
  if (data.useWorktree) {
    const gitRoot = getGitRoot(data.workdir);
    if (gitRoot) {
      const worktreePath = siblingWorktreePath(gitRoot, row.id);
      const branch = `conductor/${String(row.id)}`;
      const created = createWorktree(gitRoot, worktreePath, branch);
      if (created) {
        db.prepare(`UPDATE agents SET worktree_path = ?, branch = ? WHERE id = ?`).run(worktreePath, branch, row.id);
        applyRoleFragmentToWorktree(worktreePath, data.role ?? 'generic');
      } else {
        console.warn(`[conductor] createAgent: failed to create worktree at ${worktreePath} for branch ${branch} (agent ${String(row.id)}); continuing without a worktree`);
      }
    }
  }

  return findAgentById(db, row.id);
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
    throw new Error(`agent ${String(agentId)} not found`);
  }
  if (agent.worktreePath) {
    throw new Error(`agent ${String(agentId)} already has a worktree`);
  }
  const gitRoot = getGitRoot(agent.workdir);
  if (!gitRoot) {
    throw new Error(`agent ${String(agentId)} workdir is not inside a git repository`);
  }
  const worktreePath = siblingWorktreePath(gitRoot, agentId);
  const branch = `conductor/${String(agentId)}`;
  if (!createWorktree(gitRoot, worktreePath, branch)) {
    throw new Error(`failed to create git worktree at ${worktreePath}`);
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

// ─── BgProcesses CRUD ────────────────────────────────────────────────────────

export function listBgProcesses(db: Database.Database): BgProcess[] {
  return (db.prepare(`SELECT * FROM bg_processes ORDER BY name`).all() as BgProcessRow[]).map(mapBgProcess);
}

export function createBgProcess(db: Database.Database, data: { name: string; workdir: string; launchCmd: string; linkedAgentId?: number }): BgProcess {
  const row = db.prepare(
    `INSERT INTO bg_processes (name, workdir, launch_cmd, linked_agent_id) VALUES (?, ?, ?, ?) RETURNING *`
  ).get(data.name, data.workdir, data.launchCmd, data.linkedAgentId ?? null) as BgProcessRow;
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
