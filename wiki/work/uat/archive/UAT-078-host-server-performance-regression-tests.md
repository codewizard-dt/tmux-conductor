---
id: UAT-078
title: "UAT: host-server performance regression tests"
status: passed
task: TASK-078
created: 2026-06-28
updated: 2026-06-28
---

# UAT-078 — UAT: host-server performance regression tests

implements::[[TASK-078]]

## Test Cases

### UAT-STATIC-001: Host performance test command passes
- **Command**:
  ```bash
  npm --prefix host-server run perf:test
  ```
- **Expected Result**: Command exits 0.
- [x] Pass <!-- 2026-06-28 -->

### UAT-STATIC-002: Host-server typecheck passes
- **Command**:
  ```bash
  npm --prefix host-server run typecheck
  ```
- **Expected Result**: Command exits 0.
- [x] Pass <!-- 2026-06-28 -->
