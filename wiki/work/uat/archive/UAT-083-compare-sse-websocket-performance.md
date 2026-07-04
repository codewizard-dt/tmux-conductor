---
id: UAT-083
title: "UAT: compare optimized SSE and WebSocket performance"
status: passed
task: TASK-083
created: 2026-06-28
updated: 2026-06-28
---

# UAT-083 — UAT: compare optimized SSE and WebSocket performance

implements::[[TASK-083]]

## Test Cases

### UAT-STATIC-001: Performance guardrails pass
- **Command**:
  ```bash
  npm --prefix host-server run perf:test
  npm run check:frontend-live-updates
  ```
- **Expected Result**: Commands exit 0.
- [x] Pass <!-- 2026-06-28 -->

### UAT-STATIC-002: Comparison document exists
- **Command**:
  ```bash
  test -f raw/research/dashboard-performance-websockets/sse-vs-websocket-comparison.md
  ```
- **Expected Result**: Command exits 0.
- [x] Pass <!-- 2026-06-28 -->
