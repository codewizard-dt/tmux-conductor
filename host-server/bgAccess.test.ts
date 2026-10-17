import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  UNSCOPED_BG_POLICY,
  authorizeRestart,
  describeCaller,
  resolveCallerProject,
  type CallerAgent,
  type CallerResolution,
} from './bgAccess.ts';
import {
  appendAuditRecord,
  buildAuditRecord,
  callerKindFor,
  parseCallerHeader,
  type AuditDeps,
} from './bgRestartPolicy.ts';

// TASK-0194 Step 4. Pure functions plus an injected audit appender: no I/O.

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const agent = (id: number, name: string, projectId: number | null, projectName: string | null): CallerAgent => ({
  id,
  name,
  projectId,
  projectName,
});

const AGENTS: CallerAgent[] = [
  agent(1, 'dev', 10, 'web'), // window `web-dev`
  agent(2, 'dev', 20, 'api'), // window `api-dev`
  agent(3, 'solo', null, null), // window `solo` (no project)
  agent(4, 'foo', null, null), // window `foo`
  agent(5, 'copy', 30, 'foo'), // window `foo-copy`
];

// ---------------------------------------------------------------- resolveCallerProject

void test('resolveCallerProject: absent header is a human/dashboard caller', () => {
  assert.deepEqual(resolveCallerProject(null, AGENTS), { kind: 'human' });
});

void test('resolveCallerProject: exact window-name match resolves the agent and its project', () => {
  assert.deepEqual(resolveCallerProject('web-dev', AGENTS), { kind: 'agent', agentId: 1, agentName: 'dev', projectId: 10 });
  assert.deepEqual(resolveCallerProject('api-dev', AGENTS), { kind: 'agent', agentId: 2, agentName: 'dev', projectId: 20 });
});

void test('resolveCallerProject: a project-less agent resolves with projectId null', () => {
  assert.deepEqual(resolveCallerProject('solo', AGENTS), { kind: 'agent', agentId: 3, agentName: 'solo', projectId: null });
});

void test('resolveCallerProject: bare short name of a project agent is unknown (window name is the identity)', () => {
  assert.deepEqual(resolveCallerProject('dev', AGENTS), { kind: 'unknown' });
});

void test('resolveCallerProject: near-miss, prefix, suffix and case-different headers do not match', () => {
  for (const h of ['web-de', 'web-dev-', 'eb-dev', 'Web-Dev', 'WEB-DEV', 'web-dev ', 'web', 'web-', '']) {
    assert.deepEqual(resolveCallerProject(h, AGENTS), { kind: 'unknown' }, `header ${JSON.stringify(h)}`);
  }
});

void test('resolveCallerProject: `foo` matches only `foo`, never `foo-copy`, and vice versa', () => {
  assert.deepEqual(resolveCallerProject('foo', AGENTS), { kind: 'agent', agentId: 4, agentName: 'foo', projectId: null });
  assert.deepEqual(resolveCallerProject('foo-copy', AGENTS), { kind: 'agent', agentId: 5, agentName: 'copy', projectId: 30 });
  // Only `foo-copy` exists: the shorter header must not prefix-match it.
  assert.deepEqual(resolveCallerProject('foo', [agent(5, 'copy', 30, 'foo')]), { kind: 'unknown' });
});

void test('resolveCallerProject: no agents means any header is unknown', () => {
  assert.deepEqual(resolveCallerProject('web-dev', []), { kind: 'unknown' });
});

void test('resolveCallerProject: ambiguous when two agents share a window name (project a-b + c vs project a + b-c)', () => {
  const colliding = [agent(1, 'c', 10, 'a-b'), agent(2, 'b-c', 20, 'a')];
  assert.equal(colliding.map((a) => `${a.projectName ?? ''}-${a.name}`).filter((w) => w === 'a-b-c').length, 2);
  assert.deepEqual(resolveCallerProject('a-b-c', colliding), { kind: 'ambiguous' });
  // Neither colliding agent's own distinct header is affected.
  assert.deepEqual(resolveCallerProject('a-b', colliding), { kind: 'unknown' });
});

void test('resolveCallerProject: a project-less agent named like a project window collides with it', () => {
  const colliding = [agent(1, 'web-dev', null, null), agent(2, 'dev', 10, 'web')];
  assert.deepEqual(resolveCallerProject('web-dev', colliding), { kind: 'ambiguous' });
});

// ---------------------------------------------------------------- authorizeRestart

const agentIn = (projectId: number | null): CallerResolution => ({ kind: 'agent', agentId: 1, agentName: 'dev', projectId });

void test('authorizeRestart: human/dashboard caller is allowed, scoped or unscoped bg, under every policy', () => {
  for (const policy of ['visible', 'hidden', 'must-assign'] as const) {
    assert.deepEqual(authorizeRestart({ kind: 'human' }, { projectId: 10 }, policy), { allowed: true });
    assert.deepEqual(authorizeRestart({ kind: 'human' }, { projectId: null }, policy), { allowed: true });
  }
});

void test('authorizeRestart: same-project agent is allowed', () => {
  assert.deepEqual(authorizeRestart(agentIn(10), { projectId: 10 }), { allowed: true });
});

void test('authorizeRestart: different-project agent is denied with project-mismatch and both project ids', () => {
  assert.deepEqual(authorizeRestart(agentIn(20), { projectId: 10 }), {
    allowed: false,
    reason: 'project-mismatch',
    callerProjectId: 20,
    bgProjectId: 10,
  });
});

void test('authorizeRestart: project-less agent against a scoped bg is denied (project-mismatch)', () => {
  assert.deepEqual(authorizeRestart(agentIn(null), { projectId: 10 }), {
    allowed: false,
    reason: 'project-mismatch',
    callerProjectId: null,
    bgProjectId: 10,
  });
});

void test('authorizeRestart: scoped agent against an unscoped bg, per policy branch', () => {
  const denied = { allowed: false, reason: 'unscoped', callerProjectId: 10, bgProjectId: null };
  assert.deepEqual(authorizeRestart(agentIn(10), { projectId: null }, 'must-assign'), denied);
  assert.deepEqual(authorizeRestart(agentIn(10), { projectId: null }, 'hidden'), denied);
  assert.deepEqual(authorizeRestart(agentIn(10), { projectId: null }, 'visible'), { allowed: true });
});

void test('authorizeRestart: null === null never authorizes (project-less agent, unscoped bg)', () => {
  assert.deepEqual(authorizeRestart(agentIn(null), { projectId: null }, 'must-assign'), {
    allowed: false,
    reason: 'unscoped',
    callerProjectId: null,
    bgProjectId: null,
  });
});

void test('authorizeRestart: the default policy is the TASK-0186 decision (must-assign, agents denied)', () => {
  assert.equal(UNSCOPED_BG_POLICY, 'must-assign');
  const r = authorizeRestart(agentIn(10), { projectId: null });
  assert.equal(r.allowed, false);
});

void test('authorizeRestart: unknown and ambiguous callers are denied fail-closed, even for an unscoped bg under `visible`', () => {
  for (const bgProjectId of [10, null]) {
    for (const policy of ['visible', 'hidden', 'must-assign'] as const) {
      assert.deepEqual(authorizeRestart({ kind: 'unknown' }, { projectId: bgProjectId }, policy), {
        allowed: false,
        reason: 'unknown-caller',
        callerProjectId: null,
        bgProjectId,
      });
      assert.deepEqual(authorizeRestart({ kind: 'ambiguous' }, { projectId: bgProjectId }, policy), {
        allowed: false,
        reason: 'ambiguous-caller',
        callerProjectId: null,
        bgProjectId,
      });
    }
  }
});

void test('end to end: header -> resolver -> guard', () => {
  const bg = { projectId: 10 };
  const run = (header: string | null) => authorizeRestart(resolveCallerProject(header, AGENTS), bg);
  assert.equal(run(null).allowed, true); // dashboard
  assert.equal(run('web-dev').allowed, true); // same project
  assert.equal(run('api-dev').allowed, false); // other project, same short name
  assert.equal(run('solo').allowed, false); // no project
  assert.equal(run('nobody').allowed, false); // unknown
});

// ---------------------------------------------------------------- denied audit record

void test('a denied request produces an audit record with outcome denied and the reason (injectable appender)', () => {
  const lines: Array<{ file: string; text: string }> = [];
  const deps: AuditDeps = {
    mkdir: () => undefined,
    appendFile: (file, text) => void lines.push({ file, text }),
  };

  const caller = parseCallerHeader('api-dev');
  const authz = authorizeRestart(resolveCallerProject(caller, AGENTS), { projectId: 10 });
  assert.ok(!authz.allowed);

  const ok = appendAuditRecord(
    deps,
    'logs',
    buildAuditRecord({ ts: Date.parse('2026-09-20T12:00:00.000Z'), bg: 'web-dev-server', callerKind: callerKindFor(caller), caller, outcome: 'denied', reason: authz.reason }),
  );
  assert.equal(ok, true);
  assert.equal(lines.length, 1);
  const [line] = lines;
  assert.ok(line);
  assert.equal(line.file, path.join('logs', 'bg-restarts.jsonl'));
  assert.deepEqual(JSON.parse(line.text), {
    ts: '2026-09-20T12:00:00.000Z',
    bg: 'web-dev-server',
    callerKind: 'agent',
    caller: 'api-dev',
    outcome: 'denied',
    reason: 'project-mismatch',
  });
});

void test('buildAuditRecord stays backwards-compatible: no reason key unless one is given', () => {
  const r = buildAuditRecord({ ts: 0, bg: 'x', callerKind: 'dashboard', caller: null, outcome: 'restarted', mechanism: 'respawn' });
  assert.equal('reason' in r, false);
});

// ---------------------------------------------------------------- describeCaller (TASK-0202)

void test('describeCaller: agent with a project includes projectName', () => {
  assert.deepEqual(describeCaller(resolveCallerProject('web-dev', AGENTS), AGENTS), {
    kind: 'agent',
    agentId: 1,
    agentName: 'dev',
    projectId: 10,
    projectName: 'web',
  });
});

void test('describeCaller: project-less agent has projectId and projectName null', () => {
  assert.deepEqual(describeCaller(resolveCallerProject('solo', AGENTS), AGENTS), {
    kind: 'agent',
    agentId: 3,
    agentName: 'solo',
    projectId: null,
    projectName: null,
  });
});

void test('describeCaller: human, unknown and ambiguous are exactly `{ kind }`', () => {
  for (const kind of ['human', 'unknown', 'ambiguous'] as const) {
    const resolution: CallerResolution = { kind };
    assert.deepEqual(describeCaller(resolution, AGENTS), { kind });
  }
});

void test('describeCaller: end to end with a `<project>-<name>` header', () => {
  assert.deepEqual(describeCaller(resolveCallerProject('api-dev', AGENTS), AGENTS), {
    kind: 'agent',
    agentId: 2,
    agentName: 'dev',
    projectId: 20,
    projectName: 'api',
  });
  assert.deepEqual(describeCaller(resolveCallerProject('nobody', AGENTS), AGENTS), { kind: 'unknown' });
  assert.deepEqual(describeCaller(resolveCallerProject(null, AGENTS), AGENTS), { kind: 'human' });
});

// ---------------------------------------------------------------- route wiring (static pin)

// index.ts has top-level side effects and cannot be imported in a unit test;
// see bgRestartPolicy.test.ts / transitionsLog.test.ts for the precedent.
const indexSource = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8');

void test('index.ts wires the guard into the restart route: 403 + denied audit, before the cooldown check', () => {
  assert.match(indexSource, /from '\.\/bgAccess\.ts'/);
  assert.match(indexSource, /resolveCallerProject\(/);
  assert.match(indexSource, /authorizeRestart\(/);
  assert.match(indexSource, /outcome:\s*'denied'/);
  assert.match(indexSource, /status\(\s*403\s*\)/);
  const guard = indexSource.indexOf('authorizeRestart(');
  const cooldown = indexSource.indexOf('evaluateCooldown(');
  const session = indexSource.indexOf("step: 'session-check'");
  assert.ok(guard !== -1 && cooldown !== -1 && session !== -1);
  assert.ok(guard < session && session < cooldown, 'guard must precede the session check and the cooldown');
});
