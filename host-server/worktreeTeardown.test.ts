// TASK-0217: pins the "delete an agent → its worktree and branch are torn down,
// and nobody else's are touched" guarantee against real git repositories, so a
// future change to path/branch derivation or to DELETE /agents/:id cannot
// silently leak worktrees. Scope is the data/git level (cloneAgentRecord →
// real worktree → teardownAgentWorktree → deleteAgent); the HTTP route and the
// tmux window kill are covered by the live UAT.
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'node:url';
import { openDb, createAgent, cloneAgentRecord, deleteAgent, listAgents } from './db.ts';
import { createWorktree } from './git.ts';
import { teardownAgentWorktree } from './worktreeTeardown.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = path.resolve(__dirname, '../tmp');

const GIT_IDENT = ['-c', 'user.email=test@test.local', '-c', 'user.name=Test'];

function git(dir: string, ...args: string[]): string {
  const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}

/** Create a throwaway git repo under ./tmp with one commit on `main`. */
function makeRepo(label: string): string {
  fs.mkdirSync(tmpDir, { recursive: true });
  const rand = Math.random().toString(36).slice(2, 10);
  const dir = fs.mkdtempSync(path.join(tmpDir, `task217-${label}-${rand}-`));
  git(dir, 'init', '-b', 'main');
  git(dir, ...GIT_IDENT, 'commit', '--allow-empty', '-m', 'init');
  return dir;
}

function cleanupRepoAndWorktrees(gitRoot: string): void {
  // Deregister any worktree git still knows about before deleting the trees,
  // so a later test's `git worktree add` never collides.
  spawnSync('git', ['-C', gitRoot, 'worktree', 'list', '--porcelain'], { encoding: 'utf8' }).stdout
    .split('\n\n')
    .forEach((block) => {
      const registered = /^worktree (.+)$/m.exec(block)?.[1];
      if (registered && registered !== gitRoot) {
        spawnSync('git', ['-C', gitRoot, 'worktree', 'remove', '--force', registered], { encoding: 'utf8' });
      }
    });
  fs.rmSync(gitRoot, { recursive: true, force: true });
  fs.rmSync(`${gitRoot}-worktrees`, { recursive: true, force: true });
}

/** Paths git currently has registered as worktrees of `gitRoot` (the main tree included). */
function registeredWorktrees(gitRoot: string): string[] {
  return git(gitRoot, 'worktree', 'list', '--porcelain')
    .split('\n')
    .filter((l) => l.startsWith('worktree '))
    .map((l) => l.slice('worktree '.length));
}

function isRegistered(gitRoot: string, worktreePath: string): boolean {
  const wanted = path.basename(worktreePath);
  return registeredWorktrees(gitRoot).some((p) => path.basename(p) === wanted && path.dirname(p) === path.dirname(worktreePath));
}

function branchExists(gitRoot: string, branch: string): boolean {
  return git(gitRoot, 'branch', '--list', branch).trim() !== '';
}

/** Run `fn` with console.warn captured so expected best-effort warnings don't pollute test output. */
function captureWarnings<T>(fn: () => T): { value: T; warnings: string[] } {
  const original = console.warn;
  const warnings: string[] = [];
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(' '));
  };
  try {
    return { value: fn(), warnings };
  } finally {
    console.warn = original;
  }
}

void test('TASK-0217: deleting a forced-worktree clone of a worktree-less agent removes its worktree, registration and branch, and leaves the source alone', () => {
  const repo = makeRepo('clone-none');
  const db = openDb(':memory:');
  try {
    const source = createAgent(db, { name: 'src', workdir: repo, launchCmd: 'claude' });
    assert.equal(source.worktreePath, null);

    const clone = cloneAgentRecord(db, source, { forceWorktree: true });
    assert.ok(clone.worktreePath);
    assert.equal(clone.branch, `conductor/${String(clone.id)}`);
    const worktreePath = clone.worktreePath;
    const branch = clone.branch;
    assert.ok(fs.existsSync(worktreePath));
    assert.ok(isRegistered(repo, worktreePath));
    assert.ok(branchExists(repo, branch));

    // An unmerged commit plus an uncommitted file: proves `--force` worktree
    // removal and `branch -D` (not `-d`) of an unmerged branch.
    fs.writeFileSync(path.join(worktreePath, 'committed.txt'), 'committed');
    git(worktreePath, 'add', 'committed.txt');
    git(worktreePath, ...GIT_IDENT, 'commit', '-m', 'work in clone');
    fs.writeFileSync(path.join(worktreePath, 'dirty.txt'), 'uncommitted');

    const result = teardownAgentWorktree(clone);
    deleteAgent(db, clone.id);

    assert.deepEqual(result, { removedWorktree: true, deletedBranch: true });
    assert.equal(fs.existsSync(worktreePath), false, 'worktree directory should be gone');
    assert.equal(isRegistered(repo, worktreePath), false, 'git should no longer list the worktree');
    assert.equal(branchExists(repo, branch), false, 'the clone branch should be deleted');

    // The source agent, its workdir and the repo working tree are untouched.
    assert.ok(listAgents(db).some((a) => a.id === source.id), 'source row should survive');
    assert.equal(listAgents(db).some((a) => a.id === clone.id), false, 'clone row should be gone');
    assert.ok(fs.existsSync(source.workdir));
    assert.equal(git(repo, 'status', '--porcelain').trim(), '', 'source repo working tree should be clean');
    assert.ok(branchExists(repo, 'main'));
  } finally {
    db.close();
    cleanupRepoAndWorktrees(repo);
  }
});

void test('TASK-0217: a clone and its worktree-backed source tear down independently of each other', () => {
  const repo = makeRepo('clone-has');
  const db = openDb(':memory:');
  try {
    const source = createAgent(db, { name: 'src', workdir: repo, launchCmd: 'claude', useWorktree: true });
    assert.ok(source.worktreePath);
    assert.ok(source.branch);
    const sourceWorktree = source.worktreePath;
    const sourceBranch = source.branch;

    // Delete the clone first: the source's worktree, registration and branch survive.
    const clone = cloneAgentRecord(db, source, { forceWorktree: true });
    assert.ok(clone.worktreePath);
    assert.ok(clone.branch);
    assert.notEqual(clone.worktreePath, sourceWorktree);
    assert.notEqual(clone.branch, sourceBranch);
    assert.deepEqual(teardownAgentWorktree(clone), { removedWorktree: true, deletedBranch: true });
    deleteAgent(db, clone.id);

    assert.equal(fs.existsSync(clone.worktreePath), false);
    assert.equal(isRegistered(repo, clone.worktreePath), false);
    assert.equal(branchExists(repo, clone.branch), false);
    assert.ok(fs.existsSync(sourceWorktree), 'source worktree directory should survive the clone delete');
    assert.ok(isRegistered(repo, sourceWorktree), 'source worktree should stay registered');
    assert.ok(branchExists(repo, sourceBranch), 'source branch should survive the clone delete');

    // And the reverse: tear the source down while a second clone is alive.
    const clone2 = cloneAgentRecord(db, source, { forceWorktree: true });
    assert.ok(clone2.worktreePath);
    assert.ok(clone2.branch);
    assert.deepEqual(teardownAgentWorktree(source), { removedWorktree: true, deletedBranch: true });
    deleteAgent(db, source.id);

    assert.equal(fs.existsSync(sourceWorktree), false);
    assert.equal(branchExists(repo, sourceBranch), false);
    assert.ok(fs.existsSync(clone2.worktreePath), 'clone worktree directory should survive the source delete');
    assert.ok(isRegistered(repo, clone2.worktreePath), 'clone worktree should stay registered');
    assert.ok(branchExists(repo, clone2.branch), 'clone branch should survive the source delete');
    assert.ok(listAgents(db).some((a) => a.id === clone2.id));
  } finally {
    db.close();
    cleanupRepoAndWorktrees(repo);
  }
});

void test('TASK-0217: teardown after the worktree directory was removed by hand still prunes the registration and deletes the branch', () => {
  const repo = makeRepo('hand-removed');
  const db = openDb(':memory:');
  try {
    const source = createAgent(db, { name: 'src', workdir: repo, launchCmd: 'claude' });
    const clone = cloneAgentRecord(db, source, { forceWorktree: true });
    assert.ok(clone.worktreePath);
    assert.ok(clone.branch);
    const worktreePath = clone.worktreePath;
    const branch = clone.branch;

    fs.rmSync(worktreePath, { recursive: true, force: true });
    assert.ok(isRegistered(repo, worktreePath), 'precondition: git still holds the stale registration');

    // Whether `git worktree remove --force` copes with a missing directory
    // itself depends on the git version, so only the end state is asserted: the
    // stale registration is gone and the branch is deleted either way (the
    // prune fallback covers git versions where remove fails).
    const { value: result, warnings } = captureWarnings(() => teardownAgentWorktree(clone));

    assert.equal(result.deletedBranch, true);
    assert.equal(isRegistered(repo, worktreePath), false, 'stale registration should be pruned');
    assert.equal(branchExists(repo, branch), false, 'branch should be deleted once the registration is pruned');
    assert.equal(warnings.some((w) => w.includes('git branch -D failed')), false);

    // Nothing leaks: the same path/branch can be created again.
    assert.equal(createWorktree(repo, worktreePath, branch), true);
  } finally {
    db.close();
    cleanupRepoAndWorktrees(repo);
  }
});

void test('TASK-0217: when the workdir is gone, teardown falls back to <worktreePath>/../.. as the git root', () => {
  // The fallback is dirname(dirname(worktreePath)), which is the repo root for
  // the legacy in-repo `<root>/worktrees/<id>` layout, so build that layout by hand.
  const repo = makeRepo('root-fallback');
  try {
    const worktreePath = path.join(repo, 'worktrees', '77');
    fs.mkdirSync(path.dirname(worktreePath), { recursive: true });
    git(repo, 'worktree', 'add', '-b', 'conductor/77', worktreePath);
    assert.ok(fs.existsSync(worktreePath));

    const result = teardownAgentWorktree({
      id: 77,
      workdir: `${repo}-does-not-exist`,
      worktreePath,
      branch: 'conductor/77',
    });

    assert.deepEqual(result, { removedWorktree: true, deletedBranch: true });
    assert.equal(fs.existsSync(worktreePath), false);
    assert.equal(isRegistered(repo, worktreePath), false);
    assert.equal(branchExists(repo, 'conductor/77'), false);
  } finally {
    cleanupRepoAndWorktrees(repo);
  }
});

void test('TASK-0217: an agent without a worktree is skipped with no git side effects', () => {
  const repo = makeRepo('no-worktree');
  try {
    // A same-named branch exists but must NOT be touched: no worktreePath means
    // no teardown at all, even if a stray `branch` value is set.
    git(repo, 'branch', 'conductor/5');
    const before = git(repo, 'worktree', 'list', '--porcelain');

    const { value: result, warnings } = captureWarnings(() =>
      teardownAgentWorktree({ id: 5, workdir: repo, worktreePath: null, branch: 'conductor/5' }),
    );

    assert.deepEqual(result, { removedWorktree: false, deletedBranch: false });
    assert.deepEqual(warnings, []);
    assert.equal(git(repo, 'worktree', 'list', '--porcelain'), before);
    assert.ok(branchExists(repo, 'conductor/5'), 'branch must be left alone when there is no worktree');

    const nothing = teardownAgentWorktree({ id: 6, workdir: `${repo}-nope`, worktreePath: null, branch: null });
    assert.deepEqual(nothing, { removedWorktree: false, deletedBranch: false });
  } finally {
    cleanupRepoAndWorktrees(repo);
  }
});

void test('TASK-0217: the DELETE /agents/:id handler delegates to teardownAgentWorktree and has no inline git teardown', () => {
  const src = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8');
  const start = src.indexOf("'/agents/:id', async (req, reply) => {");
  assert.ok(start >= 0, 'expected to find the DELETE /agents/:id handler');
  const preceding = src.slice(Math.max(0, start - 80), start);
  assert.match(preceding, /api\.delete</, 'the located handler should be the DELETE route');

  const end = src.indexOf('\n  });\n', start);
  assert.ok(end > start, 'expected to find the end of the DELETE /agents/:id handler');
  const handler = src.slice(start, end);

  assert.match(handler, /teardownAgentWorktree\(/);
  assert.doesNotMatch(handler, /removeWorktree\(/);
  assert.doesNotMatch(handler, /deleteBranch\(/);
});
