import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import type { AgentContext } from './context.ts';
import { buildNewAgentUpdate, type NewAgentLiveState, type NewAgentUpdateSource } from './agentUpdatePayload.ts';

const baseAgent: NewAgentUpdateSource = {
  id: 7,
  name: 'demo-clone',
  projectId: 3,
  projectName: 'demo',
  launchCmd: 'claude',
  workdir: '/repo/demo',
  worktreePath: null,
  branch: null,
  role: 'implementer',
  description: null,
};

const baseContext: AgentContext = {
  model: null,
  modelId: null,
  contextTokens: null,
  contextPct: null,
  contextLimit: 200000,
  contextLimitConfident: false,
};

const baseLive: NewAgentLiveState = {
  state: 'idle',
  mode: 'default',
  agentType: 'claude',
  windowPresent: true,
  context: baseContext,
};

void test('a worktree-backed agent carries its worktreePath and branch', () => {
  const body = buildNewAgentUpdate(
    { ...baseAgent, worktreePath: '/repo/demo-wt/7', branch: 'conductor/7' },
    baseLive,
  );
  assert.equal(body.worktreePath, '/repo/demo-wt/7');
  assert.equal(body.branch, 'conductor/7');
});

void test('a non-worktree agent gets explicit null worktreePath/branch (keys present)', () => {
  const body = buildNewAgentUpdate(baseAgent, baseLive);
  assert.ok('worktreePath' in body);
  assert.ok('branch' in body);
  assert.equal(body.worktreePath, null);
  assert.equal(body.branch, null);
});

void test('role is included', () => {
  assert.equal(buildNewAgentUpdate(baseAgent, baseLive).role, 'implementer');
});

void test('defaults match the historical clone literal and inGitRepo is passed through', () => {
  const body = buildNewAgentUpdate(baseAgent, baseLive);
  assert.equal(body.queuedTasks, 0);
  assert.equal(body.activeTask, null);
  assert.equal(body.inGitRepo, false);
  assert.equal(body.launchCmd, 'claude');
  assert.equal(body.workdir, '/repo/demo');
  assert.equal(body.projectName, 'demo');
  assert.equal(buildNewAgentUpdate(baseAgent, { ...baseLive, inGitRepo: true }).inGitRepo, true);
});

void test('context fields spread through untouched', () => {
  const body = buildNewAgentUpdate(baseAgent, {
    ...baseLive,
    context: { ...baseContext, model: 'Opus 4.8', contextPct: 12, contextTokens: 1234 },
  });
  assert.equal(body.model, 'Opus 4.8');
  assert.equal(body.contextPct, 12);
  assert.equal(body.contextTokens, 1234);
});
