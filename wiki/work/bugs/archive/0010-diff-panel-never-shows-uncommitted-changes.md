---
id: BUG-0010
aliases: [BUG-0010]
title: "Diff panel never reflects uncommitted work — including what a checkpoint rollback restores — because it diffs committed history only"
status: closed
severity: high
priority: "—"
created: 2026-09-02
updated: 2026-09-03
reporter: David Taylor
assignee: "—"
tags: "—"
linked_task: "[[TASK-071]]"
---

# BUG-0010 — Diff panel never reflects uncommitted work — including what a checkpoint rollback restores — because it diffs committed history only

## Environment

- OS: macOS (Darwin 25.3.0)
- Runtime: host-server (Fastify, `GET /agents/:id/diff`, `host-server/index.ts`) + frontend (`DiffPanel.tsx`, `CheckpointList.tsx`)
- App: tmux-conductor dashboard
- Config: default `conductor.conf`, worktree-backed fixture agent (`useWorktree: true`, branch `conductor/15`, base branch `main`)

## Steps to Reproduce

1. Create a worktree-backed agent (non-null `worktreePath`, a real branch off the base branch).
2. Make uncommitted changes in the agent's worktree (any tracked file), without committing.
3. Dispatch a task to the agent, or otherwise trigger `stashCheckpoint()` (the TASK-068 pre-dispatch checkpoint), so the uncommitted changes are stashed and recorded as a checkpoint with a real `stashRef`.
4. Open the agent's detail modal, expand "Checkpoints", click "Rollback" on the checkpoint, confirm.
5. Observe: `POST /agents/:id/rollback` succeeds (200), the checkpoint list and diff panel both auto-refetch (`conductor:diff-refresh` fires correctly — this part works).
6. Open/observe the "Changes" (diff) panel.

Reproduced live 2026-09-02 against a real worktree-backed fixture agent (id 15, branch `conductor/15`) while verifying UAT-071 (TASK-071, checkpoint UI): a genuine checkpoint was taken via the host-server's real dispatch flow (`stashRef: bc9da1f7e480fa8792e085358a466deb77a25985`), and a genuine rollback succeeded (`POST /agents/15/rollback` → 200).

## Expected Behavior

After a rollback re-applies uncommitted content to the worktree, the Diff panel should show that content — this is the entire point of the checkpoint/rollback + diff-panel combination (per TASK-071's own UAT-UI-004 spec: "the Diff panel also re-fetches... and its content reflects the worktree state after the stash was reapplied").

## Actual Behavior

The Diff panel rendered "No changes yet" even though the worktree genuinely had 3 modified files after the rollback. Direct verification:
- `git -C <worktree> diff main..HEAD --stat` → empty (0 files) — no commits diverge from `main`.
- `git -C <worktree> diff --stat` (working tree vs. index) → `.gitignore | 2 ++`, `CLAUDE.md | 5 +++++`, `README.md | 1 +`, 3 files changed, 8 insertions.
- `GET /agents/15/diff` → `{"diff":"","base":"main","truncated":false}`.

Root cause: `GET /agents/:id/diff` (`host-server/index.ts`, ~line 1487, from TASK-064) runs `git diff <base-branch>..HEAD` — a pure commit-to-commit comparison. It never sees uncommitted content, by design of that git command. The entire checkpoint/rollback feature (TASK-067–071) operates exclusively on uncommitted working-tree state via `git stash push`/`git stash apply`. These two features share no observable overlap: nothing checkpoint/rollback ever touches can appear in a `base..HEAD` diff, because that comparison only sees commits, never the working tree.

Impact: for any agent that hasn't committed its work — the normal case for an in-progress task — the Diff panel will **always** show "No changes yet" regardless of how much uncommitted work exists or how many checkpoints/rollbacks occur. The panel's stated purpose ("review changes inline") silently fails to show the one thing checkpoint/rollback users most need to see: what a rollback just changed in their working tree.

**Not part of this bug** (already confirmed working correctly): the `conductor:diff-refresh` wiring itself — a fresh `GET /agents/:id/diff` request does fire automatically right after a successful rollback, with no user action needed. The bug is purely that the endpoint's git comparison basis excludes the content that matters.

## Reproducibility

- **Frequency**: always (deterministic — `base..HEAD` can never include uncommitted content, for any agent, any checkpoint, any rollback)
- **First seen**: 2026-09-02
- **Last seen**: 2026-09-02

## Root Cause Analysis

Confirmed exactly as filed. `GET /agents/:id/diff` (`host-server/index.ts`, the `spawnSync('git', ['-C', workdir, 'diff', ...])` call) used `${base}..HEAD` as its diff argument — a two-ref form that git resolves purely commit-tree-to-commit-tree, with no path from either ref to the process's actual working directory. `git diff A..B` is defined identically to `git diff A B`: it never reads the working tree at all, regardless of what's staged or unstaged there. Since `checkpoint`/`rollback` (TASK-067–071) operate entirely via `git stash push`/`git stash apply` against the working tree, and never create commits, there was structurally no git command that could make the two features' state visible to each other — this was a comparison-basis defect, not a timing/wiring bug (the `conductor:diff-refresh` refetch trigger, `base` detection, and `worktreePath` resolution were all already correct).

## Resolution

Changed the single `spawnSync` call's diff argument from `` `${base}..HEAD` `` to `base` (i.e. `git diff <base-branch>`, no second ref). `git diff <ref>` (one ref only) compares that ref's tree against the *current working tree* (index + unstaged changes combined), so it now captures both any commits the agent's branch has made since diverging from `<base>` **and** any currently uncommitted changes, in one diff — exactly the semantics `DiffPanel`'s "review changes inline" purpose needs, and what `UAT-071`'s UAT-UI-004 case expected all along.

Verified live end-to-end 2026-09-02 against a fresh worktree-backed fixture agent: made real uncommitted changes to two tracked files, confirmed `git diff --stat` showed them while `git diff main..HEAD --stat` stayed empty (reproducing the original bug's exact evidence), then re-hit `GET /agents/:id/diff` after the fix landed and confirmed it returned the full 1896-byte diff for both files. Also confirmed live in the actual browser dashboard (Playwright screenshot): the "Changes" panel rendered both files' colour-coded diffs correctly, including the exact `## Role: generic` addition to `CLAUDE.md` and the marker line added to `README.md`.

Verification: `cd host-server && npx tsc --noEmit` clean (zero errors outside a pre-existing, unrelated typing issue in `capturePerfBaseline.test.ts` — confirmed not touched by or related to this change); `npm test` 109/109 pass, no regressions. `tsx watch` picked up the change and cleanly restarted the live host-server process; the fix is live in the running dev server, not just on disk.

### Regression test

Added `scripts/verify-diff-endpoint-worktree-and-uncommitted.sh` (shared with [[BUG-0004]] — same endpoint, one fixture proves both): boots a real host-server on a scratch port against a scratch DB, seeds a worktree-backed agent with an *uncommitted* change marker in `worktreePath`, and asserts `GET /api/agents/:id/diff` includes it. Confirmed meaningful by temporarily reinstating the `${base}..HEAD` two-ref form and re-running — failed with an empty diff (`{"diff":"","base":"main","truncated":false}`), reproducing this bug's exact original evidence. Restored `git diff <base>`, re-ran — passed. `npx tsc --noEmit`, `npx eslint .`, `npm test` (109/109) all clean.

Closing per the lifecycle gate now that a genuine regression test exists, matching [[BUG-0004]] and [[BUG-0009]]'s precedent of building a self-contained test rather than waiting on an in-process Fastify harness.

## Related

> [[BUG-0004]] — same endpoint, different defect (wrong directory: `workdir` vs `worktreePath`, already fixed) — that fix is unrelated to and does not resolve this issue.
