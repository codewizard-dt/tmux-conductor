---
id: UAT-090
aliases: [UAT-090]
title: "UAT: add slow-loop and tmux-timeout JSONL records"
status: passed
task: TASK-090
created: 2026-07-04
updated: 2026-07-04
---

# UAT-090 — UAT: add slow-loop and tmux-timeout JSONL records

implements::[[TASK-090]]

## Test Cases

### UAT-STATIC-001: Host guardrail asserts slow-loop and tmux-timeout hooks
- **Command**:
  ```bash
  npm --prefix host-server run perf:test
  ```
- **Expected Result**: Command exits 0 and asserts `slow_loop` plus `tmux_timeout`.
- [x] Pass <!-- 2026-07-04 -->

### UAT-STATIC-002: Host lint passes
- **Command**:
  ```bash
  npm --prefix host-server run lint
  ```
- **Expected Result**: Command exits 0.
- [x] Pass <!-- 2026-07-04 -->
