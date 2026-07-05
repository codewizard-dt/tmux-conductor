---
id: UAT-088
title: "UAT: coalesce focused WebSocket output frames"
status: passed
task: TASK-088
created: 2026-07-04
updated: 2026-07-04
---

# UAT-088 — UAT: coalesce focused WebSocket output frames

implements::[[TASK-088]]

> **Source task**: [[TASK-088]]
> **Generated**: 2026-07-04

---

## Test Cases

### UAT-STATIC-001: WebSocket output is change-aware and backpressure-aware
- **Command**:
  ```bash
  rg -q "text === lastText" host-server/index.ts && rg -q "socket.bufferedAmount > FOCUSED_WS_BUFFERED_BYTES_LIMIT" host-server/index.ts
  ```
- **Expected Result**: Command exits 0.
- [x] Pass <!-- 2026-07-04 -->
