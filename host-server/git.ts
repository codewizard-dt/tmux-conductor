// Shared git helpers for the host-server, extracted per TASK-065.
// Base-branch detection order: origin/HEAD → common names (main, master,
// develop) → fallback 'main'. All shell-outs use `git -C <dir>` (never cwd)
// with a bounded timeout, mirroring the spawnSync style in index.ts.

import { spawnSync } from 'child_process';
import * as path from 'path';

export const SHELL_SYNC_TIMEOUT_MS = Number(process.env['SHELL_SYNC_TIMEOUT_MS'] ?? '2000');

const COMMON_BASE_BRANCHES = ['main', 'master', 'develop'];

/** True when `dir` is inside a git work tree. */
export function isGitRepo(dir: string): boolean {
  const r = spawnSync('git', ['-C', dir, 'rev-parse', '--is-inside-work-tree'], {
    encoding: 'utf8',
    timeout: SHELL_SYNC_TIMEOUT_MS,
  });
  return r.status === 0 && r.stdout.trim() === 'true';
}

/**
 * Resolve the git root (top-level work tree directory) for `workdir`.
 * Returns `null` on any failure — not a git repo, git not installed, etc. —
 * rather than throwing, so callers can treat "no git root" as a plain value.
 */
export function getGitRoot(workdir: string): string | null {
  const r = spawnSync('git', ['-C', workdir, 'rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
    timeout: SHELL_SYNC_TIMEOUT_MS,
  });
  if (r.status !== 0) return null;
  const gitRoot = r.stdout.trim();
  return gitRoot || null;
}

/** True when `ref` resolves to an existing ref in the repo at `dir`. */
function refExists(dir: string, ref: string): boolean {
  return (
    spawnSync('git', ['-C', dir, 'rev-parse', '--verify', '--quiet', ref], {
      encoding: 'utf8',
      timeout: SHELL_SYNC_TIMEOUT_MS,
    }).status === 0
  );
}

/**
 * Detect the base branch for a worktree:
 * 1. `origin/HEAD` (stripped of the `origin/` prefix), if that local ref exists
 * 2. the first of `main`, `master`, `develop` that exists
 * 3. fallback `'main'`
 */
export function detectBaseBranch(worktreePath: string): string {
  const originHead = spawnSync(
    'git',
    ['-C', worktreePath, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD'],
    { encoding: 'utf8', timeout: SHELL_SYNC_TIMEOUT_MS },
  );
  const originBranch =
    originHead.status === 0 ? originHead.stdout.trim().replace(/^origin\//, '') : '';
  if (originBranch && refExists(worktreePath, originBranch)) return originBranch;

  for (const name of COMMON_BASE_BRANCHES) {
    if (refExists(worktreePath, name)) return name;
  }
  return 'main';
}

/**
 * Path for a new agent worktree, as a SIBLING of `gitRoot` rather than a
 * subdirectory nested inside it. A nested `<gitRoot>/worktrees/<id>` reads to
 * git (and to tools that walk the tree, like Serena) as untracked/embedded-repo
 * content inside the source repo's own working tree; a sibling directory keeps
 * the source repo clean. Result:
 * `<parent-of-gitRoot>/<gitRoot-basename>-worktrees/<agentId>`.
 */
export function siblingWorktreePath(gitRoot: string, agentId: number): string {
  return path.join(path.dirname(gitRoot), `${path.basename(gitRoot)}-worktrees`, String(agentId));
}

/**
 * Create a new git worktree at `worktreePath` on a new `branch`, based off
 * the repo's detected base branch (see `detectBaseBranch`). Returns `false`
 * on any failure (git unavailable, path collision, branch already exists,
 * etc.) rather than throwing — worktree creation is best-effort and callers
 * must not abort agent creation when it fails.
 */
export function createWorktree(gitRoot: string, worktreePath: string, branch: string): boolean {
  const baseRef = detectBaseBranch(gitRoot);
  const r = spawnSync(
    'git',
    ['-C', gitRoot, 'worktree', 'add', worktreePath, '-b', branch, baseRef],
    { encoding: 'utf8', timeout: SHELL_SYNC_TIMEOUT_MS },
  );
  return r.status === 0;
}

/**
 * Remove a git worktree at `worktreePath` from the repo at `gitRoot`.
 * Uses `--force` so uncommitted changes in the worktree don't block removal.
 * Returns `false` on any failure (git unavailable, path already gone, etc.)
 * rather than throwing — worktree teardown is best-effort and callers must
 * not let it block deleting the owning agent.
 */
export function removeWorktree(gitRoot: string, worktreePath: string): boolean {
  const r = spawnSync(
    'git',
    ['-C', gitRoot, 'worktree', 'remove', '--force', worktreePath],
    { encoding: 'utf8', timeout: SHELL_SYNC_TIMEOUT_MS },
  );
  return r.status === 0;
}

/**
 * Force-delete a local branch in the repo at `gitRoot`. Returns `false` on
 * any failure (branch missing, still checked out elsewhere, etc.) rather
 * than throwing — best-effort, same contract as `removeWorktree`.
 */
export function deleteBranch(gitRoot: string, branch: string): boolean {
  const r = spawnSync(
    'git',
    ['-C', gitRoot, 'branch', '-D', branch],
    { encoding: 'utf8', timeout: SHELL_SYNC_TIMEOUT_MS },
  );
  return r.status === 0;
}

/**
 * Take a pre-dispatch checkpoint of `worktreePath`: `git stash push` (keeping
 * the working tree intact is not required — the conductor snapshots then the
 * agent keeps working from the same tree, so we stash and immediately restore
 * via the stash entry staying available for later rollback). Returns the stash
 * commit SHA (a stable, unambiguous ref that survives later stashes, unlike
 * `stash@{N}`) on success, or `null` when there was nothing to stash (clean
 * worktree) or git failed. Best-effort: never throws.
 */
/**
 * Pre-dispatch checkpoint of `worktreePath`: `git stash push -m
 * conductor-checkpoint-<ts>` (per ROADMAP-007 Phase 3). Returns the stash
 * *commit SHA* on success, or `null` when there was nothing to stash (clean
 * worktree) or git failed. We resolve `stash@{0}` to its SHA rather than
 * storing the literal `stash@{N}` name because checkpoints accumulate — each
 * later stash shifts the `stash@{N}` numbering, so only the SHA stays a stable
 * ref that `git stash apply` (the rollback path, TASK-070) can target for an
 * *older* checkpoint. Best-effort: never throws.
 */
export function stashCheckpoint(worktreePath: string, ts: number): string | null {
  const push = spawnSync(
    'git',
    ['-C', worktreePath, 'stash', 'push', '-m', `conductor-checkpoint-${String(ts)}`],
    { encoding: 'utf8', timeout: SHELL_SYNC_TIMEOUT_MS },
  );
  if (push.status !== 0) return null;
  // A clean worktree yields "No local changes to save" and no stash entry.
  if (/No local changes to save/.test(push.stdout)) return null;
  const rev = spawnSync('git', ['-C', worktreePath, 'rev-parse', 'stash@{0}'], {
    encoding: 'utf8',
    timeout: SHELL_SYNC_TIMEOUT_MS,
  });
  if (rev.status !== 0) return null;
  const ref = rev.stdout.trim();
  return ref || null;
}

/**
 * Apply a previously recorded stash (`stashRef`) onto the worktree at
 * `gitDir` — the rollback counterpart to `stashCheckpoint`. Returns
 * `{ ok, detail }` where `ok` is true only when git exits 0; `detail`
 * carries the combined stderr/stdout (trimmed), or the spawn error message
 * when the process could not be launched. Uses the arg-array form so
 * `stashRef` is never interpreted by a shell.
 */
export function applyStash(gitDir: string, stashRef: string): { ok: boolean; detail: string } {
  const res = spawnSync(
    'git',
    ['-C', gitDir, 'stash', 'apply', stashRef],
    { encoding: 'utf8', timeout: SHELL_SYNC_TIMEOUT_MS },
  );
  if (res.error) {
    return { ok: false, detail: res.error.message };
  }
  const detail = `${res.stderr}${res.stdout}`.trim();
  return { ok: res.status === 0, detail };
}
