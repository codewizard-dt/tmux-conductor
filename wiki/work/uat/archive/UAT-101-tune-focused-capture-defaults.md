---
id: UAT-101
title: "UAT: tune focused capture defaults from measured data"
status: passed
task: TASK-101
created: 2026-07-04
updated: 2026-07-04
---

# UAT-101 — UAT: tune focused capture defaults from measured data

implements::[[TASK-101]]

> **Source task**: [[TASK-101]]
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

### Renumbering note

Originally filed as `UAT-090`. Renumbered to `UAT-101` on 2026-07-06 to resolve an ID collision with an unrelated ROADMAP-016 UAT that was independently assigned the same number the same day.
