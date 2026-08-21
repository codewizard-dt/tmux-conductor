---
id: UAT-086
aliases: [UAT-086]
title: "UAT: add terminal WebSocket lifecycle counters"
status: passed
task: TASK-086
created: 2026-07-04
updated: 2026-07-04
---

# UAT-086 — UAT: add terminal WebSocket lifecycle counters

implements::[[TASK-086]]

## Test Cases

### UAT-STATIC-001: Host guardrail asserts WebSocket metrics
- **Command**:
  ```bash
  npm --prefix host-server run perf:test
  ```
- **Expected Result**: Command exits 0 and asserts `terminalWebSocket`.
- [x] Pass <!-- 2026-07-04 -->

### UAT-STATIC-002: Host typecheck passes
- **Command**:
  ```bash
  npm --prefix host-server run typecheck
  ```
- **Expected Result**: Command exits 0.
- [x] Pass <!-- 2026-07-04 -->
