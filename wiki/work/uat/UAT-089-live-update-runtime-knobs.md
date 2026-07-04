---
id: UAT-089
title: "UAT: configurable live-update intervals and capture depths"
status: passed
task: TASK-089
created: 2026-07-04
updated: 2026-07-04
---

# UAT-089 — UAT: configurable live-update intervals and capture depths

implements::[[TASK-089]]

> **Source task**: [[TASK-089]]
> **Generated**: 2026-07-04

---

## Test Cases

### UAT-STATIC-001: Runtime knobs are parsed and surfaced
- **Command**:
  ```bash
  rg -q "STATUS_POLL_MS" conductor.conf host-server/config.ts && rg -q "FOCUSED_TERMINAL_WS_POLL_MS" conductor.conf host-server/config.ts && rg -q "focusedTerminalTailLines" host-server/index.ts
  ```
- **Expected Result**: Command exits 0.
- [x] Pass <!-- 2026-07-04 -->
