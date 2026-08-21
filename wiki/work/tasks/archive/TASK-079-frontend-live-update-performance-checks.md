---
id: TASK-079
aliases: [TASK-079]
title: "frontend live-update performance checks"
status: done
created: 2026-06-28
updated: 2026-06-28
depends_on: [TASK-074, TASK-075]
blocks: []
parallel_safe_with: [TASK-078, TASK-080]
uat: "[[UAT-079]]"
tags: [frontend, tests, performance, roadmap-014]
---

# TASK-079 — frontend live-update performance checks

## Objective

Add frontend checks that protect against duplicate EventSource connections and excessive live-update rerender work.

## Approach

Prefer static and lightweight runtime checks that fit the repo's current frontend toolchain. At minimum, add a script or lint-style test that verifies dashboard code uses the shared SSE hook rather than direct `new EventSource` calls outside the hook.

## Steps

### 1. Inspect frontend tooling  <!-- agent: general-purpose -->

- [x] Read `frontend/package.json`, `frontend/eslint.config.mjs`, and `frontend/src/hooks/useSSE.ts`.
- [x] Check whether a test runner already exists; do not add a large framework unless necessary.

### 2. Add checks  <!-- agent: general-purpose -->

- [x] Add `scripts/check-frontend-live-updates.sh` or an equivalent Node script.
- [x] Verify direct `new EventSource` usage appears only in `frontend/src/hooks/useSSE.ts`.
- [x] If practical, add a small hook-level test or static check for reference-counted subscribers.

### 3. Wire command  <!-- agent: general-purpose -->

- [x] Add a frontend or root npm script for live-update performance checks.
- [x] Document the command in the benchmark documentation if TASK-080 already exists; otherwise leave a note in the script header.

### 4. Verify  <!-- agent: general-purpose -->

- [x] Run the new frontend live-update check.
- [x] Run `npm --prefix frontend run typecheck`.
- [x] Run `npm --prefix frontend run lint`.

## Acceptance Criteria

- [x] A repeatable check fails if dashboard components instantiate their own EventSource.
- [x] The check is available through npm or scripts.
- [x] Frontend typecheck and lint pass.

## Dependencies

Depends on TASK-074 and TASK-075.

### Roadmap

Implements ROADMAP-014 Phase 3, item "Add frontend live-update performance checks" — `wiki/work/roadmaps/ROADMAP-014-dashboard-performance-websockets.md`.
