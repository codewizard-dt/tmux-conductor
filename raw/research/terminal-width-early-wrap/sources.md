---
topic: "How to make the terminal text in the browser fill the width of the component instead of wrapping early"
slug: terminal-width-early-wrap
researched: 2026-08-15
---

# Primary Sources — Terminal text wraps early instead of filling the component width

| ID | Type | Locator | Accessed | What it contributed |
|----|------|---------|----------|---------------------|
| S1 | codebase | user-supplied screenshot `tmp/dashboard-drops/1786822842164-Screenshot-2026-08-15-at-2.40.38-PM.png` | 2026-08-15 | Visual symptom: pane text hard-wraps around col ~80-90 while the xterm container has a large empty right margin. |
| S2 | codebase | `host-server/state.ts::capturePaneTail` / `capturePaneTailRaw` | 2026-08-15 | Confirms terminal content is produced by `tmux capture-pane -p` / `-p -e -S -n` — a plain-text snapshot of the pane's *own* rendered width, not a live PTY stream. |
| S3 | codebase | `frontend/src/components/LogTail.tsx::LogTail` | 2026-08-15 | xterm.js `Terminal` + `FitAddon` is created once; `fitAddon.fit()` runs on a `ResizeObserver`. Confirms xterm only ever *renders* text handed to it via `applySnapshot()` (`term.write('\x1bc' + text, cb)`) — it never requests a resize of the source. |
| S4 | codebase | `frontend/src/lib/terminalWebSocket.ts::connectTerminalWebSocket` | 2026-08-15 | WS message protocol is `type: 'output' \| 'ack' \| 'echo' \| 'error'` plus a client→server `{type:'input', ...}` frame. No `resize` message type exists in either direction. |
| S5 | codebase | `scripts/conductor.sh` (lines 59, 77, 103) and `scripts/spawn.sh` (lines 50, 67) | 2026-08-15 | All tmux windows/panes are created via `tmux new-session -d` / `new-window` / `split-window` with no `-x`/`-y` and no `default-size`/`window-size` configuration anywhere in the repo. |
| S6 | shell (live system) | `tmux show-options -g default-size`, `tmux show-window-options -g window-size`, `tmux list-windows -a -F '... #{window_width}x#{window_height}'` run against the user's live `conductor` session | 2026-08-15 | Ground truth: `default-size 80x24`, `window-size latest` (tmux default, unchanged), and all 4 live windows report exactly `80x24` — proving the pane is capped at 80 columns because no client is (or has ever been) attached. |
| S7 | web | https://askubuntu.com/questions/1405802/tmux-does-not-size-down-to-smallest-client | 2026-08-15 | "If set to largest, the size of the largest attached session is used; if smallest, the size of the smallest. If manual, the size of a new window is set from the default-size option and windows are resized automatically [only via explicit resize-window]." |
| S8 | web | https://unix.stackexchange.com/questions/209981/tmux-doesnt-resize-with-terminal-window | 2026-08-15 | "window-size is a per-window option... largest \| smallest \| manual \| latest: Configure how tmux determines the window size." Confirms `window-size manual` + `default-size` is the supported mechanism for headless/no-client window sizing. |
| S9 | web | https://unix.stackexchange.com/questions/218815/tmux-force-resize-window | 2026-08-15 | `resize-window -x <width> -y <height>` sets an explicit width/height on an existing window; confirms the resize primitive exists independent of any attached client. |
| S10 | web | https://github.com/tmux/tmux/issues/2688 ("Do not wrap lines when saving to file") | 2026-08-15 | Independent confirmation from a tmux maintainer thread that `capture-pane` bakes hard line-wraps into its plain-text output at the pane's current screen width — exactly the mechanism causing the reported symptom. |

## Excerpts

### S6 — live system check (this repo's running `conductor` session)
```
$ tmux show-options -g default-size
default-size 80x24
$ tmux show-window-options -g window-size
window-size latest
$ tmux list-windows -a -F '#{session_name}:#{window_name} #{window_width}x#{window_height}'
conductor:bootstrap-bootstrap-1 80x24
conductor:tmux-conductor-frontend 80x24
conductor:tmux-conductor-general 80x24
conductor:monitor 80x24
```

### S7 — askubuntu.com/questions/1405802
> Configure how tmux determines the window size. If set to largest, the size of the largest attached session is used; if smallest, the size of the smallest. If manual, the size of a new window is set from the default-size option and windows are resized automatically.

### S8 — unix.stackexchange.com/questions/209981
> This should be the answer. Unsetting the window-size option worked for me. Which makes sense; if tmux gets into the state where it won't resize to the terminal window, and no other session is attached, it's because its window-size is set to manual. ... window-size is a per-window option, so you will have to run [resize] for every mis-sized window in your session.

### S9 — unix.stackexchange.com/questions/218815
> -x \<width\> and/or -y \<height\> set width and height to the given values. [for `resize-window`]

### S10 — github.com/tmux/tmux/issues/2688
> I use `capture-pane -S - \; save-buffer /tmp/tmux` to save my current terminal buffer to a file, but this saves the lines wrapped [at my screen width].
