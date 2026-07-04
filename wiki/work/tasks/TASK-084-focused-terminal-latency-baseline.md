---
id: TASK-084
title: "focused terminal latency baseline"
status: done
created: 2026-07-04
updated: 2026-07-04
depends_on: []
blocks: [TASK-086, TASK-089, TASK-090]
parallel_safe_with: [TASK-085, TASK-087, TASK-091]
uat: "[[UAT-084]]"
tags: [performance, latency, terminal, roadmap-015]
---

# TASK-084 — focused terminal latency baseline

## Objective

Capture a representative focused-terminal latency baseline before changing focused transport ownership or runtime defaults.

## Approach

Use the existing `/api/perf/live-updates` metrics plus lightweight browser-side timing around focused terminal output receipt and xterm repaint. Keep this task observational: do not change transport ownership, polling intervals, or capture depths.

## Steps

### 1. Review the current hot path  <!-- agent: general-purpose -->

- [x] Read `raw/research/focused-terminal-latency-baseline/index.md`.
- [x] Inspect `host-server/index.ts` focused terminal constants, focused SSE loop, WebSocket route, and `/api/perf/live-updates` response.
- [x] Inspect `frontend/src/components/LogTail.tsx` focused WebSocket and focused SSE output handling.

<!-- Updated: 2026-07-04 05:54 -->

### 2. Add repeatable baseline tooling  <!-- agent: general-purpose -->

- [x] Add a repo-local script or documented command sequence under `scripts/` or `raw/research/focused-terminal-latency-baseline/` that samples `/api/perf/live-updates` before, during, and after a focused terminal session.
- [x] Add dev-only browser timing instrumentation or a helper that records focused output receipt-to-repaint samples using `performance.now()` and `requestAnimationFrame()`.
- [x] Store raw baseline data under `raw/research/focused-terminal-latency-baseline/`.

<!-- Updated: 2026-07-04 06:02 -->

### 3. Record the baseline report  <!-- agent: general-purpose -->

- [x] Capture at least 30 focused terminal update samples from a representative local agent detail session.
- [x] Summarize median, p95, and max for backend focused tick/capture timing and browser receipt-to-repaint timing.
- [x] Record observed transport ownership: whether focused WebSocket, focused SSE, or both were active.
- [x] Do not tune intervals, remove capture paths, or change fallback behavior in this task.

<!-- Updated: 2026-07-04 06:02 -->

## Acceptance Criteria

- [x] A durable baseline report exists under `raw/research/focused-terminal-latency-baseline/`.
- [x] The report includes backend metric snapshots, browser receipt-to-repaint samples, and the local scenario description.
- [x] The report explicitly records whether duplicate focused output paths were active.

<!-- Updated: 2026-07-04 06:02 -->

## Dependencies

None.

### Roadmap

Implements ROADMAP-015 Phase 1, item "Capture a representative focused-terminal latency baseline" — `wiki/work/roadmaps/ROADMAP-015-latency-improvements.md`.
