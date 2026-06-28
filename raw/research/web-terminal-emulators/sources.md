---
topic: drop-in web-based terminal replacements with full color and cursor support
slug: web-terminal-emulators
researched: 2026-06-22
---

# Primary Sources — Web-Based Terminal Emulators

| ID | Type | Locator | Accessed | What it contributed |
|----|------|---------|----------|---------------------|
| S1 | codebase | `host-server/state.ts::capturePaneTail` (line 35) and `::capturePaneTailRaw` (line 54) | 2026-06-22 | Confirmed neither function passes `-e`; `capturePaneTail` used for status/mode detection (must stay plain-text); `capturePaneTailRaw` used for display tail (needs `-e`) |
| S2 | web | https://xtermjs.org/ | 2026-06-22 | xterm.js is the front-end terminal emulator library; used by VS Code, Hyper, Theia, JupyterLab |
| S3 | web | https://www.npmjs.com/package/@xterm/xterm | 2026-06-22 | Current package is `@xterm/xterm` v6.0.0 (scoped); old `xterm` v5 is deprecated; 486+ npm dependents |
| S4 | web | https://unix.stackexchange.com/questions/103108/capture-colors-with-tmux-buffer-copy-hardcopy | 2026-06-22 | "tmux 1.8 added the -e option to capture-pane; using this new option causes the captured data to include the effective escape sequences" |
| S5 | web | https://github.com/brendanlong/claude-code-plays-text-games/commit/efd30b474ec07310ad5af7e22649d5d3f01cf7f4 | 2026-06-22 | Real-world example: added `-e` to `tmux capture-pane` to "preserve ANSI colors in tmux game output capture" |
| S6 | web | https://www.qovery.com/blog/react-xtermjs-a-react-library-to-build-terminals | 2026-06-22 | `react-xtermjs` package by Qovery — React wrapper with `useXTerm()` hook and addon loading |
| S7 | context7 | `/websites/xtermjs` — "React integration addon system FitAddon" | 2026-06-22 | FitAddon usage, ITheme color properties, link handler setup, full addon loading pattern |
| S8 | web | https://github.com/xtermjs/xterm.js/releases | 2026-06-22 | "The canvas renderer has moved into an addon, significantly reducing the bundle size of the xterm module" — WebGL is recommended renderer; canvas 2D is fallback |
| S9 | codebase | `frontend/src/components/LogTail.tsx` (line 364) | 2026-06-22 | Current LogTail uses `whitespace-pre-wrap bg-[#0b0b0d] text-[#e7e8ea]` plain div — no ANSI parsing; colors for xterm ITheme should match these values |
| S10 | codebase | `host-server/index.ts` (lines 1533–1569) | 2026-06-22 | `tailPollLoop` and `tailPollLoopFocus` broadcast `terminal-output` / `terminal-output-focus` SSE events with captured pane text |

## Excerpts

### S4 — Unix StackExchange: Capture colors with tmux buffer copy
https://unix.stackexchange.com/questions/103108/capture-colors-with-tmux-buffer-copy-hardcopy
> "tmux 1.8 added the -e option to capture-pane; using this new option causes the captured data to include the effective escape sequences."

### S5 — GitHub commit: Preserve ANSI colors in tmux game output capture
https://github.com/brendanlong/claude-code-plays-text-games/commit/efd30b474ec07310ad5af7e22649d5d3f01cf7f4
> "Add -e flag to tmux capture-pane to preserve escape sequences for text and background attributes."

### S3 — npmjs: @xterm/xterm
https://www.npmjs.com/package/@xterm/xterm
> "Full xterm terminal, in your browser. Latest version: 6.0.0, last published: 6 months ago."

### S8 — GitHub xterm.js releases
https://github.com/xtermjs/xterm.js/releases
> "The canvas renderer has moved into an addon, significantly reducing the bundle size of the xterm module. This used to be the default renderer and is now recommended only as a fallback to the webgl addon if that does not work for some reason."
