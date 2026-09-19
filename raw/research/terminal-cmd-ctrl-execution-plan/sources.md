---
topic: "Execution plan for TASK-141 + TASK-149 plus ensuring copy/paste work inside the Direct Input terminal, given all three depend on Cmd/Ctrl/Option modifier-key handling"
slug: terminal-cmd-ctrl-execution-plan
researched: 2026-09-13
---

# Primary Sources — Sequencing TASK-141, TASK-149, and a Direct Input copy/paste fix

| ID | Type | Locator | Accessed | What it contributed |
|----|------|---------|----------|---------------------|
| S1 | codebase | `frontend/src/components/LogTail.tsx` (`handlePaste` L573-578, paste wiring L691, `mapKey` L45-66, `handleKeyDown` L516-557); `wiki/work/tasks/TASK-149-fix-modifier-arrow-terminal-navigation.md`; `wiki/work/tasks/TASK-141-fix-agent-switch-hotkey-conflict.md` | 2026-09-13 | Confirmed paste is still bubble-phase-only (no capture-phase listener exists), `handlePaste` still truncates to one line, `Cmd+C`/`Ctrl+C` have no app-level handling (Ctrl+C correctly passes through as SIGINT, Cmd+C is left alone by `mapKey`/`handleKeyDown`), and both tasks' current status/notes on sequencing |
| S2 | wiki (prior research, re-read this pass) | `wiki/knowledge/sources/terminal-keyboard-clipboard.md`; `wiki/knowledge/concepts/browser-terminal-input-capture.md` | 2026-09-13 | Prior live-verified findings this pass builds on: paste's capture-phase fix (verified but not yet wired into code), xterm.js's own `copy` listener on `term.element` filling the clipboard from `selectionText` when `hasSelection()`, and the repaint-destroys-selection corollary |

## Excerpts

### S1 — `frontend/src/components/LogTail.tsx`
```
// L573-578
function handlePaste(e: ClipboardEvent<HTMLDivElement>) {
  e.preventDefault()
  if (e.clipboardData.files.length > 0 && enqueueImageUploads(e.clipboardData.files)) return
  const firstLine = e.clipboardData.getData('text').replace(/\r/g, '').split('\n')[0] ?? ''
  if (firstLine !== '') enqueue({ text: firstLine })
}

// L691
onPaste={interacting ? handlePaste : undefined}

// L45-49 (mapKey, relevant branches)
function mapKey(e: KeyboardEvent<HTMLDivElement>): KeysPayload | null {
  if (e.metaKey) return null // keep Cmd+R, Cmd+W, …
  if (e.ctrlKey) {
    return /^[a-zA-Z]$/.test(e.key) ? { keys: [`C-${e.key.toLowerCase()}`] } : null
  }
  ...

// L553-556 (handleKeyDown, tail)
const payload = mapKey(e)
if (!payload) return
e.preventDefault()
e.stopPropagation()
```

### S2 — `wiki/knowledge/concepts/browser-terminal-input-capture.md`
> "xterm registers `paste` on **both** `term.textarea` and `term.element`, and `copy` on `term.element`. Its `handlePasteEvent` calls `ev.stopPropagation()` first."
> "**Rule:** for a read-only xterm mirror with external input capture, bind clipboard events in the **capture phase** on the wrapper... This is verified, not theoretical."
> "A mirror that repaints by writing `\x1bc` (RIS, full terminal reset) plus the whole snapshot on every frame resets the buffer each time. Selections survive only while no frames arrive."

### S2 — `wiki/knowledge/sources/terminal-keyboard-clipboard.md`
> "`Cmd+V` fails because xterm.js swallows the paste event before our handler can see it... The verified fix is to listen for `paste` in the **capture phase**, which runs before the target's bubble-phase `stopPropagation()`."
