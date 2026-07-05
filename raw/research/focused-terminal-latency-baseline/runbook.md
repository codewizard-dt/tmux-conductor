# Focused Terminal Latency Baseline Runbook

Use this runbook to collect a repeatable baseline before changing focused terminal ownership, polling intervals, or capture depth.

## Backend Samples

Start the native dev stack, open the dashboard, then run:

```bash
node raw/research/focused-terminal-latency-baseline/capture-live-updates.mjs \
  --url http://localhost:4321/api/perf/live-updates \
  --out raw/research/focused-terminal-latency-baseline/live-updates-baseline.json \
  --before 5 \
  --during 30 \
  --after 5 \
  --interval-ms 500
```

Open a representative focused agent detail terminal as the helper enters the `during` phase, keep it visible through the 30 focused samples, then let the `after` phase complete.

## Browser Samples

Before opening the focused terminal, install `browser-repaint-probe.js` in the dashboard console. If the dev server does not serve `raw/`, paste the file contents directly.

After the focused session, copy these console outputs into files under this folder:

```js
__focusedTerminalLatencyBaseline.summary()
__focusedTerminalLatencyBaseline.exportJson()
__focusedTerminalLatencyBaseline.exportCsv()
```

Suggested file names:

- `browser-repaint-baseline.json`
- `browser-repaint-baseline.csv`

## Transport Ownership To Record

Current expected baseline ownership:

- Focused WebSocket active: yes, `LogTail` opens `/agents/:id/terminal/ws` when focused.
- Focused SSE active: yes, `LogTail` also subscribes to `terminal-output-focus` when focused.
- Backend capture source: both focused paths capture 500 raw tmux lines on a 200 ms cadence.

Record what the browser probe observed in the final report. If both `websocket` and `sse` samples appear, duplicate focused output paths were active.
