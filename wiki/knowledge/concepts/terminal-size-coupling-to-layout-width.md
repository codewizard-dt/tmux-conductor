---
id: terminal-size-coupling-to-layout-width
title: Terminal Size Is Coupled to Layout Width (Two Independent Paths)
aliases: [Terminal Probe vs Layout Width, Sidebar Width and Terminal Size]
updated: 2026-09-20
sources:
  - ../../../raw/research/sidebar-hover-expand/index.md
  - ../../../raw/research/sidebar-hover-expand/sources.md
confidence: inferred
tags: [frontend, terminal, layout, xterm, tmux]
---

# Terminal Size Is Coupled to Layout Width (Two Independent Paths)

Any change to the detail pane's width touches the terminal through **two independent code paths that do not stay in sync**:

1. **Local refit (automatic):** `LogTail` (`LogTail.tsx:386`) attaches `new ResizeObserver(() => fitWithRightEdgeMargin(term, fitAddon))` to its xterm container, so the *local* xterm grid refits on every container-width change, including mid-animation.
2. **Host sync (window-resize only):** `terminalSizeProbe.registerResizeListener` listens to `window` `resize` (400 ms debounce) and calls `probeAndSyncTerminalSize()`, which mounts an offscreen xterm in a hidden probe and pushes `cols`/`rows` to the host-server via `syncTerminalSize`. The probe's geometry is **hard-coded** to the docked sidebar width — `outer.style.left = \`${SIDEBAR_WIDTH_PX}px\`` (`SIDEBAR_WIDTH_PX = 320`, `layoutConstants.ts`).

Consequence: changing the docked sidebar width changes the local terminal's cols immediately but never fires a window `resize`, so the tmux window keeps the size computed under the old width — the local xterm and the pane it mirrors disagree (the same failure family as `relates_to::[[tmux-headless-window-sizing]]`, but caused by the frontend). Any feature that changes the docked width (a minimize toggle) must make the probe read the *current* docked width and re-run `probeAndSyncTerminalSize()`; any feature that only overlays (hover-expand flyout) must leave the docked width alone. This is why `derived_from::[[sidebar-hover-expand]]` requires the overlay shape.

*Inference note:* derived by reading the two code paths together; no external source states it, hence `confidence: inferred`. Verify live before relying on it (change docked width, compare local cols with `tmux display -p '#{pane_width}'`).

relates_to::[[log-tail]]
relates_to::[[hover-expand-overlay-flyout-pattern]]
relates_to::[[terminal-width-early-wrap]]
