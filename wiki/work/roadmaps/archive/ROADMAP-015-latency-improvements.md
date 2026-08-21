---
id: ROADMAP-015
aliases: [ROADMAP-015]
title: Latency improvements — terminal transport, runtime knobs, state simplification
status: done
created: 2026-07-04
updated: 2026-07-04
owner: David Taylor
linked_requirements: []
linked_decisions: []
tags: [performance, terminal, websocket]
---

# Roadmap 015: Latency improvements — terminal transport, runtime knobs, state simplification

## Goal

Reduce dashboard and focused-terminal latency by removing duplicate focused capture, making WebSocket the exclusive focused terminal path, adding runtime tuning for live updates, and simplifying agent status determination into a backend-owned contract.

## Phase 1: Baseline

- [x] [[TASK-095: focused terminal latency baseline]]
- [x] [[TASK-096: focused transport ownership acceptance criteria]]

## Phase 2: Transport

- [x] [[TASK-097: focused terminal WebSocket exclusive output and input path]]
- [x] [[TASK-098: Vite dev proxy WebSocket support]]
- [x] [[TASK-099: coalesce focused WebSocket output frames]]

## Phase 3: Runtime

- [x] [[TASK-100: configurable live-update intervals and capture depths]]
- [x] [[TASK-101: tune focused capture defaults from measured data]]

## Phase 4: State

- [x] [[TASK-102: backend-owned agent status contract]]
- [x] [[TASK-103: dashboard status display uses backend status fields]]

## Phase 5: Validation

- [x] [[TASK-104: duplicate focused-capture regression checks]]
- [x] [[TASK-105: focused input echo-latency regression checks]]

## Notes

Derived from `raw/research/application-latency-structure/index.md` and wiki source `Application Latency Structure`.

**Renumbering (2026-07-06):** this roadmap's tasks were originally filed as TASK-084 through TASK-094. They were renumbered to TASK-095–TASK-105 (and their UATs to UAT-095–UAT-105) after an audit found the entire block collided with unrelated ROADMAP-016 tasks independently assigned the same IDs the same day (2026-07-04). See `wiki/log.md` for the full record.
