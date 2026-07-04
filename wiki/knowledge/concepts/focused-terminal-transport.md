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

relates_to::[[LogTail]]
relates_to::[[ANSI Terminal Emulation in the Browser]]
relates_to::[[Dashboard Performance Benchmarking]]
relates_to::[[Local Observability]]
