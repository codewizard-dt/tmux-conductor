---
id: xterm-js
title: xterm.js
aliases: [xterm, xtermjs, "@xterm/xterm"]
updated: 2026-09-13
sources:
  - ../../../raw/research/web-terminal-emulators/index.md
  - ../../../raw/research/terminal-keyboard-clipboard/index.md
  - ../../../raw/research/xterm-scrollbar-flicker/index.md
confidence: extracted
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

## Input interception — matters when xterm is NOT the input source (2026-08-15)

Verified against the installed v6.0.0 bundle and in the live app. If you drive a remote pty from your own key-capture layer and use xterm purely as a read-only mirror, xterm still competes for input events:

- **`paste` is registered on both `term.textarea` and `term.element`**, and `handlePasteEvent` calls `ev.stopPropagation()` as its first statement. Under `disableStdin: true` the resulting paste is a no-op, so `Cmd+V` is consumed and silently discarded. A bubble-phase listener on an ancestor (including React's delegated `onPaste`) never fires. **Listen in the capture phase instead** — verified to work.
- **`copy` is registered on `term.element`**, filling the clipboard from `selectionText` when `hasSelection()`.
- **A hidden `.xterm-helper-textarea` steals focus** on a click or drag-select inside the terminal. While it holds focus xterm also stops propagation on `keydown`, so an external capture layer receives nothing at all. **Confirmed at the source (2026-09-13, via Context7):** `CoreBrowserTerminal.open()` wires `MouseService.bindMouse(..., () => this.focus())` to every mousedown in the terminal; `focus()` unconditionally calls `textarea.focus({preventScroll:true})` on the helper textarea (`tabIndex = 0` always). **`disableStdin` does not prevent this** — it only gates `CoreService.triggerDataEvent`, blocking keystroke *data* from reaching the pty, not this mousedown→focus binding. See `derived_from::[[direct-input-mode-focus-reliability]]`.
- Clipboard and keyboard events route differently: with an ancestor div focused, `keydown` targets that div but `paste` still targets `.xterm-helper-textarea`.
- **Selection**: mouse drag-select works out of the box and renders as `.xterm-selection` overlay divs. Shift+click extends a selection (`_handleIncrementalClick`). On macOS the "force selection" modifier is **Option+click**, not Shift, and only when `macOptionClickForcesSelection` is enabled — it defaults to `false`.
- Writing `\x1bc` (RIS) before a snapshot performs a full terminal reset, which resets the buffer on every repaint.

See `relates_to::[[browser-terminal-input-capture]]` for the resulting integration rules.

## Scrollbar flicker on frequent full-reset repaints (2026-09-13)

The same `\x1bc`-before-every-repaint pattern above has a second, independent consequence beyond buffer/selection reset: it also churns `.xterm-viewport`'s `scrollTop` on every repaint, visibly flashing any custom or native scrollbar thumb. This is a documented, known xterm.js issue class ("clear screen → full repaint" causing `viewportY` reset — xterm.js issue #5620, and an identical report in a comparable xterm.js-based terminal app), not specific to this codebase. The complete upstream fix (delaying viewport DOM sync until a synchronized-output block ends, PR #5770) ships only in the unreleased 7.0 line — stable npm latest is still `6.0.0` as of this research. See `derived_from::[[xterm-scrollbar-flicker]]` for the full writeup and the recommended application-level mitigation (debounce the repaint rate, not a library upgrade).

derived_from::[[web-terminal-emulators]] derived_from::[[terminal-keyboard-clipboard]] derived_from::[[direct-input-mode-focus-reliability]] derived_from::[[xterm-scrollbar-flicker]] relates_to::[[log-tail]] relates_to::[[ansi-terminal-emulation-browser]] relates_to::[[browser-terminal-input-capture]]
