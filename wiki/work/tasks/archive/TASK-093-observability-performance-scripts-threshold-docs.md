---
id: TASK-093
aliases: [TASK-093]
title: "extend performance scripts and metric threshold docs"
status: done
created: 2026-07-04
updated: 2026-07-04
depends_on: []
blocks: []
parallel_safe_with: [TASK-084, TASK-085, TASK-086, TASK-087, TASK-088, TASK-089, TASK-090, TASK-091, TASK-092]
uat: "[[UAT-093]]"
tags: [observability, docs, guardrails, roadmap-016]
---

# TASK-093 — extend performance scripts and metric threshold docs

## Objective

Make observability metrics part of the repeatable local performance workflow and document initial interpretation thresholds.

## Approach

Extend `scripts/measure-dashboard-performance.sh`, strengthen `scripts/test-host-performance.mjs`, and update local observability/budget wiki pages.

## Steps

- [x] Report event-loop metrics, WebSocket counters, input latency, and tmux owner timings from the benchmark script.
- [x] Add static guardrails for observability hooks.
- [x] Document metric thresholds in `wiki/knowledge/concepts/local-observability.md`.
- [x] Update dashboard performance budget guidance.

## Acceptance Criteria

- [x] Performance scripts report the new observability metrics.
- [x] Threshold docs exist for event-loop, WebSocket, input latency, and tmux timeouts.

## Verification

- [x] `bash -n scripts/measure-dashboard-performance.sh`
- [x] `npm --prefix host-server run perf:test`
- [x] `npm run check:frontend-live-updates`

### Roadmap

Implements ROADMAP-016 Phase 5 items "Extend performance scripts to report observability metrics" and "Document metric interpretation thresholds".
