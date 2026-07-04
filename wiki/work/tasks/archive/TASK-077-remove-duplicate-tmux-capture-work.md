---
id: TASK-077
title: "remove avoidable duplicate tmux capture work"
status: done
created: 2026-06-28
updated: 2026-06-28
depends_on: [TASK-076]
blocks: [TASK-078, TASK-083]
parallel_safe_with: [TASK-075]
uat: "[[UAT-077]]"
tags: [tmux, performance, roadmap-014]
---

# TASK-077 — remove avoidable duplicate tmux capture work

## Objective

Eliminate duplicate `tmux capture-pane` calls that happen within the same host-server tick or request path.

## Approach

Reuse captured pane text across status, mode, active task, and terminal output calculations where the code already has a fresh snapshot. Keep scope tight to host-server capture paths.

## Steps

### 1. Find duplicate capture sites  <!-- agent: general-purpose -->

- [x] Read `host-server/index.ts` and `host-server/state.ts`.
- [x] Use existing TASK-072 metrics to identify capture counters that can increment more than once per agent per tick.

### 2. Reuse capture data  <!-- agent: general-purpose -->

- [x] Refactor status-building code to pass the same 15-line capture into `detectAgentStatus` and `detectAgentMode`.
- [x] Ensure terminal broadcast loops do not recapture panes that were already captured for the same agent and interval unless different raw/full-fidelity output is required.
- [x] Keep focused raw capture separate when xterm fidelity requires it.

### 3. Guard behavior  <!-- agent: general-purpose -->

- [x] Add small unit-level or integration-level assertions where existing test infrastructure allows.
- [x] Confirm no path treats a transient empty capture as a reliable status downgrade if prior code avoided that.

### 4. Verify  <!-- agent: general-purpose -->

- [x] Run `npm --prefix host-server run typecheck`.
- [x] Run `npm --prefix host-server run lint`.

## Acceptance Criteria

- [x] Normal dashboard status updates reuse pane captures where practical.
- [x] Focused raw terminal capture fidelity is preserved.
- [x] Capture counters from TASK-072 show fewer duplicate calls for equivalent dashboard state.
- [x] Host-server typecheck and lint pass.

## Dependencies

Depends on TASK-076 because focused capture behavior should be stabilized first.

### Roadmap

Implements ROADMAP-014 Phase 2, item "Remove avoidable duplicate tmux capture work" — `wiki/work/roadmaps/ROADMAP-014-dashboard-performance-websockets.md`.
