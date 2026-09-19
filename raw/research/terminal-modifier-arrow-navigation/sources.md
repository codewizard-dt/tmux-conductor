---
topic: why cmd+arrow and ctrl+arrow don't work as expected inside the terminal for cursor navigation
slug: terminal-modifier-arrow-navigation
researched: 2026-09-13
---

# Primary Sources — Why Cmd+Arrow and Ctrl+Arrow don't work as expected in the terminal

| ID | Type | Locator | Accessed | What it contributed |
|----|------|---------|----------|---------------------|
| S1 | codebase | `frontend/src/components/LogTail.tsx::mapKey` (lines 36-58) and `::handleKeyDown` (lines 494-535) | 2026-09-13 | The `mapKey` function's `metaKey`/`ctrlKey` short-circuits to `null` for any arrow key, and `handleKeyDown` never calls `preventDefault()` when `mapKey` returns `null`, leaving no browser fallback on the non-editable capture `<div>`. |
| S2 | web | https://github.com/tmux/tmux/wiki/Modifier-Keys | 2026-09-13 | tmux describes modifier keys with `C-`, `M-`, `S-` prefixes, combinable (`C-M-Left`), and has builtin support for common sequences like `C-Left`/`S-Left`; support for modifiers on arrow/function keys depends on the terminal and tmux agreeing on the escape sequence. |
| S3 | web | https://stackoverflow.com/questions/68835405/binding-arrow-keys-for-tmux-with-macos-terminal | 2026-09-13 | Real-world tmux configs bind `C-Left`/`C-Right`/`C-Up`/`C-Down`/`M-Left` etc. as first-class key names in both `bind-key` and `send-keys`, confirming tmux's send-keys accepts these compound names directly. |
| S4 | web | https://unix.stackexchange.com/questions/262129/what-is-the-gnome-terminal-ansi-escape-sequence-for-ctrl-arrow-s/262137 | 2026-09-13 | Standard xterm escape sequences for Ctrl+Arrow: `\e[1;5D` (Ctrl+Left) and `\e[1;5C` (Ctrl+Right) — the `5` is the xterm modifier parameter for Ctrl. |
| S5 | web | https://unix.stackexchange.com/questions/149613/xterm-ctrlarrow-shortcut-keys | 2026-09-13 | Applications must bind the resulting escape sequences themselves — e.g. zsh: `bindkey '\e[1;5C' forward-word` / `bindkey '\e[1;5D' backward-word` — confirming this is a shell-side readline/zle binding, external to the terminal emulator itself. |
| S6 | web | https://linuxvox.com/blog/what-is-terminal-escape-sequence-for-ctrl-arrow-left-right-in-term-linux/ | 2026-09-13 | Restates the Ctrl+Arrow escape sequence breakdown (`\e[1;5D`/`\e[1;5C`) and notes modifier+arrow failures are a common frustration specifically in browser-based/web terminal UIs — directly analogous to this dashboard's situation. |
| S7 | web | https://stackoverflow.com/questions/19313807/tmux-send-keys-syntax | 2026-09-13 | tmux manpage key-bindings section: Ctrl keys prefixed `C-` or `^`, Alt/meta with `M-`; named keys include `Up, Down, Left, Right, Home, End, PPage, PageUp, NPage, PageDown`, etc. — the vocabulary `TMUX_KEY_RE` in this repo partially mirrors. |
| S8 | codebase | `wiki/knowledge/concepts/browser-terminal-input-capture.md` | 2026-09-13 | Confirms the dashboard's terminal architecture (read-only xterm.js mirror + external `<div>` key capture) and that the existing documented collisions (paste `stopPropagation()`, focus drifting into xterm's helper textarea) are unrelated to, and do not cover, the modifier-arrow-key mapping gap found in this research. |
| S9 | codebase | `host-server/index.ts` lines 70-75 (`TMUX_KEY_RE`) | 2026-09-13 | Server-side allowlist regex for tmux key names forwardable via `/agents/:agent/keys`; has no alternative for a modifier combined with an arrow/Home/End/PageUp/PageDown key, only bare arrows and `C-[a-z]`/`M-[A-Za-z]`. |
| S10 | codebase | `frontend/src/components/AgentList.test.tsx` lines 494-506 | 2026-09-13 | Existing TASK-141 regression test asserting a bare Cmd-only or Ctrl-only ArrowRight must NOT trigger `AgentList`'s agent-switch navigation (only `Ctrl+Alt+Arrow` does) — the relevant test file to extend when adding a parallel assertion for `LogTail.tsx`'s `mapKey()` behavior. |
| S11 | codebase | `wiki/work/tasks/TASK-141-fix-agent-switch-hotkey-conflict.md` | 2026-09-13 | TASK-141 (created/worked 2026-09-13, status `pending-uat`) replaced `AgentDetailModal`'s `Cmd/Ctrl+Arrow` agent-switch shortcut with `Ctrl+Alt+Arrow`, on the stated assumption that `Cmd+Left/Right` would then "reach the embedded terminal as ordinary readline cursor navigation instead" — an assumption this research shows is false given `mapKey()`'s unconditional `metaKey → null` and the non-editable capture `<div>`. Also confirms `Cmd+Arrow` is no longer reserved for agent-switching (superseding a claim in `terminal-keyboard-clipboard.md`). |
| S12 | codebase | `wiki/work/uat/UAT-141-fix-agent-switch-hotkey-conflict.md` | 2026-09-13 | `UAT-UI-002` ("Cmd+Left/Right reaches the embedded terminal as cursor navigation") is still unchecked (`- [ ] Pass`) as of this research and explicitly requires manual/live-browser verification (not reproducible in jsdom) — the exact scenario this research predicts will fail when walked. |

## Excerpts

### S1 — `frontend/src/components/LogTail.tsx`
```ts
/** Browser KeyboardEvent → /agents/:agent/keys payload, or null to let the browser handle it. */
function mapKey(e: KeyboardEvent<HTMLDivElement>): KeysPayload | null {
  if (e.metaKey) return null // keep Cmd+R, Cmd+W, …
  if (e.ctrlKey) {
    return /^[a-zA-Z]$/.test(e.key) ? { keys: [`C-${e.key.toLowerCase()}`] } : null
  }
  switch (e.key) {
    ...
    case 'ArrowLeft': return { keys: ['Left'] }
    case 'ArrowRight': return { keys: ['Right'] }
    ...
  }
}
```
and
```ts
const payload = mapKey(e)
if (!payload) return
e.preventDefault()
e.stopPropagation()
enqueue(payload)
```

### S2 — tmux Modifier Keys wiki
https://github.com/tmux/tmux/wiki/Modifier-Keys
> tmux describes keys with modifiers with one of three prefixes: ... S- for Shift keys. These may be combined, so Ctrl and Meta and Left is C-M-Left. ... Support for modifiers and function keys, such as C-F1 or C-S-Left, is not always present and these are often the keys that cause most trouble.

### S3 — Binding arrow keys for tmux with macOS Terminal (Stack Overflow)
https://stackoverflow.com/questions/68835405/binding-arrow-keys-for-tmux-with-macos-terminal
> bind -T root C-Left select-pane -L
> bind -T root C-Right select-pane -R
> bind -T root M-C-Left previous-window

### S4 — What is the gnome-terminal ANSI escape sequence for "CTRL + arrow/s"? (Unix & Linux SE)
https://unix.stackexchange.com/questions/262129/what-is-the-gnome-terminal-ansi-escape-sequence-for-ctrl-arrow-s/262137
> What you are looking for is a string like \e[1;5D (for control left-arrow), where the 5 denotes the control modifier. In ncurses, you can see these strings using infocmp -x, as the values for kUP5, kDN5, kLFT5 and kRIT5.

### S5 — Xterm Ctrl+Arrow shortcut keys (Unix & Linux SE)
https://unix.stackexchange.com/questions/149613/xterm-ctrlarrow-shortcut-keys
> You need to configure your applications to recognize the escape sequences. For instance, with *modifyCursorKeys: 2 (which is the default) and zsh: bindkey '\e[1;5C' forward-word bindkey '\e[1;5D' backward-word

### S6 — Terminal escape sequence for Ctrl+Arrow when TERM=linux (linuxvox.com)
https://linuxvox.com/blog/what-is-terminal-escape-sequence-for-ctrl-arrow-left-right-in-term-linux/
> The full sequence is \e[1;5D (for Ctrl+Left) and typically \e[1;5C (for Ctrl+Right). ... a common frustration arises when modifier key combinations like Ctrl+Left Arrow or Ctrl+Right Arrow fail to work as expected—for example, to jump between words in a shell. This often stems from mismatched terminal escape sequences ... browser-based SSH terminals.

### S7 — tmux send-keys syntax (Stack Overflow)
https://stackoverflow.com/questions/19313807/tmux-send-keys-syntax
> Ctrl keys may be prefixed with 'C-' or '^', and Alt (meta) with 'M-'. In addition, the following special key names are accepted: Up, Down, Left, Right, BSpace, BTab, DC (Delete), End, Enter, Escape, F1 to F20, Home, IC (Insert), NPage/PageDown/PgDn, PPage/PageUp/PgUp, Space, and Tab.

### S9 — `host-server/index.ts`
```ts
// Direct-input endpoint limits: tmux key names the dashboard may forward, and
// payload caps. Key names can never start with '-' so they are safe as
// send-keys positional args.
const TMUX_KEY_RE = /^(Enter|Escape|Tab|BTab|Space|BSpace|DC|IC|Up|Down|Left|Right|Home|End|PPage|NPage|F([1-9]|1[0-2])|C-[a-z]|M-[A-Za-z])$/;
```

### S10 — `frontend/src/components/AgentList.test.tsx`
```ts
// Regression guard (TASK-141): a bare Cmd-only or Ctrl-only ArrowRight must NOT
// trigger agent-switch navigation any more — only Ctrl+Alt does now.
fireEvent.keyDown(document, { key: 'ArrowRight', metaKey: true })
expect(screen.getByRole('dialog', { name: 'node-beta detail' })).toBeInTheDocument()
fireEvent.keyDown(document, { key: 'ArrowRight', ctrlKey: true })
expect(screen.getByRole('dialog', { name: 'node-beta detail' })).toBeInTheDocument()
fireEvent.keyDown(document, { key: 'ArrowRight', ctrlKey: true, altKey: true })
expect(await screen.findByRole('dialog', { name: 'node-gamma detail' })).toBeInTheDocument()
```
