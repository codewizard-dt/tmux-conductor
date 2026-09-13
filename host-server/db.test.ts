import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  openDb,
  createAgent,
  createProject,
  addTask,
  listCompletedTasks,
  deriveCloneName,
  createBgProcess,
  listBgProcesses,
  deleteBgProcess,
  deleteAgent,
} from './db.ts';
import type Database from 'better-sqlite3';

// TASK-126: listCompletedTasks is a pure read-side query over the tasks
// table's status='done' rows (the read companion to TASK-125's soft-delete
// pop). Rows are flipped to done directly via SQL here rather than through
// popTask, so completed_at can be pinned to deterministic values and
// ordering/filtering can be asserted independently of the write path
// (already covered by db.migration.test.ts's TASK-125 popTask tests).
function markDone(db: Database.Database, id: number, completedAt: string): void {
  db.prepare(`UPDATE tasks SET status='done', completed_at=? WHERE id=?`).run(completedAt, id);
}

void test('TASK-126: listCompletedTasks returns only status=done rows ordered by completed_at DESC, honoring agentId/projectId/limit filters', () => {
  const db = openDb(':memory:');
  try {
    // tasks.CHECK(agent_id IS NULL OR project_id IS NULL) — a task is scoped
    // to an agent XOR a project, never both — so agent- and project-scoped
    // fixtures must be disjoint rows below.
    const agentA = createAgent(db, { name: 'uat126-agent-a', workdir: '/tmp/uat126-nonexistent-a', launchCmd: 'claude' });
    const projectB = createProject(db, { name: 'uat126-project-b', workdir: '/tmp/uat126-proj-b' });

    const t1 = addTask(db, { command: 'echo t1', agentId: agentA.id });
    const t2 = addTask(db, { command: 'echo t2', agentId: agentA.id });
    const t3 = addTask(db, { command: 'echo t3', projectId: projectB.id });
    const stillQueued = addTask(db, { command: 'echo still-queued', agentId: agentA.id });

    markDone(db, t1.id, '2026-08-01T10:00:00.000Z');
    markDone(db, t2.id, '2026-08-03T10:00:00.000Z');
    markDone(db, t3.id, '2026-08-02T10:00:00.000Z');
    // stillQueued is left status='queued' — must never appear in history.

    // (a) Only status='done' rows come back, newest completed_at first.
    const all = listCompletedTasks(db);
    assert.deepEqual(all.map(t => t.id), [t2.id, t3.id, t1.id], 'expected DESC completed_at order, excluding the still-queued row');
    assert.ok(all.every(t => t.status === 'done'), 'every returned row must be status=done');
    assert.ok(!all.some(t => t.id === stillQueued.id), 'a queued task must never appear in completed history');

    // (b) agentId filter scopes to one agent.
    const byAgent = listCompletedTasks(db, { agentId: agentA.id });
    assert.deepEqual(byAgent.map(t => t.id), [t2.id, t1.id]);

    // (c) projectId filter scopes to one project.
    const byProject = listCompletedTasks(db, { projectId: projectB.id });
    assert.deepEqual(byProject.map(t => t.id), [t3.id]);

    // (d) limit caps the result count while preserving DESC order.
    const limited = listCompletedTasks(db, { limit: 2 });
    assert.deepEqual(limited.map(t => t.id), [t2.id, t3.id]);
  } finally {
    db.close();
  }
});

// TASK-148: deriveCloneName derives a collision-avoided "<name>-copy",
// "-copy-2", ... name for POST /agents/:id/clone, scoped by project_id the
// same way agent-name uniqueness itself is scoped (idx_agents_project_name /
// idx_agents_null_name).
void test('TASK-148: deriveCloneName picks "<name>-copy", falls back to "-copy-2"/"-copy-3" on collision, and scopes collisions by project_id', () => {
  const db = openDb(':memory:');
  try {
    // (a) No existing "<name>-copy" agent — base name is free.
    const globalAgent = createAgent(db, { name: 'uat148-agent', workdir: '/tmp/uat148-a', launchCmd: 'claude' });
    assert.equal(deriveCloneName(db, globalAgent), 'uat148-agent-copy');

    // (b) "<name>-copy" already exists (globally scoped, projectId null) — falls back to "-copy-2".
    createAgent(db, { name: 'uat148-agent-copy', workdir: '/tmp/uat148-a-copy', launchCmd: 'claude' });
    assert.equal(deriveCloneName(db, globalAgent), 'uat148-agent-copy-2');

    // (c) "<name>-copy-2" also taken — falls back to "-copy-3".
    createAgent(db, { name: 'uat148-agent-copy-2', workdir: '/tmp/uat148-a-copy-2', launchCmd: 'claude' });
    assert.equal(deriveCloneName(db, globalAgent), 'uat148-agent-copy-3');

    // (d) Project scoping: a same-named "<name>-copy" agent in a DIFFERENT
    // project must not count as a collision for a project-scoped source agent.
    const projectX = createProject(db, { name: 'uat148-project-x', workdir: '/tmp/uat148-proj-x' });
    const projectY = createProject(db, { name: 'uat148-project-y', workdir: '/tmp/uat148-proj-y' });
    const agentInX = createAgent(db, { name: 'uat148-scoped', workdir: '/tmp/uat148-x', launchCmd: 'claude', projectId: projectX.id });
    createAgent(db, { name: 'uat148-scoped-copy', workdir: '/tmp/uat148-y-copy', launchCmd: 'claude', projectId: projectY.id });
    assert.equal(deriveCloneName(db, agentInX), 'uat148-scoped-copy', 'a same-name collision in a different project must not affect this project-scoped agent');

    // (e) Project scoping: a same-named "<name>-copy" agent in the SAME
    // project DOES collide and forces "-copy-2".
    createAgent(db, { name: 'uat148-scoped-copy', workdir: '/tmp/uat148-x-copy', launchCmd: 'claude', projectId: projectX.id });
    assert.equal(deriveCloneName(db, agentInX), 'uat148-scoped-copy-2');
  } finally {
    db.close();
  }
});

// TASK-159: createBgProcess, listBgProcesses, and deleteBgProcess CRUD operations
// are now the sole source of truth for bg-process definitions (replacing conductor.conf).
void test('TASK-159: createBgProcess, listBgProcesses, deleteBgProcess provide full CRUD for bg processes with linked agent support', () => {
  const db = openDb(':memory:');
  try {
    // (a) listBgProcesses returns empty list initially.
    assert.deepEqual(listBgProcesses(db), []);

    // (b) createBgProcess without linkedAgentId returns a row with null linkedAgentId.
    const bg1 = createBgProcess(db, { name: 'bg-test-1', workdir: '/tmp/bg1', launchCmd: 'npm run dev' });
    assert.equal(bg1.name, 'bg-test-1');
    assert.equal(bg1.workdir, '/tmp/bg1');
    assert.equal(bg1.launchCmd, 'npm run dev');
    assert.equal(bg1.linkedAgentId, null);

    // (c) listBgProcesses returns the created row ordered by name.
    const list1 = listBgProcesses(db);
    assert.equal(list1.length, 1);
    assert.deepEqual(list1[0], bg1);

    // (d) createBgProcess with linkedAgentId set correctly.
    const agent = createAgent(db, { name: 'test-agent', workdir: '/tmp/agent', launchCmd: 'claude' });
    const bg2 = createBgProcess(db, { name: 'bg-test-2', workdir: '/tmp/bg2', launchCmd: 'npm run server', linkedAgentId: agent.id });
    assert.equal(bg2.name, 'bg-test-2');
    assert.equal(bg2.linkedAgentId, agent.id);

    // (e) listBgProcesses returns both rows ordered by name.
    const list2 = listBgProcesses(db);
    assert.equal(list2.length, 2);
    assert.deepEqual(list2.map(b => b.name), ['bg-test-1', 'bg-test-2']);

    // (f) deleteBgProcess removes a row by id.
    deleteBgProcess(db, bg1.id);
    const list3 = listBgProcesses(db);
    assert.equal(list3.length, 1);
    assert.ok(list3[0] !== undefined);
    assert.deepEqual(list3[0].name, 'bg-test-2');

    // (g) Foreign key cascade: when an agent is deleted, linked_agent_id goes to NULL
    // (ON DELETE SET NULL) but the bg_process row itself survives.
    deleteAgent(db, agent.id);
    const list4 = listBgProcesses(db);
    assert.equal(list4.length, 1);
    assert.ok(list4[0] !== undefined);
    assert.equal(list4[0].id, bg2.id);
    assert.equal(list4[0].linkedAgentId, null, 'linkedAgentId should be NULL after agent deletion');
  } finally {
    db.close();
  }
});
