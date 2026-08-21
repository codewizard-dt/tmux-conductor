---
id: tmux-headless-window-sizing
title: tmux Headless Window Sizing
updated: 2026-08-15
sources:
  - ../../raw/research/terminal-width-early-wrap/index.md
tags: [tmux, window-size, headless, concept]
---

# tmux Headless Window Sizing

When a tmux window has no attached client — as is always true for the conductor's tmux session, since it's created with `tmux new-session -d` and the dashboard only ever reads it via `capture-pane`, never attaches — its size is governed by two options, not by anything a browser-side viewer does:

| Option | Values | Effect with no client attached |
|---|---|---|
| `window-size` (per-window/global) | `latest` (tmux default), `largest`, `smallest`, `manual` | `latest`/`largest`/`smallest` all track *attached clients*; with none attached they're moot and the window falls back to `default-size`. `manual` explicitly freezes new windows at `default-size` until a `resize-window` call changes them. |
| `default-size` (session option) | `<cols>x<rows>`, tmux factory default `80x24` | The size assigned to any window created while unattached (or while `window-size manual` is set). |

`resize-window -t <target> -x <cols> -y <rows>` sets an explicit size on an existing window regardless of attached clients, and is the supported primitive for correcting an already-created window.

## Why this matters for tmux-conductor

`tmux-conductor` never sets any of these — `scripts/conductor.sh` and `scripts/spawn.sh` create every session/window/pane via plain `tmux new-session -d`/`new-window`/`split-window` with no `-x`/`-y` flags. The result, confirmed live against a running `conductor` session: `default-size 80x24`, `window-size latest`, and every window reporting exactly `80x24`.

Because uses::[[tmux-capture-pane-escape-sequences]] captures the pane as already-wrapped plain text at this width, the browser-side [[LogTail]]/uses::[[xterm-js]] terminal receives text hard-wrapped at 80 columns no matter how wide its container is — see [[terminal-width-early-wrap]] for the full symptom and fix (`window-size manual` + a wide `default-size`, e.g. `260x60`, set once at session bootstrap).

This is a general tmux behavior, not specific to this project — the same failure mode (headless window stuck at `default-size`, `capture-pane` baking in hard wraps) is independently documented in tmux's own issue tracker and community Q&A.

relates_to::[[terminal-width-early-wrap]]
relates_to::[[tmux-capture-pane-escape-sequences]]
relates_to::[[log-tail]]
