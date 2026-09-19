---
id: ROADMAP-019
title: Agent Status Transition Observability
aliases: [ROADMAP-019]
status: done
created: 2026-09-13
updated: 2026-09-13
owner: David Taylor
linked_requirements: []
linked_decisions: []
tags: [observability, agents, logging]
---

# Roadmap 019: Agent Status Transition Observability

## Goal

Every agent status transition — from either detector (host-server's `detectAgentStatus`, `monitor.sh`'s `is_idle`) — is logged to `logs/transitions.jsonl` with from/to state, detection reason, matched pattern, and a reused pane-text snapshot, so a future pass can retroactively analyze and improve the transition-detection logic itself.

## Phase 0: Detector plumbing

- [x] [[TASK-142: Widen detectAgentStatus's return type to expose detection reason and matched pattern]]

## Phase 1: Host-server transitions.jsonl

- [x] [[TASK-143: Add transitions.jsonl log to the host-server, capturing reason + pane snapshot per status change]]

## Phase 2: Bash mirror (monitor.sh)

- [x] [[TASK-144: Mirror transitions.jsonl logging in monitor.sh's is_idle() for the hookless/regex-fallback path]]

## Phase 3: Docs + diagnostics

- [x] [[TASK-145: Document transitions.jsonl and add it to the diagnostic bundle]]

## Notes

Grounded in `raw/research/transition-observability/index.md` (2026-09-13) — see that report for the full current-state analysis, prior-attempt history (F7, `application-latency-structure/index-2.md`, never implemented), and risk/mitigation detail.
