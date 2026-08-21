---
topic: why cmd+v doesn't work in the browser terminal. also cmd/option + arrow key for jumping the cursor by word or line, and cmd/option + backspace , and holding shift to select text
slug: terminal-keyboard-clipboard
researched: 2026-08-15
---

# Primary Sources — Terminal keyboard & clipboard in Interact mode

All findings in this report come from primary sources: the project's own code, the
installed `@xterm/xterm@6.0.0` bundle, and direct experiments run on 2026-08-15 against
the live dashboard, a real tmux 3.6a server, and a real Claude Code v2.1.233 input line.
Two external web-research subagents were dispatched but had not reported by the time the
experiments answered the questions directly; nothing here depends on them.

| ID | Type | Locator | Accessed | What it contributed |
|----|------|---------|----------|---------------------|
| S1 | experiment | Live dashboard (Vite dev server on :4322 against the running host-server), driven with Playwright; `fetch` and `WebSocket.prototype.send` stubbed so nothing reached any agent pane | 2026-08-15 | The measured behaviour table (what each key actually sends); `Cmd+V` produces zero sends; paste targets `xterm-helper-textarea` while the wrapper div holds focus; a second click and a drag-select both move focus into xterm; with focus in xterm, keydown never bubbles past the capture phase; drag-select produces 3 `.xterm-selection` divs; selection survives 6 s on an idle agent |
| S2 | codebase (dependency) | `frontend/node_modules/@xterm/xterm/lib/xterm.js` (v6.0.0), read via `node -e` regex extraction | 2026-08-15 | `handlePasteEvent` calls `stopPropagation()` first; paste registered on both `this.textarea` and `this.element`; `copy` registered on `this.element`; `shouldForceSelection` is Option-on-macOS gated by `macOptionClickForcesSelection` (default `false`); `_handleIncrementalClick` on shift-click |
| S3 | experiment | Isolated probe page served on `http://127.0.0.1:8899/paste-probe.html`, driven with Playwright (page deleted after the run) | 2026-08-15 | Paste *does* fire on a focused non-editable `div[tabindex=0]`; an inner listener calling `stopPropagation()` blocks the wrapper's bubble listener; a **capture-phase** listener on the wrapper still receives the full clipboard data |
| S4 | experiment | `tmux -L keyprobe` — a throwaway tmux server on a separate socket, `tmux -V` = 3.6a | 2026-08-15 | Byte sequences emitted by `M-Left`, `M-Right`, `C-Left`, `C-Right`, `S-Left`, `M-b`, `M-f`, `Home`, `End`, `M-Delete`; `xterm-keys on` changes nothing in 3.6a; **unknown key names are typed literally** (`C-BSpace` → the literal text `C-BSpace`); `C-u`/`C-w` visibly performed kill-line/kill-word |
| S5 | experiment | Real `claude` (Claude Code v2.1.233) started inside the `-L keyprobe` tmux socket; keys sent with `send-keys`, input line read back with `capture-pane`; Enter never pressed, so no API call was made | 2026-08-15 | Confirmed in Claude Code's input: `M-Left`/`M-Right` = word jump; `M-b`/`M-f` = word jump; `M-BSpace` = delete previous word; `C-w` = delete previous word; `C-u` = kill to line start; `C-k` = kill to line end; `C-a`/`C-e` = line start/end |
| S6 | codebase | `frontend/src/components/LogTail.tsx` — `mapKey` (L36-56), `handleKeyDown` (L463-504), `handlePaste` (L520-525), `applySnapshot` (L202-211), Terminal construction (L270-282), capture div (L634-648), `handleBlur` (L541-545), `isExpandShortcut` (L12-14) | 2026-08-15 | `metaKey` returns `null`; `altKey`/`shiftKey` never read; paste truncated to first line; `disableStdin: true`; `term.write('\x1bc' + text)` full reset per frame; `Alt+F` reserved; `e.code === 'KeyF'` precedent for macOS Option dead keys |
| S7 | codebase | `host-server/index.ts` — `TMUX_KEY_RE` (L70), `sendDirectInput` (L491-559) | 2026-08-15 | The server allowlist permits `C-[a-z]` and `M-[A-Za-z]` but no modified named keys; multi-line text already routed through `set-buffer` + `paste-buffer -p -d` (bracketed paste) |
| S8 | codebase | `frontend/src/components/AgentList.tsx` L74-76, L573-583 | 2026-08-15 | Document-level handler binds `Cmd/Ctrl + ArrowLeft/Right` to previous/next agent; skips only `TEXTAREA`/`INPUT` targets; `isLogExpandShortcut` reserves `Alt+F` |
| S9 | codebase | `frontend/src/components/LogTail.test.tsx` | 2026-08-15 | Only `formatChunkTs` is tested — `mapKey` has no unit-test coverage |
| S10 | codebase | `wiki/knowledge/entities/components/log-tail.md` | 2026-08-15 | Existing wiki page documenting LogTail's xterm/snapshot design and Interact mode; the page to update after ingest |

## Excerpts

### S2 — `@xterm/xterm@6.0.0`, minified bundle

Paste handler stops propagation before doing anything else:

> `t.handlePasteEvent=function(e,t,i,s){e.stopPropagation(),e.clipboardData&&r(e.clipboardData.getData("text/plain"),t,i,s)}`

Registered on both the helper textarea and the terminal root element:

> `this._register((0,I.addDisposableListener)(this.textarea,"paste",e)),this._register((0,I.addDisposableListener)(this.element,"paste",e))`

Copy handler on the root element:

> `this._register((0,I.addDisposableListener)(this.element,"copy",(e=>{this.hasSelection()&&(0,s.copyHandler)(e,this._selectionService)})))`

Force-selection modifier is Option on macOS, Shift elsewhere, and gated by an option that defaults to false:

> `shouldForceSelection(e){return c.isMac?e.altKey&&this._optionsService.rawOptions.macOptionClickForcesSelection:e.shiftKey}`

> `macOptionClickForcesSelection:!1`

Shift-click extends an existing selection:

> `e.preventDefault(),this._dragScrollAmount=0,this._enabled&&e.shiftKey?this._handleIncrementalClick(e):1===e.detail?this._handleSingleClick(e):…`

### S1 — Live dashboard, event routing for Cmd+V

Instrumented capture-phase listeners in the running app, immediately after explicitly focusing the capture wrapper:

> ```
> PRE active=relative border bg-[#0b0b0d] f
> keydown Meta | target=relative border bg-[#0b0b0d] f | active=relative border bg-[#0b0b0d] f
> keydown v    | target=relative border bg-[#0b0b0d] f | active=relative border bg-[#0b0b0d] f
> paste        | target=xterm-helper-textarea          | active=relative border bg-[#0b0b0d] f
> ```

With focus inside xterm, keydown is seen only at the document capture phase and never bubbles:

> ```
> "focusInXterm":  { "log": ["DOC-capture Escape target=xterm-helper-textarea"] }
> "focusOnWrapper":{ "log": ["DOC-capture Escape target=relative border bg-[#0b0b0d] f", "WRAP-bubble Escape"] }
> ```

Measured outbound payloads per key (WebSocket send captured, not transmitted):

> ```
> "z":               ["WS {...\"payload\":{\"text\":\"z\"}}"]
> "Alt+ArrowLeft":   ["WS {...\"payload\":{\"keys\":[\"Left\"]}}"]
> "Alt+Backspace":   ["WS {...\"payload\":{\"keys\":[\"BSpace\"]}}"]
> "Shift+ArrowLeft": ["WS {...\"payload\":{\"keys\":[\"Left\"]}}"]
> "Control+a":       ["WS {...\"payload\":{\"keys\":[\"C-a\"]}}"]
> "Home":            ["WS {...\"payload\":{\"keys\":[\"Home\"]}}"]
> "Meta+Backspace":  []
> "Meta+v":          []
> ```

### S3 — Isolated probe: capture phase defeats `stopPropagation()`

Focus on the inner element whose listener calls `stopPropagation()`:

> ```
> WRAP keydown key="Meta" meta=true …
> WRAP keydown key="v" meta=true …
> WRAP paste (CAPTURE) fired; data="HELLO-FROM-CLIPBOARD"
> INNER paste fired (stopProp=true)
> ```

The wrapper's *bubble* listener never fires; the *capture* listener does, and receives the data.

### S4 — tmux 3.6a key-name behaviour

Bytes delivered to a pane running `cat -v` (label, then the key, then a closing bracket):

> `[M-Left=^[[1;3D] [M-Right=^[[1;3C] [M-BSpace=] [M-Delete=^[[3;3~] [C-Left=^[[1;5D] [C-Right=^[[1;5C] [S-Left=^[[1;2D] [C-BSpace=C-BSpace] [M-b=^[b] [M-f=^[f] [Home=^[[1~] [End=^[[4~]`

Note `[C-BSpace=C-BSpace]` — an unrecognised key name is **not** rejected; tmux types it into the pane as literal text. With `xterm-keys on` the sequences were byte-identical:

> `[M-Left=^[[1;3D] [M-Right=^[[1;3C] [C-Left=^[[1;5D] [C-Right=^[[1;5C] [S-Left=^[[1;2D]`

### S5 — Claude Code v2.1.233 input line, keys applied to a live buffer

Word jump with `M-Left` (two presses from end of line, then typing `X`):

> ```
> start:       ❯ alpha bravo charlie delta
> 2x M-Left+X: ❯ alpha bravo Xcharlie delta
> ```

Same result via `M-b` / `M-f`:

> ```
> start:      ❯ alpha bravo charlie delta
> 2x M-b +X:  ❯ alpha bravo Xcharlie delta
> M-f +Y:     ❯ alpha bravo Xcharlie Ydelta
> ```

Word delete, line start/end:

> ```
> start:        ❯ alpha bravo Xcharlie delta
> M-BSpace:     ❯ alpha bravo charlie delta
> typed |END:   ❯ alpha bravo charlie delta|END      (after C-e)
> typed START|: ❯ START|alpha bravo charlie delta|END (after C-a)
> ```

Kill-word, kill-to-line-start, kill-to-line-end:

> ```
> start:    ❯ START|alpha #bravo charlie delta|END
> C-w:      ❯ START|bravo charlie delta|END
> C-u:      ❯ bravo charlie delta|END
> C-k:      ❯ one
> ```

### S6 — `frontend/src/components/LogTail.tsx`

> ```ts
> function mapKey(e: KeyboardEvent<HTMLDivElement>): KeysPayload | null {
>   if (e.metaKey) return null // keep Cmd+R, Cmd+W, …
>   if (e.ctrlKey) {
>     return /^[a-zA-Z]$/.test(e.key) ? { keys: [`C-${e.key.toLowerCase()}`] } : null
>   }
> ```

> ```ts
> const firstLine = e.clipboardData.getData('text').replace(/\r/g, '').split('\n')[0] ?? ''
> ```

> ```ts
> term.write('\x1bc' + text, () => { … })
> ```

### S7 — `host-server/index.ts`

> ```ts
> const TMUX_KEY_RE = /^(Enter|Escape|Tab|BTab|Space|BSpace|DC|IC|Up|Down|Left|Right|Home|End|PPage|NPage|F([1-9]|1[0-2])|C-[a-z]|M-[A-Za-z])$/;
> ```

Multi-line text already uses bracketed paste:

> ```ts
> sends.push(['set-buffer', '-b', buf, '--', textStr]);
> sends.push(['paste-buffer', '-t', target, '-b', buf, '-p', '-d']);
> ```

### S8 — `frontend/src/components/AgentList.tsx`

> ```ts
> if (e.metaKey || e.ctrlKey) {
>   if (e.key === 'ArrowRight') { e.preventDefault(); onNavigate('next') }
>   if (e.key === 'ArrowLeft') { e.preventDefault(); onNavigate('prev') }
> }
> ```
