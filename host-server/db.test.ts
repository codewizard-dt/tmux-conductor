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
  listProjects,
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


// TASK-156: bg_processes gained a project_id scoping column (schema_version 9).
// These tests cover the createBgProcess/listBgProcesses project-scoping surface;
// the CRUD/linked-agent behavior above is TASK-159's and is left untouched.
void test('TASK-156: createBgProcess persists and round-trips projectId via mapBgProcess', () => {
  const db = openDb(':memory:');
  try {
    const project = createProject(db, { name: 'task156-project', workdir: '/tmp/task156-project' });

    const bg = createBgProcess(db, { name: 'task156-bg-scoped', workdir: '/tmp/task156-bg', launchCmd: 'npm run dev', projectId: project.id });
    assert.equal(bg.projectId, project.id);

    // Round-trip through a fresh read (mapBgProcess), not just the INSERT...RETURNING result.
    const reloaded = listBgProcesses(db, { projectId: project.id });
    assert.equal(reloaded.length, 1);
    assert.ok(reloaded[0]);
    assert.equal(reloaded[0].id, bg.id);
    assert.equal(reloaded[0].projectId, project.id);

    // Omitting projectId still yields a null projectId (existing behavior unaffected).
    const unscoped = createBgProcess(db, { name: 'task156-bg-unscoped', workdir: '/tmp/task156-bg-2', launchCmd: 'npm run dev' });
    assert.equal(unscoped.projectId, null);
  } finally {
    db.close();
  }
});

void test('TASK-156: listBgProcesses(db, { projectId }) isolates rows per project, and listBgProcesses(db) remains unfiltered', () => {
  const db = openDb(':memory:');
  try {
    const projectA = createProject(db, { name: 'task156-project-a', workdir: '/tmp/task156-a' });
    const projectB = createProject(db, { name: 'task156-project-b', workdir: '/tmp/task156-b' });

    const bgA = createBgProcess(db, { name: 'task156-bg-a', workdir: '/tmp/task156-bg-a', launchCmd: 'npm run dev', projectId: projectA.id });
    const bgB = createBgProcess(db, { name: 'task156-bg-b', workdir: '/tmp/task156-bg-b', launchCmd: 'npm run dev', projectId: projectB.id });
    const bgNone = createBgProcess(db, { name: 'task156-bg-none', workdir: '/tmp/task156-bg-none', launchCmd: 'npm run dev' });

    const listA = listBgProcesses(db, { projectId: projectA.id });
    assert.deepEqual(listA.map((b) => b.id), [bgA.id]);

    const listB = listBgProcesses(db, { projectId: projectB.id });
    assert.deepEqual(listB.map((b) => b.id), [bgB.id]);

    // No opts: every row, unfiltered — unchanged from today's behavior.
    const listAll = listBgProcesses(db);
    assert.deepEqual(
      listAll.map((b) => b.id).sort((x, y) => x - y),
      [bgA.id, bgB.id, bgNone.id].sort((x, y) => x - y),
    );
    assert.equal(listAll.length, 3);
  } finally {
    db.close();
  }
});


// TASK-161: host-server/index.ts's buildBgStatuses resolves each bg process's
// projectName by joining its projectId against listProjects(db) — the join
// GET /status's bgProcesses[] array depends on for projectId/projectName.
// buildBgStatuses itself can't be imported directly in a unit test: index.ts
// opens a real on-disk DB and calls fastify.listen() at module scope as a
// side effect of import (no index.test.ts exists for this reason), so this
// exercises the exact join it performs — mirroring
// `bg.projectId !== null ? (projects.find((p) => p.id === bg.projectId)?.name ?? null) : null`
// from host-server/index.ts's buildBgStatuses — at the db layer.
void test('TASK-161: a bg process with a project_id set resolves projectName via listProjects, matching buildBgStatuses\' join for GET /status', () => {
  const db = openDb(':memory:');
  try {
    const project = createProject(db, { name: 'task161-project', workdir: '/tmp/task161-project' });
    const scoped = createBgProcess(db, { name: 'task161-bg-scoped', workdir: '/tmp/task161-bg', launchCmd: 'npm run dev', projectId: project.id });
    const unscoped = createBgProcess(db, { name: 'task161-bg-unscoped', workdir: '/tmp/task161-bg-2', launchCmd: 'npm run dev' });

    const bgProcesses = listBgProcesses(db);
    const projects = listProjects(db);
    const statuses = bgProcesses.map((bg) => ({
      name: bg.name,
      projectId: bg.projectId,
      projectName: bg.projectId !== null ? (projects.find((p) => p.id === bg.projectId)?.name ?? null) : null,
    }));

    const scopedStatus = statuses.find((s) => s.name === scoped.name);
    assert.ok(scopedStatus);
    assert.equal(scopedStatus.projectId, project.id);
    assert.equal(scopedStatus.projectName, 'task161-project');

    const unscopedStatus = statuses.find((s) => s.name === unscoped.name);
    assert.ok(unscopedStatus);
    assert.equal(unscopedStatus.projectId, null);
    assert.equal(unscopedStatus.projectName, null);
  } finally {
    db.close();
  }
});
