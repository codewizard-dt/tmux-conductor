import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  openDb,
  createAgent,
  createProject,
  addTask,
  listCompletedTasks,
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
