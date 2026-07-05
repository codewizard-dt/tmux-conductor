---
id: TASK-090
title: "tune focused capture defaults from measured data"
status: done
created: 2026-07-04
updated: 2026-07-04
depends_on: [TASK-084, TASK-086, TASK-088, TASK-089]
blocks: [TASK-093, TASK-094]
parallel_safe_with: [TASK-092]
uat: "[[UAT-090]]"
tags: [performance, config, terminal, roadmap-015]
---

# TASK-090 — tune focused capture defaults from measured data

## Objective

Set focused terminal capture defaults from the ROADMAP-015 baseline and post-transport measurements.

## Approach

Use the TASK-084 baseline and the exclusive/coalesced WebSocket path to choose conservative defaults that reduce capture work without making the focused terminal feel stale.

## Steps

### 1. Review evidence  <!-- agent: general-purpose -->

- [x] Read the TASK-084 baseline report under `raw/research/focused-terminal-latency-baseline/`.
- [x] Inspect effective config keys added by TASK-089.
- [x] Inspect the focused WebSocket ownership/coalescing behavior from TASK-086 and TASK-088.

### 2. Tune defaults  <!-- agent: general-purpose -->

- [x] Adjust default focused interval and focused capture depth in `conductor.conf` or `host-server/config.ts`.
- [x] Keep normal dashboard/status update defaults conservative unless measured evidence supports changing them.
- [x] Update any docs that describe the defaults.

### 3. Verify and record  <!-- agent: general-purpose -->

- [x] Re-run the focused terminal measurement command.
- [x] Record the tuned-default rationale in the baseline research folder or a follow-up report.
- [x] Run host-server/frontend verification affected by the defaults.

## Acceptance Criteria

- [x] Focused capture defaults are explicitly justified by measured data.
- [x] Before/after metrics are recorded.
- [x] Verification passes with the tuned defaults.

## Dependencies

- **DEPENDS ON [TASK-084](TASK-084-focused-terminal-latency-baseline.md)**.
- **DEPENDS ON [TASK-086](TASK-086-focused-websocket-exclusive-path.md)**.
- **DEPENDS ON [TASK-088](TASK-088-coalesce-focused-websocket-output.md)**.
- **DEPENDS ON [TASK-089](TASK-089-live-update-runtime-knobs.md)**.

### Roadmap

Implements ROADMAP-015 Phase 3, item "Tune focused capture defaults from measured data" — `wiki/work/roadmaps/ROADMAP-015-latency-improvements.md`.
