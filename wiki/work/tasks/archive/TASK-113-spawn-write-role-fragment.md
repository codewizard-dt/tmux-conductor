---
id: TASK-113
aliases: [TASK-113]
title: "Write role fragment into the agent's worktree CLAUDE.md on spawn"
status: done
created: 2026-08-15
updated: 2026-08-15
depends_on: [TASK-111, TASK-112]
blocks: []
parallel_safe_with: [TASK-114, TASK-115]
uat: "[[UAT-113]]"
tags: [backend, roles, worktree, roadmap-010]
---

# TASK-113 — Write role fragment into the agent's worktree CLAUDE.md on spawn

depends_on::[[TASK-111]]
depends_on::[[TASK-112]]

## Objective

When a new agent is spawned with a non-`generic` role inside a git-backed workdir, append that role's CLAUDE.md fragment (from TASK-112's `presets.json`) to the `CLAUDE.md` inside the agent's own **worktree** — never the source repo's `CLAUDE.md` — so the agent picks up role-specific guidance the moment its session starts, without ever touching the user's real project file.

> **Note on `depends_on`**: the roadmap-item scoping from the task-creation instructions named only TASK-112 (the presets file) as a hard dependency. This task file also lists TASK-111, because writing "the matching role fragment" requires reading `agent.role` off the DB row created in TASK-111 — without that column, there is no role to look up. Flagging this explicitly since it widens the originally-stated dependency list; TASK-111 is a small, fast, independent migration, so this shouldn't meaningfully change scheduling.

## Approach

`git worktree add` (`createWorktree()`, `host-server/git.ts:74-82`) checks out a full independent working tree at `worktreePath` on a new branch — including a copy of whatever `CLAUDE.md` exists at the base ref, if any. Because a worktree's working directory is physically separate from the source repo's (only `.git` metadata is shared), writing to `path.join(worktreePath, 'CLAUDE.md')` is safe by construction: it can never touch `path.join(gitRoot, 'CLAUDE.md')` (the source repo's real file) as long as the write path is always built from `worktreePath`, never from `gitRoot`/`data.workdir`. **This is the one thing that must not go wrong in this task** — every step and the acceptance criteria enforce checking the write target is the worktree path, not the source repo.

Hook point: `createAgent()` in `host-server/db.ts:510-547`, specifically inside the `if (gitRoot) { ... }` block, right after `createWorktree()` returns `true` (around `db.ts:538-540`, alongside the existing `db.prepare('UPDATE agents SET worktree_path = ?, branch = ? WHERE id = ?')...` call). At that point `worktreePath`, `role` (from TASK-111's `data.role ?? 'generic'`), and TASK-112's `getRoleFragment()` are all in scope.

Add the write logic to `host-server/rolePresets.ts` (TASK-112's module — it already owns fragment *content*; this keeps *applying* the fragment next to it, and keeps `git.ts` about git mechanics only), as `applyRoleFragmentToWorktree(worktreePath: string, role: string): void`:
- Read `<worktreePath>/CLAUDE.md` if it exists (it likely does — checked out from the base ref); otherwise start from an empty string.
- Append the role fragment under a clear, greppable heading so it's obviously agent-injected content, not hand-authored:
  ```
  \n\n## Role: <role>\n\n<fragment>\n
  ```
- Write the result back to `<worktreePath>/CLAUDE.md` (create the file if it didn't exist).
- Best-effort, matching the existing worktree-creation error-handling convention in `createAgent()` (a `createWorktree()` failure only logs a warning and never aborts agent creation) — a CLAUDE.md write failure (e.g. permissions) should log a warning and never abort agent creation either.
- Skip entirely for `role === 'generic'` (or write the `generic` fragment too, if TASK-112's `generic` fragment is meaningful default guidance rather than an empty placeholder — check what TASK-112 actually shipped for the `generic` key before deciding; either behavior is acceptable as long as it's deliberate and documented in a code comment, not silently inconsistent).

## Steps

### 1. Verify prerequisites actually landed  <!-- agent: general-purpose --> <!-- Updated: 2026-08-15 13:20 -->

- [x] Use `mcp__serena__search_for_pattern` for `role` in `host-server/db.ts` and confirm TASK-111's migration, `mapAgent()`/`createAgent()` threading are present (schema v7 block, `Agent.role`). Use `mcp__serena__search_for_pattern` for `getRoleFragment` in `host-server/rolePresets.ts` and confirm TASK-112 landed. If either is missing, mark this task `[BLOCKED: dependency not yet merged]` and stop rather than re-implementing the missing piece inline. — **Confirmed both landed**: TASK-111's schema v7 migration (`ALTER TABLE agents ADD COLUMN role TEXT NOT NULL DEFAULT 'generic' CHECK (...)`), `Agent.role`, `mapAgent()`, and `createAgent()`'s `data.role ?? 'generic'` threading are all present (`host-server/db.ts`). TASK-112's `ROLE_VALUES`/`getRoleFragment()` (`host-server/rolePresets.ts`) and `host-server/role-presets.json` (7 keys, `generic`'s fragment is real default guidance, not an empty placeholder) are present, plus `host-server/rolePresets.test.ts`. Real current insertion point (line numbers shifted from this file's estimate due to sibling edits — re-located by symbol): `createAgent()`'s `if (gitRoot) { ... }` block is now at `db.ts:528-536`; `createWorktree()` call at line 532, `UPDATE agents SET worktree_path = ?, branch = ?` at line 534 (inside the `if (created)` branch).

### 2. Implement `applyRoleFragmentToWorktree`  <!-- agent: general-purpose --> <!-- Updated: 2026-08-15 13:20 -->

- [x] In `host-server/rolePresets.ts`, add `applyRoleFragmentToWorktree(worktreePath: string, role: string): void` per the Approach section: read-or-empty existing `<worktreePath>/CLAUDE.md`, append the `## Role: <role>` section with `getRoleFragment(role)`'s content, write back. Wrap the file I/O in try/catch — log a warning (matching `createAgent()`'s existing `console.warn('[conductor] createAgent: ...')` style) and return normally on failure, never throw. — Implemented exactly as specified; `role === 'generic'` is written (not skipped) since TASK-112's `generic` fragment is real default guidance, documented in the doc comment.
- [x] Add a one-line doc comment stating explicitly that `worktreePath` must be the agent's own worktree directory, never the source repo root — this is the function's one hard safety invariant. — Added as a `SAFETY INVARIANT:` paragraph in the function's JSDoc block. `npx tsc --noEmit` clean for `rolePresets.ts` and the rest of the codebase; 4 pre-existing errors found in `host-server/rolePresets.test.ts` (TASK-112's own untracked test file, unrelated to and unmodified by this step) — flagged for Step 4 since the task's acceptance criteria requires a fully clean typecheck.

### 3. Wire it into agent spawn  <!-- agent: general-purpose --> <!-- Updated: 2026-08-15 13:20 -->

- [x] In `host-server/db.ts`'s `createAgent()`, inside the `if (gitRoot) { ... }` block, immediately after `createWorktree()` returns `true` and the `worktree_path`/`branch` columns are updated, call `applyRoleFragmentToWorktree(worktreePath, data.role ?? 'generic')` (import from `rolePresets.ts`). Do not call it when `createWorktree()` returned `false` (no worktree exists to write into). — Wired into the `if (created)` branch only, passing `worktreePath` (never `gitRoot`/`data.workdir`) — verified in the sub-agent's report. `npx tsc --noEmit` in `host-server/` now exits 0 with zero errors (the 4 pre-existing `rolePresets.test.ts` errors flagged after Step 2 were resolved by a concurrent sibling task before this typecheck ran).

### 4. Test  <!-- agent: general-purpose --> <!-- Updated: 2026-08-15 13:20 -->

- [x] Add a case to `host-server/rolePresets.test.ts` (created in TASK-112) or a new `host-server/db.migration.test.ts`-style fixture-repo test (mirroring the throwaway-git-repo pattern in `host-server/git.test.ts`'s `makeRepo()` helper, under `./tmp/`, never `/tmp`): create a fixture repo with a `CLAUDE.md` containing known content, call `createWorktree()` then `applyRoleFragmentToWorktree()` with a non-generic role, and assert (a) the worktree's `CLAUDE.md` contains both the original content and the appended `## Role: <role>` section, and (b) the **source repo's** `CLAUDE.md` (at `gitRoot`, not `worktreePath`) is byte-for-byte unchanged — this is the one assertion that must never be skipped, per the Approach section's safety invariant. — Added `applyRoleFragmentToWorktree appends the role fragment to the worktree CLAUDE.md and never modifies the source repo CLAUDE.md` to `host-server/rolePresets.test.ts`, with `assert.strictEqual` on the full source-repo `CLAUDE.md` content before/after as the never-skippable safety assertion. 14/14 pass in the file.
- [x] Run `npx tsc --noEmit` in `host-server/` — zero errors. — Clean. Full suite also re-run: 79/79 passing.

## Acceptance Criteria

- [ ] Spawning a git-backed agent with a non-`generic` role appends that role's fragment to `<worktreePath>/CLAUDE.md` under a `## Role: <role>` heading.
- [ ] The source repository's own `CLAUDE.md` (outside any worktree) is never modified by this code path — verified by an explicit test assertion, not just by code review.
- [ ] A `CLAUDE.md` write failure (e.g. permissions) logs a warning and does not abort agent creation.
- [ ] `npx tsc --noEmit` passes cleanly in `host-server/`.

## Dependencies

- **DEPENDS ON [TASK-111](TASK-111-agent-role-column.md)** — needs `agent.role` to exist and be readable in `createAgent()`.
- **DEPENDS ON [TASK-112](TASK-112-role-presets-config.md)** — needs `getRoleFragment()`.
- Worktree infrastructure this task builds on (`createWorktree()`, `git worktree add`) is already implemented and verified: TASK-061 (worktree spawn) and TASK-063 (worktree teardown) are both done.

### Roadmap

Implements ROADMAP-010 Phase 3, item 3 ("On agent spawn, write the matching role fragment into the worktree's `CLAUDE.md`") — `wiki/work/roadmaps/ROADMAP-010-agent-observability-ux.md`.
