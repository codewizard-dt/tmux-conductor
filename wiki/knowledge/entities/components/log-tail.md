---
id: log-tail
title: LogTail
aliases: [LogTail.tsx]
updated: 2026-08-15
sources:
  - ../../../raw/research/web-terminal-emulators/index.md
  - ../../../raw/research/application-latency-structure/index.md
  - ../../../raw/research/application-latency-structure/index-2.md
  - ../../../raw/research/terminal-keyboard-clipboard/index.md
  - ../../../raw/research/agent-detail-modal-redesign/index.md
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

See relates_to::[[tmux-capture-pane-escape-sequences]] for why the backend change is necessary.
relates_to::[[ansi-terminal-emulation-browser]]
relates_to::[[focused-terminal-transport]]
relates_to::[[local-observability]]
relates_to::[[tmux-headless-window-sizing]]
relates_to::[[browser-terminal-input-capture]]
relates_to::[[tmux-send-keys-key-names]]

## Single consumer, and default-on Direct Input / double-click fullscreen (researched 2026-08-15)

`LogTail` has **exactly one render call site** in the whole `components/` tree — `AgentDetailModal` at `AgentList.tsx:807` — so its default behaviors can be hardcoded without threading new props through multiple call sites. See `derived_from::[[agent-detail-modal-redesign]]`.

- **Direct Input default-on**: `interacting` (`useState(false)`, ~L157) is currently only auto-armed via the `interactSignal` prop, which increments only when `AgentDetailModal` is opened from the needs-attention card CTA (`armInteract`). The recommendation is a mount effect that fires the same `setInteracting(true); captureRef.current?.focus()` unconditionally on every `LogTail` mount, not just on `interactSignal` increments — since the modal renders `<LogTail key={agent.id} .../>`, agent-navigation already remounts it, so this also re-arms Direct Input on every agent switch.
- **Double-click-to-fullscreen**: no `onDoubleClick` exists anywhere in this file today. `expanded`/`onToggleExpand` (owned by the parent modal as `logExpanded`) already implement "terminal takes the whole modal," currently reachable only via the global `⌥F` listener (`isExpandShortcut`, L12-14, duplicated in `AgentList.tsx:74-76` as `isLogExpandShortcut`) and an icon button (~L700-725). Wiring `onDoubleClick={onToggleExpand}` onto the `xtermContainerRef` div (alongside its existing single-click-to-interact handler, ~L660-664) reuses this mechanism exactly with no new state.
- **Risk noted**: auto-focusing `captureRef` (a plain `<div>`, not an `<input>`/`<textarea>`) on mount bypasses the modal's `tag === 'TEXTAREA' || tag === 'INPUT'` bail-out for `⌘←/→` agent navigation (`AgentList.tsx` ~L561-563) — needs a manual check that agent-nav and Escape/Escape-twice still work once the terminal auto-focuses.
