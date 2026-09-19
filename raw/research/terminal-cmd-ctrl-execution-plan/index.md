---
topic: "Execution plan for TASK-141 + TASK-149 plus ensuring copy/paste work inside the Direct Input terminal, given all three depend on Cmd/Ctrl/Option modifier-key handling"
slug: terminal-cmd-ctrl-execution-plan
researched: 2026-09-13
sources: [./sources.md]
---

# Research: Sequencing TASK-141, TASK-149, and a Direct Input copy/paste fix

> This repo already has deep prior research on this exact area (`terminal-keyboard-clipboard`, `terminal-modifier-arrow-navigation`, `browser-terminal-input-capture`) — this pass synthesizes it against the **current live code** rather than re-deriving it, and answers the one thing the prior research left open: what's actually implemented today versus still just a documented recommendation. Verdict: **paste is still broken** (the verified capture-phase fix was never wired in; paste also still truncates to one line), **copy likely already works** for a fresh mouse-drag selection via xterm's own built-in `copy` listener (no code in this app performs or blocks it either way), but is fragile because the live-repaint mechanism destroys any selection on the next update. Recommended sequencing: TASK-141 (in flight) → TASK-149 → a new copy/paste task, in that order, because TASK-149 explicitly needs to know TASK-141's *final* live shortcut before it can safely claim Cmd+Arrow, and the copy/paste fix is the most independent of the three (touches a different function in the same file) but benefits from landing after the modifier-key work settles so `LogTail.tsx`'s keyboard/clipboard surface changes as one coherent wave instead of three overlapping edits.

## Research Questions
- Is the previously-documented capture-phase paste fix actually implemented in `LogTail.tsx` today, or still open?
- Is copy (Cmd+C / Ctrl+C) inside the terminal currently broken, working, or unimplemented/unverified?
- What other clipboard/paste gaps remain (e.g. the previously-found multi-line paste truncation)?
- How should TASK-141, TASK-149, and copy/paste work be sequenced?

## Current State (Codebase)

- **Paste — still broken, fix not implemented.** `LogTail.tsx:691` wires paste via React's bubble-phase synthetic handler: `onPaste={interacting ? handlePaste : undefined}`. A `search_for_pattern` for `addEventListener('paste'`/`capture: true` across the file returns zero matches [S1] — the capture-phase listener the prior research (`[[terminal-keyboard-clipboard]]`) verified as the actual fix was never added. Per that same research, xterm.js's own `paste` listener on `.xterm-helper-textarea` calls `stopPropagation()` first, which pre-empts a bubble-phase React handler — so `Cmd+V`/`Ctrl+V` paste is expected to still silently do nothing in the live app today, exactly as originally found.
- **Paste truncation — also still present.** `handlePaste` (`LogTail.tsx:573-578`) reads: `e.clipboardData.getData('text').replace(/\r/g, '').split('\n')[0]` — still hard-truncates to the first line only [S1], even though the prior research confirmed the host-server already supports proper multi-line bracketed paste (`set-buffer` + `paste-buffer -p -d`). This is a second, independent paste gap beyond the capture-phase-listener issue.
- **Copy — no explicit handling exists (by design, and that's likely fine).** A `search_for_pattern` for `KeyC`/`onCopy`/`navigator.clipboard`/bare `'c'` across `LogTail.tsx` returns zero matches [S1] — this app does not implement its own copy-to-clipboard logic anywhere. `mapKey()` (`LogTail.tsx:45-66`) [S1] handles the two relevant cases:
  - `Ctrl+C` → `if (e.ctrlKey) return /^[a-zA-Z]$/.test(e.key) ? { keys: [`C-${e.key.toLowerCase()}`] } : null` — a bare-letter Ctrl chord maps to `C-c`, sent to the tmux pane as SIGINT. This is **correct terminal-emulator behavior**, not a bug — bare Ctrl+C is universally interrupt, not copy, in every real terminal app.
  - `Cmd+C` → `if (e.metaKey) return null` (first line of the function) — `mapKey` returns `null`, and `handleKeyDown` (`LogTail.tsx:516-557`) [S1] does `const payload = mapKey(e); if (!payload) return` — critically, this `return` happens **before** `e.preventDefault()`, so the keydown event is left alone and allowed to behave natively.
  - Because nothing in this app's own code blocks it, and per the prior research xterm.js's own `copy` listener on `term.element` "fills the clipboard from `selectionText` when `hasSelection()`" [S2], **the native browser copy path (mouse-drag-select, then Cmd+C) should already reach xterm's own working copy implementation** with no help needed from this app's code. This has not been directly re-verified live in this pass (would require a real browser + real clipboard permissions), but is a strong inference from the current code plus the prior research's confirmed xterm.js internals.
- **The real remaining copy risk is repaint, not the keyboard/clipboard wiring.** `applySnapshot` writes `term.write('\x1bc' + text)` — a full RIS reset — on every live update while following the tail (`[[browser-terminal-input-capture]]`'s "Corollary" section, confirmed still accurate against current code this session via the scrollbar-flicker research). A `\x1bc` reset is expected to destroy any active `.xterm-selection`, so a copy attempt only has a window of "however long until the next live update" to succeed — on a busy/streaming agent that could be under a second.
- **TASK-141's shortcut has changed at least twice already this session** — `TASK-149`'s own file (`wiki/work/tasks/TASK-149-fix-modifier-arrow-terminal-navigation.md:24`) [S1] flags this explicitly: described as `Ctrl+Alt+Arrow` originally, observed live as `Shift+Cmd+Arrow` (actually `Shift+{Cmd-or-Ctrl}+Arrow`, made OS-aware later this same session per this session's own `/now` work) by the time `TASK-149` was written. `TASK-149` is `todo` and has not started.
- **`TASK-141` is at `status: pending-uat`** [S1] — implementation is done (including the OS-aware label work done this session), only human UAT verification remains.

## Key Findings

1. Paste is a confirmed, still-open bug with a **known, previously-verified fix** (capture-phase listener) that simply hasn't been wired in yet — this is the highest-confidence, lowest-risk item of the three areas, since the fix was already validated by live experiment in the prior research pass, not just theorized [S1][S2].
2. Paste also silently drops everything after the first line — a second, separate defect in `handlePaste` itself, unrelated to the capture-phase issue, that a paste fix must also address to be complete [S1].
3. Copy is very likely already functional for the common case (drag-select, then Cmd+C) purely because xterm.js already implements it and nothing in this app interferes — this is a **verify-first, don't-assume-broken** item, not necessarily a build item. The correct first step is confirming this live before writing any code, since building a redundant copy implementation on top of a working one would be wasted, conflicting work [S2].
4. The real, more interesting copy-side risk is the repaint-destroys-selection timing window, already documented as a known corollary — worth a real UAT check, and a candidate one-line fix (gate `applySnapshot`'s repaint on `!term.hasSelection()`, mirroring the existing scroll-position gate) if it proves to actually bite users in practice.
5. `TASK-149` cannot safely start its "confirm none of these three combinations trigger the modal's agent-switch shortcut" verification step until `TASK-141`'s shortcut is truly final — `TASK-141` is `pending-uat`, meaning its shortcut is implementation-complete but not yet human-verified. A late-breaking UAT finding that reopens `TASK-141`'s implementation would invalidate `TASK-149`'s own verification against that shortcut.

## Constraints

- All three areas share one file (`frontend/src/components/LogTail.tsx`) and one conceptual surface (modifier-key handling in the Direct Input capture layer) — sequencing them serially (or carefully scoping parallel work to genuinely disjoint functions) avoids repeated merge friction in the same file.
- `mapKey()`'s existing `metaKey → null` / `ctrlKey → letter-only` branches must not regress for chords outside the three arrow-key combinations `TASK-149` targets — already an explicit constraint in `TASK-149`'s own file.
- No backend/host-server change is needed for any of the three areas per the prior research — `TMUX_KEY_RE` already allowlists everything relevant, and the host-server's paste-buffer mechanism already supports multi-line paste; all remaining work is frontend-only.
- A copy/paste task should explicitly re-verify (not assume) whether Cmd+C already works, given finding 3 above — the roadmap item should be scoped as "fix paste; verify and, if needed, fix copy" rather than "implement copy from scratch."

## Recommendation

**Sequence: TASK-141 (finish UAT) → TASK-149 → new copy/paste task.**

### Implementation outline
1. **TASK-141** — already implementation-complete (`pending-uat`); this roadmap's first phase is closing out its human verification, not new code.
2. **TASK-149** — implement Ctrl/Cmd/Option+Arrow terminal cursor navigation in `mapKey()`, re-verifying TASK-141's final live shortcut at execution time (per its own existing notes) rather than trusting any historical description including this one.
3. **New task (not yet filed)** — copy/paste fix, two independent sub-fixes:
   - Paste: add a capture-phase `paste` listener (replacing or supplementing the current bubble-phase `onPaste`), and fix `handlePaste`'s first-line truncation to use the host-server's existing multi-line bracketed-paste support.
   - Copy: first *verify* live whether Cmd+C after a mouse-drag selection already works (per Key Finding 3) — only write new code if verification finds it broken. Separately assess whether the repaint-destroys-selection window (Key Finding 4) is worth a `term.hasSelection()` repaint gate, informed by how often it's actually hit in practice.

### Risks and mitigations
- **Risk**: building a copy implementation without verifying first, duplicating or conflicting with xterm's own working `copy` handler. **Mitigation**: the new task's first step should be a live verification, not an assumption either way.
- **Risk**: the capture-phase paste listener and `mapKey()`'s arrow-key changes (TASK-149) touch overlapping event-handling concerns in the same file. **Mitigation**: the functions are disjoint (`handlePaste`/a new paste listener vs. `mapKey()`), so parallel execution is *possible*, but sequencing after TASK-149 avoids any review/merge overlap risk for no real cost, since neither is urgent relative to the other.

### Alternative if constraints change
If TASK-141's UAT surfaces a shortcut change yet again, re-run TASK-149's "confirm the live combo" step before trusting this roadmap's phase order — the sequencing recommendation assumes TASK-141 settles, not any particular shortcut.

## Next Steps

- `/roadmap-create` (this session, already in progress) — sequence as Phase 1: TASK-141 UAT, Phase 2: TASK-149, Phase 3: copy/paste (inline placeholder, task not yet filed).
- `/task-add` for the copy/paste work once the roadmap exists, scoped exactly as the two sub-fixes above (verify-then-fix copy; fix-directly paste).
