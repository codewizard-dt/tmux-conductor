---
id: TASK-071
aliases: [TASK-071]
title: "Checkpoint UI — AgentDetailModal checkpoint list with timestamps + per-checkpoint rollback button"
status: done
created: 2026-06-14
updated: 2026-09-02
depends_on: [TASK-069, TASK-070]
blocks: []
parallel_safe_with: [TASK-062, TASK-063, TASK-064, TASK-065, TASK-066, TASK-068]
uat: "[[UAT-071]]"
tags: [frontend, ui, checkpoint, rollback, roadmap-007]
---

# TASK-071 — Checkpoint UI — AgentDetailModal checkpoint list with timestamps + per-checkpoint rollback button

## Objective

Display a "Checkpoints" section in the `AgentDetailModal` (or agent detail view) that lists past checkpoint snapshots with human-readable timestamps and a per-checkpoint "Rollback" button. The section is only shown when the agent has a `worktree_path` (git agent).

## Approach

Add a `CheckpointList` component in `frontend/src/components/` that:
- Fetches from `GET /api/agents/:agent/checkpoints` on mount (and on a "Refresh" button click).
- Renders each checkpoint as a row: relative time (e.g., "3 minutes ago"), `stash_ref`, and a "Rollback" button.
- On "Rollback" click, calls `POST /api/agents/:agent/rollback` with `{ checkpoint_id }`, shows a loading state, then refreshes the diff panel and checkpoint list.
- Shows a confirmation dialog (e.g., `window.confirm` or an inline warning) before applying a rollback, since it overwrites uncommitted work.
- Shows an empty state ("No checkpoints yet — checkpoints are taken before each task dispatch") when the list is empty.

Wire the component into `AgentDetailModal` under a collapsible "Checkpoints" section, shown only when `agent.worktree_path` is non-null.

## Steps

### 1. Read AgentDetailModal + API types  <!-- agent: general-purpose -->

- [x] Use `mcp__serena__get_symbols_overview` on the agent detail modal component to understand the current layout and any existing section structure. `AgentDetailModal` is not a standalone file — it's defined in `frontend/src/components/AgentList.tsx:450-791` (task's `AgentDetailModal.tsx` path is stale, matching prior TASK-066/TASK-076 drift). Body ends with `{!logExpanded && <DiffPanel agentId={agent.id} />}` (L781) then `{!logExpanded && <UsageBreakdown agentId={agent.id} />}` (L784) — a new Checkpoints section belongs immediately after, same pattern.
- [x] Confirm `worktree_path` is available on the agent object (from TASK-062 which exposed it in the API response). **DEVIATION FOUND:** it is NOT present on the runtime `Agent` interface (`AgentList.tsx:18-48`) consumed by `AgentDetailModal` — only `branch` is (added by TASK-066/062). `worktreePath` exists only on the separate `ApiAgent` interface (`api.ts:176-185`), used by an unrelated page. Subtask added to Step 4 to add the field to `Agent` and verify the snapshot payload carries it.

### 2. Add API helpers  <!-- agent: general-purpose -->

- [x] In `frontend/src/lib/api.ts`, add:
  - `fetchAgentCheckpoints(agentId: number): Promise<{ checkpoints: AgentCheckpoint[] }>` — L52-59, GET `/agents/:id/checkpoints`. (No pre-existing client methods for these routes found — nothing duplicated.)
  - `rollbackAgent(agentId: number, checkpointId: number): Promise<{ ok: boolean; stash_ref: string }>` — L61-72, POST `/agents/:id/rollback` with body `{ checkpoint_id: checkpointId }` matching the real backend shape. `agentId: number` used (not the task's stated `string`) to match `fetchAgentDiff`'s existing convention.
- [x] Added the `AgentCheckpoint` TypeScript interface — L212-218, mirroring the backend's camelCase-mapped `agent_checkpoints` shape (`id`, `agentId`, `ts`, `stashRef`, `createdAt`).

### 3. Build CheckpointList  <!-- agent: general-purpose -->

- [x] Created `frontend/src/components/CheckpointList.tsx` (corrected path, no `app/` prefix). Mirrors `DiffPanel.tsx`'s structure exactly (load/signal/useEffect pattern, `<details>` wrapper, loading/error styling), matching sibling panel `UsageBreakdown`'s convention too.
- [x] Fetch checkpoints on mount; loading state shown via DiffPanel's italic loading-text convention (no spinner primitive exists in the codebase).
- [x] Render each checkpoint row: relative timestamp via a local `formatRelativeTimestamp` helper (no shared formatter exists — `ScheduleList.tsx`'s equivalents are module-private), `stashRef`, "Rollback" button.
- [x] On "Rollback" click: `window.confirm`; on confirm calls `rollbackAgent`; on success refreshes the list and dispatches `window.dispatchEvent(new CustomEvent('conductor:diff-refresh', { detail: { agentId } }))` — **note: `DiffPanel.tsx` does not yet listen for this event; a listener needs adding there for the diff panel to actually refresh (tracked as a subtask under Step 4).**
- [x] Empty state: "No checkpoints yet — checkpoints are taken before each task dispatch."
- [x] Error state: shown via DiffPanel's `text-accent-red` convention.

### 4. Wire into AgentDetailModal  <!-- agent: general-purpose -->

- [x] Added a "Checkpoints" section in `AgentDetailModal` (`frontend/src/components/AgentList.tsx:789`), rendered only when `agent.worktreePath` is non-null: `{!logExpanded && agent.worktreePath && <CheckpointList agentId={agent.id} />}`, placed after `UsageBreakdown`.
- [x] Renders `<CheckpointList agentId={agent.id} />` (import added at `AgentList.tsx:5`).
- [x] Subtask (discovered in Step 1): added `worktreePath?: string | null` to the `Agent` interface (`AgentList.tsx:34`). Backend emission already existed end-to-end (no backend changes needed) — DB column `worktree_path` (`host-server/db.ts:355`), mapped camelCase in `mapAgent()` (`db.ts:205`) alongside `branch`, already emitted in `/status` and other JSON builders.
- [x] Subtask (discovered in Step 3): added the missing `conductor:diff-refresh` listener in `DiffPanel.tsx:47-56` (separate `useEffect` from the mount-fetch effect) — filters on `event.detail.agentId === agentId`, calls `load({cancelled:false})` on match, cleans up via `removeEventListener`.

### 5. Typecheck + build  <!-- agent: general-purpose -->

- [x] Ran `npx tsc --noEmit` in `frontend/` — zero errors (exit 0).
- [x] Ran `npm run build` in `frontend/` — clean build (exit 0; only pre-existing chunk-size advisory, not an error).

## Acceptance Criteria

- [x] "Checkpoints" section appears in the agent detail view only for agents with a non-null `worktree_path`.
- [x] Each checkpoint row shows a human-readable relative timestamp and the `stash_ref`.
- [x] "Rollback" button triggers a confirmation, then calls `POST /api/agents/:agent/rollback`, then refreshes both the checkpoint list and the diff panel.
- [x] Empty state message is shown when there are no checkpoints.
- [x] `npx tsc --noEmit` and `npm run build` pass cleanly in `frontend/` (task's `app/frontend/` path was stale; real path used).

## Dependencies

- **DEPENDS ON [TASK-069](TASK-069-checkpoints-list-endpoint.md)** — `GET /api/agents/:agent/checkpoints` must exist.
- **DEPENDS ON [TASK-070](TASK-070-rollback-endpoint.md)** — `POST /api/agents/:agent/rollback` must exist.

### Roadmap

Implements ROADMAP-007 Phase 3, item "Display checkpoint list in AgentDetailModal with timestamps and per-checkpoint rollback button" — `wiki/work/roadmaps/ROADMAP-007-git-workflow.md`.

<!-- Updated: 2026-08-15 -->

