import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'node:url';
import { applyStash, createWorktree, deleteBranch, detectBaseBranch, getGitRoot, isGitRepo, removeWorktree, stashCheckpoint } from './git.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = path.resolve(__dirname, '../tmp');

function git(dir: string, ...args: string[]): void {
  const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr}`);
}

/** Create a throwaway git repo under ./tmp with the given initial branch and one commit. */
function makeRepo(label: string, initialBranch: string): string {
  fs.mkdirSync(tmpDir, { recursive: true });
  const rand = Math.random().toString(36).slice(2, 10);
  const dir = fs.mkdtempSync(path.join(tmpDir, `uat065-${label}-${rand}-`));
  git(dir, 'init', '-b', initialBranch);
  git(
    dir,
    '-c', 'user.email=uat@test.local',
    '-c', 'user.name=UAT',
    'commit', '--allow-empty', '-m', 'init',
  );
  return dir;
}

function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

test('isGitRepo returns true for a git worktree and false for a non-worktree directory', () => {
  // Note: any dir under ./tmp is inside the tmux-conductor repo's work tree, so
  // the negative case uses the fixture's .git dir — inside a git dir, but
  // deterministically NOT inside a work tree (rev-parse prints 'false').
  const repo = makeRepo('isgit', 'main');
  try {
    assert.equal(isGitRepo(repo), true);
    assert.equal(isGitRepo(path.join(repo, '.git')), false);
  } finally {
    cleanup(repo);
  }
});

test('detectBaseBranch prefers origin/HEAD when it resolves to a local branch', () => {
  // Default branch is a non-common name so only origin/HEAD can produce it.
  const repo = makeRepo('originhead', 'trunk');
  try {
    git(repo, 'update-ref', 'refs/remotes/origin/trunk', 'HEAD');
    git(repo, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk');
    assert.equal(detectBaseBranch(repo), 'trunk');
  } finally {
    cleanup(repo);
  }
});

test('detectBaseBranch skips origin/HEAD pointing at a branch that does not exist locally', () => {
  const repo = makeRepo('ghosthead', 'master');
  try {
    git(repo, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/ghost');
    assert.equal(detectBaseBranch(repo), 'master');
  } finally {
    cleanup(repo);
  }
});

test('detectBaseBranch prefers main over master when both exist', () => {
  const repo = makeRepo('mainfirst', 'master');
  try {
    git(repo, 'branch', 'main');
    assert.equal(detectBaseBranch(repo), 'main');
  } finally {
    cleanup(repo);
  }
});

test('detectBaseBranch falls back to master when main is absent', () => {
  const repo = makeRepo('master', 'master');
  try {
    assert.equal(detectBaseBranch(repo), 'master');
  } finally {
    cleanup(repo);
  }
});

test('detectBaseBranch falls back to develop when main and master are absent', () => {
  const repo = makeRepo('develop', 'develop');
  try {
    assert.equal(detectBaseBranch(repo), 'develop');
  } finally {
    cleanup(repo);
  }
});

test("detectBaseBranch returns 'main' when nothing resolves", () => {
  // Only an uncommon local branch, no origin/HEAD.
  const repo = makeRepo('fallback', 'trunk');
  try {
    assert.equal(detectBaseBranch(repo), 'main');
  } finally {
    cleanup(repo);
  }
});

test('getGitRoot returns the work tree top-level for a directory inside a git repo', () => {
  const repo = makeRepo('gitroot', 'main');
  try {
    // fs.mkdtempSync + git init can leave a resolved-symlink mismatch on macOS
    // (/tmp vs /private/tmp equivalents don't apply here since fixtures live
    // under the repo's own ./tmp, but realpath both sides defensively).
    assert.equal(fs.realpathSync(getGitRoot(repo)!), fs.realpathSync(repo));
  } finally {
    cleanup(repo);
  }
});

test('getGitRoot returns null for a directory that is not inside a git work tree', () => {
  const repo = makeRepo('gitroot-neg', 'main');
  try {
    assert.equal(getGitRoot(path.join(repo, '.git')), null);
  } finally {
    cleanup(repo);
  }
});

test('createWorktree adds a new worktree and branch off the detected base branch', () => {
  const repo = makeRepo('worktree', 'main');
  const worktreePath = path.join(tmpDir, `uat061-wt-${Math.random().toString(36).slice(2, 10)}`);
  try {
    const ok = createWorktree(repo, worktreePath, 'conductor/test-agent');
    assert.equal(ok, true);
    assert.equal(fs.existsSync(worktreePath), true);

    const branchList = spawnSync('git', ['-C', repo, 'branch', '--list', 'conductor/test-agent'], { encoding: 'utf8' });
    assert.match(branchList.stdout, /conductor\/test-agent/);

    const worktreeList = spawnSync('git', ['-C', repo, 'worktree', 'list'], { encoding: 'utf8' });
    assert.match(worktreeList.stdout, new RegExp(fs.realpathSync(worktreePath).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  } finally {
    // `git worktree add` registers the path with the main repo; prune the
    // registration before removing the directory tree so the fixture repo
    // itself is left clean for any later test in this process.
    spawnSync('git', ['-C', repo, 'worktree', 'remove', '--force', worktreePath], { encoding: 'utf8' });
    cleanup(worktreePath);
    cleanup(repo);
  }
});

test('createWorktree returns false when the branch already exists', () => {
  const repo = makeRepo('worktree-fail', 'main');
  const worktreePath = path.join(tmpDir, `uat061-wt-fail-${Math.random().toString(36).slice(2, 10)}`);
  try {
    git(repo, 'branch', 'conductor/dup-agent');
    const ok = createWorktree(repo, worktreePath, 'conductor/dup-agent');
    assert.equal(ok, false);
    assert.equal(fs.existsSync(worktreePath), false);
  } finally {
    cleanup(worktreePath);
    cleanup(repo);
  }
});

test('removeWorktree removes a registered worktree and its directory', () => {
  const repo = makeRepo('removewt', 'main');
  const worktreePath = path.join(tmpDir, `uat063-rm-${Math.random().toString(36).slice(2, 10)}`);
  try {
    assert.equal(createWorktree(repo, worktreePath, 'conductor/rm-agent'), true);
    const ok = removeWorktree(repo, worktreePath);
    assert.equal(ok, true);
    assert.equal(fs.existsSync(worktreePath), false);

    const worktreeList = spawnSync('git', ['-C', repo, 'worktree', 'list'], { encoding: 'utf8' });
    assert.doesNotMatch(worktreeList.stdout, /rm-agent/);
  } finally {
    cleanup(worktreePath);
    cleanup(repo);
  }
});

test('removeWorktree returns false (without throwing) and leaves the directory when the worktree is locked', () => {
  // TASK-063: the handler uses a single `--force`, which git does not treat as
  // sufficient to override a lock (it requires `-f -f`). This is the realistic
  // "git error during cleanup" case the DELETE /agents/:id route must survive.
  const repo = makeRepo('removewt-locked', 'main');
  const worktreePath = path.join(tmpDir, `uat063-rm-locked-${Math.random().toString(36).slice(2, 10)}`);
  try {
    assert.equal(createWorktree(repo, worktreePath, 'conductor/locked-agent'), true);
    git(repo, 'worktree', 'lock', worktreePath);

    const ok = removeWorktree(repo, worktreePath);
    assert.equal(ok, false);
    assert.equal(fs.existsSync(worktreePath), true, 'locked worktree directory should survive a failed remove');
  } finally {
    spawnSync('git', ['-C', repo, 'worktree', 'unlock', worktreePath], { encoding: 'utf8' });
    spawnSync('git', ['-C', repo, 'worktree', 'remove', '--force', worktreePath], { encoding: 'utf8' });
    cleanup(worktreePath);
    cleanup(repo);
  }
});

test('deleteBranch deletes an existing, non-checked-out branch', () => {
  const repo = makeRepo('delbranch', 'main');
  try {
    git(repo, 'branch', 'conductor/del-me');
    const ok = deleteBranch(repo, 'conductor/del-me');
    assert.equal(ok, true);

    const branchList = spawnSync('git', ['-C', repo, 'branch', '--list', 'conductor/del-me'], { encoding: 'utf8' });
    assert.equal(branchList.stdout.trim(), '');
  } finally {
    cleanup(repo);
  }
});

test('deleteBranch returns false (without throwing) for a nonexistent branch', () => {
  const repo = makeRepo('delbranch-missing', 'main');
  try {
    const ok = deleteBranch(repo, 'does-not-exist');
    assert.equal(ok, false);
  } finally {
    cleanup(repo);
  }
});

// TASK-068: pre-dispatch checkpoint — stashCheckpoint snapshots a dirty worktree
// before a task dispatch and returns the resolved stash commit SHA to record.

/** Commit a tracked file so a later modification produces a real (stashable) change. */
function commitTrackedFile(repo: string, name: string, content: string): void {
  fs.writeFileSync(path.join(repo, name), content);
  git(repo, 'add', name);
  git(repo, '-c', 'user.email=uat@test.local', '-c', 'user.name=UAT', 'commit', '-m', `add ${name}`);
}

test('stashCheckpoint stashes a dirty worktree and returns the resolved stash SHA', () => {
  const repo = makeRepo('stash-dirty', 'main');
  try {
    commitTrackedFile(repo, 'tracked.txt', 'v1\n');
    fs.writeFileSync(path.join(repo, 'tracked.txt'), 'v2 dirty\n');

    const ref = stashCheckpoint(repo, 1730000000000);
    assert.match(ref ?? '', /^[0-9a-f]{40}$/, 'should return a 40-char stash commit SHA');

    const list = spawnSync('git', ['-C', repo, 'stash', 'list'], { encoding: 'utf8' }).stdout;
    assert.match(list, /conductor-checkpoint-1730000000000/, 'stash entry with the checkpoint message should exist');

    const status = spawnSync('git', ['-C', repo, 'status', '--porcelain'], { encoding: 'utf8' }).stdout;
    assert.equal(status.trim(), '', 'stash push should leave the worktree clean');
  } finally {
    cleanup(repo);
  }
});

test('stashCheckpoint returns null for a clean worktree (nothing to stash)', () => {
  const repo = makeRepo('stash-clean', 'main');
  try {
    const ref = stashCheckpoint(repo, 1730000000001);
    assert.equal(ref, null, 'a clean worktree has no local changes to save');

    const list = spawnSync('git', ['-C', repo, 'stash', 'list'], { encoding: 'utf8' }).stdout;
    assert.equal(list.trim(), '', 'no stash entry should be created for a clean worktree');
  } finally {
    cleanup(repo);
  }
});

test('stashCheckpoint returns null for a path that is not a git work tree', () => {
  // The fixture's .git dir is inside a git dir but deterministically NOT a work
  // tree, so `git stash` fails without touching the surrounding conductor repo.
  const repo = makeRepo('stash-nongit', 'main');
  try {
    const ref = stashCheckpoint(path.join(repo, '.git'), 1730000000002);
    assert.equal(ref, null, 'a non-worktree path must yield no checkpoint');
  } finally {
    cleanup(repo);
  }
});

// TASK-070: rollback — applyStash re-applies a recorded checkpoint stash into
// the worktree (the counterpart to stashCheckpoint) and reports git failures.

test('applyStash re-applies a checkpoint stash and restores the stashed changes', () => {
  const repo = makeRepo('apply-restore', 'main');
  try {
    commitTrackedFile(repo, 'tracked.txt', 'v1\n');
    fs.writeFileSync(path.join(repo, 'tracked.txt'), 'v2 dirty\n');

    // stashCheckpoint stashes the dirty change and leaves the worktree clean,
    // mirroring the pre-dispatch checkpoint the rollback endpoint rolls back to.
    const ref = stashCheckpoint(repo, 1730000000010);
    assert.match(ref ?? '', /^[0-9a-f]{40}$/);
    assert.equal(fs.readFileSync(path.join(repo, 'tracked.txt'), 'utf8'), 'v1\n');

    const res = applyStash(repo, ref!);
    assert.equal(res.ok, true, res.detail);
    assert.equal(
      fs.readFileSync(path.join(repo, 'tracked.txt'), 'utf8'),
      'v2 dirty\n',
      'rollback should restore the stashed working-tree content',
    );
  } finally {
    cleanup(repo);
  }
});

test('applyStash returns ok:false with a detail message for a nonexistent stash ref', () => {
  const repo = makeRepo('apply-miss', 'main');
  try {
    const res = applyStash(repo, 'stash@{99}');
    assert.equal(res.ok, false, 'applying a missing stash ref must fail');
    assert.ok(res.detail.length > 0, 'failure detail should carry git stderr');
  } finally {
    cleanup(repo);
  }
});
