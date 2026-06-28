---
id: web-terminal-emulators
title: Web Terminal Emulators — Full ANSI Color + Cursor Support
updated: 2026-06-22
sources:
  - ../../raw/research/web-terminal-emulators/index.md
tags: [terminal, xterm, ansi, frontend, tmux]
---

# Web Terminal Emulators — Full ANSI Color + Cursor Support

Research conducted 2026-06-22 investigating drop-in browser terminal replacements for the `LogTail` component, with the hard requirement of full ANSI color and cursor support.

**The answer is xterm.js (`@xterm/xterm` v6)** — the terminal engine inside VS Code, Hyper, JupyterLab, and Theia. It supports full VT100/xterm-256color including ANSI colors, cursor positioning, bold/italic/underline, and scrollback. It receives raw bytes/strings via `term.write(data)` and interprets escape sequences in real time.

**Two coordinated changes are required** — backend and frontend are both broken today. The backend strips all ANSI escape sequences because `tmux capture-pane` is called without the `-e` flag. Adding `-e` to `capturePaneTailRaw` (the display path) fixes the backend; replacing `LogTail.tsx`'s `whitespace-pre-wrap` div with an xterm.js terminal instance fixes the frontend.

**A critical split must be respected**: the `-e` flag applies only to `capturePaneTailRaw` (display). `capturePaneTail` (used by `detectAgentStatus`, `detectAgentMode`, dispatch logging) must remain plain-text — regex patterns like `BUSY_PATTERN`, `IDLE_PATTERN`, and mode-detection would break on raw escape sequences. relates_to::[[tmux-capture-pane-escape-sequences]] uses::[[xterm-js]] relates_to::[[log-tail]] relates_to::[[ansi-terminal-emulation-browser]]

The nearest alternatives — uses::[[hterm]] (Google) and `ansi-to-html` — are both inadequate: hterm is stale (last release 2020), and `ansi-to-html` has no cursor support.

React integration is recommended via raw `useRef` + `useEffect` (~20 lines) rather than a wrapper library, because `LogTail.tsx` has complex prop logic that would need threading through a wrapper's API. Key option: `convertEol: true` (tmux emits `\n`; xterm.js expects `\r\n`). `disableStdin: true` for read-only display.
