---
id: TASK-062
title: "Branch badge — display branch name on agent card in dashboard"
status: pending-uat
created: 2026-06-14
updated: 2026-06-14
depends_on: [TASK-061]
blocks: []
parallel_safe_with: [TASK-063, TASK-064, TASK-065, TASK-066, TASK-067]
uat: "[[UAT-062]]"
tags: [frontend, ui, git, branch, roadmap-007]
---

# TASK-062 — Branch badge — display branch name on agent card in dashboard

## Objective

Display a branch name badge on each agent card in the dashboard when the agent has a `branch` value (i.e., it was spawned with a git workdir). Agents without a branch (non-git workdirs) show nothing.

## Approach

The `GET /agents` and `GET /status` responses already return agent rows from SQLite; add `branch` (and `worktree_path`) to the serialised agent object in the host-server route handler. In `app/frontend`, update the `AgentList` card component to render a small branch badge (e.g., a monospace chip showing `⎇ conductor/<id>`) below or beside the agent name, conditionally on `agent.branch` being non-null.

## Steps

### 1. Expose branch in API responses  <!-- agent: general-purpose -->

- [x] Use `mcp__serena__get_symbols_overview` on `host-server/index.ts` to find the `GET /agents` and `GET /status` serialisation paths.
- [x] Ensure `branch` and `worktree_path` are included in the agent objects returned by both endpoints (add them if omitted by a `SELECT *` shortcut or an explicit column list). Note: confirmed actual field names are camelCase `branch`/`worktreePath` (not snake_case). `GET /agents` already passed through full rows (no change needed). `GET /status` explicitly enumerated fields in both its snapshot path (`buildSnapshot`) and cold-start fallback path, omitting branch/worktreePath in both — fixed both, plus the `Snapshot` interface's inline agent type.
- [x] Two SSE broadcast sites (`GET /events` initial-state send, and `pollAndDiff`'s `broadcastSSE('agent-update', ...)`) also explicitly enumerated fields and omitted `branch`/`worktreePath`. Confirmed via frontend trace that this was a real runtime gap: `AgentList` inserts SSE-originated agents (newly spawned worktree agents, or all agents under an SSE-beats-`/status` race) from the raw SSE payload, so the badge would never appear for them. Fixed both SSE payloads to include `worktreePath: agent.worktreePath, branch: agent.branch,` (adjacent to `workdir`, mirroring `buildSnapshot`/`GET /status`). `tsc --noEmit` in `host-server/` passes. Closes both gaps — SSE-originated agents now carry `branch`, so the badge renders regardless of whether `/status` seeded the row.

### 2. Update frontend API types  <!-- agent: general-purpose -->

- [x] In `frontend/src/lib/api.ts` (NOT `app/frontend/...` — stale path in this task's original text), add `branch?: string | null` and `worktreePath?: string | null` (camelCase, confirmed via step 1) to the `Agent` TypeScript interface. Note: interface is actually named `ApiAgent` (not `Agent`) in this file; fields added after `projectId`, before `createdAt`. `tsc --noEmit` in `frontend/` passes.

### 3. Render the branch badge  <!-- agent: general-purpose -->

- [x] In `frontend/src/components/AgentList.tsx` (NOT `app/frontend/...` — stale path), locate the agent card markup. Note: file defines its own local `Agent` interface (separate from `ApiAgent` in `frontend/src/lib/api.ts`); added `branch?: string | null` to it too so `agent.branch` type-checks.
- [x] Added a conditional branch badge in `AgentItem` (~line 795-863): `{agent.branch && <span className="block truncate font-mono text-[10px] text-muted-2" title={agent.branch}>⎇ {agent.branch}</span>}`, placed between Row 2 label/context and the active-task block.
- [x] Kept it visually subtle — matched the plain muted `activeTask` span convention (`font-mono text-[10px] text-muted-2`, no background chip), not the colored status/label pill style, so it doesn't compete with status indicators. `tsc --noEmit` in `frontend/` passes.

### 4. Typecheck + build  <!-- agent: general-purpose -->

- [x] Run `npx tsc --noEmit` in `frontend/` (NOT `app/frontend/` — stale path) — zero errors.
- [x] Run `npm run build` in `frontend/` — clean build (only a pre-existing Vite chunk-size advisory warning, unrelated to this task).

## Acceptance Criteria

- [DEFERRED-TO-UAT] Agent cards for agents with a `branch` value display a branch badge showing the branch name. (Implemented — conditional render in `AgentItem`; runtime/visual verification belongs to UAT.)
- [DEFERRED-TO-UAT] Agent cards for agents with `branch = NULL` show no badge. (Implemented via `agent.branch &&` guard; runtime verification belongs to UAT.)
- [x] `npx tsc --noEmit` and `npm run build` pass cleanly in `frontend/` (NOT `app/frontend/`).

## Dependencies

- **DEPENDS ON [TASK-061](TASK-061-worktree-spawn.md)** — `branch` must be populated in the `agents` row before the UI can display it.

### Roadmap

Implements ROADMAP-007 Phase 1, item "Display branch name badge on agent card in the dashboard" — `wiki/work/roadmaps/ROADMAP-007-git-workflow.md`.

<!-- Updated: 2026-07-06 (verification pass: confirmed all steps implemented in host-server/index.ts, frontend/src/lib/api.ts, frontend/src/components/AgentList.tsx; closed the SSE branch/worktreePath omission gap so newly-spawned worktree agents show the badge live) -->

