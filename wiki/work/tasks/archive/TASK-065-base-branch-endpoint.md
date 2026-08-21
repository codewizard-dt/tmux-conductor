---
id: TASK-065
aliases: [TASK-065]
title: "Base-branch endpoint — GET /api/agents/:agent/base-branch auto-detects default branch"
status: done
created: 2026-06-14
updated: 2026-07-06
depends_on: []
blocks: [TASK-066]
parallel_safe_with: [TASK-060, TASK-061, TASK-062, TASK-063, TASK-064, TASK-067]
uat: "[[UAT-065]]"
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

- [x] Use `mcp__serena__get_symbols_overview` on `host-server/index.ts` to understand the existing route patterns.

<!-- Updated: 2026-07-06 — Step 1 findings: routes live inside the /api register block (lines 646–1977); diff route at 1331–1391 uses spawnSync + `git -C <workdir>` with SHELL_SYNC_TIMEOUT_MS; agent routes use `:id` (numeric) + getAgentById, NOT `:agent`; Agent interface exposes workdir only (worktree_path not mapped — db.ts off-limits this task, so key off workdir like the diff route); host-server/git.ts does not exist yet (extraction target). -->

### 2. Write the detection helper  <!-- agent: general-purpose -->

- [x] Create `detectBaseBranch(worktreePath: string): string` in `host-server/index.ts` (or a small `host-server/git.ts` utility file).
- [x] Implement the three-step detection: `origin/HEAD` → common names → fallback `main`.

<!-- Updated: 2026-07-06 — created host-server/git.ts exporting SHELL_SYNC_TIMEOUT_MS, isGitRepo(dir), and detectBaseBranch(worktreePath) (origin/HEAD → main/master/develop → 'main'); tsc clean. -->

### 3. Add the /base-branch route  <!-- agent: general-purpose -->

- [x] Register `GET /api/agents/:agent/base-branch`.
- [x] Look up agent; 404 if missing.
- [x] Return `{ base: null }` if `worktree_path` is null.
- [x] Call `detectBaseBranch(worktree_path)` and return `{ base: string }`.

<!-- Updated: 2026-07-06 — route registered as GET /api/agents/:id/base-branch (codebase convention: numeric :id + getAgentById, matching every other agent route). Since Agent doesn't map worktree_path (db.ts off-limits per TASK-067 concurrency), the null case keys off isGitRepo(entry.workdir), mirroring the diff route's pattern. Imports from ./git.ts; inserted right after the diff route; tsc clean. -->

### 4. Update TASK-064's diff route  <!-- agent: general-purpose -->

- [x] Replace any temporary hard-coded `main` in the diff route (TASK-064) with a call to `detectBaseBranch`.

<!-- Updated: 2026-07-06 — diff route's inline detection block (refExists closure, symbolic-ref call, main/master chain) replaced with detectBaseBranch(workdir); is-inside-work-tree check swapped for isGitRepo(workdir) (identical semantics); route comment updated; tsc clean. -->

### 5. Typecheck  <!-- agent: general-purpose -->

- [x] Run `npx tsc --noEmit` in `host-server/` — zero errors.

<!-- Updated: 2026-07-06 — tsc exit 0, zero errors (db.ts clean too despite TASK-067 concurrency). -->

### 6. Smoke test  <!-- agent: general-purpose -->

- [x] [DEFERRED-TO-UAT] `curl http://localhost:8788/api/agents/<agent>/base-branch` — returns `{ base: "main" }` (or the actual default branch). (Runtime verification belongs to the UAT phase; note the route uses numeric `:id`, e.g. `/api/agents/1/base-branch`.)

<!-- Updated: 2026-07-06 — all implementation steps complete; smoke test deferred to UAT per verification-phase policy. -->

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
