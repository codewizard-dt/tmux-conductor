---
id: UAT-073
title: "UAT: capture current dashboard performance baseline"
status: passed
task: TASK-073
created: 2026-06-28
updated: 2026-06-28
---

# UAT-073 — UAT: capture current dashboard performance baseline

implements::[[TASK-073]]

> **Source task**: [[TASK-073]]
> **Generated**: 2026-06-28

---

## Test Cases

### UAT-STATIC-001: Baseline script syntax is valid
- **Command**:
  ```bash
  bash -n scripts/measure-dashboard-performance.sh
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

### UAT-STATIC-003: Baseline document exists
- **Command**:
  ```bash
  test -f raw/research/dashboard-performance-websockets/current-baseline.md
  ```
- **Expected Result**: Command exits 0.
- [x] Pass <!-- 2026-06-28 -->
