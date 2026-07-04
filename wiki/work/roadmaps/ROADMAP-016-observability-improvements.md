---
id: ROADMAP-016
title: Observability improvements — event-loop, tmux, WebSocket, and debug traces
status: active
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

- [ ] Add event-loop delay and utilization metrics
- [ ] Add tmux operation metrics with owner labels

## Phase 2: Terminal Signals

- [ ] Add terminal WebSocket lifecycle counters
- [ ] Add input-to-ack and input-to-echo latency metrics

## Phase 3: Logs

- [ ] Enable env-gated Fastify structured request logging
- [ ] Add status-transition JSONL records
- [ ] Add slow-loop and tmux-timeout JSONL records

## Phase 4: Diagnostics

- [ ] Add focused terminal debug overlay
- [ ] Add local diagnostic bundle command

## Phase 5: Guardrails

- [ ] Extend performance scripts to report observability metrics
- [ ] Document metric interpretation thresholds

## Notes

Derived from `raw/research/application-latency-structure/index-2.md` and wiki source `Application Latency Observability Addendum`.
