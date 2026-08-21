---
id: TASK-105
aliases: [TASK-105]
title: "focused input echo-latency regression checks"
status: done
created: 2026-07-04
updated: 2026-07-04
depends_on: [TASK-097, TASK-098, TASK-099, TASK-101]
blocks: []
parallel_safe_with: [TASK-104]
uat: "[[UAT-105]]"
tags: [tests, websocket, latency, terminal, roadmap-015]
---

# TASK-105 — focused input echo-latency regression checks

## Objective

Add regression checks for focused terminal input echo latency so future changes do not silently reintroduce apparent input stalls.

## Approach

Use the focused WebSocket path to add measurable input acknowledgements or timing hooks, then create an automated check that verifies input-to-ack and input-to-output/echo behavior within a local threshold or records a clear failure when the scenario cannot run.

## Steps

### 1. Inspect focused input flow  <!-- agent: general-purpose -->

- [x] Inspect `frontend/src/lib/terminalWebSocket.ts`.
- [x] Inspect `frontend/src/components/LogTail.tsx` direct input handling.
- [x] Inspect `host-server/index.ts` WebSocket input message handling and `sendTextToPane`.

### 2. Add latency hooks/checks  <!-- agent: general-purpose -->

- [x] Add message ids or timing markers if needed to relate focused input to backend acknowledgement.
- [x] Add a regression script or test that exercises focused input echo timing against a local controlled pane when available.
- [x] Ensure the check reports a clear skipped/degraded result when no tmux session is available, without hiding static failures.

### 3. Verify  <!-- agent: general-purpose -->

- [x] Run host-server/frontend typechecks.
- [x] Run the new echo-latency regression command.

## Acceptance Criteria

- [x] Focused input latency is measurable through the WebSocket/direct-input path.
- [x] A regression check exists for input acknowledgement and echo/update timing.
- [x] The check is documented and wired into the relevant verification command.

## Dependencies

- **DEPENDS ON [TASK-097](TASK-097-focused-websocket-exclusive-path.md)**.
- **DEPENDS ON [TASK-098](TASK-098-vite-websocket-proxy.md)**.
- **DEPENDS ON [TASK-099](TASK-099-coalesce-focused-websocket-output.md)**.
- **DEPENDS ON [TASK-101](TASK-101-tune-focused-capture-defaults.md)**.

### Roadmap

Implements ROADMAP-015 Phase 5, item "Add focused input echo-latency regression checks" — `wiki/work/roadmaps/ROADMAP-015-latency-improvements.md`.

### Renumbering note

Originally filed as `TASK-094`. Renumbered to `TASK-105` on 2026-07-06 for consistency with the rest of the ROADMAP-015 task block, which was renumbered to resolve an ID collision with unrelated ROADMAP-016 tasks assigned the same numbers the same day. See `wiki/log.md` for the full renumbering record.
