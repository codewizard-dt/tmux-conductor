---
id: TASK-069
title: "Checkpoints list endpoint — GET /api/agents/:agent/checkpoints"
status: done
created: 2026-06-14
updated: 2026-07-06
depends_on: [TASK-067]
blocks: [TASK-071]
parallel_safe_with: [TASK-068, TASK-070]
uat: "[[UAT-069]]"
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

<!-- Updated: 2026-07-06 -->

## Steps

### 1. Read the route layout  <!-- agent: general-purpose -->

- [x] Use `mcp__serena__get_symbols_overview` on `host-server/index.ts` to understand existing patterns for list endpoints.
- [x] Confirm `listCheckpoints` and `insertCheckpoint` are available from `host-server/db.ts`.

Findings: convention is `/agents/:id` (numeric `id` param, `parseInt` + `isNaN` guard), resolved via `getAgentById(db, agentId)` → 404 `{ error: '... not found' }` if missing. Model: `GET /agents/:id/usage` (host-server/index.ts ~L1547-1555). `listCheckpoints(db, agentId): AgentCheckpoint[]` (db.ts ~L857-861, ORDER BY ts DESC). `insertCheckpoint(db, agentId, ts, stashRef): AgentCheckpoint` (db.ts ~L850-855, RETURNING *). `AgentCheckpoint` interface exported at db.ts ~L94-100 (`id, agentId, ts, stashRef, createdAt`).

### 2. Add GET /checkpoints  <!-- agent: general-purpose -->

- [x] Register `GET /agents/:id/checkpoints` (confirmed codebase convention; task title's literal `:agent` string param does not match existing routes).
- [x] Look up agent via `getAgentById(db, agentId)`; 404 `{ error: ... }` if missing.
- [x] Call `listCheckpoints(db, agentId)` (already ordered DESC by `ts`); return `{ checkpoints: [...] }`.

Added in host-server/index.ts lines ~1558-1566, right after `/agents/:id/usage`. Import of `listCheckpoints` added to the `./db` import at the top of the file.

### 3. Add POST /checkpoints  <!-- agent: general-purpose -->

- [x] Register `POST /agents/:id/checkpoints` accepting `{ ts: number, stash_ref: string }` (matches GET route's `:id` convention, not task title's literal `:agent`).
- [x] Call `insertCheckpoint(db, agentId, ts, stashRef)`; return `{ checkpoint: AgentCheckpoint }` with 201 status.
- [x] Validate that agent exists via `getAgentById`; 404 otherwise. Also validates body: `ts` must be a finite number, `stash_ref` a non-empty string; 400 if malformed.

Added in host-server/index.ts lines ~1569-1585, right after the GET route. Body validation pattern mirrored from sibling POST routes (`/schedules`, `/tasks`, `/projects`) using `unknown`-typed body fields + typeof guards. `insertCheckpoint` added to the `./db` import.

### 4. Typecheck  <!-- agent: general-purpose -->

- [x] Run `npx tsc --noEmit` in `host-server/` — zero errors. Confirmed clean (no output, exit 0).

### 5. Smoke test  <!-- agent: general-purpose -->

- [DEFERRED-TO-UAT] `curl http://localhost:8788/agents/<id>/checkpoints` — returns `{ checkpoints: [] }` (or populated list if TASK-068 has run). Runtime verification against a live server belongs to the UAT phase, not /tackle's static-gates-only verification.
- [DEFERRED-TO-UAT] `curl -X POST ... -d '{"ts":...,"stash_ref":"stash@{0}"}' http://localhost:8788/agents/<id>/checkpoints` — returns 201 with the checkpoint row. Note: actual path is `/agents/:id/checkpoints`, not `/api/agents/<id>/checkpoints` as originally drafted.

## Acceptance Criteria

- [ ] `GET /api/agents/:agent/checkpoints` returns `{ checkpoints: [...] }` ordered by most-recent first.
- [ ] `POST /api/agents/:agent/checkpoints` creates a checkpoint row and returns 201.
- [ ] Both routes return 404 for unknown agents.
- [ ] `npx tsc --noEmit` passes in `host-server/`.

## Dependencies

- **DEPENDS ON [TASK-067](TASK-067-agent-checkpoints-table.md)** — `agent_checkpoints` table and DB helpers must exist.

### Roadmap

Implements ROADMAP-007 Phase 3, item "Expose GET /api/agents/:agent/checkpoints to list snapshots with timestamps" — `wiki/work/roadmaps/ROADMAP-007-git-workflow.md`.
