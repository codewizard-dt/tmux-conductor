---
id: TASK-069
title: "Checkpoints list endpoint — GET /api/agents/:agent/checkpoints"
status: todo
created: 2026-06-14
updated: 2026-06-14
depends_on: [TASK-067]
blocks: [TASK-071]
parallel_safe_with: [TASK-068, TASK-070]
uat: ""
tags: [api, checkpoint, host-server, roadmap-007]
---

# TASK-069 — Checkpoints list endpoint — GET /api/agents/:agent/checkpoints

## Objective

Add a `GET /api/agents/:agent/checkpoints` endpoint that returns the list of checkpoint snapshots for an agent, ordered by most-recent first, with timestamps for display in the dashboard.

## Approach

Add the route in `host-server/index.ts`. The handler:
1. Looks up the agent; 404 if not found.
2. Calls `listCheckpoints(agentId)` from `host-server/db.ts` (from TASK-067).
3. Returns `{ checkpoints: AgentCheckpoint[] }` ordered by `ts DESC`.

Also add a `POST /api/agents/:agent/checkpoints` route that accepts `{ ts, stash_ref }` and calls `insertCheckpoint` — this is used by `monitor.sh` (TASK-068) when it takes a checkpoint from the shell side.

## Steps

### 1. Read the route layout  <!-- agent: general-purpose -->

- [ ] Use `mcp__serena__get_symbols_overview` on `host-server/index.ts` to understand existing patterns for list endpoints.
- [ ] Confirm `listCheckpoints` and `insertCheckpoint` are available from `host-server/db.ts`.

### 2. Add GET /checkpoints  <!-- agent: general-purpose -->

- [ ] Register `GET /api/agents/:agent/checkpoints`.
- [ ] Look up agent; 404 if missing.
- [ ] Call `listCheckpoints(agentId)` (ordered DESC by `ts`); return `{ checkpoints: [...] }`.

### 3. Add POST /checkpoints  <!-- agent: general-purpose -->

- [ ] Register `POST /api/agents/:agent/checkpoints` accepting `{ ts: number, stash_ref: string }`.
- [ ] Call `insertCheckpoint(agentId, ts, stashRef)`; return `{ checkpoint: AgentCheckpoint }` with 201 status.
- [ ] Validate that agent exists; 404 otherwise.

### 4. Typecheck  <!-- agent: general-purpose -->

- [ ] Run `npx tsc --noEmit` in `host-server/` — zero errors.

### 5. Smoke test  <!-- agent: general-purpose -->

- [ ] `curl http://localhost:8788/api/agents/<id>/checkpoints` — returns `{ checkpoints: [] }` (or populated list if TASK-068 has run).
- [ ] `curl -X POST ... -d '{"ts":...,"stash_ref":"stash@{0}"}' http://localhost:8788/api/agents/<id>/checkpoints` — returns 201 with the checkpoint row.

## Acceptance Criteria

- [ ] `GET /api/agents/:agent/checkpoints` returns `{ checkpoints: [...] }` ordered by most-recent first.
- [ ] `POST /api/agents/:agent/checkpoints` creates a checkpoint row and returns 201.
- [ ] Both routes return 404 for unknown agents.
- [ ] `npx tsc --noEmit` passes in `host-server/`.

## Dependencies

- **DEPENDS ON [TASK-067](TASK-067-agent-checkpoints-table.md)** — `agent_checkpoints` table and DB helpers must exist.

### Roadmap

Implements ROADMAP-007 Phase 3, item "Expose GET /api/agents/:agent/checkpoints to list snapshots with timestamps" — `wiki/work/roadmaps/ROADMAP-007-git-workflow.md`.
