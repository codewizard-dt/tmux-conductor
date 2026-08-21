---
id: TASK-075
aliases: [TASK-075]
title: "consolidate dashboard EventSource usage"
status: done
created: 2026-06-28
updated: 2026-06-28
depends_on: [TASK-072]
blocks: [TASK-079, TASK-083]
parallel_safe_with: [TASK-076, TASK-077]
uat: "[[UAT-075]]"
tags: [frontend, sse, performance, roadmap-014]
---

# TASK-075 — consolidate dashboard EventSource usage

## Objective

Move dashboard live updates onto a single shared frontend EventSource so rendering the agents page and terminal tails does not open duplicate `/events` connections.

## Approach

Extend the existing shared `frontend/src/hooks/useSSE.ts` utility and migrate direct EventSource usage in `useAgents.ts` and `AgentList.tsx` to it. Preserve event handling behavior and cleanup semantics.

## Steps

### 1. Inventory current consumers  <!-- agent: general-purpose -->

- [x] Read `frontend/src/hooks/useSSE.ts`, `frontend/src/lib/useAgents.ts`, `frontend/src/components/AgentList.tsx`, and `frontend/src/components/LogTail.tsx`.
- [x] List every SSE event name consumed by the dashboard.

### 2. Extend shared SSE hook if needed  <!-- agent: general-purpose -->

- [x] Update `frontend/src/hooks/useSSE.ts` so it supports all event names currently consumed in `useAgents.ts` and `AgentList.tsx`.
- [x] Preserve reference-counted open/close behavior.
- [x] Avoid creating a second EventSource for any dashboard component.

### 3. Migrate consumers  <!-- agent: general-purpose -->

- [x] Refactor `frontend/src/lib/useAgents.ts` to subscribe via `useSSEEvent`.
- [x] Refactor `frontend/src/components/AgentList.tsx` to remove direct `new EventSource(...)` usage.
- [x] Keep payload parsing and state refresh behavior equivalent.

### 4. Verify  <!-- agent: general-purpose -->

- [x] Run `npm --prefix frontend run typecheck`.
- [x] Run `npm --prefix frontend run lint`.

## Acceptance Criteria

- [x] `frontend/src/lib/useAgents.ts` and `frontend/src/components/AgentList.tsx` no longer instantiate `EventSource` directly.
- [x] Dashboard still responds to status, task, agent, and terminal SSE events.
- [x] Frontend typecheck and lint pass.

## Dependencies

Depends on TASK-072 so connection count improvements can be observed.

### Roadmap

Implements ROADMAP-014 Phase 2, item "Consolidate dashboard EventSource usage" — `wiki/work/roadmaps/ROADMAP-014-dashboard-performance-websockets.md`.
