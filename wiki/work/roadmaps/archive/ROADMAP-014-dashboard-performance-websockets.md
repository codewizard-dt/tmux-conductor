---
id: ROADMAP-014
title: Dashboard performance — instrumentation, capture optimization, WebSocket terminal
status: done
created: 2026-06-28
updated: 2026-06-28
owner: David Taylor
linked_requirements: []
linked_decisions: []
tags: [performance, dashboard, websockets]
---

# Roadmap 014: Dashboard performance — instrumentation, capture optimization, WebSocket terminal

## Goal

Reduce dashboard live-update overhead with measured baselines, regression performance tests, optimized capture/SSE behavior, and a focused WebSocket terminal path where it proves faster.

## Phase 1: Baseline

- [x] [[TASK-072: live-update timing instrumentation and counters]]
- [x] [[TASK-073: capture current dashboard performance baseline]]
- [x] [[TASK-074: identify performance budgets for live updates]]

## Phase 2: Optimize

- [x] [[TASK-075: consolidate dashboard EventSource usage]]
- [x] [[TASK-076: reduce focused terminal capture overhead]]
- [x] [[TASK-077: remove avoidable duplicate tmux capture work]]

## Phase 3: Guardrails

- [x] [[TASK-078: host-server performance regression tests]]
- [x] [[TASK-079: frontend live-update performance checks]]
- [x] [[TASK-080: benchmark documentation and repeatable commands]]

## Phase 4: WebSocket

- [x] [[TASK-081: focused terminal WebSocket transport]]
- [x] [[TASK-082: move direct input and focused output onto WebSocket path]]
- [x] [[TASK-083: compare optimized SSE and WebSocket performance]]

## Notes

Grounding research:
- `raw/research/websocket-dashboard-transport/index.md`
- `raw/research/dashboard-performance-websockets/index.md`
