---
id: tmux-capture-pane-escape-sequences
title: tmux capture-pane and Escape Sequences
updated: 2026-06-22
sources:
  - ../../raw/research/web-terminal-emulators/index.md
tags: [tmux, ansi, escape-sequences, capture-pane, concept]
---

# tmux capture-pane and Escape Sequences

`tmux capture-pane` has two distinct output modes, controlled by the `-e` flag:

| Mode | Flag | Output |
|---|---|---|
| Plain text (default) | *(no flag)* | tmux renders the pane grid to plain text; all ANSI color/formatting stripped |
| Escape-sequence preserving | `-e` | tmux includes the effective escape sequences; colors, bold, etc. are preserved |

## Why this matters for tmux-conductor

The project calls `tmux capture-pane` in two separate contexts with different requirements:

### 1. Status/mode detection — must stay plain-text

`capturePaneTail` in `host-server/state.ts` feeds `detectAgentStatus` and `detectAgentMode`. These functions match regex patterns (`BUSY_PATTERN`, `IDLE_PATTERN`, `AWAITING_PATTERN`, mode footer patterns) against plain text. Adding `-e` would inject escape sequences into those strings and break the regex matching.

**Rule**: `capturePaneTail` must NEVER get the `-e` flag.

### 2. Display tail — needs `-e`

`capturePaneTailRaw` feeds the `/agents/:id/tail` HTTP endpoint and the `tailPollLoop` / `tailPollLoopFocus` SSE broadcasts (`terminal-output`, `terminal-output-focus`). This text is rendered in the browser dashboard.

Currently called without `-e`, so the browser receives plain text. To enable full color + cursor display via uses::[[xterm-js]], `-e` must be added to `capturePaneTailRaw`'s spawn args:
```ts
// Change this:
['capture-pane', '-t', target, '-p', '-S', `-${n}`]
// To this:
['capture-pane', '-t', target, '-p', '-e', '-S', `-${n}`]
```

## tmux version requirement

The `-e` flag was added in tmux 1.8. The project already requires tmux ≥ 3.0 (per prerequisites), so this is not a compatibility concern.

relates_to::[[ansi-terminal-emulation-browser]] relates_to::[[log-tail]]
