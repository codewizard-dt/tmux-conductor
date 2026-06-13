import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { readConductorConf, DEFAULT_CONF_PATH, type ConductorConf } from './config.ts';

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
  createdAt: string;
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
  created_at: string;
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

// ─── Row mappers ──────────────────────────────────────────────────────────────

function mapProject(r: ProjectRow): Project {
  return { id: r.id, name: r.name, workdir: r.workdir, defaultLaunchCmd: r.default_launch_cmd, createdAt: r.created_at };
}

function mapAgent(r: AgentRow): Agent {
  return { id: r.id, name: r.name, workdir: r.workdir, launchCmd: r.launch_cmd, projectId: r.project_id, createdAt: r.created_at };
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
}

// ─── Legacy seed (runs once) ──────────────────────────────────────────────────

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
  const existing = db.prepare(`SELECT name FROM agents WHERE project_id=?`).all(projectId) as { name: string }[];
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
  return (db.prepare(`SELECT * FROM agents ORDER BY name`).all() as AgentRow[]).map(mapAgent);
}

export function createAgent(db: Database.Database, data: { name: string; workdir: string; launchCmd: string; projectId?: number }): Agent {
  const row = db.prepare(
    `INSERT INTO agents (name, workdir, launch_cmd, project_id) VALUES (?, ?, ?, ?) RETURNING *`
  ).get(data.name, data.workdir, data.launchCmd, data.projectId ?? null) as AgentRow;
  return mapAgent(row);
}

export function deleteAgent(db: Database.Database, id: number): void {
  db.prepare(`DELETE FROM agents WHERE id=?`).run(id);
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

export function listTasksForAgent(db: Database.Database, agentName: string): Task[] {
  const rows = db.prepare(`
    SELECT t.* FROM tasks t
    WHERE t.status = 'queued' AND (
         (t.agent_id IS NOT NULL AND t.agent_id = (SELECT id FROM agents WHERE name=?))
      OR (t.project_id IS NOT NULL AND t.project_id = (SELECT project_id FROM agents WHERE name=?))
      OR (t.agent_id IS NULL AND t.project_id IS NULL))
    ORDER BY
      CASE WHEN t.agent_id IS NOT NULL THEN 0
           WHEN t.project_id IS NOT NULL THEN 1 ELSE 2 END,
      t.position
  `).all(agentName, agentName) as TaskRow[];
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
  const row = db.prepare(`
    DELETE FROM tasks WHERE id = (
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
