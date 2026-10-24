---
id: log-tail
title: LogTail
aliases: [LogTail.tsx]
updated: 2026-09-19
sources:
  - ../../../raw/research/terminal-typed-command-persistence/index.md
  - ../../../raw/research/web-terminal-emulators/index.md
  - ../../../raw/research/application-latency-structure/index.md
  - ../../../raw/research/application-latency-structure/index-2.md
  - ../../../raw/research/terminal-keyboard-clipboard/index.md
  - ../../../raw/research/agent-detail-modal-redesign/index.md
  - ../../../raw/research/terminal-modifier-arrow-navigation/index.md
  - ../../../raw/research/xterm-scrollbar-flicker/index.md
confidence: extracted
tags: [frontend, component, terminal, react]
---

# LogTail

`frontend/src/components/LogTail.tsx` — the React component that renders the live tmux pane output for each agent in the dashboard. Used in both card view (collapsed) and modal/detail view (expanded, interact mode).

**Current state**: Uses xterm.js for terminal rendering and raw ANSI/cursor-preserving tmux snapshots for display. The prior plain-text `<pre>`/dark-div design has been superseded.

**Data flow**:
- SSE event `terminal-output` (slow, ~2s, unfocused agents) → terminal snapshot repaint
- Focused modal opens `/agents/:id/terminal/ws` for focused output/input
- SSE event `terminal-output-focus` remains a fallback path, but the latency research says it should not run concurrently with WebSocket-owned focused output
- Initial mount: fetches `/agents/:id/tail` for backfill

**Interact mode**: LogTail captures direct input and sends it over the focused WebSocket when connected, falling back to `POST /agents/:id/keys`. The component also owns focus state and must keep its effects idempotent under React Strict Mode.

**Latency concern**: A focused modal can appear to stop accepting input if backend tmux work blocks the event loop or if WebSocket and focused SSE both repaint/capture the same pane. The recommended architecture is exclusive focused WebSocket ownership with SSE only as fallback.

**Early-wrap symptom**: `FitAddon` only fits xterm's own display grid to its container — it has no channel back to the tmux pane that produced the text. If the tmux window itself is stuck at a narrow width (see [[tmux-headless-window-sizing]]), the captured text arrives already hard-wrapped and no frontend/CSS change to `LogTail` can undo it; the fix is server-side (tmux window sizing), not in this component.

## Interact-mode input defects (root-caused 2026-08-15)

Four reported failures, all verified by live experiment — see `derived_from::[[terminal-keyboard-clipboard]]`:

- **`Cmd+V` does nothing.** xterm's own `paste` listener (bound to both its textarea and root element) calls `stopPropagation()` before React's delegated `onPaste` can fire, and `disableStdin: true` makes xterm's own paste a no-op. Fix: bind `paste` in the **capture phase**, not via React `onPaste`.
- **`mapKey()` (L36-56) discards modifiers.** It never reads `altKey`/`shiftKey` and returns `null` for any `metaKey`, so `Option+←` is sent as a bare `Left`, `Option+Backspace` as a bare `BSpace`, and `Cmd+Backspace` as nothing. Fixable frontend-only with `M-b`/`M-f`/`C-w`/`C-u`, all already permitted by the server allowlist and all verified against a live Claude Code input.
- **Focus drifts into `.xterm-helper-textarea`** on a second click or a drag-select; from there xterm swallows `keydown` too, killing Interact mode entirely while the orange banner still claims it is active — because `handleBlur` (L541-545) counts the xterm textarea as "still inside" the capture div.
- **`handlePaste` truncates to `split('\n')[0]`** (L523) even though `sendDirectInput` already implements multi-line bracketed paste server-side.

`applySnapshot` (L202-211) writes `'\x1bc' + text` — a full RIS reset — on every frame, which resets the buffer and is expected to destroy any active text selection while an agent is producing output.

`Cmd+←`/`→` is **not** available for line navigation: `AgentList.tsx:577-580` binds it (and `Ctrl+`arrows) to previous/next agent. `Ctrl+A`/`Ctrl+E` and `Home`/`End` already reach line start/end today. `Alt+F` is reserved for expand/collapse.

> **Superseded (2026-09-13):** `TASK-141` removed the `Cmd`/`Ctrl`+Arrow agent-switch binding above entirely, replacing it with `Ctrl+Alt+Arrow` — so `Cmd+←`/`→` and bare `Ctrl+←`/`→` are no longer claimed by agent navigation. But freeing the shortcut did **not** make either combo work as terminal cursor navigation: `derived_from::[[terminal-modifier-arrow-navigation]]` found `mapKey()` still returns `null` unconditionally for `metaKey` and for any non-letter `ctrlKey` chord, and the capture `<div>` (not an editable element) has no native fallback for a modified arrow key. `TASK-141`'s `UAT-141` (`UAT-UI-002`) is pending and expected to fail on exactly this. See that page for the two-file (`mapKey()` + `TMUX_KEY_RE`) fix.

See relates_to::[[tmux-capture-pane-escape-sequences]] for why the backend change is necessary.
relates_to::[[ansi-terminal-emulation-browser]]
relates_to::[[focused-terminal-transport]]
relates_to::[[local-observability]]
relates_to::[[tmux-headless-window-sizing]]
relates_to::[[browser-terminal-input-capture]]
relates_to::[[tmux-send-keys-key-names]]
relates_to::[[direct-input-mode-focus-reliability]]
relates_to::[[terminal-modifier-arrow-navigation]]

## Single consumer, and default-on Direct Input / double-click fullscreen (researched 2026-08-15)

`LogTail` has **exactly one render call site** in the whole `components/` tree — `AgentDetailModal` at `AgentList.tsx:807` — so its default behaviors can be hardcoded without threading new props through multiple call sites. See `derived_from::[[agent-detail-modal-redesign]]`.

- **Direct Input default-on**: `interacting` (`useState(false)`, ~L157) is currently only auto-armed via the `interactSignal` prop, which increments only when `AgentDetailModal` is opened from the needs-attention card CTA (`armInteract`). The recommendation is a mount effect that fires the same `setInteracting(true); captureRef.current?.focus()` unconditionally on every `LogTail` mount, not just on `interactSignal` increments — since the modal renders `<LogTail key={agent.id} .../>`, agent-navigation already remounts it, so this also re-arms Direct Input on every agent switch.
- **Double-click-to-fullscreen**: no `onDoubleClick` exists anywhere in this file today. `expanded`/`onToggleExpand` (owned by the parent modal as `logExpanded`) already implement "terminal takes the whole modal," currently reachable only via the global `⌥F` listener (`isExpandShortcut`, L12-14, duplicated in `AgentList.tsx:74-76` as `isLogExpandShortcut`) and an icon button (~L700-725). Wiring `onDoubleClick={onToggleExpand}` onto the `xtermContainerRef` div (alongside its existing single-click-to-interact handler, ~L660-664) reuses this mechanism exactly with no new state.
- **Risk noted**: auto-focusing `captureRef` (a plain `<div>`, not an `<input>`/`<textarea>`) on mount bypasses the modal's `tag === 'TEXTAREA' || tag === 'INPUT'` bail-out for `⌘←/→` agent navigation (`AgentList.tsx` ~L561-563) — needs a manual check that agent-nav and Escape/Escape-twice still work once the terminal auto-focuses.

## Confirmed regression: double-click-to-fullscreen shipped without the Collision-2 mitigation (2026-09-13)

The double-click-to-fullscreen wiring above (`onDoubleClick={onToggleExpand}` on `xtermContainerRef`) shipped, but `[[browser-terminal-input-capture]]`'s Collision-2 mitigation (re-focus the wrapper on `mouseup`) was never added alongside it. Result — user-reported bug, `derived_from::[[direct-input-mode-focus-reliability]]`:

- `xtermContainerRef`'s `onClick` (which calls `captureRef.current?.focus()`) is wired **only when `!interacting`** (`LogTail.tsx:687`). Once Direct Input is already active, that handler is `undefined`.
- Any mousedown into the terminal while already interacting — not only a double-click — fires xterm.js's own mousedown→`CoreBrowserTerminal.focus()` binding (confirmed at the xterm.js source, independent of `disableStdin`), which steals focus onto `.xterm-helper-textarea`. Nothing re-focuses `captureRef` afterward.
- Separately, the modal-open autofocus effects (`interactSignal` at L448-455, `defaultInteractArmedRef` at L462-469) defer `captureRef.current?.focus()` behind an async `/agents/:id/tail` fetch plus `setTimeout(..., 0)`, with no verification the focus landed — a second, independent reliability gap in the same file.
- The Direct Input toggle **button** already guards against this class of bug (`onMouseDown={(e) => e.preventDefault()}`, L754) — that guard was never applied to `xtermContainerRef`.

Fix directions and a full Phase-0 audit checklist (other untested focus-transition paths in this file) are in `raw/research/direct-input-mode-focus-reliability/index.md`.

## Scrollbar flashing on frequent live repaints (user-reported, researched 2026-09-13)

The `\x1bc`+write full-reset pattern in `applySnapshot` (see above) also causes `.xterm-viewport`'s scrollbar thumb to visibly flash/flicker on every live update while in follow-mode — a known xterm.js issue class (`derived_from::[[xterm-scrollbar-flicker]]`), not a bug specific to this component. The existing `writingRef`-gated scroll-ignore guard (protects *logical* follow-state) does not address this, since the *visual* flash is driven by the raw DOM `scrollTop` churn itself, not by how this component's own `'scroll'` handler reacts to it. Recommended fix: debounce/coalesce `applySnapshot` calls on the two **live**-update paths (WebSocket ~L408, SSE ~L446) to a bounded rate (~150-250ms trailing-edge) while `followRef.current` is true, leaving the "catch up on return to bottom" path (~L325-327) undebounced. No `@xterm/xterm` version change needed or recommended — the complete upstream fix ships only in the unreleased 7.0 line. See `raw/research/xterm-scrollbar-flicker/index.md` for the full comparison and implementation outline.

**Fix shipped (2026-09-13)**: refined by a user live-diagnosis that the flicker only happens when the viewport rests at the literal bottom (`viewportY === baseY`), not merely "on frequent repaints." `LogTail.tsx` now keeps a permanent `BOTTOM_OFFSET_LINES = 2` offset short of the true bottom via a new `scrollNearBottom(term)` helper (`scrollToBottom()` + `scrollLines(-BOTTOM_OFFSET_LINES)`), replacing both prior `scrollToBottom()` call sites (post-repaint snap in `applySnapshot`, and the on-`focused` re-arm effect). The follow-mode `atBottom` check was correspondingly widened from exact equality to `baseY - viewportY <= BOTTOM_OFFSET_LINES`, or the intentional offset would break follow-mode on every repaint. The debounce approach `derived_from::[[xterm-scrollbar-flicker]]` originally recommended was not implemented — kept as a complementary fallback if any residual flicker surfaces under very high-frequency bursts.

## Typed-command capture seam (researched 2026-09-19)

`enqueue(payload)` is the **single choke point** for every byte of Direct Input — `handleKeyDown` (via `mapKey`), and `handlePaste` funnel through it (the send box's `handleSendSubmit` was removed by TASK-0200), and it already picks the focused WebSocket (`terminalWsRef.current?.sendInput`) or falls back to the serialized `sendAgentKeys` POST. That makes it the one place a "last typed command" feature would hook, without instrumenting two transports. But it sees per-key deltas, not a command line, so recording a submitted command needs a mirror buffer with explicit uncertainty handling — see `derived_from::[[terminal-typed-command-persistence]]` and `relates_to::[[keystroke-stream-command-reconstruction]]`. The `conductor:<thing>:<agentId>` localStorage key convention (e.g. `conductor:taskDraft:<agentId>`) is what a `conductor:lastCommand:<agentId>` value would follow.

> **Update (TASK-0200, 2026-09-20):** the send box (`handleSendSubmit`, `sendText` state, `conductor:sendDraft:<agentId>` draft) no longer exists. The bottom bar now hosts the Add Task box (`AddTaskForm`) through an optional `taskInput` slot prop supplied by `AgentDetailView`, followed by the `Direct Input` toggle. `enqueue` is fed only by Direct Input key, paste and image-drop paths. Orphaned `conductor:sendDraft:*` keys are left in localStorage unused.

> **Superseded for hook-capable agents (2026-09-20):** an `onEnter`/keystroke hook in `enqueue()` cannot know whether Enter *submitted* anything (the TUI may be accepting an autocomplete, confirming a dialog, or inserting a newline). `derived_from::[[last-user-message-capture]]` recommends capturing the exact prompt from Claude Code's `UserPromptSubmit` hook payload into the agent sidecar instead, leaving `LogTail` untouched; the `enqueue()` mirror buffer is only the fallback for agents with no submit hook. See `relates_to::[[hook-authoritative-last-prompt]]`.
