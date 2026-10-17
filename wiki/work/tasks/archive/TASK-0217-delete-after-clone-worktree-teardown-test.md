---
id: TASK-0217
aliases: [TASK-0217]
title: "Cover delete-after-clone worktree and branch teardown with a test"
status: done
created: 2026-09-20
updated: 2026-09-20
depends_on: [TASK-0213]
blocks: [TASK-0218]
parallel_safe_with: [TASK-0214, TASK-0215, TASK-0216]
uat: "[[UAT-0217]]"
tags: [worktree, agents, clone, teardown, testing, host-server]
---

# TASK-0217 — Cover delete-after-clone worktree and branch teardown with a test

relates_to::[[worktree-on-any-agent]]
depends_on::[[TASK-0213]]
blocks::[[TASK-0218]]

> **Roadmap**: ROADMAP-0025 Phase 3, item 2. Research: `raw/research/worktree-on-any-agent/index.md` (Risks: "leaking worktrees on delete… extend UAT to cover delete-after-clone teardown").
> **Collision note**: `host-server/index.ts` `DELETE /agents/:id` region (also touched, elsewhere in the file, by TASK-0213/0215) and a new module. Backend-only, so parallel-safe with TASK-0214/0215/0216 once TASK-0213 has landed.

## Objective

Deleting a clone that was created with a forced worktree removes that clone's worktree directory, its git worktree registration and its `conductor/<cloneId>` branch, and leaves the source agent, the source's worktree/branch (if any) and the source repo's working tree untouched — and the reverse (deleting the source leaves the clone's worktree alone). It is pinned by an automated test against real git repositories, so a future change to path/branch derivation or to the DELETE route cannot silently leak worktrees.

## Approach

- **The teardown lives inline in an untestable route.** `DELETE /agents/:id` (`host-server/index.ts` ~1422–1437) does the best-effort `removeWorktree` + `deleteBranch` inline in the monolith (whose route bodies cannot be `inject`ed). Extract it verbatim into `host-server/worktreeTeardown.ts` — `teardownAgentWorktree(entry): { removedWorktree: boolean; deletedBranch: boolean }` — with the same best-effort contract (never throws, never blocks the DB delete, same `getGitRoot(entry.workdir) ?? path.dirname(path.dirname(entry.worktreePath))` git-root resolution and the same `console.warn` messages). The route calls it. A cheap source-level assertion (the pattern already used in `db.test.ts` ~568 and `sseRolePayloadParity.test.ts`) guards that the route keeps calling the helper.
- **Latent leak the test will expose (fix it here).** `resolveAgentWorktree` heals the *DB* reference when a worktree directory vanishes (manual `rm -rf`), but git still has the registration. Then `git worktree remove` fails ("not a working tree") and `git branch -D` refuses because the branch is still "used by worktree", so the branch leaks and a later `git worktree add` for the same path fails. Add `pruneWorktrees(gitRoot)` (`git worktree prune`) to `git.ts` and call it in the helper when `removeWorktree` returns false, then retry the branch delete. Small, contained, and exactly the "worktree and branch removed" guarantee this task is about.
- **Scope of the test.** It covers the clone flow end to end at the data/git level (`cloneAgentRecord` from TASK-0213 → real worktree → teardown → `deleteAgent`). The HTTP route and tmux window kill are covered by the live UAT in TASK-0218, not here.

## Steps

### 1. Extract the teardown  <!-- agent: general-purpose -->

- [x] `host-server/git.ts`: add `pruneWorktrees(gitRoot: string): boolean` (`git -C <gitRoot> worktree prune`, best-effort boolean, same timeout style as `removeWorktree`); add a `git.test.ts` case (create a worktree, delete its directory with `fs.rmSync`, `pruneWorktrees` returns true and `git worktree list` no longer lists it; then `deleteBranch` succeeds).
- [x] Create `host-server/worktreeTeardown.ts` exporting `teardownAgentWorktree(entry: { id: number; workdir: string; worktreePath: string | null; branch: string | null }): { removedWorktree: boolean; deletedBranch: boolean }`: return `{ false, false }` when `worktreePath` is null; resolve `gitRoot`; `removeWorktree`; if that failed, `pruneWorktrees(gitRoot)`; `deleteBranch` when `branch` is set; wrap everything in try/catch that only warns. Preserve the existing warning strings (`DELETE /agents/<id>: git worktree remove failed for …`, `git branch -D failed for …`, `worktree cleanup threw`).
- [x] `host-server/index.ts` `DELETE /agents/:id`: replace the inline `if (entry.worktreePath) { … }` block with `teardownAgentWorktree(entry)` (import it); leave the tmux kill, `deleteAgent`, state-file/cache cleanup and `agent-removed` broadcast exactly as they are.

### 2. Tests  <!-- agent: general-purpose -->

Create `host-server/worktreeTeardown.test.ts` (node:test, `void test(...)`, real `git` via `spawnSync`, reusing the repo/cleanup helpers pattern from `db.migration.test.ts` — copy the small `makeRepo`/`cleanup` helpers or hoist them into a shared `host-server/testGitRepo.ts` if two files now need them).

- [x] **Clone of a worktree-less agent, then delete the clone:** open a temp DB (`openDb`), create a source agent in a real repo with no worktree, `cloneAgentRecord(db, source, { forceWorktree: true })`, capture `worktreePath`/`branch`; make a commit and an uncommitted file inside the clone's worktree (proves `--force` removal and `branch -D` of an unmerged branch); `teardownAgentWorktree(clone)` then `deleteAgent`. Assert: the worktree directory no longer exists; `git worktree list` has no entry for it; `git branch --list conductor/<cloneId>` is empty; the `<repo>-worktrees` parent may remain; source row still exists, source repo `git status --porcelain` is empty, source `workdir` untouched.
- [x] **Clone of a worktree-backed source, delete the clone:** source created with `useWorktree: true`; forced clone gets a second worktree; tearing down the clone leaves the **source's** worktree directory, registration and `conductor/<sourceId>` branch intact, and vice versa when the source is torn down first (clone's remain).
- [x] **Worktree directory already removed by hand:** `fs.rmSync` the clone's worktree, then teardown → returns without throwing, the stale registration is pruned, and the branch is deleted (this fails before the `pruneWorktrees` step is added). <!-- Note: on git 2.50.1 `worktree remove --force` already copes with a missing directory, so this case passes even without the prune fallback; the fallback is pinned directly by the `pruneWorktrees` case in git.test.ts and is a safety net for other git versions. -->

- [x] **Git-root fallback:** for an entry whose `workdir` no longer exists (`getGitRoot` null) teardown falls back to `path.dirname(path.dirname(worktreePath))` and still removes the worktree.
- [x] **No worktree:** entry with `worktreePath: null` → `{ removedWorktree: false, deletedBranch: false }` and no git invoked (assert no throw and no side effects).
- [x] **Route wiring guard:** read `host-server/index.ts` as text and assert the `DELETE /agents/:id` handler contains `teardownAgentWorktree(` and no longer contains an inline `removeWorktree(` call (mirrors the source-assertion style in `db.test.ts` ~568).

### 3. Verify  <!-- agent: general-purpose -->

- [x] `cd host-server && npm run typecheck && npm run lint && node --import tsx/esm --test worktreeTeardown.test.ts git.test.ts db.migration.test.ts`; confirm no temp repos remain under `./tmp/` (use `./tmp/` for scratch, never `/tmp`, per CLAUDE.md — follow how `git.test.ts` builds `tmpDir`).

<!-- Updated: 2026-09-20 -->

## Files expected to be touched

`host-server/worktreeTeardown.ts` (new), `host-server/worktreeTeardown.test.ts` (new), `host-server/git.ts`, `host-server/git.test.ts`, `host-server/index.ts` (`DELETE /agents/:id` block + import), optionally `host-server/testGitRepo.ts` (new shared test helper).

## Dependencies

- **Depends on** TASK-0213 (`cloneAgentRecord` / forced-worktree clone is what the test exercises).
- **Blocks** TASK-0218 (UAT relies on the teardown guarantee).
- Parallel-safe with TASK-0214, TASK-0215 and TASK-0216 (different files/regions).
