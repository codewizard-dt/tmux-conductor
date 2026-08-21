---
id: TASK-100
aliases: [TASK-100]
title: "configurable live-update intervals and capture depths"
status: done
created: 2026-07-04
updated: 2026-07-04
depends_on: [TASK-095]
blocks: [TASK-101, TASK-104]
parallel_safe_with: [TASK-096, TASK-098, TASK-102]
uat: "[[UAT-100]]"
tags: [host-server, config, performance, roadmap-015]
---

# TASK-100 — configurable live-update intervals and capture depths

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
- [x] Keep existing defaults until TASK-101 tunes them from the baseline.
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

- **DEPENDS ON [TASK-095](TASK-095-focused-terminal-latency-baseline.md)**.

### Roadmap

Implements ROADMAP-015 Phase 3, item "Add configurable live-update intervals and capture depths" — `wiki/work/roadmaps/ROADMAP-015-latency-improvements.md`.

### Renumbering note

Originally filed as `TASK-089`. Renumbered to `TASK-100` on 2026-07-06 to resolve an ID collision with an unrelated ROADMAP-016 task that was independently assigned the same number the same day. See `wiki/log.md` for the full renumbering record.
