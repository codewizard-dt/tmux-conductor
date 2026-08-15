import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import {
  openDb,
  createAgent,
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
  assert.ok(actual >= min, `schema_version should be >= ${min}, got ${raw}`);
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

test('fresh DB has worktree_path and branch columns', () => {
  const db = openDb(':memory:');
  try {
    const cols = tableColumns(db, 'agents');
    const worktree = cols.find((c) => c.name === 'worktree_path');
    const branch = cols.find((c) => c.name === 'branch');
    assert.ok(worktree, 'agents.worktree_path column should exist');
    assert.equal(worktree?.type, 'TEXT');
    assert.ok(branch, 'agents.branch column should exist');
    assert.equal(branch?.type, 'TEXT');
  } finally {
    db.close();
  }
});

test('migration is idempotent on an already-migrated DB', () => {
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

test('existing pre-v3 DB gains columns and preserves rows', () => {
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

test('fresh DB has agent_usage table with expected columns', () => {
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

test('TASK-063: createAgent leaves worktreePath and branch null when workdir is not inside a git repository', () => {
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

test('upsertAgentUsage is idempotent on (agent_id, session_start)', () => {
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

test('usage totals aggregate across sessions and cascade on agent delete', () => {
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
    assert.equal(mine?.sessions, 2);

    deleteAgent(db, agent.id);
    assert.equal(listAgentUsage(db, agent.id).length, 0, 'usage rows should cascade on agent delete');
    assert.equal(getAgentUsageTotals(db, agent.id).sessions, 0);
  } finally {
    db.close();
  }
});

test('agent_usage table and schema_version persist across a real file-backed migration', () => {
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

test('agent_usage schema enforces UNIQUE(agent_id, session_start) independent of the upsert wrapper', () => {
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

test('getAgentUsageTotals and getAllAgentUsageTotals isolate totals per agent', () => {
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
    assert.equal(found1?.inputTokens, 110, 'getAllAgentUsageTotals should not mix agent 1 totals with agent 2');
    assert.equal(found2?.inputTokens, 1000, 'getAllAgentUsageTotals should not mix agent 2 totals with agent 1');
  } finally {
    db.close();
  }
});

test('fresh DB has agent_checkpoints table with expected columns and index', () => {
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

test('agent_checkpoints cascade-deletes when parent agent is deleted', () => {
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

test('insertCheckpoint/listCheckpoints/getCheckpoint round-trip and ordering', () => {
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
    assert.equal(fetched?.agentId, agent.id);
    assert.equal(fetched?.stashRef, 'stash@{0}');
    assert.equal(fetched?.ts, 1000);

    assert.equal(getCheckpoint(db, 999999), undefined, 'getCheckpoint should return undefined for an unknown id');
  } finally {
    db.close();
  }
});

test('fresh DB has agent_terminal_log table with expected columns and index', () => {
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

test('agent_terminal_log cascade-deletes when parent agent is deleted', () => {
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

test('appendTerminalLogChunk/listTerminalLog round-trip in chronological order without cross-agent contamination', () => {
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

test('appendTerminalLogChunk prunes oldest rows beyond maxRowsPerAgent, keeping the newest', () => {
  const db = openDb(':memory:');
  try {
    const agent = createAgent(db, { name: 'uat106-cap', workdir: '/tmp/uat106-cap', launchCmd: 'claude' });
    const cap = 3;
    for (const chunk of ['c0', 'c1', 'c2', 'c3', 'c4']) {
      appendTerminalLogChunk(db, agent.id, chunk, cap);
    }

    const list = listTerminalLog(db, agent.id);
    assert.equal(list.length, cap, `only the newest ${cap} rows should survive the cap`);
    assert.deepEqual(
      list.map((r) => r.chunk),
      ['c2', 'c3', 'c4'],
      'the oldest chunks (c0, c1) should be pruned, leaving the newest three in insertion order',
    );
  } finally {
    db.close();
  }
});


test('TASK-062: listAgents exposes non-null branch and worktreePath as camelCase fields', () => {
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
      .run(`conductor/${agent.id}`, `/repo/worktrees/${agent.id}`, agent.id);

    const listed = listAgents(db).find((a) => a.id === agent.id);
    assert.ok(listed, 'agent should be present in listAgents output');
    assert.equal(listed?.branch, `conductor/${agent.id}`, 'listAgents should surface the branch column as camelCase `branch`');
    assert.equal(listed?.worktreePath, `/repo/worktrees/${agent.id}`, 'listAgents should surface worktree_path as camelCase `worktreePath`');
    assert.ok(!('worktree_path' in (listed as object)), 'raw snake_case worktree_path must not leak into the mapped agent object');
    assert.ok(!('branch' in (listed as object)) === false, 'branch key must be present on the mapped agent object');
  } finally {
    db.close();
  }
});
