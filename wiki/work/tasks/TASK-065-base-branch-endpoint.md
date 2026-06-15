---
id: TASK-065
title: "Base-branch endpoint — GET /api/agents/:agent/base-branch auto-detects default branch"
status: todo
created: 2026-06-14
updated: 2026-06-14
depends_on: []
blocks: [TASK-066]
parallel_safe_with: [TASK-060, TASK-061, TASK-062, TASK-063, TASK-064, TASK-067]
uat: ""
tags: [api, git, host-server, roadmap-007]
---

# TASK-065 — Base-branch endpoint — GET /api/agents/:agent/base-branch auto-detects default branch

## Objective

Add a `GET /api/agents/:agent/base-branch` endpoint that auto-detects the git default branch for the agent's worktree (trying `origin/HEAD`, then common names `main`/`master`/`develop`) and returns it as JSON. Also extract the detection logic into a shared helper so TASK-064's diff endpoint can call it.

## Approach

Add the route in `host-server/index.ts`. Detection order:
1. `git -C <worktree_path> rev-parse --abbrev-ref origin/HEAD` — resolves to `origin/main` or similar; strip the `origin/` prefix.
2. If that fails, check which of `main`, `master`, `develop` exists as a local branch via `git -C <worktree_path> branch --list`.
3. Fall back to `main` if nothing resolves.

Extract the detection into a named helper function (e.g., `detectBaseBranch(worktreePath: string): string`) that both this endpoint and TASK-064 can import/call.

Returns `{ base: "main" }` (or whatever branch was detected). Returns `{ base: null }` for non-git agents. Returns 404 for unknown agents.

## Steps

### 1. Read the route layout  <!-- agent: general-purpose -->

- [ ] Use `mcp__serena__get_symbols_overview` on `host-server/index.ts` to understand the existing route patterns.

### 2. Write the detection helper  <!-- agent: general-purpose -->

- [ ] Create `detectBaseBranch(worktreePath: string): string` in `host-server/index.ts` (or a small `host-server/git.ts` utility file).
- [ ] Implement the three-step detection: `origin/HEAD` → common names → fallback `main`.

### 3. Add the /base-branch route  <!-- agent: general-purpose -->

- [ ] Register `GET /api/agents/:agent/base-branch`.
- [ ] Look up agent; 404 if missing.
- [ ] Return `{ base: null }` if `worktree_path` is null.
- [ ] Call `detectBaseBranch(worktree_path)` and return `{ base: string }`.

### 4. Update TASK-064's diff route  <!-- agent: general-purpose -->

- [ ] Replace any temporary hard-coded `main` in the diff route (TASK-064) with a call to `detectBaseBranch`.

### 5. Typecheck  <!-- agent: general-purpose -->

- [ ] Run `npx tsc --noEmit` in `host-server/` — zero errors.

### 6. Smoke test  <!-- agent: general-purpose -->

- [ ] `curl http://localhost:8788/api/agents/<agent>/base-branch` — returns `{ base: "main" }` (or the actual default branch).

## Acceptance Criteria

- [ ] `GET /api/agents/:agent/base-branch` returns `{ base: "<branch>" }` for git agents.
- [ ] Returns `{ base: null }` for non-git agents.
- [ ] Returns 404 for unknown agents.
- [ ] `detectBaseBranch` helper is shared with the diff endpoint.
- [ ] Detection order: `origin/HEAD` → common names (`main`/`master`/`develop`) → fallback `main`.
- [ ] `npx tsc --noEmit` passes in `host-server/`.

## Dependencies

None.

### Roadmap

Implements ROADMAP-007 Phase 2, item "Add GET /api/agents/:agent/base-branch to auto-detect the default branch" — `wiki/work/roadmaps/ROADMAP-007-git-workflow.md`.
