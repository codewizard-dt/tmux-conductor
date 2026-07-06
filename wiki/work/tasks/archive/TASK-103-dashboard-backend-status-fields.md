---
id: TASK-103
title: "dashboard status display uses backend status fields"
status: done
created: 2026-07-04
updated: 2026-07-04
depends_on: [TASK-102]
blocks: []
parallel_safe_with: [TASK-101]
uat: "[[UAT-103]]"
tags: [frontend, state, dashboard, roadmap-015]
---

# TASK-103 — dashboard status display uses backend status fields

## Objective

Migrate dashboard status rendering to backend-owned status fields.

## Approach

Update frontend API types and components so badges, CTAs, active task display, and waiting/stalled UI use backend-provided status/evidence fields. Remove or reduce local derivation that duplicates host-server state detection.

## Steps

### 1. Locate frontend status derivation  <!-- agent: general-purpose -->

- [x] Inspect `frontend/src/lib/api.ts` status-related types.
- [x] Inspect `frontend/src/components/AgentList.tsx`, `AgentDetailModal.tsx`, and any status badge helpers.
- [x] Search for local string checks against busy/idle/awaiting/stalled/exited.

### 2. Consume backend contract  <!-- agent: general-purpose -->

- [x] Update frontend types to match TASK-102's backend status contract.
- [x] Render status badge labels from backend status fields.
- [x] Use backend active-task fields for busy/awaiting/stalled display.
- [x] Keep UI copy consistent: use "waiting" for user-action-required display if that is the existing dashboard label.

### 3. Verify  <!-- agent: general-purpose -->

- [x] Run frontend typecheck.
- [x] Run any relevant UI/static tests.

## Acceptance Criteria

- [x] Dashboard status badges are driven by backend status fields.
- [x] Active-task display remains visible for busy, waiting, and stalled statuses.
- [x] Frontend typecheck passes.

## Dependencies

- **DEPENDS ON [TASK-102](TASK-102-backend-owned-agent-status-contract.md)**.

### Roadmap

Implements ROADMAP-015 Phase 4, item "Migrate dashboard status display to backend status fields" — `wiki/work/roadmaps/ROADMAP-015-latency-improvements.md`.

### Renumbering note

Originally filed as `TASK-092`. Renumbered to `TASK-103` on 2026-07-06 to resolve an ID collision with an unrelated ROADMAP-016 task that was independently assigned the same number the same day. See `wiki/log.md` for the full renumbering record.
