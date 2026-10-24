---
id: keystroke-stream-command-reconstruction
title: Reconstructing a Submitted Command from a Keystroke Stream
aliases: [command-line-mirror-buffer, typed-command-capture]
updated: 2026-09-20
sources:
  - ../../raw/research/terminal-typed-command-persistence/index.md
  - ../../raw/research/last-user-message-capture/index.md
confidence: ambiguous
tags: [frontend, terminal, direct-input, pattern]
---

# Reconstructing a Submitted Command from a Keystroke Stream

When input is forwarded to a terminal **one key at a time** (as `LogTail`'s Direct Input does: one `{ text: <char> }` or `{ keys: [...] }` per keypress), the sender never owns the assembled command line — the pane's line editor does. Any feature that needs "the command the user just submitted" must rebuild it from the stream with a **mirror buffer**, and the mirror is exact only for the simple case.

**Exact:** printable characters appended, `Backspace` removing the last character, `Enter` committing the buffer. **Lossy (the real input buffer diverges from the mirror):** history recall (`Up`/`Down` sends no text, so the mirror is empty at `Enter`), Tab completion, cursor movement followed by mid-line edits, word/line kills (`C-w`, `C-u`, `M-` chords), and multi-line or bracketed paste. The editor's exact behaviour in the Claude Code TUI versus a plain shell is *not* verified against a primary source.

**Design rules that follow:**
- Model **uncertainty explicitly**: keys that move or rewrite the line the mirror cannot track flip the buffer to "uncertain"; committing an uncertain buffer at `Enter` should **leave the previous record unchanged** rather than store a possibly-wrong one.
- Keep the reducer **pure** (`(buffer, payload) → { buffer, submitted? }`) so the lossy rules are unit-testable without React or a terminal.
- Prefer an **exact source when one exists**: an input that submits a whole line in one call (`{ text, enter: true }`) needs no reconstruction and should be recorded verbatim.
  > **Contradiction (TASK-0200, 2026-09-20):** the send box that was this example was removed from `LogTail` by TASK-0200 (replaced by the Add Task box, which queues a task rather than typing into the pane). The principle stands, but the terminal currently has no such exact-line input.
- The exact alternative for the terminal path is reading the line from the pane on `Enter` (server-side `capture-pane`) — exact but racy against TUI redraw and no longer frontend-only.
- Treat the buffer as **sensitive**: it can hold a password typed into a masked prompt, so decide up-front whether to skip, cap or expire what gets persisted.

relates_to::[[browser-terminal-input-capture]] relates_to::[[log-tail]] relates_to::[[tmux-send-keys-key-names]] relates_to::[[terminal-typed-command-persistence]]

> **Contradiction (2026-09-20):** this page treats the mirror buffer as the way to obtain "the submitted command" and lists server-side `capture-pane` as the only exact alternative. `raw/research/last-user-message-capture/index.md` finds a third, better option for hook-capable agents: Claude Code's `UserPromptSubmit` hook payload carries the exact `prompt`, and `write-state.js` already parses it and discards it. For those agents, persist it in the `<agent>.meta.json` sidecar rather than reconstructing from keystrokes. See `contradicts::[[hook-authoritative-last-prompt]]`. The mirror buffer remains valid only as a fallback for agents with no submit hook (e.g. Aider). Also note the "exact only for type+Enter" claim above rests on Enter meaning *submit*, which the TUI does not guarantee (autocomplete accept, dialogs, empty submit, newline) *(inference)*.
