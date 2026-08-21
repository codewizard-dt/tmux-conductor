---
id: UAT-100
aliases: [UAT-100]
title: "UAT: configurable live-update intervals and capture depths"
status: passed
task: TASK-100
created: 2026-07-04
updated: 2026-07-04
---

# UAT-100 — UAT: configurable live-update intervals and capture depths

implements::[[TASK-100]]

> **Source task**: [[TASK-100]]
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

### Renumbering note

Originally filed as `UAT-089`. Renumbered to `UAT-100` on 2026-07-06 to resolve an ID collision with an unrelated ROADMAP-016 UAT that was independently assigned the same number the same day.
