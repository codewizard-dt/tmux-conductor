---
id: UAT-089
title: "UAT: add status-transition JSONL records"
status: passed
task: TASK-089
created: 2026-07-04
updated: 2026-07-04
---

# UAT-089 — UAT: add status-transition JSONL records

implements::[[TASK-089]]

## Test Cases

### UAT-STATIC-001: Host guardrail asserts status-transition logging
- **Command**:
  ```bash
  npm --prefix host-server run perf:test
  ```
- **Expected Result**: Command exits 0 and asserts `status_transition` and `observability.jsonl`.
- [x] Pass <!-- 2026-07-04 -->

### UAT-STATIC-002: Host typecheck passes
- **Command**:
  ```bash
  npm --prefix host-server run typecheck
  ```
- **Expected Result**: Command exits 0.
- [x] Pass <!-- 2026-07-04 -->
