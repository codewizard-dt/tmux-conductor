---
id: ansi-terminal-emulation-browser
title: ANSI Terminal Emulation in the Browser
updated: 2026-06-22
sources:
  - ../../raw/research/web-terminal-emulators/index.md
tags: [terminal, ansi, browser, concept]
---

# ANSI Terminal Emulation in the Browser

Rendering terminal output with full color and cursor fidelity in a browser requires a terminal emulator — a component that interprets VT100/ANSI escape sequences and maintains a stateful character grid. This is fundamentally different from rendering plain text with a `<pre>` element.

## Why a plain `<pre>` falls short

A `<pre>` element renders text literally. ANSI escape sequences (e.g. `\x1b[32m` for green, `\x1b[H` to move the cursor to home) appear as garbage characters or are invisible. Applications like Claude Code, which use colors, bold, progress bars, and cursor positioning, produce unreadable output without proper escape-sequence interpretation.

## The terminal emulator model

A browser terminal emulator (e.g. uses::[[xterm-js]]) maintains:
- A grid of character cells with foreground/background color and text attributes
- A cursor position (row/column)
- A scrollback buffer of past lines
- An escape-sequence state machine

You feed it raw bytes/strings via `term.write(data)`. It interprets sequences in real time and updates the grid. This means the terminal is **stateful and non-idempotent** — you can't re-feed the same data twice without duplicate rendering.

## Practical implications for tmux-conductor

1. **On mount**: fetch the last N lines from `/agents/:id/tail` (with `-e` escape sequences), write once
2. **On SSE update**: call `term.write(newText)` — do NOT replace, always append
3. **On unmount**: call `term.dispose()` to release canvas/WebGL resources
4. The terminal grid does NOT persist across React component unmounts unless you keep the Terminal instance in a ref or context outside the component lifecycle

## xterm-256color support

Modern terminal apps (including Claude Code) use `xterm-256color` as their `TERM` value, enabling 256 indexed colors plus truecolor (24-bit RGB via `\x1b[38;2;r;g;bm`). xterm.js supports both; hterm supports 256 but has limited truecolor support.

relates_to::[[tmux-capture-pane-escape-sequences]] uses::[[xterm-js]]
