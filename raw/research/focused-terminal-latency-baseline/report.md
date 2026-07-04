---
title: Focused terminal latency baseline
date: 2026-07-04
task: TASK-084
scenario: local worktree dashboard focused Codex agent detail
---

# Focused Terminal Latency Baseline

## Scenario

- Dashboard frontend: worktree Vite instance at `http://127.0.0.1:4322/`, proxied to the already-running host-server at `http://localhost:8788`.
- Focused agent: `codex` / agent id `17`, project `tmux-conductor`.
- Focused terminal view: opened the Codex agent detail modal and kept follow mode at the bottom.
- Stimulus: 18 separated `Space` / `BSpace` direct-key pulse pairs. The pulses generated terminal deltas without submitting a prompt; the prompt returned to its original content after each pair.
- Backend sampling: `capture-live-updates.mjs`, 1 before sample, 30 during samples, 1 after sample, 500 ms interval.
- Browser sampling: dev-only `LogTail` hook gated by `window.__focusedTerminalLatencyBaseline.enabled`, measuring focused output receipt to two `requestAnimationFrame()` boundaries after snapshot repaint scheduling.

## Raw Artifacts

- Backend focused run: [live-updates-worktree-ui-baseline.json](./live-updates-worktree-ui-baseline.json)
- Browser JSON: [browser-repaint-baseline.json](./browser-repaint-baseline.json)
- Browser CSV: [browser-repaint-baseline.csv](./browser-repaint-baseline.csv)
- Repeatable backend helper: [capture-live-updates.mjs](./capture-live-updates.mjs)
- Browser helper/runbook: [browser-repaint-probe.js](./browser-repaint-probe.js), [runbook.md](./runbook.md)

Additional control/iteration files are retained in this folder:

- [live-updates-baseline.json](./live-updates-baseline.json) — endpoint live, no focused raw-capture activity.
- [live-updates-focused-baseline.json](./live-updates-focused-baseline.json) — focused view open, no text-delta stimulus.
- [live-updates-focused-pulsed-baseline.json](./live-updates-focused-pulsed-baseline.json) — combined pulse attempt, no observed text delta.
- [live-updates-focused-separated-pulses-baseline.json](./live-updates-focused-separated-pulses-baseline.json) and [live-updates-focused-final-baseline.json](./live-updates-focused-final-baseline.json) — separated-pulse backend iterations from the canonical UI instance.

## Backend Metrics

Backend summary from `live-updates-worktree-ui-baseline.json`:

| Metric | Samples | Median avg delta ms | p95 avg delta ms | Max avg delta ms |
|---|---:|---:|---:|---:|
| `focusedTerminalTicks` | 29 | 23.992 | 29.478 | 32.712 |
| `tmuxCaptureTailRaw` | 29 | 11.592 | 14.299 | 14.490 |
| `sseBroadcasts` | 12 | 0.084 | 0.125 | 0.125 |
| `terminalTicks` | 7 | 11.013 | 14.448 | 14.448 |
| `tmuxCaptureTail` | 7 | 4.252 | 4.706 | 4.706 |
| `statusTicks` | 7 | 37.986 | 590.235 | 590.235 |

Interpretation: focused raw tmux capture is the dominant measured backend cost inside the focused loop. The `sseBroadcasts` timing is small when broadcasts happen, but the focused tick includes capture work whether or not a text delta is eventually sent.

## Browser Receipt-To-Repaint Metrics

Browser summary from `browser-repaint-baseline.json`:

| Scope | Samples | Median ms | p95 ms | Max ms |
|---|---:|---:|---:|---:|
| All focused output | 76 | 12.5 | 16.8 | 17.4 |
| Focused SSE | 39 | 12.2 | 17.2 | 17.4 |
| Focused WebSocket | 37 | 12.8 | 16.8 | 17.3 |

The browser timing is receipt-handler to post-paint-frame timing, not full keypress-to-render latency. It intentionally isolates the client-side receipt and repaint portion after the focused output payload reaches `LogTail`.

## Transport Ownership Observed

Duplicate focused output paths were active.

- Focused SSE delivered 39 browser samples through `terminal-output-focus`.
- Focused WebSocket delivered 37 browser samples through `/agents/:id/terminal/ws`.
- Both paths caused `LogTail` to apply focused snapshots while the modal was open.
- Backend `sseBroadcasts` also moved during the run, confirming focused SSE remained active.

This matches the pre-task research: current focused terminal ownership is overlapping, with WebSocket and focused SSE both able to deliver focused output from the same 500-line raw tmux capture cadence.

## Notes For Follow-Up Tasks

- Do not compare post-change WebSocket-only data against this baseline without accounting for the removed duplicate SSE path.
- If TASK-086 makes WebSocket the exclusive focused owner, rerun this same scenario and compare both backend `tmuxCaptureTailRaw` / `focusedTerminalTicks` and browser receipt-to-repaint samples.
- If TASK-089 changes capture depth or poll intervals first, preserve this report as the before-defaults baseline.

## Tuned Defaults After Exclusive Ownership

After TASK-086 removed duplicate focused SSE/WebSocket ownership and TASK-088 added WebSocket send coalescing, the focused hot path no longer needs to preserve the old 200 ms / 500-line default measured under duplicate capture.

| Setting | Baseline value | Tuned value | Rationale |
|---|---:|---:|---|
| `FOCUSED_TERMINAL_POLL_MS` | 200 ms | 250 ms | Baseline focused tick p95 was 29.478 ms while duplicate ownership was active. A 250 ms cadence still feels live while reducing capture opportunities by 20%. |
| `FOCUSED_TERMINAL_WS_POLL_MS` | 200 ms | 250 ms | Match focused cadence so the exclusive WebSocket owner does not poll more aggressively than the fallback path. |
| `FOCUSED_TERMINAL_TAIL_LINES` | 500 lines | 300 lines | Raw focused capture p95 was 14.299 ms at 500 lines. A 300-line snapshot keeps useful scrollback while reducing repeated full-snapshot payload and capture work. |

The normal dashboard status and card-tail defaults stay unchanged at 2000 ms and 100 lines. These defaults should be revisited after a live post-transport measurement, but they are a conservative first tuning step grounded in the baseline and duplicate-capture removal.

## Post-Transport Tuned Measurement

Rerun: `raw/research/focused-terminal-latency-baseline/live-updates-post-transport-tuned.json`

Scenario:

- Current ROADMAP-015 host-server code started on port 8798 with `FOCUSED_TERMINAL_POLL_MS=250`, `FOCUSED_TERMINAL_WS_POLL_MS=250`, and `FOCUSED_TERMINAL_TAIL_LINES=300`.
- Temporary repo-local config `tmp/roadmap-015-measure.conf` pointed at the real conductor SQLite DB so live agent `17` (`tmux-conductor-codex`) was available.
- A WebSocket client held `/api/agents/17/terminal/ws` open during the focused phase.

Post-change backend summary:

| Metric | Samples | Median avg delta (ms) | p95 avg delta (ms) | Max avg delta (ms) |
|---|---:|---:|---:|---:|
| `focusedTerminalTicks` | 35 | 0.002 | 0.005 | 0.006 |
| `tmuxCaptureTailRaw` | 30 | 10.141 | 15.118 | 15.929 |
| `sseBroadcasts` | 0 | n/a | n/a | n/a |

Interpretation:

- Focused WebSocket ownership removed the duplicate focused SSE broadcast path during the measured WebSocket-focused run.
- Tuned 300-line raw snapshots stayed in the same latency band as the 500-line baseline (`tmuxCaptureTailRaw` p95 `15.118 ms` vs baseline p95 `14.299 ms`) while reducing snapshot payload size and capture depth.
- The remaining focused tick loop is effectively a no-op when WebSocket owns the pane, because `tailPollLoopFocus()` excludes WebSocket-owned agents.
