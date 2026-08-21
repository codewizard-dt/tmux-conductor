---
id: UAT-072
aliases: [UAT-072]
title: "UAT: live-update timing instrumentation and counters"
status: passed
task: TASK-072
created: 2026-06-28
updated: 2026-06-28
---

# UAT-072 — UAT: live-update timing instrumentation and counters

implements::[[TASK-072]]

> **Source task**: [[TASK-072]]
> **Generated**: 2026-06-28

---

## Prerequisites

- [x] TASK-072 implementation is present in `host-server/index.ts`.
- [x] Host-server TypeScript dependencies are installed.

---

## Test Cases

### UAT-STATIC-001: Host-server typecheck passes
- **Description**: Verifies the instrumentation compiles with the host-server TypeScript project.
- **Command**:
  ```bash
  npm --prefix host-server run typecheck
  ```
- **Expected Result**: Command exits 0.
- [x] Pass <!-- 2026-06-28 -->

### UAT-STATIC-002: Metrics endpoint is registered
- **Description**: Verifies `GET /api/perf/live-updates` exists and returns live-update metrics.
- **Command**:
  ```bash
  node -e "const fs=require('fs'); const s=fs.readFileSync('host-server/index.ts','utf8'); if(!s.includes(\"api.get('/perf/live-updates'\") || !s.includes('liveUpdates: liveUpdateMetrics')) process.exit(1)"
  ```
- **Expected Result**: Command exits 0.
- [x] Pass <!-- 2026-06-28 -->

### UAT-STATIC-003: Required counters and timings are present
- **Description**: Verifies metrics include status ticks, terminal ticks, focused terminal ticks, tmux capture calls, SSE connections, SSE broadcasts, and tail requests.
- **Command**:
  ```bash
  node -e "const fs=require('fs'); const s=fs.readFileSync('host-server/index.ts','utf8'); for (const token of ['statusTicks','terminalTicks','focusedTerminalTicks','tmuxCaptureTail','tmuxCaptureTailRaw','sseConnections','sseBroadcastsByEvent','tailRequests']) if(!s.includes(token)) process.exit(1)"
  ```
- **Expected Result**: Command exits 0.
- [x] Pass <!-- 2026-06-28 -->

### UAT-STATIC-004: Live loops are timed
- **Description**: Verifies the status, terminal, and focused terminal loops are wrapped with timing instrumentation.
- **Command**:
  ```bash
  node -e "const fs=require('fs'); const s=fs.readFileSync('host-server/index.ts','utf8'); for (const token of [\"timeSync('statusTicks'\", \"timeSync('terminalTicks'\", \"timeSync('focusedTerminalTicks'\"]) if(!s.includes(token)) process.exit(1)"
  ```
- **Expected Result**: Command exits 0.
- [x] Pass <!-- 2026-06-28 -->
