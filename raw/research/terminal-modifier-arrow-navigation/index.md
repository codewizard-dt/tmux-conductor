---
topic: why cmd+arrow and ctrl+arrow don't work as expected inside the terminal for cursor navigation
slug: terminal-modifier-arrow-navigation
researched: 2026-09-13
sources: [./sources.md]
---

# Research: Why Cmd+Arrow and Ctrl+Arrow don't work as expected in the terminal

> Cmd+Arrow and Ctrl+Arrow do nothing in the dashboard's "Direct Input" terminal because the browser→tmux key-translation layer explicitly drops both: `mapKey()` in `LogTail.tsx` returns `null` for any Cmd-modified key (by design, line 38) and for any Ctrl-modified key that isn't a bare letter (line 39-40), including the arrows. When `mapKey` returns `null`, the handler returns *without* calling `preventDefault()`, but that's not a rescue — the capture target is a plain non-editable `<div>`, which has no native "move cursor" behavior for modified arrows to fall back to. So the keystroke is simply swallowed with zero visible effect. Even if the frontend were fixed, the host-server's key-name allowlist (`TMUX_KEY_RE`) would still reject a modified-arrow key name like `C-Left`, since it only permits bare arrows and `C-[a-z]` / `M-[A-Za-z]`. The fix requires changes on both sides, and tmux itself already supports the needed named keys (`C-Left`, `M-Left`, etc.) once the terminal/shell layer is configured to interpret them.

## Research Questions
- What code path turns a browser keydown event into the keystroke tmux actually receives for the dashboard's "Direct Input" terminal?
- Why specifically do Cmd+Arrow and Ctrl+Arrow fail while plain arrows work?
- Is there a server-side gate that would also need to change even if the frontend mapping were fixed?
- What do word-jump / line-start-end key combinations conventionally look like in a real terminal (tmux, xterm, macOS Terminal/iTerm2), so a fix matches user expectation?
- Is this a known/documented limitation already, or a new gap?

## Current State (Codebase)

The dashboard does **not** let a real terminal emulator own keyboard input. Per `wiki/knowledge/concepts/browser-terminal-input-capture.md`, each agent pane is rendered as a **read-only xterm.js mirror** (`disableStdin: true`); keystrokes are captured on a separate wrapper `<div tabIndex=0>` (`captureRef` in `frontend/src/components/LogTail.tsx`) and forwarded to the backend as discrete named "keys," not as raw terminal byte sequences.

**Frontend mapping — `frontend/src/components/LogTail.tsx:36-58`:**

```ts
function mapKey(e: KeyboardEvent<HTMLDivElement>): KeysPayload | null {
  if (e.metaKey) return null // keep Cmd+R, Cmd+W, …
  if (e.ctrlKey) {
    return /^[a-zA-Z]$/.test(e.key) ? { keys: [`C-${e.key.toLowerCase()}`] } : null
  }
  switch (e.key) {
    case 'Enter': return { keys: ['Enter'] }
    ...
    case 'ArrowLeft': return { keys: ['Left'] }
    case 'ArrowRight': return { keys: ['Right'] }
    ...
    default:
      return e.key.length === 1 ? { text: e.key } : null
  }
}
```

Two unconditional short-circuits fire before any arrow-specific logic runs:
- **Line 38** — any `metaKey` (Cmd on macOS) keydown returns `null`, full stop, regardless of which key was pressed. The comment says this is deliberate, "to keep Cmd+R, Cmd+W, …" (browser/OS shortcuts) working. But it has no exception for Cmd+Arrow, so Cmd+Left/Right/Up/Down is dropped identically to Cmd+R.
- **Lines 39-40** — any `ctrlKey` keydown is matched only against `/^[a-zA-Z]$/` (a single bare letter), to build a tmux control-character sequence like `C-c` or `C-a`. Arrow keys (`e.key === 'ArrowLeft'`, etc.) fail that regex, so the branch returns `null` for Ctrl+Arrow too.

Neither branch is arrow-aware, and the `switch` below them (the actual arrow-key logic) is never reached for Cmd- or Ctrl-modified arrows — it only sees the unmodified case. Separately, the `switch` itself is **not `altKey`-aware**: `ArrowLeft`/`ArrowRight` match the same `case` whether or not Alt/Option is held, so Option+Arrow (the actual macOS word-jump convention) is silently downgraded to a plain one-character `Left`/`Right`, discarding the modifier rather than sending a word-jump key. This is an adjacent bug, not the one asked about, but shares the same root cause (the mapping function has no concept of "arrow + modifier").

**Where the dropped keystroke goes — `frontend/src/components/LogTail.tsx:494-535` (`handleKeyDown`):**

```ts
const payload = mapKey(e)
if (!payload) return          // <-- no preventDefault/stopPropagation here
e.preventDefault()
e.stopPropagation()
enqueue(payload)
```

When `mapKey` returns `null`, `handleKeyDown` returns immediately **without** calling `preventDefault()`. The comment on `mapKey` calls this "let the browser handle it" — but the capture target, `captureRef`, is a plain `<div>` (not an `<input>`, `<textarea>`, or `contenteditable` element — confirmed via `get_symbols_overview`/JSX at `LogTail.tsx:665-679`). Browsers only have a native "move text cursor" action for Cmd/Ctrl/Option+Arrow inside an editable text context; on a non-editable `<div>`, there is no default action to fall back to. So "let the browser handle it" resolves to nothing happening at all — no pane movement, no visible feedback, no error.

**Server-side allowlist — `host-server/index.ts:70-75`:**

```ts
// Direct-input endpoint limits: tmux key names the dashboard may forward, and
// payload caps. Key names can never start with '-' so they are safe as
// send-keys positional args.
const TMUX_KEY_RE = /^(Enter|Escape|Tab|BTab|Space|BSpace|DC|IC|Up|Down|Left|Right|Home|End|PPage|NPage|F([1-9]|1[0-2])|C-[a-z]|M-[A-Za-z])$/;
```

This is the second, independent gate on the `/agents/:agent/keys` endpoint. Even if `mapKey` were changed today to emit `C-Left`, `C-Right`, `M-Left`, `M-Right`, etc., the host-server would reject those key names outright — the regex has **no alternative for a modifier combined with an arrow/Home/End/PageUp/PageDown key**. It permits bare arrows (`Up|Down|Left|Right`) and `C-[a-z]` / `M-[A-Za-z]` (letter-only Ctrl/Meta combos), but nothing like `C-Left` or `M-Right`. A correct fix therefore has to update **both** the frontend translation and this allowlist together, or the keystroke will be silently 400'd (or, if the regex is bypassed, simply never constructed by the frontend in the first place).

## Key Findings

1. **Cmd+Arrow is dropped by an unconditional early return**, not because tmux/the shell can't do anything useful with it — the frontend never even attempts a translation for a Cmd-modified arrow. [S1]
2. **Ctrl+Arrow is dropped because the Ctrl branch only recognizes single letters**, reusing the tmux `C-<letter>` control-character convention (interrupt signals like `C-c`), which has no notion of arrow keys. [S1]
3. **The "let the browser handle it" fallback is a no-op here** because the capture element is a non-editable `<div>`; there is no browser default action for modified-arrow keys outside of editable text contexts, so the user sees literally nothing happen. [S1]
4. **tmux already understands modifier+arrow key names.** tmux's key-binding syntax accepts `C-Left`, `C-Right`, `M-Left`, `S-Left`, etc. as first-class key names for both `bind-key` and `send-keys`, provided the terminal reports (or is configured with) the right escape sequences (`xterm-keys on` in `.tmux.conf`, and the client terminal emitting the standard `CSI 1;5C`/`CSI 1;5D`-style sequences). [S2][S3]
5. **The standard terminal escape sequences for Ctrl+Arrow are `ESC [ 1 ; 5 C` (right) and `ESC [ 1 ; 5 D` (left)** — the `;5` is the xterm "modifyOtherKeys"/CSI-u modifier parameter for Ctrl (2=Shift, 3=Alt/Meta, 5=Ctrl, 6=Ctrl+Shift, etc.). Shells bind these via readline (`bindkey`/`bind -x` to `forward-word`/`backward-word`) — this is default behavior in modern bash/readline, though zsh sometimes needs explicit `bindkey` entries depending on the distro's default `.zshrc`. [S4][S5]
6. **On macOS specifically, the conventional word-jump/line-jump gestures differ from generic Linux/Windows Ctrl+Arrow**: Terminal.app and iTerm2 map **Option(Alt)+Left/Right** to word-jump (sending `ESC b` / `ESC f`, the readline Meta-b/Meta-f word-motion bindings, or the CSI `;3` variant) and **Cmd+Left/Right** to jump to start/end of line (sent as `Home`/`End`, which readline binds to beginning-of-line/end-of-line). A literal physical Ctrl+Arrow is not the native macOS terminal word-jump gesture — so a user on a Mac typing "cmd+arrow and ctrl+arrow" is very likely describing the Cmd-for-line-edges / Option-for-word-jump mental model from Terminal.app/iTerm2, neither of which is implemented in `mapKey` today. [S6][S7]
7. **This exact gap is partially documented already, and directly explains an open UAT gap on today's date.** `wiki/knowledge/sources/terminal-keyboard-clipboard.md` (2026-08-15 research) already root-caused `mapKey()` never reading `altKey`/`shiftKey` and dropping all `metaKey` chords, and recommended `Option+Arrow → M-b/M-f` as the (frontend-only) word-jump fix — but that fix was **never implemented**: today's `mapKey()` still has no `altKey` branch. Separately, and more urgently: **`TASK-141` (created and worked today, 2026-09-13, status `pending-uat`)** removed `AgentDetailModal`'s old `Cmd+Arrow`/`Ctrl+Arrow` agent-switch shortcut (replacing it with `Ctrl+Alt+Arrow`) specifically so `Cmd+Left/Right` would stop being intercepted as agent-navigation and could "reach the embedded terminal as ordinary readline cursor navigation instead." Its own UAT (`UAT-141`, `UAT-UI-002`) is still **unchecked/pending** and asks the tester to confirm "Cmd+Left moves the terminal's own cursor to the start of the line (readline behavior)." **It will not** — `mapKey()` returns `null` for `e.metaKey` and the capture target is a plain non-editable `<div>` with no native cursor behavior to fall back to, exactly as this research's Collision analysis shows. This research strongly suggests the person running this `/research` query is mid-way through `UAT-141` and just hit `UAT-UI-002` failing. [S8][S11][S12]
8. **A related claim in `terminal-keyboard-clipboard.md` is now stale.** That page states "`Cmd+←/→` is deliberately reserved for previous/next-agent navigation in `AgentList.tsx` and stays that way, so `Option` is the only free modifier." `TASK-141` (2026-09-13) removed that reservation — the agent-switch shortcut is now `Ctrl+Alt+Arrow` only, and a regression test (`AgentList.test.tsx:496-506`) explicitly asserts bare `Cmd`-only and `Ctrl`-only arrows are no-ops for navigation. `Cmd+Arrow` is no longer claimed by agent-switching, which reopens it as a plausible target for the Home/End mapping this report recommends. See the `> **Contradiction:**` callout added to that page during this research's wiki-ingest. [S11]

## Constraints

- Any fix must pass through **two** independent layers that currently agree with each other (by dropping the keys): `mapKey()` in `frontend/src/components/LogTail.tsx` and `TMUX_KEY_RE` in `host-server/index.ts`. Updating only one leaves the feature non-functional (frontend sends a key name the server 400s, or the frontend still never constructs it).
- `TMUX_KEY_RE`'s comment states the constraint that key names must never start with `-` (so they're safe as unescaped `send-keys` positional args after tmux option parsing) — any new alternative added to the regex must preserve that property. `C-Left`, `M-Left`, etc. already satisfy it (they start with a letter).
- The existing `e.metaKey → null` short-circuit deliberately preserves browser/OS shortcuts like Cmd+R (reload) and Cmd+W (close tab) — a fix cannot simply delete that branch; it needs to keep blocking single-letter/Cmd-word shortcuts while adding a carve-out for Cmd+Arrow specifically (and, if desired, Cmd+Home/End or other Cmd combos that have a clear terminal-side meaning).
- The `switch` statement's lack of `altKey`-awareness for arrows is a second, closely related bug (Option+Arrow silently becomes a plain arrow instead of a word-jump) — worth fixing in the same change since it's the same function and the same class of gap, but it is not what was literally asked ("cmd+arrow and ctrl+arrow").
- Whatever tmux key name is chosen still depends on the **shell inside the pane** (bash/zsh via readline, or another line editor) having the correct key bindings for the resulting escape sequence. This is normally already true (`xterm-keys on` is a standard tmux setting, and readline defaults include the CSI `;5C`/`;5D` bindings in modern bash); it's an external dependency, not something this repo needs to configure, but it should be verified against `conductor.conf`'s tmux settings if word-jump still doesn't work after the frontend/server fix.

## Relation to TASK-141 / UAT-141 (in progress today)

`TASK-141` — "Replace Cmd/Ctrl+Arrow agent-switch hotkey to stop conflicting with terminal cursor navigation" — was created and completed (`pending-uat`) today. It fixed a *different* bug than this research: `AgentDetailModal`'s own document-level keydown handler was intercepting `Cmd+Arrow`/`Ctrl+Arrow` as an agent-switch shortcut before those keys could even reach the terminal's capture `<div>`. That fix is correct and verified (`AgentList.test.tsx`, `UAT-EDGE-001/002`, `UAT-UI-001` all pass).

But `TASK-141`'s Objective and `UAT-141`'s `UAT-UI-002` both assumed that once the modal stopped stealing the keystroke, the browser/terminal would "naturally" handle `Cmd+Left/Right` as readline-style cursor navigation. **That assumption is false**, per this research's Collision analysis: `LogTail.tsx`'s capture target is a non-editable `<div>`, and `mapKey()` unconditionally returns `null` for `metaKey`. There is no native fallback for the keystroke to land in. `UAT-UI-002` is still unchecked (`- [ ] Pass`) — walking it will very likely fail exactly as described in this report's Key Findings.

**This report's fix closes the gap `TASK-141` opened the door to but didn't finish**: `TASK-141` correctly stopped the modal from stealing `Cmd`/`Ctrl`+`Arrow`; this report's fix (below) is what's needed to make those keys actually do something useful once they reach the terminal.

## Recommendation

**Extend `mapKey()` to special-case arrow keys before the `metaKey`/`ctrlKey` short-circuits, and extend `TMUX_KEY_RE` to accept the resulting modified-arrow key names.**

Implementation outline:
1. In `frontend/src/components/LogTail.tsx`, before (or as part of) the `metaKey`/`ctrlKey` checks, add explicit handling for the four arrow keys (and optionally `Home`/`End`) combined with `ctrlKey`, `metaKey`, and `altKey`:
   - `Ctrl+Left/Right` → `{ keys: ['C-Left'] }` / `{ keys: ['C-Right'] }` (generic Linux/Windows word-jump convention; tmux passes these through as `CSI 1;5D`/`CSI 1;5C` once the pane's shell has the readline bindings).
   - `Cmd+Left/Right` → `{ keys: ['Home'] }` / `{ keys: ['End'] }` to match the macOS Terminal.app/iTerm2 convention (jump to start/end of line), rather than a `M-Left`/`M-Right` tmux key name that has no such meaning.
   - `Option(Alt)+Left/Right` → `{ keys: ['M-Left'] }` / `{ keys: ['M-Right'] }` (or `M-b`/`M-f`, the readline word-motion mnemonics) to match the macOS word-jump convention — this closes the adjacent Alt-modifier bug noted above.
   - Leave `Cmd+Up/Down` and other Cmd+key combos returning `null` as today (preserves Cmd+R/Cmd+W etc.).
2. In `host-server/index.ts`, extend `TMUX_KEY_RE` to accept the new key names, e.g. add `C-(Left|Right|Up|Down)|M-(Left|Right|Up|Down)` as additional alternatives (alongside the existing `C-[a-z]` and `M-[A-Za-z]`).
3. Add/extend the regression test that already exists for `AgentList.test.tsx`'s Cmd/Ctrl+Arrow no-op assertions (TASK-141 guard, `frontend/src/components/AgentList.test.tsx:496-506`) — that test intentionally asserts Cmd/Ctrl+Arrow are *not* agent-switch shortcuts at the `AgentList` level; a parallel test for `LogTail.tsx`'s `mapKey()` should assert the new payloads are produced instead of `null` for the arrow+modifier combinations being added.
4. Manually verify against a real pane: with the pane running bash/zsh, confirm `C-Left`/`C-Right` actually perform word-jump (this depends on the shell's readline/zle bindings, which is outside this repo's control but should hold by default for bash and for most zsh configs with `bindkey -e`/emacs mode).

Risks and mitigations:
- **Overreach into unrelated Cmd shortcuts**: keep the new logic scoped to arrow keys only (and Home/End if added), leaving every other `metaKey` combination behaviorally unchanged.
- **Shell-side bindings differ (zsh vi-mode, custom `.inputrc`)**: word-jump may still not work for a given agent's shell configuration even after this fix — that's an environment issue, not a bug in this repo; consider a short note in the dashboard's Direct Input tooltip/help if this comes up again.
- **Server allowlist drift**: since the allowlist regex and the frontend's key vocabulary must stay in sync, consider a shared constant or a comment cross-referencing the two files (they already reference each other loosely via comments) so a future arrow/key addition doesn't get half-shipped again.

Alternative if constraints change: if the dashboard ever moves to real PTY-over-WebSocket forwarding (raw bytes instead of named tmux keys — a more xterm.js-native architecture), this entire named-key translation layer disappears and modifier+arrow handling becomes "whatever xterm.js's own keyboard handler already produces," which natively supports CSI-modified sequences. That would be a much larger architectural change than what's being asked here, so it's noted only as a longer-term alternative, not a recommendation for this fix.

## Next Steps

- **Do not mark `UAT-141`'s `UAT-UI-002` as Pass as-is** — walking it will surface exactly this gap. Either block it on a follow-up fix, or record the observed failure and file a follow-up task before closing `TASK-141`'s UAT.
- `/task-add Fix Cmd+Arrow and Ctrl+Arrow (and Option+Arrow) cursor navigation in the dashboard's Direct Input terminal by extending LogTail.tsx's mapKey() and host-server's TMUX_KEY_RE allowlist` — this is a small, well-scoped two-file change with a clear existing test to extend, and should reference both `TASK-141` (`relates_to::[[TASK-141]]`, the prerequisite fix that stopped the modal from stealing these keys) and this research.
- If the recommendation's Cmd+Arrow → Home/End mapping is contested (some non-macOS users may expect Cmd+Arrow to do nothing, since Cmd is a Mac-only modifier), consider a quick user check before committing to that specific behavior; Ctrl+Arrow → word-jump is uncontroversial across platforms.
