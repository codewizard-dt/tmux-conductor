---
id: UAT-081
title: "UAT: focused terminal WebSocket transport"
status: passed
task: TASK-081
created: 2026-06-28
updated: 2026-06-28
---

# UAT-081 — UAT: focused terminal WebSocket transport

implements::[[TASK-081]]

## Test Cases

### UAT-STATIC-001: Host and frontend typechecks pass
- **Command**:
  ```bash
  npm --prefix host-server run typecheck
  npm --prefix frontend run typecheck
  ```
- **Expected Result**: Commands exit 0.
- [x] Pass <!-- 2026-06-28 -->

### UAT-STATIC-002: Host and frontend lint pass
- **Command**:
  ```bash
  npm --prefix host-server run lint
  npm --prefix frontend run lint
  ```
- **Expected Result**: Commands exit 0.
- [x] Pass <!-- 2026-06-28 -->
