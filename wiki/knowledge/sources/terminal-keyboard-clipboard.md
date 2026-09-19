---
id: terminal-keyboard-clipboard
title: Terminal Keyboard & Clipboard in Interact Mode
aliases: [cmd-v-terminal, interact-mode-keys, terminal-paste-bug]
updated: 2026-09-13
sources:
  - ../../../raw/research/terminal-keyboard-clipboard/index.md
  - ../../../raw/research/terminal-modifier-arrow-navigation/index.md
  - ../../../raw/research/terminal-cmd-ctrl-execution-plan/index.md
confidence: ambiguous
tags: [frontend, terminal, xterm, clipboard, keyboard, interact-mode]
---

# Terminal Keyboard & Clipboard in Interact Mode

Root-causes four reported failures in the dashboard's Interact mode — `Cmd+V` doing nothing, `Cmd`/`Option`+arrow not jumping by word or line, `Cmd`/`Option`+Backspace not deleting by word or line, and Shift-select not working. All findings were established by direct experiment on 2026-08-15 against the live dashboard, a real tmux 3.6a server, and a real Claude Code v2.1.233 input line, not from documentation.

**`Cmd+V` fails because xterm.js swallows the paste event before our handler can see it.** `@xterm/xterm` v6 registers its own `paste` listener on **both** `term.textarea` and `term.element`, and that listener calls `ev.stopPropagation()` as its first statement. Because `uses::[[log-tail]]` builds the terminal with `disableStdin: true`, xterm's own paste path is then a no-op — the keystroke vanishes silently. React 19 delegates `onPaste` at the React root, *above* the capture `<div>`, so a `stopPropagation()` fired at a descendant kills it. Critically, **the paste event targets `.xterm-helper-textarea` even while the capture div holds focus**, whereas keydown targets the capture div correctly — which is exactly why typing works and pasting does not. The verified fix is to listen for `paste` in the **capture phase**, which runs before the target's bubble-phase `stopPropagation()`. See `relates_to::[[browser-terminal-input-capture]]`.

**The other three failures are all one function.** `mapKey()` in `LogTail.tsx` never reads `altKey` or `shiftKey`, and returns `null` for anything carrying `metaKey`. So `Option+←` is sent as a bare `Left`, `Option+Backspace` as a bare `BSpace`, `Shift+←` as a bare `Left`, and `Cmd+Backspace` as nothing at all. **The decisive finding is that no backend change is needed**: `M-b`, `M-f`, `C-w` and `C-u` are all already permitted by the server's `TMUX_KEY_RE` allowlist, and all four were confirmed working against a live Claude Code input line — `M-b`/`M-f` jump by word, `C-w` deletes the previous word, `C-u` kills to line start. Line start/end already work today via `Ctrl+A`/`Ctrl+E` and `Home`/`End`. `Cmd+←`/`→` is deliberately reserved for previous/next-agent navigation in `AgentList.tsx` and stays that way, so `Option` is the only free modifier — which is also the macOS-native choice. See `relates_to::[[tmux-send-keys-key-names]]`.

> **Contradiction (2026-09-13):** the "stays that way" claim above is now stale. `TASK-141` (same day) removed `Cmd/Ctrl+Arrow` from `AgentList.tsx`'s agent-switch shortcut entirely, replacing it with `Ctrl+Alt+Arrow` — a regression test (`AgentList.test.tsx:496-506`) now asserts bare `Cmd`-only and `Ctrl`-only arrows are no-ops for navigation. `Cmd+Arrow` is no longer claimed by agent-switching. However, `derived_from::[[terminal-modifier-arrow-navigation]]` found `Cmd+Arrow` still does nothing in the terminal today — not because it's reserved, but because `mapKey()`'s `metaKey → null` short-circuit (described correctly above) has no exception for it, and the capture `<div>` has no native fallback behavior to move into. `TASK-141`'s own `UAT-141` (`UAT-UI-002`) assumed freeing the shortcut would let Cmd+Arrow "just work" in the terminal; that assumption is unverified and likely false per this newer research.

**Two wider problems surfaced along the way.** First, clicking the terminal a second time — or drag-selecting text — moves focus into `.xterm-helper-textarea`, and in that state xterm stops propagation on **keydown** too, so *no* key reaches the wrapper and Interact mode is entirely dead while the orange "Direct Input" banner still claims otherwise. Second, `handlePaste` truncates pasted text to `split('\n')[0]`, even though the host-server already implements proper multi-line bracketed paste via `set-buffer` + `paste-buffer -p -d` — a purely frontend limitation. Shift+Arrow selection is not implementable at all: Claude Code's input has no keyboard-selection concept, so there is no escape sequence to map it to. Mouse drag-selection does already work, but `applySnapshot` issues `term.write('\x1bc' + text)` — a full RIS reset — on every output frame, which is expected to destroy selections on a busy agent.

> **Status update (2026-09-13):** the capture-phase paste fix described above was confirmed **still not implemented** by re-reading `LogTail.tsx` directly — paste is still wired only via React's bubble-phase `onPaste`. `handlePaste`'s first-line-only truncation is also still present, unfixed. Copy was NOT found to be broken — no app code touches it either way, and it very likely already works via xterm.js's own built-in `copy` listener (see `derived_from::[[terminal-cmd-ctrl-execution-plan]]`). No task file exists yet for either fix.

derived_from::[[terminal-keyboard-clipboard]] derived_from::[[terminal-cmd-ctrl-execution-plan]] relates_to::[[log-tail]] relates_to::[[xterm-js]] relates_to::[[claude-code-cli]] relates_to::[[host-server]] relates_to::[[browser-terminal-input-capture]] relates_to::[[tmux-send-keys-key-names]] relates_to::[[terminal-modifier-arrow-navigation]]
