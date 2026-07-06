---
id: UAT-104
title: "UAT: duplicate focused-capture regression checks"
status: passed
task: TASK-104
created: 2026-07-04
updated: 2026-07-04
---

# UAT-104 — UAT: duplicate focused-capture regression checks

implements::[[TASK-104]]

> **Source task**: [[TASK-104]]
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

### Renumbering note

Originally filed as `UAT-093`. Renumbered to `UAT-104` on 2026-07-06 to resolve an ID collision with an unrelated ROADMAP-016 UAT ("extend performance scripts and metric threshold docs") that was independently assigned the same number the same day.
