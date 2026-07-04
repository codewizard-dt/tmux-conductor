---
id: UAT-087
title: "UAT: Vite dev proxy WebSocket support"
status: passed
task: TASK-087
created: 2026-07-04
updated: 2026-07-04
---

# UAT-087 — UAT: Vite dev proxy WebSocket support

implements::[[TASK-087]]

> **Source task**: [[TASK-087]]
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
