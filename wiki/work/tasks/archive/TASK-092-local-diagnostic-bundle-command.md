---
id: TASK-092
title: "add local diagnostic bundle command"
status: done
created: 2026-07-04
updated: 2026-07-04
depends_on: []
blocks: []
parallel_safe_with: [TASK-084, TASK-085, TASK-086, TASK-087, TASK-088, TASK-089, TASK-090, TASK-091, TASK-093]
uat: "[[UAT-092]]"
tags: [observability, diagnostics, scripts, roadmap-016]
---

# TASK-092 — add local diagnostic bundle command

## Objective

Provide a one-command local diagnostic bundle for terminal stalls and latency debugging.

## Approach

Add `scripts/collect-diagnostics.sh` and expose it as `npm run diagnostics:bundle`, writing timestamped output under repo-local `./tmp/diagnostics/`.

## Steps

- [x] Capture `/api/perf/live-updates` when the host server is reachable.
- [x] Summarize event-loop, WebSocket, and timing health.
- [x] Copy local JSONL logs and tmux session/window listings when available.
- [x] Keep all bundle output under `./tmp/diagnostics/`.

## Acceptance Criteria

- [x] `npm run diagnostics:bundle` exits successfully.
- [x] The script uses repo-local `./tmp/` for output.

## Verification

- [x] `bash -n scripts/collect-diagnostics.sh`
- [x] `npm run diagnostics:bundle`

### Roadmap

Implements ROADMAP-016 Phase 4 item "Add local diagnostic bundle command".
