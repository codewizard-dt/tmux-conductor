---
id: UAT-084
title: "UAT: add event-loop delay and utilization metrics"
status: passed
task: TASK-084
created: 2026-07-04
updated: 2026-07-04
---

# UAT-084 — UAT: add event-loop delay and utilization metrics

implements::[[TASK-084]]

## Test Cases

### UAT-STATIC-001: Host compiler accepts event-loop metrics
- **Command**:
  ```bash
  npm --prefix host-server run typecheck
  ```
- **Expected Result**: Command exits 0.
- [x] Pass <!-- 2026-07-04 -->

### UAT-STATIC-002: Host observability guardrail passes
- **Command**:
  ```bash
  npm --prefix host-server run perf:test
  ```
- **Expected Result**: Command exits 0 and asserts `monitorEventLoopDelay` plus `eventLoopUtilization`.
- [x] Pass <!-- 2026-07-04 -->
