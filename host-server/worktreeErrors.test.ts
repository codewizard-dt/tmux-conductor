import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { WorktreeError, worktreeErrorStatus, type WorktreeErrorCode } from './worktreeErrors.ts';

void test('worktreeErrorStatus maps each code to its HTTP status', () => {
  const expected: Record<WorktreeErrorCode, number> = {
    'not-found': 404,
    'already-has-worktree': 409,
    'not-git-repo': 400,
    'git-failed': 500,
  };
  for (const [code, status] of Object.entries(expected) as Array<[WorktreeErrorCode, number]>) {
    assert.equal(worktreeErrorStatus(code), status, code);
  }
});

void test('WorktreeError preserves message, code, name and Error identity', () => {
  const err = new WorktreeError('git-failed', "fatal: a branch named 'conductor/7' already exists");
  assert.ok(err instanceof Error);
  assert.ok(err instanceof WorktreeError);
  assert.equal(err.name, 'WorktreeError');
  assert.equal(err.code, 'git-failed');
  assert.equal(err.message, "fatal: a branch named 'conductor/7' already exists");
});
