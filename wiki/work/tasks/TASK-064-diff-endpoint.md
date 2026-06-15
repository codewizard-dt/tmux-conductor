---
id: TASK-064
title: "Diff endpoint — GET /api/agents/:agent/diff (git diff base-branch..HEAD)"
status: todo
created: 2026-06-14
updated: 2026-06-14
depends_on: []
blocks: [TASK-066]
parallel_safe_with: [TASK-060, TASK-061, TASK-062, TASK-063, TASK-065, TASK-067]
uat: ""
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

- [ ] Use `mcp__serena__get_symbols_overview` on `host-server/index.ts` to understand existing route patterns and how agent lookup is done.
- [ ] Note the error-response shape used by other routes (`{ error: "..." }`).

### 2. Add the /diff route  <!-- agent: general-purpose -->

- [ ] Register `GET /api/agents/:agent/diff` in `host-server/index.ts`.
- [ ] Look up agent row; return 404 `{ error: 'not found' }` if missing.
- [ ] Return 200 `{ diff: null, base: null }` if `worktree_path` is null.
- [ ] Detect or default the base branch (call a shared `detectBaseBranch(worktreePath)` helper or hard-code `main` as a temporary stand-in to be replaced by TASK-065).
- [ ] Run `git -C <worktree_path> diff <base>..HEAD`; capture stdout up to 500 KB.
- [ ] Return `{ diff: string, base: string }`.

### 3. Typecheck  <!-- agent: general-purpose -->

- [ ] Run `npx tsc --noEmit` in `host-server/` — zero errors.

### 4. Manual smoke test  <!-- agent: general-purpose -->

- [ ] `curl http://localhost:8788/api/agents/<agent-with-worktree>/diff` — returns JSON with a diff string (may be empty string `""` if no commits yet).
- [ ] `curl http://localhost:8788/api/agents/<agent-no-worktree>/diff` — returns `{ diff: null, base: null }`.

## Acceptance Criteria

- [ ] `GET /api/agents/:agent/diff` returns `{ diff, base }` for agents with a worktree.
- [ ] Returns `{ diff: null, base: null }` for non-git agents (no worktree).
- [ ] Returns 404 for unknown agents.
- [ ] Diff output is capped to prevent excessively large responses.
- [ ] `npx tsc --noEmit` passes in `host-server/`.

## Dependencies

None — uses `worktree_path` already in the DB from TASK-061 if available; can test with a manually set row.

### Roadmap

Implements ROADMAP-007 Phase 2, item "Add GET /api/agents/:agent/diff endpoint that runs `git -C <workdir> diff <base-branch>..HEAD`" — `wiki/work/roadmaps/ROADMAP-007-git-workflow.md`.
