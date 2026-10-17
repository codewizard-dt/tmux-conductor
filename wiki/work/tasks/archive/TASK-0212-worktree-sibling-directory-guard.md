---
id: TASK-0212
aliases: [TASK-0212]
title: "Guard and test that new worktrees land in a newly created sibling directory of the repo root"
status: done
created: 2026-09-20
updated: 2026-09-20
depends_on: [TASK-0210]
blocks: [TASK-0213, TASK-0218]
parallel_safe_with: [TASK-0211]
uat: "[[UAT-0212]]"
tags: [worktree, git, guard, testing, constraint]
---

# TASK-0212 — Guard and test that new worktrees land in a newly created sibling directory of the repo root

relates_to::[[worktree-on-any-agent]]
depends_on::[[TASK-0210]]
blocks::[[TASK-0213]]
blocks::[[TASK-0218]]

> **Roadmap**: ROADMAP-0025 Phase 1, item 4 (the constraint carried from ROADMAP-007). Research: `raw/research/worktree-on-any-agent/index.md`.
> **Collision note**: `host-server/git.ts` and `host-server/db.ts` are shared with TASK-0209 (cached repo helper), TASK-0210 (`tryCreateWorktree`) and TASK-0213 (clone). Sequence 0209 → 0210 → 0212 → 0213.

## Objective

Every worktree the app creates — `createAgent({ useWorktree })` (Add Agent form, project spawn), `addWorktreeToAgent` (menu / Details button) and the clone path added in TASK-0213 — is created in a **newly created sibling directory of the project root**, `<parent-of-gitRoot>/<repo>-worktrees/<agentId>`, and never nested inside the root. This is enforced by a guard at the single choke point and pinned by tests, including the case where the agent's `workdir` is a subdirectory of the git root, so the source repo's working tree stays clean (no untracked/embedded-repo content in `git status`, no tools like Serena walking into worktrees).

## Approach

- **Reading of "newly created sibling directory" (decided, per the roadmap Notes' open question).** Taken as "created on demand as a sibling of the project root, outside it" — i.e. today's `<repo>-worktrees/<id>` layout, with the `<repo>-worktrees` directory created by `git worktree add` when it does not yet exist. A distinct sibling per worktree (`<parent>/<repo>-<branch>`) was considered and rejected: it would change `siblingWorktreePath`'s contract, orphan existing worktrees on teardown fallback (`path.dirname(path.dirname(worktreePath))` in `DELETE /agents/:id` assumes the two-level layout), and buys nothing for the stated constraint. Revisit only if the user says otherwise.
- **The path is already right, the guarantee is not.** `getGitRoot()` returns `git rev-parse --show-toplevel`, so for a workdir that is a subdirectory (`<repo>/packages/app`) `siblingWorktreePath` already builds from the repo top level, not from the workdir. Nothing asserts that, and nothing stops a future change (or an odd `gitRoot` such as `/`) from producing a nested path. Add an explicit guard rather than relying on the layout by accident.
- **Guard placement: inside `tryCreateWorktree` (from TASK-0210).** Every creation path funnels through it, so one check covers all callers including the clone path. Implement `assertWorktreeOutsideRoot(gitRoot, worktreePath): { ok: true } | { ok: false; reason: string }` in `git.ts`: resolve both with `fs.realpathSync` on the deepest existing ancestor (macOS `/tmp` → `/private/tmp`, symlinked parents), then refuse when `path.relative(root, target)` is empty, does not start with `..`, or is absolute-on-different-root. `tryCreateWorktree` calls it before spawning git and returns `{ ok: false, reason: 'refusing to create a worktree inside the repository root (<root>); worktrees must be siblings of the root' }`, which TASK-0210's plumbing turns into a `WorktreeError('git-failed', …)` and a visible message.
- **Legacy nested worktrees are untouched.** The two pre-existing nested worktrees (`worktrees/1`, `worktrees/12`, ROADMAP-007 Notes) predate the rule; the guard only applies to creation, never to teardown/diff/checkpoint reads.
- **Note for TASK-0213 (not done here):** a workdir that is a subdirectory maps to the worktree *root*, not to the equivalent subdirectory inside it. The clone task decides the pane cwd (`<worktree>/<relative subpath>`); this task only guarantees where the worktree itself lives.

## Steps

### 1. Guard in git.ts  <!-- agent: general-purpose -->
<!-- Updated: 2026-09-20 -->


- [x] `host-server/git.ts`: add `export function assertWorktreeOutsideRoot(gitRoot: string, worktreePath: string): WorktreeCreateResult` (type from TASK-0210) using `fs.realpathSync.native` on the deepest existing ancestor of each path and `path.relative`; treat an empty relative path, a relative path not starting with `..`, and a `gitRoot` whose `path.dirname` equals itself (filesystem root) as failures.
- [x] In `tryCreateWorktree`, call the guard first and short-circuit with its reason before invoking `git worktree add`.
- [x] Export a small `siblingWorktreeDir(gitRoot): string` (the `<parent>/<repo>-worktrees` directory) reused by `siblingWorktreePath` and by the tests, so the layout lives in one place.

### 2. Unit tests in git.test.ts  <!-- agent: general-purpose -->
<!-- Updated: 2026-09-20 -->


- [x] `assertWorktreeOutsideRoot`: sibling path → `{ ok: true }`; a path nested one and several levels under the root → refused with a reason mentioning "inside the repository root"; the root itself → refused; `gitRoot = '/'` → refused; a symlinked parent whose real path is inside the root → refused (create a symlink in `tmpDir`, skip the case on platforms where `fs.symlinkSync` fails).
- [x] `tryCreateWorktree` given a nested target returns `{ ok: false }`, does not invoke git (assert the path was not created and `git worktree list` is unchanged).
- [x] `siblingWorktreePath('/a/b/repo', 7)` equals `/a/b/repo-worktrees/7` (pure, no git).

### 3. Integration tests in db.migration.test.ts  <!-- agent: general-purpose -->
<!-- Updated: 2026-09-20 -->


Place next to the existing ROADMAP-007 worktree tests (~568–616), reusing `makeRepo` and `cleanupRepoAndWorktrees`.

- [x] **Subdirectory workdir, retroactive path:** `makeRepo`, `mkdir <repo>/packages/app`, `createAgent({ workdir: '<repo>/packages/app' })`, `addWorktreeToAgent` → assert `worktreePath === path.join(realParent, '<repo>-worktrees', String(id))` (use `fs.realpathSync` for `realParent`), that it is not equal to or under `<repo>` (`path.relative(repo, worktreePath).startsWith('..')`), and that `<repo>-worktrees` did **not** exist before the call and does afterwards ("newly created").
- [x] **Subdirectory workdir, create-time path:** same assertions via `createAgent({ useWorktree: true, workdir: '<repo>/packages/app' })`.
- [x] **Source tree stays clean:** after either creation `git -C <repo> status --porcelain` is empty (no untracked worktree directory inside the repo).
- [x] (skipped per the bullet's own fallback: `db.ts` calls `siblingWorktreePath` directly, no seam to force a nested target; reason noted in the test file header, refusal covered in git.test.ts) **Guard is reachable end to end:** stub `siblingWorktreePath` is not injectable, so cover the refusal through `tryCreateWorktree` (step 2) and assert here only that a `git-failed` `WorktreeError` message from TASK-0210 propagates for a forced-nested target if a seam exists; otherwise skip this bullet and note why in the test file header.

### 4. Verify  <!-- agent: general-purpose -->
<!-- Updated: 2026-09-20 -->


- [x] (git.ts / git.test.ts clean on typecheck + lint; all worktree tests pass; the only failures are in unrelated TASK-0198 work in the shared db.migration.test.ts / db.ts: `bgHasLinkedAgentColumn` undefined at db.migration.test.ts:1547 and the TASK-125 v8 fixture failing against the v12 bg_processes migration) `cd host-server && npm run typecheck && npm run lint && node --import tsx/esm --test git.test.ts db.migration.test.ts`. Existing `createWorktree`/`removeWorktree` tests and the `path.dirname(worktreePath) === \`${repo}-worktrees\`` assertion (~579) must still pass unchanged.

## Files expected to be touched

`host-server/git.ts`, `host-server/git.test.ts`, `host-server/db.migration.test.ts`. (`host-server/db.ts` only if a seam is needed for the optional end-to-end bullet; otherwise untouched.)

## Dependencies

- **Depends on** TASK-0210 (the guard lives in `tryCreateWorktree` and reports through its result type / `WorktreeError`).
- **Blocks** TASK-0213 (the clone path relies on this guard and adds a clone-specific sibling assertion), TASK-0218 (UAT).
- Parallel-safe with TASK-0211 (`agentDiff.ts`/`index.ts`/`AgentList.tsx`).
