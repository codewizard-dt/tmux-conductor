---
id: xterm-js
title: xterm.js
aliases: [xterm, xtermjs, "@xterm/xterm"]
updated: 2026-06-22
sources:
  - ../../../raw/research/web-terminal-emulators/index.md
tags: [terminal, browser, ansi, npm, tool]
---

# xterm.js

xterm.js is the canonical web-based terminal emulator library. npm package `@xterm/xterm` (v6.0.0, 2024). The older scoped-less `xterm` package (v5.x) is deprecated; all new projects use the `@xterm/` scoped packages.

**Used by**: VS Code (integrated terminal), Hyper, JupyterLab, Theia, and 486+ other npm packages.

**Capabilities**: Full VT100, xterm-256color (256 + truecolor), ANSI escape sequences (colors, bold, italic, underline, cursor positioning, cursor blinking), OSC 8 clickable hyperlinks, scrollback buffer, selection and copy.

**Rendering**: Three renderer options, all opt-in addons:
- DOM renderer — default, no addon needed; adequate for modest output volumes
- `@xterm/addon-canvas` — Canvas 2D, better performance (~40 KB gz)
- `@xterm/addon-webgl` — WebGL2, highest performance (~60 KB gz); VS Code default

**Key addons**:
- `@xterm/addon-fit` — auto-resizes terminal to container element (~5 KB gz); wire to `ResizeObserver`
- `@xterm/addon-web-links` — URL detection and click handling

**Bundle size**: ~340 KB minified / ~100 KB gzipped for the core module.

**Integration pattern** (React, read-only display):
```ts
const term = new Terminal({
  theme: { background: '#0b0b0d', foreground: '#e7e8ea' },
  convertEol: true,    // tmux emits \n; xterm.js needs \r\n
  disableStdin: true,  // read-only
  scrollback: 1000,
})
const fitAddon = new FitAddon()
term.loadAddon(fitAddon)
term.open(containerElement)
fitAddon.fit()
// On data: term.write(rawTextWithEscapeSequences)
```

**Theming**: `ITheme` interface accepts `background`, `foreground`, `cursor`, named ANSI colors (black through brightWhite), and extended ANSI (16–255).

derived_from::[[web-terminal-emulators]] relates_to::[[log-tail]] relates_to::[[ansi-terminal-emulation-browser]]
