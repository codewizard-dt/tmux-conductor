---
id: ROADMAP-015
title: Latency improvements — terminal transport, runtime knobs, state simplification
status: active
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

- [ ] Capture a representative focused-terminal latency baseline
- [ ] Define focused transport ownership acceptance criteria

## Phase 2: Transport

- [ ] Make focused terminal WebSocket the exclusive focused output/input path
- [ ] Fix Vite dev proxy WebSocket support
- [ ] Coalesce focused WebSocket output frames

## Phase 3: Runtime

- [ ] Add configurable live-update intervals and capture depths
- [ ] Tune focused capture defaults from measured data

## Phase 4: State

- [ ] Define a backend-owned agent status contract
- [ ] Migrate dashboard status display to backend status fields

## Phase 5: Validation

- [ ] Add duplicate focused-capture regression checks
- [ ] Add focused input echo-latency regression checks

## Notes

Derived from `raw/research/application-latency-structure/index.md` and wiki source `Application Latency Structure`.
