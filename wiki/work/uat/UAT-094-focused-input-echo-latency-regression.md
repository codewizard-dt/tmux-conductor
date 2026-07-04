---
id: UAT-094
title: "UAT: focused input echo-latency regression checks"
status: passed
task: TASK-094
created: 2026-07-04
updated: 2026-07-04
---

# UAT-094 — UAT: focused input echo-latency regression checks

implements::[[TASK-094]]

> **Source task**: [[TASK-094]]
> **Generated**: 2026-07-04

---

## Test Cases

### UAT-STATIC-001: Focused WebSocket input acknowledgements are measurable
- **Command**:
  ```bash
  rg -q "inputId" frontend/src/lib/terminalWebSocket.ts && rg -q "sentAt" frontend/src/lib/terminalWebSocket.ts && rg -q "acknowledgedAt" host-server/index.ts && rg -q "recordFocusedInputAck" frontend/src/components/LogTail.tsx
  ```
- **Expected Result**: Command exits 0.
- [x] Pass <!-- 2026-07-04 -->
