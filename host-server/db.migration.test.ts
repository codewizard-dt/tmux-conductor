import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import {
  openDb,
  createAgent,
  addWorktreeToAgent,
  cloneAgentRecord,
  clearAgentWorktree,
  listAgents,
  deleteAgent,
  upsertAgentUsage,
  listAgentUsage,
  getAgentUsageTotals,
  getAllAgentUsageTotals,
  insertCheckpoint,
  listCheckpoints,
  getCheckpoint,
  appendTerminalLogChunk,
  listTerminalLog,
  addTask,
  popTask,
} from './db.ts';
import { WorktreeError } from './worktreeErrors.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = path.resolve(__dirname, '../tmp');

interface ColumnInfo {
  name: string;
  type: string;
}

function tableColumns(db: Database.Database, table: string): ColumnInfo[] {
  return db
    .prepare(`SELECT name, type FROM pragma_table_info(?)`)
    .all(table) as ColumnInfo[];
}

function schemaVersion(db: Database.Database): string | undefined {
  const row = db
    .prepare(`SELECT value FROM meta WHERE key='schema_version'`)
    .get() as { value: string } | undefined;
  return row?.value;
}

// Sibling roadmap-010 tasks each append their own `if (version < N)` migration
// block, so the live max schema_version keeps climbing as those tasks land
// concurrently (see runMigrations in db.ts). Assert "at least the version this
// feature landed at" rather than an exact number, so this suite stays green
// regardless of how many later migrations have since been added.
function assertSchemaVersionAtLeast(db: Database.Database, min: number): void {
  const raw = schemaVersion(db);
  const actual = raw ? parseInt(raw, 10) : 0;
  assert.ok(actual >= min, `schema_version should be >= ${String(min)}, got ${String(raw)}`);
}

function tmpDbPath(label: string): string {
  fs.mkdirSync(tmpDir, { recursive: true });
  const rand = Math.random().toString(36).slice(2, 10);
  return path.join(tmpDir, `uat060-${label}-${rand}.db`);
}

function cleanupDbFiles(dbPath: string): void {
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.rmSync(dbPath + suffix, { force: true });
    } catch {
      // best-effort cleanup
    }
  }
}

void test('fresh DB has worktree_path and branch columns', () => {
  const db = openDb(':memory:');
  try {
    const cols = tableColumns(db, 'agents');
    const worktree = cols.find((c) => c.name === 'worktree_path');
    const branch = cols.find((c) => c.name === 'branch');
    assert.ok(worktree, 'agents.worktree_path column should exist');
    assert.equal(worktree.type, 'TEXT');
    assert.ok(branch, 'agents.branch column should exist');
    assert.equal(branch.type, 'TEXT');
  } finally {
    db.close();
  }
});

void test('migration is idempotent on an already-migrated DB', () => {
  const dbPath = tmpDbPath('idem');
  try {
    const first = openDb(dbPath);
    const firstVersion = schemaVersion(first);
    first.close();

    // Re-opening an already-migrated DB must not throw (no duplicate-column error)
    // and must leave schema_version unchanged.
    const second = openDb(dbPath);
    try {
      assert.equal(schemaVersion(second), firstVersion);
    } finally {
      second.close();
    }
  } finally {
    cleanupDbFiles(dbPath);
  }
});

void test('existing pre-v3 DB gains columns and preserves rows', () => {
  const dbPath = tmpDbPath('prev3');
  try {
    // Simulate an already-populated pre-v3 database (schema_version = 2)
    // whose agents table lacks the new columns.
    const legacy = new Database(dbPath);
    legacy.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      -- projects exists in every real v2 DB (created by the v1 migration);
      -- TASK-156's v9 migration adds bg_processes.project_id as an FK to this
      -- table, and openDb -> seedFromLegacy's writes to bg_processes require
      -- the FK target to exist once foreign_keys=ON — so a faithful pre-v3
      -- fixture must include it. Its absence is a fixture gap, not a migration
      -- defect.
      CREATE TABLE projects (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE CHECK (name GLOB '[A-Za-z0-9_-]*'),
        workdir TEXT NOT NULL,
        default_launch_cmd TEXT NOT NULL DEFAULT 'claude --dangerously-skip-permissions',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      );
      CREATE TABLE agents (
        id INTEGER PRIMARY KEY,
        name TEXT,
        workdir TEXT,
        launch_cmd TEXT,
        project_id INTEGER,
        created_at TEXT
      );
      -- bg_processes exists in every real v2 DB (created by the v1 migration);
      -- openDb -> seedFromLegacy inserts into it, so a faithful pre-v3 fixture
      -- must include it. Its absence is a fixture gap, not a migration defect.
      CREATE TABLE bg_processes (
        id INTEGER PRIMARY KEY,
        name TEXT,
        workdir TEXT,
        launch_cmd TEXT,
        linked_agent_id INTEGER
      );
      -- tasks exists in every real v2 DB too (also created by the v1
      -- migration) — TASK-125's v8 migration rebuilds this table, so a
      -- faithful pre-v3 fixture must include it (empty is fine; this test
      -- is about the agents columns, not tasks contents).
      CREATE TABLE tasks (
        id INTEGER PRIMARY KEY,
        command TEXT NOT NULL,
        agent_id INTEGER,
        project_id INTEGER,
        position REAL NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','backlog')),
        source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','schedule')),
        schedule_id INTEGER,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      );
    `);
    legacy
      .prepare(
        `INSERT INTO agents (name, workdir, launch_cmd, project_id, created_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .run('uat060_probe', '/tmp/probe', 'claude', null, '2026-01-01T00:00:00Z');
    legacy.prepare(`INSERT OR REPLACE INTO meta VALUES ('schema_version', '2')`).run();
    legacy.close();

    const db = openDb(dbPath);
    try {
      const cols = tableColumns(db, 'agents');
      assert.ok(
        cols.some((c) => c.name === 'worktree_path'),
        'worktree_path column should be added by v3 migration',
      );
      assert.ok(
        cols.some((c) => c.name === 'branch'),
        'branch column should be added by v3 migration',
      );

      // The pre-existing row must survive the migration. Assert by name because
      // openDb also runs seedFromLegacy, which may insert additional agents.
      const probe = db
        .prepare(
          `SELECT worktree_path, branch FROM agents WHERE name='uat060_probe'`,
        )
        .all() as { worktree_path: string | null; branch: string | null }[];
      assert.equal(probe.length, 1, 'pre-existing uat060_probe row should still exist');
      const row = probe[0];
      assert.ok(row, 'probe row should be present');
      assert.equal(row.worktree_path, null, 'new worktree_path should be NULL on migrated row');
      assert.equal(row.branch, null, 'new branch should be NULL on migrated row');

      assertSchemaVersionAtLeast(db, 3);
    } finally {
      db.close();
    }
  } finally {
    cleanupDbFiles(dbPath);
  }
});


// TASK-156: bg_processes gained a project_id scoping column (schema_version 9),
// added via `ALTER TABLE bg_processes ADD COLUMN project_id INTEGER REFERENCES
// projects(id) ON DELETE SET NULL` (a plain column add, not a table rebuild like
// v2/v8 above). The FK target means a faithful pre-v9 fixture needs a `projects`
// table too — even empty — for the ALTER TABLE's REFERENCES clause to be valid
// DDL, alongside the full v8-shape `agents`/`tasks` tables and the pre-v9
// `bg_processes` shape (no project_id column yet).
void test('existing pre-v9 DB gains bg_processes.project_id and preserves rows', () => {
  const dbPath = tmpDbPath('prev9');
  try {
    const legacy = new Database(dbPath);
    legacy.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE projects (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE CHECK (name GLOB '[A-Za-z0-9_-]*'),
        workdir TEXT NOT NULL,
        default_launch_cmd TEXT NOT NULL DEFAULT 'claude --dangerously-skip-permissions',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      );
      CREATE TABLE agents (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        workdir TEXT NOT NULL,
        launch_cmd TEXT NOT NULL,
        project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
        worktree_path TEXT,
        branch TEXT,
        role TEXT NOT NULL DEFAULT 'generic' CHECK (role IN ('generic','frontend','backend','qa','devops','security','architect'))
      );
      -- Pre-v9 bg_processes shape: no project_id column yet.
      CREATE TABLE bg_processes (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE CHECK (name GLOB '[A-Za-z0-9_-]*'),
        workdir TEXT NOT NULL,
        launch_cmd TEXT NOT NULL,
        linked_agent_id INTEGER REFERENCES agents(id) ON DELETE SET NULL
      );
      -- tasks exists in every real v8 DB (rebuilt by TASK-125's v8 migration) —
      -- include it in its post-v8 shape so openDb has a faithful pre-v9 fixture
      -- to migrate from (empty is fine; this test is about bg_processes).
      CREATE TABLE tasks (
        id INTEGER PRIMARY KEY,
        command TEXT NOT NULL,
        agent_id INTEGER REFERENCES agents(id) ON DELETE CASCADE,
        project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
        position REAL NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','backlog','done')),
        source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','schedule')),
        schedule_id INTEGER,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
        completed_at TEXT,
        CHECK (agent_id IS NULL OR project_id IS NULL)
      );
    `);
    legacy
      .prepare(
        `INSERT INTO bg_processes (name, workdir, launch_cmd, linked_agent_id) VALUES (?, ?, ?, ?)`,
      )
      .run('task156_probe', '/tmp/task156-probe', 'npm run dev', null);
    legacy.prepare(`INSERT OR REPLACE INTO meta VALUES ('schema_version', '8')`).run();
    legacy.close();

    const db = openDb(dbPath);
    try {
      const cols = tableColumns(db, 'bg_processes');
      assert.ok(
        cols.some((c) => c.name === 'project_id'),
        'bg_processes.project_id column should be added by v9 migration',
      );

      // The pre-existing row must survive the migration with project_id NULL.
      // Assert by name because openDb also runs seedFromLegacy, which may
      // insert additional bg_processes rows.
      const probe = db
        .prepare(`SELECT project_id FROM bg_processes WHERE name='task156_probe'`)
        .all() as { project_id: number | null }[];
      assert.equal(probe.length, 1, 'pre-existing task156_probe row should still exist');
      const row = probe[0];
      assert.ok(row, 'probe row should be present');
      assert.equal(row.project_id, null, 'new project_id should be NULL on migrated row');

      assertSchemaVersionAtLeast(db, 9);
    } finally {
      db.close();
    }
  } finally {
    cleanupDbFiles(dbPath);
  }
});

// v10 rewrites rows holding the exact old default launch command to the new
// default (adds --append-system-prompt-file) and leaves customised commands alone.
void test('v10 migration upgrades old default launch cmds on agents and projects only', () => {
  const dbPath = tmpDbPath('prev10');
  const oldCmd = 'claude --dangerously-skip-permissions';
  const newCmd =
    'claude --dangerously-skip-permissions --append-system-prompt-file ~/.claude/rules/agent-teams-preference.md';
  try {
    const legacy = new Database(dbPath);
    legacy.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE projects (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE CHECK (name GLOB '[A-Za-z0-9_-]*'),
        workdir TEXT NOT NULL,
        default_launch_cmd TEXT NOT NULL DEFAULT 'claude --dangerously-skip-permissions',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      );
      CREATE TABLE agents (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        workdir TEXT NOT NULL,
        launch_cmd TEXT NOT NULL,
        project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
        worktree_path TEXT,
        branch TEXT,
        role TEXT NOT NULL DEFAULT 'generic' CHECK (role IN ('generic','frontend','backend','qa','devops','security','architect'))
      );
      CREATE TABLE bg_processes (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE CHECK (name GLOB '[A-Za-z0-9_-]*'),
        workdir TEXT NOT NULL,
        launch_cmd TEXT NOT NULL,
        linked_agent_id INTEGER REFERENCES agents(id) ON DELETE SET NULL,
        project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL
      );
      CREATE TABLE tasks (
        id INTEGER PRIMARY KEY,
        command TEXT NOT NULL,
        agent_id INTEGER REFERENCES agents(id) ON DELETE CASCADE,
        project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
        position REAL NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','backlog','done')),
        source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','schedule')),
        schedule_id INTEGER,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
        completed_at TEXT,
        CHECK (agent_id IS NULL OR project_id IS NULL)
      );
    `);
    legacy.prepare(`INSERT INTO projects (name, workdir, default_launch_cmd) VALUES (?, ?, ?)`).run('p_old', '/w/p1', oldCmd);
    legacy.prepare(`INSERT INTO projects (name, workdir, default_launch_cmd) VALUES (?, ?, ?)`).run('p_custom', '/w/p2', 'codex --yolo');
    legacy.prepare(`INSERT INTO agents (name, workdir, launch_cmd) VALUES (?, ?, ?)`).run('a_old', '/w/a1', oldCmd);
    legacy.prepare(`INSERT INTO agents (name, workdir, launch_cmd) VALUES (?, ?, ?)`).run('a_custom', '/w/a2', 'claude --model opus');
    legacy.prepare(`INSERT INTO bg_processes (name, workdir, launch_cmd) VALUES (?, ?, ?)`).run('bg_old', '/w/b1', oldCmd);
    legacy.prepare(`INSERT OR REPLACE INTO meta VALUES ('schema_version', '9')`).run();
    legacy.prepare(`INSERT OR REPLACE INTO meta VALUES ('legacy_import', '1')`).run();
    legacy.close();

    const db = openDb(dbPath);
    try {
      const agentCmd = (n: string) =>
        (db.prepare(`SELECT launch_cmd FROM agents WHERE name=?`).get(n) as { launch_cmd: string }).launch_cmd;
      const projCmd = (n: string) =>
        (db.prepare(`SELECT default_launch_cmd AS c FROM projects WHERE name=?`).get(n) as { c: string }).c;
      assert.equal(agentCmd('a_old'), newCmd);
      assert.equal(agentCmd('a_custom'), 'claude --model opus');
      assert.equal(projCmd('p_old'), newCmd);
      assert.equal(projCmd('p_custom'), 'codex --yolo');
      // bg_processes are not agents; their commands must not be touched.
      const bg = db.prepare(`SELECT launch_cmd FROM bg_processes WHERE name='bg_old'`).get() as { launch_cmd: string };
      assert.equal(bg.launch_cmd, oldCmd);
      assertSchemaVersionAtLeast(db, 10);
    } finally {
      db.close();
    }
  } finally {
    cleanupDbFiles(dbPath);
  }
});

// TASK-0195: existing project-less bg_processes rows are backfilled from their
// workdir on open. Fixture is a faithful post-v10 (current-schema) DB whose
// bg_processes rows predate the "every bg process needs a project" rule. The
// NOT NULL rebuild is intentionally not part of this (TASK-0196); unmatched
// rows must only warn, never fail startup or be dropped.
void test('TASK-0195: openDb backfills bg_processes.project_id by workdir; unmatched rows warn and survive; scoped rows untouched; idempotent', () => {
  const dbPath = tmpDbPath('bgbackfill');
  const warnings: string[] = [];
  const origWarn = console.warn;
  const origLog = console.log;
  try {
    const legacy = new Database(dbPath);
    legacy.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE projects (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE CHECK (name GLOB '[A-Za-z0-9_-]*'),
        workdir TEXT NOT NULL,
        default_launch_cmd TEXT NOT NULL DEFAULT 'claude --dangerously-skip-permissions --append-system-prompt-file ~/.claude/rules/agent-teams-preference.md',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      );
      CREATE TABLE agents (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        workdir TEXT NOT NULL,
        launch_cmd TEXT NOT NULL,
        project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
        worktree_path TEXT,
        branch TEXT,
        role TEXT NOT NULL DEFAULT 'generic' CHECK (role IN ('generic','frontend','backend','qa','devops','security','architect'))
      );
      CREATE TABLE bg_processes (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE CHECK (name GLOB '[A-Za-z0-9_-]*'),
        workdir TEXT NOT NULL,
        launch_cmd TEXT NOT NULL,
        linked_agent_id INTEGER REFERENCES agents(id) ON DELETE SET NULL,
        project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL
      );
      CREATE TABLE tasks (
        id INTEGER PRIMARY KEY,
        command TEXT NOT NULL,
        agent_id INTEGER REFERENCES agents(id) ON DELETE CASCADE,
        project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
        position REAL NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','backlog','done')),
        source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','schedule')),
        schedule_id INTEGER,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
        completed_at TEXT,
        CHECK (agent_id IS NULL OR project_id IS NULL)
      );
    `);
    legacy.prepare(`INSERT INTO projects (id, name, workdir) VALUES (1, 'p_a', '/w/p_a')`).run();
    legacy.prepare(`INSERT INTO projects (id, name, workdir) VALUES (2, 'p_b', '/w/p_b')`).run();
    const insBg = legacy.prepare(`INSERT INTO bg_processes (name, workdir, launch_cmd, project_id) VALUES (?, ?, 'npm run dev', ?)`);
    insBg.run('bg_matched', '/w/p_a', null);
    insBg.run('bg_unmatched', '/w/nowhere', null);
    insBg.run('bg_scoped', '/w/p_a', 2); // workdir matches p_a but is already scoped to p_b
    legacy.prepare(`INSERT OR REPLACE INTO meta VALUES ('schema_version', '10')`).run();
    legacy.prepare(`INSERT OR REPLACE INTO meta VALUES ('legacy_import', '1')`).run();
    legacy.close();

    console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')); };
    console.log = () => { /* silence backfill info log */ };

    const projectOf = (db: Database.Database, name: string): number | null =>
      (db.prepare(`SELECT project_id AS p FROM bg_processes WHERE name=?`).get(name) as { p: number | null }).p;

    const db = openDb(dbPath);
    try {
      assert.equal(projectOf(db, 'bg_matched'), 1, 'workdir match assigns the project');
      assert.equal(projectOf(db, 'bg_unmatched'), null, 'unmatched row stays NULL (not dropped, no crash)');
      assert.equal(projectOf(db, 'bg_scoped'), 2, 'already-scoped row is never reassigned');
      assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM bg_processes`).get() as { n: number }).n, 3);
      assert.equal(warnings.length, 1);
      assert.match(warnings[0] ?? '', /bg_unmatched/);
      assert.ok(!/bg_matched|bg_scoped/.test(warnings[0] ?? ''), 'only unmatched rows are listed in the warning');
    } finally {
      db.close();
    }

    // Idempotent: reopening changes nothing and warns about the same lone row.
    warnings.length = 0;
    const db2 = openDb(dbPath);
    try {
      assert.equal(projectOf(db2, 'bg_matched'), 1);
      assert.equal(projectOf(db2, 'bg_unmatched'), null);
      assert.equal(projectOf(db2, 'bg_scoped'), 2);
      assert.equal(warnings.length, 1);
    } finally {
      db2.close();
    }
  } finally {
    console.warn = origWarn;
    console.log = origLog;
    cleanupDbFiles(dbPath);
  }
});

void test('fresh DB has agent_usage table with expected columns', () => {
  const db = openDb(':memory:');
  try {
    const cols = tableColumns(db, 'agent_usage');
    const names = cols.map((c) => c.name);
    for (const expected of [
      'id',
      'agent_id',
      'session_start',
      'input_tokens',
      'output_tokens',
      'cache_creation_input_tokens',
      'cache_read_input_tokens',
      'cost_usd',
      'updated_at',
    ]) {
      assert.ok(names.includes(expected), `agent_usage.${expected} column should exist`);
    }
    assertSchemaVersionAtLeast(db, 4);
  } finally {
    db.close();
  }
});

void test('TASK-063: createAgent leaves worktreePath and branch null when workdir is not inside a git repository', () => {
  // Precondition for the DELETE /agents/:id worktree-teardown path: agents
  // created against a non-git workdir must have worktree_path/branch = NULL
  // so the route's `if (entry.worktreePath)` guard skips cleanup silently.
  const db = openDb(':memory:');
  try {
    const agent = createAgent(db, { name: 'uat063-nogit', workdir: '/tmp/uat063-nonexistent-nogit-dir', launchCmd: 'claude' });
    assert.equal(agent.worktreePath, null);
    assert.equal(agent.branch, null);
  } finally {
    db.close();
  }
});

function git(dir: string, ...args: string[]): void {
  const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr}`);
}

/** Trimmed `git branch --list <branch>` output for `gitRoot`, `''` when the branch does not exist. */
function branchListing(gitRoot: string, branch: string): string {
  return spawnSync('git', ['-C', gitRoot, 'branch', '--list', branch], { encoding: 'utf8' }).stdout.trim();
}

/** Create a throwaway git repo under ./tmp with one commit on `main`. */
function makeRepo(label: string): string {
  fs.mkdirSync(tmpDir, { recursive: true });
  const rand = Math.random().toString(36).slice(2, 10);
  const dir = fs.mkdtempSync(path.join(tmpDir, `roadmap007-${label}-${rand}-`));
  git(dir, 'init', '-b', 'main');
  git(dir, '-c', 'user.email=test@test.local', '-c', 'user.name=Test', 'commit', '--allow-empty', '-m', 'init');
  return dir;
}

function cleanupRepoAndWorktrees(gitRoot: string): void {
  // Prune any worktrees git still has registered before deleting the tree,
  // same as git.test.ts, so a later test's `git worktree add` never collides.
  spawnSync('git', ['-C', gitRoot, 'worktree', 'list', '--porcelain'], { encoding: 'utf8' }).stdout
    .split('\n\n')
    .forEach((block) => {
      const m = /^worktree (.+)$/m.exec(block);
      const worktreePath = m?.[1];
      if (worktreePath && worktreePath !== gitRoot) {
        spawnSync('git', ['-C', gitRoot, 'worktree', 'remove', '--force', worktreePath], { encoding: 'utf8' });
      }
    });
  fs.rmSync(gitRoot, { recursive: true, force: true });
  fs.rmSync(`${gitRoot}-worktrees`, { recursive: true, force: true });
}

void test('ROADMAP-007: createAgent leaves worktree_path/branch null by default, even inside a git repo (worktrees are opt-in)', () => {
  const repo = makeRepo('default-no-worktree');
  try {
    const db = openDb(':memory:');
    try {
      const agent = createAgent(db, { name: 'wt-default', workdir: repo, launchCmd: 'claude' });
      assert.equal(agent.worktreePath, null);
      assert.equal(agent.branch, null);
    } finally {
      db.close();
    }
  } finally {
    cleanupRepoAndWorktrees(repo);
  }
});

void test('ROADMAP-007: createAgent creates a sibling worktree (not nested) when useWorktree is true', () => {
  const repo = makeRepo('opt-in-worktree');
  try {
    const db = openDb(':memory:');
    try {
      const agent = createAgent(db, { name: 'wt-opt-in', workdir: repo, launchCmd: 'claude', useWorktree: true });
      assert.equal(agent.branch, `conductor/${String(agent.id)}`);
      assert.ok(agent.worktreePath);
      const worktreePath = agent.worktreePath;
      assert.ok(fs.existsSync(worktreePath));
      // Sibling of the repo root, not nested inside it.
      assert.equal(path.dirname(worktreePath), `${repo}-worktrees`);
      assert.ok(!worktreePath.startsWith(path.join(repo, 'worktrees')));
    } finally {
      db.close();
    }
  } finally {
    cleanupRepoAndWorktrees(repo);
  }
});

void test('ROADMAP-007: addWorktreeToAgent opts an existing agent into a worktree retroactively', () => {
  const repo = makeRepo('retroactive-opt-in');
  try {
    const db = openDb(':memory:');
    try {
      const created = createAgent(db, { name: 'wt-retro', workdir: repo, launchCmd: 'claude' });
      assert.equal(created.worktreePath, null);

      const updated = addWorktreeToAgent(db, created.id);
      assert.equal(updated.branch, `conductor/${String(created.id)}`);
      assert.ok(updated.worktreePath && fs.existsSync(updated.worktreePath));

      assert.throws(
        () => { addWorktreeToAgent(db, created.id); },
        (err: unknown) => err instanceof WorktreeError && err.code === 'already-has-worktree' && /already has a worktree/.test(err.message),
      );
    } finally {
      db.close();
    }
  } finally {
    cleanupRepoAndWorktrees(repo);
  }
});

void test('ROADMAP-007: addWorktreeToAgent throws for a non-git workdir and for an unknown agent id', () => {
  const db = openDb(':memory:');
  try {
    const nogit = createAgent(db, { name: 'wt-nogit', workdir: '/tmp/roadmap007-nogit-dir', launchCmd: 'claude' });
    assert.throws(
      () => { addWorktreeToAgent(db, nogit.id); },
      (err: unknown) => err instanceof WorktreeError && err.code === 'not-git-repo' && /not inside a git repository/.test(err.message),
    );
    assert.throws(
      () => { addWorktreeToAgent(db, 999999); },
      (err: unknown) => err instanceof WorktreeError && err.code === 'not-found' && /not found/.test(err.message),
    );
  } finally {
    db.close();
  }
});

void test('TASK-0210: addWorktreeToAgent surfaces the real git reason as a git-failed WorktreeError', () => {
  const repo = makeRepo('git-failed-reason');
  try {
    const db = openDb(':memory:');
    try {
      const created = createAgent(db, { name: 'wt-collide', workdir: repo, launchCmd: 'claude' });
      assert.equal(created.worktreePath, null);

      // Pre-create the branch createWorktree will try to `-b` so `git worktree add` fails.
      git(repo, 'branch', `conductor/${String(created.id)}`);

      assert.throws(
        () => { addWorktreeToAgent(db, created.id); },
        (err: unknown) =>
          err instanceof WorktreeError &&
          err.code === 'git-failed' &&
          /failed to create git worktree at/.test(err.message) &&
          /already exists/.test(err.message),
      );
    } finally {
      db.close();
    }
  } finally {
    cleanupRepoAndWorktrees(repo);
  }
});

function worktreeListPaths(gitRoot: string): string[] {
  return spawnSync('git', ['-C', gitRoot, 'worktree', 'list', '--porcelain'], { encoding: 'utf8' }).stdout
    .split('\n')
    .filter((l) => l.startsWith('worktree '))
    .map((l) => fs.realpathSync(l.slice('worktree '.length)));
}

void test('TASK-0213: cloneAgentRecord with forceWorktree gives a worktree-less source a fresh sibling worktree', () => {
  const repo = makeRepo('clone-force-none');
  try {
    const db = openDb(':memory:');
    try {
      const source = createAgent(db, { name: 'src', workdir: repo, launchCmd: 'claude' });
      assert.equal(source.worktreePath, null);

      const clone = cloneAgentRecord(db, source, { forceWorktree: true });
      assert.notEqual(clone.id, source.id);
      assert.equal(clone.branch, `conductor/${String(clone.id)}`);
      assert.ok(clone.worktreePath);
      assert.equal(path.dirname(clone.worktreePath), `${repo}-worktrees`);
      assert.equal(path.basename(clone.worktreePath), String(clone.id));
      assert.ok(fs.existsSync(clone.worktreePath));
      // The clone keeps the source's workdir; the source is untouched.
      assert.equal(clone.workdir, repo);
      assert.equal(listAgents(db).find((a) => a.id === source.id)?.worktreePath, null);
    } finally {
      db.close();
    }
  } finally {
    cleanupRepoAndWorktrees(repo);
  }
});

void test('TASK-0213: cloneAgentRecord with forceWorktree gives a worktree-backed source a second, distinct worktree', () => {
  const repo = makeRepo('clone-force-has');
  try {
    const db = openDb(':memory:');
    try {
      const source = createAgent(db, { name: 'src', workdir: repo, launchCmd: 'claude', useWorktree: true });
      assert.ok(source.worktreePath);

      const clone = cloneAgentRecord(db, source, { forceWorktree: true });
      assert.ok(clone.worktreePath);
      assert.notEqual(clone.worktreePath, source.worktreePath);
      assert.notEqual(clone.branch, source.branch);
      assert.ok(fs.existsSync(source.worktreePath));
      assert.ok(fs.existsSync(clone.worktreePath));
      const listed = worktreeListPaths(repo);
      assert.ok(listed.includes(fs.realpathSync(source.worktreePath)));
      assert.ok(listed.includes(fs.realpathSync(clone.worktreePath)));
    } finally {
      db.close();
    }
  } finally {
    cleanupRepoAndWorktrees(repo);
  }
});

void test('TASK-0213: cloneAgentRecord without the flag keeps the previous worktree-ness of the source', () => {
  const repo = makeRepo('clone-noflag');
  try {
    const db = openDb(':memory:');
    try {
      const plain = createAgent(db, { name: 'plain', workdir: repo, launchCmd: 'claude' });
      const plainClone = cloneAgentRecord(db, plain);
      assert.equal(plainClone.worktreePath, null);
      assert.equal(plainClone.branch, null);

      const backed = createAgent(db, { name: 'backed', workdir: repo, launchCmd: 'claude', useWorktree: true });
      const backedClone = cloneAgentRecord(db, backed);
      assert.ok(backedClone.worktreePath);
      assert.notEqual(backedClone.worktreePath, backed.worktreePath);
    } finally {
      db.close();
    }
  } finally {
    cleanupRepoAndWorktrees(repo);
  }
});

void test('TASK-0213: forceWorktree on a non-git workdir throws not-git-repo and leaves no clone row', () => {
  const db = openDb(':memory:');
  const plainDir = fs.mkdtempSync(path.join(tmpDir, 'task0213-nogit-'));
  // ./tmp sits inside the tmux-conductor work tree; cap git's upward search there.
  const prevCeiling = process.env['GIT_CEILING_DIRECTORIES'];
  process.env['GIT_CEILING_DIRECTORIES'] = tmpDir;
  try {
    const source = createAgent(db, { name: 'src', workdir: plainDir, launchCmd: 'claude' });
    const before = listAgents(db).length;
    assert.throws(
      () => cloneAgentRecord(db, source, { forceWorktree: true }),
      (err: unknown) => err instanceof WorktreeError && err.code === 'not-git-repo',
    );
    assert.equal(listAgents(db).length, before);
  } finally {
    if (prevCeiling === undefined) delete process.env['GIT_CEILING_DIRECTORIES'];
    else process.env['GIT_CEILING_DIRECTORIES'] = prevCeiling;
    db.close();
    fs.rmSync(plainDir, { recursive: true, force: true });
  }
});

void test('TASK-0213: a forced clone whose git worktree add fails throws git-failed, rolls the row back and leaves no directory', () => {
  const repo = makeRepo('clone-force-gitfail');
  try {
    const db = openDb(':memory:');
    try {
      const source = createAgent(db, { name: 'src', workdir: repo, launchCmd: 'claude' });
      const nextId = (db.prepare(`SELECT MAX(id) AS m FROM agents`).get() as { m: number }).m + 1;
      // Pre-create the branch the clone's `git worktree add -b` will want.
      git(repo, 'branch', `conductor/${String(nextId)}`);
      const before = listAgents(db).length;

      assert.throws(
        () => cloneAgentRecord(db, source, { forceWorktree: true }),
        (err: unknown) =>
          err instanceof WorktreeError && err.code === 'git-failed' && /already exists/.test(err.message),
      );
      assert.equal(listAgents(db).length, before);
      assert.equal(fs.existsSync(path.join(`${repo}-worktrees`, String(nextId))), false);
    } finally {
      db.close();
    }
  } finally {
    cleanupRepoAndWorktrees(repo);
  }
});

void test('TASK-0213: a forced clone whose worktree add fails after creating the branch leaves no stray conductor/<id> branch, and a retry succeeds', () => {
  const repo = makeRepo('clone-force-strayrefs');
  try {
    const db = openDb(':memory:');
    try {
      const source = createAgent(db, { name: 'src', workdir: repo, launchCmd: 'claude' });
      const nextId = (db.prepare(`SELECT MAX(id) AS m FROM agents`).get() as { m: number }).m + 1;
      const branch = `conductor/${String(nextId)}`;
      // A plain file where the sibling worktrees dir should be: `git worktree add -b`
      // creates the branch, then fails to create the leading directories.
      const siblingDir = `${repo}-worktrees`;
      fs.writeFileSync(siblingDir, 'not a directory\n');
      const before = listAgents(db).length;

      assert.throws(
        () => cloneAgentRecord(db, source, { forceWorktree: true }),
        (err: unknown) => err instanceof WorktreeError && err.code === 'git-failed',
      );
      assert.equal(listAgents(db).length, before);
      assert.equal(branchListing(repo, branch), '', 'failed attempt must not leak its branch');

      // The id is reused by the retry; its `-b` must not collide with a leftover branch.
      fs.rmSync(siblingDir, { force: true });
      const clone = cloneAgentRecord(db, source, { forceWorktree: true });
      assert.equal(clone.id, nextId);
      assert.equal(clone.branch, branch);
      assert.ok(clone.worktreePath && fs.existsSync(clone.worktreePath));
    } finally {
      db.close();
    }
  } finally {
    cleanupRepoAndWorktrees(repo);
  }
});

void test('TASK-0213: rolling back a failed forced clone does not delete a conductor/<id> branch that pre-existed', () => {
  const repo = makeRepo('clone-force-keepbranch');
  try {
    const db = openDb(':memory:');
    try {
      const source = createAgent(db, { name: 'src', workdir: repo, launchCmd: 'claude' });
      const nextId = (db.prepare(`SELECT MAX(id) AS m FROM agents`).get() as { m: number }).m + 1;
      const branch = `conductor/${String(nextId)}`;
      git(repo, 'branch', branch);

      assert.throws(
        () => cloneAgentRecord(db, source, { forceWorktree: true }),
        (err: unknown) => err instanceof WorktreeError && err.code === 'git-failed',
      );
      assert.equal(branchListing(repo, branch), branch, 'a pre-existing branch is not ours to delete');
    } finally {
      db.close();
    }
  } finally {
    cleanupRepoAndWorktrees(repo);
  }
});

void test('TASK-0213: forceWorktree from a subdirectory workdir lands the worktree beside the git root, not the subdirectory', () => {
  const repo = makeRepo('clone-force-subdir');
  try {
    const sub = path.join(repo, 'packages', 'app');
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(path.join(sub, 'index.txt'), 'x\n');
    git(repo, 'add', '.');
    git(repo, '-c', 'user.email=test@test.local', '-c', 'user.name=Test', 'commit', '-m', 'subdir');

    const db = openDb(':memory:');
    try {
      const source = createAgent(db, { name: 'src', workdir: sub, launchCmd: 'claude' });
      const clone = cloneAgentRecord(db, source, { forceWorktree: true });
      assert.ok(clone.worktreePath);
      assert.equal(path.dirname(clone.worktreePath), `${repo}-worktrees`);
      assert.equal(clone.workdir, sub);
      assert.ok(fs.existsSync(path.join(clone.worktreePath, 'packages', 'app', 'index.txt')));
    } finally {
      db.close();
    }
  } finally {
    cleanupRepoAndWorktrees(repo);
  }
});

// TASK-0212: sibling-directory guard, end to end through createAgent / addWorktreeToAgent.
// The "guard refusal" path is intentionally NOT covered here: siblingWorktreePath is
// not injectable into db.ts (no seam to force a nested target), so the refusal is
// covered at the unit level via tryCreateWorktree / assertWorktreeOutsideRoot in git.test.ts.

/** makeRepo plus a committed file at packages/app, so the subdir is tracked and `git status` is meaningful. */
function makeRepoWithSubdir(label: string): { repo: string; subdir: string } {
  const repo = makeRepo(label);
  const subdir = path.join(repo, 'packages', 'app');
  fs.mkdirSync(subdir, { recursive: true });
  fs.writeFileSync(path.join(subdir, 'index.txt'), 'app\n');
  git(repo, 'add', '-A');
  git(repo, '-c', 'user.email=test@test.local', '-c', 'user.name=Test', 'commit', '-m', 'add packages/app');
  return { repo, subdir };
}

function assertSiblingWorktree(repo: string, agentId: number, worktreePath: string | null, siblingExistedBefore: boolean): void {
  const realParent = fs.realpathSync(path.dirname(repo));
  const siblingDir = path.join(realParent, `${path.basename(repo)}-worktrees`);
  assert.equal(siblingExistedBefore, false, 'precondition: sibling worktrees dir must not exist before creation');
  assert.ok(worktreePath);
  assert.equal(worktreePath, path.join(siblingDir, String(agentId)));
  // Not equal to, or nested under, the repo root.
  assert.ok(path.relative(repo, worktreePath).startsWith('..'), `worktree ${worktreePath} must be outside ${repo}`);
  assert.ok(path.relative(fs.realpathSync(repo), worktreePath).startsWith('..'), 'worktree must be outside the real repo root');
  // Newly created sibling directory.
  assert.ok(fs.existsSync(siblingDir), 'sibling worktrees dir should exist after creation');
  assert.ok(fs.existsSync(worktreePath));
  // Source tree stays clean: no untracked worktree directory inside the repo.
  const status = spawnSync('git', ['-C', repo, 'status', '--porcelain'], { encoding: 'utf8' });
  assert.equal(status.status, 0, `git status failed: ${status.stderr}`);
  assert.equal(status.stdout.trim(), '');
}

void test('TASK-0212: addWorktreeToAgent for a subdirectory workdir creates the worktree as a sibling of the repo root', () => {
  const { repo, subdir } = makeRepoWithSubdir('subdir-retro');
  try {
    const db = openDb(':memory:');
    try {
      const created = createAgent(db, { name: 'wt-subdir-retro', workdir: subdir, launchCmd: 'claude' });
      assert.equal(created.worktreePath, null);

      const siblingDir = path.join(fs.realpathSync(path.dirname(repo)), `${path.basename(repo)}-worktrees`);
      const existedBefore = fs.existsSync(siblingDir);

      const updated = addWorktreeToAgent(db, created.id);
      assertSiblingWorktree(repo, created.id, updated.worktreePath, existedBefore);
    } finally {
      db.close();
    }
  } finally {
    cleanupRepoAndWorktrees(repo);
  }
});

void test('TASK-0212: createAgent({ useWorktree: true }) for a subdirectory workdir creates the worktree as a sibling of the repo root', () => {
  const { repo, subdir } = makeRepoWithSubdir('subdir-create');
  try {
    const db = openDb(':memory:');
    try {
      const siblingDir = path.join(fs.realpathSync(path.dirname(repo)), `${path.basename(repo)}-worktrees`);
      const existedBefore = fs.existsSync(siblingDir);

      const agent = createAgent(db, { name: 'wt-subdir-create', workdir: subdir, launchCmd: 'claude', useWorktree: true });
      assertSiblingWorktree(repo, agent.id, agent.worktreePath, existedBefore);
    } finally {
      db.close();
    }
  } finally {
    cleanupRepoAndWorktrees(repo);
  }
});

void test('TASK-062 bugfix: clearAgentWorktree nulls out worktree_path and branch for stale references', () => {
  // Covers the "live check on read" self-heal: if the worktree directory is
  // removed outside the app's own delete-agent flow, the serialization layer
  // detects the missing directory via fs.existsSync and calls this helper
  // once so subsequent reads don't need to re-check.
  const db = openDb(':memory:');
  try {
    const agent = createAgent(db, { name: 'uat-stale-worktree', workdir: '/tmp/uat-stale-worktree-nogit-dir', launchCmd: 'claude' });
    db.prepare(`UPDATE agents SET branch = ?, worktree_path = ? WHERE id = ?`)
      .run(`conductor/${String(agent.id)}`, `/repo/worktrees/${String(agent.id)}-removed`, agent.id);

    const before = listAgents(db).find((a) => a.id === agent.id);
    assert.ok(before?.worktreePath, 'precondition: worktreePath should be set before clearing');
    assert.ok(before.branch, 'precondition: branch should be set before clearing');

    clearAgentWorktree(db, agent.id);

    const after = listAgents(db).find((a) => a.id === agent.id);
    assert.equal(after?.worktreePath, null, 'clearAgentWorktree should null out worktreePath');
    assert.equal(after.branch, null, 'clearAgentWorktree should null out branch');
  } finally {
    db.close();
  }
});

void test('upsertAgentUsage is idempotent on (agent_id, session_start)', () => {
  const db = openDb(':memory:');
  try {
    const agent = createAgent(db, { name: 'uat072-upsert', workdir: '/tmp/uat072', launchCmd: 'claude' });
    const sessionStart = '2026-07-06T00:00:00Z';

    upsertAgentUsage(db, {
      agentId: agent.id, sessionStart,
      inputTokens: 10, outputTokens: 20, costUsd: 0.01,
    });
    const second = upsertAgentUsage(db, {
      agentId: agent.id, sessionStart,
      inputTokens: 100, outputTokens: 200,
      cacheCreationInputTokens: 300, cacheReadInputTokens: 400,
      costUsd: 0.05,
    });

    const rows = listAgentUsage(db, agent.id);
    assert.equal(rows.length, 1, 'second upsert for the same pair should update in place');
    const row = rows[0];
    assert.ok(row);
    assert.equal(row.id, second.id);
    assert.equal(row.inputTokens, 100);
    assert.equal(row.outputTokens, 200);
    assert.equal(row.cacheCreationInputTokens, 300);
    assert.equal(row.cacheReadInputTokens, 400);
    assert.equal(row.costUsd, 0.05);
  } finally {
    db.close();
  }
});

void test('usage totals aggregate across sessions and cascade on agent delete', () => {
  const db = openDb(':memory:');
  try {
    const agent = createAgent(db, { name: 'uat072-totals', workdir: '/tmp/uat072', launchCmd: 'claude' });
    upsertAgentUsage(db, {
      agentId: agent.id, sessionStart: '2026-07-06T00:00:00Z',
      inputTokens: 1, outputTokens: 2, cacheReadInputTokens: 5, costUsd: 0.01,
    });
    upsertAgentUsage(db, {
      agentId: agent.id, sessionStart: '2026-07-06T01:00:00Z',
      inputTokens: 10, outputTokens: 20, cacheCreationInputTokens: 7, costUsd: 0.02,
    });

    const totals = getAgentUsageTotals(db, agent.id);
    assert.equal(totals.sessions, 2);
    assert.equal(totals.inputTokens, 11);
    assert.equal(totals.outputTokens, 22);
    assert.equal(totals.cacheCreationInputTokens, 7);
    assert.equal(totals.cacheReadInputTokens, 5);
    assert.ok(Math.abs(totals.costUsd - 0.03) < 1e-9);

    const all = getAllAgentUsageTotals(db);
    const mine = all.find((t) => t.agentId === agent.id);
    assert.ok(mine, 'getAllAgentUsageTotals should include the agent');
    assert.equal(mine.sessions, 2);

    deleteAgent(db, agent.id);
    assert.equal(listAgentUsage(db, agent.id).length, 0, 'usage rows should cascade on agent delete');
    assert.equal(getAgentUsageTotals(db, agent.id).sessions, 0);
  } finally {
    db.close();
  }
});

void test('agent_usage table and schema_version persist across a real file-backed migration', () => {
  // The in-memory tests above prove the migration DDL is correct; this proves
  // the same migration runs cleanly against an actual on-disk DB file (the
  // real deployment path via openDb(DB_PATH)), matching the task's smoke-test
  // acceptance criterion.
  const dbPath = tmpDbPath('agent-usage-file');
  try {
    const db = openDb(dbPath);
    try {
      const cols = tableColumns(db, 'agent_usage').map((c) => c.name);
      for (const expected of [
        'id', 'agent_id', 'session_start', 'input_tokens', 'output_tokens',
        'cache_creation_input_tokens', 'cache_read_input_tokens', 'cost_usd', 'updated_at',
      ]) {
        assert.ok(cols.includes(expected), `agent_usage.${expected} column should exist on a file-backed DB`);
      }
      assertSchemaVersionAtLeast(db, 4);
    } finally {
      db.close();
    }
  } finally {
    cleanupDbFiles(dbPath);
  }
});

void test('agent_usage schema enforces UNIQUE(agent_id, session_start) independent of the upsert wrapper', () => {
  // upsertAgentUsage relies on ON CONFLICT to stay idempotent; this proves the
  // constraint is a real schema guarantee (a raw duplicate INSERT throws),
  // not just an artifact of the wrapper's SQL.
  const db = openDb(':memory:');
  try {
    const agent = createAgent(db, { name: 'uat072-raw-unique', workdir: '/tmp/uat072', launchCmd: 'claude' });
    db.prepare(
      `INSERT INTO agent_usage (agent_id, session_start, input_tokens, output_tokens, cost_usd) VALUES (?, ?, 1, 1, 0)`,
    ).run(agent.id, '2026-07-06T00:00:00Z');
    assert.throws(
      () => {
        db.prepare(
          `INSERT INTO agent_usage (agent_id, session_start, input_tokens, output_tokens, cost_usd) VALUES (?, ?, 2, 2, 0)`,
        ).run(agent.id, '2026-07-06T00:00:00Z');
      },
      /UNIQUE constraint failed/,
      'a second raw INSERT for the same (agent_id, session_start) should violate the UNIQUE constraint',
    );
  } finally {
    db.close();
  }
});

void test('getAgentUsageTotals and getAllAgentUsageTotals isolate totals per agent', () => {
  const db = openDb(':memory:');
  try {
    const a1 = createAgent(db, { name: 'uat072-iso-a', workdir: '/tmp/uat072', launchCmd: 'claude' });
    const a2 = createAgent(db, { name: 'uat072-iso-b', workdir: '/tmp/uat072', launchCmd: 'claude' });
    upsertAgentUsage(db, { agentId: a1.id, sessionStart: '2026-07-06T00:00:00Z', inputTokens: 100, outputTokens: 50, costUsd: 0.1 });
    upsertAgentUsage(db, { agentId: a1.id, sessionStart: '2026-07-06T01:00:00Z', inputTokens: 10, outputTokens: 5, costUsd: 0.01 });
    upsertAgentUsage(db, { agentId: a2.id, sessionStart: '2026-07-06T00:00:00Z', inputTokens: 1000, outputTokens: 500, costUsd: 1.0 });

    const t1 = getAgentUsageTotals(db, a1.id);
    const t2 = getAgentUsageTotals(db, a2.id);
    assert.equal(t1.sessions, 2);
    assert.equal(t1.inputTokens, 110);
    assert.equal(t1.outputTokens, 55);
    assert.equal(t2.sessions, 1);
    assert.equal(t2.inputTokens, 1000);
    assert.equal(t2.outputTokens, 500);

    const all = getAllAgentUsageTotals(db);
    const found1 = all.find((t) => t.agentId === a1.id);
    const found2 = all.find((t) => t.agentId === a2.id);
    assert.ok(found1);
    assert.ok(found2);
    assert.equal(found1.inputTokens, 110, 'getAllAgentUsageTotals should not mix agent 1 totals with agent 2');
    assert.equal(found2.inputTokens, 1000, 'getAllAgentUsageTotals should not mix agent 2 totals with agent 1');
  } finally {
    db.close();
  }
});

void test('fresh DB has agent_checkpoints table with expected columns and index', () => {
  const db = openDb(':memory:');
  try {
    const cols = tableColumns(db, 'agent_checkpoints');
    const names = cols.map((c) => c.name);
    for (const expected of ['id', 'agent_id', 'ts', 'stash_ref', 'created_at']) {
      assert.ok(names.includes(expected), `agent_checkpoints.${expected} column should exist`);
    }
    const indexes = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='agent_checkpoints'`)
      .all() as { name: string }[];
    assert.ok(
      indexes.some((i) => i.name === 'idx_agent_checkpoints_agent_id'),
      'idx_agent_checkpoints_agent_id index should exist',
    );
    assertSchemaVersionAtLeast(db, 5);
  } finally {
    db.close();
  }
});

void test('agent_checkpoints cascade-deletes when parent agent is deleted', () => {
  const db = openDb(':memory:');
  try {
    const agent = createAgent(db, { name: 'uat067-cascade', workdir: '/tmp/uat067', launchCmd: 'claude' });
    insertCheckpoint(db, agent.id, Date.now(), 'stash@{0}');
    assert.equal(listCheckpoints(db, agent.id).length, 1);

    deleteAgent(db, agent.id);
    assert.equal(
      listCheckpoints(db, agent.id).length,
      0,
      'checkpoints should cascade-delete when the parent agent row is deleted',
    );
  } finally {
    db.close();
  }
});

void test('insertCheckpoint/listCheckpoints/getCheckpoint round-trip and ordering', () => {
  const db = openDb(':memory:');
  try {
    const agent = createAgent(db, { name: 'uat067-crud', workdir: '/tmp/uat067', launchCmd: 'claude' });
    const first = insertCheckpoint(db, agent.id, 1000, 'stash@{0}');
    const second = insertCheckpoint(db, agent.id, 2000, 'stash@{1}');

    const list = listCheckpoints(db, agent.id);
    assert.equal(list.length, 2);
    assert.equal(list[0]?.id, second.id, 'listCheckpoints should order by ts DESC (newest first)');
    assert.equal(list[1]?.id, first.id);

    const fetched = getCheckpoint(db, first.id);
    assert.ok(fetched, 'getCheckpoint should find the inserted row');
    assert.equal(fetched.agentId, agent.id);
    assert.equal(fetched.stashRef, 'stash@{0}');
    assert.equal(fetched.ts, 1000);

    assert.equal(getCheckpoint(db, 999999), undefined, 'getCheckpoint should return undefined for an unknown id');
  } finally {
    db.close();
  }
});

void test('fresh DB has agent_terminal_log table with expected columns and index', () => {
  const db = openDb(':memory:');
  try {
    const cols = tableColumns(db, 'agent_terminal_log');
    const names = cols.map((c) => c.name);
    for (const expected of ['id', 'agent_id', 'ts', 'chunk']) {
      assert.ok(names.includes(expected), `agent_terminal_log.${expected} column should exist`);
    }
    const indexes = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='agent_terminal_log'`)
      .all() as { name: string }[];
    assert.ok(
      indexes.some((i) => i.name === 'idx_agent_terminal_log_agent_ts'),
      'idx_agent_terminal_log_agent_ts index should exist',
    );
    assertSchemaVersionAtLeast(db, 6);
  } finally {
    db.close();
  }
});

void test('agent_terminal_log cascade-deletes when parent agent is deleted', () => {
  const db = openDb(':memory:');
  try {
    const agent = createAgent(db, { name: 'uat106-cascade', workdir: '/tmp/uat106-cascade', launchCmd: 'claude' });
    appendTerminalLogChunk(db, agent.id, 'chunk one', 100);
    appendTerminalLogChunk(db, agent.id, 'chunk two', 100);
    assert.equal(listTerminalLog(db, agent.id).length, 2);

    deleteAgent(db, agent.id);
    assert.equal(
      listTerminalLog(db, agent.id).length,
      0,
      'terminal log rows should cascade-delete when the parent agent row is deleted',
    );
  } finally {
    db.close();
  }
});

void test('appendTerminalLogChunk/listTerminalLog round-trip in chronological order without cross-agent contamination', () => {
  const db = openDb(':memory:');
  try {
    const agentA = createAgent(db, { name: 'uat106-order-a', workdir: '/tmp/uat106-order-a', launchCmd: 'claude' });
    const agentB = createAgent(db, { name: 'uat106-order-b', workdir: '/tmp/uat106-order-b', launchCmd: 'claude' });

    const first = appendTerminalLogChunk(db, agentA.id, 'a-chunk-1', 100);
    const second = appendTerminalLogChunk(db, agentA.id, 'a-chunk-2', 100);
    const third = appendTerminalLogChunk(db, agentA.id, 'a-chunk-3', 100);
    appendTerminalLogChunk(db, agentB.id, 'b-chunk-1', 100);
    appendTerminalLogChunk(db, agentB.id, 'b-chunk-2', 100);

    const list = listTerminalLog(db, agentA.id);
    assert.equal(list.length, 3, 'listTerminalLog should only return agent A rows');
    assert.deepEqual(list.map((r) => r.chunk), ['a-chunk-1', 'a-chunk-2', 'a-chunk-3']);
    assert.deepEqual(list.map((r) => r.id), [first.id, second.id, third.id]);

    for (const row of list) {
      assert.equal(row.agentId, agentA.id);
      assert.ok(typeof row.ts === 'string' && row.ts.length > 0, 'ts should be a non-empty string');
      assert.ok(typeof row.id === 'number');
      assert.ok(typeof row.chunk === 'string');
    }

    const listB = listTerminalLog(db, agentB.id);
    assert.deepEqual(listB.map((r) => r.chunk), ['b-chunk-1', 'b-chunk-2']);
    assert.ok(
      listB.every((r) => r.agentId === agentB.id),
      'agent B rows should not include agent A data',
    );
  } finally {
    db.close();
  }
});

void test('appendTerminalLogChunk prunes oldest rows beyond maxRowsPerAgent, keeping the newest', () => {
  const db = openDb(':memory:');
  try {
    const agent = createAgent(db, { name: 'uat106-cap', workdir: '/tmp/uat106-cap', launchCmd: 'claude' });
    const cap = 3;
    for (const chunk of ['c0', 'c1', 'c2', 'c3', 'c4']) {
      appendTerminalLogChunk(db, agent.id, chunk, cap);
    }

    const list = listTerminalLog(db, agent.id);
    assert.equal(list.length, cap, `only the newest ${String(cap)} rows should survive the cap`);
    assert.deepEqual(
      list.map((r) => r.chunk),
      ['c2', 'c3', 'c4'],
      'the oldest chunks (c0, c1) should be pruned, leaving the newest three in insertion order',
    );
  } finally {
    db.close();
  }
});


void test('TASK-062: listAgents exposes non-null branch and worktreePath as camelCase fields', () => {
  // The branch badge in AgentList depends on the API surfacing a non-null
  // `agent.branch`. The existing TASK-063 test proves the NULL passthrough;
  // this proves the non-null path — mapAgent must translate the snake_case
  // `branch`/`worktree_path` columns into camelCase `branch`/`worktreePath`.
  const db = openDb(':memory:');
  try {
    const agent = createAgent(db, { name: 'uat062-branch', workdir: '/tmp/uat062-nonexistent-nogit-dir', launchCmd: 'claude' });
    // createAgent on a non-git workdir leaves both columns NULL; set them
    // directly to exercise the non-null serialization path.
    db.prepare(`UPDATE agents SET branch = ?, worktree_path = ? WHERE id = ?`)
      .run(`conductor/${String(agent.id)}`, `/repo/worktrees/${String(agent.id)}`, agent.id);

    const listed = listAgents(db).find((a) => a.id === agent.id);
    assert.ok(listed, 'agent should be present in listAgents output');
    assert.equal(listed.branch, `conductor/${String(agent.id)}`, 'listAgents should surface the branch column as camelCase `branch`');
    assert.equal(listed.worktreePath, `/repo/worktrees/${String(agent.id)}`, 'listAgents should surface worktree_path as camelCase `worktreePath`');
    assert.ok(!('worktree_path' in (listed as object)), 'raw snake_case worktree_path must not leak into the mapped agent object');
    assert.ok('branch' in (listed as object), 'branch key must be present on the mapped agent object');
  } finally {
    db.close();
  }
});


void test('TASK-076: listAgentUsage returns [] for a usage-less agent and full camelCase rows ordered by session_start DESC', () => {
  // Backs GET /agents/:id/usage (TASK-076): the route returns
  // `{ agent, sessions: listAgentUsage(db, agentId) }` untransformed, so the
  // empty-array guarantee, the DESC ordering, and the camelCase field shape
  // it relies on are pinned here rather than only through the live endpoint.
  const db = openDb(':memory:');
  try {
    const agent = createAgent(db, { name: 'uat076-usage', workdir: '/tmp/uat076-nonexistent-nogit-dir', launchCmd: 'claude' });

    assert.deepEqual(listAgentUsage(db, agent.id), [], 'a fresh agent with no usage rows should return an empty array, not null/undefined');

    upsertAgentUsage(db, {
      agentId: agent.id, sessionStart: '2026-07-06T09:00:00Z',
      inputTokens: 1200, outputTokens: 3400, cacheCreationInputTokens: 500, cacheReadInputTokens: 250000, costUsd: 0.42,
    });
    upsertAgentUsage(db, {
      agentId: agent.id, sessionStart: '2026-07-06T10:00:00Z',
      inputTokens: 800, outputTokens: 1600, cacheCreationInputTokens: 100, cacheReadInputTokens: 90000, costUsd: 0.11,
    });

    const rows = listAgentUsage(db, agent.id);
    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.sessionStart, '2026-07-06T10:00:00Z', 'listAgentUsage must order by session_start DESC — newest session first');
    assert.equal(rows[1]?.sessionStart, '2026-07-06T09:00:00Z');

    const newest = rows[0];
    assert.ok(newest);
    assert.equal(newest.agentId, agent.id);
    assert.equal(newest.inputTokens, 800);
    assert.equal(newest.outputTokens, 1600);
    assert.equal(newest.cacheCreationInputTokens, 100);
    assert.equal(newest.cacheReadInputTokens, 90000);
    assert.equal(newest.costUsd, 0.11);
    assert.equal(typeof newest.id, 'number');
    assert.equal(typeof newest.updatedAt, 'string');
    assert.ok(!('session_start' in (newest as object)), 'raw snake_case session_start must not leak into the mapped usage row');
    assert.ok(!('cache_read_input_tokens' in (newest as object)), 'raw snake_case cache_read_input_tokens must not leak into the mapped usage row');
  } finally {
    db.close();
  }
});


void test('TASK-111: fresh DB ends at schema_version 7 after migration', () => {
  const db = openDb(':memory:');
  try {
    // TASK-125 added schema_version 8, landing after this test was written.
    // A fresh DB now migrates all the way to the current max version, not
    // frozen at 7 — assert "at least 7" (the version this test's own feature
    // landed at), per this file's own assertSchemaVersionAtLeast helper and
    // its documented rationale, rather than an exact number that every later
    // sibling migration would otherwise break.
    assertSchemaVersionAtLeast(db, 7);
  } finally {
    db.close();
  }
});

void test('TASK-111: agents.role accepts all 7 valid role values', () => {
  const db = openDb(':memory:');
  try {
    const roles = ['generic', 'frontend', 'backend', 'qa', 'devops', 'security', 'architect'];
    for (const role of roles) {
      const agent = createAgent(db, {
        name: `task111-${role}`,
        workdir: `/tmp/task111-nonexistent-nogit-dir-${role}`,
        launchCmd: 'claude',
        role,
      });
      assert.equal(agent.role, role);
    }
  } finally {
    db.close();
  }
});

void test('TASK-111: agents.role CHECK constraint rejects an invalid role value', () => {
  const db = openDb(':memory:');
  try {
    assert.throws(() => {
      createAgent(db, {
        name: 'task111-invalid-role',
        workdir: '/tmp/task111-nonexistent-nogit-dir-invalid',
        launchCmd: 'claude',
        role: 'manager',
      });
    }, /CHECK constraint failed/);
  } finally {
    db.close();
  }
});

void test('TASK-111: agents.role defaults to \'generic\' when not provided', () => {
  const db = openDb(':memory:');
  try {
    const agent = createAgent(db, {
      name: 'task111-default-role',
      workdir: '/tmp/task111-nonexistent-nogit-dir-default',
      launchCmd: 'claude',
    });
    assert.equal(agent.role, 'generic');
  } finally {
    db.close();
  }
});

void test('TASK-111: an existing pre-v7 agent row backfills role to \'generic\' on migration', () => {
  const dbPath = tmpDbPath('prev7-role');
  try {
    // Simulate an already-populated pre-v7 database (schema_version = 6) whose
    // agents table predates the role column entirely — the real shape a v6 DB
    // has (worktree_path/branch already present via the v3 migration, no role).
    const legacy = new Database(dbPath);
    legacy.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      -- projects exists in every real v6 DB (created by the v1 migration);
      -- TASK-156's v9 migration adds bg_processes.project_id as an FK to this
      -- table, and openDb -> seedFromLegacy's writes to bg_processes require
      -- the FK target to exist once foreign_keys=ON — so a faithful pre-v7
      -- fixture must include it.
      CREATE TABLE projects (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE CHECK (name GLOB '[A-Za-z0-9_-]*'),
        workdir TEXT NOT NULL,
        default_launch_cmd TEXT NOT NULL DEFAULT 'claude --dangerously-skip-permissions',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      );
      CREATE TABLE agents (
        id INTEGER PRIMARY KEY,
        name TEXT,
        workdir TEXT,
        launch_cmd TEXT,
        project_id INTEGER,
        created_at TEXT,
        worktree_path TEXT,
        branch TEXT
      );
      CREATE TABLE bg_processes (
        id INTEGER PRIMARY KEY,
        name TEXT,
        workdir TEXT,
        launch_cmd TEXT,
        linked_agent_id INTEGER
      );
      -- tasks exists in every real v6 DB too (created by the v1 migration) —
      -- TASK-125's v8 migration rebuilds this table, so a faithful pre-v7
      -- fixture must include it (empty is fine; this test is about the
      -- agents.role backfill, not tasks contents).
      CREATE TABLE tasks (
        id INTEGER PRIMARY KEY,
        command TEXT NOT NULL,
        agent_id INTEGER,
        project_id INTEGER,
        position REAL NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','backlog')),
        source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','schedule')),
        schedule_id INTEGER,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      );
    `);
    legacy
      .prepare(
        `INSERT INTO agents (name, workdir, launch_cmd, project_id, created_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .run('task111_prev7_probe', '/tmp/probe', 'claude', null, '2026-01-01T00:00:00Z');
    legacy.prepare(`INSERT OR REPLACE INTO meta VALUES ('schema_version', '6')`).run();
    legacy.close();

    const db = openDb(dbPath);
    try {
      const cols = tableColumns(db, 'agents');
      assert.ok(cols.some((c) => c.name === 'role'), 'role column should be added by the v7 migration');

      // The pre-existing row must survive the migration and backfill to 'generic'
      // via the ALTER TABLE ... DEFAULT clause, not via any application-level
      // fallback (this row was never touched by createAgent).
      const probe = db
        .prepare(`SELECT role FROM agents WHERE name='task111_prev7_probe'`)
        .all() as { role: string }[];
      assert.equal(probe.length, 1, 'pre-existing task111_prev7_probe row should still exist');
      const row = probe[0];
      assert.ok(row, 'probe row should be present');
      assert.equal(row.role, 'generic', 'pre-existing row should backfill role to generic');

      assertSchemaVersionAtLeast(db, 7);
    } finally {
      db.close();
    }
  } finally {
    cleanupDbFiles(dbPath);
  }
});


// TASK-125: v8 migration is a table-rebuild (SQLite cannot ALTER a CHECK
// constraint in place — status needed a third allowed value, 'done'). A
// rebuild that goes wrong doesn't fail loudly, it silently drops rows, so
// this is the load-bearing row-preservation proof: every column of every
// pre-existing row must be byte-identical before vs. after, not just "same
// count" or "migration didn't throw."
void test('TASK-125: v8 migration preserves every existing tasks row exactly and adds completed_at/done support', () => {
  const dbPath = tmpDbPath('v8-rowpreserve');
  try {
    // Simulate a real pre-v8 DB (schema_version=7): meta + a tasks table in
    // the pre-v8 shape (2-value status CHECK, no completed_at column).
    // legacy_import is pre-marked done so openDb()'s seedFromLegacy step
    // (which expects agents/bg_processes tables to exist) is a no-op here —
    // a real v7 DB has already been through that exactly once at v1.
    const legacy = new Database(dbPath);
    legacy.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      -- projects/agents exist in every real v7 DB; the v10 default-launch-cmd
      -- migration UPDATEs both, so a faithful fixture must include them
      -- (empty is fine; this test is about tasks).
      CREATE TABLE projects (
        id INTEGER PRIMARY KEY,
        name TEXT,
        workdir TEXT,
        default_launch_cmd TEXT NOT NULL DEFAULT 'claude --dangerously-skip-permissions'
      );
      -- agents.project_id exists in every real v7 DB; the v11/v12 linked_agent_id
      -- seed reads it, so the fixture must carry it too.
      CREATE TABLE agents (
        id INTEGER PRIMARY KEY,
        name TEXT,
        workdir TEXT,
        launch_cmd TEXT,
        project_id INTEGER
      );
      CREATE TABLE tasks (
        id INTEGER PRIMARY KEY,
        command TEXT NOT NULL,
        agent_id INTEGER,
        project_id INTEGER,
        position REAL NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','backlog')),
        source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','schedule')),
        schedule_id INTEGER,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
        CHECK (agent_id IS NULL OR project_id IS NULL)
      );
      CREATE INDEX idx_tasks_pick ON tasks(status, position);
      -- bg_processes exists in every real v7 DB (created by the v1
      -- migration); TASK-156's v9 migration ALTERs this table to add
      -- project_id, which requires the table to exist — a faithful pre-v8
      -- fixture must include it (empty is fine; this test is about tasks).
      CREATE TABLE bg_processes (
        id INTEGER PRIMARY KEY,
        name TEXT,
        workdir TEXT,
        launch_cmd TEXT,
        linked_agent_id INTEGER
      );
    `);
    legacy.prepare(`INSERT OR REPLACE INTO meta VALUES ('schema_version', '7')`).run();
    legacy.prepare(`INSERT OR REPLACE INTO meta VALUES ('legacy_import', '1')`).run();

    const insertTask = legacy.prepare(
      `INSERT INTO tasks (command, agent_id, project_id, position, status, source, schedule_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insertTask.run('echo task-125-a', null, null, 1.0, 'queued', 'manual', null, '2026-08-01T00:00:00Z');
    insertTask.run('echo task-125-b', null, null, 2.0, 'backlog', 'manual', null, '2026-08-01T01:00:00Z');
    insertTask.run('echo task-125-c', null, null, 3.0, 'queued', 'schedule', null, '2026-08-01T02:00:00Z');

    const before = legacy.prepare(`SELECT * FROM tasks ORDER BY id`).all() as Record<string, unknown>[];
    assert.equal(before.length, 3, 'fixture should have inserted exactly 3 rows before migration');
    legacy.close();

    // Run the REAL production migration path — not a hand-rolled copy of it.
    const db = openDb(dbPath);
    try {
      assertSchemaVersionAtLeast(db, 8);

      const after = db.prepare(`SELECT * FROM tasks ORDER BY id`).all() as Record<string, unknown>[];
      assert.equal(
        after.length,
        before.length,
        'row count must be identical before and after the v8 rebuild — the load-bearing check for silent row loss',
      );

      for (let i = 0; i < before.length; i++) {
        const b = before[i];
        const a = after[i];
        assert.ok(b);
        assert.ok(a);
        assert.equal(a['id'], b['id'], `row ${String(b['id'])}: id must be unchanged`);
        assert.equal(a['command'], b['command'], `row ${String(b['id'])}: command must be unchanged`);
        assert.equal(a['agent_id'], b['agent_id'], `row ${String(b['id'])}: agent_id must be unchanged`);
        assert.equal(a['project_id'], b['project_id'], `row ${String(b['id'])}: project_id must be unchanged`);
        assert.equal(a['position'], b['position'], `row ${String(b['id'])}: position must be unchanged`);
        assert.equal(a['status'], b['status'], `row ${String(b['id'])}: status must be unchanged (only popTask/pop_task_sql flip it, not the migration itself)`);
        assert.equal(a['source'], b['source'], `row ${String(b['id'])}: source must be unchanged`);
        assert.equal(a['schedule_id'], b['schedule_id'], `row ${String(b['id'])}: schedule_id must be unchanged`);
        assert.equal(a['created_at'], b['created_at'], `row ${String(b['id'])}: created_at must be unchanged`);
        assert.equal(a['completed_at'], null, `row ${String(b['id'])}: completed_at should be NULL for a pre-existing row the migration itself never touches`);
      }

      const cols = tableColumns(db, 'tasks');
      assert.ok(cols.some((c) => c.name === 'completed_at'), 'tasks.completed_at column should exist after migration');

      // The widened CHECK constraint actually accepts 'done' post-migration.
      const firstId = (before[0] as { id: number }).id;
      assert.doesNotThrow(() => {
        db.prepare(`UPDATE tasks SET status='done', completed_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?`).run(firstId);
      }, 'status=done must not violate the migrated CHECK constraint');
      const flipped = db.prepare(`SELECT status, completed_at FROM tasks WHERE id=?`).get(firstId) as { status: string; completed_at: string | null };
      assert.equal(flipped.status, 'done');
      assert.ok(flipped.completed_at, 'completed_at should be set after the flip');
    } finally {
      db.close();
    }
  } finally {
    cleanupDbFiles(dbPath);
  }
});

// TASK-125: popTask's own behavior post-migration — the popped row must
// survive as status='done' with completed_at set, not disappear, and must
// never be picked again by a subsequent pop for the same agent.
void test('TASK-125: popTask flips a popped row to done/completed_at instead of deleting it, and never re-pops it', () => {
  const db = openDb(':memory:');
  try {
    const agent = createAgent(db, { name: 'uat125-popper', workdir: '/tmp/uat125-nonexistent', launchCmd: 'claude' });
    const task = addTask(db, { command: 'echo task-125-pop', agentId: agent.id });

    const before = db.prepare(`SELECT COUNT(*) as c FROM tasks`).get() as { c: number };
    assert.equal(before.c, 1, 'one task should exist before popping');

    const popped = popTask(db, agent.name);
    assert.ok(popped, 'popTask should return the popped task');
    assert.equal(popped.id, task.id);
    assert.equal(popped.command, 'echo task-125-pop');
    assert.equal(popped.kind, 'scoped');

    const afterCount = db.prepare(`SELECT COUNT(*) as c FROM tasks`).get() as { c: number };
    assert.equal(afterCount.c, 1, 'the row must still exist after popping — TASK-125 replaces DELETE with a soft flip');

    const row = db.prepare(`SELECT status, completed_at FROM tasks WHERE id=?`).get(task.id) as { status: string; completed_at: string | null };
    assert.equal(row.status, 'done', 'popped row status should be done, not deleted');
    assert.ok(row.completed_at, 'popped row should have completed_at set');

    const secondPop = popTask(db, agent.name);
    assert.equal(secondPop, null, 'a task already flipped to done must never be popped again (candidate subquery still filters on status=queued)');
  } finally {
    db.close();
  }
});

// TASK-0196 (schema v11): bg_processes drops the global UNIQUE(name) for a
// per-project (project_id, name) unique index, and project_id becomes
// NOT NULL ... ON DELETE CASCADE. The fixture below is a faithful post-v10 DB:
// the real v1 bg_processes shape (`name TEXT NOT NULL UNIQUE CHECK (GLOB)`) plus
// the v9 project_id column (ON DELETE SET NULL), with legacy_import='1' so
// openDb's seedFromLegacy is a no-op. Only used by the two v11 tests below.
function buildPreV11Fixture(
  dbPath: string,
  bgRows: Array<{ id: number; name: string; workdir: string; cmd: string; linkedAgentId: number | null; projectId: number | null }>,
): void {
  const legacy = new Database(dbPath);
  legacy.exec(`
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE CHECK (name GLOB '[A-Za-z0-9_-]*'),
      workdir TEXT NOT NULL,
      default_launch_cmd TEXT NOT NULL DEFAULT 'claude --dangerously-skip-permissions --append-system-prompt-file ~/.claude/rules/agent-teams-preference.md',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    );
    CREATE TABLE agents (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL CHECK (name GLOB '[A-Za-z0-9_-]*'),
      workdir TEXT NOT NULL,
      launch_cmd TEXT NOT NULL,
      project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      worktree_path TEXT,
      branch TEXT,
      role TEXT NOT NULL DEFAULT 'generic' CHECK (role IN ('generic','frontend','backend','qa','devops','security','architect'))
    );
    CREATE UNIQUE INDEX idx_agents_project_name ON agents(project_id, name) WHERE project_id IS NOT NULL;
    CREATE UNIQUE INDEX idx_agents_null_name ON agents(name) WHERE project_id IS NULL;
    CREATE TABLE bg_processes (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE CHECK (name GLOB '[A-Za-z0-9_-]*'),
      workdir TEXT NOT NULL,
      launch_cmd TEXT NOT NULL,
      linked_agent_id INTEGER REFERENCES agents(id) ON DELETE SET NULL,
      project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL
    );
    CREATE TABLE tasks (
      id INTEGER PRIMARY KEY,
      command TEXT NOT NULL,
      agent_id INTEGER REFERENCES agents(id) ON DELETE CASCADE,
      project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
      position REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','backlog','done')),
      source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','schedule')),
      schedule_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      completed_at TEXT,
      CHECK (agent_id IS NULL OR project_id IS NULL)
    );
  `);
  legacy.prepare(`INSERT INTO projects (id, name, workdir) VALUES (1, 'p_a', '/w/p_a')`).run();
  legacy.prepare(`INSERT INTO projects (id, name, workdir) VALUES (2, 'p_b', '/w/p_b')`).run();
  legacy.prepare(`INSERT INTO agents (id, name, workdir, launch_cmd) VALUES (7, 'agent7', '/w/p_a', 'claude')`).run();
  const ins = legacy.prepare(
    `INSERT INTO bg_processes (id, name, workdir, launch_cmd, linked_agent_id, project_id) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const r of bgRows) ins.run(r.id, r.name, r.workdir, r.cmd, r.linkedAgentId, r.projectId);
  legacy.prepare(`INSERT OR REPLACE INTO meta VALUES ('schema_version', '10')`).run();
  legacy.prepare(`INSERT OR REPLACE INTO meta VALUES ('legacy_import', '1')`).run();
  legacy.close();
}

function bgProjectIdNotNull(db: Database.Database): boolean {
  const cols = db.pragma('table_info(bg_processes)') as Array<{ name: string; notnull: number }>;
  return cols.find((c) => c.name === 'project_id')?.notnull === 1;
}

function bgHasLinkedAgentColumn(db: Database.Database): boolean {
  const cols = db.pragma('table_info(bg_processes)') as Array<{ name: string }>;
  return cols.some((c) => c.name === 'linked_agent_id');
}

// TASK-0198 (schema v12): the retired bg_processes.linked_agent_id column is dropped
// by a rebuild. The fixture is a faithful post-v11 DB in EITHER of the two shapes
// TASK-0196's rebuild can leave behind: project_id nullable + partial unique index
// idx_bg_processes_null_name, or project_id NOT NULL. Both keep the still-present
// linked_agent_id column (ON DELETE SET NULL) and idx_bg_processes_project_name.
function buildPreV12Fixture(
  dbPath: string,
  opts: { projectNotNull: boolean },
  bgRows: Array<{ id: number; name: string; workdir: string; cmd: string; linkedAgentId: number | null; projectId: number | null }>,
): void {
  const legacy = new Database(dbPath);
  legacy.exec(`
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE CHECK (name GLOB '[A-Za-z0-9_-]*'),
      workdir TEXT NOT NULL,
      default_launch_cmd TEXT NOT NULL DEFAULT 'claude --dangerously-skip-permissions --append-system-prompt-file ~/.claude/rules/agent-teams-preference.md',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    );
    CREATE TABLE agents (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL CHECK (name GLOB '[A-Za-z0-9_-]*'),
      workdir TEXT NOT NULL,
      launch_cmd TEXT NOT NULL,
      project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      worktree_path TEXT,
      branch TEXT,
      role TEXT NOT NULL DEFAULT 'generic' CHECK (role IN ('generic','frontend','backend','qa','devops','security','architect'))
    );
    CREATE UNIQUE INDEX idx_agents_project_name ON agents(project_id, name) WHERE project_id IS NOT NULL;
    CREATE UNIQUE INDEX idx_agents_null_name ON agents(name) WHERE project_id IS NULL;
    CREATE TABLE bg_processes (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL CHECK (name GLOB '[A-Za-z0-9_-]*'),
      workdir TEXT NOT NULL,
      launch_cmd TEXT NOT NULL,
      linked_agent_id INTEGER REFERENCES agents(id) ON DELETE SET NULL,
      project_id INTEGER ${opts.projectNotNull ? 'NOT NULL ' : ''}REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX idx_bg_processes_project_name ON bg_processes(project_id, name);
    ${opts.projectNotNull ? '' : 'CREATE UNIQUE INDEX idx_bg_processes_null_name ON bg_processes(name) WHERE project_id IS NULL;'}
    CREATE TABLE tasks (
      id INTEGER PRIMARY KEY,
      command TEXT NOT NULL,
      agent_id INTEGER REFERENCES agents(id) ON DELETE CASCADE,
      project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
      position REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','backlog','done')),
      source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','schedule')),
      schedule_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      completed_at TEXT,
      CHECK (agent_id IS NULL OR project_id IS NULL)
    );
  `);
  legacy.prepare(`INSERT INTO projects (id, name, workdir) VALUES (1, 'p_a', '/w/p_a')`).run();
  legacy.prepare(`INSERT INTO projects (id, name, workdir) VALUES (2, 'p_b', '/w/p_b')`).run();
  legacy.prepare(`INSERT INTO agents (id, name, workdir, launch_cmd, project_id) VALUES (7, 'agent7', '/w/p_a', 'claude', 1)`).run();
  legacy.prepare(`INSERT INTO agents (id, name, workdir, launch_cmd, project_id) VALUES (8, 'agent8', '/w/none', 'claude', NULL)`).run();
  const ins = legacy.prepare(
    `INSERT INTO bg_processes (id, name, workdir, launch_cmd, linked_agent_id, project_id) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const r of bgRows) ins.run(r.id, r.name, r.workdir, r.cmd, r.linkedAgentId, r.projectId);
  legacy.prepare(`INSERT OR REPLACE INTO meta VALUES ('schema_version', '11')`).run();
  legacy.prepare(`INSERT OR REPLACE INTO meta VALUES ('legacy_import', '1')`).run();
  legacy.close();
}

function bgIndexNames(db: Database.Database): string[] {
  return (db.pragma('index_list(bg_processes)') as Array<{ name: string }>)
    .map((i) => i.name)
    .filter((n) => !n.startsWith('sqlite_autoindex'))
    .sort();
}

void test('TASK-0198: v12 seeds project_id from the linked agent, drops linked_agent_id, and keeps the nullable-shape indexes', () => {
  const dbPath = tmpDbPath('v12-nullable');
  const origLog = console.log;
  const origWarn = console.warn;
  try {
    buildPreV12Fixture(dbPath, { projectNotNull: false }, [
      { id: 1, name: 'linked-seed', workdir: '/w/x1', cmd: 'a', linkedAgentId: 7, projectId: null }, // (a) seeded from agent 7 -> project 1
      { id: 2, name: 'linked-keep', workdir: '/w/x2', cmd: 'b', linkedAgentId: 7, projectId: 2 }, // (b) keeps project 2
      { id: 3, name: 'linked-noproj', workdir: '/w/nowhere', cmd: 'c', linkedAgentId: 8, projectId: null }, // (c) agent has no project -> stays NULL
      { id: 4, name: 'unlinked', workdir: '/w/x4', cmd: 'd', linkedAgentId: null, projectId: 1 }, // (d) untouched
    ]);
    console.log = () => { /* silence */ };
    console.warn = () => { /* silence */ };

    const db = openDb(dbPath);
    try {
      assertSchemaVersionAtLeast(db, 12);
      assert.ok(!bgHasLinkedAgentColumn(db), 'linked_agent_id must be gone');
      assert.deepEqual(
        db.prepare(`SELECT id, name, workdir, launch_cmd, project_id FROM bg_processes ORDER BY id`).all(),
        [
          { id: 1, name: 'linked-seed', workdir: '/w/x1', launch_cmd: 'a', project_id: 1 },
          { id: 2, name: 'linked-keep', workdir: '/w/x2', launch_cmd: 'b', project_id: 2 },
          { id: 3, name: 'linked-noproj', workdir: '/w/nowhere', launch_cmd: 'c', project_id: null },
          { id: 4, name: 'unlinked', workdir: '/w/x4', launch_cmd: 'd', project_id: 1 },
        ],
      );

      // Unmatched NULL row keeps project_id nullable, with both indexes recreated and the enforce step not rebuilding the column back.
      assert.ok(!bgProjectIdNotNull(db));
      assert.deepEqual(bgIndexNames(db), ['idx_bg_processes_null_name', 'idx_bg_processes_project_name']);
      assert.deepEqual(db.pragma('foreign_key_check'), []);

      const ins = db.prepare(`INSERT INTO bg_processes (name, workdir, launch_cmd, project_id) VALUES (?, ?, 'x', ?)`);
      assert.throws(() => ins.run('linked-seed', '/w/y', 1), /UNIQUE/, '(project_id, name) unique index survives');
      assert.throws(() => ins.run('linked-noproj', '/w/y', null), /UNIQUE/, 'NULL-project partial unique index survives');
      assert.throws(() => ins.run('!bad', '/w/y', 1), /CHECK/, 'name GLOB CHECK survives');

      // ON DELETE CASCADE from projects survives the rebuild.
      db.prepare(`DELETE FROM projects WHERE id=2`).run();
      assert.deepEqual(db.prepare(`SELECT id FROM bg_processes ORDER BY id`).all(), [{ id: 1 }, { id: 3 }, { id: 4 }]);
    } finally {
      db.close();
    }

    // Reopening is a no-op: the column does not come back.
    const again = openDb(dbPath);
    try {
      assert.ok(!bgHasLinkedAgentColumn(again));
      assert.equal((again.prepare(`SELECT COUNT(*) AS n FROM bg_processes`).get() as { n: number }).n, 3);
    } finally {
      again.close();
    }
  } finally {
    console.log = origLog;
    console.warn = origWarn;
    cleanupDbFiles(dbPath);
  }
});

void test('TASK-0198: v12 handles the NOT NULL project_id shape, preserving rows, the unique index and cascade', () => {
  const dbPath = tmpDbPath('v12-notnull');
  const origLog = console.log;
  const origWarn = console.warn;
  try {
    buildPreV12Fixture(dbPath, { projectNotNull: true }, [
      { id: 5, name: 'dev', workdir: '/w/p_a', cmd: 'npm run dev', linkedAgentId: 7, projectId: 1 },
      { id: 6, name: 'dev', workdir: '/w/p_b', cmd: 'npm run dev', linkedAgentId: null, projectId: 2 },
      { id: 9, name: 'stack', workdir: '/w/p_a', cmd: 'make up', linkedAgentId: 8, projectId: 1 },
    ]);
    console.log = () => { /* silence */ };
    console.warn = () => { /* silence */ };

    const db = openDb(dbPath);
    try {
      assertSchemaVersionAtLeast(db, 12);
      assert.ok(!bgHasLinkedAgentColumn(db));
      assert.ok(bgProjectIdNotNull(db), 'NOT NULL shape is preserved');
      assert.deepEqual(bgIndexNames(db), ['idx_bg_processes_project_name']);
      assert.deepEqual(
        db.prepare(`SELECT id, name, workdir, launch_cmd, project_id FROM bg_processes ORDER BY id`).all(),
        [
          { id: 5, name: 'dev', workdir: '/w/p_a', launch_cmd: 'npm run dev', project_id: 1 },
          { id: 6, name: 'dev', workdir: '/w/p_b', launch_cmd: 'npm run dev', project_id: 2 },
          { id: 9, name: 'stack', workdir: '/w/p_a', launch_cmd: 'make up', project_id: 1 },
        ],
      );
      const ins = db.prepare(`INSERT INTO bg_processes (name, workdir, launch_cmd, project_id) VALUES (?, ?, 'x', ?)`);
      assert.throws(() => ins.run('dev', '/w/y', 1), /UNIQUE/);
      assert.throws(() => ins.run('nameless', '/w/y', null), /NOT NULL/);
      db.prepare(`DELETE FROM projects WHERE id=1`).run();
      assert.deepEqual(db.prepare(`SELECT id FROM bg_processes ORDER BY id`).all(), [{ id: 6 }]);
    } finally {
      db.close();
    }
  } finally {
    console.log = origLog;
    console.warn = origWarn;
    cleanupDbFiles(dbPath);
  }
});

void test('TASK-0198: v12 promotes a nullable shape to NOT NULL when the linked-agent seed resolves every NULL project', () => {
  const dbPath = tmpDbPath('v12-seed-promote');
  const origLog = console.log;
  const origWarn = console.warn;
  try {
    buildPreV12Fixture(dbPath, { projectNotNull: false }, [
      { id: 1, name: 'only-linked', workdir: '/w/unmatched', cmd: 'a', linkedAgentId: 7, projectId: null },
      { id: 2, name: 'has-project', workdir: '/w/x', cmd: 'b', linkedAgentId: null, projectId: 2 },
    ]);
    console.log = () => { /* silence */ };
    console.warn = () => { /* silence */ };

    const db = openDb(dbPath);
    try {
      assertSchemaVersionAtLeast(db, 12);
      assert.ok(!bgHasLinkedAgentColumn(db));
      assert.ok(bgProjectIdNotNull(db), 'no NULL-project rows remain after the seed, so NOT NULL is enforced');
      assert.deepEqual(db.prepare(`SELECT id, project_id FROM bg_processes ORDER BY id`).all(), [
        { id: 1, project_id: 1 },
        { id: 2, project_id: 2 },
      ]);
      assert.deepEqual(bgIndexNames(db), ['idx_bg_processes_project_name']);
    } finally {
      db.close();
    }
  } finally {
    console.log = origLog;
    console.warn = origWarn;
    cleanupDbFiles(dbPath);
  }
});

void test('TASK-0198: a fresh database never creates linked_agent_id', () => {
  const dbPath = tmpDbPath('v12-fresh');
  const origLog = console.log;
  try {
    console.log = () => { /* silence */ };
    const db = openDb(dbPath);
    try {
      assertSchemaVersionAtLeast(db, 12);
      assert.ok(!bgHasLinkedAgentColumn(db));
      assert.ok(bgProjectIdNotNull(db));
    } finally {
      db.close();
    }
  } finally {
    console.log = origLog;
    cleanupDbFiles(dbPath);
  }
});

void test('TASK-0196: v11 rebuilds bg_processes with per-project uniqueness, NOT NULL project_id and cascade, preserving every row', () => {
  const dbPath = tmpDbPath('v11-rebuild');
  const origLog = console.log;
  const origWarn = console.warn;
  try {
    buildPreV11Fixture(dbPath, [
      { id: 5, name: 'dev', workdir: '/w/p_a', cmd: 'npm run dev', linkedAgentId: 7, projectId: 1 },
      { id: 9, name: 'web', workdir: '/w/p_b/', cmd: 'vite', linkedAgentId: null, projectId: null }, // NULL project, workdir matches p_b (trailing slash)
      { id: 12, name: 'dev-stack', workdir: '/w/p_a', cmd: 'make up', linkedAgentId: null, projectId: 1 },
    ]);
    console.log = () => { /* silence backfill/enforce info logs */ };
    console.warn = () => { /* silence */ };

    const db = openDb(dbPath);
    try {
      assertSchemaVersionAtLeast(db, 11);
      assert.ok(bgProjectIdNotNull(db), 'after the workdir backfill every row has a project, so project_id must be NOT NULL');

      const rows = db.prepare(`SELECT id, name, workdir, launch_cmd, project_id FROM bg_processes ORDER BY id`).all();
      assert.deepEqual(rows, [
        { id: 5, name: 'dev', workdir: '/w/p_a', launch_cmd: 'npm run dev', project_id: 1 },
        { id: 9, name: 'web', workdir: '/w/p_b/', launch_cmd: 'vite', project_id: 2 },
        { id: 12, name: 'dev-stack', workdir: '/w/p_a', launch_cmd: 'make up', project_id: 1 },
      ]);

      const idx = (db.pragma('index_list(bg_processes)') as Array<{ name: string; unique: number; partial: number }>).filter((i) => !i.name.startsWith('sqlite_autoindex'));
      assert.deepEqual(idx.map((i) => i.name), ['idx_bg_processes_project_name'], 'only the per-project unique index remains (no global UNIQUE, no NULL-project partial index)');
      assert.equal(idx[0]?.unique, 1);
      assert.equal(
        (db.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='bg_processes_v11'`).get() as { n: number }).n,
        0,
        'temp rebuild table must not linger',
      );
      assert.deepEqual(db.pragma('foreign_key_check'), []);

      // Cross-project duplicate names are now accepted; a same-project duplicate is rejected.
      const ins = db.prepare(`INSERT INTO bg_processes (name, workdir, launch_cmd, project_id) VALUES (?, ?, 'x', ?)`);
      assert.doesNotThrow(() => ins.run('dev', '/w/p_b', 2), 'same name in a different project must be accepted');
      assert.throws(() => ins.run('dev', '/w/p_a-2', 1), /UNIQUE/, 'same (project, name) must be rejected');
      assert.throws(() => ins.run('nameless', '/w/p_a', null), /NOT NULL/, 'a project-less row must be rejected');
      assert.throws(() => ins.run('!bad', '/w/p_a', 1), /CHECK/, 'the GLOB name CHECK must survive the rebuild');

      // The retired linked_agent_id column is gone (TASK-0198, v12), so deleting an agent leaves bg rows untouched.
      assert.ok(!bgHasLinkedAgentColumn(db), 'linked_agent_id must not survive the rebuild');
      db.prepare(`DELETE FROM agents WHERE id=7`).run();
      assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM bg_processes WHERE id=5`).get() as { n: number }).n, 1);

      // Deleting a project cascades to its bg rows at the schema level.
      db.prepare(`DELETE FROM projects WHERE id=1`).run();
      assert.deepEqual(
        db.prepare(`SELECT id FROM bg_processes ORDER BY id`).all(),
        [{ id: 9 }, { id: 13 }],
        "project 1's bg rows (5, 12) are cascaded away; project 2's rows remain",
      );
    } finally {
      db.close();
    }

    // Reopening an already-v11 DB is a no-op.
    const again = openDb(dbPath);
    try {
      assertSchemaVersionAtLeast(again, 11);
      assert.ok(bgProjectIdNotNull(again));
      assert.equal((again.prepare(`SELECT COUNT(*) AS n FROM bg_processes`).get() as { n: number }).n, 2);
    } finally {
      again.close();
    }
  } finally {
    console.log = origLog;
    console.warn = origWarn;
    cleanupDbFiles(dbPath);
  }
});

void test('TASK-0196: v11 never fails startup on unmatched NULL-project rows; it keeps project_id nullable (partial unique index) and enforces NOT NULL on a later open once resolved', () => {
  const dbPath = tmpDbPath('v11-deferred');
  const warnings: string[] = [];
  const origLog = console.log;
  const origWarn = console.warn;
  try {
    buildPreV11Fixture(dbPath, [
      { id: 3, name: 'dev', workdir: '/w/p_a', cmd: 'npm run dev', linkedAgentId: 7, projectId: 1 },
      { id: 4, name: 'orphan', workdir: '/w/nowhere', cmd: 'sleep 1', linkedAgentId: null, projectId: null },
    ]);
    console.log = () => { /* silence */ };
    console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')); };

    const db = openDb(dbPath); // must not throw
    try {
      assertSchemaVersionAtLeast(db, 11);
      assert.ok(!bgProjectIdNotNull(db), 'an unmatched row defers NOT NULL enforcement');
      assert.ok(warnings.some((w) => /orphan/.test(w)), 'the unmatched row is named in a warning');

      // The row survives with every column intact.
      assert.deepEqual(
        db.prepare(`SELECT id, name, workdir, launch_cmd, project_id FROM bg_processes ORDER BY id`).all(),
        [
          { id: 3, name: 'dev', workdir: '/w/p_a', launch_cmd: 'npm run dev', project_id: 1 },
          { id: 4, name: 'orphan', workdir: '/w/nowhere', launch_cmd: 'sleep 1', project_id: null },
        ],
      );

      // Per-project uniqueness still works, and NULL-project names stay unique via the partial index.
      const ins = db.prepare(`INSERT INTO bg_processes (name, workdir, launch_cmd, project_id) VALUES (?, ?, 'x', ?)`);
      assert.doesNotThrow(() => ins.run('dev', '/w/p_b', 2));
      assert.throws(() => ins.run('dev', '/w/p_a-2', 1), /UNIQUE/);
      assert.throws(() => ins.run('orphan', '/w/other', null), /UNIQUE/, 'partial index keeps NULL-project names unique');

      // The operator assigns the orphan to a project.
      db.prepare(`UPDATE bg_processes SET project_id=2 WHERE id=4`).run();
    } finally {
      db.close();
    }

    // Next open: enforceBgProjectRequired promotes the column; schema_version is unchanged.
    const db2 = openDb(dbPath);
    try {
      assert.ok(bgProjectIdNotNull(db2), 'NOT NULL is enforced once no NULL-project rows remain');
      assert.deepEqual(
        db2.prepare(`SELECT id, project_id FROM bg_processes ORDER BY id`).all(),
        [{ id: 3, project_id: 1 }, { id: 4, project_id: 2 }, { id: 5, project_id: 2 }],
      );
      const idx = (db2.pragma('index_list(bg_processes)') as Array<{ name: string }>).map((i) => i.name).filter((n) => !n.startsWith('sqlite_autoindex'));
      assert.deepEqual(idx, ['idx_bg_processes_project_name'], 'the NULL-project partial index is dropped with the rebuild');
    } finally {
      db2.close();
    }
  } finally {
    console.log = origLog;
    console.warn = origWarn;
    cleanupDbFiles(dbPath);
  }
});
