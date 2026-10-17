---
id: TASK-0210
aliases: [TASK-0210]
title: "Surface the backend's real worktree-creation error reason instead of a generic message"
status: pending-uat
created: 2026-09-20
updated: 2026-09-20
depends_on: [TASK-0209]
blocks: [TASK-0212, TASK-0213, TASK-0218]
parallel_safe_with: []
uat: "[[UAT-0210]]"
tags: [worktree, agents, dashboard, error-handling, git]
---

# TASK-0210 — Surface the backend's real worktree-creation error reason instead of a generic message

relates_to::[[worktree-on-any-agent]]
depends_on::[[TASK-0209]]
blocks::[[TASK-0212]]
blocks::[[TASK-0213]]
blocks::[[TASK-0218]]

> **Roadmap**: ROADMAP-0025 Phase 1, item 2. Research: `raw/research/worktree-on-any-agent/index.md` (Constraints: "`createWorktree` returns only a boolean — user-facing errors are generic").
> **Collision note**: `host-server/git.ts` and `host-server/db.ts` are shared with TASK-0212 and TASK-0213 (both build on the detailed-create function introduced here); `AgentList.tsx` with TASK-0209. Sequence: 0209 → 0210 → 0212 → 0213.

## Objective

When a worktree cannot be created the user sees the actual reason — "workdir is not inside a git repository", "agent already has a worktree", or the real git failure (`a branch named 'conductor/7' already exists`, `invalid reference: main`, permission denied, timeout, git not installed) — not a generic "failed to create git worktree at <path>". The reason is produced in one place in the backend, mapped to a sensible HTTP status, and rendered verbatim once in the dashboard.

## Approach

- **Root cause of the generic message.** `git.ts#createWorktree` returns a bare boolean and discards `spawnSync`'s `stderr`/`error`, so `addWorktreeToAgent` can only throw `failed to create git worktree at <path>`. Add a detailed variant `tryCreateWorktree(): { ok: true } | { ok: false; reason: string }` and keep `createWorktree` as a thin `.ok` wrapper so every existing caller and the boolean contract asserted in `git.test.ts` stay unchanged. `createAgent`'s best-effort path keeps swallowing (and now logs the reason).
- **Reason extraction.** Prefer the last `fatal:`/`error:` line of git's stderr (strip the prefix), cap at 300 characters. Map `spawnSync` errors explicitly: `ENOENT` → "git is not installed or not on PATH"; `ETIMEDOUT` (`r.error?.code`, or `r.signal === 'SIGTERM'`) → "git worktree add timed out after <n> ms".
- **Timeout is part of the bug.** `createWorktree` currently shares the 2 s `SHELL_SYNC_TIMEOUT_MS`, which is short for `git worktree add` on a large checkout and can leave a half-created worktree registered. Give worktree creation its own `WORKTREE_ADD_TIMEOUT_MS` (env, default 15 000) and, on timeout, best-effort `git worktree remove --force` + `git worktree prune` before returning the reason.
- **Typed errors instead of message regexes.** The route currently maps status by regex on the end of the message (`/already has a worktree$/`), which breaks the moment a message gains a suffix. Introduce `host-server/worktreeErrors.ts` with `class WorktreeError extends Error { code: 'not-found' | 'already-has-worktree' | 'not-git-repo' | 'git-failed' }` and a pure `worktreeErrorStatus(code): number` (404 / 409 / 400 / 500). `addWorktreeToAgent` throws `WorktreeError`; the route maps via `worktreeErrorStatus`. Messages for the three existing preconditions are unchanged so the existing `assert.throws(..., /already has a worktree/)` tests keep passing.
- **Frontend: one place, verbatim.** `api.ts#createWorktreeForAgent` already throws `body.error`; keep that, and turn a network-level failure (no JSON body, `TypeError: Failed to fetch`) into "Could not reach the host-server". After TASK-0209 the error is in the shared banner; remove the duplicate `{worktreeError && …}` span from the Details tab Worktree row so the text is not shown twice. Long git messages wrap (`break-words`).

## Steps

### 1. git.ts: detailed create with a reason  <!-- agent: general-purpose -->
<!-- Updated: 2026-09-20 step 1 done; also added exported extractGitReason + GIT_REASON_MAX_LEN helpers (cap tested via the helper) -->


- [x] `host-server/git.ts`: add `export type WorktreeCreateResult = { ok: true } | { ok: false; reason: string }`, `WORKTREE_ADD_TIMEOUT_MS = Number(process.env['WORKTREE_ADD_TIMEOUT_MS'] ?? '15000')`, and `export function tryCreateWorktree(gitRoot, worktreePath, branch): WorktreeCreateResult` (same `git -C <gitRoot> worktree add <path> -b <branch> <baseRef>` invocation; reason extraction and ENOENT/ETIMEDOUT mapping as above; cleanup on timeout).
- [x] Re-implement `createWorktree(...)` as `return tryCreateWorktree(...).ok`.
- [x] `host-server/git.test.ts`: (a) `tryCreateWorktree` on a branch that already exists returns `{ ok: false }` with a reason matching `/already exists/`; (b) an invalid base (repo with no commits, so `detectBaseBranch` fallback `main` is not a valid ref) returns a reason matching `/invalid reference|not a valid|unknown revision/i` (assert on a stable substring, not the whole message); (c) success returns `{ ok: true }`; (d) `createWorktree` still returns the same booleans as before (existing tests untouched); (e) reason is capped at 300 chars.

### 2. Typed worktree errors  <!-- agent: general-purpose -->

- [x] Create `host-server/worktreeErrors.ts` exporting `WorktreeErrorCode`, `WorktreeError`, and `worktreeErrorStatus(code)`; add `host-server/worktreeErrors.test.ts` asserting the four code → status mappings (404/409/400/500) and that `error.message` is preserved.
- [x] `host-server/db.ts#addWorktreeToAgent`: throw `new WorktreeError('not-found', …)`, `('already-has-worktree', …)`, `('not-git-repo', …)` with the existing message text, and for a failed create use `tryCreateWorktree` and throw `new WorktreeError('git-failed', \`failed to create git worktree at ${worktreePath}: ${result.reason}\`)`.
- [x] `host-server/db.ts#createAgent` (best-effort path, ~line 667): switch to `tryCreateWorktree` and include `result.reason` in the existing `console.warn`; behaviour otherwise unchanged (still continues without a worktree).
- [x] `host-server/db.migration.test.ts` (next to the existing `addWorktreeToAgent` tests ~589–616): create a repo via `makeRepo`, create the agent, pre-create `git branch conductor/<id>` in the repo, call `addWorktreeToAgent` and assert it throws a `WorktreeError` with `code === 'git-failed'` and a message containing `already exists`; assert the three existing preconditions throw the matching `code`. Clean up with `cleanupRepoAndWorktrees`.

### 3. Route: map by code  <!-- agent: general-purpose -->

- [x] `host-server/index.ts` `POST /agents/:id/worktree` (~1193–1213): replace the message-regex chain with `err instanceof WorktreeError ? worktreeErrorStatus(err.code) : 500`, replying `{ error: err.message }`. Keep the "no SSE broadcast here" comment updated by TASK-0211 in mind (do not edit the success path in this task).

### 4. Frontend: render the reason once  <!-- agent: general-purpose -->
<!-- Updated: 2026-09-20 step 4 done; duplicate Details-row span was already removed by TASK-0209; TypeError conversion tested in new frontend/src/lib/api.test.ts -->


- [x] `frontend/src/lib/api.ts#createWorktreeForAgent`: keep `body.error ?? HTTP <status>`; wrap the `apiFetch` call so a thrown `TypeError` becomes `new Error('Could not reach the host-server')`.
- [x] `frontend/src/components/AgentList.tsx`: remove the `{worktreeError && <span …>}` from the Details Worktree row (~955) now that the banner (TASK-0209) carries it; give the banner text `break-words`.
- [x] `frontend/src/components/AgentList.test.tsx`: mock `createWorktreeForAgent` rejecting with (i) `agent 7 workdir is not inside a git repository`, (ii) `failed to create git worktree at /x/y: a branch named 'conductor/7' already exists`; assert each string appears exactly once in the document (banner only, no duplicate in the Details row) and that a `TypeError` reject shows the host-server-unreachable message.

- [x] (Added from TASK-0209 UAT generation; done: description now `text-muted` (5.10:1 light / 5.79:1 dark), opacity moved to the label span via `group-disabled:opacity-40`) `frontend/src/components/AgentActionsMenu.tsx`: the disabled "Create worktree" item's reason line (`description` span, class `text-muted-2` inside a button with `disabled:opacity-40`) has ~1.4:1 contrast in light theme vs the 4.5:1 text bar. Do not apply the disabled opacity to the description span and use a token that meets 4.5:1; add/adjust a test in `AgentActionsMenu.test.tsx` if practical.

### 5. Verify  <!-- agent: general-purpose -->
<!-- Updated: 2026-09-20 step 5 done. Touched code is clean (host-server typecheck pass, 64/64 tests; frontend lint pass, 197/197 tests). Remaining repo-wide typecheck/lint errors are unrelated in-flight work: frontend linkedAgent/linkedBg fixtures in AgentList.test.tsx + BackgroundProcessesTab.test.tsx (TASK-0197 stage), host-server no-floating-promises in bgOutput/bgRestart/state tests. -->


- [x] `cd host-server && npm run typecheck && npm run lint && node --import tsx/esm --test git.test.ts worktreeErrors.test.ts db.migration.test.ts`; `cd frontend && npm run typecheck && npm run lint && npx vitest run src/components/AgentList.test.tsx`.
- [x] [DEFERRED-TO-UAT] Manual (deferred to TASK-0218): with a pre-existing `conductor/<id>` branch, click Create worktree and read the real git message in the banner.

## Files expected to be touched

`host-server/git.ts`, `host-server/git.test.ts`, `host-server/worktreeErrors.ts` (new), `host-server/worktreeErrors.test.ts` (new), `host-server/db.ts`, `host-server/db.migration.test.ts`, `host-server/index.ts` (route handler only), `frontend/src/lib/api.ts`, `frontend/src/components/AgentList.tsx`, `frontend/src/components/AgentList.test.tsx`.

## Dependencies

- **Depends on** TASK-0209 (the menu path is where the error must be visible; both edit `AgentList.tsx`'s worktree handler/banner).
- **Blocks** TASK-0212 (the sibling-path guard returns its refusal through `tryCreateWorktree`/`WorktreeError`), TASK-0213 (force-worktree clone must fail loudly with this reason instead of silently continuing), TASK-0218 (UAT).
- Not parallel-safe with TASK-0211 (both edit `frontend/src/components/AgentList.tsx` and `host-server/index.ts`); sequence them.
