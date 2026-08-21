---
id: ROADMAP-016
aliases: [ROADMAP-016]
title: Observability improvements — event-loop, tmux, WebSocket, and debug traces
status: done
created: 2026-07-04
updated: 2026-07-04
owner: David Taylor
linked_requirements: []
linked_decisions: []
tags: [observability, metrics, logging]
---

# Roadmap 016: Observability improvements — event-loop, tmux, WebSocket, and debug traces

## Goal

Make latency and terminal stalls diagnosable by adding event-loop, tmux, WebSocket, input-latency, and status-transition metrics, then exposing structured logs and a local diagnostic workflow.

## Phase 1: Runtime Signals

- [x] [[TASK-084: add event-loop delay and utilization metrics]]
- [x] [[TASK-085: add tmux operation metrics with owner labels]]

## Phase 2: Terminal Signals

- [x] [[TASK-086: add terminal WebSocket lifecycle counters]]
- [x] [[TASK-087: add input-to-ack and input-to-echo latency metrics]]

## Phase 3: Logs

- [x] [[TASK-088: enable env-gated Fastify structured request logging]]
- [x] [[TASK-089: add status-transition JSONL records]]
- [x] [[TASK-090: add slow-loop and tmux-timeout JSONL records]]

## Phase 4: Diagnostics

- [x] [[TASK-091: add focused terminal debug overlay]]
- [x] [[TASK-092: add local diagnostic bundle command]]

## Phase 5: Guardrails

- [x] [[TASK-093: extend performance scripts and metric threshold docs]]

## Notes

Derived from `raw/research/application-latency-structure/index-2.md` and wiki source `Application Latency Observability Addendum`.
