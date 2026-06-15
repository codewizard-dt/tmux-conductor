---
id: ROADMAP-007
title: Git workflow — worktree isolation, diff review, checkpoint & rollback
status: active
created: 2026-06-13
updated: 2026-06-14
owner: David Taylor
linked_requirements: []
linked_decisions: []
tags: [git, workflow, isolation]
---

# Roadmap 007: Git workflow — worktree isolation, diff review, checkpoint & rollback

## Goal

Give every agent its own isolated git worktree and branch so parallel agents never clobber each other, add a diff panel to the dashboard so changes are reviewable inline, and add checkpoint/rollback so every dispatch is reversible without leaving the UI.

## Phase 1: Isolation

- [ ] [TASK-060](../tasks/TASK-060-agents-worktree-schema.md) Add `worktree_path` and `branch` columns to the `agents` SQLite table
- [ ] [TASK-061](../tasks/TASK-061-worktree-spawn.md) On agent spawn from a project, detect if `workdir` is a git repo and call `git worktree add <path> -b <agent-branch>`; store path and branch in the `agents` row; skip silently for non-git workdirs
- [ ] [TASK-062](../tasks/TASK-062-branch-badge-ui.md) Display branch name badge on agent card in the dashboard
- [ ] [TASK-063](../tasks/TASK-063-worktree-teardown.md) On agent delete, run `git worktree remove --force <path>` to clean up

## Phase 2: Review

- [ ] [TASK-064](../tasks/TASK-064-diff-endpoint.md) Add `GET /api/agents/:agent/diff` endpoint that runs `git -C <workdir> diff <base-branch>..HEAD`
- [ ] [TASK-065](../tasks/TASK-065-base-branch-endpoint.md) Add `GET /api/agents/:agent/base-branch` to auto-detect the default branch
- [ ] [TASK-066](../tasks/TASK-066-diff-panel-ui.md) Render a unified diff panel in the `AgentDetailModal` (colour-coded additions/deletions)

## Phase 3: Checkpoint & Rollback

- [ ] [TASK-067](../tasks/TASK-067-agent-checkpoints-table.md) Add `agent_checkpoints` table to SQLite (`agent_id`, `ts`, `stash_ref`)
- [ ] [TASK-068](../tasks/TASK-068-pre-dispatch-checkpoint.md) Before each task dispatch, take a git snapshot: `git stash push -m "conductor-checkpoint-<ts>"`
- [ ] [TASK-069](../tasks/TASK-069-checkpoints-list-endpoint.md) Expose `GET /api/agents/:agent/checkpoints` to list snapshots with timestamps
- [ ] [TASK-070](../tasks/TASK-070-rollback-endpoint.md) Add `POST /api/agents/:agent/rollback` endpoint to apply a selected checkpoint
- [ ] [TASK-071](../tasks/TASK-071-checkpoint-ui.md) Display checkpoint list in `AgentDetailModal` with timestamps and per-checkpoint rollback button

## Notes
