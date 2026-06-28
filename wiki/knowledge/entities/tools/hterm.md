---
id: hterm
title: hterm (HTML Terminal)
aliases: [hterm.js, "chrome hterm"]
updated: 2026-06-22
sources:
  - ../../../raw/research/web-terminal-emulators/index.md
tags: [terminal, browser, ansi, google, tool]
---

# hterm (HTML Terminal)

hterm is Google's browser-based xterm-compatible terminal emulator written entirely in JavaScript. Originally authored for ChromeOS/Chromebook SSH and Crosh (the Chromebook shell). Supports VT100 and xterm-256color (16–255 colors); handles large scrollback buffers quickly and closely matches xterm keyboard behavior. Default TERM value is `xterm-256color`.

**Status**: Stale — last meaningful release circa 2020. Not published on npm (Google builds everything from scratch); integration requires manual bundling or a third-party npm re-publish.

**Comparison to xterm.js**: hterm is slightly better at CJK (Chinese/Japanese/Korean) character width handling in some reports. xterm.js has a much larger ecosystem, active maintenance, TypeScript types, and native npm distribution. For new projects, xterm.js is the standard choice.

**Not recommended** for tmux-conductor LogTail replacement due to staleness and lack of npm package.

contradicts::[[xterm-js]] — hterm and xterm.js are alternatives; xterm.js is preferred.
derived_from::[[web-terminal-emulators]]
