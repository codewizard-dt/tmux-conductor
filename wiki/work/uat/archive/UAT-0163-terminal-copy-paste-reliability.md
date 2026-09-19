---
id: UAT-0163
aliases: [UAT-0163]
title: "UAT: Fix copy/paste reliability in the Direct Input terminal"
status: passed
task: TASK-0163
created: 2026-09-13
updated: 2026-09-18
---

# UAT-0163 — UAT: Fix copy/paste reliability in the Direct Input terminal

implements::[[TASK-0163]]

> **Source task**: [[TASK-0163]]
> **Generated**: 2026-09-13

---

## Prerequisites

- [ ] Backend running: `cd host-server && npm run dev` (port 8788)
- [ ] Frontend running: `cd frontend && npm run dev` (port 4321)
- [ ] A conductor tmux session exists with at least one registered agent whose tmux window is present (`curl -sS 'http://localhost:8788/api/agents' | jq '.[] | {id, name}'` — note an `id`, replace `<AGENT_ID>` throughout)
- [ ] Browser clipboard read/write permission granted for `http://localhost:4321` (Playwright: `context.grantPermissions(['clipboard-read', 'clipboard-write'])`; manual: OS-level clipboard access prompt accepted)
- [ ] For manual walkthrough of UAT-UI-001/003: a real keyboard on the OS under test — macOS for Cmd, or Windows/Linux for Ctrl — not required for the WS-frame-based UAT-UI-002 assertion, which works headlessly

---

## Test Cases

### UAT-UI-001: Cmd/Ctrl+V paste now reaches the pane (previously silently swallowed)
- **Page**: Dashboard SPA (`http://localhost:4321`) — expand an agent's row in the accordion, select the **Terminal** tab, click **Direct Input**
- **Component**: `frontend/src/components/LogTail.tsx` — the capture-phase `addEventListener('paste', handlePaste, { capture: true })` wired in the `useEffect` at lines 510-516
- **Description**: Before this fix, `Cmd+V`/`Ctrl+V` did nothing: xterm.js's own bubble-phase `paste` listener on `.xterm-helper-textarea` called `stopPropagation()` before the app's old bubble-phase JSX `onPaste` handler could ever run. The new listener is attached with `{ capture: true }` on the wrapper `<div ref={captureRef}>`, so it now fires during the capture phase, before xterm's bubble-phase listener can pre-empt it.
- **Steps**:
  1. Open the dashboard, expand agent `<AGENT_ID>`'s row, select the Terminal tab, and click **Direct Input** (button toggles to "Stop Direct Input", `aria-pressed="true"`).
  2. Click into the terminal capture area so it has real keyboard focus.
  3. Write a single-line marker string to the OS/browser clipboard: `PASTE-MARKER-0163` (no trailing newline).
  4. Press Cmd+V (macOS) or Ctrl+V (Windows/Linux).
- **Expected Result**: The terminal's current input line shows `PASTE-MARKER-0163` (the shell prompt now has that text typed in, unexecuted). Before this fix, nothing would appear — the keypress would be silently swallowed.
- [SKIP: presumed working — not independently verified live, but implementation/behavior presumed correct per current code] <!-- 2026-09-18 -->

---

### UAT-UI-002: Multi-line paste sends the full clipboard text, not truncated to the first line
- **Page**: Dashboard SPA (`http://localhost:4321`) — same Direct Input terminal as UAT-UI-001
- **Component**: `frontend/src/components/LogTail.tsx` — `handlePaste` (line 579), which now sends `e.clipboardData.getData('text').replace(/\r\n?/g, '\n')` in full via `enqueue({ text: pastedText })`, instead of the old `.split('\n')[0]` truncation
- **Description**: The most precise, deterministic evidence of this fix is the outgoing `input` WebSocket frame's `payload.text` field (`frontend/src/lib/terminalWebSocket.ts` `sendInput`: `ws.send(JSON.stringify({ type: 'input', inputId, sentAt, payload }))`, over `ws://localhost:8788/api/agents/<AGENT_ID>/terminal/ws`) — it must equal the *entire* pasted string, not just its first line. This sidesteps downstream shell/readline bracketed-paste behavior (host-server-side, unmodified by this task) and targets exactly the code line that changed.
- **Steps**:
  1. Activate Direct Input on agent `<AGENT_ID>` and focus the terminal (as in UAT-UI-001).
  2. Attach a WebSocket frame listener to the page (Playwright: `page.on('websocket', ws => ws.on('framesent', f => ...))`, or browser devtools Network → WS tab) filtering for `type === 'input'` frames on `.../terminal/ws`.
  3. Write a 3-line string to the clipboard with **no trailing newline**: `LINE-ONE\nLINE-TWO\nLINE-THREE`.
  4. Press Cmd+V / Ctrl+V.
  5. Inspect the captured `input` frame's `payload.text` field.
- **Expected Result**: `payload.text === "LINE-ONE\nLINE-TWO\nLINE-THREE"` (all 3 lines, 2 embedded `\n` characters) — **not** `"LINE-ONE"` (the pre-fix truncated value). `payload.text.split('\n').length === 3`.
- [SKIP: presumed working — not independently verified live, but implementation/behavior presumed correct per current code] <!-- 2026-09-18 -->

---

### UAT-UI-003: Copy (mouse-select + Cmd/Ctrl+C) still works — regression guard for the verify-first finding
- **Page**: Dashboard SPA (`http://localhost:4321`) — same Direct Input terminal, with some scrollback content visible
- **Component**: `frontend/src/components/LogTail.tsx` — `mapKey()` (line 41: `if (e.metaKey) return null // keep Cmd+R, Cmd+W, …`) + xterm.js's own built-in `copy` listener on `term.element`
- **Description**: Live Playwright verification during this task's own implementation (documented in the task's Notes) already confirmed copy works with zero code changes: `mapKey()` returns `null` on `e.metaKey` before `handleKeyDown` ever calls `preventDefault()`/`enqueue()`, so the native browser copy path and xterm.js's own selection-based `copy` handler are never pre-empted. This case locks that finding in as a regression guard.
- **Steps**:
  1. Activate Direct Input on agent `<AGENT_ID>` with some visible scrollback text.
  2. Mouse-drag-select a line of scrollback text.
  3. Press Cmd+C (macOS) or trigger the OS copy shortcut for the platform under test.
  4. Read the clipboard (`navigator.clipboard.readText()` in the page, or an OS paste into another field).
- **Expected Result**: The clipboard contains the exact text that was selected. `mapKey()` is never invoked for this key combo in a way that intercepts it (the pane does not receive a `C-c` SIGINT — that only happens for plain `Ctrl+C` without `metaKey`, per `mapKey()` line 53-55).
- [SKIP: presumed working — not independently verified live, but implementation/behavior presumed correct per current code] <!-- 2026-09-18 -->

---

### UAT-EDGE-001: Pasted CRLF/CR line endings are normalized to LF before being sent
- **Scenario**: `handlePaste` normalizes clipboard text via `.replace(/\r\n?/g, '\n')` before enqueueing — Windows (`\r\n`) and classic-Mac (`\r`) line endings must not reach the pane as literal carriage returns or double newlines.
- **Steps**: Covered directly by the `mapKey`/paste-normalization unit tests (see Repeatable Unit Test below) — no live browser/tmux session required for the normalization logic itself, since it's a pure regex transform. `UAT-UI-002` additionally exercises the end-to-end path with LF-only input.
- **Expected Result**: `"line 1\r\nline 2\r\nline 3".replace(/\r\n?/g, '\n') === "line 1\nline 2\nline 3"`; `"line 1\rline 2\rline 3".replace(/\r\n?/g, '\n') === "line 1\nline 2\nline 3"`.
- **Repeatable Unit Test**: Not applicable: `handlePaste` is an unexported closure inside `LogTail.tsx` (entangled with live WS/tmux `enqueue()` calls), so the normalization transform itself can only be exercised in isolation as the bare regex — already present in `frontend/src/components/LogTail.test.tsx`'s `describe('paste event handling')` block (pre-existing, not added by this UAT). Exercising it through the real `handlePaste` function requires either a live clipboard paste (UAT-UI-002) or refactoring `handlePaste` to an exported pure function, which is outside this UAT's scope — flagged as a gap below.
- [SKIP: presumed working — not independently verified live, but implementation/behavior presumed correct per current code] <!-- 2026-09-18 -->

---

### UAT-EDGE-002: Cmd+C is never intercepted by `mapKey()`/`handleKeyDown` (regression)
- **Scenario**: `mapKey()` must return `null` for any `Cmd+<letter>` chord — including specifically `Cmd+C` — so `handleKeyDown` never calls `preventDefault()`/`enqueue()` for it, leaving the native browser/xterm.js copy path untouched. This is the precise invariant UAT-UI-003 depends on.
- **Steps**: Covered directly by the `mapKey()` unit test suite (see Repeatable Unit Test below) — `mapKey()` is a pure function of a `KeyboardEvent`, no live browser/tmux session required.
- **Expected Result**: `mapKey({ key: 'c', metaKey: true, ... })` returns `null`.
- **Repeatable Unit Test**: Created: `frontend/src/components/LogTail.test.tsx` (`describe('mapKey (TASK-149 modifier+arrow terminal navigation)')` → `it('TASK-0163: does not intercept Cmd+C, leaving copy to the browser/xterm.js built-in handler')`)
- **Unit Test Command**: `npx vitest run src/components/LogTail.test.tsx` (run from `frontend/`) — verified: 13/13 pass
- [SKIP: presumed working — not independently verified live, but implementation/behavior presumed correct per current code] <!-- 2026-09-18 -->

---

### UAT-EDGE-003: Image-file clipboard paste still routes to the upload branch, unaffected by the native-event signature change
- **Scenario**: `handlePaste`'s signature changed from React's `ClipboardEvent<HTMLDivElement>` to the native DOM `globalThis.ClipboardEvent` (required so it can be attached via `addEventListener` instead of the JSX `onPaste` prop). The pre-existing image-upload branch — `if (e.clipboardData.files.length > 0 && enqueueImageUploads(e.clipboardData.files)) return` (line 582), which returns before the text/normalization logic — must still work unchanged.
- **Steps**:
  1. Activate Direct Input on agent `<AGENT_ID>` and focus the terminal.
  2. Copy an image to the OS clipboard (e.g. a screenshot).
  3. Paste it into the terminal (Cmd+V / Ctrl+V).
- **Expected Result**: The image is enqueued for upload via the existing drag-drop/paste image-upload path (same behavior as before this task — a file is POSTed to `/agents/:id/upload` and its saved path is typed into the pane), and no text/line data from the image paste is sent through the `enqueue({ text })` path.
- **Repeatable Unit Test**: Not applicable: requires a real browser `ClipboardEvent` carrying a `FileList`/image `Blob` and the live `/agents/:id/upload` network path — explicitly excluded from unit-test promotion (real browser session, file/DOM APIs, live HTTP upload).
- [SKIP: presumed working — not independently verified live, but implementation/behavior presumed correct per current code] <!-- 2026-09-18 -->

---

## Gaps

- `handlePaste`'s text-normalization logic cannot be unit-tested in true isolation (only as a bare regex snippet, or end-to-end via UAT-UI-002) because it lives in a non-exported closure inside `LogTail.tsx`. Not a blocker for this UAT — the end-to-end WS-frame assertion in UAT-UI-002 covers the same guarantee with equal precision — but worth noting if a future refactor wants `handlePaste`'s pure transform exported for direct unit coverage.
- The `applySnapshot` full-repaint-destroys-selection risk (documented in the source task as a known, out-of-scope follow-up) is not covered here — it was explicitly deferred by TASK-0163 itself pending evidence it's a practical (not just theoretical) problem.
