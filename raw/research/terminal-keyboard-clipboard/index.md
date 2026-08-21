---
topic: why cmd+v doesn't work in the browser terminal. also cmd/option + arrow key for jumping the cursor by word or line, and cmd/option + backspace , and holding shift to select text
slug: terminal-keyboard-clipboard
researched: 2026-08-15
sources: [./sources.md]
---

# Research: Terminal keyboard & clipboard in the dashboard's Interact mode

> **Cmd+V fails because xterm.js swallows the paste event before our handler runs.** xterm registers its own `paste` listener on both `term.textarea` and `term.element`, and that listener begins with `ev.stopPropagation()`; because the terminal is configured `disableStdin: true`, xterm's own paste is then a no-op. The clipboard event targets `.xterm-helper-textarea` even when our capture `<div>` holds focus, so React's delegated (bubble-phase) `onPaste` never fires and nothing is sent. Verified live: with `fetch`/`WebSocket.send` stubbed, `Cmd+V` produced **zero** outbound sends while a plain `z` produced one. The other three problems are separate and all live in one function — `mapKey()` in `LogTail.tsx` discards `altKey` entirely and returns `null` for anything with `metaKey`. **Every fix is frontend-only**: `M-b`, `M-f`, `C-w`, `C-u` are already permitted by the server's key allowlist, and all four are confirmed working in Claude Code v2.1.233. No backend change is required.

## Research Questions

1. Why does `Cmd+V` do nothing in Interact mode, when ordinary typing works?
2. Why do `Cmd`/`Option` + arrow keys not jump by word or line?
3. Why do `Cmd`/`Option` + Backspace not delete by word or to line start?
4. Why can't text be selected by holding Shift, and is mouse selection reliable?
5. Which tmux key names and escape sequences does Claude Code's input actually accept?

## Current State (Codebase)

The dashboard mirrors a tmux pane with a **read-only** xterm.js terminal and captures input on a wrapper `<div>` that *contains* it.

| Element | Role |
|---|---|
| `frontend/src/components/LogTail.tsx:634` `captureRef` div | `tabIndex=0`, owns React `onKeyDown` / `onPaste`; the orange "Direct Input" frame |
| `frontend/src/components/LogTail.tsx:660` `xtermContainerRef` div | child of the above; hosts the xterm instance |
| `frontend/src/components/LogTail.tsx:270-282` | `new Terminal({ disableStdin: true, … })` — read-only mirror |
| `frontend/src/components/LogTail.tsx:36-56` `mapKey()` | browser `KeyboardEvent` → tmux key payload |
| `frontend/src/components/LogTail.tsx:520-525` `handlePaste()` | React `onPaste`, truncates to `split('\n')[0]` |
| `frontend/src/components/LogTail.tsx:202-211` `applySnapshot()` | `term.write('\x1bc' + text)` — RIS full reset + full repaint per frame |
| `host-server/index.ts:70` `TMUX_KEY_RE` | server-side allowlist of tmux key names |
| `frontend/src/components/AgentList.tsx:577-580` | document-level `Cmd/Ctrl + ArrowLeft/Right` → previous/next agent |

`mapKey()` is the crux of problems 2–4:

```ts
if (e.metaKey) return null   // keep Cmd+R, Cmd+W, …
if (e.ctrlKey) { return /^[a-zA-Z]$/.test(e.key) ? { keys: [`C-${e.key.toLowerCase()}`] } : null }
switch (e.key) { case 'Backspace': return { keys: ['BSpace'] } ; case 'ArrowLeft': return { keys: ['Left'] } ; … }
```

`altKey` and `shiftKey` are never read, so the modifier is silently dropped.

Measured live in the running dashboard, with `fetch` and `WebSocket.prototype.send` stubbed so nothing reached the pane [S1]:

| Key pressed | What is actually sent today |
|---|---|
| `z` | `{"text":"z"}` — typing works |
| `Option+←` | `{"keys":["Left"]}` — **Option dropped**, moves one character |
| `Option+Backspace` | `{"keys":["BSpace"]}` — **Option dropped**, deletes one character |
| `Shift+←` | `{"keys":["Left"]}` — **Shift dropped** |
| `Cmd+Backspace` | *(nothing)* |
| `Cmd+V` | *(nothing)* |
| `Cmd+←` / `Cmd+→` | *(nothing sent to pane — handled by `AgentList` as prev/next agent)* |
| `Ctrl+A` | `{"keys":["C-a"]}` — works |
| `Home` | `{"keys":["Home"]}` — works |

## Key Findings

### 1. Cmd+V — xterm.js eats the paste event (root cause, confirmed)

From the installed bundle `@xterm/xterm@6.0.0` [S2]:

- `handlePasteEvent` is `function(e,t,i,s){e.stopPropagation(), e.clipboardData && r(e.clipboardData.getData("text/plain"),t,i,s)}` — it **stops propagation first**.
- It is registered on **both** the helper textarea and the terminal root: `addDisposableListener(this.textarea,"paste",e)` and `addDisposableListener(this.element,"paste",e)`.
- With `disableStdin: true` the resulting `paste()` is a no-op, so the keystroke vanishes silently.

React 19 attaches `onPaste` at the React root — *above* our wrapper — so a `stopPropagation()` fired at a descendant prevents React's synthetic `onPaste` from ever running.

Live measurement in the real dashboard [S1]:

```
PRE     active=<capture wrapper div>
keydown Meta | target=<capture wrapper div> | active=<capture wrapper div>
keydown v    | target=<capture wrapper div> | active=<capture wrapper div>
paste        | target=xterm-helper-textarea | active=<capture wrapper div>
```

Note the asymmetry: **keydown targets our wrapper, but paste targets xterm's hidden textarea** even though the wrapper holds focus. That is why typing works and pasting does not.

*(Inference — no primary source: the most likely reason clipboard events land on the textarea is that Blink routes them to the DOM selection anchor rather than `document.activeElement`, and xterm keeps a selection inside its helper textarea. The fix below does not depend on this being right.)*

Two independent conditions each put focus *inside* xterm as well, which makes it worse:

- Clicking the terminal a second time (while already in Interact mode) moves focus to `.xterm-helper-textarea` [S1].
- Drag-selecting text moves focus there too [S1].

In that state xterm's keydown handler also stops propagation, so **no key reaches the wrapper at all** — verified: with focus on the textarea, a keydown was seen only by a document *capture* listener and never bubbled, and the modal stopped responding to Escape [S1]. The orange "Direct Input — keys go to …" banner keeps claiming otherwise, because `handleBlur` treats the xterm textarea as "still inside" the capture div (`LogTail.tsx:541-545`).

**Fix, verified working:** attach the paste listener in the **capture phase**. A capture-phase listener on the ancestor runs before the target's bubble-phase `stopPropagation()` and receives the full clipboard payload [S3]:

```
WRAP paste (CAPTURE) fired; data="HELLO-FROM-CLIPBOARD"
INNER paste fired (stopProp=true)
```

### 2. Multi-line paste is truncated to one line (separate bug)

`handlePaste` keeps only `getData('text').replace(/\r/g,'').split('\n')[0]` (`LogTail.tsx:523`). The **backend already supports multi-line properly** — `sendDirectInput` routes text containing `\n` through `set-buffer` + `paste-buffer -p -d`, i.e. bracketed paste (`host-server/index.ts:531-541`). So the truncation is a purely frontend limitation and can simply be deleted.

### 3. Word / line movement — the keys work, we just never send them

Measured against tmux 3.6a on an isolated socket [S4]:

| tmux key name | bytes delivered to the pane |
|---|---|
| `M-Left` | `\e[1;3D` |
| `M-Right` | `\e[1;3C` |
| `C-Left` / `C-Right` | `\e[1;5D` / `\e[1;5C` |
| `S-Left` | `\e[1;2D` |
| `M-b` / `M-f` | `\eb` / `\ef` |
| `Home` / `End` | `\e[1~` / `\e[4~` |

Tested against a real Claude Code v2.1.233 input line, driving a throwaway session and reading the pane back [S5] — all confirmed working:

| Key | Effect in Claude Code | Allowed by `TMUX_KEY_RE` today? |
|---|---|---|
| `M-Left` / `M-Right` | word left / right | ❌ no |
| **`M-b` / `M-f`** | **word left / right** | ✅ **yes** (`M-[A-Za-z]`) |
| `M-BSpace` | delete previous word | ❌ no |
| **`C-w`** | **delete previous word** | ✅ **yes** (`C-[a-z]`) |
| **`C-u`** | **kill to start of line** | ✅ **yes** |
| `C-k` | kill to end of line | ✅ yes |
| **`C-a` / `C-e`** | **start / end of line** | ✅ yes — *already work today* |
| `Home` / `End` | start / end of line | ✅ yes — *already work today* |

The decisive result: **`M-b`/`M-f`/`C-w`/`C-u` all work in Claude Code and are all already permitted by the existing server allowlist.** No backend change is needed.

### 4. Cmd+arrow is already taken, and should stay taken

`AgentList.tsx:577-580` binds `Cmd/Ctrl + ArrowLeft/Right` to previous/next agent at the document level. The user has confirmed this stays. Two consequences:

- Line start/end must be reached another way — `Ctrl+A` / `Ctrl+E` and `Home` / `End` **already work today** and need no code change, only documentation.
- Because that handler catches `metaKey || ctrlKey`, `C-Left` / `C-Right` are also unavailable for word-jump. `Option` is the only free modifier — which is also the macOS-native choice.

### 5. Shift-select, and the repaint that eats selections

- **Mouse drag-selection already works.** A synthetic drag produced three `.xterm-selection` overlay divs [S1].
- **Shift+Arrow is not selection.** `mapKey` drops Shift and sends a bare `Left`. Claude Code's input has no keyboard-selection concept, so there is no escape sequence to map it to. Shift+*click* does extend an existing selection — that is xterm's `_handleIncrementalClick` [S2].
- On macOS, xterm's "force selection" modifier is **Option+click**, not Shift, and only when `macOptionClickForcesSelection` is enabled (default `false`) [S2]. It is not needed here, since the mirror never enables mouse reporting.
- **The fragile part is the repaint.** `applySnapshot` issues `term.write('\x1bc' + text)` — `\x1bc` is RIS, a full terminal reset — on *every* output frame. Selection survived 6 s untouched on an idle agent (no frames arriving) [S1]. *(Inference — not directly observed: on a busy agent, every frame resets the buffer and will drop the selection, making selection unusable exactly when output is streaming. Cheap check: select text on a busy agent and watch `.xterm-selection` divs go to 0.)*
- Copy-out (`Cmd+C`) was **not tested**. xterm registers its own `copy` handler on `term.element` that fills the clipboard from `selectionText` [S2], so it plausibly already works — worth a manual check.

## Constraints

- `Cmd+←/→` is reserved for agent navigation (`AgentList.tsx:577`) — confirmed by the user, do not repurpose.
- `Alt+F` is reserved for expand/collapse in both `LogTail.tsx:12` and `AgentList.tsx:74`. Any future `Option+letter` mapping collides there.
- On macOS, `Option`+letter mutates `e.key` (Option+F → `ƒ`). The codebase already handles this correctly by testing `e.code === 'KeyF'`; any new Option mapping must do the same. **Option+arrow and Option+Backspace are unaffected** — `e.key` stays `ArrowLeft` / `Backspace` with `altKey: true` [S1].
- **Unknown tmux key names are not rejected — they are typed literally.** `tmux send-keys -t p C-BSpace` put the literal text `C-BSpace` into the pane [S4]. The server allowlist is the only thing preventing garbage from being typed into an agent, so it must stay an explicit enumeration; never loosen it to a broad pattern.
- The terminal is deliberately `disableStdin: true` — a read-only mirror whose input path is the wrapper div. Any fix should preserve that model rather than hand input ownership to xterm.
- `mapKey` has no unit tests today (`LogTail.test.tsx` only covers `formatChunkTs`).

## Solution Comparison — Cmd+V

| Criteria | A. Capture-phase paste listener | B. Let xterm own input (`onData`) | C. Suppress xterm's helper textarea |
|---|---|---|---|
| **Approach** | Add `paste` listener with `{capture:true}`; drop React `onPaste` | Set `disableStdin:false`, drive input from `term.onData` | Remove/disable `.xterm-helper-textarea` so xterm has nothing to bind |
| **Pros** | Verified working [S3]; ~10 lines; keeps read-only mirror; fixes the case where focus sits in xterm | Idiomatic xterm; gets bracketed paste and key encoding for free | Also unblocks keydown swallowing |
| **Cons** | Still need a focus fix for keydown-in-xterm | Large rewrite of `mapKey`/`enqueue`; xterm would echo locally and fight the snapshot repaint | Fights the library; breaks screen-reader support; likely breaks on upgrade |
| **Complexity** | Low | High | Medium |
| **Codebase fit** | Excellent | Poor — conflicts with snapshot-mirror design | Poor |
| **Risk** | Low | High | High |

## Recommendation

**Take option A, plus a focus guard, and remap the modifiers frontend-only. No backend change.**

1. **Cmd+V** — register `paste` on the capture div with `{ capture: true }` (via `useEffect` + `addEventListener`, not React's `onPaste`), and remove the `split('\n')[0]` truncation so multi-line paste flows through the backend's existing bracketed-paste path.
2. **Keep focus out of xterm.** Either re-focus `captureRef` on `mousedown`/`mouseup` inside the terminal while `interacting`, or set `screenReaderMode: false` and add a `focus` listener that bounces focus back. Without this, keydown is *also* swallowed after any click or drag inside the terminal — a bug wider than the one reported.
3. **Extend `mapKey`** using only already-allowed key names:

   | Combo | Send | Verified effect |
   |---|---|---|
   | `Option+←` / `Option+→` | `M-b` / `M-f` | word left / right [S5] |
   | `Option+Backspace` | `C-w` | delete previous word [S5] |
   | `Cmd+Backspace` | `C-u` | kill to start of line [S5] |

   `Cmd+Backspace` needs a targeted exception *before* the blanket `if (e.metaKey) return null`, so `Cmd+R` / `Cmd+W` and the agent-navigation shortcut keep working.
4. **Document, don't build:** line start/end is `Ctrl+A` / `Ctrl+E` or `Home` / `End` — already working. Shift+Arrow selection is not implementable against Claude Code's input; say so in the UI hint rather than silently sending a bare arrow.
5. **Selection durability (optional, separate).** Make `applySnapshot` skip the repaint while `term.hasSelection()` is true, the same way it already skips while the user has scrolled up (`followRef`). Verify the busy-agent selection loss first.

**Risks & mitigations.** Capture-phase listeners run before everything else, so guard on `interacting` to avoid hijacking paste elsewhere in the dashboard. Re-focusing on mousedown could fight xterm's selection handling — apply it on `mouseup` so drag-select still completes. Adding `M-*` names is safe only for names verified against the allowlist; keep `TMUX_KEY_RE` an explicit list, because tmux types unknown names literally into the agent [S4].

**When a backend change would become preferable:** if `M-b`/`M-f` ever prove inconsistent across agent CLIs (Aider, Codex), switch to `M-Left`/`M-Right`/`M-BSpace` — verified to emit correct xterm sequences [S4] and to work in Claude Code [S5] — and widen `TMUX_KEY_RE` by explicit enumeration only.

## Next Steps

- `/task-add Fix Interact-mode clipboard and word-editing keys in LogTail: capture-phase paste listener, un-truncate multi-line paste, keep focus off the xterm helper textarea, and map Option+arrows/Option+Backspace/Cmd+Backspace to M-b/M-f/C-w/C-u`
- Add the first unit tests for `mapKey()` — it is the single point of failure for three of the four reported problems and currently has none.
- Manually verify `Cmd+C` copy-out, and confirm the busy-agent selection loss before doing work on item 5.
