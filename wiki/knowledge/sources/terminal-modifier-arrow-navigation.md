---
id: terminal-modifier-arrow-navigation
title: Why Cmd+Arrow and Ctrl+Arrow Don't Work in the Direct Input Terminal
aliases: [cmd-arrow-terminal, ctrl-arrow-terminal, modifier-arrow-key-mapping]
updated: 2026-09-13
sources:
  - ../../../raw/research/terminal-modifier-arrow-navigation/index.md
confidence: extracted
tags: [frontend, backend, terminal, keyboard, interact-mode, tmux]
---

# Why Cmd+Arrow and Ctrl+Arrow Don't Work in the Direct Input Terminal

Root-causes why pressing Cmd+Arrow or Ctrl+Arrow in the dashboard's "Direct Input" terminal does nothing visible. Two independent gates both drop the keystroke: `mapKey()` in `LogTail.tsx` returns `null` unconditionally for any `metaKey` chord (line 38) and for any `ctrlKey` chord that isn't a bare letter (lines 39-40, since only `/^[a-zA-Z]$/` builds a `C-<letter>` tmux control sequence). When `mapKey` returns `null`, `handleKeyDown` returns without calling `preventDefault()` — but that is not a working fallback, because the capture target (`captureRef`) is a plain non-editable `<div>`, which has no native cursor-navigation behavior for modified arrows to fall into. The keystroke is simply swallowed. Even a frontend fix alone is insufficient: `host-server/index.ts`'s `TMUX_KEY_RE` allowlist has no alternative for a modifier combined with an arrow key (only bare arrows and `C-[a-z]`/`M-[A-Za-z]`), so a corrected `mapKey()` would still get its new key names rejected server-side.

**tmux itself already understands the needed key names.** `relates_to::[[tmux-send-keys-key-names]]` had already measured (2026-08-15, tmux 3.6a) that `C-Left`/`C-Right` deliver `\e[1;5D`/`\e[1;5C` and `M-Left`/`M-Right` deliver `\e[1;3D`/`\e[1;3C` — the standard xterm CSI modifier sequences that shells bind via readline to word-motion (`forward-word`/`backward-word`). The blocker has never been tmux; it is that `TMUX_KEY_RE` was never extended to allow these specific compound names.

**This finding directly intersects an in-flight, same-day task.** `TASK-141` (2026-09-13, `pending-uat`) removed `AgentDetailModal`'s old `Cmd/Ctrl+Arrow` agent-switch shortcut (replacing it with `Ctrl+Alt+Arrow`) on the stated assumption that once the modal stopped intercepting the keystroke, it would "reach the embedded terminal as ordinary readline cursor navigation." That assumption does not hold, for the reasons above. `UAT-141`'s `UAT-UI-002` — which asks a tester to confirm Cmd+Left moves the terminal's own cursor — is still unchecked, and walking it is expected to fail. This also means an earlier claim in `derived_from::[[terminal-keyboard-clipboard]]` ("Cmd+←/→ is deliberately reserved for previous/next-agent navigation... and stays that way") is now **stale**: `TASK-141` freed `Cmd+Arrow` from that reservation, reopening it as a candidate for a Home/End mapping.

**Recommended fix (two files, not yet implemented)**: extend `mapKey()` to special-case the four arrow keys under `ctrlKey`/`metaKey`/`altKey` before today's unconditional short-circuits — `Ctrl+Left/Right → C-Left/C-Right` (generic word-jump), `Cmd+Left/Right → Home/End` (macOS Terminal.app/iTerm2 line-edge convention), `Option+Left/Right → M-Left/M-Right` (macOS word-jump convention, closing an adjacent bug where Option+Arrow currently degrades to a plain arrow) — and extend `TMUX_KEY_RE` to accept the new compound key names.

uses::[[log-tail]] uses::[[host-server]] relates_to::[[tmux-send-keys-key-names]] relates_to::[[terminal-keyboard-clipboard]] relates_to::[[browser-terminal-input-capture]] relates_to::[[TASK-141]]
