---
id: UAT-087
aliases: [UAT-087]
title: "UAT: add input-to-ack and input-to-echo latency metrics"
status: passed
task: TASK-087
created: 2026-07-04
updated: 2026-07-04
---

# UAT-087 — UAT: add input-to-ack and input-to-echo latency metrics

implements::[[TASK-087]]

## Test Cases

### UAT-STATIC-001: Host timing names are guarded
- **Command**:
  ```bash
  npm --prefix host-server run perf:test
  ```
- **Expected Result**: Command exits 0 and asserts `terminalWsInputAck` and `terminalWsInputEcho`.
- [x] Pass <!-- 2026-07-04 -->

### UAT-STATIC-002: Frontend WebSocket message contract typechecks
- **Command**:
  ```bash
  npm --prefix frontend run typecheck
  ```
- **Expected Result**: Command exits 0.
- [x] Pass <!-- 2026-07-04 -->
