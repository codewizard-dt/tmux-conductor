---
id: TASK-089
title: "configurable live-update intervals and capture depths"
status: done
created: 2026-07-04
updated: 2026-07-04
depends_on: [TASK-084]
blocks: [TASK-090, TASK-093]
parallel_safe_with: [TASK-085, TASK-087, TASK-091]
uat: "[[UAT-089]]"
tags: [host-server, config, performance, roadmap-015]
---

# TASK-089 — configurable live-update intervals and capture depths

## Objective

Make dashboard live-update intervals and terminal capture depths configurable at runtime instead of hard-coded in the host-server.

## Approach

Add tuning settings to `conductor.conf` and `host-server/config.ts`, resolve defaults centrally, and consume those settings in `host-server/index.ts` for status ticks, normal terminal ticks, focused terminal ticks, and capture line depths.

## Steps

### 1. Locate hard-coded live-update settings  <!-- agent: general-purpose -->

- [x] Inspect `host-server/index.ts` constants for status polling, normal terminal polling, focused terminal polling, and tail line counts.
- [x] Inspect `host-server/config.ts` conductor.conf parsing.
- [x] Inspect `conductor.conf` and `.env.example` only if needed; do not read or write `.env`.

<!-- Updated: 2026-07-04 05:53 -->

### 2. Add config fields  <!-- agent: general-purpose -->

- [x] Add conductor.conf keys for status interval, terminal interval, focused terminal interval, normal tail depth, focused tail depth, and any focused WebSocket interval if separate.
- [x] Parse the keys in `host-server/config.ts` with safe numeric defaults.
- [x] Ensure relative path behavior and existing config parsing remain unchanged.

<!-- Updated: 2026-07-04 05:55 -->

### 3. Consume runtime knobs  <!-- agent: general-purpose -->

- [x] Replace hard-coded host-server constants with config-derived values.
- [x] Keep existing defaults until TASK-090 tunes them from the baseline.
- [x] Surface the effective values in `/api/perf/live-updates` if that endpoint already reports runtime settings.

<!-- Updated: 2026-07-04 05:57 -->

### 4. Verify  <!-- agent: general-purpose -->

- [x] Run host-server typecheck.
- [x] Run any config/performance static tests.

<!-- Updated: 2026-07-04 05:57 -->

## Acceptance Criteria

- [x] Live-update intervals and terminal capture depths are configurable through conductor.conf.
- [x] Defaults preserve current behavior before tuning.
- [x] Host-server typecheck and relevant static tests pass.

## Dependencies

- **DEPENDS ON [TASK-084](TASK-084-focused-terminal-latency-baseline.md)**.

### Roadmap

Implements ROADMAP-015 Phase 3, item "Add configurable live-update intervals and capture depths" — `wiki/work/roadmaps/ROADMAP-015-latency-improvements.md`.
