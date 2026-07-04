---
title: "Current Dashboard Performance Baseline"
date: 2026-06-28
source_task: TASK-073
---

# Current Dashboard Performance Baseline

## Command

```bash
HOST_URL=http://localhost:8788/api DURATION_SECONDS=30 bash scripts/measure-dashboard-performance.sh
```

## Environment

- Local host-server exposing `GET /api/perf/live-updates`.
- Dashboard may be open in a browser to include real SSE connection fanout.
- tmux session and agent count should be noted beside any copied result.

## Baseline Fields

The script records count deltas, rates, total duration deltas, and max observed duration for:

- `statusTicks`
- `terminalTicks`
- `focusedTerminalTicks`
- `tmuxCaptureTail`
- `tmuxCaptureTailRaw`
- `sseBroadcasts`
- `tailRequests`

## Initial Run

The baseline command is repeatable. This automation pass did not keep a long-running dashboard session open for a representative local measurement, so the measured values should be captured on the target developer machine before tightening budgets.
