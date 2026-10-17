import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import {
  openDb,
  deleteProject,
  backfillBgProcessProjects,
  createAgent,
  createProject,
  addTask,
  listCompletedTasks,
  deriveCloneName,
  createBgProcess,
  bgSlug,
  bgSlugCollides,
  agentWindowName,
  getBgBySlug,
  listBgSlugs,
  listBgProcesses,
  listAgents,
  listProjects,
  deleteBgProcess,
  updateBgProcess,
  updateAgentName,
  updateAgentRole,
  deleteAgent,
  moveTaskToProject,
  listTasksForAgentId,
  popTask,
} from './db.ts';
import type Database from 'better-sqlite3';

// TASK-0196: a fresh DB now has bg_processes.project_id NOT NULL. Tests that
// need a legacy NULL-project row swap in the exact "deferred" shape schema v11
// leaves behind when unmatched legacy rows exist (nullable project_id + the
// partial unique index that keeps NULL-project names unique).
function makeBgProjectNullable(db: Database.Database): void {
  db.pragma('foreign_keys = OFF');
  db.exec(`
    DROP TABLE bg_processes;
    CREATE TABLE bg_processes (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL CHECK (name GLOB '[A-Za-z0-9_-]*'),
      workdir TEXT NOT NULL,
      launch_cmd TEXT NOT NULL,
      project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX idx_bg_processes_project_name ON bg_processes(project_id, name);
    CREATE UNIQUE INDEX idx_bg_processes_null_name ON bg_processes(name) WHERE project_id IS NULL;
  `);
  db.pragma('foreign_keys = ON');
}

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
void test('TASK-159: createBgProcess, listBgProcesses, deleteBgProcess provide full CRUD for bg processes (TASK-0197: no link is read or written)', () => {
  const db = openDb(':memory:');
  try {
    // (a) listBgProcesses returns empty list initially.
    assert.deepEqual(listBgProcesses(db), []);
    // TASK-0195: every bg process requires a project.
    const proj = createProject(db, { name: 'bg-crud-project', workdir: '/tmp/bg-crud-project' });

    // (b) createBgProcess returns a row with no link field, and the column
    // itself no longer exists (dropped in schema v12, TASK-0198).
    const bg1 = createBgProcess(db, { name: 'bg-test-1', workdir: '/tmp/bg1', launchCmd: 'npm run dev', projectId: proj.id });
    assert.equal(bg1.name, 'bg-test-1');
    assert.equal(bg1.workdir, '/tmp/bg1');
    assert.equal(bg1.launchCmd, 'npm run dev');
    assert.ok(!('linkedAgentId' in bg1), 'BgProcess must not expose linkedAgentId');
    const hasLinkColumn = () => (db.pragma('table_info(bg_processes)') as Array<{ name: string }>).some((c) => c.name === 'linked_agent_id');
    assert.equal(hasLinkColumn(), false);

    // (c) listBgProcesses returns the created row ordered by name.
    const list1 = listBgProcesses(db);
    assert.equal(list1.length, 1);
    assert.deepEqual(list1[0], bg1);

    // (d) A second create in the same project works and still has no link column.
    const bg2 = createBgProcess(db, { name: 'bg-test-2', workdir: '/tmp/bg2', launchCmd: 'npm run server', projectId: proj.id });
    assert.equal(bg2.name, 'bg-test-2');
    assert.equal(hasLinkColumn(), false);

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

    // (g) Deleting an agent never touches bg_process rows: project_id is the
    // sole ownership boundary.
    const agent = createAgent(db, { name: 'test-agent', workdir: '/tmp/agent', launchCmd: 'claude' });
    deleteAgent(db, agent.id);
    const list4 = listBgProcesses(db);
    assert.equal(list4.length, 1);
    assert.ok(list4[0] !== undefined);
    assert.equal(list4[0].id, bg2.id);
  } finally {
    db.close();
  }
});


// TASK-156: bg_processes gained a project_id scoping column (schema_version 9).
// These tests cover the createBgProcess/listBgProcesses project-scoping surface;
// the CRUD/linked-agent behavior above is TASK-159's and is left untouched.
void test('TASK-156: createBgProcess persists and round-trips projectId via mapBgProcess', () => {
  const db = openDb(':memory:');
  makeBgProjectNullable(db);
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

    // A legacy row with a NULL project_id (pre-TASK-0195, inserted via raw SQL
    // since createBgProcess now requires a project) still maps to a null projectId.
    db.prepare(`INSERT INTO bg_processes (name, workdir, launch_cmd) VALUES (?, ?, ?)`).run('task156-bg-unscoped', '/tmp/task156-bg-2', 'npm run dev');
    const unscoped = listBgProcesses(db).find((b) => b.name === 'task156-bg-unscoped');
    assert.ok(unscoped);
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
    const projectC = createProject(db, { name: 'task156-project-c', workdir: '/tmp/task156-c' });
    const bgNone = createBgProcess(db, { name: 'task156-bg-none', workdir: '/tmp/task156-bg-none', launchCmd: 'npm run dev', projectId: projectC.id });

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
  makeBgProjectNullable(db);
  try {
    const project = createProject(db, { name: 'task161-project', workdir: '/tmp/task161-project' });
    const scoped = createBgProcess(db, { name: 'task161-bg-scoped', workdir: '/tmp/task161-bg', launchCmd: 'npm run dev', projectId: project.id });
    // Legacy NULL-project row (raw SQL: createBgProcess now requires a project).
    db.prepare(`INSERT INTO bg_processes (name, workdir, launch_cmd) VALUES (?, ?, ?)`).run('task161-bg-unscoped', '/tmp/task161-bg-2', 'npm run dev');
    const unscoped = { name: 'task161-bg-unscoped' };

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

// TASK-161-uat-fix: updateBgProcess is the new (previously nonexistent) Update
// leg of bg-process CRUD, scoped to exactly workdir/launchCmd/projectId — name
// stays immutable (it's the tmux window key and the route param for
// delete/window actions) and is never accepted by this function's `data`.
void test('TASK-161-uat-fix: updateBgProcess applies a partial update (workdir/launchCmd/projectId) and leaves the name untouched', () => {
  const db = openDb(':memory:');
  try {
    const project = createProject(db, { name: 'uatfix-project', workdir: '/tmp/uatfix-project' });
    const project0 = createProject(db, { name: 'uatfix-project-0', workdir: '/tmp/uatfix-project-0' });
    const bg = createBgProcess(db, { name: 'uatfix-bg', workdir: '/tmp/before', launchCmd: 'npm run before', projectId: project0.id });
    assert.equal(bg.projectId, project0.id);

    // (a) Updating only workdir leaves launchCmd/projectId/name alone.
    const afterWorkdir = updateBgProcess(db, bg.id, { workdir: '/tmp/after' });
    assert.equal(afterWorkdir.name, 'uatfix-bg');
    assert.equal(afterWorkdir.workdir, '/tmp/after');
    assert.equal(afterWorkdir.launchCmd, 'npm run before');
    assert.equal(afterWorkdir.projectId, project0.id);

    // (b) Updating launchCmd + projectId together in one call.
    const afterBoth = updateBgProcess(db, bg.id, { launchCmd: 'npm run after', projectId: project.id });
    assert.equal(afterBoth.workdir, '/tmp/after');
    assert.equal(afterBoth.launchCmd, 'npm run after');
    assert.equal(afterBoth.projectId, project.id);

    // (c) TASK-0195: projectId can be moved to another project (but never
    // cleared: updateBgProcess's type no longer accepts null).
    const project2 = createProject(db, { name: 'uatfix-project-2', workdir: '/tmp/uatfix-project-2' });
    const afterMoved = updateBgProcess(db, bg.id, { projectId: project2.id });
    assert.equal(afterMoved.projectId, project2.id);
    updateBgProcess(db, bg.id, { projectId: project.id });

    // (d) An empty data object is a no-op read-back, not an error.
    const noop = updateBgProcess(db, bg.id, {});
    assert.equal(noop.workdir, '/tmp/after');
    assert.equal(noop.launchCmd, 'npm run after');

    // (e) Round-trips through a fresh listBgProcesses read too, not just the
    // UPDATE...RETURNING result.
    const reloaded = listBgProcesses(db).find((b) => b.id === bg.id);
    assert.ok(reloaded);
    assert.equal(reloaded.workdir, '/tmp/after');
    assert.equal(reloaded.launchCmd, 'npm run after');

    // (f) A nonexistent id throws rather than silently no-op-ing.
    assert.throws(() => { updateBgProcess(db, bg.id + 999, { workdir: '/tmp/nope' }); });
  } finally {
    db.close();
  }
});

// TASK-167: updateAgentRole is the DB-layer half of PATCH /agents/:id's role
// change (see host-server/index.ts's PATCH /agents/:id route, which validates
// the new role against ROLE_VALUES before calling this). index.ts is a
// top-level-await script that calls fastify.listen() unconditionally at
// import time (see host-server/sseRolePayloadParity.test.ts's own comment on
// this same constraint), so the route can't be exercised over real HTTP from
// this test process without colliding with a live dev-server instance —
// this covers the behavior that CAN be tested directly: the DB row actually
// changing. The route's own request-validation shape is pinned statically in
// rolePresets.test.ts instead.
void test('TASK-167: updateAgentRole updates only the role column, leaves name/workdir/launchCmd untouched, and a nonexistent id throws', () => {
  const db = openDb(':memory:');
  try {
    const agent = createAgent(db, { name: 'role-agent', workdir: '/tmp/role-agent', launchCmd: 'claude', role: 'qa' });
    assert.equal(agent.role, 'qa');

    const updated = updateAgentRole(db, agent.id, 'devops');
    assert.equal(updated.role, 'devops');
    assert.equal(updated.name, 'role-agent');
    assert.equal(updated.workdir, '/tmp/role-agent');
    assert.equal(updated.launchCmd, 'claude');

    // Round-trips through a fresh read too, not just the UPDATE...RETURNING result.
    const reloaded = listAgents(db).find((a) => a.id === agent.id);
    assert.ok(reloaded);
    assert.equal(reloaded.role, 'devops');

    assert.throws(() => { updateAgentRole(db, agent.id + 999, 'qa'); });
  } finally {
    db.close();
  }
});

// TASK-167: PATCH /agents/:id can update name and role together in one
// request — index.ts's rename block and role block are independent `if`s,
// not mutually exclusive (see the route: `if (newName !== undefined && ...)
// { ... }` followed by a separate `if (newRole !== undefined) { ... }`).
// updateAgentName and updateAgentRole are each standalone DB writes, so
// calling both against the same row is the direct DB-layer proxy for that
// combined-update behavior.
void test('TASK-167: updateAgentName and updateAgentRole can both apply to the same agent row (PATCH /agents/:id name+role combined update)', () => {
  const db = openDb(':memory:');
  try {
    const agent = createAgent(db, { name: 'combo-agent', workdir: '/tmp/combo-agent', launchCmd: 'claude' });
    assert.equal(agent.role, 'generic');

    const renamed = updateAgentName(db, agent.id, 'combo-agent-renamed');
    const reRoled = updateAgentRole(db, agent.id, 'security');

    assert.equal(renamed.name, 'combo-agent-renamed');
    assert.equal(reRoled.id, agent.id);
    assert.equal(reRoled.name, 'combo-agent-renamed');
    assert.equal(reRoled.role, 'security');
  } finally {
    db.close();
  }
});

// TASK-0180: moveTaskToProject rewrites an agent-scoped queued task to
// project_id = agent.project_id, agent_id = NULL in one UPDATE, so the
// tasks.CHECK(agent_id IS NULL OR project_id IS NULL) constraint is never
// violated mid-way, and other agents in the same project can then pop it.
void test('TASK-0180: moveTaskToProject rescopes an agent-scoped queued task to its agent\'s project, and the row is then poppable by a sibling agent', () => {
  const db = openDb(':memory:');
  try {
    const project = createProject(db, { name: 'uat0180-project', workdir: '/tmp/uat0180-project' });
    const agentA = createAgent(db, { name: 'uat0180-agent-a', workdir: '/tmp/uat0180-agent-a', launchCmd: 'claude', projectId: project.id });
    const agentB = createAgent(db, { name: 'uat0180-agent-b', workdir: '/tmp/uat0180-agent-b', launchCmd: 'claude', projectId: project.id });

    const task = addTask(db, { command: 'echo scoped', agentId: agentA.id });

    const result = moveTaskToProject(db, task.id);
    assert.equal(result.ok, true);
    assert.equal(result.task.id, task.id);
    assert.equal(result.task.projectId, project.id);
    assert.equal(result.task.agentId, null);
    assert.equal(result.task.position, task.position);

    const forAgentB = listTasksForAgentId(db, agentB.id, project.id);
    assert.ok(forAgentB.some(t => t.id === task.id), 'agent B (sibling in the same project) should now see the rescoped task');

    const popped = popTask(db, agentB.name);
    assert.ok(popped);
    assert.equal(popped.id, task.id);
    assert.equal(popped.kind, 'project');
  } finally {
    db.close();
  }
});

void test('TASK-0180: moveTaskToProject returns agent-has-no-project and leaves the row unchanged when the task\'s agent has no project', () => {
  const db = openDb(':memory:');
  try {
    const agent = createAgent(db, { name: 'uat0180-agent-no-project', workdir: '/tmp/uat0180-agent-no-project', launchCmd: 'claude' });
    const task = addTask(db, { command: 'echo unscoped-agent', agentId: agent.id });

    const result = moveTaskToProject(db, task.id);
    assert.deepEqual(result, { ok: false, reason: 'agent-has-no-project' });

    const reloaded = listTasksForAgentId(db, agent.id, null).find(t => t.id === task.id);
    assert.ok(reloaded);
    assert.equal(reloaded.agentId, agent.id);
    assert.equal(reloaded.projectId, null);
  } finally {
    db.close();
  }
});

void test('TASK-0180: moveTaskToProject returns not-agent-scoped for a task already scoped to a project', () => {
  const db = openDb(':memory:');
  try {
    const project = createProject(db, { name: 'uat0180-already-project', workdir: '/tmp/uat0180-already-project' });
    const task = addTask(db, { command: 'echo already-project', projectId: project.id });

    const result = moveTaskToProject(db, task.id);
    assert.deepEqual(result, { ok: false, reason: 'not-agent-scoped' });
  } finally {
    db.close();
  }
});

void test('TASK-0180: moveTaskToProject returns not-queued for a task that is already done', () => {
  const db = openDb(':memory:');
  try {
    const project = createProject(db, { name: 'uat0180-done-project', workdir: '/tmp/uat0180-done-project' });
    const agent = createAgent(db, { name: 'uat0180-done-agent', workdir: '/tmp/uat0180-done-agent', launchCmd: 'claude', projectId: project.id });
    const task = addTask(db, { command: 'echo done-task', agentId: agent.id });
    db.prepare(`UPDATE tasks SET status='done' WHERE id=?`).run(task.id);

    const result = moveTaskToProject(db, task.id);
    assert.deepEqual(result, { ok: false, reason: 'not-queued' });
  } finally {
    db.close();
  }
});

void test('TASK-0180: moveTaskToProject returns not-found for an unknown task id', () => {
  const db = openDb(':memory:');
  try {
    const result = moveTaskToProject(db, 999999);
    assert.deepEqual(result, { ok: false, reason: 'not-found' });
  } finally {
    db.close();
  }
});


// TASK-0195: deleteProject cascades to the project's bg processes. The tmux
// window teardown happens in the DELETE /projects/:id route (index.ts is a
// top-level-await script that binds a port at import, so the route cannot be
// exercised here); this covers the DB half — rows removed atomically, the
// removed rows returned for the route to tear down, other projects untouched.
void test('TASK-0195: deleteProject removes the project\'s bg processes, returns them, and leaves other projects\' bg processes alone', () => {
  const db = openDb(':memory:');
  try {
    const doomed = createProject(db, { name: 'task195-doomed', workdir: '/tmp/task195-doomed' });
    const keeper = createProject(db, { name: 'task195-keeper', workdir: '/tmp/task195-keeper' });
    createBgProcess(db, { name: 'task195-web', workdir: '/tmp/task195-doomed', launchCmd: 'npm run dev', projectId: doomed.id });
    createBgProcess(db, { name: 'task195-api', workdir: '/tmp/task195-doomed', launchCmd: 'npm run api', projectId: doomed.id });
    const kept = createBgProcess(db, { name: 'task195-kept', workdir: '/tmp/task195-keeper', launchCmd: 'npm run dev', projectId: keeper.id });

    const removed = deleteProject(db, doomed.id);
    assert.deepEqual(removed.map((b) => b.name), ['task195-api', 'task195-web']);
    assert.equal(listProjects(db).some((p) => p.id === doomed.id), false);
    assert.deepEqual(listBgProcesses(db).map((b) => b.id), [kept.id]);
    assert.equal(listBgProcesses(db)[0]?.projectId, keeper.id);
  } finally {
    db.close();
  }
});

void test('TASK-0195: deleteProject on a project with no bg processes succeeds and returns []', () => {
  const db = openDb(':memory:');
  try {
    const project = createProject(db, { name: 'task195-empty', workdir: '/tmp/task195-empty' });
    assert.deepEqual(deleteProject(db, project.id), []);
    assert.equal(listProjects(db).some((p) => p.id === project.id), false);
  } finally {
    db.close();
  }
});

void test('TASK-0195: a non-forced deleteProject blocked by agents throws before touching the project\'s bg processes', () => {
  const db = openDb(':memory:');
  try {
    const project = createProject(db, { name: 'task195-blocked', workdir: '/tmp/task195-blocked' });
    createAgent(db, { name: 'task195-agent', workdir: '/tmp/task195-blocked', launchCmd: 'claude', projectId: project.id });
    createBgProcess(db, { name: 'task195-blocked-bg', workdir: '/tmp/task195-blocked', launchCmd: 'npm run dev', projectId: project.id });

    assert.throws(() => { deleteProject(db, project.id); }, /agent\(s\)/);
    assert.equal(listBgProcesses(db, { projectId: project.id }).length, 1, 'bg rows must survive a rejected delete');

    // force=true proceeds and still cascades to the bg processes.
    const removed = deleteProject(db, project.id, true);
    assert.deepEqual(removed.map((b) => b.name), ['task195-blocked-bg']);
    assert.deepEqual(listBgProcesses(db), []);
  } finally {
    db.close();
  }
});

void test('TASK-0195: backfillBgProcessProjects assigns by workdir, leaves unmatched/ambiguous rows NULL, is idempotent and never touches scoped rows', () => {
  const db = openDb(':memory:');
  makeBgProjectNullable(db);
  const warnings: string[] = [];
  const origWarn = console.warn;
  const origLog = console.log;
  console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')); };
  console.log = () => { /* silence backfill info log */ };
  try {
    const p1 = createProject(db, { name: 'task195-bf-1', workdir: '/tmp/task195-bf-1' });
    const scopedOwner = createProject(db, { name: 'task195-bf-2', workdir: '/tmp/task195-bf-2' });
    createProject(db, { name: 'task195-bf-dup-a', workdir: '/tmp/task195-bf-dup' });
    createProject(db, { name: 'task195-bf-dup-b', workdir: '/tmp/task195-bf-dup/' });
    const ins = db.prepare(`INSERT INTO bg_processes (name, workdir, launch_cmd, project_id) VALUES (?, ?, 'x', ?)`);
    ins.run('bf-match', '/tmp/task195-bf-1/', null); // trailing slash tolerated
    ins.run('bf-orphan', '/tmp/task195-nowhere', null);
    ins.run('bf-ambiguous', '/tmp/task195-bf-dup', null);
    ins.run('bf-scoped', '/tmp/task195-bf-1', scopedOwner.id); // already scoped elsewhere; workdir would match p1

    const first = backfillBgProcessProjects(db);
    assert.deepEqual(first.matched, ['bf-match']);
    assert.deepEqual(first.unmatched, ['bf-ambiguous', 'bf-orphan']);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0] ?? '', /bf-ambiguous, bf-orphan/);

    const byName = new Map(listBgProcesses(db).map((b) => [b.name, b.projectId]));
    assert.equal(byName.get('bf-match'), p1.id);
    assert.equal(byName.get('bf-orphan'), null);
    assert.equal(byName.get('bf-ambiguous'), null);
    assert.equal(byName.get('bf-scoped'), scopedOwner.id, 'an already-scoped row must never be reassigned');

    // Idempotent: a second run matches nothing new and reports the same unmatched set.
    const second = backfillBgProcessProjects(db);
    assert.deepEqual(second.matched, []);
    assert.deepEqual(second.unmatched, ['bf-ambiguous', 'bf-orphan']);
  } finally {
    console.warn = origWarn;
    console.log = origLog;
    db.close();
  }
});

// TASK-0195: static pin of the route contract in index.ts (the routes cannot
// be exercised over HTTP from a unit test — see the deleteProject comment above).
void test('TASK-0195: index.ts requires projectId on POST /bg-processes, rejects null on PATCH, and cascades project delete', () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.join(dir, 'index.ts'), 'utf8');

  const postStart = src.indexOf(`'/bg-processes', async (req, reply)`);
  const patchStart = src.indexOf(`'/bg-processes/:slug', async (req, reply)`);
  const deleteProjectStart = src.indexOf(`api.delete<{ Params: { id: string }; Querystring: { force?: string } }>('/projects/:id'`);
  assert.ok(postStart > 0 && patchStart > postStart && deleteProjectStart > patchStart, 'route anchors not found');

  const postBody = src.slice(postStart, patchStart);
  assert.match(postBody, /projectId is required/);
  assert.match(postBody, /projectId must be an integer/);
  assert.match(postBody, /project \$\{String\(projectId\)\} not found/);
  assert.ok(postBody.indexOf('projectId is required') < postBody.indexOf('has-session'), 'projectId is validated before any tmux check');

  const patchBody = src.slice(patchStart, src.indexOf(`api.delete<{ Params: { slug: string } }>('/bg-processes/:slug'`, patchStart));
  assert.match(patchBody, /projectId cannot be null/);
  assert.match(patchBody, /project \$\{String\(projectId\)\} not found/);

  const projectDeleteBody = src.slice(deleteProjectStart, deleteProjectStart + 2500);
  assert.match(projectDeleteBody, /removedBgProcesses/);
  assert.match(projectDeleteBody, /kill-window/);
  assert.match(projectDeleteBody, /bg-\$\{slug\}\.state/);
});

// TASK-0196: static pin that every bg route resolves through getBgBySlug and that
// window/log/state names are the slug, never the bare name (the routes cannot be
// exercised over HTTP from a unit test — index.ts binds a port on import).
void test('TASK-0196: index.ts bg routes key by slug via getBgBySlug and never build bg-<name> paths', () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.join(dir, 'index.ts'), 'utf8');

  assert.doesNotMatch(src, /listBgProcesses\(db\)\.find\(/, 'no name-based bg lookups');
  assert.doesNotMatch(src, /bg-\$\{(?:bg\.)?name\}/, 'bg paths must use the slug');
  assert.doesNotMatch(src, /'\/bg-processes\/:name/, 'bg routes take :slug');
  for (const route of ['', '/window', '/tail']) {
    assert.ok(src.includes(`'/bg-processes/:slug${route}'`), `route /bg-processes/:slug${route} present`);
  }

  const postStart = src.indexOf(`'/bg-processes', async (req, reply)`);
  const patchStart = src.indexOf(`'/bg-processes/:slug', async (req, reply)`);
  const postBody = src.slice(postStart, patchStart);
  assert.match(postBody, /bgSlugCollides\(slug, listBgSlugs\(db\)/);
  assert.match(postBody, /listBgProcesses\(db, \{ projectId \}\)/);
  // TASK-0190: window creation delegates to the shared argv-based helper, keyed by the slug
  // (window name and bg-<slug>.log path are built in bgRestart.ts's buildBgSpawnArgs).
  assert.match(postBody, /startBgWindow\(defaultBgRestartDeps\(\), \{ slug, workdir, launchCmd \}/);

  const patchBody = src.slice(patchStart, src.indexOf(`api.delete<{ Params: { slug: string } }>('/bg-processes/:slug'`, patchStart));
  assert.match(patchBody, /cannot change project while window/);
  assert.match(patchBody, /status\(409\)/);
});

void test('TASK-0196: bgSlugCollides flags an equal bg slug or agent window name and nothing else', () => {
  assert.equal(bgSlugCollides('alpha-dev', ['alpha-dev', 'beta-dev'], []), true);
  assert.equal(bgSlugCollides('alpha-dev', ['beta-dev'], ['alpha-dev']), true, 'agent window name collides');
  assert.equal(bgSlugCollides('alpha-dev', ['beta-dev'], ['alpha-agent']), false);
  assert.equal(bgSlugCollides('alpha-dev', [], []), false);
  // prefix/suffix overlap is not equality
  assert.equal(bgSlugCollides('alpha-dev', ['alpha-dev-stack', 'x-alpha-dev'], ['alpha']), false);
  // accepts any iterable
  assert.equal(bgSlugCollides('a-b', new Set(['a-b']), new Set<string>()), true);
});

void test('TASK-0196: bgSlugCollides catches the hyphen ambiguity against real DB slugs and agent windows', () => {
  const db = openDb(':memory:');
  try {
    const dev = createProject(db, { name: 'task196c-dev', workdir: '/tmp/task196c-dev' });
    const other = createProject(db, { name: 'task196c', workdir: '/tmp/task196c' });
    createBgProcess(db, { name: 'stack', workdir: '/tmp/task196c-dev', launchCmd: 'x', projectId: dev.id });
    createAgent(db, { name: 'agent1', workdir: '/tmp/task196c', launchCmd: 'claude', projectId: other.id });

    const agentWindows = listAgents(db).map((a) => agentWindowName(a));
    assert.deepEqual(agentWindows, ['task196c-agent1']);

    // project `task196c` + name `dev-stack` would produce the slug of project `task196c-dev` + name `stack`.
    assert.equal(bgSlugCollides(bgSlug({ name: 'dev-stack' }, 'task196c'), listBgSlugs(db), agentWindows), true);
    // a bg process named `agent1` in project `task196c` would shadow the agent window.
    assert.equal(bgSlugCollides(bgSlug({ name: 'agent1' }, 'task196c'), listBgSlugs(db), agentWindows), true);
    assert.equal(bgSlugCollides(bgSlug({ name: 'web' }, 'task196c'), listBgSlugs(db), agentWindows), false);
  } finally {
    db.close();
  }
});

// TASK-0196: bg process identity is the derived slug `<projectName>-<name>`
// (bare `name` for a project-less legacy row), mirroring agentWindowName().
void test('TASK-0196: bgSlug prefixes the project name, falls back to the bare name, and tolerates hyphens on both sides', () => {
  assert.equal(bgSlug({ name: 'dev' }, 'alpha'), 'alpha-dev');
  assert.equal(bgSlug({ name: 'dev' }, null), 'dev');
  assert.equal(bgSlug({ name: 'dev' }, undefined), 'dev');
  assert.equal(bgSlug({ name: 'dev' }, ''), 'dev');
  assert.equal(bgSlug({ name: 'dev-stack' }, 'my-proj'), 'my-proj-dev-stack');
  // Documented ambiguity: distinct (project, name) pairs can share one slug.
  assert.equal(bgSlug({ name: 'stack' }, 'dev'), bgSlug({ name: 'dev-stack' }, null));
  assert.equal(bgSlug({ name: 'stack' }, 'dev'), 'dev-stack');
});

void test('TASK-0196: getBgBySlug/listBgSlugs resolve project-scoped rows, allow the same name in two projects, and reject a same-project duplicate', () => {
  const db = openDb(':memory:');
  try {
    const a = createProject(db, { name: 'task196-a', workdir: '/tmp/task196-a' });
    const b = createProject(db, { name: 'task196-b-hy', workdir: '/tmp/task196-b' });
    const devA = createBgProcess(db, { name: 'dev', workdir: '/tmp/task196-a', launchCmd: 'npm run dev', projectId: a.id });
    const devB = createBgProcess(db, { name: 'dev', workdir: '/tmp/task196-b', launchCmd: 'npm run dev', projectId: b.id });
    const hy = createBgProcess(db, { name: 'dev-stack', workdir: '/tmp/task196-b', launchCmd: 'make up', projectId: b.id });

    assert.throws(
      () => createBgProcess(db, { name: 'dev', workdir: '/tmp/task196-a2', launchCmd: 'x', projectId: a.id }),
      /UNIQUE/,
      'the same (project, name) must be rejected',
    );

    const gotA = getBgBySlug(db, 'task196-a-dev');
    assert.ok(gotA);
    assert.equal(gotA.id, devA.id);
    assert.equal(gotA.projectName, 'task196-a');
    assert.equal(gotA.projectId, a.id);
    assert.equal(gotA.launchCmd, 'npm run dev');

    const gotB = getBgBySlug(db, 'task196-b-hy-dev');
    assert.ok(gotB);
    assert.equal(gotB.id, devB.id);

    const gotHy = getBgBySlug(db, 'task196-b-hy-dev-stack');
    assert.ok(gotHy);
    assert.equal(gotHy.id, hy.id);
    assert.equal(gotHy.name, 'dev-stack');

    assert.equal(getBgBySlug(db, 'dev'), undefined, 'a bare name is not a slug once the row has a project');
    assert.equal(getBgBySlug(db, 'nope'), undefined);

    assert.deepEqual(listBgSlugs(db).sort(), ['task196-a-dev', 'task196-b-hy-dev', 'task196-b-hy-dev-stack']);
  } finally {
    db.close();
  }
});

void test('TASK-0196: getBgBySlug/listBgSlugs use the bare name for a project-less legacy row', () => {
  const db = openDb(':memory:');
  makeBgProjectNullable(db);
  try {
    const p = createProject(db, { name: 'task196-p', workdir: '/tmp/task196-p' });
    db.prepare(`INSERT INTO bg_processes (name, workdir, launch_cmd) VALUES ('legacy-bg', '/tmp/x', 'x')`).run();
    createBgProcess(db, { name: 'svc', workdir: '/tmp/task196-p', launchCmd: 'x', projectId: p.id });

    const legacy = getBgBySlug(db, 'legacy-bg');
    assert.ok(legacy);
    assert.equal(legacy.projectId, null);
    assert.equal(legacy.projectName, null);
    assert.deepEqual(listBgSlugs(db).sort(), ['legacy-bg', 'task196-p-svc']);

    // The deferred shape keeps NULL-project names unique despite SQLite's distinct-NULL index semantics.
    assert.throws(() => db.prepare(`INSERT INTO bg_processes (name, workdir, launch_cmd) VALUES ('legacy-bg', '/tmp/y', 'y')`).run(), /UNIQUE/);
  } finally {
    db.close();
  }
});

void test('TASK-0196: a fresh DB makes bg_processes.project_id NOT NULL and cascades project deletes at the schema level', () => {
  const db = openDb(':memory:');
  try {
    assert.throws(() => db.prepare(`INSERT INTO bg_processes (name, workdir, launch_cmd) VALUES ('orphan', '/tmp/o', 'x')`).run(), /NOT NULL/);
    const p = createProject(db, { name: 'task196-cascade', workdir: '/tmp/task196-cascade' });
    createBgProcess(db, { name: 'dev', workdir: '/tmp/task196-cascade', launchCmd: 'x', projectId: p.id });
    db.prepare(`DELETE FROM projects WHERE id=?`).run(p.id); // raw delete: relies on the FK cascade, not deleteProject()
    assert.equal(listBgProcesses(db).length, 0);
  } finally {
    db.close();
  }
});
