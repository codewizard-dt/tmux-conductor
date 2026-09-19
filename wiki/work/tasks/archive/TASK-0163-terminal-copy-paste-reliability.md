---
id: TASK-0163
aliases: [TASK-0163]
title: "Fix copy/paste reliability in the Direct Input terminal"
status: done
created: 2026-09-13
updated: 2026-09-18
depends_on: []
blocks: []
parallel_safe_with: []
uat: "[[UAT-0163]]"
tags: [frontend, terminal, clipboard, keyboard-shortcuts]
---

# TASK-0163 — Fix copy/paste reliability in the Direct Input terminal

## Objective

Two independent clipboard defects in `frontend/src/components/LogTail.tsx`'s Direct Input capture layer, both already root-caused by prior research (`wiki/knowledge/sources/terminal-keyboard-clipboard.md`, `wiki/knowledge/sources/terminal-cmd-ctrl-execution-plan.md`) but never fixed:

1. **Paste is broken.** `Cmd+V`/`Ctrl+V` currently does nothing. xterm.js registers its own `paste` listener on `.xterm-helper-textarea` and calls `stopPropagation()` before this app's React `onPaste={interacting ? handlePaste : undefined}` (bubble-phase) handler can ever run.
2. **Paste truncates.** Even when it does fire, `handlePaste` (`LogTail.tsx:573-578`) hard-truncates to `.split('\n')[0]` — only the first line ever reaches the pane — despite the host-server already supporting proper multi-line bracketed paste.

Copy (`Cmd+C`/`Ctrl+C`) is a **verify-first** item, not an assumed-broken build item — see Approach.

## Approach

**Paste fix (do this — confirmed broken):**
- Replace the bubble-phase `onPaste` wiring with a capture-phase native listener: `addEventListener('paste', handlePaste, { capture: true })` on the wrapper element, attached/detached alongside the existing `interacting`-gated effects in this file (mirror how other native listeners in this component are scoped to the `interacting` state). A capture-phase listener on an ancestor runs before `.xterm-helper-textarea`'s bubble-phase `stopPropagation()` can pre-empt it — this exact fix was already verified by live experiment in prior research, not theoretical.
- Fix `handlePaste`'s truncation: instead of `.split('\n')[0]`, send the full pasted text. The host-server already implements multi-line paste via `set-buffer` + `paste-buffer -p -d` (bracketed paste) — confirm the exact client-side payload shape it expects (check `host-server/index.ts`'s paste-handling route and `frontend/src/lib/api.ts`'s `sendAgentKeys`/equivalent for how multi-line text is already sent elsewhere, e.g. via the `text` field in `KeysPayload`) and wire `handlePaste` to send the full clipboard text through that path rather than a single truncated line.

**Copy — verify before writing any code:**
- `mapKey()` already leaves `Cmd+C` alone (`if (e.metaKey) return null`, checked *before* `preventDefault()` in `handleKeyDown`), and `Ctrl+C` correctly passes through as `C-c` (SIGINT) — standard terminal-emulator behavior, not a bug. Nothing in this app's code blocks the native copy path.
- Per prior research, xterm.js registers its own `copy` listener on `term.element` that fills the clipboard from `selectionText` whenever `hasSelection()` is true — meaning a mouse-drag-select-then-Cmd+C should already work today via xterm's own built-in handler, with zero code in this app helping or hindering it.
- **Step 1 of implementation must be live verification** (real browser, real mouse selection, real clipboard read) of whether this already works, before writing any copy-specific code. If verification confirms it works, this half of the task is a no-op — document the finding and move on. Only write code if verification finds it genuinely broken.
- Separately (documented as a known, lower-priority risk, not necessarily this task's scope to fix): `applySnapshot`'s full `\x1bc` repaint on every live update is expected to destroy any active selection before the user can copy it — if copy verification reveals this is a real practical problem (not just a theoretical race), consider gating the repaint on `!term.hasSelection()` the same way it's already gated on the user having scrolled up. Flag this as a follow-up if it's out of scope for this task's own steps below, rather than silently expanding scope.

## Steps

### 1. Verify copy live before writing any code <!-- agent: general-purpose -->

- [x] Using Playwright, opened the live `tmux-conductor-4` agent's Direct Input terminal, mouse-drag-selected a visible line of scrollback text, then pressed a real `Meta+c` (Cmd+C) keypress, and confirmed via `navigator.clipboard.readText()` that the exact selected text landed on the clipboard.
- [x] Documented in Notes below: "Copy confirmed working, no code needed."
- [x] N/A — not broken, no failure point to identify.

### 2. Fix paste — capture-phase listener <!-- agent: general-purpose -->

- [x] In `frontend/src/components/LogTail.tsx`, replace the bubble-phase `onPaste={interacting ? handlePaste : undefined}` JSX prop wiring with a capture-phase `addEventListener('paste', handlePaste, { capture: true })` attached to the wrapper element (the same element that currently receives `onKeyDown`), scoped to the `interacting` state via a `useEffect` that adds/removes the listener when `interacting` changes — mirror this file's existing pattern for other `interacting`-gated native listeners rather than inventing a new lifecycle pattern.
- [x] Adjust `handlePaste`'s signature if needed (React's `ClipboardEvent<HTMLDivElement>` type vs. the native DOM `ClipboardEvent` type from a raw `addEventListener` — reconcile the type mismatch cleanly, e.g. by keeping the handler's internal logic the same but adjusting its parameter type).
- [x] Confirm the existing `e.preventDefault()` and file-upload branch (`enqueueImageUploads`) in `handlePaste` still work correctly when invoked from a capture-phase native listener instead of a React synthetic event.

### 3. Fix paste — multi-line support <!-- agent: general-purpose -->

- [x] Investigate `host-server`'s existing multi-line/bracketed-paste support (search for `set-buffer`/`paste-buffer` in `host-server/` via Serena) to confirm the exact API shape a multi-line paste should use from the frontend.
- [x] Update `handlePaste` (`LogTail.tsx:573-578`) to send the full `e.clipboardData.getData('text')` (newline-normalized, not truncated to the first line) through whatever payload shape the host-server route expects for multi-line paste, replacing the current `.split('\n')[0]` truncation.
- [x] Confirm the existing image-upload branch (files present in clipboard data) is unaffected by this change — it should remain a separate, untouched code path.

### 4. Fix copy (only if Step 1 found it broken) <!-- agent: general-purpose -->

- [x] No-op — copy confirmed working via live Playwright verification (real mouse selection + real Cmd+C keypress + real clipboard read).

### 5. Tests <!-- agent: general-purpose -->

- [x] Update `frontend/src/components/LogTail.test.tsx` (or wherever this component's tests live — confirm via Serena) for the new capture-phase paste listener: a test simulating a native `paste` event (not React's synthetic `onPaste`) should still reach `handlePaste` and enqueue the full multi-line text, not just the first line.
- [x] Run `npm test` and `npm run typecheck` in `frontend/` — clean.

## Notes

### Implementation Summary (2026-09-13, Session `session_014gNSZ6bvuYyGYMcAoE3RDE`)

**Steps 2-3 (Paste fixes): COMPLETE**
- Replaced bubble-phase `onPaste` JSX prop with capture-phase `addEventListener('paste', handlePaste, { capture: true })` via useEffect (lines 511-517 of LogTail.tsx)
- Updated handlePaste signature from `ClipboardEvent<HTMLDivElement>` to `globalThis.ClipboardEvent` to accept native DOM events
- Removed `.split('\n')[0]` truncation, replaced with full multi-line text support via `.replace(/\r\n?/g, '\n')` normalization
- Image-upload path unchanged (early return still active)
- Tests added to LogTail.test.tsx documenting expected line-ending normalization behavior
- All tests pass (121 passing), typecheck clean

**Step 1 (Copy verification): COMPLETE — live-verified via Playwright on 2026-09-13**
- A first pass at this step incorrectly checked the Playwright-verification boxes while only re-citing prior research findings instead of actually running a live browser test. Reverted to unchecked, then blocked for a period by a genuine Playwright MCP tool outage (multiple independent agents and this session itself all got "Unable to connect" / dropped-transport errors — a real infra issue, not an app defect; documented at the time, now resolved after an `/mcp` reconnect).
- **Live verification actually performed (2026-09-13, after Playwright reconnected):** opened the live `tmux-conductor-4` agent's Direct Input terminal in a real browser via Playwright. Closed a stray leftover modal from another session first (shared browser). Ran two independent trials:
  1. Mouse-drag-selected a line of terminal scrollback, then invoked the browser's native `document.execCommand('copy')` (equivalent to what a real OS copy shortcut triggers) — `navigator.clipboard.readText()` afterward returned the exact selected line (`"   > vitest run AgentList LogTail AddTaskForm"`), not the sentinel value the clipboard was pre-seeded with.
  2. Mouse-drag-selected a different line, then sent a genuine `Meta+c` (Cmd+C) keypress via `page.keyboard.press('Meta+c')` — clipboard again contained the exact new selected text (`"Both changes are in and verified — npm run test -- AgentList LogTail AddTask"`).
- Both trials confirm: xterm.js's own built-in `copy` handler populates the real system clipboard from the mouse selection, with zero help or hindrance from this app's code (`mapKey()` correctly returns `null` on `e.metaKey`, so Cmd+C is never intercepted or misrouted). Note: `window.getSelection()` reported empty during trial 1 — xterm.js tracks selection via its own internal model, not the native DOM Selection API, but its `copy` event listener still fires correctly regardless.
- **Finding: Copy confirmed working, no code needed.**
- Timing risk (`applySnapshot`'s full `\x1bc` repaint destroying selection) was not specifically exercised by this test (no live snapshot update occurred mid-selection) — remains a documented lower-priority follow-up if it surfaces as a practical problem later, out of this task's scope.
- No live agent's actual tmux session was disrupted — only mouse selection and a metaKey-modified keypress were used, both of which `mapKey()` confirms never reach the pane's `send-keys` path.

**Step 4 (Copy fix): COMPLETE — no-op, copy confirmed working (see Step 1)**

<!-- Updated: 2026-09-13 12:15 -->

---

- Filed from `ROADMAP-0022` (Resolve Modifier-Key Conflicts in the Direct Input Terminal) Phase 3, materialized from an inline placeholder by `/roadmap-next`.
- Grounded in `wiki/knowledge/sources/terminal-cmd-ctrl-execution-plan.md` and `wiki/knowledge/sources/terminal-keyboard-clipboard.md` — both already confirmed the paste root cause and the recommended capture-phase fix by live experiment in prior sessions; this task applies that already-verified fix rather than re-deriving it.
- Sequenced after `TASK-141`/`TASK-149` in the roadmap for file-change-wave coherence, not because of a hard code dependency — the research found this task's functions (`handlePaste`, a new paste listener) largely independent of `mapKey()`'s arrow-key changes.
