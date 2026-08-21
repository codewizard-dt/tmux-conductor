---
id: UAT-105
aliases: [UAT-105]
title: "UAT: focused input echo-latency regression checks"
status: passed
task: TASK-105
created: 2026-07-04
updated: 2026-07-04
---

# UAT-105 — UAT: focused input echo-latency regression checks

implements::[[TASK-105]]

> **Source task**: [[TASK-105]]
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

### Renumbering note

Originally filed as `UAT-094`. Renumbered to `UAT-105` on 2026-07-06 for consistency with the rest of the ROADMAP-015 UAT block, renumbered to resolve an ID collision with unrelated ROADMAP-016 UATs assigned the same numbers the same day.
