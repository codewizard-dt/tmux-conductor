---
id: tmux-send-keys-key-names
title: tmux send-keys Key Names (and the literal-fallback hazard)
aliases: [tmux-key-names, TMUX_KEY_RE, send-keys-modifiers]
updated: 2026-09-13
sources:
  - ../../../raw/research/terminal-keyboard-clipboard/index.md
  - ../../../raw/research/terminal-modifier-arrow-navigation/index.md
confidence: extracted
tags: [tmux, keyboard, host-server, security, pattern]
---

# tmux send-keys Key Names

`uses::[[host-server]]` forwards dashboard keystrokes to a pane with `tmux send-keys -t <target> <KEYNAME>`, gated by an allowlist regex `TMUX_KEY_RE` in `host-server/index.ts`. Measured against **tmux 3.6a** on an isolated socket (`tmux -L keyprobe`), sending each key to a pane running `cat -v`:

| Key name | Bytes delivered to the pane |
|---|---|
| `M-Left` / `M-Right` | `\e[1;3D` / `\e[1;3C` |
| `C-Left` / `C-Right` | `\e[1;5D` / `\e[1;5C` |
| `S-Left` | `\e[1;2D` |
| `M-Delete` | `\e[3;3~` |
| `M-b` / `M-f` | `\eb` / `\ef` |
| `Home` / `End` | `\e[1~` / `\e[4~` |

Setting `xterm-keys on` changed nothing — the option is vestigial in modern tmux; these are the default encodings.

## The hazard: unknown key names are typed literally

**`tmux send-keys` does not reject an unrecognised key name — it sends it to the pane as literal text.** Verified: `tmux send-keys -t p C-BSpace` (not a valid tmux key name) put the literal string `C-BSpace` into the pane's input. `NotAKey` and `M-NopeKey` likewise succeeded with exit status 0.

The practical consequence: **`TMUX_KEY_RE` is the only thing standing between a typo and garbage text being typed into a live agent's prompt.** It must stay an explicit enumeration of names verified to work. Never loosen it to a broad pattern such as `[CMS]-\w+` on the assumption that tmux will validate the rest — it will not, and exit status is not a validity signal.

## What the current allowlist already permits

```
^(Enter|Escape|Tab|BTab|Space|BSpace|DC|IC|Up|Down|Left|Right|Home|End|PPage|NPage|F([1-9]|1[0-2])|C-[a-z]|M-[A-Za-z])$
```

`C-[a-z]` and `M-[A-Za-z]` mean `C-u`, `C-w`, `C-a`, `C-e`, `C-k`, `M-b` and `M-f` are **already allowed** — which is why the Interact-mode word/line editing gaps are fixable entirely in the frontend. Modified *named* keys (`M-Left`, `M-BSpace`, `C-Left`, …) are not allowed and would need an explicit enumeration added.

## Confirmed as the server-side blocker for Cmd/Ctrl+Arrow (2026-09-13)

`derived_from::[[terminal-modifier-arrow-navigation]]` confirms this gap is exactly what stands between the dashboard and working Cmd/Ctrl/Option+Arrow cursor navigation, not just a theoretical limitation. Because `C-Left`/`C-Right`/`M-Left`/`M-Right` are already measured above as delivering the correct standard CSI sequences (`\e[1;5D/C`, `\e[1;3D/C`) that shells bind to word-motion, the fix is a small, low-risk regex extension — e.g. adding `C-(Left|Right|Up|Down)|M-(Left|Right|Up|Down)` as additional alternatives — paired with a matching change to `LogTail.tsx`'s `mapKey()`, which does not currently construct any of these names for modified arrow keydowns.

relates_to::[[host-server]] relates_to::[[terminal-keyboard-clipboard]] relates_to::[[claude-code-cli]] relates_to::[[browser-terminal-input-capture]] relates_to::[[terminal-modifier-arrow-navigation]]
