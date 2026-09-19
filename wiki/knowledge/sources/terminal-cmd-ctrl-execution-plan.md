---
id: terminal-cmd-ctrl-execution-plan
title: Sequencing TASK-141, TASK-149, and a Direct Input Copy/Paste Fix
updated: 2026-09-13
sources:
  - ../../raw/research/terminal-cmd-ctrl-execution-plan/index.md
confidence: extracted
tags: [frontend, terminal, xterm, keyboard, clipboard, roadmap]
---

# Sequencing TASK-141, TASK-149, and a Direct Input Copy/Paste Fix

Confirms against the **current live code** (not just prior research) that `LogTail.tsx`'s paste path is still broken in two independent ways: the previously-verified fix (a capture-phase `paste` listener) was never wired in — paste is still only bound via React's bubble-phase `onPaste`, so xterm.js's own `stopPropagation()`-first paste handler still swallows it — and `handlePaste` itself still hard-truncates to the first line even though the host-server already supports proper multi-line bracketed paste.

**Copy is a different story: likely already working, not a build item.** No code anywhere in this app implements copy-to-clipboard, and nothing blocks it either — `mapKey()` returns `null` for `Cmd+C` and `handleKeyDown` returns before `preventDefault()` when that happens, leaving the native browser copy path untouched. Per prior research, xterm.js's own `copy` listener on `term.element` fills the clipboard from `selectionText` whenever `hasSelection()` is true — so a drag-select-then-Cmd+C almost certainly already works today via xterm's own built-in behavior. The real risk is the live-repaint mechanism (`applySnapshot`'s full `\x1bc` reset on every update) destroying any active selection before copy can happen — a timing window, not a missing feature.

**Recommended sequencing**: TASK-141 (finish UAT) → TASK-149 (needs TASK-141's *final* live shortcut) → a new copy/paste task scoped as "fix paste (capture-phase listener + multi-line support); verify copy first, only fix if actually broken." All three share `LogTail.tsx`'s modifier-key surface, so sequencing avoids repeated same-file friction even though the copy/paste work is largely independent of the other two.

derived_from::[[terminal-keyboard-clipboard]] derived_from::[[browser-terminal-input-capture]] relates_to::[[log-tail]] relates_to::[[xterm-js]] relates_to::[[terminal-modifier-arrow-navigation]]
