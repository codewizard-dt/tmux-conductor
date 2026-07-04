---
id: UAT-093
title: "UAT: extend performance scripts and metric threshold docs"
status: passed
task: TASK-093
created: 2026-07-04
updated: 2026-07-04
---

# UAT-093 — UAT: extend performance scripts and metric threshold docs

implements::[[TASK-093]]

## Test Cases

### UAT-STATIC-001: Performance script syntax passes
- **Command**:
  ```bash
  bash -n scripts/measure-dashboard-performance.sh scripts/check-frontend-live-updates.sh
  ```
- **Expected Result**: Command exits 0.
- [x] Pass <!-- 2026-07-04 -->

### UAT-STATIC-002: Host observability guardrail passes
- **Command**:
  ```bash
  npm --prefix host-server run perf:test
  ```
- **Expected Result**: Command exits 0.
- [x] Pass <!-- 2026-07-04 -->

### UAT-STATIC-003: Frontend live-update guardrail passes
- **Command**:
  ```bash
  npm run check:frontend-live-updates
  ```
- **Expected Result**: Command exits 0.
- [x] Pass <!-- 2026-07-04 -->
