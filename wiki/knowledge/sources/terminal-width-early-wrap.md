---
id: terminal-width-early-wrap
title: Terminal Text Wraps Early Instead of Filling the Component
updated: 2026-08-15
sources:
  - ../../raw/research/terminal-width-early-wrap/index.md
tags: [tmux, terminal, xterm-js, log-tail, bug]
---

# Terminal Text Wraps Early Instead of Filling the Component

**Root cause: the tmux window itself is capped at 80×24, not a frontend rendering problem.** `host-server/state.ts`'s `capturePaneTail`/`capturePaneTailRaw` shell out to `tmux capture-pane -p [-e -S -n]`, which is a plain-text snapshot of the pane's *own* rendered screen — lines are already hard-wrapped at the pane's current width before the text ever reaches the browser. Because the conductor's tmux session is headless (`tmux new-session -d`, never attached to by a real terminal) and neither `conductor.sh` nor `spawn.sh` ever sets `default-size`/`window-size`/`resize-window`, every window sits at tmux's factory default of 80×24 — confirmed live against a running session (`default-size 80x24`, `window-size latest`, all windows `80x24`).

`FitAddon` in uses::[[xterm-js]] via [[LogTail]] correctly fits xterm's own display grid to its container, but that's irrelevant here: `applySnapshot()` just writes already-80-column-wrapped text into the terminal, so widening the browser panel only adds empty space to the right rather than reflowing anything. **No frontend/CSS/xterm change can fix this** — the fix has to widen the actual tmux pane server-side.

**Recommended fix**: `tmux set-option -g window-size manual` + a generous `default-size` (e.g. `260x60`) set once at session bootstrap in `conductor.sh`/`spawn.sh`, plus a `resize-window -x -y` to fix the already-created first window. This is a known, independently-documented tmux behavior (not project-specific) — `window-size manual` freezes new-window/split-window sizing to `default-size` until explicitly `resize-window`'d, and `capture-pane` baking hard wraps into plain text at pane width is reported the same way in tmux's own issue tracker. A more precise but higher-complexity alternative — a live `resize` WebSocket frame driven by the browser's `FitAddon`-computed cols/rows — is documented as a fallback if pixel-exact dynamic fill is ever needed; it would need to be scoped to the single `focused`-exclusive viewer to avoid resize thrashing between the accordion card and the focused modal.

relates_to::[[tmux-headless-window-sizing]]
relates_to::[[tmux-capture-pane-escape-sequences]]
relates_to::[[log-tail]]
