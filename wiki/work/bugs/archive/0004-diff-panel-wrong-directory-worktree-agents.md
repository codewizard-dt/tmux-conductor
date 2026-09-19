---
id: BUG-0004
aliases: [BUG-0004]
title: "Diff panel reads the wrong directory for worktree-backed agents (uses workdir instead of worktreePath)"
status: closed
severity: high
priority: "—"
created: 2026-08-24
updated: 2026-09-03
reporter: David Taylor
assignee: "—"
tags: "—"
linked_task: "[[TASK-071]]"
---

# BUG-0004 — Diff panel reads the wrong directory for worktree-backed agents (uses workdir instead of worktreePath)

## Environment

- OS: macOS (Darwin 25.3.0)
- Browser: Chromium (Playwright)
- App: tmux-conductor dashboard
- Runtime: host-server (Fastify) + frontend (Vite dev server)
- Config: default `conductor.conf`, no overrides

## Steps to Reproduce

1. Create a worktree-backed agent (`useWorktree: true`), so it has both a `workdir` (the original repo path) and a distinct `worktreePath` (the sibling worktree directory).
2. Make a real change inside the agent's actual worktree directory (e.g. dirty a tracked file, or perform a rollback that's expected to change the worktree's contents).
3. Open the agent's detail modal and expand the "Changes" (diff) section, or click its Refresh button.

## Expected Behavior

The diff panel shows the real diff of the agent's actual worktree directory (`worktreePath`) against its base branch, reflecting whatever changes actually exist there.

## Actual Behavior

The diff panel's content never reflects changes made in the worktree — confirmed during a live checkpoint-rollback test where the rollback's `git stash` round-trip completed successfully (verified via the Checkpoints API and direct git inspection) but the Diff panel's rendered content did not update to match. Root cause (found via source read during live verification, not yet fixed): `GET /agents/:id/diff` in `host-server/index.ts` runs its `git diff` against `entry.workdir` instead of `entry.worktreePath` — for a worktree-backed agent these are two different directories, so the endpoint is silently diffing the wrong one. This predates TASK-071 (it's inherited from the original TASK-064/065-era diff endpoint) but was surfaced while verifying TASK-071's acceptance criterion that a rollback visibly refreshes the diff panel.

Found during live Playwright-driven verification of UAT-071 (checkpoint UI) on 2026-08-22.

## Reproducibility

- **Frequency**: always
- **First seen**: 2026-08-22
- **Last seen**: 2026-08-22

## Root Cause Analysis

Confirmed exactly as filed. `GET /agents/:id/diff` (`host-server/index.ts:1454-1489`) unconditionally set `const workdir = entry.workdir;` — the original repo root — and used that same variable for the `isGitRepo`/`detectBaseBranch`/`git diff -C` calls. For a worktree-backed agent (`entry.worktreePath` non-null, set by `createAgent`/`addWorktreeToAgent` in `host-server/db.ts`), the agent's actual live changes live in the sibling worktree directory, not `workdir`, so the route always diffed the wrong tree. The rest of the codebase's established convention for "is this agent worktree-backed" is a truthiness check on `entry.worktreePath` (used identically at `host-server/index.ts:1335` in the DELETE /agents/:id teardown path and `:1705` in the checkpoint-rollback path) — no new convention was invented.

## Resolution

Changed the single assignment at `host-server/index.ts:1462` to `const workdir = entry.worktreePath || entry.workdir;`, matching the `worktreePath`-truthy-else-`workdir` fallback used elsewhere. Every downstream use in the handler (`isGitRepo`, `detectBaseBranch`, the `git -C <dir> diff` spawn) already referenced the same `workdir` local, so no other lines needed to change.

Verification: `cd host-server && npm run typecheck` (clean) and `npm test` (89/89 pass, no regressions).

### Regression test

Following BUG-0009's precedent (a self-contained shell-driven end-to-end test avoided needing an in-process Fastify test harness), added `scripts/verify-diff-endpoint-worktree-and-uncommitted.sh`. It boots a real host-server instance on a scratch `BACKEND_PORT` (never touches the live dev server's 8788) against a scratch SQLite DB, seeds a worktree-backed agent whose `workdir` and `worktreePath` point at two independent git fixture repos each carrying a distinct uncommitted-change marker, then asserts `GET /api/agents/:id/diff` returns the `worktreePath` repo's marker and not the `workdir` repo's. This single fixture also covers [[BUG-0010]] (the marker is an *uncommitted* change — if `..HEAD` were reinstated, the diff would come back empty).

Confirmed the test is meaningful: temporarily reverted the `worktreePath || workdir` fallback back to bare `entry.workdir` and re-ran — failed with the `workdir` repo's `WRONG-REPO-DIFF-MARKER` leaking into the response, exactly the original defect. Restored the fix, re-ran — passed. `npx tsc --noEmit`, `npx eslint .`, and `npm test` (109/109) all clean afterward.

Closing per the lifecycle gate (root cause + fix + regression test) now that a genuine regression test exists.

## Related

> [[BUG-0003]] — found by the same UAT-071 verification pass, unrelated code paths
