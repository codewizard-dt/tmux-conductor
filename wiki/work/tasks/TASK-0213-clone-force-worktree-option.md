---
id: TASK-0213
aliases: [TASK-0213]
title: "Add a force-worktree option to POST /agents/:id/clone and start the clone's window inside the worktree"
status: pending-uat
created: 2026-09-20
updated: 2026-09-20
depends_on: [TASK-0210, TASK-0212]
blocks: [TASK-0214, TASK-0215, TASK-0216, TASK-0217, TASK-0218]
parallel_safe_with: []
uat: "[[UAT-0213]]"
tags: [worktree, agents, clone, host-server, tmux]
---

# TASK-0213 — Add a force-worktree option to POST /agents/:id/clone and start the clone's window inside the worktree

relates_to::[[worktree-on-any-agent]]
depends_on::[[TASK-0210]]
depends_on::[[TASK-0212]]
blocks::[[TASK-0214]]
blocks::[[TASK-0215]]
blocks::[[TASK-0216]]
blocks::[[TASK-0217]]
blocks::[[TASK-0218]]

> **Roadmap**: ROADMAP-0025 Phase 2, item 1. Research: `raw/research/worktree-on-any-agent/index.md` (Solution B).
> **Collision note**: `host-server/db.ts`, `host-server/git.ts`, `host-server/index.ts` (clone route + `spawnAgentWindow`) and `frontend/src/lib/api.ts`. Sequence after TASK-0210/0212; TASK-0215 and TASK-0217 edit other regions of `index.ts` afterwards.

## Objective

`POST /agents/:id/clone` accepts `{ "forceWorktree": true }` and then always gives the clone its own isolated git worktree + branch (`<repo>-worktrees/<cloneId>`, `conductor/<cloneId>`), **whether or not the source agent has one**, with the clone's tmux window starting inside that worktree. Without the flag, behaviour is unchanged (clone gets a worktree only if the source has one). This fixes the shared-workdir clone hazard (two agents editing one working tree).

## Approach

- **Fail loudly, not best-effort.** `createAgent`'s worktree step is best-effort: on failure it logs a warning and continues without a worktree. For an explicit force request that would silently hand back two agents on one directory. Add `requireWorktree?: boolean` to `createAgent`'s data: when set and the worktree cannot be created (non-git workdir or `tryCreateWorktree` failure, reason from TASK-0210, sibling guard from TASK-0212), the freshly inserted `agents` row is deleted (rollback) and a `WorktreeError` is thrown. The route maps it with `worktreeErrorStatus` (400 not-a-repo, 500 git failure) and returns `{ error: reason }`. Preflight `getGitRoot(source.workdir)` first so the common not-a-repo case fails before any row is written.
- **Testable core in db.ts.** Route bodies live in the `index.ts` monolith and are not unit-testable, so move the create half into `cloneAgentRecord(db, source, { forceWorktree }): Agent` (derive name via `deriveCloneName`, `createAgent` with `useWorktree: forceWorktree || Boolean(source.worktreePath)` and `requireWorktree: forceWorktree`). The route becomes: parse flag → `cloneAgentRecord` → spawn window → broadcast.
- **What the clone's worktree is.** A fresh branch off the repo's detected base branch (`detectBaseBranch`), **not** a copy of the source's branch or uncommitted work, even when the source has a worktree (the source's `workdir` is still the original repo root). Document this in the route comment and in TASK-0214's menu copy.
- **Discovered gap: windows never start in the worktree.** `spawnAgentWindow` (`host-server/index.ts` ~284) runs `tmux new-window -c agent.workdir`, and no caller passes the worktree; `scripts/conductor.sh`/`spawn.sh` do the same. So today a worktree-backed agent's pane starts in the *source* repo while the dashboard diffs/stashes/checkpoints the worktree. The research doc assumed the window starts in the worktree; reading the code shows it does not. Without fixing this, "Clone into new worktree" would create the worktree and then run the clone in the shared directory anyway. Fix here: pane cwd = `agentPaneCwd(agent)`, i.e. the worktree (plus the same relative sub-path when `workdir` is a subdirectory of the git root, mirroring TASK-0212's subdirectory case) when `worktreePath` exists on disk, else `workdir`. This also changes `POST /agents` (`useWorktree`), project spawn, and the `POST /agents/:id/window` respawn for existing worktree agents: their next window start lands in the worktree, which is what the diff/checkpoint features already assume. **Flag to the user in the task hand-off**; confirm at runtime in TASK-0218.
- **Workdir-keyed transcript fallbacks.** Once the pane cwd is the worktree, any lookup that derives Claude/Codex session files from the *workdir* would look in the wrong project dir: `context.ts` (`encodeWorkdir(workdir)` fallback at ~107; Codex `session_meta.cwd === workdir` at ~258) and `backgroundJobs.ts`/`state.ts` via `resolveTranscriptPath`. The hook sidecar (`logs/state/<agent>.meta.json`) is preferred for Claude and should keep working; audit the fallbacks and route `agentPaneCwd(agent)` to them at the `index.ts` call sites where a worktree agent reaches the fallback (start with `getContextForAgent(...)` and `detectAgentStatusWithBackgroundJobs(...)` calls).
- **Out of scope / follow-up to file if wanted:** the shell bootstrap (`scripts/conductor.sh`, `scripts/spawn.sh`, `scripts/lib/db.sh` agent loader) has the same workdir-only cwd; extend it to `COALESCE(worktree_path, workdir)` in a separate task if the user wants session restarts to enter worktrees too.

## Steps

### 1. git.ts: pane cwd helper  <!-- agent: general-purpose -->

- [x] `host-server/git.ts`: add `export function agentPaneCwd(agent: { workdir: string; worktreePath: string | null }, exists: (p: string) => boolean = fs.existsSync): string` — returns `workdir` when there is no `worktreePath` or it does not exist; otherwise `<worktreePath>/<relative(realpath(gitRoot), realpath(workdir))>` when `workdir` is a strict subdirectory of `getGitRoot(workdir)` and that path exists, else `worktreePath`.
- [x] `host-server/git.test.ts`: no worktree → workdir; worktree at repo root workdir → worktreePath; workdir `<repo>/packages/app` with a real worktree containing `packages/app` → `<worktree>/packages/app`; subpath missing in the worktree → worktree root; stale `worktreePath` (not on disk) → workdir.

### 2. db.ts: requireWorktree + cloneAgentRecord  <!-- agent: general-purpose -->

- [x] `host-server/db.ts#createAgent`: add `requireWorktree?: boolean`. When `useWorktree` and `requireWorktree`: if `getGitRoot` is null throw `WorktreeError('not-git-repo', …)`; if `tryCreateWorktree` fails throw `WorktreeError('git-failed', …)`; in both cases `DELETE FROM agents WHERE id = ?` for the just-inserted row first, and remove a partially created worktree directory best-effort. Non-required behaviour is byte-for-byte unchanged.
- [x] Add `export function cloneAgentRecord(db, source: Agent, opts: { forceWorktree?: boolean } = {}): Agent` wrapping `deriveCloneName` + `createAgent` as described above (carry `workdir`, `launchCmd`, `projectId`, `role`).
- [x] `host-server/db.migration.test.ts` (near the ROADMAP-007 worktree tests): (a) source **without** a worktree + `forceWorktree` → clone has `worktreePath`/`branch` set, `path.dirname(worktreePath) === '<repo>-worktrees'`, `branch === 'conductor/<cloneId>'`, distinct from the source (source still null); (b) source **with** a worktree + `forceWorktree` → a second, distinct worktree, both directories exist, `git worktree list` shows both; (c) no flag + source without worktree → clone has none (regression guard for the existing behaviour); (d) no flag + source with worktree → clone has one (existing behaviour); (e) non-git workdir + flag → throws `WorktreeError` code `not-git-repo` and **no clone row remains** (`listAgents` length unchanged); (f) forced git failure (pre-create `git branch conductor/<nextId>` where `<nextId>` is `MAX(id)+1`, or make the sibling parent unwritable) → throws `git-failed`, no clone row, no stray directory; (g) subdirectory-workdir source + flag lands in the sibling directory (mirrors TASK-0212). Clean up with `cleanupRepoAndWorktrees`.

### 3. Route + spawn cwd  <!-- agent: general-purpose -->

- [x] `host-server/index.ts` `POST /agents/:id/clone` (~1556): type the body `{ forceWorktree?: unknown }` (body optional), `const forceWorktree = req.body?.forceWorktree === true`; call `cloneAgentRecord`; wrap in try/catch mapping `WorktreeError` via `worktreeErrorStatus` and other errors to the existing behaviour (duplicate window name → 400/409 as today; check what `createAgent`'s "already exists" error currently yields and keep it). Update the route's leading comment to describe the flag and the "fresh branch off base, not a copy of the source's work" semantics.
- [x] `spawnAgentWindow` (~284): change the parameter type to `{ name; workdir; worktreePath?: string | null; launchCmd; projectName? }` and use `agentPaneCwd(agent)` for `-c`. All callers already pass a full `Agent` (`POST /agents` ~1099, respawn ~1160, clone ~1576, project spawn ~2344), so no call-site edits are needed beyond type compatibility. Keep `CONDUCTOR_AGENT_NAME`/`STATE_DIR`/`LOG_DIR` env injection untouched.
- [x] Audit the workdir-keyed transcript fallbacks (`context.ts` ~107/~258, `backgroundJobs.ts` ~88, `state.ts` ~523) and, where a worktree agent can reach them, pass `agentPaneCwd(agent)` from the `index.ts` call sites (`getContextForAgent`, `detectAgentStatusWithBackgroundJobs`, the tail/context helpers). Record the call sites changed in the task's step notes. Do not weaken the sidecar-first ordering (see `context.ts` header comment).
  - Step notes: `context.ts`, `backgroundJobs.ts`, `state.ts` untouched (signatures already take a plain `workdir`; sidecar-first ordering intact). Changed `index.ts` call sites to pass `agentPaneCwd(agent)`: `refreshAgentContextCache` (`detectAgentStatusWithBackgroundJobs` + `getContextForAgent`), `pollAndDiff` (`detectAgentStatusWithBackgroundJobs`), the enqueue idle fast-path (`foundAgent`), and the post-spawn SSE blocks of `POST /agents`, window respawn, `PATCH /agents/:id`, clone, and project spawn. Not changed: `usage.ts#extractUsageDeltas` (accepts sidecar-sourced transcripts only, so the derived workdir path is never used). `agentPaneCwd` memoises the git-root sub-path per workdir for 30 s so per-tick calls do not spawn `git rev-parse` each time.

### 4. Frontend API helper  <!-- agent: general-purpose -->

- [x] `frontend/src/lib/api.ts#cloneAgent(agentId, opts?: { forceWorktree?: boolean })`: when `opts?.forceWorktree` is true send `Content-Type: application/json` and `body: JSON.stringify({ forceWorktree: true })`; otherwise send exactly what it sends today (no body). Error handling unchanged (`body.error ?? HTTP <status>`). The menu item is TASK-0214.
- [x] If `frontend/src/lib/api.test.ts` (or equivalent) exists, add cases for both request shapes; otherwise cover it in TASK-0214's component test through a mock.

### 5. Verify  <!-- agent: general-purpose -->

- [x] `cd host-server && npm run typecheck && npm run lint && node --import tsx/esm --test git.test.ts db.migration.test.ts db.test.ts worktreeErrors.test.ts`; `cd frontend && npm run typecheck && npm run lint`.
- [DEFERRED-TO-UAT] Runtime check (deferred to TASK-0218 because it needs a live tmux session): clone a worktree-less agent with `forceWorktree`, confirm `tmux display -p -t <window> '#{pane_current_path}'` is the worktree path and `git -C <workdir> status` is untouched.

- Fix (post-review): the `requireWorktree` rollback also deletes a leaked `conductor/<id>` branch. `git worktree add -b` can create the branch and then fail (e.g. `<repo>-worktrees` is a plain file), and agent ids are reused (no AUTOINCREMENT), so the next agent would collide. `createAgent` records `branchExists` (new helper in `git.ts`) before the attempt and only calls `pruneWorktrees` + `deleteBranch` when the branch did not pre-exist (best-effort, never throws). Covered by two real-git tests in `db.migration.test.ts`: stray branch cleaned and retry succeeds (plain-file sibling dir, no pre-created branch), and a pre-existing branch is left alone.

## Files expected to be touched

`host-server/git.ts`, `host-server/git.test.ts`, `host-server/db.ts`, `host-server/db.migration.test.ts`, `host-server/index.ts` (clone route, `spawnAgentWindow`, transcript-fallback call sites), possibly `host-server/context.ts` / `host-server/backgroundJobs.ts` / `host-server/state.ts` (only if the audit shows a needed signature tweak), `frontend/src/lib/api.ts`.

## Dependencies

- **Depends on** TASK-0210 (`tryCreateWorktree` reason + `WorktreeError`/`worktreeErrorStatus`), TASK-0212 (sibling guard the forced create relies on).
- **Blocks** TASK-0214 (menu item calls the option), TASK-0215 (clone SSE payload only matters once a clone can have a worktree), TASK-0216 (restart-in-worktree needs the spawn cwd fix), TASK-0217 (teardown test clones with the flag), TASK-0218 (UAT).
- Not parallel-safe with anything in the roadmap (touches the shared backend files).
