---
id: ROADMAP-007
title: Git workflow — worktree isolation, diff review, checkpoint & rollback
status: active
created: 2026-06-13
updated: 2026-06-13
owner: David Taylor
linked_requirements: []
linked_decisions: []
tags: [git, workflow, isolation]
---

# Roadmap 007: Git workflow — worktree isolation, diff review, checkpoint & rollback

## Goal

Give every agent its own isolated git worktree and branch so parallel agents never clobber each other, add a diff panel to the dashboard so changes are reviewable inline, and add checkpoint/rollback so every dispatch is reversible without leaving the UI.

## Phase 1: Isolation

- [ ] Add `worktree_path` and `branch` columns to the `agents` SQLite table
- [ ] On agent spawn from a project, detect if `workdir` is a git repo and call `git worktree add <path> -b <agent-branch>`
- [ ] Store the worktree path and branch in the `agents` row; skip silently for non-git workdirs
- [ ] Display branch name badge on agent card in the dashboard
- [ ] On agent delete, run `git worktree remove --force <path>` to clean up

## Phase 2: Review

- [ ] Add `GET /api/agents/:agent/diff` endpoint that runs `git -C <workdir> diff <base-branch>..HEAD`
- [ ] Add `GET /api/agents/:agent/base-branch` to auto-detect the default branch
- [ ] Render a unified diff panel in the `AgentDetailModal` (colour-coded additions/deletions)

## Phase 3: Checkpoint & Rollback

- [ ] Before each task dispatch, take a git snapshot: `git stash push -m "conductor-checkpoint-<ts>"`
- [ ] Add `agent_checkpoints` table to SQLite (`agent_id`, `ts`, `stash_ref`)
- [ ] Expose `GET /api/agents/:agent/checkpoints` to list snapshots with timestamps
- [ ] Add `POST /api/agents/:agent/rollback` endpoint to apply a selected checkpoint
- [ ] Display checkpoint list in `AgentDetailModal` with timestamps and per-checkpoint rollback button

## Notes
