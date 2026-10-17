/**
 * Typed errors for worktree creation (TASK-0210). `addWorktreeToAgent` throws a
 * `WorktreeError` carrying a machine-readable `code`; the HTTP route maps the
 * code to a status via `worktreeErrorStatus` and forwards `error.message` so
 * the dashboard can show the real reason instead of a generic failure.
 */

export type WorktreeErrorCode =
  | 'not-found'
  | 'already-has-worktree'
  | 'not-git-repo'
  | 'git-failed';

export class WorktreeError extends Error {
  code: WorktreeErrorCode;

  constructor(code: WorktreeErrorCode, message: string) {
    super(message);
    this.name = 'WorktreeError';
    this.code = code;
  }
}

/** Map a worktree error code to the HTTP status the route should respond with. */
export function worktreeErrorStatus(code: WorktreeErrorCode): number {
  switch (code) {
    case 'not-found':
      return 404;
    case 'already-has-worktree':
      return 409;
    case 'not-git-repo':
      return 400;
    case 'git-failed':
      return 500;
  }
}
