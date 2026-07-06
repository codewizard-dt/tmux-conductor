---
id: UAT-099
title: "UAT: coalesce focused WebSocket output frames"
status: passed
task: TASK-099
created: 2026-07-04
updated: 2026-07-04
---

# UAT-099 — UAT: coalesce focused WebSocket output frames

implements::[[TASK-099]]

> **Source task**: [[TASK-099]]
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

### Renumbering note

Originally filed as `UAT-088`. Renumbered to `UAT-099` on 2026-07-06 to resolve an ID collision with an unrelated ROADMAP-016 UAT that was independently assigned the same number the same day.
