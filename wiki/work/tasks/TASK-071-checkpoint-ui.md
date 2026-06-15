---
id: TASK-071
title: "Checkpoint UI — AgentDetailModal checkpoint list with timestamps + per-checkpoint rollback button"
status: todo
created: 2026-06-14
updated: 2026-06-14
depends_on: [TASK-069, TASK-070]
blocks: []
parallel_safe_with: [TASK-062, TASK-063, TASK-064, TASK-065, TASK-066, TASK-068]
uat: ""
tags: [frontend, ui, checkpoint, rollback, roadmap-007]
---

# TASK-071 — Checkpoint UI — AgentDetailModal checkpoint list with timestamps + per-checkpoint rollback button

## Objective

Display a "Checkpoints" section in the `AgentDetailModal` (or agent detail view) that lists past checkpoint snapshots with human-readable timestamps and a per-checkpoint "Rollback" button. The section is only shown when the agent has a `worktree_path` (git agent).

## Approach

Add a `CheckpointList` component in `app/frontend/src/components/` that:
- Fetches from `GET /api/agents/:agent/checkpoints` on mount (and on a "Refresh" button click).
- Renders each checkpoint as a row: relative time (e.g., "3 minutes ago"), `stash_ref`, and a "Rollback" button.
- On "Rollback" click, calls `POST /api/agents/:agent/rollback` with `{ checkpoint_id }`, shows a loading state, then refreshes the diff panel and checkpoint list.
- Shows a confirmation dialog (e.g., `window.confirm` or an inline warning) before applying a rollback, since it overwrites uncommitted work.
- Shows an empty state ("No checkpoints yet — checkpoints are taken before each task dispatch") when the list is empty.

Wire the component into `AgentDetailModal` under a collapsible "Checkpoints" section, shown only when `agent.worktree_path` is non-null.

## Steps

### 1. Read AgentDetailModal + API types  <!-- agent: general-purpose -->

- [ ] Use `mcp__serena__get_symbols_overview` on the agent detail modal component to understand the current layout and any existing section structure.
- [ ] Confirm `worktree_path` is available on the agent object (from TASK-062 which exposed it in the API response).

### 2. Add API helpers  <!-- agent: general-purpose -->

- [ ] In `app/frontend/src/lib/api.ts`, add:
  - `fetchAgentCheckpoints(agentId: string): Promise<{ checkpoints: AgentCheckpoint[] }>`
  - `rollbackAgent(agentId: string, checkpointId: number): Promise<{ ok: boolean, stash_ref: string }>`
- [ ] Add the `AgentCheckpoint` TypeScript interface (mirroring the DB type).

### 3. Build CheckpointList  <!-- agent: general-purpose -->

- [ ] Create `app/frontend/src/components/CheckpointList.tsx`.
- [ ] Fetch checkpoints on mount; show a loading spinner.
- [ ] Render each checkpoint row: relative timestamp (`ts` → formatted), `stash_ref`, "Rollback" button.
- [ ] On "Rollback" click: show `window.confirm`; on confirm call `rollbackAgent`; on success refresh the list and emit an event to refresh the diff panel.
- [ ] Empty state: "No checkpoints yet — checkpoints are taken before each task dispatch."
- [ ] Error state: show error message if the API call fails.

### 4. Wire into AgentDetailModal  <!-- agent: general-purpose -->

- [ ] Add a "Checkpoints" section in `AgentDetailModal.tsx`, rendered only when `agent.worktree_path` is non-null.
- [ ] Render `<CheckpointList agentId={agent.id} />`.

### 5. Typecheck + build  <!-- agent: general-purpose -->

- [ ] Run `npx tsc --noEmit` in `app/frontend/` — zero errors.
- [ ] Run `npm run build` in `app/frontend/` — clean build.

## Acceptance Criteria

- [ ] "Checkpoints" section appears in the agent detail view only for agents with a non-null `worktree_path`.
- [ ] Each checkpoint row shows a human-readable relative timestamp and the `stash_ref`.
- [ ] "Rollback" button triggers a confirmation, then calls `POST /api/agents/:agent/rollback`, then refreshes both the checkpoint list and the diff panel.
- [ ] Empty state message is shown when there are no checkpoints.
- [ ] `npx tsc --noEmit` and `npm run build` pass cleanly in `app/frontend/`.

## Dependencies

- **DEPENDS ON [TASK-069](TASK-069-checkpoints-list-endpoint.md)** — `GET /api/agents/:agent/checkpoints` must exist.
- **DEPENDS ON [TASK-070](TASK-070-rollback-endpoint.md)** — `POST /api/agents/:agent/rollback` must exist.

### Roadmap

Implements ROADMAP-007 Phase 3, item "Display checkpoint list in AgentDetailModal with timestamps and per-checkpoint rollback button" — `wiki/work/roadmaps/ROADMAP-007-git-workflow.md`.
