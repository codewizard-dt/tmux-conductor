---
id: log-tail
title: LogTail
aliases: [LogTail.tsx]
updated: 2026-06-22
sources:
  - ../../../raw/research/web-terminal-emulators/index.md
  - ../../../raw/research/application-latency-structure/index.md
  - ../../../raw/research/application-latency-structure/index-2.md
tags: [frontend, component, terminal, react]
---

# LogTail

`frontend/src/components/LogTail.tsx` — the React component that renders the live tmux pane output for each agent in the dashboard. Used in both card view (collapsed) and modal/detail view (expanded, interact mode).

**Current state**: Uses xterm.js for terminal rendering and raw ANSI/cursor-preserving tmux snapshots for display. The prior plain-text `<pre>`/dark-div design has been superseded.

**Data flow**:
- SSE event `terminal-output` (slow, ~2s, unfocused agents) → terminal snapshot repaint
- Focused modal opens `/agents/:id/terminal/ws` for focused output/input
- SSE event `terminal-output-focus` remains a fallback path, but the latency research says it should not run concurrently with WebSocket-owned focused output
- Initial mount: fetches `/agents/:id/tail` for backfill

**Interact mode**: LogTail captures direct input and sends it over the focused WebSocket when connected, falling back to `POST /agents/:id/keys`. The component also owns focus state and must keep its effects idempotent under React Strict Mode.

**Latency concern**: A focused modal can appear to stop accepting input if backend tmux work blocks the event loop or if WebSocket and focused SSE both repaint/capture the same pane. The recommended architecture is exclusive focused WebSocket ownership with SSE only as fallback.

See relates_to::[[tmux-capture-pane-escape-sequences]] for why the backend change is necessary.
relates_to::[[ansi-terminal-emulation-browser]]
relates_to::[[focused-terminal-transport]]
relates_to::[[local-observability]]
