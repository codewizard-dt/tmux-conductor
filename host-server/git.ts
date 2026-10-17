// Shared git helpers for the host-server, extracted per TASK-065.
// Base-branch detection order: origin/HEAD → common names (main, master,
// develop) → fallback 'main'. All shell-outs use `git -C <dir>` (never cwd)
// with a bounded timeout, mirroring the spawnSync style in index.ts.

import { spawnSync } from 'child_process';
import * as fs from 'fs';
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

/** How long a cached `isInGitRepoCached` answer stays valid. */
const GIT_REPO_CACHE_TTL_MS = 30_000;

const gitRepoCache = new Map<string, { value: boolean; at: number }>();

/**
 * Cached "is `workdir` inside a git repo" signal for the status payload, which
 * is rebuilt every couple of seconds per agent — a spawnSync per agent per poll
 * would be wasteful. Delegates to `getGitRoot(workdir) !== null` and memoises
 * the result per workdir for 30 s. `now` is injectable so tests do not depend
 * on wall time.
 */
export function isInGitRepoCached(workdir: string, now: number = Date.now()): boolean {
  const hit = gitRepoCache.get(workdir);
  if (hit && now - hit.at < GIT_REPO_CACHE_TTL_MS) return hit.value;
  const value = getGitRoot(workdir) !== null;
  gitRepoCache.set(workdir, { value, at: now });
  return value;
}

/** Test-only: drop every cached `isInGitRepoCached` entry. */
export function __resetGitRepoCacheForTests(): void {
  gitRepoCache.clear();
  paneSubpathCache.clear();
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
  return path.join(siblingWorktreeDir(gitRoot), String(agentId));
}

/**
 * The directory that holds every worktree of `gitRoot`:
 * `<parent-of-gitRoot>/<gitRoot-basename>-worktrees`. Kept in one place so the
 * layout used by `siblingWorktreePath` and the tests cannot drift apart.
 */
export function siblingWorktreeDir(gitRoot: string): string {
  return path.join(path.dirname(gitRoot), `${path.basename(gitRoot)}-worktrees`);
}

/**
 * Directory an agent's tmux pane should start (and, for workdir-keyed
 * transcript lookups, live) in. Without a worktree — or when the recorded
 * `worktreePath` is gone from disk — that is the agent's `workdir`. With a
 * worktree it is the worktree, plus the same relative sub-path when `workdir`
 * is a strict subdirectory of its git root (the worktree mirrors the whole
 * repo, so `<root>/packages/app` maps to `<worktree>/packages/app`); if that
 * sub-path does not exist in the worktree the worktree root is used. `exists`
 * is injectable so tests need not touch the filesystem for the stale case.
 */
export function agentPaneCwd(
  agent: { workdir: string; worktreePath: string | null },
  exists: (p: string) => boolean = fs.existsSync,
  now: number = Date.now(),
): string {
  const { workdir, worktreePath } = agent;
  if (!worktreePath || !exists(worktreePath)) return workdir;
  const rel = workdirRelativeToGitRootCached(workdir, now);
  if (!rel) return worktreePath;
  const sub = path.join(worktreePath, rel);
  return exists(sub) ? sub : worktreePath;
}

/** How long a cached workdir → sub-path answer stays valid (the poll loops call `agentPaneCwd` every tick). */
const PANE_SUBPATH_CACHE_TTL_MS = 30_000;

const paneSubpathCache = new Map<string, { rel: string | null; at: number }>();

/**
 * `workdir` relative to its git root when it is a strict subdirectory, else
 * `null` (workdir IS the root, is not in a repo, or cannot be resolved).
 * Memoised per workdir because it costs a `git rev-parse` spawn.
 */
function workdirRelativeToGitRootCached(workdir: string, now: number): string | null {
  const hit = paneSubpathCache.get(workdir);
  if (hit && now - hit.at < PANE_SUBPATH_CACHE_TTL_MS) return hit.rel;
  let rel: string | null = null;
  const gitRoot = getGitRoot(workdir);
  if (gitRoot) {
    try {
      const r = path.relative(fs.realpathSync.native(gitRoot), fs.realpathSync.native(workdir));
      if (r !== '' && r !== '..' && !r.startsWith(`..${path.sep}`) && !path.isAbsolute(r)) rel = r;
    } catch {
      rel = null;
    }
  }
  paneSubpathCache.set(workdir, { rel, at: now });
  return rel;
}

/**
 * Resolve `p` to an absolute real path even when it does not exist yet: the
 * deepest existing ancestor is passed through `fs.realpathSync.native` (so
 * symlinked parents and macOS `/tmp` -> `/private/tmp` collapse), then the
 * non-existent remainder is re-appended verbatim.
 */
function realpathThroughExistingAncestor(p: string): string {
  const abs = path.resolve(p);
  const remainder: string[] = [];
  let current = abs;
  for (;;) {
    try {
      return path.join(fs.realpathSync.native(current), ...remainder);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return abs;
      remainder.unshift(path.basename(current));
      current = parent;
    }
  }
}

/**
 * Guard: a new worktree must live OUTSIDE the repository root (a sibling, see
 * `siblingWorktreePath`), never at or under it. Both paths are resolved through
 * their deepest existing ancestor so a symlinked parent whose real path is
 * inside the root is still caught. Also refuses a filesystem-root `gitRoot`
 * (its "parent" is itself, so no sibling can exist). A target on a different
 * root/drive is not inside the repo and is allowed.
 */
export function assertWorktreeOutsideRoot(
  gitRoot: string,
  worktreePath: string,
): WorktreeCreateResult {
  const realRoot = realpathThroughExistingAncestor(gitRoot);
  const refusal: WorktreeCreateResult = {
    ok: false,
    reason: `refusing to create a worktree inside the repository root (${gitRoot}); worktrees must be siblings of the root`,
  };
  if (path.dirname(realRoot) === realRoot) return refusal;
  const rel = path.relative(realRoot, realpathThroughExistingAncestor(worktreePath));
  if (rel === '') return refusal;
  if (path.isAbsolute(rel)) return { ok: true };
  if (rel === '..' || rel.startsWith(`..${path.sep}`)) return { ok: true };
  return refusal;
}

/** Outcome of `tryCreateWorktree`: success, or a human-readable failure reason. */
export type WorktreeCreateResult = { ok: true } | { ok: false; reason: string };

/** Timeout for `git worktree add` (checkout of a large repo can exceed the 2s shell default). */
export const WORKTREE_ADD_TIMEOUT_MS = Number(process.env['WORKTREE_ADD_TIMEOUT_MS'] ?? '15000');

/** Maximum length of a failure reason surfaced to callers/UI. */
export const GIT_REASON_MAX_LEN = 300;

/**
 * Distil git's stderr into a short human-readable reason. Prefers the last
 * `fatal:` / `error:` line (prefix stripped); falls back to the last non-blank
 * line, then to a generic message. Capped at `maxLen` characters.
 */
export function extractGitReason(stderr: string, maxLen: number = GIT_REASON_MAX_LEN): string {
  const lines = stderr
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  let picked: string | undefined;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i] as string;
    if (/^(fatal|error):/i.test(line)) {
      picked = line.replace(/^(fatal|error):\s*/i, '');
      break;
    }
  }
  if (picked === undefined) picked = lines[lines.length - 1];
  const reason = picked && picked.length > 0 ? picked : 'git worktree add failed';
  return reason.length > maxLen ? reason.slice(0, maxLen) : reason;
}

/**
 * Create a new git worktree at `worktreePath` on a new `branch`, based off
 * the repo's detected base branch (see `detectBaseBranch`), reporting *why* it
 * failed. Never throws. On timeout, best-effort removes the half-created
 * worktree and prunes registrations before returning the reason.
 */
export function tryCreateWorktree(
  gitRoot: string,
  worktreePath: string,
  branch: string,
): WorktreeCreateResult {
  const guard = assertWorktreeOutsideRoot(gitRoot, worktreePath);
  if (!guard.ok) return guard;
  const baseRef = detectBaseBranch(gitRoot);
  const r = spawnSync(
    'git',
    ['-C', gitRoot, 'worktree', 'add', worktreePath, '-b', branch, baseRef],
    { encoding: 'utf8', timeout: WORKTREE_ADD_TIMEOUT_MS },
  );
  if (r.status === 0 && !r.error) return { ok: true };

  const code = (r.error as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'ENOENT') return { ok: false, reason: 'git is not installed or not on PATH' };
  if (code === 'ETIMEDOUT' || r.signal === 'SIGTERM') {
    removeWorktree(gitRoot, worktreePath);
    spawnSync('git', ['-C', gitRoot, 'worktree', 'prune'], {
      encoding: 'utf8',
      timeout: SHELL_SYNC_TIMEOUT_MS,
    });
    return { ok: false, reason: `git worktree add timed out after ${String(WORKTREE_ADD_TIMEOUT_MS)} ms` };
  }
  if (r.error) return { ok: false, reason: extractGitReason(r.error.message) };
  return { ok: false, reason: extractGitReason(r.stderr) };
}

/**
 * Create a new git worktree at `worktreePath` on a new `branch`, based off
 * the repo's detected base branch (see `detectBaseBranch`). Returns `false`
 * on any failure (git unavailable, path collision, branch already exists,
 * etc.) rather than throwing — worktree creation is best-effort and callers
 * must not abort agent creation when it fails.
 */
export function createWorktree(gitRoot: string, worktreePath: string, branch: string): boolean {
  return tryCreateWorktree(gitRoot, worktreePath, branch).ok;
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
 * Prune stale worktree registrations (`git worktree prune`) in the repo at
 * `gitRoot`. Needed when a worktree directory was removed by hand: git still
 * lists it, `worktree remove` fails ("not a working tree") and `branch -D`
 * refuses the branch because it is still "used by worktree". Best-effort
 * boolean, same contract as `removeWorktree`.
 */
export function pruneWorktrees(gitRoot: string): boolean {
  const r = spawnSync(
    'git',
    ['-C', gitRoot, 'worktree', 'prune'],
    { encoding: 'utf8', timeout: SHELL_SYNC_TIMEOUT_MS },
  );
  return r.status === 0;
}

/**
 * Force-delete a local branch in the repo at `gitRoot`. Returns `false` on
 * any failure (branch missing, still checked out elsewhere, etc.) rather
 * than throwing — best-effort, same contract as `removeWorktree`.
 */
/**
 * True when a local branch named `branch` exists in the repo at `gitRoot`.
 * Returns `false` on any failure (git unavailable, timeout) rather than
 * throwing — used to tell whether a branch predates a worktree-add attempt.
 */
export function branchExists(gitRoot: string, branch: string): boolean {
  const r = spawnSync(
    'git',
    ['-C', gitRoot, 'show-ref', '--verify', '--quiet', `refs/heads/${branch}`],
    { encoding: 'utf8', timeout: SHELL_SYNC_TIMEOUT_MS },
  );
  return r.status === 0;
}

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
