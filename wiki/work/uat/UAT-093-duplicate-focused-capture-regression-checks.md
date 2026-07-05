---
id: UAT-093
title: "UAT: duplicate focused-capture regression checks"
status: passed
task: TASK-093
created: 2026-07-04
updated: 2026-07-04
---

# UAT-093 — UAT: duplicate focused-capture regression checks

implements::[[TASK-093]]

> **Source task**: [[TASK-093]]
> **Generated**: 2026-07-04

---

## Test Cases

### UAT-STATIC-001: Host performance guard asserts exclusive focused ownership
- **Command**:
  ```bash
  npm --workspace host-server run perf:test
  ```
- **Expected Result**: Command exits 0 and prints `host performance checks passed`.
- [x] Pass <!-- 2026-07-04 -->
