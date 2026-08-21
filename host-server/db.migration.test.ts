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

      assert.throws(() => { addWorktreeToAgent(db, created.id); }, /already has a worktree/);
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
    assert.throws(() => { addWorktreeToAgent(db, nogit.id); }, /not inside a git repository/);
    assert.throws(() => { addWorktreeToAgent(db, 999999); }, /not found/);
  } finally {
    db.close();
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
      assert.equal(schemaVersion(db), '8', 'schema_version should be 8 after migration');

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
