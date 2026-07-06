---
id: UAT-098
title: "UAT: Vite dev proxy WebSocket support"
status: passed
task: TASK-098
created: 2026-07-04
updated: 2026-07-04
---

# UAT-098 — UAT: Vite dev proxy WebSocket support

implements::[[TASK-098]]

> **Source task**: [[TASK-098]]
> **Generated**: 2026-07-04

---

## Test Cases

### UAT-STATIC-001: Vite `/api` proxy enables WebSocket upgrades
- **Command**:
  ```bash
  rg -q "ws: true" frontend/vite.config.ts && rg -q "PROXY_TARGET" frontend/vite.config.ts
  ```
- **Expected Result**: Command exits 0.
- [x] Pass <!-- 2026-07-04 -->

### Renumbering note

Originally filed as `UAT-087`. Renumbered to `UAT-098` on 2026-07-06 to resolve an ID collision with an unrelated ROADMAP-016 UAT that was independently assigned the same number the same day.
