---
id: ROADMAP-015
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

- [x] [[TASK-084: focused terminal latency baseline]]
- [x] [[TASK-085: focused transport ownership acceptance criteria]]

## Phase 2: Transport

- [x] [[TASK-086: focused terminal WebSocket exclusive output and input path]]
- [x] [[TASK-087: Vite dev proxy WebSocket support]]
- [x] [[TASK-088: coalesce focused WebSocket output frames]]

## Phase 3: Runtime

- [x] [[TASK-089: configurable live-update intervals and capture depths]]
- [x] [[TASK-090: tune focused capture defaults from measured data]]

## Phase 4: State

- [x] [[TASK-091: backend-owned agent status contract]]
- [x] [[TASK-092: dashboard status display uses backend status fields]]

## Phase 5: Validation

- [x] [[TASK-093: duplicate focused-capture regression checks]]
- [x] [[TASK-094: focused input echo-latency regression checks]]

## Notes

Derived from `raw/research/application-latency-structure/index.md` and wiki source `Application Latency Structure`.
