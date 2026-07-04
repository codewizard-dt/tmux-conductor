---
id: UAT-090
title: "UAT: tune focused capture defaults from measured data"
status: passed
task: TASK-090
created: 2026-07-04
updated: 2026-07-04
---

# UAT-090 — UAT: tune focused capture defaults from measured data

implements::[[TASK-090]]

> **Source task**: [[TASK-090]]
> **Generated**: 2026-07-04

---

## Test Cases

### UAT-STATIC-001: Tuned defaults and post-change measurement are recorded
- **Command**:
  ```bash
  node -e "const fs=require('fs'); const post=JSON.parse(fs.readFileSync('raw/research/focused-terminal-latency-baseline/live-updates-post-transport-tuned.json','utf8')); const raw=post.summary.metrics.tmuxCaptureTailRaw; if (!raw || raw.p95AvgDeltaMs === null) throw new Error('missing post transport raw capture metric'); const sse=post.summary.metrics.sseBroadcasts; if (sse.samples !== 0) throw new Error('expected no focused SSE broadcast timing samples');" && rg -q "FOCUSED_TERMINAL_POLL_MS=250" conductor.conf && rg -q "FOCUSED_TERMINAL_TAIL_LINES=300" conductor.conf
  ```
- **Expected Result**: Command exits 0.
- [x] Pass <!-- 2026-07-04 -->
