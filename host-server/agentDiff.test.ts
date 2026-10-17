import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { agentSnapshotChanged, type DiffableAgent } from './agentDiff.ts';

function makeAgent(overrides: Partial<DiffableAgent> = {}): DiffableAgent {
  return {
    state: 'idle',
    status: { display: 'idle', reason: 'state-file', needsAttention: false },
    mode: 'normal',
    queuedTasks: 0,
    windowPresent: true,
    activeTask: null,
    modelId: 'claude-opus-4-8',
    contextPct: 10,
    label: null,
    usage: { costUsd: 1.5, outputTokens: 100 },
    worktreePath: null,
    branch: null,
    ...overrides,
  };
}

void test('identical agents are not a change', () => {
  assert.equal(agentSnapshotChanged(makeAgent(), makeAgent()), false);
});

void test('a missing prev (first sight) is a change', () => {
  assert.equal(agentSnapshotChanged(undefined, makeAgent()), true);
});

void test('worktreePath null -> set is a change', () => {
  const next = makeAgent({ worktreePath: '/repo/.worktrees/agent-a' });
  assert.equal(agentSnapshotChanged(makeAgent(), next), true);
});

void test('branch null -> set is a change', () => {
  const next = makeAgent({ branch: 'agent/a' });
  assert.equal(agentSnapshotChanged(makeAgent(), next), true);
});

void test('worktree cleared (set -> null, self-heal) is a change', () => {
  const prev = makeAgent({ worktreePath: '/repo/.worktrees/agent-a', branch: 'agent/a' });
  assert.equal(agentSnapshotChanged(prev, makeAgent()), true);
});

void test('lastPrompt null -> set is a change', () => {
  const next = makeAgent({ lastPrompt: { text: 'hi', ts: '2026-09-20T10:00:00.000Z' } });
  assert.equal(agentSnapshotChanged(makeAgent({ lastPrompt: null }), next), true);
});

void test('lastPrompt with the same ts and text is not a change', () => {
  const lp = { text: 'hi', ts: '2026-09-20T10:00:00.000Z' };
  assert.equal(agentSnapshotChanged(makeAgent({ lastPrompt: { ...lp } }), makeAgent({ lastPrompt: { ...lp } })), false);
});

void test('lastPrompt with a different ts but the same text (identical resubmit) is a change', () => {
  const prev = makeAgent({ lastPrompt: { text: 'hi', ts: '2026-09-20T10:00:00.000Z' } });
  const next = makeAgent({ lastPrompt: { text: 'hi', ts: '2026-09-20T10:00:05.000Z' } });
  assert.equal(agentSnapshotChanged(prev, next), true);
});

void test('lastPrompt with a different text but the same ts is a change', () => {
  const prev = makeAgent({ lastPrompt: { text: 'hi', ts: '2026-09-20T10:00:00.000Z' } });
  const next = makeAgent({ lastPrompt: { text: 'yo', ts: '2026-09-20T10:00:00.000Z' } });
  assert.equal(agentSnapshotChanged(prev, next), true);
});

void test('lastPrompt set -> null is a change', () => {
  const prev = makeAgent({ lastPrompt: { text: 'hi', ts: '2026-09-20T10:00:00.000Z' } });
  assert.equal(agentSnapshotChanged(prev, makeAgent({ lastPrompt: null })), true);
});

void test('lastPrompt undefined vs null is not a change', () => {
  assert.equal(agentSnapshotChanged(makeAgent({ lastPrompt: undefined }), makeAgent({ lastPrompt: null })), false);
  assert.equal(agentSnapshotChanged(makeAgent({ lastPrompt: null }), makeAgent({ lastPrompt: undefined })), false);
});

void test('a pre-existing field from each group still triggers a change', () => {
  const base = makeAgent();
  assert.equal(agentSnapshotChanged(base, makeAgent({ state: 'busy' })), true, 'state');
  assert.equal(
    agentSnapshotChanged(base, makeAgent({ status: { display: 'working', reason: 'state-file', needsAttention: false } })),
    true,
    'status.display',
  );
  assert.equal(agentSnapshotChanged(base, makeAgent({ queuedTasks: 3 })), true, 'queuedTasks');
  assert.equal(agentSnapshotChanged(base, makeAgent({ usage: { costUsd: 2, outputTokens: 100 } })), true, 'usage.costUsd');
});
