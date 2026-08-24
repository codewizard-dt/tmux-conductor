---
id: BUG-0004
aliases: [BUG-0004]
title: "Diff panel reads the wrong directory for worktree-backed agents (uses workdir instead of worktreePath)"
status: open
severity: high
priority: "—"
created: 2026-08-24
updated: 2026-08-24
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

> _(filled at `/bug-close`)_

## Resolution

> _(filled at `/bug-close`)_

## Related

> [[BUG-0003]] — found by the same UAT-071 verification pass, unrelated code paths
