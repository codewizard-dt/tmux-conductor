---
id: focused-terminal-transport
title: Focused Terminal Transport
aliases: [Terminal WebSocket Transport, Focused Terminal WebSocket]
updated: 2026-07-04
sources:
  - ../../raw/research/application-latency-structure/index.md
  - ../../raw/research/application-latency-structure/index-2.md
tags: [terminal, websocket, sse, performance]
---

# Focused Terminal Transport

Focused terminal interaction is the dashboard path where WebSocket has the strongest fit: the user sends keystrokes and expects ordered, low-latency output feedback. Global dashboard state remains one-way and fits SSE; focused terminal input/output is bidirectional and should use a single WebSocket owner when connected.

The latency research found that the current implementation can accidentally run WebSocket and focused SSE capture paths in parallel. That defeats the purpose of WebSocket by duplicating the expensive 500-line raw tmux capture path. The preferred design is **exclusive focused ownership**: when the WebSocket is active, it owns focused output and input; SSE remains only as fallback after WebSocket failure or when no WebSocket exists.

Implementation guidance: coalesce full-snapshot output frames, check WebSocket buffered state before sending, include client message ids for input acknowledgements, measure input-to-ack and input-to-echo latency, and keep one focused capture loop per pane. If latency remains poor, the larger architecture change is a tmux `pipe-pane` or PTY/log stream that feeds xterm.js appended bytes instead of repeated full snapshots.

## Focused Ownership Contract

A focused terminal pane must have exactly one focused transport owner at a time.

- **WebSocket-owned state:** when `/agents/:id/terminal/ws` is open for a focused pane, that WebSocket owns focused output snapshots and direct input for that pane. The frontend must not also consume `terminal-output-focus` SSE for the same pane while the WebSocket is open, and the backend must not also run a separate focused SSE capture loop for that pane.
- **Fallback state:** if the focused WebSocket cannot connect, closes, or reports failure, the frontend may fall back to focused SSE output plus REST `POST /agents/:id/keys` input. The fallback is temporary ownership; once a WebSocket reconnects, focused SSE consumption and the fallback capture owner must stop for that pane.
- **Global state remains SSE-owned:** `/events` remains the owner for coarse dashboard state and unfocused terminal-card output. WebSocket exclusivity applies only to the focused terminal interaction path.

Completion evidence for downstream implementation tasks:

- Frontend evidence: a focused `LogTail` with an open terminal WebSocket has no active `terminal-output-focus` subscription for that same `agentId`; direct keystrokes and submitted text call WebSocket input first and use REST input only when the socket is absent or not sendable.
- Backend evidence: each focused pane has at most one 500-line raw capture owner at a time. A WebSocket-connected pane is excluded from the focused SSE capture loop, and a fallback-SSE pane has no per-socket snapshot interval.
- Regression evidence: tests or static guards can fail if WebSocket output and focused SSE output are both active for the same focused pane, if two focused raw capture timers can target one pane, or if focused direct input bypasses an open WebSocket.

relates_to::[[LogTail]]
relates_to::[[ANSI Terminal Emulation in the Browser]]
relates_to::[[Dashboard Performance Benchmarking]]
relates_to::[[Local Observability]]
