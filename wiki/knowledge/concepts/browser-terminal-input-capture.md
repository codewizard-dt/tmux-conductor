---
id: browser-terminal-input-capture
title: Browser Terminal Input Capture (read-only mirror + external key capture)
aliases: [interact-mode-input, xterm-input-interception, capture-phase-paste]
updated: 2026-08-15
sources:
  - ../../../raw/research/terminal-keyboard-clipboard/index.md
confidence: extracted
tags: [frontend, terminal, xterm, keyboard, clipboard, pattern]
---

# Browser Terminal Input Capture

The dashboard renders each agent's tmux pane as a **read-only xterm.js mirror** (`disableStdin: true`) and captures input on a wrapper `<div tabIndex=0>` that *contains* the terminal. Keystrokes are translated to tmux key names and pushed to the pane; xterm itself is never the input source. The pattern is sound — it keeps a single source of truth (the tmux snapshot) and avoids local echo fighting the repaint — but it collides with xterm.js in two specific, non-obvious ways.

## Collision 1 — xterm's listeners stop propagation

xterm registers `paste` on **both** `term.textarea` and `term.element`, and `copy` on `term.element`. Its `handlePasteEvent` calls `ev.stopPropagation()` first. Under `disableStdin: true` the subsequent paste is a no-op, so the event is consumed and discarded. React's delegated handlers are attached at the React root — above the wrapper — so any `stopPropagation()` at a descendant prevents `onPaste` from ever firing.

**Clipboard and keyboard events do not route the same way.** Measured in the live app: with the wrapper holding focus, `keydown` targets the wrapper, but `paste` targets `.xterm-helper-textarea`. That asymmetry is the whole bug — typing works while pasting silently does nothing.

**Rule:** for a read-only xterm mirror with external input capture, bind clipboard events in the **capture phase** on the wrapper (`addEventListener('paste', fn, { capture: true })`), not via React's bubble-phase `onPaste`. Capture-phase listeners on an ancestor run before the target's bubble listener, so xterm's `stopPropagation()` cannot pre-empt them. This is verified, not theoretical.

## Collision 2 — focus drifts into xterm's helper textarea

Clicking inside the terminal a second time, or drag-selecting text, moves focus to `.xterm-helper-textarea`. In that state xterm also stops propagation on **keydown**, so no key reaches the wrapper at all and the whole input path goes dead — while any "direct input active" UI keeps claiming otherwise, because a blur handler that asks "is the new focus still inside my capture div?" answers yes (the textarea *is* a descendant).

**Rule:** a wrapper-captures-input design must actively keep focus off xterm's helper textarea — re-focus the wrapper on `mouseup` inside the terminal (`mouseup`, not `mousedown`, so drag-select still completes), and never treat "focus is somewhere inside my subtree" as proof that capture is still working.

**Confirmed at the source (2026-09-13):** xterm.js's `CoreBrowserTerminal.open()` wires `MouseService.bindMouse(..., () => this.focus())`, invoked from the terminal's own mousedown handler; `focus()` calls `this.textarea.focus({ preventScroll: true })` unconditionally, and the helper textarea is created with `tabIndex = 0` regardless of any terminal option. **`disableStdin` does not prevent this** — it only gates `CoreService.triggerDataEvent`, i.e. it stops keystroke *data* reaching the pty/`onData`, not the mousedown→focus binding. See `derived_from::[[direct-input-mode-focus-reliability]]`.

> **Shipped-without-mitigation note:** this collision's prescribed fix (mouseup re-focus) was never implemented when `tmux-conductor`'s `LogTail.tsx` later added `onDoubleClick={onToggleExpand}` on its terminal container (see `[[log-tail]]`'s "double-click-to-fullscreen" section) — so the exact failure this page predicted shipped as a live regression once Direct Input was already active and a mousedown landed anywhere inside the terminal, not only on double-click.

## Corollary — snapshot repaint versus selection

A mirror that repaints by writing `\x1bc` (RIS, full terminal reset) plus the whole snapshot on every frame resets the buffer each time. Selections survive only while no frames arrive. If user selection matters, gate the repaint on `term.hasSelection()` the same way it is already gated on the user having scrolled up.

relates_to::[[log-tail]] relates_to::[[xterm-js]] relates_to::[[terminal-keyboard-clipboard]] relates_to::[[ansi-terminal-emulation-browser]] relates_to::[[focused-terminal-transport]] relates_to::[[direct-input-mode-focus-reliability]]
