import * as path from 'path';
import { deleteBranch, getGitRoot, pruneWorktrees, removeWorktree } from './git.ts';

export interface WorktreeTeardownResult {
  removedWorktree: boolean;
  deletedBranch: boolean;
}

/**
 * TASK-063 / TASK-0217: best-effort teardown of an agent's git worktree and
 * its `conductor/<id>` branch, called by `DELETE /agents/:id`.
 *
 * Never throws and never blocks the caller's DB delete — every git failure is
 * logged with `console.warn` and reflected in the returned flags. Agents
 * without a `worktreePath` (non-git workdirs, or never given a worktree) are
 * skipped silently.
 *
 * If the worktree directory was already removed by hand, `git worktree remove`
 * fails and git still holds the registration, which makes `git branch -D`
 * refuse the branch ("used by worktree"). In that case the stale registration
 * is pruned before the branch delete so neither the branch nor the path leaks.
 */
export function teardownAgentWorktree(entry: {
  id: number;
  workdir: string;
  worktreePath: string | null;
  branch: string | null;
}): WorktreeTeardownResult {
  const result: WorktreeTeardownResult = { removedWorktree: false, deletedBranch: false };
  if (!entry.worktreePath) return result;

  try {
    const gitRoot = getGitRoot(entry.workdir) ?? path.dirname(path.dirname(entry.worktreePath));
    result.removedWorktree = removeWorktree(gitRoot, entry.worktreePath);
    if (!result.removedWorktree) {
      console.warn(`[conductor] DELETE /agents/${String(entry.id)}: git worktree remove failed for ${entry.worktreePath}`);
      pruneWorktrees(gitRoot);
    }
    if (entry.branch) {
      result.deletedBranch = deleteBranch(gitRoot, entry.branch);
      if (!result.deletedBranch) {
        console.warn(`[conductor] DELETE /agents/${String(entry.id)}: git branch -D failed for ${entry.branch}`);
      }
    }
  } catch (err) {
    console.warn(`[conductor] DELETE /agents/${String(entry.id)}: worktree cleanup threw`, err);
  }
  return result;
}
