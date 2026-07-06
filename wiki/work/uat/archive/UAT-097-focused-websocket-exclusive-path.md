---
id: UAT-097
title: "UAT: focused terminal WebSocket exclusive output and input path"
status: passed
task: TASK-097
created: 2026-07-04
updated: 2026-07-04
---

# UAT-097 — UAT: focused terminal WebSocket exclusive output and input path

implements::[[TASK-097]]

> **Source task**: [[TASK-097]]
> **Generated**: 2026-07-04

---

## Test Cases

### UAT-STATIC-001: Frontend suppresses focused SSE while WebSocket is connected
- **Command**:
  ```bash
  rg -q "terminalWsConnected" frontend/src/components/LogTail.tsx && rg -q "!focused \\|\\| !terminalWsConnected" frontend/src/components/LogTail.tsx && rg -q "enabled = true" frontend/src/hooks/useSSE.ts
  ```
- **Expected Result**: Command exits 0.
- [x] Pass <!-- 2026-07-04 -->

### UAT-STATIC-002: Backend excludes WebSocket-owned panes from focused SSE capture
- **Command**:
  ```bash
  rg -q "focusedWebSocketAgents" host-server/index.ts && rg -q "!focusedWebSocketAgents.has\\(a.id\\)" host-server/index.ts
  ```
- **Expected Result**: Command exits 0.
- [x] Pass <!-- 2026-07-04 -->

### Renumbering note

Originally filed as `UAT-086`. Renumbered to `UAT-097` on 2026-07-06 to resolve an ID collision with an unrelated ROADMAP-016 UAT that was independently assigned the same number the same day.
