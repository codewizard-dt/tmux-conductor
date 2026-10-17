import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'node:url';
import { __resetGitRepoCacheForTests, agentPaneCwd, applyStash, assertWorktreeOutsideRoot, siblingWorktreeDir, siblingWorktreePath, createWorktree, deleteBranch, detectBaseBranch, extractGitReason, getGitRoot, isGitRepo, isInGitRepoCached, pruneWorktrees, removeWorktree, stashCheckpoint, tryCreateWorktree } from './git.ts';

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

void test('isGitRepo returns true for a git worktree and false for a non-worktree directory', () => {
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

void test('isInGitRepoCached is true for a repo, false for a plain directory, and honours the TTL via an injected clock', () => {
  // Fixtures live under ./tmp, which is itself inside the tmux-conductor work
  // tree. GIT_CEILING_DIRECTORIES stops git's upward search at ./tmp so a
  // `.git`-less fixture is deterministically "not in a repo".
  const prevCeiling = process.env['GIT_CEILING_DIRECTORIES'];
  process.env['GIT_CEILING_DIRECTORIES'] = tmpDir;
  __resetGitRepoCacheForTests();
  const repo = makeRepo('incached', 'main');
  const plain = fs.mkdtempSync(path.join(tmpDir, 'uat-plain-'));
  try {
    const t0 = 1_000_000;
    assert.equal(isInGitRepoCached(repo, t0), true);
    assert.equal(isInGitRepoCached(plain, t0), false);

    // Remove .git: inside the 30 s TTL the cached `true` is still returned
    // (no git re-spawn); after the TTL the value is refreshed to `false`.
    fs.rmSync(path.join(repo, '.git'), { recursive: true, force: true });
    assert.equal(isInGitRepoCached(repo, t0 + 29_999), true);
    assert.equal(isInGitRepoCached(repo, t0 + 30_000), false);

    // Same in the other direction: `git init` after the first (cached `false`)
    // read is invisible inside the TTL and picked up once it expires.
    git(plain, 'init', '-b', 'main');
    assert.equal(isInGitRepoCached(plain, t0 + 29_999), false);
    assert.equal(isInGitRepoCached(plain, t0 + 30_000), true);
  } finally {
    if (prevCeiling === undefined) delete process.env['GIT_CEILING_DIRECTORIES'];
    else process.env['GIT_CEILING_DIRECTORIES'] = prevCeiling;
    __resetGitRepoCacheForTests();
    cleanup(repo);
    cleanup(plain);
  }
});

void test('detectBaseBranch prefers origin/HEAD when it resolves to a local branch', () => {
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

void test('detectBaseBranch skips origin/HEAD pointing at a branch that does not exist locally', () => {
  const repo = makeRepo('ghosthead', 'master');
  try {
    git(repo, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/ghost');
    assert.equal(detectBaseBranch(repo), 'master');
  } finally {
    cleanup(repo);
  }
});

void test('detectBaseBranch prefers main over master when both exist', () => {
  const repo = makeRepo('mainfirst', 'master');
  try {
    git(repo, 'branch', 'main');
    assert.equal(detectBaseBranch(repo), 'main');
  } finally {
    cleanup(repo);
  }
});

void test('detectBaseBranch falls back to master when main is absent', () => {
  const repo = makeRepo('master', 'master');
  try {
    assert.equal(detectBaseBranch(repo), 'master');
  } finally {
    cleanup(repo);
  }
});

void test('detectBaseBranch falls back to develop when main and master are absent', () => {
  const repo = makeRepo('develop', 'develop');
  try {
    assert.equal(detectBaseBranch(repo), 'develop');
  } finally {
    cleanup(repo);
  }
});

void test("detectBaseBranch returns 'main' when nothing resolves", () => {
  // Only an uncommon local branch, no origin/HEAD.
  const repo = makeRepo('fallback', 'trunk');
  try {
    assert.equal(detectBaseBranch(repo), 'main');
  } finally {
    cleanup(repo);
  }
});

void test('getGitRoot returns the work tree top-level for a directory inside a git repo', () => {
  const repo = makeRepo('gitroot', 'main');
  try {
    // fs.mkdtempSync + git init can leave a resolved-symlink mismatch on macOS
    // (/tmp vs /private/tmp equivalents don't apply here since fixtures live
    // under the repo's own ./tmp, but realpath both sides defensively).
    const root = getGitRoot(repo);
    assert.ok(root);
    assert.equal(fs.realpathSync(root), fs.realpathSync(repo));
  } finally {
    cleanup(repo);
  }
});

void test('getGitRoot returns null for a directory that is not inside a git work tree', () => {
  const repo = makeRepo('gitroot-neg', 'main');
  try {
    assert.equal(getGitRoot(path.join(repo, '.git')), null);
  } finally {
    cleanup(repo);
  }
});

void test('createWorktree adds a new worktree and branch off the detected base branch', () => {
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

void test('createWorktree returns false when the branch already exists', () => {
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

void test('tryCreateWorktree returns { ok: true } on success', () => {
  const repo = makeRepo('trywt-ok', 'main');
  const worktreePath = path.join(tmpDir, `task210-wt-ok-${Math.random().toString(36).slice(2, 10)}`);
  try {
    assert.deepEqual(tryCreateWorktree(repo, worktreePath, 'conductor/try-ok'), { ok: true });
    assert.equal(fs.existsSync(worktreePath), true);
  } finally {
    spawnSync('git', ['-C', repo, 'worktree', 'remove', '--force', worktreePath], { encoding: 'utf8' });
    cleanup(worktreePath);
    cleanup(repo);
  }
});

void test('tryCreateWorktree reports "already exists" when the branch exists', () => {
  const repo = makeRepo('trywt-dup', 'main');
  const worktreePath = path.join(tmpDir, `task210-wt-dup-${Math.random().toString(36).slice(2, 10)}`);
  try {
    git(repo, 'branch', 'conductor/try-dup');
    const res = tryCreateWorktree(repo, worktreePath, 'conductor/try-dup');
    assert.ok(!res.ok);
    assert.match(res.reason, /already exists/);
    assert.equal(fs.existsSync(worktreePath), false);
  } finally {
    cleanup(worktreePath);
    cleanup(repo);
  }
});

void test('tryCreateWorktree reports an invalid base ref for a repo with no commits', () => {
  fs.mkdirSync(tmpDir, { recursive: true });
  const repo = fs.mkdtempSync(path.join(tmpDir, 'task210-nocommit-'));
  const worktreePath = path.join(tmpDir, `task210-wt-nocommit-${Math.random().toString(36).slice(2, 10)}`);
  try {
    git(repo, 'init', '-b', 'main');
    const res = tryCreateWorktree(repo, worktreePath, 'conductor/try-nocommit');
    assert.ok(!res.ok);
    assert.match(res.reason, /invalid reference|not a valid|unknown revision/i);
    assert.equal(createWorktree(repo, worktreePath, 'conductor/try-nocommit'), false);
  } finally {
    cleanup(worktreePath);
    cleanup(repo);
  }
});

void test('tryCreateWorktree refuses a nested target without invoking git', () => {
  const repo = makeRepo('trywt-nested', 'main');
  const worktreePath = path.join(repo, 'nested', 'wt');
  const listWorktrees = (): string =>
    spawnSync('git', ['-C', repo, 'worktree', 'list', '--porcelain'], { encoding: 'utf8' }).stdout;
  try {
    const before = listWorktrees();
    const res = tryCreateWorktree(repo, worktreePath, 'conductor/try-nested');
    assert.ok(!res.ok);
    assert.match(res.reason, /inside the repository root/);
    assert.equal(fs.existsSync(worktreePath), false);
    assert.equal(listWorktrees(), before);
    const branches = spawnSync('git', ['-C', repo, 'branch', '--list', 'conductor/try-nested'], { encoding: 'utf8' });
    assert.equal(branches.stdout.trim(), '');
  } finally {
    cleanup(repo);
  }
});

void test('assertWorktreeOutsideRoot accepts a sibling path', () => {
  const root = path.join(tmpDir, 'guard-root');
  assert.deepEqual(assertWorktreeOutsideRoot(root, path.join(tmpDir, 'guard-root-worktrees', '7')), { ok: true });
  assert.deepEqual(assertWorktreeOutsideRoot(root, path.join(tmpDir, 'guard-other')), { ok: true });
});

void test('assertWorktreeOutsideRoot refuses paths nested under the root at any depth', () => {
  const root = path.join(tmpDir, 'guard-root');
  for (const nested of [path.join(root, 'wt'), path.join(root, 'a', 'b', 'c', 'wt')]) {
    const res = assertWorktreeOutsideRoot(root, nested);
    assert.ok(!res.ok, `expected refusal for ${nested}`);
    assert.match(res.reason, /inside the repository root/);
  }
});

void test('assertWorktreeOutsideRoot refuses the root itself', () => {
  const root = path.join(tmpDir, 'guard-root');
  const res = assertWorktreeOutsideRoot(root, root);
  assert.ok(!res.ok);
  assert.match(res.reason, /inside the repository root/);
});

void test("assertWorktreeOutsideRoot refuses gitRoot '/'", () => {
  const res = assertWorktreeOutsideRoot('/', '/some-worktree');
  assert.ok(!res.ok);
  assert.match(res.reason, /inside the repository root/);
});

void test('assertWorktreeOutsideRoot refuses a symlinked parent whose real path is inside the root', (t) => {
  const repo = makeRepo('guard-symlink', 'main');
  const link = path.join(tmpDir, `task212-link-${Math.random().toString(36).slice(2, 10)}`);
  try {
    try {
      fs.symlinkSync(repo, link, 'dir');
    } catch {
      t.skip('fs.symlinkSync is not supported on this platform');
      return;
    }
    const res = assertWorktreeOutsideRoot(repo, path.join(link, 'wt'));
    assert.ok(!res.ok);
    assert.match(res.reason, /inside the repository root/);
  } finally {
    fs.rmSync(link, { force: true });
    cleanup(repo);
  }
});

void test('siblingWorktreePath and siblingWorktreeDir build the <root>-worktrees layout', () => {
  assert.equal(siblingWorktreeDir('/a/b/repo'), '/a/b/repo-worktrees');
  assert.equal(siblingWorktreePath('/a/b/repo', 7), '/a/b/repo-worktrees/7');
});

/** Repo with a committed `packages/app/index.txt`, so a worktree mirrors that sub-path. */
function makeRepoWithSubdir(label: string): string {
  const repo = makeRepo(label, 'main');
  fs.mkdirSync(path.join(repo, 'packages', 'app'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'packages', 'app', 'index.txt'), 'x\n');
  git(repo, 'add', '.');
  git(repo, '-c', 'user.email=uat@test.local', '-c', 'user.name=UAT', 'commit', '-m', 'subdir');
  return repo;
}

void test('agentPaneCwd returns workdir when the agent has no worktree', () => {
  assert.equal(agentPaneCwd({ workdir: '/a/b/repo', worktreePath: null }), '/a/b/repo');
});

void test('agentPaneCwd returns workdir when worktreePath is stale (not on disk)', () => {
  const repo = makeRepo('pane-stale', 'main');
  try {
    const stale = path.join(path.dirname(repo), 'does-not-exist-worktree');
    assert.equal(agentPaneCwd({ workdir: repo, worktreePath: stale }), repo);
    // Injected existence check: even a real path is treated as stale when it "does not exist".
    assert.equal(agentPaneCwd({ workdir: repo, worktreePath: repo }, () => false), repo);
  } finally {
    cleanup(repo);
  }
});

void test('agentPaneCwd returns the worktree when workdir is the repo root', () => {
  const repo = makeRepo('pane-root', 'main');
  const wtPath = siblingWorktreePath(repo, 1);
  try {
    assert.deepEqual(tryCreateWorktree(repo, wtPath, 'conductor/1'), { ok: true });
    assert.equal(agentPaneCwd({ workdir: repo, worktreePath: wtPath }), wtPath);
  } finally {
    cleanup(wtPath);
    cleanup(repo);
    cleanup(siblingWorktreeDir(repo));
  }
});

void test('agentPaneCwd maps a subdirectory workdir into the worktree', () => {
  const repo = makeRepoWithSubdir('pane-sub');
  const wtPath = siblingWorktreePath(repo, 2);
  try {
    assert.deepEqual(tryCreateWorktree(repo, wtPath, 'conductor/2'), { ok: true });
    assert.equal(
      agentPaneCwd({ workdir: path.join(repo, 'packages', 'app'), worktreePath: wtPath }),
      path.join(wtPath, 'packages', 'app'),
    );
  } finally {
    cleanup(wtPath);
    cleanup(repo);
    cleanup(siblingWorktreeDir(repo));
  }
});

void test('agentPaneCwd falls back to the worktree root when the sub-path is missing there', () => {
  const repo = makeRepoWithSubdir('pane-missing');
  const wtPath = siblingWorktreePath(repo, 3);
  try {
    assert.deepEqual(tryCreateWorktree(repo, wtPath, 'conductor/3'), { ok: true });
    // An untracked subdirectory exists in the source repo but not in the worktree.
    const untracked = path.join(repo, 'scratch', 'deep');
    fs.mkdirSync(untracked, { recursive: true });
    assert.equal(agentPaneCwd({ workdir: untracked, worktreePath: wtPath }), wtPath);
  } finally {
    cleanup(wtPath);
    cleanup(repo);
    cleanup(siblingWorktreeDir(repo));
  }
});

void test('extractGitReason prefers the last fatal/error line, strips the prefix, and caps length', () => {
  assert.equal(
    extractGitReason('Preparing worktree\nerror: something minor\nfatal: a branch named \'x\' already exists\n'),
    "a branch named 'x' already exists",
  );
  assert.equal(extractGitReason('some plain line\n\n'), 'some plain line');
  assert.equal(extractGitReason(''), 'git worktree add failed');
  const long = extractGitReason(`fatal: ${'x'.repeat(1000)}`);
  assert.equal(long.length, 300);
  assert.equal(extractGitReason(`fatal: ${'y'.repeat(50)}`, 10), 'y'.repeat(10));
});

void test('removeWorktree removes a registered worktree and its directory', () => {
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

void test('removeWorktree returns false (without throwing) and leaves the directory when the worktree is locked', () => {
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

void test('deleteBranch deletes an existing, non-checked-out branch', () => {
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

void test('deleteBranch returns false (without throwing) for a nonexistent branch', () => {
  const repo = makeRepo('delbranch-missing', 'main');
  try {
    const ok = deleteBranch(repo, 'does-not-exist');
    assert.equal(ok, false);
  } finally {
    cleanup(repo);
  }
});

void test('pruneWorktrees drops the registration of a hand-deleted worktree so its branch can be deleted', () => {
  // TASK-0217: a worktree directory removed by hand leaves a stale registration;
  // until pruned, `git branch -D` refuses the branch ("used by worktree").
  const repo = makeRepo('prunewt', 'main');
  const worktreePath = path.join(tmpDir, `task217-prune-${Math.random().toString(36).slice(2, 10)}`);
  try {
    assert.equal(createWorktree(repo, worktreePath, 'conductor/prune-agent'), true);
    fs.rmSync(worktreePath, { recursive: true, force: true });

    assert.equal(deleteBranch(repo, 'conductor/prune-agent'), false, 'branch is still held by the stale registration');

    assert.equal(pruneWorktrees(repo), true);
    const worktreeList = spawnSync('git', ['-C', repo, 'worktree', 'list'], { encoding: 'utf8' });
    assert.doesNotMatch(worktreeList.stdout, /prune-agent|task217-prune/);
    assert.equal(deleteBranch(repo, 'conductor/prune-agent'), true);
  } finally {
    cleanup(worktreePath);
    cleanup(repo);
  }
});

void test('pruneWorktrees returns false (without throwing) for a path that is not a git repo', () => {
  fs.mkdirSync(tmpDir, { recursive: true });
  const plain = fs.mkdtempSync(path.join(tmpDir, 'task217-prune-plain-'));
  try {
    assert.equal(pruneWorktrees(path.join(plain, 'nonexistent')), false);
  } finally {
    cleanup(plain);
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

void test('stashCheckpoint stashes a dirty worktree and returns the resolved stash SHA', () => {
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

void test('stashCheckpoint returns null for a clean worktree (nothing to stash)', () => {
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

void test('stashCheckpoint returns null for a path that is not a git work tree', () => {
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

void test('applyStash re-applies a checkpoint stash and restores the stashed changes', () => {
  const repo = makeRepo('apply-restore', 'main');
  try {
    commitTrackedFile(repo, 'tracked.txt', 'v1\n');
    fs.writeFileSync(path.join(repo, 'tracked.txt'), 'v2 dirty\n');

    // stashCheckpoint stashes the dirty change and leaves the worktree clean,
    // mirroring the pre-dispatch checkpoint the rollback endpoint rolls back to.
    const ref = stashCheckpoint(repo, 1730000000010);
    assert.ok(ref);
    assert.match(ref, /^[0-9a-f]{40}$/);
    assert.equal(fs.readFileSync(path.join(repo, 'tracked.txt'), 'utf8'), 'v1\n');

    const res = applyStash(repo, ref);
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

void test('applyStash returns ok:false with a detail message for a nonexistent stash ref', () => {
  const repo = makeRepo('apply-miss', 'main');
  try {
    const res = applyStash(repo, 'stash@{99}');
    assert.equal(res.ok, false, 'applying a missing stash ref must fail');
    assert.ok(res.detail.length > 0, 'failure detail should carry git stderr');
  } finally {
    cleanup(repo);
  }
});
