---
id: UAT-084
title: "UAT: focused terminal latency baseline"
status: passed
task: TASK-084
created: 2026-07-04
updated: 2026-07-04
---

# UAT-084 — UAT: focused terminal latency baseline

implements::[[TASK-084]]

> **Source task**: [[TASK-084]]
> **Generated**: 2026-07-04

---

## Test Cases

### UAT-STATIC-001: Baseline tooling is syntactically valid
- **Description**: Verifies the backend sampler and browser repaint probe parse as JavaScript.
- **Command**:
  ```bash
  node --check raw/research/focused-terminal-latency-baseline/capture-live-updates.mjs && node --check raw/research/focused-terminal-latency-baseline/browser-repaint-probe.js
  ```
- **Expected Result**: Both `node --check` invocations exit 0.
- [x] Pass <!-- 2026-07-04 -->

### UAT-STATIC-002: Baseline report has representative samples and duplicate-ownership evidence
- **Description**: Verifies the baseline contains at least 30 browser repaint samples and records both SSE and WebSocket focused output.
- **Command**:
  ```bash
  node -e "const fs=require('fs'); const b=JSON.parse(fs.readFileSync('raw/research/focused-terminal-latency-baseline/browser-repaint-baseline.json','utf8')); if (!Array.isArray(b.samples) || b.samples.length < 30) throw new Error('browser baseline sample count < 30'); if (!b.summary?.byTransport?.sse || !b.summary?.byTransport?.websocket) throw new Error('missing duplicate transport evidence');"
  ```
- **Expected Result**: Command exits 0.
- [x] Pass <!-- 2026-07-04 -->
