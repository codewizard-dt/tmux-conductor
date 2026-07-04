---
id: UAT-085
title: "UAT: add tmux operation metrics with owner labels"
status: passed
task: TASK-085
created: 2026-07-04
updated: 2026-07-04
---

# UAT-085 — UAT: add tmux operation metrics with owner labels

implements::[[TASK-085]]

## Test Cases

### UAT-STATIC-001: Host guardrail asserts tmux observability hooks
- **Command**:
  ```bash
  npm --prefix host-server run perf:test
  ```
- **Expected Result**: Command exits 0 and asserts `tmuxOperations`, `tmux_timeout`, and existing capture timings.
- [x] Pass <!-- 2026-07-04 -->

### UAT-STATIC-002: Benchmark script syntax passes
- **Command**:
  ```bash
  bash -n scripts/measure-dashboard-performance.sh
  ```
- **Expected Result**: Command exits 0.
- [x] Pass <!-- 2026-07-04 -->
