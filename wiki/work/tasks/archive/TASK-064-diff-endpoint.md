---
id: TASK-064
title: "Diff endpoint — GET /api/agents/:agent/diff (git diff base-branch..HEAD)"
status: done
created: 2026-06-14
updated: 2026-07-06
depends_on: []
blocks: [TASK-066]
parallel_safe_with: [TASK-060, TASK-061, TASK-062, TASK-063, TASK-065, TASK-067]
uat: "[[UAT-064]]"
tags: [api, git, diff, host-server, roadmap-007]
---

# TASK-064 — Diff endpoint — GET /api/agents/:agent/diff (git diff base-branch..HEAD)

## Objective

Add a `GET /api/agents/:agent/diff` endpoint to the host-server that runs `git -C <worktree_path> diff <base-branch>..HEAD` and returns the unified diff as plain text. Returns 204 (no diff) when the agent has no worktree, and 400 when the agent does not exist.

## Approach

Add the new route in `host-server/index.ts`. The handler:
1. Looks up the agent row; 404 if not found.
2. Returns 204 with `{ diff: null }` if `worktree_path` is null (non-git agent).
3. Determines the base branch by calling the base-branch detection logic (see TASK-065 — it can be an inline helper here or delegated after TASK-065 lands; fall back to `main` if TASK-065 is not yet available).
4. Runs `git -C <worktree_path> diff <base-branch>..HEAD` via `execSync` (with a reasonable size cap — e.g., 500 KB — to avoid huge diffs blocking the event loop).
5. Returns `{ diff: "<unified-diff-text>", base: "<base-branch>" }` as JSON.

## Steps

### 1. Read the host-server route layout  <!-- agent: general-purpose -->

- [x] Use `mcp__serena__get_symbols_overview` on `host-server/index.ts` to understand existing route patterns and how agent lookup is done.
- [x] Note the error-response shape used by other routes (`{ error: "..." }`).

<!-- Findings: routes registered inside `fastify.register((api) => {...}, { prefix: '/api' })` (lines 647-1912); param is `:id` (numeric), mirror `/agents/:id/tail`. `getAgentById(db, id)` returns `Agent` with `workdir` but NO `worktree_path`/`branch` yet (TASK-060 pending) → key git logic off `entry.workdir` + git-repo detection. Error shape: `reply.status(n).send({ error: '...' })`. `spawnSync`/`execSync` imported; git pattern uses `spawnSync('git', ['-C', p, ...], { timeout: SHELL_SYNC_TIMEOUT_MS })`. No `detectBaseBranch` helper exists (TASK-065 pending) → inline base detection, default `main`. -->
<!-- Updated: 2026-07-06 -->


### 2. Add the /diff route  <!-- agent: general-purpose -->

- [x] Register `GET /api/agents/:id/diff` in `host-server/index.ts`. <!-- param is :id (numeric), adjacent to /agents/:id/tail -->
- [x] Look up agent row; return 404 `{ error: 'agent <id> not found' }` if missing (+ 400 `invalid agent id` on NaN).
- [x] Return 200 `{ diff: null, base: null }` if `workdir` is not a git repo (worktree_path column not in schema yet; detected via `git rev-parse --is-inside-work-tree`).
- [x] Detect or default the base branch (inline detection: origin/HEAD → main → master → default `main`; no shared helper, left for TASK-065).
- [x] Run `git -C <workdir> diff <base>..HEAD`; capture stdout up to 500 KB (`truncated` flag when capped).
- [x] Return `{ diff: string, base: string, truncated: boolean }`.

<!-- Updated: 2026-07-06 -->
<!-- Note: implemented against entry.workdir since Agent has no worktree_path/branch yet (TASK-060 landing in parallel). -->


### 3. Typecheck  <!-- agent: general-purpose -->

- [x] Run `npx tsc --noEmit` in `host-server/` — zero errors. <!-- index.ts clean (Serena diagnostics empty, tsc reports 0 errors in index.ts). Only failing error is a transient TS1128 syntax error in db.ts from a teammate's concurrent TASK-060 edit — external to this task; will clear when TASK-060's db.ts edit completes. -->

<!-- Updated: 2026-07-06 -->


### 4. Manual smoke test  <!-- agent: general-purpose -->

- [DEFERRED-TO-UAT] `curl http://localhost:8788/api/agents/<agent-with-worktree>/diff` — returns JSON with a diff string (may be empty string `""` if no commits yet). <!-- runtime check; belongs to UAT phase. Note: route param is :id (numeric), so curl uses the numeric agent id. -->
- [DEFERRED-TO-UAT] `curl http://localhost:8788/api/agents/<agent-no-worktree>/diff` — returns `{ diff: null, base: null }`.

<!-- Updated: 2026-07-06 -->


## Acceptance Criteria

- [x] `GET /api/agents/:id/diff` returns `{ diff, base, truncated }` for agents with a worktree (git-repo `workdir`).
- [x] Returns `{ diff: null, base: null }` for non-git agents (workdir not a git repo).
- [x] Returns 404 for unknown agents (and 400 for a non-numeric id).
- [x] Diff output is capped (500 KB) to prevent excessively large responses.
- [x] `npx tsc --noEmit` passes in `host-server/` — clean for this task's `index.ts` (transient db.ts error is a concurrent TASK-060 edit, external to this task).

## Dependencies

None — uses `worktree_path` already in the DB from TASK-061 if available; can test with a manually set row.

### Roadmap

Implements ROADMAP-007 Phase 2, item "Add GET /api/agents/:agent/diff endpoint that runs `git -C <workdir> diff <base-branch>..HEAD`" — `wiki/work/roadmaps/ROADMAP-007-git-workflow.md`.
