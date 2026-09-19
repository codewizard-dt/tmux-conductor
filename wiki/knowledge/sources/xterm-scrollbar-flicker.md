---
id: xterm-scrollbar-flicker
title: Preventing xterm.js Scrollbar Flicker on Frequent Live Repaints
updated: 2026-09-13
sources:
  - ../../raw/research/xterm-scrollbar-flicker/index.md
confidence: extracted
tags: [frontend, terminal, xterm, performance, ux]
---

# Preventing xterm.js Scrollbar Flicker on Frequent Live Repaints

`LogTail`'s live-tail repaint (`applySnapshot`, `'\x1bc' + text` — a full RIS reset before every rewrite) is a **known, named class of xterm.js issue**, not a novel bug: a near-identical open-source terminal app filed the same symptom ("scroll jumps to top when running AI CLI tools") and traced it to the identical mechanism — "clear screen → cursor home → full repaint" sequences make xterm.js "reset `viewportY`, forcing `scrollTop` to the top" on every occurrence. xterm.js's own issue tracker (#5620) confirms the same root cause independently, with no merged fix and no documented application-level workaround on the issue itself.

**The complete upstream fix is not yet available.** The real fix (PR #5770 — "delays viewport DOM sync until after synchronized output block ends... completely eliminates flicker") merged into the unreleased xterm.js 7.0 line. As of this research, npm's stable `@xterm/xterm` is still `6.0.0` (matching this repo's pinned `^6.0.0`); only `6.1.0-beta.*` prereleases exist beyond it. Taking a major/beta dependency bump purely to chase this fix is not recommended.

**Recommended fix — debounce the live-update repaint, not a library change.** `LogTail.tsx` already has a `writingRef`-gated guard that ignores `'scroll'` events fired by its own writes (protecting *logical* follow-state tracking), but this does nothing to stop the DOM's `scrollTop` from actually churning on every write — which is what drives the *visible* scrollbar flash. The recommended fix coalesces rapid live updates (WebSocket/SSE) into a single `applySnapshot` call at a bounded rate (~150-250ms trailing-edge debounce) while in follow-mode, leaving the "catch up on return to bottom" path undebounced. This requires no dependency change and directly reduces DOM-churn *frequency* — the actual driver of the symptom — consistent with this same file's prior fix for a different flicker bug (consolidating a two-call `clear()`+`write()` into one `write('\x1bc'+text)` call to eliminate a blank intermediate frame).

A weaker, `~80%`-effective alternative (VT-sequence interception before xterm.js processes it) and a redundant alternative (Tabby's capture-phase `pinnedToBottom` flag — redundant here since `LogTail.tsx` already gates on `writingRef` in spirit) were both considered and are not recommended over the debounce approach for this codebase.

See `raw/research/xterm-scrollbar-flicker/index.md` for the full solution comparison table and implementation outline.

## Implemented fix (2026-09-13, refines the original recommendation)

User-supplied live diagnosis sharpened the root cause further: **the flicker only occurs when the viewport is resting at the literal bottom** (`viewportY === baseY`) — not merely "on frequent repaints" in general. This pinpoints the trigger as landing exactly on the scrollTop boundary, not repaint frequency per se, and led to a more targeted fix than the debounce originally recommended above (debounce reduces how *often* the boundary is hit; this fix stops the viewport from ever resting exactly on it).

**Fix shipped**: `LogTail.tsx` now keeps a small (`BOTTOM_OFFSET_LINES = 2`) permanent offset short of the true bottom instead of ever snapping to the exact last line:
- New `scrollNearBottom(term)` helper — `term.scrollToBottom()` followed by `term.scrollLines(-BOTTOM_OFFSET_LINES)` — replaces both `term.scrollToBottom()` call sites (the post-repaint snap in `applySnapshot`, and the on-focus re-arm effect).
- The follow-mode `atBottom` check (`onScroll` handler) was widened from an exact `viewportY >= baseY` equality to a tolerance: `baseY - viewportY <= BOTTOM_OFFSET_LINES` — necessary because after the intentional offset, `viewportY` legitimately never reaches `baseY` exactly; without widening this check, follow-mode would break immediately after every repaint.

Not yet done (2026-09-13 update): **now implemented.** The user reported the scrollbar handle/thumb itself was still flickering even after the offset fix above — every live update still drove a full clear+rewrite immediately, at whatever rate WebSocket/SSE messages arrived, churning the thumb's size/position on every occurrence. `LogTail.tsx` now adds a trailing-edge debounce, `LIVE_REPAINT_DEBOUNCE_MS = 200` (named constant next to `BOTTOM_OFFSET_LINES`), via a `scheduleLiveRepaint()` helper backed by a new `liveRepaintDebounceRef` timer ref: the first live update in a burst starts a 200ms timer, subsequent updates during that window just leave `pendingTextRef` (already tracked for the follow-mode catch-up path) pointing at the newest text rather than resetting the countdown, so a sustained burst still repaints at least once every 200ms instead of the timer being pushed out indefinitely. Only the two call sites that fire at live-update frequency were routed through it — the WebSocket message handler and the SSE handler's `applySnapshot` calls. The "catch up on return to bottom" call in the `onScroll` handler and the first-snapshot-on-mount call stay on direct, undebounced `applySnapshot` — both are one-shot or user-initiated repaints where instant feedback matters more than DOM-churn reduction. The timer is cleared on unmount inside the terminal-creation effect's existing cleanup, alongside `ro.disconnect()`/`term.dispose()`.

derived_from::[[xterm-js]] relates_to::[[log-tail]] relates_to::[[ansi-terminal-emulation-browser]]
