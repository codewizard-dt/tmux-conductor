---
id: UAT-082
aliases: [UAT-082]
title: "UAT: move direct input and focused output onto WebSocket path"
status: passed
task: TASK-082
created: 2026-06-28
updated: 2026-06-28
---

# UAT-082 — UAT: move direct input and focused output onto WebSocket path

implements::[[TASK-082]]

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
