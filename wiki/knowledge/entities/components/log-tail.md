---
id: log-tail
title: LogTail
aliases: [LogTail.tsx]
updated: 2026-06-22
sources:
  - ../../../raw/research/web-terminal-emulators/index.md
tags: [frontend, component, terminal, react]
---

# LogTail

`frontend/src/components/LogTail.tsx` — the React component that renders the live tmux pane output for each agent in the dashboard. Used in both card view (collapsed) and modal/detail view (expanded, interact mode).

**Current state**: Renders plain text in a `whitespace-pre-wrap` dark div. No ANSI parsing — escape sequences appear as raw garbage characters. Styled with `bg-[#0b0b0d] p-3 font-mono text-[11px] text-[#e7e8ea]`.

**Data flow**:
- SSE event `terminal-output` (slow, ~2s, all agents) → text appended to state
- SSE event `terminal-output-focus` (fast, ~200ms, focused agent) → text appended to state
- Initial mount: fetches `/agents/:id/tail` for backfill

**Interact mode**: LogTail also renders a text input bar when in interact mode (`POST /agents/:id/keys` sends keystrokes). This input path is unchanged by the xterm.js migration — xterm.js is read-only display; the text input stays as a separate HTML element.

**Planned upgrade**: Replace the plain text div with an xterm.js terminal instance (uses::[[xterm-js]]). Requires:
1. Backend: add `-e` flag to `capturePaneTailRaw` in `host-server/state.ts`
2. Frontend: `npm install @xterm/xterm @xterm/addon-fit` + replace text container with `term.write()` + wire `ResizeObserver` → `fitAddon.fit()`

See relates_to::[[tmux-capture-pane-escape-sequences]] for why the backend change is necessary.
relates_to::[[ansi-terminal-emulation-browser]]
